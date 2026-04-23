import { and, asc, desc, eq } from "drizzle-orm";
import type {
  CoreEventBus,
  CoreEventMap,
  MemoryCompactionOutput,
  MemoryCompactionProcessor,
  MemoryIngestOutput,
  MemoryIngestProcessor,
  MemoryItem,
  MemoryStore,
} from "@tavern/core";
import { MemoryCompactionPlanner, MemoryScopeResolver } from "@tavern/core";
import {
  buildBranchMemoryScopeId,
  parseBranchMemoryScopeId,
  type MemoryJobType,
  type MemoryScope,
} from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  floors,
  memoryItems,
  messagePages,
  messages,
  sessions,
} from "../db/schema.js";
import { createUserInputDigest } from "./memory-job-utils.js";
import {
  applyTransactionalMemoryMutations,
  emitPendingCoreEvents,
  type PendingCoreEvent,
} from "./memory-transaction-mutations.js";
import {
  MemoryMaintenanceService,
  type MemoryMaintenanceRunResult,
} from "./memory-maintenance-service.js";
import { RuntimeJobFatalError } from "./runtime-job-errors.js";
import { RuntimeJobProcessorRegistry } from "./runtime-job-processor-registry.js";
import type {
  RuntimeJobCommitResult,
  RuntimeJobProcessor,
  RuntimeScopeRef,
} from "./runtime-job-types.js";
import {
  MEMORY_RUNTIME_JOB_TYPES,
  type MemoryCompactMacroJobPayload,
  type MemoryIngestTurnJobPayload,
  type MemoryMaintenanceJobPayload,
  type MemoryRebuildScopeJobPayload,
  type MemoryRuntimeScopeMetadata,
  buildMemoryRuntimeScopeKey,
  readMemoryRuntimeScopeMetadata,
} from "./memory-runtime-job-definitions.js";
import { MemoryJobScheduler } from "./memory-job-scheduler.js";

interface IngestTurnProcessingContext {
  userMessage: string;
  assistantMessage: string;
  currentFloorContent: string;
  extractedSummaries: string[];
  recentSummaries: Awaited<ReturnType<MemoryStore["query"]>>;
  existingFacts: Awaited<ReturnType<MemoryStore["query"]>>;
  existingOpenLoops: Awaited<ReturnType<MemoryStore["query"]>>;
  branchId?: string;
  scope: MemoryScope;
  scopeId: string;
}

interface CompactMacroProcessingContext {
  sourceMicroSummaries: MemoryItem[];
  latestMacroSummary?: MemoryItem;
  existingFacts: Awaited<ReturnType<MemoryStore["query"]>>;
  existingOpenLoops: Awaited<ReturnType<MemoryStore["query"]>>;
}

interface CompactMacroEnqueueArgs {
  accountId: string;
  scope: MemoryScope;
  scopeId: string;
  triggerFloorId?: string;
  committedAt: number;
  lastProcessedFloorNo?: number | null;
  force?: boolean;
}

export interface MemoryRuntimeProcessorDependencies {
  db: AppDb;
  memoryStore: MemoryStore;
  memoryIngestProcessor: MemoryIngestProcessor;
  memoryCompactionProcessor: MemoryCompactionProcessor;
  eventBus: CoreEventBus;
  enableMacroCompaction: boolean;
}

const visibleScopeResolver = new MemoryScopeResolver();

function normalizeBranchId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveDefaultMemoryScope(args: { sessionId: string; branchId?: string }): { scope: MemoryScope; scopeId: string } {
  const branchId = normalizeBranchId(args.branchId);
  if (branchId) {
    return {
      scope: "branch",
      scopeId: buildBranchMemoryScopeId(args.sessionId, branchId),
    };
  }

  return {
    scope: "chat",
    scopeId: args.sessionId,
  };
}

function resolveMemoryJobSessionId(
  scope: MemoryScope,
  scopeId: string,
  sessionId?: string,
): string | undefined {
  if (scope === "chat") {
    return scopeId;
  }

  if (scope === "branch") {
    return parseBranchMemoryScopeId(scopeId)?.sessionId ?? sessionId;
  }

  return sessionId;
}

function resolveMemoryJobFloorId(
  scope: MemoryScope,
  scopeId: string,
  floorId?: string | null,
): string | undefined {
  if (typeof floorId === "string" && floorId.length > 0) {
    return floorId;
  }

  return scope === "floor" ? scopeId : undefined;
}

function buildMemoryJobEventContext(args: {
  scope: MemoryScope;
  scopeId: string;
  sessionId?: string;
  floorId?: string | null;
  sourceJobId?: string;
  jobType?: MemoryJobType;
}) {
  const sessionId = resolveMemoryJobSessionId(args.scope, args.scopeId, args.sessionId);
  const floorId = resolveMemoryJobFloorId(args.scope, args.scopeId, args.floorId);
  return {
    ...(sessionId ? { sessionId } : {}),
    scope: args.scope,
    scopeId: args.scopeId,
    ...(floorId ? { floorId } : {}),
    ...(args.sourceJobId ? { sourceJobId: args.sourceJobId } : {}),
    ...(args.jobType ? { jobType: args.jobType } : {}),
  };
}

function buildCurrentFloorContent(userMessage: string, assistantMessage: string): string {
  const parts = [`User:\n${userMessage.trim()}`];
  if (assistantMessage.trim()) {
    parts.push(`Assistant:\n${assistantMessage.trim()}`);
  }
  return parts.join("\n\n");
}

function parseMemoryContent(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson);
    if (typeof parsed === "string") {
      return parsed;
    }
    if (typeof parsed === "object" && parsed !== null && typeof parsed.text === "string") {
      return parsed.text;
    }
    return contentJson;
  } catch {
    return contentJson;
  }
}

function toMemoryItem(row: typeof memoryItems.$inferSelect): MemoryItem {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    type: row.type,
    summaryTier: row.summaryTier ?? undefined,
    content: parseMemoryContent(row.contentJson),
    factKey: row.factKey ?? undefined,
    importance: row.importance,
    confidence: row.confidence,
    sourceFloorId: row.sourceFloorId ?? undefined,
    sourceMessageId: row.sourceMessageId ?? undefined,
    status: row.status,
    lifecycleStatus: row.lifecycleStatus ?? undefined,
    sourceJobId: row.sourceJobId ?? undefined,
    tokenCountEstimate: row.tokenCountEstimate ?? undefined,
    lastUsedAt: row.lastUsedAt ?? undefined,
    coverageStartFloorNo: row.coverageStartFloorNo ?? undefined,
    coverageEndFloorNo: row.coverageEndFloorNo ?? undefined,
    derivedFromCount: row.derivedFromCount ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function emitBestEffortEvent<K extends keyof CoreEventMap>(
  eventBus: CoreEventBus,
  name: K,
  payload: CoreEventMap[K],
): Promise<void> {
  try {
    await eventBus.emit(name as never, payload as never);
  } catch {
    // 观测类事件不应反向影响作业处理。
  }
}

async function loadUserMessage(db: AppDb, floorId: string, accountId: string): Promise<string> {
  const [row] = await db
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
    .orderBy(asc(messages.seq))
    .limit(1);

  if (typeof row?.content !== "string" || row.content.trim().length === 0) {
    throw new RuntimeJobFatalError(`User message not found for floor '${floorId}'`);
  }

  return row.content;
}

async function loadAssistantMessage(db: AppDb, messageId: string, accountId: string): Promise<string> {
  const [row] = await db
    .select({ content: messages.content })
    .from(messages)
    .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
    .innerJoin(floors, eq(messagePages.floorId, floors.id))
    .innerJoin(sessions, eq(floors.sessionId, sessions.id))
    .where(and(
      eq(messages.id, messageId),
      eq(messages.role, "assistant"),
      eq(sessions.accountId, accountId),
    ))
    .limit(1);

  if (typeof row?.content !== "string") {
    throw new RuntimeJobFatalError(`Assistant message not found for message '${messageId}'`);
  }

  return row.content;
}

async function loadFloorScopeContext(
  db: AppDb,
  floorId: string,
  accountId: string,
): Promise<{ sessionId: string; branchId: string }> {
  const [row] = await db
    .select({ sessionId: floors.sessionId, branchId: floors.branchId })
    .from(floors)
    .innerJoin(sessions, eq(floors.sessionId, sessions.id))
    .where(and(
      eq(floors.id, floorId),
      eq(sessions.accountId, accountId),
    ))
    .limit(1);

  if (!row?.sessionId || !row.branchId) {
    throw new RuntimeJobFatalError(`Floor scope context not found for floor '${floorId}'`);
  }

  return row;
}

async function loadIngestContext(
  deps: MemoryRuntimeProcessorDependencies,
  payload: MemoryIngestTurnJobPayload,
  sourceJobId: string,
): Promise<IngestTurnProcessingContext> {
  const fallbackScopeRef = resolveDefaultMemoryScope({
    sessionId: payload.sessionId,
    branchId: payload.branchId,
  });
  try {
    const [floorScopeContext, userMessage, assistantMessage] = await Promise.all([
      loadFloorScopeContext(deps.db, payload.floorId, payload.accountId),
      loadUserMessage(deps.db, payload.floorId, payload.accountId),
      loadAssistantMessage(deps.db, payload.assistantMessageId, payload.accountId),
    ]);

    const branchId = normalizeBranchId(payload.branchId) ?? floorScopeContext.branchId;
    const scopeRef = resolveDefaultMemoryScope({
      sessionId: payload.sessionId,
      branchId,
    });
    const scopeRefs = visibleScopeResolver.resolveVisibleRefs({
      accountId: payload.accountId,
      sessionId: payload.sessionId,
      branchId,
      floorId: payload.floorId,
    });

    const [recentSummaries, existingFacts, existingOpenLoops] = await Promise.all([
      deps.memoryStore.query({
        scopeRefs,
        accountId: payload.accountId,
        type: "summary",
        status: "active",
        lifecycleStatus: "active",
        orderBy: "updatedAt",
        orderDir: "desc",
        limit: 20,
      }),
      deps.memoryStore.query({
        scopeRefs,
        accountId: payload.accountId,
        type: "fact",
        status: "active",
        lifecycleStatus: "active",
        orderBy: "importance",
        orderDir: "desc",
        limit: 50,
      }),
      deps.memoryStore.query({
        scopeRefs,
        accountId: payload.accountId,
        type: "open_loop",
        status: "active",
        lifecycleStatus: "active",
        orderBy: "updatedAt",
        orderDir: "desc",
        limit: 25,
      }),
    ]);

    return {
      userMessage,
      assistantMessage,
      currentFloorContent: buildCurrentFloorContent(userMessage, assistantMessage),
      extractedSummaries: payload.summaries.map((summary) => summary.trim()).filter((summary) => summary.length > 0),
      recentSummaries,
      existingFacts,
      ...(branchId ? { branchId } : {}),
      scope: scopeRef.scope,
      scopeId: scopeRef.scopeId,
      existingOpenLoops,
    };
  } catch (error) {
    await emitBestEffortEvent(deps.eventBus, "memory.consolidation_context_failed", {
      ...buildMemoryJobEventContext({
        scope: fallbackScopeRef.scope,
        scopeId: fallbackScopeRef.scopeId,
        sessionId: payload.sessionId,
        floorId: payload.floorId,
        sourceJobId,
        jobType: "ingest_turn",
      }),
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

async function loadCompactionContext(
  deps: MemoryRuntimeProcessorDependencies,
  payload: MemoryCompactMacroJobPayload,
  sourceJobId: string,
): Promise<CompactMacroProcessingContext> {
  try {
    const [activeSummaries, existingFacts, existingOpenLoops] = await Promise.all([
      deps.memoryStore.query({
        scope: payload.scope,
        scopeId: payload.scopeId,
        accountId: payload.accountId,
        type: "summary",
        status: "active",
        lifecycleStatus: "active",
        orderBy: "updatedAt",
        orderDir: "desc",
        limit: 200,
      }),
      deps.memoryStore.query({
        scope: payload.scope,
        scopeId: payload.scopeId,
        accountId: payload.accountId,
        type: "fact",
        status: "active",
        lifecycleStatus: "active",
        orderBy: "importance",
        orderDir: "desc",
        limit: 50,
      }),
      deps.memoryStore.query({
        scope: payload.scope,
        scopeId: payload.scopeId,
        accountId: payload.accountId,
        type: "open_loop",
        status: "active",
        lifecycleStatus: "active",
        orderBy: "updatedAt",
        orderDir: "desc",
        limit: 25,
      }),
    ]);

    const sourceIdSet = new Set(payload.sourceMicroIds);
    const sourceMicroSummaries = activeSummaries
      .filter((item) => item.summaryTier !== "macro" && sourceIdSet.has(item.id))
      .sort((left, right) => {
        const leftFloor = left.coverageEndFloorNo ?? left.coverageStartFloorNo ?? left.updatedAt;
        const rightFloor = right.coverageEndFloorNo ?? right.coverageStartFloorNo ?? right.updatedAt;
        if (leftFloor !== rightFloor) {
          return leftFloor - rightFloor;
        }
        return left.id.localeCompare(right.id);
      });
    const latestMacroSummary = activeSummaries.find((item) => item.summaryTier === "macro");

    return {
      sourceMicroSummaries,
      ...(latestMacroSummary ? { latestMacroSummary } : {}),
      existingFacts,
      existingOpenLoops,
    };
  } catch (error) {
    await emitBestEffortEvent(deps.eventBus, "memory.consolidation_context_failed", {
      ...buildMemoryJobEventContext({
        scope: payload.scope,
        scopeId: payload.scopeId,
        sessionId: payload.sessionId,
        floorId: payload.triggerFloorId,
        sourceJobId,
        jobType: "compact_macro",
      }),
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

async function runIngestProcessor(
  deps: MemoryRuntimeProcessorDependencies,
  payload: MemoryIngestTurnJobPayload,
  context: IngestTurnProcessingContext,
  sourceJobId: string,
): Promise<MemoryIngestOutput> {
  try {
    const result = await deps.memoryIngestProcessor.process({
      currentFloorContent: context.currentFloorContent,
      extractedSummaries: context.extractedSummaries,
      recentSummaries: context.recentSummaries,
      existingFacts: context.existingFacts,
      existingOpenLoops: context.existingOpenLoops,
      scope: context.scope,
      scopeId: context.scopeId,
      sourceFloorId: payload.floorId,
    });

    if (result.degraded?.reason === "json_parse_failed") {
      await emitBestEffortEvent(deps.eventBus, "memory.consolidation_json_parse_failed", {
        ...buildMemoryJobEventContext({
          scope: context.scope,
          scopeId: context.scopeId,
          sessionId: payload.sessionId,
          floorId: payload.floorId,
          sourceJobId,
          jobType: "ingest_turn",
        }),
        rawText: result.degraded.rawText,
        error: result.degraded.error,
      });
    }

    return result.output;
  } catch (error) {
    await emitBestEffortEvent(deps.eventBus, "memory.consolidation_failed", {
      ...buildMemoryJobEventContext({
        scope: context.scope,
        scopeId: context.scopeId,
        sessionId: payload.sessionId,
        floorId: payload.floorId,
        sourceJobId,
        jobType: "ingest_turn",
      }),
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

async function runCompactionProcessor(
  deps: MemoryRuntimeProcessorDependencies,
  payload: MemoryCompactMacroJobPayload,
  context: CompactMacroProcessingContext,
  sourceJobId: string,
): Promise<MemoryCompactionOutput> {
  const eventContext = buildMemoryJobEventContext({
    scope: payload.scope,
    scopeId: payload.scopeId,
    sessionId: payload.sessionId,
    floorId: payload.triggerFloorId,
    sourceJobId,
    jobType: "compact_macro",
  });

  try {
    const result = await deps.memoryCompactionProcessor.process({
      sourceMicroSummaries: context.sourceMicroSummaries,
      latestMacroSummary: context.latestMacroSummary,
      existingFacts: context.existingFacts,
      existingOpenLoops: context.existingOpenLoops,
      scope: payload.scope,
      scopeId: payload.scopeId,
    });

    if (result.degraded?.reason === "json_parse_failed") {
      await emitBestEffortEvent(deps.eventBus, "memory.consolidation_json_parse_failed", {
        ...eventContext,
        rawText: result.degraded.rawText,
        error: result.degraded.error,
      });
    }

    return result.output;
  } catch (error) {
    await emitBestEffortEvent(deps.eventBus, "memory.consolidation_failed", {
      ...eventContext,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

function enqueueCompactMacroIfNeeded(
  tx: DbExecutor,
  args: CompactMacroEnqueueArgs,
  planner: MemoryCompactionPlanner,
  scheduler: MemoryJobScheduler,
): void {
  const activeSummaries = tx
    .select()
    .from(memoryItems)
    .where(and(
      eq(memoryItems.accountId, args.accountId),
      eq(memoryItems.scope, args.scope),
      eq(memoryItems.scopeId, args.scopeId),
      eq(memoryItems.type, "summary"),
      eq(memoryItems.status, "active"),
      eq(memoryItems.lifecycleStatus, "active"),
    ))
    .orderBy(desc(memoryItems.updatedAt))
    .limit(200)
    .all()
    .map(toMemoryItem);

  const latestMacroSummary = activeSummaries.find((item) => item.summaryTier === "macro");
  const plan = planner.plan({
    activeSummaries,
    latestMacroSummary,
    lastProcessedFloorNo: args.lastProcessedFloorNo ?? undefined,
    force: args.force === true,
  });

  if (!plan.shouldCompact || plan.sourceMicroIds.length === 0) {
    return;
  }

  scheduler.enqueueCompactMacro(tx, {
    accountId: args.accountId,
    scope: args.scope,
    scopeId: args.scopeId,
    sessionId: resolveMemoryJobSessionId(args.scope, args.scopeId),
    sourceMicroIds: plan.sourceMicroIds,
    coverageStartFloorNo: plan.coverageStartFloorNo,
    coverageEndFloorNo: plan.coverageEndFloorNo,
    triggerFloorId: args.triggerFloorId,
    committedAt: args.committedAt,
    force: args.force === true,
  });
}

function toScopeMetadataPatch(input: MemoryRuntimeScopeMetadata): Record<string, unknown> {
  return {
    lastProcessedFloorNo: input.lastProcessedFloorNo ?? null,
    lastCompactionAt: input.lastCompactionAt ?? null,
  };
}

export function createMemoryRuntimeJobProcessorRegistry(
  deps: MemoryRuntimeProcessorDependencies,
): RuntimeJobProcessorRegistry {
  const registry = new RuntimeJobProcessorRegistry();
  const maintenanceService = new MemoryMaintenanceService(deps.db, {
    eventBus: deps.eventBus,
  });
  const planner = new MemoryCompactionPlanner();
  const scheduler = new MemoryJobScheduler({
    eventBus: deps.eventBus,
  });

  const ingestTurnProcessor: RuntimeJobProcessor<
    MemoryIngestTurnJobPayload,
    { context: IngestTurnProcessingContext; ingestOutput: MemoryIngestOutput },
    void
  > = {
    async prepare() {
      throw new Error("unreachable");
    },
    commit() {
      throw new Error("unreachable");
    },
  };

  ingestTurnProcessor.prepare = async ({ job, payload }) => {
    const context = await loadIngestContext(deps, payload, job.id);
    const expectedDigest = createUserInputDigest(context.userMessage);
    if (expectedDigest !== payload.userInputDigest) {
      throw new RuntimeJobFatalError(`User input digest mismatch for floor '${payload.floorId}'`);
    }

    const ingestOutput = await runIngestProcessor(deps, payload, context, job.id);
    return { context, ingestOutput };
  };

  ingestTurnProcessor.commit = ({ tx, job, payload, prepared, completedAt, scopeState }) => {
    const pendingEvents: PendingCoreEvent[] = [];
    const existingMetadata = readMemoryRuntimeScopeMetadata(scopeState.metadataJson);
    const mutationCounts = applyTransactionalMemoryMutations({
      tx,
      accountId: payload.accountId,
      timestamp: completedAt,
      pendingEvents,
      ingestOutput: prepared.ingestOutput,
      sourceFloorNo: payload.floorNo,
      sourceJobId: job.id,
      defaultScope: prepared.context.scope,
      defaultScopeId: prepared.context.scopeId,
      scopeContext: {
        accountId: payload.accountId,
        sessionId: payload.sessionId,
        ...(prepared.context.branchId ? { branchId: prepared.context.branchId } : {}),
        floorId: payload.floorId,
      },
      sourceFloorId: payload.floorId,
      sourceMessageId: payload.assistantMessageId,
    });

    const latestProcessedFloorNo = existingMetadata.lastProcessedFloorNo === null || existingMetadata.lastProcessedFloorNo === undefined
      ? payload.floorNo
      : Math.max(existingMetadata.lastProcessedFloorNo, payload.floorNo);

    if (deps.enableMacroCompaction) {
      enqueueCompactMacroIfNeeded(tx, {
        accountId: payload.accountId,
        scope: prepared.context.scope,
        scopeId: prepared.context.scopeId,
        triggerFloorId: payload.floorId,
        committedAt: completedAt,
        lastProcessedFloorNo: latestProcessedFloorNo,
        force: false,
      }, planner, scheduler);
    }

    return {
      scopeMutation: mutationCounts.created + mutationCounts.updated + mutationCounts.deprecated > 0 ? "changed" : "none",
      scopeMetadata: toScopeMetadataPatch({
        ...existingMetadata,
        lastProcessedFloorNo: latestProcessedFloorNo,
      }),
      afterCommit: async () => {
        await emitPendingCoreEvents(deps.eventBus, pendingEvents);
      },
    } satisfies RuntimeJobCommitResult<void>;
  };

  const compactMacroProcessor: RuntimeJobProcessor<
    MemoryCompactMacroJobPayload,
    { context: CompactMacroProcessingContext; compactionOutput: MemoryCompactionOutput },
    void
  > = {
    async prepare({ job, payload }) {
      if (!deps.enableMacroCompaction && payload.force !== true) {
        throw new RuntimeJobFatalError("Macro compaction is disabled");
      }

      const context = await loadCompactionContext(deps, payload, job.id);
      const compactionOutput = await runCompactionProcessor(deps, payload, context, job.id);
      return { context, compactionOutput };
    },
    commit({ tx, job, payload, prepared, completedAt, scopeState }) {
      const pendingEvents: PendingCoreEvent[] = [];
      const existingMetadata = readMemoryRuntimeScopeMetadata(scopeState.metadataJson);
      const sourceFloorId = resolveMemoryJobFloorId(payload.scope, payload.scopeId, payload.triggerFloorId ?? job.floorId);
      const sessionId = resolveMemoryJobSessionId(payload.scope, payload.scopeId, payload.sessionId);

      const mutationCounts = applyTransactionalMemoryMutations({
        tx,
        accountId: payload.accountId,
        timestamp: completedAt,
        pendingEvents,
        compactionOutput: prepared.compactionOutput,
        compactionSourceIds: payload.sourceMicroIds,
        sourceJobId: job.id,
        defaultScope: payload.scope,
        defaultScopeId: payload.scopeId,
        scopeContext: {
          accountId: payload.accountId,
          sessionId,
          ...(payload.scope === "branch" ? { branchId: parseBranchMemoryScopeId(payload.scopeId)?.branchId } : {}),
          floorId: payload.triggerFloorId,
        },
        sourceFloorId,
      });

      enqueueCompactMacroIfNeeded(tx, {
        accountId: payload.accountId,
        scope: payload.scope,
        scopeId: payload.scopeId,
        triggerFloorId: payload.triggerFloorId,
        committedAt: completedAt,
        lastProcessedFloorNo: existingMetadata.lastProcessedFloorNo,
        force: payload.force === true,
      }, planner, scheduler);

      const didMutate = mutationCounts.created + mutationCounts.updated + mutationCounts.deprecated > 0;
      return {
        scopeMutation: didMutate ? "changed" : "none",
        scopeMetadata: toScopeMetadataPatch({
          ...existingMetadata,
          lastCompactionAt: didMutate ? completedAt : existingMetadata.lastCompactionAt,
        }),
        afterCommit: async () => {
          await emitPendingCoreEvents(deps.eventBus, pendingEvents);
        },
      } satisfies RuntimeJobCommitResult<void>;
    },
  };

  const maintenanceProcessor: RuntimeJobProcessor<
    MemoryMaintenanceJobPayload,
    Record<string, never>,
    MemoryMaintenanceRunResult
  > = {
    async prepare() {
      return {};
    },
    commit({ tx, job, payload, completedAt, scopeState }) {
      const existingMetadata = readMemoryRuntimeScopeMetadata(scopeState.metadataJson);
      const maintenancePendingEvents: PendingCoreEvent[] = [];
      const result = maintenanceService.runInTransaction(tx, {
        now: completedAt,
        batchSize: payload.batchSize,
        dryRun: payload.dryRun,
        policy: payload.policy,
        scope: {
          accountId: payload.accountId,
          scope: payload.scope,
          scopeId: payload.scopeId,
        },
      }, maintenancePendingEvents);

      const didMutate = payload.dryRun !== true && (result.deprecated.total + result.purged > 0);

      return {
        result,
        scopeMutation: didMutate ? "changed" : "none",
        scopeMetadata: toScopeMetadataPatch(existingMetadata),
        afterCommit: didMutate
          ? async () => {
            if (maintenancePendingEvents.length > 0) {
              await emitPendingCoreEvents(deps.eventBus, maintenancePendingEvents);
            }
            await emitBestEffortEvent(deps.eventBus, "memory.consolidated", {
              ...buildMemoryJobEventContext({
                scope: payload.scope,
                scopeId: payload.scopeId,
                sourceJobId: job.id,
                jobType: "maintenance",
              }),
              created: 0,
              updated: 0,
              deprecated: result.deprecated.total,
              purged: result.purged,
            });
          }
          : undefined,
      } satisfies RuntimeJobCommitResult<MemoryMaintenanceRunResult>;
    },
  };

  const rebuildProcessor: RuntimeJobProcessor<
    MemoryRebuildScopeJobPayload,
    Record<string, never>,
    void
  > = {
    async prepare() {
      return {};
    },
    commit({ tx, payload, completedAt, scopeState }) {
      const existingMetadata = readMemoryRuntimeScopeMetadata(scopeState.metadataJson);
      const triggerFloorId = payload.triggerFloorId ?? (payload.scope === "floor" ? payload.scopeId : undefined);

      enqueueCompactMacroIfNeeded(tx, {
        accountId: payload.accountId,
        scope: payload.scope,
        scopeId: payload.scopeId,
        triggerFloorId,
        committedAt: completedAt,
        lastProcessedFloorNo: existingMetadata.lastProcessedFloorNo,
        force: payload.forceCompaction === true,
      }, planner, scheduler);

      return {
        scopeMutation: "none",
        scopeMetadata: toScopeMetadataPatch(existingMetadata),
      } satisfies RuntimeJobCommitResult<void>;
    },
  };

  registry.register(MEMORY_RUNTIME_JOB_TYPES.ingest_turn, ingestTurnProcessor);
  registry.register(MEMORY_RUNTIME_JOB_TYPES.compact_macro, compactMacroProcessor);
  registry.register(MEMORY_RUNTIME_JOB_TYPES.maintenance, maintenanceProcessor);
  registry.register(MEMORY_RUNTIME_JOB_TYPES.rebuild_scope, rebuildProcessor);

  return registry;
}

export function buildMemoryRuntimeScopeRef(
  accountId: string,
  scope: MemoryScope,
  scopeId: string,
): RuntimeScopeRef {
  return {
    accountId,
    scopeType: "memory",
    scopeKey: buildMemoryRuntimeScopeKey(scope, scopeId),
  };
}
