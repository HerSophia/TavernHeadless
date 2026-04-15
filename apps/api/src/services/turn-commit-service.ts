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
} from "./variable-commit-service.js";
import { VARIABLE_MUTATION_KINDS } from "./variable-mutation-applier.js";
import type { MutationRuntime } from "./runtime-mutation-types.js";
import type { ToolRuntimeJobBridge } from "./tool-runtime-job-bridge.js";
import type { FloorRunService } from "./floor-run-service.js";
import type { StMacroStagedMutation } from "./st-macros/index.js";
import {
  buildBranchMemoryScopeId,
  buildBranchVariableScopeId,
} from "@tavern/shared";
import { DEFAULT_GLOBAL_SCOPE_ID } from "./variable-host-service.js";
import { BranchLocalVariableSnapshotService } from "./branch-local-variable-snapshot-service.js";
import {
  buildPromptRuntimeCommittedExplainSnapshot,
  type PromptRuntimeInspectionResult,
} from "./prompt-runtime-control-service.js";

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
  toolCalls?: ToolCallRecord[];
  toolExecutionRecords?: ExecutedToolCallRecord[];
  pendingToolJobs?: PendingToolJobRequest[];
  variableCommit?: VariableCommitOptions;
  memoryCommit?: MemoryCommitInput;
  macroStagedMutations?: StMacroStagedMutation[];
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
}

class MemoryPersistError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "MemoryPersistError";
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
    worldbookId: record.worldbookId,
    worldbookUpdatedAt: record.worldbookUpdatedAt,
    worldbookVersion: record.worldbookVersion,
    regexProfileId: record.regexProfileId,
    regexProfileUpdatedAt: record.regexProfileUpdatedAt,
    regexProfileVersion: record.regexProfileVersion,
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
    snapshotVersion: snapshot.snapshotVersion,
    assetsJson: JSON.stringify(snapshot.assets),
    resolvedPolicyJson: JSON.stringify(snapshot.resolvedPolicy),
    sourceMapJson: JSON.stringify(snapshot.sourceMap),
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

function toLegacyToolCallRecord(
  record: ExecutedToolCallRecord,
  seq: number
): ToolCallRecord {
  let status: ToolCallRecord["status"];
  if (record.status === "success") {
    status = "success";
  } else if (record.status === "denied" || record.status === "blocked") {
    status = "denied";
  } else if (record.status === "queued" || record.status === "running") {
    status = record.status;
  } else {
    status = "error";
  }

  return {
    id: record.id,
    pageId: record.pageId ?? "",
    seq,
    callerSlot: record.callerSlot,
    toolName: record.toolName,
    argsJson: record.argsJson,
    resultJson: record.resultJson,
    status,
    durationMs: record.durationMs,
    createdAt: record.createdAt,
  };
}

function createEmptyVariableCommitResult(input: TurnCommitInput): ReturnType<VariableCommitService["promoteAll"]> {
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
  };
}

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

export class TurnCommitService {
  private readonly variableCommitService: VariableCommitService;
  private readonly enableAsyncMemoryIngest: boolean;
  private readonly memoryJobScheduler: MemoryJobScheduler;
  private readonly floorRunService?: FloorRunService;
  private readonly toolRuntimeJobBridge?: ToolRuntimeJobBridge;
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
  }

  private loadUserInputDigest(tx: DbExecutor, floorId: string, accountId: string): string {
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
    committedAt: number;
    summaries: string[];
    enableConsolidation: boolean;
  }) {
    const userInputDigest = this.loadUserInputDigest(tx, args.floor.id, args.accountId);
    return this.memoryJobScheduler.enqueueIngestTurn(tx, {
      accountId: args.accountId,
      sessionId: args.sessionId,
      floorId: args.floor.id,
      branchId: args.branchId,
      floorNo: args.floor.floorNo,
      assistantMessageId: args.assistantMessageId,
      userInputDigest,
      committedAt: args.committedAt,
      summaries: args.summaries,
      enableConsolidation: args.enableConsolidation,
    });
  }

  async commit(input: TurnCommitInput): Promise<TurnCommitResult> {
    const committedAt = input.committedAt ?? Date.now();
    const usage = normalizeTokenUsage(input.execution.totalUsage);
    const actualToolExecutionRecords =
      input.toolExecutionRecords ?? input.execution.toolExecutionRecords ?? [];
    const actualToolExecutionRunIds = Array.from(
      new Set(actualToolExecutionRecords.map((record) => record.runId)));
    const macroBufferedMutations = (input.macroStagedMutations ?? [])
      .map((mutation) => toBufferedMutationFromMacro(mutation, {
        sessionId: input.sessionId,
        branchId: input.branchId ?? "main",
      }, committedAt))
      .filter((item): item is BufferedToolVariableMutation => item !== null);
    const actualBufferedVariableMutations = [
      ...(input.execution.bufferedVariableMutations ?? []),
      ...macroBufferedMutations,
    ];
    const pendingToolJobs =
      input.pendingToolJobs ?? input.execution.pendingToolJobs ?? [];
    const legacyToolCalls =
      input.toolCalls
      ?? input.execution.toolCalls
      ?? actualToolExecutionRecords.map((record, index) => toLegacyToolCallRecord(record, index + 1));
    const pendingEvents: PendingCoreEvent[] = [];
    const variableMutationBatch = this.variableCommitService.beginBatch();

    this.variableCommitService.stageBufferedMutations(variableMutationBatch, {
      mutations: actualBufferedVariableMutations,
      committedAt,
      accountId: input.accountId,
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
          : buildBranchVariableScopeId(input.sessionId, input.branchId ?? "main"),
        key: mutation.key,
        committedAt,
        accountId: input.accountId,
        sessionId: input.sessionId,
        branchId: input.branchId ?? "main",
      });
    }
    this.variableCommitService.stagePromotion(variableMutationBatch, {
      accountId: input.accountId,
      pageId: input.variableCommit?.pageId,
      floorId: input.floorId,
      sessionId: input.sessionId,
      policy: input.variableCommit?.policy,
      committedAt,
    });

    let transactionResult: {
      floor: FloorEntity;
      floorTransition: ReturnType<FloorStateMachine["completeTransition"]>;
      assistantMessage: { pageId: string; messageId: string };
      variableCommit: ReturnType<VariableCommitService["promoteAll"]>;
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

        if (legacyToolCalls.length > 0) {
          tx
            .insert(toolCallRecords)
            .values(
              legacyToolCalls.map((record, index) => ({
                id: record.id,
                pageId: assistantMessage.pageId,
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
                worldbookId: snapshot.worldbookId,
                worldbookUpdatedAt: snapshot.worldbookUpdatedAt,
                worldbookVersion: snapshot.worldbookVersion,
                regexProfileId: snapshot.regexProfileId,
                regexProfileUpdatedAt: snapshot.regexProfileUpdatedAt,
                regexProfileVersion: snapshot.regexProfileVersion,
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
        const variableCommit = variableMutationApply.mutations.find(
          (mutation: (typeof variableMutationApply.mutations)[number]) => mutation.envelope.kind === VARIABLE_MUTATION_KINDS.promotePageToFloor,
        )?.result as ReturnType<VariableCommitService["promoteAll"]> | undefined
          ?? createEmptyVariableCommitResult(input);

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

        const updatedFloorRow = tx
          .update(floors)
          .set({
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

        new BranchLocalVariableSnapshotService(tx).persistFloorLocalSnapshot({
          accountId: input.accountId,
          floorId: input.floorId,
          sessionId: input.sessionId,
          branchId: input.branchId ?? "main",
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
                committedAt,
                summaries: input.memoryCommit.summaries ?? [],
                enableConsolidation: input.memoryCommit.enableConsolidation === true,
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
            sourceJobId: this.enableAsyncMemoryIngest ? `memory-job:ingest_turn:${input.floorId}` : undefined,
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
    variableCommit: ReturnType<VariableCommitService["promoteAll"]>,
    pendingEvents: PendingCoreEvent[],
  ): Promise<void> {
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
