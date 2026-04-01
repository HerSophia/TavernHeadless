import { and, eq, inArray } from "drizzle-orm";
import type {
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
  FloorNotFoundError,
  FloorStateConflictError,
} from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  floors,
  messagePages,
  messages,
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

type FloorRow = typeof floors.$inferSelect;

type PromptSnapshotInsert = typeof promptSnapshots.$inferInsert;
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
  execution: TurnExecutionResult;
  committedAt?: number;
  promptSnapshot?: PromptSnapshotRecord;
  toolCalls?: ToolCallRecord[];
  toolExecutionRecords?: ExecutedToolCallRecord[];
  pendingToolJobs?: PendingToolJobRequest[];
  variableCommit?: VariableCommitOptions;
  memoryCommit?: MemoryCommitInput;
}

export interface TurnCommitResult {
  floorId: string;
  outputPageId: string;
  assistantMessageId: string;
  finalState: "committed";
  usage: TokenUsage;
}

export interface TurnCommitServiceOptions {
  enableAsyncMemoryIngest?: boolean;
  memoryJobScheduler?: MemoryJobScheduler;
  mutationRuntime?: MutationRuntime;
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
  if (record.status === "success" || record.status === "queued") {
    status = "success";
  } else if (record.status === "denied" || record.status === "blocked") {
    status = "denied";
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

export class TurnCommitService {
  private readonly variableCommitService: VariableCommitService;
  private readonly enableAsyncMemoryIngest: boolean;
  private readonly memoryJobScheduler: MemoryJobScheduler;
  private readonly toolRuntimeJobBridge?: ToolRuntimeJobBridge;

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
    });
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
    floor: FloorEntity;
    assistantMessageId: string;
    committedAt: number;
    summaries: string[];
    enableConsolidation: boolean;
  }): void {
    const userInputDigest = this.loadUserInputDigest(tx, args.floor.id, args.accountId);
    this.memoryJobScheduler.enqueueIngestTurn(tx, {
      accountId: args.accountId,
      sessionId: args.sessionId,
      floorId: args.floor.id,
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
    const actualBufferedVariableMutations =
      input.execution.bufferedVariableMutations ?? [];
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
      assistantMessage: { pageId: string; messageId: string };
      variableCommit: ReturnType<VariableCommitService["promoteAll"]>;
      variableMutationApply: { runAfterCommit(): Promise<void> };
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
          (mutation) => mutation.envelope.kind === VARIABLE_MUTATION_KINDS.promotePageToFloor,
        )?.result as ReturnType<VariableCommitService["promoteAll"]> | undefined
          ?? createEmptyVariableCommitResult(input);

        const updateResult = tx
          .update(floors)
          .set({
            tokenIn: usage.promptTokens,
            tokenOut: usage.completionTokens,
            updatedAt: committedAt,
            state: "committed",
          })
          .where(and(eq(floors.id, input.floorId), eq(floors.state, "generating")))
          .run();

        if (updateResult.changes !== 1) {
          const currentRow = tx
            .select({ id: floors.id, state: floors.state })
            .from(floors)
            .where(eq(floors.id, input.floorId))
            .limit(1)
            .all()[0];

          if (!currentRow) {
            throw new FloorNotFoundError(input.floorId);
          }

          throw new FloorStateConflictError(input.floorId, "generating", currentRow.state);
        }

        if (actualToolExecutionRunIds.length > 0) {
          tx
            .update(toolExecutionRecords)
            .set({ commitOutcome: "committed" })
            .where(actualToolExecutionRunIds.length === 1
              ? eq(toolExecutionRecords.runId, actualToolExecutionRunIds[0]!)
              : inArray(toolExecutionRecords.runId, actualToolExecutionRunIds))
            .run();
        }

        const floorRow = tx
          .select()
          .from(floors)
          .where(eq(floors.id, input.floorId))
          .limit(1)
          .all()[0];

        if (!floorRow) {
          throw new FloorNotFoundError(input.floorId);
        }

        const floor = toFloorEntity(floorRow);

        if (input.memoryCommit) {
          try {
            if (this.enableAsyncMemoryIngest) {
              this.enqueueIngestTurnJob(tx, {
                accountId: input.accountId,
                sessionId: input.sessionId,
                floor,
                assistantMessageId: assistantMessage.messageId,
                committedAt,
                summaries: input.memoryCommit.summaries ?? [],
                enableConsolidation: input.memoryCommit.enableConsolidation === true,
              });
            } else {
              applyTransactionalMemoryMutations({
                tx,
                accountId: input.accountId,
                timestamp: committedAt,
                pendingEvents,
                summaries: input.memoryCommit.summaries,
                consolidationOutput: input.memoryCommit.consolidationOutput,
                defaultScope: "chat",
                defaultScopeId: input.sessionId,
                scopeContext: { accountId: input.accountId, sessionId: input.sessionId, floorId: input.floorId },
                sourceFloorId: input.floorId,
                sourceMessageId: assistantMessage.messageId,
              });
            }
          } catch (error) {
            throw new MemoryPersistError(`Memory persist failed: ${normalizeError(error).message}`, error);
          }
        }

        return {
          floor,
          assistantMessage,
          variableCommit,
          variableMutationApply,
        };
      });
    } catch (error) {
      if (error instanceof MemoryPersistError) {
        try {
          await this.eventBus.emit("memory.persist_failed", {
            sessionId: input.sessionId,
            scope: "chat",
            scopeId: input.sessionId,
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

    await transactionResult.variableMutationApply.runAfterCommit();
    await this.emitPostCommitEvents(
      transactionResult.floor,
      transactionResult.variableCommit,
      pendingEvents
    );

    return {
      floorId: input.floorId,
      outputPageId: transactionResult.assistantMessage.pageId,
      assistantMessageId: transactionResult.assistantMessage.messageId,
      finalState: "committed",
      usage,
    };
  }

  private async emitPostCommitEvents(
    floor: FloorEntity,
    variableCommit: ReturnType<VariableCommitService["promoteAll"]>,
    pendingEvents: PendingCoreEvent[],
  ): Promise<void> {
    await emitPendingCoreEvents(this.eventBus, pendingEvents);

    try {
      await this.eventBus.emit("floor.stateChanged", {
        floor,
        previousState: "generating",
        newState: "committed",
      });
    } catch {
      // best-effort
    }

    try {
      await this.eventBus.emit("floor.committed", {
        floor,
        promotedVariables: variableCommit.promotedVariables,
      });
    } catch {
      // best-effort
    }

    for (const variable of variableCommit.promotedVariables) {
      try {
        await this.eventBus.emit("variable.promoted", {
          sessionId: floor.sessionId,
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
