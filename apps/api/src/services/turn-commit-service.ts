import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  BufferedToolVariableMutation,
  CoreEventBus,
  ExecutedToolCallRecord,
  FloorEntity,
  MemoryConsolidationOutput,
  PendingToolJobRequest,
  PromptSnapshotRecord,
  TokenUsage,
  ToolCallRecord,
  TurnExecutionResult,
} from "@tavern/core";
import {
  FloorStateMachine,
  FloorNotFoundError,
  FloorStateConflictError,
  InvalidStateTransitionError,
} from "@tavern/core";

import type { AccountContextOptions } from "../accounts/account-context.js";
import type { AppDb, DbExecutor } from "../db/client.js";
import { DrizzleFloorRepository } from "../adapters/drizzle-floor-repository.js";
import {
  floors,
  floorResultSnapshots,
  messagePages,
  messages,
  promptRuntimeExplainSnapshots,
  promptSnapshots,
  sessions,
  toolCallRecords,
  toolExecutionRecords,
} from "../db/schema.js";
import { ChatMessagePersistence } from "./chat-message-persistence.js";
import { createUserInputDigest } from "./memory-job-utils.js";
import { MemoryJobScheduler } from "./memory-job-scheduler.js";
import {
  applyTransactionalMemoryMutations,
  emitPendingCoreEvents,
  type PendingCoreEvent,
} from "./memory-transaction-mutations.js";
import {
  VariableCommitService,
  type VariablePromotionPolicy,
} from "./variables/commit/variable-commit-service.js";
import { VariablePromotionService } from "./variables/commit/variable-promotion-service.js";
import { PageVariableStageService } from "./variables/stage/page-variable-stage-service.js";
import type {
  PageVariableDecision,
  VariablePromotionResult,
} from "./variables/contracts.js";
import type { MutationRuntime } from "./runtime-mutation-types.js";
import type { ToolRuntimeJobBridge } from "./tool-runtime-job-bridge.js";
import type { FloorRunService } from "./floor-run-service.js";
import type { StMacroStagedMutation } from "./st-macros/index.js";
import {
  buildBranchMemoryScopeId,
  buildBranchVariableScopeId,
} from "@tavern/shared";
import { DEFAULT_GLOBAL_SCOPE_ID } from "./variables/host/variable-host-service.js";
import { BranchLocalVariableSnapshotService } from "./branch-local-variable-snapshot-service.js";
import {
  buildPromptRuntimeCommittedExplainSnapshot,
  type PromptRuntimeInspectionResult,
} from "./prompt-runtime-control-service.js";
import { serializePromptRuntimeExplainSourceMapEnvelope } from "./prompt-runtime/explain-snapshot.js";
import type { SessionStateService } from "../session-state/session-state-service.js";
import { projectLegacyToolCallRecords } from "./tooling/shared/legacy-tool-call-projection.js";
import {
  mergeFloorMetadataConversationInput,
  type FloorConversationInputSnapshot,
} from "./chat/shared/metadata.js";
import { OperationLogService } from "./operation-log-service.js";
import { VcDiffService } from "./vc-diff-service.js";

type FloorRow = typeof floors.$inferSelect;

type PromptSnapshotInsert = typeof promptSnapshots.$inferInsert;
type FloorResultSnapshotInsert = typeof floorResultSnapshots.$inferInsert;
type PromptRuntimeExplainSnapshotInsert = typeof promptRuntimeExplainSnapshots.$inferInsert;
type ToolExecutionInsert = typeof toolExecutionRecords.$inferInsert;

interface MemoryCommitInput {
  summaries?: string[];
  consolidationOutput?: MemoryConsolidationOutput;
  enableConsolidation?: boolean;
}

interface VariableCommitOptions {
  pageId?: string;
  policy?: VariablePromotionPolicy;
  pageDecision?: PageVariableDecision;
}

export interface TurnCommitOperationLogContext {
  requestId?: string | null;
  operationGroupId?: string | null;
  route?: string;
}

export interface TurnCommitInput {
  accountId: string;
  floorId: string;
  sessionId: string;
  branchId?: string;
  execution: TurnExecutionResult;
  committedAt?: number;
  promptSnapshot?: PromptSnapshotRecord;
  promptRuntimeInspection?: PromptRuntimeInspectionResult;
  /**
   * 旧兼容输入。仅在没有 `toolExecutionRecords` 时作为 fallback 使用。
   *
   * 若同时提供 `toolExecutionRecords`，commit 阶段会忽略这里的内容，
   * 并从真实执行日志派生 `tool_call_record` 兼容投影。
   */
  toolCalls?: ToolCallRecord[];
  /**
   * 主执行审计输入。
   *
   * `tool_execution_record` + `runtime_job`（deferred 时）是本轮之后唯一主真相。
   */
  toolExecutionRecords?: ExecutedToolCallRecord[];
  pendingToolJobs?: PendingToolJobRequest[];
  variableCommit?: VariableCommitOptions;
  conversationInputSnapshot?: FloorConversationInputSnapshot;
  memoryCommit?: MemoryCommitInput;
  macroStagedMutations?: StMacroStagedMutation[];
  runId?: string | null;
  operationLog?: TurnCommitOperationLogContext;
  /**
   * 仅用于 `regenerate()` 等“成功 commit 后替代旧楼层”的场景。
   *
   * 若设置，则在目标 floor 事务内完成 `generating -> committed` 状态流转之后，
   * 于同一事务内把指定的源楼层标记为 `superseded`。校验项：
   * - 源 floor 存在
   * - 源 floor 与目标 floor 属于同一 `sessionId`
   * - 源 floor 状态为 `committed`
   * - 源 floor 尚未被 superseded
   *
   * 任一校验失败都会触发事务回滚，确保不会出现
   * “新楼层 committed 但旧楼层未正确 supersede” 的部分成功状态。
   */
  supersedeSourceFloor?: { floorId: string };
}

export interface TurnCommitMemoryReceipt {
  mode: "sync" | "async";
  status: "applied" | "queued";
  jobId?: string;
}

export interface TurnCommitResult {
  floorId: string;
  outputPageId: string;
  assistantMessageId: string;
  finalState: "committed";
  usage: TokenUsage;
  memory?: TurnCommitMemoryReceipt;
}

export interface TurnCommitServiceOptions extends AccountContextOptions {
  enableAsyncMemoryIngest?: boolean;
  memoryJobScheduler?: MemoryJobScheduler;
  mutationRuntime?: MutationRuntime;
  floorRunService?: FloorRunService;
  toolRuntimeJobBridge?: ToolRuntimeJobBridge;
  sessionStateService?: SessionStateService;
}

class MemoryPersistError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "MemoryPersistError";
  }
}

export class SupersedeSourceFloorError extends Error {
  constructor(
    public readonly code:
      | "supersede_source_floor_not_found"
      | "supersede_source_floor_session_mismatch"
      | "supersede_source_floor_not_committed"
      | "supersede_source_floor_already_superseded",
    message: string,
  ) {
    super(message);
    this.name = "SupersedeSourceFloorError";
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function normalizeToken(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function normalizeTokenUsage(usage: TokenUsage): TokenUsage {
  return {
    promptTokens: normalizeToken(usage.promptTokens),
    completionTokens: normalizeToken(usage.completionTokens),
    totalTokens: normalizeToken(usage.totalTokens),
  };
}

function toFloorEntity(row: FloorRow): FloorEntity {
  return {
    id: row.id,
    sessionId: row.sessionId,
    floorNo: row.floorNo,
    branchId: row.branchId,
    parentFloorId: row.parentFloorId,
    state: row.state,
    tokenIn: row.tokenIn,
    tokenOut: row.tokenOut,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPromptSnapshotInsert(record: PromptSnapshotRecord): PromptSnapshotInsert {
  return {
    floorId: record.floorId,
    sessionId: record.sessionId,
    presetId: record.presetId,
    presetUpdatedAt: record.presetUpdatedAt,
    presetVersion: record.presetVersion,
    presetVersionId: record.presetVersionId ?? null,
    presetContentHash: record.presetContentHash ?? null,
    worldbookId: record.worldbookId,
    worldbookUpdatedAt: record.worldbookUpdatedAt,
    worldbookVersion: record.worldbookVersion,
    worldbookVersionId: record.worldbookVersionId ?? null,
    worldbookContentHash: record.worldbookContentHash ?? null,
    regexProfileId: record.regexProfileId,
    regexProfileUpdatedAt: record.regexProfileUpdatedAt,
    regexProfileVersion: record.regexProfileVersion,
    regexProfileVersionId: record.regexProfileVersionId ?? null,
    regexProfileContentHash: record.regexProfileContentHash ?? null,
    worldbookActivatedEntryUidsJson: JSON.stringify(record.worldbookActivatedEntryUids),
    regexPreRuleNamesJson: JSON.stringify(record.regexPreRuleNames),
    regexPostRuleNamesJson: JSON.stringify(record.regexPostRuleNames),
    promptMode: record.promptMode,
    promptDigest: record.promptDigest,
    tokenEstimate: record.tokenEstimate,
    createdAt: record.createdAt,
  };
}

function toFloorResultSnapshotInsert(input: {
  floorId: string;
  outputPageId: string;
  assistantMessageId: string;
  generatedText: string;
  summaries: string[];
  usage: TokenUsage;
  verifierResult?: TurnExecutionResult["verifierResult"];
  committedAt: number;
}): FloorResultSnapshotInsert {
  const verifier = input.verifierResult
    ? {
        status: input.verifierResult.output.passed ? "passed" : "warned",
        suggestion: input.verifierResult.output.suggestion,
        issues: input.verifierResult.output.issues,
      }
    : null;

  return {
    floorId: input.floorId,
    outputPageId: input.outputPageId,
    assistantMessageId: input.assistantMessageId,
    generatedText: input.generatedText,
    summariesJson: JSON.stringify(input.summaries),
    usageJson: JSON.stringify(input.usage),
    verifierJson: verifier ? JSON.stringify(verifier) : null,
    committedAt: input.committedAt,
    updatedAt: input.committedAt,
  };
}

function toPromptRuntimeExplainSnapshotInsert(input: {
  floorId: string;
  sessionId: string;
  committedAt: number;
  inspection: PromptRuntimeInspectionResult;
}): PromptRuntimeExplainSnapshotInsert {
  const snapshot = buildPromptRuntimeCommittedExplainSnapshot({
    floorId: input.floorId,
    sessionId: input.sessionId,
    createdAt: input.committedAt,
    inspection: input.inspection,
  });

  return {
    id: nanoid(),
    floorId: snapshot.floorId,
    sessionId: snapshot.sessionId,
    targetBranchId: snapshot.targetBranchId ?? null,
    sourceFloorId: snapshot.sourceFloorId ?? null,
    historySourceBranchId: snapshot.historySourceBranchId,
    historySourceMode: snapshot.historySourceMode,
    memoryJson: snapshot.memory ? JSON.stringify(snapshot.memory) : null,
    snapshotVersion: snapshot.snapshotVersion,
    assetsJson: JSON.stringify(snapshot.assets),
    resolvedPolicyJson: JSON.stringify(snapshot.resolvedPolicy),
    sourceMapJson: serializePromptRuntimeExplainSourceMapEnvelope({
      snapshotVersion: snapshot.snapshotVersion,
      sourceMap: snapshot.sourceMap,
      governance: snapshot.governance,
      historyNormalization: snapshot.historyNormalization,
    }),
    diagnosticsJson: JSON.stringify(snapshot.diagnostics),
    trimReasonsJson: JSON.stringify(snapshot.trimReasons),
    excludedSourcesJson: JSON.stringify(snapshot.excludedSources),
    sectionStatsJson: JSON.stringify(snapshot.sectionStats),
    createdAt: snapshot.createdAt,
  };
}

function toToolExecutionInsert(record: ExecutedToolCallRecord): ToolExecutionInsert {
  return {
    id: record.id,
    runId: record.runId,
    floorId: record.floorId,
    deliveryMode: record.deliveryMode ?? "inline",
    runtimeJobId: record.runtimeJobId ?? null,
    pageId: record.pageId ?? null,
    callerSlot: record.callerSlot,
    providerId: record.providerId,
    providerType: record.providerType ?? "unknown",
    toolName: record.toolName,
    argsJson: record.argsJson,
    resultJson: record.resultJson,
    status: record.status,
    lifecycleState: record.lifecycleState ?? "finished",
    commitOutcome: record.commitOutcome ?? "pending",
    sideEffectLevel: record.sideEffectLevel ?? null,
    errorMessage: record.errorMessage ?? null,
    durationMs: record.durationMs,
    startedAt: record.startedAt ?? record.createdAt,
    finishedAt: record.finishedAt ?? record.createdAt,
    attemptNo: record.attemptNo ?? 1,
    replayParentExecutionId: record.replayParentExecutionId ?? null,
    createdAt: record.createdAt,
  };
}

function createEmptyVariableCommitResult(input: TurnCommitInput): TurnVariableCommitResult {
  return {
    pageId: input.variableCommit?.pageId,
    floorId: input.floorId,
    sessionId: input.sessionId,
    fromScope: "page",
    toScope: "floor",
    policy: input.variableCommit?.policy ?? "replace",
    scannedCount: 0,
    promotedCount: 0,
    skippedCount: 0,
    promotedVariables: [],
    pageVariables: [],
    stageWrites: [],
    promotionTraces: [],
  };
}

type TurnVariableCommitResult = VariablePromotionResult;

function toBufferedMutationFromMacro(
  mutation: StMacroStagedMutation,
  input: { sessionId: string; branchId: string },
  committedAt: number,
): BufferedToolVariableMutation | null {
  if (mutation.kind === "delete") {
    return null;
  }

  return {
    runId: `st-macro:${input.sessionId}`,
    generationAttemptNo: 1,
    scope: mutation.scope,
    scopeId: mutation.scope === "global"
      ? DEFAULT_GLOBAL_SCOPE_ID
      : buildBranchVariableScopeId(input.sessionId, input.branchId),
    key: mutation.key,
    value: mutation.value,
    bufferedAt: committedAt,
  };
}

type FloorCommitOperationRefInput = {
  floorId: string;
  runId: string | null;
  promptSnapshotPresent: boolean;
  explainSnapshotPresent: boolean;
  floorResultSnapshotPresent: boolean;
  toolExecutionCount: number;
  sessionStateMutationCount: number;
};

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFloorCommitOperationRef(input: FloorCommitOperationRefInput): Record<string, unknown> {
  return {
    floor_id: input.floorId,
    run_id: input.runId,
    prompt_snapshot_present: input.promptSnapshotPresent,
    explain_snapshot_present: input.explainSnapshotPresent,
    floor_result_snapshot_present: input.floorResultSnapshotPresent,
    tool_execution_count: input.toolExecutionCount,
    session_state_mutation_count: input.sessionStateMutationCount,
  };
}

function appendFloorCommitOperationLog(
  tx: DbExecutor,
  input: FloorCommitOperationRefInput & {
    accountId: string;
    sessionId: string;
    branchId: string;
    committedAt: number;
    operationLog?: TurnCommitOperationLogContext;
  },
): void {
  const afterRef = toFloorCommitOperationRef(input);
  new OperationLogService(tx).append({
    accountId: input.accountId,
    actorType: "llm",
    actorId: input.runId,
    operationGroupId: input.operationLog?.operationGroupId,
    requestId: input.operationLog?.requestId,
    sourceType: "llm_run",
    action: "commit_floor",
    status: "succeeded",
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    runId: input.runId,
    targetType: "floor",
    targetId: input.floorId,
    beforeRef: null,
    afterRef,
    diff: new VcDiffService().diff(null, afterRef),
    metadata: {
      ...(input.operationLog?.route ? { route: input.operationLog.route } : {}),
      prompt_snapshot_present: input.promptSnapshotPresent,
      explain_snapshot_present: input.explainSnapshotPresent,
      floor_result_snapshot_present: input.floorResultSnapshotPresent,
      tool_execution_count: input.toolExecutionCount,
      session_state_mutation_count: input.sessionStateMutationCount,
    },
    createdAt: input.committedAt,
  });
}

export class TurnCommitService {
  private readonly variableCommitService: VariableCommitService;
  private readonly enableAsyncMemoryIngest: boolean;
  private readonly memoryJobScheduler: MemoryJobScheduler;
  private readonly floorRunService?: FloorRunService;
  private readonly toolRuntimeJobBridge?: ToolRuntimeJobBridge;
  private readonly sessionStateService?: SessionStateService;
  private readonly floorStateMachine: FloorStateMachine;

  constructor(
    private readonly db: AppDb,
    private readonly messagePersistence: ChatMessagePersistence,
    private readonly eventBus: CoreEventBus,
    options: TurnCommitServiceOptions = {},
  ) {
    this.enableAsyncMemoryIngest = options.enableAsyncMemoryIngest === true;
    this.memoryJobScheduler = options.memoryJobScheduler ?? new MemoryJobScheduler({
      eventBus: this.eventBus,
    });
    this.variableCommitService = new VariableCommitService({
      db,
      mutationRuntime: options.mutationRuntime,
      eventBus: this.eventBus,
      accountMode: options.accountMode,
      defaultAccountId: options.defaultAccountId,
    });
    this.floorRunService = options.floorRunService;
    this.floorStateMachine = new FloorStateMachine(new DrizzleFloorRepository(db), this.eventBus);
    this.toolRuntimeJobBridge = options.toolRuntimeJobBridge;
    this.sessionStateService = options.sessionStateService;
  }

  private loadUserInputDigest(
    tx: DbExecutor,
    floorId: string,
    accountId: string,
    conversationInputSnapshot?: FloorConversationInputSnapshot,
  ): string {
    if (conversationInputSnapshot?.effectiveText) {
      return createUserInputDigest(conversationInputSnapshot.effectiveText);
    }

    const row = tx
      .select({ content: messages.content })
      .from(messages)
      .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(
        eq(floors.id, floorId),
        eq(sessions.accountId, accountId),
        eq(messagePages.pageKind, "input"),
        eq(messagePages.isActive, true),
        eq(messages.role, "user"),
      ))
      .limit(1)
      .all()[0];

    if (!row?.content) {
      throw new MemoryPersistError(`User input not found for floor '${floorId}'`);
    }

    return createUserInputDigest(row.content);
  }

  private enqueueIngestTurnJob(tx: DbExecutor, args: {
    accountId: string;
    sessionId: string;
    branchId?: string;
    floor: FloorEntity;
    assistantMessageId: string;
    pageId: string;
    committedAt: number;
    summaries: string[];
    enableConsolidation: boolean;
    conversationInputSnapshot?: FloorConversationInputSnapshot;
  }) {
    const userInputDigest = this.loadUserInputDigest(tx, args.floor.id, args.accountId, args.conversationInputSnapshot);
    return this.memoryJobScheduler.enqueueIngestTurn(tx, {
      accountId: args.accountId,
      sessionId: args.sessionId,
      floorId: args.floor.id,
      branchId: args.branchId,
      floorNo: args.floor.floorNo,
      assistantMessageId: args.assistantMessageId,
      pageId: args.pageId,
      userInputDigest,
      committedAt: args.committedAt,
      summaries: args.summaries,
      enableConsolidation: args.enableConsolidation,
      runtimeMode: "async_primary",
    });
  }

  async commit(input: TurnCommitInput): Promise<TurnCommitResult> {
    const committedAt = input.committedAt ?? Date.now();
    const usage = normalizeTokenUsage(input.execution.totalUsage);
    const actualToolExecutionRecords =
      input.toolExecutionRecords ?? input.execution.toolExecutionRecords ?? [];
    const actualToolExecutionRunIds = Array.from(
      new Set(actualToolExecutionRecords.map((record) => record.runId)));
    const effectiveRunId = normalizeNullableString(input.runId)
      ?? (actualToolExecutionRunIds.length === 1 ? normalizeNullableString(actualToolExecutionRunIds[0]) : null);
    const macroBufferedVariableMutations = (input.macroStagedMutations ?? [])
      .map((mutation) => toBufferedMutationFromMacro(mutation, {
        sessionId: input.sessionId,
        branchId: input.branchId ?? "main",
      }, committedAt))
      .filter((item): item is BufferedToolVariableMutation => item !== null);
    const toolBufferedVariableMutations =
      input.execution.bufferedVariableMutations ?? [];
    const pendingToolJobs =
      input.pendingToolJobs ?? input.execution.pendingToolJobs ?? [];
    const explicitLegacyToolCalls =
      input.toolCalls
      ?? input.execution.toolCalls
      ?? [];
    const hasPrimaryToolExecutionRecords = actualToolExecutionRecords.length > 0;
    const pendingEvents: PendingCoreEvent[] = [];
    const variableMutationBatch = this.variableCommitService.beginBatch();
    const effectiveBranchId = input.branchId ?? "main";

    this.variableCommitService.stageBufferedMutations(variableMutationBatch, {
      mutations: macroBufferedVariableMutations,
      committedAt,
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: effectiveBranchId,
    });
    for (const mutation of input.macroStagedMutations ?? []) {
      if (mutation.kind !== "delete") {
        continue;
      }
      this.variableCommitService.stageDeleteMutation(variableMutationBatch, {
        runId: `st-macro:${input.sessionId}`,
        generationAttemptNo: 1,
        scope: mutation.scope,
        scopeId: mutation.scope === "global"
          ? DEFAULT_GLOBAL_SCOPE_ID
          : buildBranchVariableScopeId(input.sessionId, effectiveBranchId),
        key: mutation.key,
        committedAt,
        accountId: input.accountId,
        sessionId: input.sessionId,
        branchId: effectiveBranchId,
      });
    }

    let transactionResult: {
      floor: FloorEntity;
      floorTransition: ReturnType<FloorStateMachine["completeTransition"]>;
      assistantMessage: { pageId: string; messageId: string };
      variableCommit: TurnVariableCommitResult;
      variableMutationApply: { runAfterCommit(): Promise<void> };
      memory?: TurnCommitMemoryReceipt;
    };
    try {
      transactionResult = this.db.transaction((tx) => {
        const assistantMessage = this.messagePersistence.saveAssistantMessageWithExecutor(
          tx,
          input.floorId,
          input.execution.generatedText,
          committedAt
        );

        const legacyToolCalls = hasPrimaryToolExecutionRecords
          ? projectLegacyToolCallRecords(actualToolExecutionRecords, { pageId: assistantMessage.pageId })
          : explicitLegacyToolCalls;

        if (legacyToolCalls.length > 0) {
          tx
            .insert(toolCallRecords)
            .values(
              legacyToolCalls.map((record, index) => ({
                id: record.id,
                pageId: hasPrimaryToolExecutionRecords ? record.pageId : assistantMessage.pageId,
                seq: record.seq > 0 ? record.seq : index + 1,
                callerSlot: record.callerSlot,
                toolName: record.toolName,
                argsJson: record.argsJson,
                resultJson: record.resultJson,
                status: record.status,
                durationMs: record.durationMs,
                createdAt: record.createdAt,
              }))
            )
            .run();
        }

        if (input.promptSnapshot) {
          const snapshot = toPromptSnapshotInsert(input.promptSnapshot);
          tx
            .insert(promptSnapshots)
            .values(snapshot)
            .onConflictDoUpdate({
              target: promptSnapshots.floorId,
              set: {
                sessionId: snapshot.sessionId,
                presetId: snapshot.presetId,
                presetUpdatedAt: snapshot.presetUpdatedAt,
                presetVersion: snapshot.presetVersion,
                presetVersionId: snapshot.presetVersionId,
                presetContentHash: snapshot.presetContentHash,
                worldbookId: snapshot.worldbookId,
                worldbookUpdatedAt: snapshot.worldbookUpdatedAt,
                worldbookVersion: snapshot.worldbookVersion,
                worldbookVersionId: snapshot.worldbookVersionId,
                worldbookContentHash: snapshot.worldbookContentHash,
                regexProfileId: snapshot.regexProfileId,
                regexProfileUpdatedAt: snapshot.regexProfileUpdatedAt,
                regexProfileVersion: snapshot.regexProfileVersion,
                regexProfileVersionId: snapshot.regexProfileVersionId,
                regexProfileContentHash: snapshot.regexProfileContentHash,
                worldbookActivatedEntryUidsJson: snapshot.worldbookActivatedEntryUidsJson,
                regexPreRuleNamesJson: snapshot.regexPreRuleNamesJson,
                regexPostRuleNamesJson: snapshot.regexPostRuleNamesJson,
                promptMode: snapshot.promptMode,
                promptDigest: snapshot.promptDigest,
                tokenEstimate: snapshot.tokenEstimate,
                createdAt: snapshot.createdAt,
              },
            })
            .run();
        }

        if (input.promptRuntimeInspection) {
          const inspectionSnapshot = toPromptRuntimeExplainSnapshotInsert({
            floorId: input.floorId,
            sessionId: input.sessionId,
            committedAt,
            inspection: input.promptRuntimeInspection,
          });
          tx
            .insert(promptRuntimeExplainSnapshots)
            .values(inspectionSnapshot)
            .onConflictDoUpdate({
              target: promptRuntimeExplainSnapshots.floorId,
              set: {
                sessionId: inspectionSnapshot.sessionId,
                targetBranchId: inspectionSnapshot.targetBranchId,
                sourceFloorId: inspectionSnapshot.sourceFloorId,
                historySourceBranchId: inspectionSnapshot.historySourceBranchId,
                historySourceMode: inspectionSnapshot.historySourceMode,
                memoryJson: inspectionSnapshot.memoryJson,
                snapshotVersion: inspectionSnapshot.snapshotVersion,
                assetsJson: inspectionSnapshot.assetsJson,
                resolvedPolicyJson: inspectionSnapshot.resolvedPolicyJson,
                sourceMapJson: inspectionSnapshot.sourceMapJson,
                diagnosticsJson: inspectionSnapshot.diagnosticsJson,
                trimReasonsJson: inspectionSnapshot.trimReasonsJson,
                excludedSourcesJson: inspectionSnapshot.excludedSourcesJson,
                sectionStatsJson: inspectionSnapshot.sectionStatsJson,
                createdAt: inspectionSnapshot.createdAt,
              },
            })
            .run();
        }

        if (actualToolExecutionRecords.length > 0) {
          tx
            .insert(toolExecutionRecords)
            .values(actualToolExecutionRecords.map(toToolExecutionInsert))
            .onConflictDoNothing()
            .run();
        }

        if (pendingToolJobs.length > 0) {
          if (!this.toolRuntimeJobBridge) {
            throw new Error("Tool runtime job bridge is not configured for deferred tool jobs");
          }

          for (const request of pendingToolJobs) {
            const enqueued = this.toolRuntimeJobBridge.enqueue(tx, request);
            tx
              .update(toolExecutionRecords)
              .set({ runtimeJobId: enqueued.jobId })
              .where(eq(toolExecutionRecords.id, request.executionId))
              .run();
          }
        }

        const variableMutationApply = variableMutationBatch.applyInTransaction(tx, {
          actor: { type: "system", id: "turn-commit-service" },
          requestId: `turn-commit:${input.floorId}`,
        });
        const stagedVariableWrites = new PageVariableStageService(tx).stageBufferedWrites({
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: effectiveBranchId,
          floorId: input.floorId,
          pageId: input.variableCommit?.pageId,
          mutations: toolBufferedVariableMutations,
          committedAt,
        });
        let variableCommit = createEmptyVariableCommitResult(input);
        let sessionStateMutationCount = 0;

        const floorRow = tx
          .select()
          .from(floors)
          .where(eq(floors.id, input.floorId))
          .limit(1)
          .all()[0];

        if (!floorRow) {
          throw new FloorNotFoundError(input.floorId);
        }

        let preparedFloorTransition: ReturnType<FloorStateMachine["prepareTransition"]>;
        try {
          preparedFloorTransition = this.floorStateMachine.prepareTransition(
            toFloorEntity(floorRow),
            "committed",
          );
        } catch (error) {
          if (error instanceof InvalidStateTransitionError) {
            throw new FloorStateConflictError(input.floorId, "generating", floorRow.state);
          }

          throw error;
        }

        const mergedFloorMetadataJson = mergeFloorMetadataConversationInput(
          floorRow.metadataJson,
          input.conversationInputSnapshot,
        );

        const updatedFloorRow = tx
          .update(floors)
          .set({
            metadataJson: mergedFloorMetadataJson,
            tokenIn: usage.promptTokens,
            tokenOut: usage.completionTokens,
            updatedAt: committedAt,
            state: preparedFloorTransition.newState,
          })
          .where(and(eq(floors.id, input.floorId), eq(floors.state, preparedFloorTransition.previousState)))
          .returning()
          .all()[0];

        if (!updatedFloorRow) {
          const currentRow = tx
            .select({ id: floors.id, state: floors.state })
            .from(floors)
            .where(eq(floors.id, input.floorId))
            .limit(1)
            .all()[0];

          if (!currentRow) {
            throw new FloorNotFoundError(input.floorId);
          }

          throw new FloorStateConflictError(input.floorId, preparedFloorTransition.previousState, currentRow.state);
        }

        const floorTransition = this.floorStateMachine.completeTransition(preparedFloorTransition, toFloorEntity(updatedFloorRow));

        if (input.supersedeSourceFloor) {
          const sourceFloorId = input.supersedeSourceFloor.floorId;
          const sourceRow = tx
            .select({
              id: floors.id,
              sessionId: floors.sessionId,
              state: floors.state,
              supersededAt: floors.supersededAt,
              supersededByFloorId: floors.supersededByFloorId,
            })
            .from(floors)
            .where(eq(floors.id, sourceFloorId))
            .limit(1)
            .all()[0];

          if (!sourceRow) {
            throw new SupersedeSourceFloorError(
              "supersede_source_floor_not_found",
              `Supersede source floor '${sourceFloorId}' not found`,
            );
          }

          if (sourceRow.sessionId !== input.sessionId) {
            throw new SupersedeSourceFloorError(
              "supersede_source_floor_session_mismatch",
              `Supersede source floor '${sourceFloorId}' does not belong to session '${input.sessionId}'`,
            );
          }

          if (sourceRow.state !== "committed") {
            throw new SupersedeSourceFloorError(
              "supersede_source_floor_not_committed",
              `Supersede source floor '${sourceFloorId}' must be committed, got '${sourceRow.state}'`,
            );
          }

          // 允许源楼层处于 regenerate() 的临时占位 supersede 状态。
          // 该占位阶段只会先写 superseded_at，用来绕过
          // `floor_session_no_branch_live_uq` 部分唯一索引；
          // 历史数据库里若 `superseded_by_floor_id` 仍带自引用外键，
          // 这里不能在 draft floor 创建前提前写入新 floor id。
          // 但若它已经被其他 replacement floor 正式 supersede，仍视为真实冲突。
          if (
            sourceRow.supersededAt !== null &&
            sourceRow.supersededByFloorId !== null &&
            sourceRow.supersededByFloorId !== input.floorId
          ) {
            throw new SupersedeSourceFloorError(
              "supersede_source_floor_already_superseded",
              `Supersede source floor '${sourceFloorId}' is already superseded by a different floor`,
            );
          }

          tx
            .update(floors)
            .set({
              supersededAt: committedAt,
              supersededByFloorId: input.floorId,
              updatedAt: committedAt,
            })
            .where(eq(floors.id, sourceFloorId))
            .run();
        }

        tx
          .insert(floorResultSnapshots)
          .values(
            toFloorResultSnapshotInsert({
              floorId: input.floorId,
              outputPageId: assistantMessage.pageId,
              assistantMessageId: assistantMessage.messageId,
              generatedText: input.execution.generatedText,
              summaries: input.execution.summaries,
              usage,
              verifierResult: input.execution.verifierResult,
              committedAt,
            })
          )
          .onConflictDoUpdate({
            target: floorResultSnapshots.floorId,
            set: {
              outputPageId: assistantMessage.pageId,
              assistantMessageId: assistantMessage.messageId,
              generatedText: input.execution.generatedText,
              summariesJson: JSON.stringify(input.execution.summaries),
              usageJson: JSON.stringify(usage),
              verifierJson: input.execution.verifierResult
                ? JSON.stringify({
                    status: input.execution.verifierResult.output.passed ? "passed" : "warned",
                    suggestion: input.execution.verifierResult.output.suggestion,
                    issues: input.execution.verifierResult.output.issues,
                  })
                : null,
              committedAt,
              updatedAt: committedAt,
            },
          })
          .run();

        variableCommit = new VariablePromotionService(tx).finalizePageWrites({
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: effectiveBranchId,
          floorId: input.floorId,
          pageId: input.variableCommit?.pageId,
          committedAt,
          pageDecision: input.variableCommit?.pageDecision,
          conflictPolicy: input.variableCommit?.policy === "ifAbsent" ? "if_absent" : "replace",
          stagedWrites: stagedVariableWrites,
        });

        if (this.sessionStateService) {
          const sessionStateApply = this.sessionStateService.applyStagedMutationsForFloor({
            accountId: input.accountId,
            sessionId: input.sessionId,
            branchId: effectiveBranchId,
            floorId: input.floorId,
            committedAt,
          }, tx);
          sessionStateMutationCount = sessionStateApply.mutations.length;
        }

        new BranchLocalVariableSnapshotService(tx).persistFloorLocalSnapshot({
          accountId: input.accountId,
          floorId: input.floorId,
          sessionId: input.sessionId,
          branchId: effectiveBranchId,
          createdAt: committedAt,
        });

        if (actualToolExecutionRunIds.length > 0) {
          tx
            .update(toolExecutionRecords)
            .set({ commitOutcome: "committed" })
            .where(actualToolExecutionRunIds.length === 1
              ? eq(toolExecutionRecords.runId, actualToolExecutionRunIds[0]!)
              : inArray(toolExecutionRecords.runId, actualToolExecutionRunIds))
            .run();
        }

        const floor = floorTransition.floor;
        let memory: TurnCommitMemoryReceipt | undefined;

        if (input.memoryCommit) {
          const defaultScope = input.branchId ? "branch" : "chat";
          const defaultScopeId = input.branchId ? buildBranchMemoryScopeId(input.sessionId, input.branchId) : input.sessionId;
          try {
            if (this.enableAsyncMemoryIngest) {
              const enqueuedMemory = this.enqueueIngestTurnJob(tx, {
                accountId: input.accountId,
                sessionId: input.sessionId,
                branchId: input.branchId,
                floor,
                assistantMessageId: assistantMessage.messageId,
                pageId: assistantMessage.pageId,
                committedAt,
                summaries: input.memoryCommit.summaries ?? [],
                enableConsolidation: input.memoryCommit.enableConsolidation === true,
                conversationInputSnapshot: input.conversationInputSnapshot,
              });
              memory = {
                mode: "async",
                status: "queued",
                jobId: enqueuedMemory.jobId,
              };
            } else {
              applyTransactionalMemoryMutations({
                tx,
                accountId: input.accountId,
                timestamp: committedAt,
                pendingEvents,
                summaries: input.memoryCommit.summaries,
                consolidationOutput: input.memoryCommit.consolidationOutput,
                defaultScope,
                defaultScopeId,
                scopeContext: { accountId: input.accountId, sessionId: input.sessionId, ...(input.branchId ? { branchId: input.branchId } : {}), floorId: input.floorId },
                sourceFloorId: input.floorId,
                sourceMessageId: assistantMessage.messageId,
              });
              memory = {
                mode: "sync",
                status: "applied",
              };
            }
          } catch (error) {
            throw new MemoryPersistError(`Memory persist failed: ${normalizeError(error).message}`, error);
          }
        }

        appendFloorCommitOperationLog(tx, {
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: effectiveBranchId,
          floorId: input.floorId,
          runId: effectiveRunId,
          promptSnapshotPresent: Boolean(input.promptSnapshot),
          explainSnapshotPresent: Boolean(input.promptRuntimeInspection),
          floorResultSnapshotPresent: true,
          toolExecutionCount: actualToolExecutionRecords.length,
          sessionStateMutationCount,
          committedAt,
          operationLog: input.operationLog,
        });

        return {
          floor,
          floorTransition,
          assistantMessage,
          variableCommit,
          variableMutationApply,
          ...(memory ? { memory } : {}),
        };
      });
    } catch (error) {
      if (error instanceof MemoryPersistError) {
        try {
          await this.eventBus.emit("memory.persist_failed", {
            sessionId: input.sessionId,
            scope: input.branchId ? "branch" : "chat",
            scopeId: input.branchId ? buildBranchMemoryScopeId(input.sessionId, input.branchId) : input.sessionId,
            floorId: input.floorId,
            error: normalizeError(error.cause ?? error),
          });
        } catch {
          // best-effort
        }
      }

      throw error;
    }

    try {
      await this.floorRunService?.advancePhase(input.floorId, "transaction_committed");
    } catch {
      // best-effort
    }

    await transactionResult.variableMutationApply.runAfterCommit();
    await this.emitPostCommitEvents(
      transactionResult.floorTransition,
      transactionResult.variableCommit,
      pendingEvents,
    );

    try {
      await this.floorRunService?.advancePhase(input.floorId, "post_commit_scheduled");
    } catch {
      // best-effort
    }

    try {
      await this.floorRunService?.markCompleted(input.floorId);
    } catch {
      // best-effort
    }

    return {
      floorId: input.floorId,
      outputPageId: transactionResult.assistantMessage.pageId,
      assistantMessageId: transactionResult.assistantMessage.messageId,
      finalState: "committed",
      usage,
      memory: transactionResult.memory,
    };
  }

  private async emitPostCommitEvents(
    floorTransition: ReturnType<FloorStateMachine["completeTransition"]>,
    variableCommit: TurnVariableCommitResult,
    pendingEvents: PendingCoreEvent[],
  ): Promise<void> {
    for (const materialized of variableCommit.pageVariables) {
      try {
        await this.eventBus.emit("variable.set", {
          sessionId: floorTransition.floor.sessionId,
          branchId: floorTransition.floor.branchId,
          entry: materialized.entry,
          isNew: materialized.isNew,
        });
      } catch {
        // best-effort
      }
    }

    await emitPendingCoreEvents(this.eventBus, pendingEvents);

    try {
      await this.floorStateMachine.emitTransitionEvents(floorTransition, {
        promotedVariables: variableCommit.promotedVariables,
      });
    } catch {
      // best-effort
    }

    for (const variable of variableCommit.promotedVariables) {
      try {
        await this.eventBus.emit("variable.promoted", {
          sessionId: floorTransition.floor.sessionId,
          branchId: floorTransition.floor.branchId,
          key: variable.key,
          fromScope: variableCommit.fromScope,
          toScope: variableCommit.toScope,
          value: variable.value,
        });
      } catch {
        // best-effort
      }
    }
  }
}
