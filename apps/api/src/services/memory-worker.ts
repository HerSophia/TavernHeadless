import { and, asc, desc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CoreEventBus,
  CoreEventMap,
  MemoryItem,
  MemoryCompactionOutput,
  MemoryCompactionProcessor,
  MemoryIngestOutput,
  MemoryIngestProcessor,
  MemoryStore,
} from "@tavern/core";
import {
  MemoryCompactionPlanner,
  MemoryRevisionConflictError,
  MemoryRevisionGuard,
} from "@tavern/core";
import type { MemoryJobStatus, MemoryJobType, MemoryScope } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  memoryJobs,
  memoryScopeStates,
  messagePages,
  messages,
  memoryItems,
  floors,
  sessions,
} from "../db/schema.js";
import { createUserInputDigest } from "./memory-job-utils.js";
import {
  MemoryJobPayloadParseError,
  MemoryJobScheduler,
  type MemoryCompactMacroJobPayload,
  type MemoryIngestTurnJobPayload,
  type MemoryMaintenanceJobPayload,
  type MemoryRebuildScopeJobPayload,
} from "./memory-job-scheduler.js";
import {
  applyTransactionalMemoryMutations,
  emitPendingCoreEvents,
  type PendingCoreEvent,
} from "./memory-transaction-mutations.js";
import {
  MemoryMaintenanceService,
  type MemoryMaintenanceRunResult,
} from "./memory-maintenance-service.js";

const TERMINAL_JOB_STATUSES: MemoryJobStatus[] = ["succeeded", "dead_letter", "cancelled"];
const CANDIDATE_JOB_STATUSES: MemoryJobStatus[] = ["pending", "retry_waiting", "leased", "running"];
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_MAX_CONCURRENT_JOBS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_CANDIDATE_SCAN_LIMIT = 32;

interface MemoryWorkerLogger {
  info?(obj: unknown, message?: string): void;
  warn?(obj: unknown, message?: string): void;
  error?(obj: unknown, message?: string): void;
}

export interface MemoryWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  maxConcurrentJobs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  candidateScanLimit?: number;
  enableMacroCompaction?: boolean;
  logger?: MemoryWorkerLogger;
}

interface LeasedMemoryJob {
  job: typeof memoryJobs.$inferSelect;
}

interface IngestTurnProcessingContext {
  userMessage: string;
  assistantMessage: string;
  currentFloorContent: string;
  extractedSummaries: string[];
  recentSummaries: Awaited<ReturnType<MemoryStore["query"]>>;
  existingFacts: Awaited<ReturnType<MemoryStore["query"]>>;
  existingOpenLoops: Awaited<ReturnType<MemoryStore["query"]>>;
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

function resolveMemoryJobSessionId(
  scope: MemoryScope,
  scopeId: string,
  sessionId?: string,
): string | undefined {
  return scope === "chat" ? scopeId : sessionId;
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

class MemoryWorkerFatalJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryWorkerFatalJobError";
  }
}

class MemoryWorkerLeaseLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryWorkerLeaseLostError";
  }
}

export class MemoryWorker {
  private readonly jobScheduler: MemoryJobScheduler;
  private readonly revisionGuard = new MemoryRevisionGuard();
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseTtlMs: number;
  private readonly maxConcurrentJobs: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly candidateScanLimit: number;
  private readonly enableMacroCompaction: boolean;
  private readonly memoryCompactionPlanner = new MemoryCompactionPlanner();
  private readonly logger?: MemoryWorkerLogger;
  private readonly memoryMaintenanceService: MemoryMaintenanceService;

  private pollTimer: NodeJS.Timeout | undefined;
  private started = false;
  private pumping = false;
  private readonly activeJobs = new Map<string, Promise<void>>();

  constructor(
    private readonly db: AppDb,
    private readonly memoryStore: MemoryStore,
    private readonly memoryIngestProcessor: MemoryIngestProcessor,
    private readonly memoryCompactionProcessor: MemoryCompactionProcessor,
    private readonly eventBus: CoreEventBus,
    options: MemoryWorkerOptions = {},
  ) {
    this.jobScheduler = new MemoryJobScheduler();
    this.workerId = options.workerId ?? `memory-worker-${nanoid(8)}`;
    this.enableMacroCompaction = options.enableMacroCompaction === true;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.maxConcurrentJobs = Math.max(1, options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.candidateScanLimit = Math.max(1, options.candidateScanLimit ?? DEFAULT_CANDIDATE_SCAN_LIMIT);
    this.memoryMaintenanceService = new MemoryMaintenanceService(this.db);
    this.logger = options.logger;
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.pollTimer = setInterval(() => {
      void this.pump();
    }, this.pollIntervalMs);
    void this.pump();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    if (this.activeJobs.size > 0) {
      await Promise.allSettled(this.activeJobs.values());
    }
  }

  async processOneDueJob(): Promise<boolean> {
    const leased = this.db.transaction((tx) => this.tryLeaseNextJob(tx, Date.now()));
    if (!leased) {
      return false;
    }

    await this.processLeasedJob(leased);
    return true;
  }

  get activeJobCount(): number {
    return this.activeJobs.size;
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      return;
    }

    this.pumping = true;
    try {
      while (this.activeJobs.size < this.maxConcurrentJobs) {
        const leased = this.db.transaction((tx) => this.tryLeaseNextJob(tx, Date.now()));
        if (!leased) {
          break;
        }

        const promise = this.processLeasedJob(leased)
          .catch((error) => {
            this.logger?.error?.({ err: error, jobId: leased.job.id }, "memory worker job failed");
          })
          .finally(() => {
            this.activeJobs.delete(leased.job.id);
            if (this.started) {
              void this.pump();
            }
          });

        this.activeJobs.set(leased.job.id, promise);
      }
    } finally {
      this.pumping = false;
    }
  }

  private tryLeaseNextJob(tx: DbExecutor, now: number): LeasedMemoryJob | null {
    const candidates = tx
      .select()
      .from(memoryJobs)
      .where(and(
        inArray(memoryJobs.status, CANDIDATE_JOB_STATUSES),
        lte(memoryJobs.availableAt, now),
        or(
          isNull(memoryJobs.leaseUntil),
          lte(memoryJobs.leaseUntil, now),
        ),
      ))
      .orderBy(asc(memoryJobs.availableAt), asc(memoryJobs.createdAt))
      .limit(this.candidateScanLimit)
      .all();

    for (const candidate of candidates) {
      const leased = this.tryLeaseCandidate(tx, candidate, now);
      if (leased) {
        return leased;
      }
    }

    return null;
  }

  private tryLeaseCandidate(
    tx: DbExecutor,
    candidate: typeof memoryJobs.$inferSelect,
    now: number,
  ): LeasedMemoryJob | null {
    const blockingOlderJob = tx
      .select({ id: memoryJobs.id, status: memoryJobs.status })
      .from(memoryJobs)
      .where(and(
        eq(memoryJobs.accountId, candidate.accountId),
        eq(memoryJobs.scope, candidate.scope),
        eq(memoryJobs.scopeId, candidate.scopeId),
        lt(memoryJobs.createdAt, candidate.createdAt),
      ))
      .orderBy(asc(memoryJobs.createdAt))
      .all()
      .find((job) => !TERMINAL_JOB_STATUSES.includes(job.status));

    if (blockingOlderJob) {
      return null;
    }

    const scopeState = this.ensureScopeState(tx, candidate.accountId, candidate.scope, candidate.scopeId, now);
    const leaseUntil = now + this.leaseTtlMs;
    const leaseScopeResult = tx
      .update(memoryScopeStates)
      .set({
        leaseOwner: this.workerId,
        leaseUntil,
        updatedAt: now,
      })
      .where(and(
        eq(memoryScopeStates.accountId, candidate.accountId),
        eq(memoryScopeStates.scope, candidate.scope),
        eq(memoryScopeStates.scopeId, candidate.scopeId),
        or(
          isNull(memoryScopeStates.leaseUntil),
          lte(memoryScopeStates.leaseUntil, now),
          eq(memoryScopeStates.leaseOwner, this.workerId),
        ),
      ))
      .run();

    if (leaseScopeResult.changes !== 1) {
      return null;
    }

    const leaseJobResult = tx
      .update(memoryJobs)
      .set({
        status: "leased",
        basedOnRevision: scopeState.revision,
        leaseOwner: this.workerId,
        leaseUntil,
        updatedAt: now,
        finishedAt: null,
      })
      .where(and(
        eq(memoryJobs.id, candidate.id),
        lte(memoryJobs.availableAt, now),
        or(
          eq(memoryJobs.status, "pending"),
          eq(memoryJobs.status, "retry_waiting"),
          and(eq(memoryJobs.status, "leased"), lte(memoryJobs.leaseUntil, now)),
          and(eq(memoryJobs.status, "running"), lte(memoryJobs.leaseUntil, now)),
        ),
        or(
          isNull(memoryJobs.leaseUntil),
          lte(memoryJobs.leaseUntil, now),
          eq(memoryJobs.leaseOwner, this.workerId),
        ),
      ))
      .run();

    if (leaseJobResult.changes !== 1) {
      this.releaseScopeLease(tx, candidate.accountId, candidate.scope, candidate.scopeId, now);
      return null;
    }

    return {
      job: {
        ...candidate,
        status: "leased",
        basedOnRevision: scopeState.revision,
        leaseOwner: this.workerId,
        leaseUntil,
        updatedAt: now,
        finishedAt: null,
      },
    };
  }

  private ensureScopeState(
    tx: DbExecutor,
    accountId: string,
    scope: typeof memoryScopeStates.$inferSelect["scope"],
    scopeId: string,
    now: number,
  ): typeof memoryScopeStates.$inferSelect {
    tx.insert(memoryScopeStates)
      .values({
        accountId,
        scope,
        scopeId,
        revision: 0,
        leaseOwner: null,
        leaseUntil: null,
        lastProcessedFloorNo: null,
        lastCompactionAt: null,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    const row = tx
      .select()
      .from(memoryScopeStates)
      .where(and(
        eq(memoryScopeStates.accountId, accountId),
        eq(memoryScopeStates.scope, scope),
        eq(memoryScopeStates.scopeId, scopeId),
      ))
      .limit(1)
      .all()[0];

    if (!row) {
      throw new Error(`Memory scope state missing for ${accountId}::${scope}::${scopeId}`);
    }

    return row;
  }

  private releaseScopeLease(
    tx: DbExecutor,
    accountId: string,
    scope: typeof memoryScopeStates.$inferSelect["scope"],
    scopeId: string,
    now: number,
  ): void {
    tx.update(memoryScopeStates)
      .set({
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(and(
        eq(memoryScopeStates.accountId, accountId),
        eq(memoryScopeStates.scope, scope),
        eq(memoryScopeStates.scopeId, scopeId),
        eq(memoryScopeStates.leaseOwner, this.workerId),
      ))
      .run();
  }

  private async processLeasedJob(leased: LeasedMemoryJob): Promise<void> {
    let job = leased.job;

    try {
      const runningAt = Date.now();

      const markRunningResult = await this.db.update(memoryJobs)
        .set({
          status: "running",
          attemptCount: job.attemptCount + 1,
          updatedAt: runningAt,
        })
        .where(and(
          eq(memoryJobs.id, job.id),
          eq(memoryJobs.status, "leased"),
          eq(memoryJobs.leaseOwner, this.workerId),
        ))
        .run();

      if (markRunningResult.changes !== 1) {
        throw new MemoryWorkerLeaseLostError(`Failed to mark job '${job.id}' as running`);
      }

      job = {
        ...job,
        status: "running",
        attemptCount: job.attemptCount + 1,
        updatedAt: runningAt,
      };

      if (job.jobType === "ingest_turn") {
        const payload = this.jobScheduler.parseIngestTurnPayload(job);
        await this.processIngestTurnJob(job, payload);
        return;
      }

      if (job.jobType === "compact_macro") {
        const payload = this.jobScheduler.parseCompactMacroPayload(job);
        await this.processCompactMacroJob(job, payload);
        return;
      }

      if (job.jobType === "maintenance") {
        const payload = this.jobScheduler.parseMaintenancePayload(job);
        await this.processMaintenanceJob(job, payload);
        return;
      }

      if (job.jobType === "rebuild_scope") {
        const payload = this.jobScheduler.parseRebuildScopePayload(job);
        await this.processRebuildScopeJob(job, payload);
        return;
      }

      throw new MemoryWorkerFatalJobError(`Unsupported memory job type '${job.jobType}'`);
    } catch (error) {
      await this.handleJobFailure(job, error);
    }
  }

  private async processIngestTurnJob(
    job: typeof memoryJobs.$inferSelect,
    payload: MemoryIngestTurnJobPayload,
  ): Promise<void> {
    const context = await this.loadIngestContext(payload, job.id);
    const expectedDigest = createUserInputDigest(context.userMessage);
    if (expectedDigest !== payload.userInputDigest) {
      throw new MemoryWorkerFatalJobError(
        `User input digest mismatch for floor '${payload.floorId}'`,
      );
    }

    const ingestOutput = await this.runIngestProcessor(payload, context, job.id);

    const pendingEvents: PendingCoreEvent[] = [];
    const scopeRef = {
      accountId: payload.accountId,
      scope: job.scope,
      scopeId: job.scopeId,
    } as const;
    const expectedRevision = job.basedOnRevision ?? 0;
    const snapshot = this.revisionGuard.snapshot(scopeRef, expectedRevision);
    const completedAt = Date.now();

    this.db.transaction((tx) => {
      const scopeState = this.ensureScopeState(tx, scopeRef.accountId, scopeRef.scope, scopeRef.scopeId, completedAt);
      this.revisionGuard.assertExpected(snapshot, scopeState.revision);

      const mutationCounts = applyTransactionalMemoryMutations({
        tx,
        accountId: payload.accountId,
        timestamp: completedAt,
        pendingEvents,
        ingestOutput,
        sourceFloorNo: payload.floorNo,
        sourceJobId: job.id,
        defaultScope: "chat",
        defaultScopeId: payload.sessionId,
        scopeContext: {
          accountId: payload.accountId,
          sessionId: payload.sessionId,
          floorId: payload.floorId,
        },
        sourceFloorId: payload.floorId,
        sourceMessageId: payload.assistantMessageId,
      });

      const latestProcessedFloorNo = scopeState.lastProcessedFloorNo === null
        ? payload.floorNo
        : Math.max(scopeState.lastProcessedFloorNo, payload.floorNo);

      if (this.enableMacroCompaction) {
        this.enqueueCompactMacroIfNeeded(tx, {
          accountId: payload.accountId,
          scope: "chat",
          scopeId: payload.sessionId,
          triggerFloorId: payload.floorId,
          committedAt: completedAt,
          lastProcessedFloorNo: latestProcessedFloorNo,
          force: false,
        });
      }

      const nextRevision = mutationCounts.created + mutationCounts.updated + mutationCounts.deprecated > 0
        ? expectedRevision + 1
        : expectedRevision;

      const scopeUpdate = tx.update(memoryScopeStates)
        .set({
          revision: nextRevision,
          leaseOwner: null,
          leaseUntil: null,
          lastProcessedFloorNo: latestProcessedFloorNo,
          updatedAt: completedAt,
        })
        .where(and(
          eq(memoryScopeStates.accountId, scopeRef.accountId),
          eq(memoryScopeStates.scope, scopeRef.scope),
          eq(memoryScopeStates.scopeId, scopeRef.scopeId),
          eq(memoryScopeStates.revision, expectedRevision),
          eq(memoryScopeStates.leaseOwner, this.workerId),
        ))
        .run();

      if (scopeUpdate.changes !== 1) {
        throw new MemoryWorkerLeaseLostError(
          `Failed to finalize scope lease for memory job '${job.id}'`,
        );
      }

      const jobUpdate = tx.update(memoryJobs)
        .set({
          status: "succeeded",
          leaseOwner: null,
          leaseUntil: null,
          lastError: null,
          finishedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(and(
          eq(memoryJobs.id, job.id),
          eq(memoryJobs.status, "running"),
          eq(memoryJobs.leaseOwner, this.workerId),
        ))
        .run();

      if (jobUpdate.changes !== 1) {
        throw new MemoryWorkerLeaseLostError(`Failed to finalize memory job '${job.id}'`);
      }
    });

    await emitPendingCoreEvents(this.eventBus, pendingEvents);
    this.logger?.info?.({
      jobId: job.id,
      accountId: payload.accountId,
      sessionId: payload.sessionId,
      floorId: payload.floorId,
      workerId: this.workerId,
    }, "memory worker job succeeded");
  }

  private enqueueCompactMacroIfNeeded(
    tx: DbExecutor,
    args: CompactMacroEnqueueArgs,
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
    const plan = this.memoryCompactionPlanner.plan({
      activeSummaries,
      latestMacroSummary,
      lastProcessedFloorNo: args.lastProcessedFloorNo ?? undefined,
      force: args.force === true,
    });

    if (!plan.shouldCompact || plan.sourceMicroIds.length === 0) {
      return;
    }

    this.jobScheduler.enqueueCompactMacro(tx, {
      accountId: args.accountId,
      scope: args.scope,
      scopeId: args.scopeId,
      sessionId: args.scope === "chat" ? args.scopeId : undefined,
      sourceMicroIds: plan.sourceMicroIds,
      coverageStartFloorNo: plan.coverageStartFloorNo,
      coverageEndFloorNo: plan.coverageEndFloorNo,
      triggerFloorId: args.triggerFloorId,
      committedAt: args.committedAt,
      force: args.force === true,
    });
  }

  private async processCompactMacroJob(
    job: typeof memoryJobs.$inferSelect,
    payload: MemoryCompactMacroJobPayload,
  ): Promise<void> {
    if (!this.enableMacroCompaction && payload.force !== true) {
      throw new MemoryWorkerFatalJobError("Macro compaction is disabled");
    }

    const context = await this.loadCompactionContext(payload, job.id);
    const compactionOutput = await this.runCompactionProcessor(payload, context, job.id);

    const pendingEvents: PendingCoreEvent[] = [];
    const scopeRef = {
      accountId: payload.accountId,
      scope: job.scope,
      scopeId: job.scopeId,
    } as const;
    const expectedRevision = job.basedOnRevision ?? 0;
    const snapshot = this.revisionGuard.snapshot(scopeRef, expectedRevision);
    const completedAt = Date.now();
    const sourceFloorId = resolveMemoryJobFloorId(payload.scope, payload.scopeId, payload.triggerFloorId ?? job.floorId);
    const sessionId = resolveMemoryJobSessionId(payload.scope, payload.scopeId, payload.sessionId);

    this.db.transaction((tx) => {
      const scopeState = this.ensureScopeState(tx, scopeRef.accountId, scopeRef.scope, scopeRef.scopeId, completedAt);
      this.revisionGuard.assertExpected(snapshot, scopeState.revision);

      const mutationCounts = applyTransactionalMemoryMutations({
        tx,
        accountId: payload.accountId,
        timestamp: completedAt,
        pendingEvents,
        compactionOutput,
        compactionSourceIds: payload.sourceMicroIds,
        sourceJobId: job.id,
        defaultScope: payload.scope,
        defaultScopeId: payload.scopeId,
        scopeContext: {
          accountId: payload.accountId,
          sessionId,
          floorId: payload.triggerFloorId,
        },
        sourceFloorId,
      });

      this.enqueueCompactMacroIfNeeded(tx, {
        accountId: payload.accountId,
        scope: payload.scope,
        scopeId: payload.scopeId,
        triggerFloorId: payload.triggerFloorId,
        committedAt: completedAt,
        lastProcessedFloorNo: scopeState.lastProcessedFloorNo,
        force: payload.force === true,
      });

      const nextRevision = mutationCounts.created + mutationCounts.updated + mutationCounts.deprecated > 0
        ? expectedRevision + 1
        : expectedRevision;

      const scopeUpdate = tx.update(memoryScopeStates)
        .set({
          revision: nextRevision,
          leaseOwner: null,
          leaseUntil: null,
          lastProcessedFloorNo: scopeState.lastProcessedFloorNo,
          lastCompactionAt: mutationCounts.created + mutationCounts.updated + mutationCounts.deprecated > 0
            ? completedAt
            : scopeState.lastCompactionAt,
          updatedAt: completedAt,
        })
        .where(and(
          eq(memoryScopeStates.accountId, scopeRef.accountId),
          eq(memoryScopeStates.scope, scopeRef.scope),
          eq(memoryScopeStates.scopeId, scopeRef.scopeId),
          eq(memoryScopeStates.revision, expectedRevision),
          eq(memoryScopeStates.leaseOwner, this.workerId),
        ))
        .run();

      if (scopeUpdate.changes !== 1) {
        throw new MemoryWorkerLeaseLostError(
          `Failed to finalize scope lease for memory job '${job.id}'`,
        );
      }

      const jobUpdate = tx.update(memoryJobs)
        .set({
          status: "succeeded",
          leaseOwner: null,
          leaseUntil: null,
          lastError: null,
          finishedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(and(
          eq(memoryJobs.id, job.id),
          eq(memoryJobs.status, "running"),
          eq(memoryJobs.leaseOwner, this.workerId),
        ))
        .run();

      if (jobUpdate.changes !== 1) {
        throw new MemoryWorkerLeaseLostError(`Failed to finalize memory job '${job.id}'`);
      }
    });

    await emitPendingCoreEvents(this.eventBus, pendingEvents);
    this.logger?.info?.({
      jobId: job.id,
      accountId: payload.accountId,
      scope: payload.scope,
      scopeId: payload.scopeId,
      sessionId,
      sourceMicroCount: payload.sourceMicroIds.length,
      workerId: this.workerId,
    }, "memory macro compaction job succeeded");
  }

  private async processMaintenanceJob(
    job: typeof memoryJobs.$inferSelect,
    payload: MemoryMaintenanceJobPayload,
  ): Promise<void> {
    const scopeRef = {
      accountId: payload.accountId,
      scope: job.scope,
      scopeId: job.scopeId,
    } as const;
    const expectedRevision = job.basedOnRevision ?? 0;
    const snapshot = this.revisionGuard.snapshot(scopeRef, expectedRevision);
    const completedAt = Date.now();
    let result: MemoryMaintenanceRunResult | undefined;

    this.db.transaction((tx) => {
      const scopeState = this.ensureScopeState(tx, scopeRef.accountId, scopeRef.scope, scopeRef.scopeId, completedAt);
      this.revisionGuard.assertExpected(snapshot, scopeState.revision);

      result = this.memoryMaintenanceService.runInTransaction(tx, {
        now: completedAt,
        batchSize: payload.batchSize,
        dryRun: payload.dryRun,
        policy: payload.policy,
        scope: {
          accountId: payload.accountId,
          scope: payload.scope,
          scopeId: payload.scopeId,
        },
      });

      const didMutate = payload.dryRun !== true && (result.deprecated.total + result.purged > 0);
      const nextRevision = didMutate ? expectedRevision + 1 : expectedRevision;

      const scopeUpdate = tx.update(memoryScopeStates)
        .set({
          revision: nextRevision,
          leaseOwner: null,
          leaseUntil: null,
          lastProcessedFloorNo: scopeState.lastProcessedFloorNo,
          lastCompactionAt: scopeState.lastCompactionAt,
          updatedAt: completedAt,
        })
        .where(and(
          eq(memoryScopeStates.accountId, scopeRef.accountId),
          eq(memoryScopeStates.scope, scopeRef.scope),
          eq(memoryScopeStates.scopeId, scopeRef.scopeId),
          eq(memoryScopeStates.revision, expectedRevision),
          eq(memoryScopeStates.leaseOwner, this.workerId),
        ))
        .run();

      if (scopeUpdate.changes !== 1) {
        throw new MemoryWorkerLeaseLostError(
          `Failed to finalize scope lease for memory job '${job.id}'`,
        );
      }

      const jobUpdate = tx.update(memoryJobs)
        .set({
          status: "succeeded",
          leaseOwner: null,
          leaseUntil: null,
          lastError: null,
          finishedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(and(
          eq(memoryJobs.id, job.id),
          eq(memoryJobs.status, "running"),
          eq(memoryJobs.leaseOwner, this.workerId),
        ))
        .run();

      if (jobUpdate.changes !== 1) {
        throw new MemoryWorkerLeaseLostError(`Failed to finalize memory job '${job.id}'`);
      }
    });

    const didMutate = payload.dryRun !== true
      && result !== undefined
      && (result.deprecated.total + result.purged) > 0;

    if (didMutate && result) {
      await this.emitBestEffortEvent("memory.consolidated", {
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

    this.logger?.info?.({
      jobId: job.id,
      accountId: payload.accountId,
      scope: payload.scope,
      scopeId: payload.scopeId,
      result: result ?? null,
      workerId: this.workerId,
    }, "memory maintenance job succeeded");
  }

  private async processRebuildScopeJob(
    job: typeof memoryJobs.$inferSelect,
    payload: MemoryRebuildScopeJobPayload,
  ): Promise<void> {
    const scopeRef = {
      accountId: payload.accountId,
      scope: job.scope,
      scopeId: job.scopeId,
    } as const;
    const expectedRevision = job.basedOnRevision ?? 0;
    const snapshot = this.revisionGuard.snapshot(scopeRef, expectedRevision);
    const completedAt = Date.now();
    const triggerFloorId = payload.triggerFloorId ?? job.floorId ?? (payload.scope === "floor" ? payload.scopeId : undefined);

    this.db.transaction((tx) => {
      const scopeState = this.ensureScopeState(tx, scopeRef.accountId, scopeRef.scope, scopeRef.scopeId, completedAt);
      this.revisionGuard.assertExpected(snapshot, scopeState.revision);

      this.enqueueCompactMacroIfNeeded(tx, {
        accountId: payload.accountId,
        scope: payload.scope,
        scopeId: payload.scopeId,
        triggerFloorId,
        committedAt: completedAt,
        lastProcessedFloorNo: scopeState.lastProcessedFloorNo,
        force: payload.forceCompaction === true,
      });

      const scopeUpdate = tx.update(memoryScopeStates)
        .set({
          revision: expectedRevision,
          leaseOwner: null,
          leaseUntil: null,
          lastProcessedFloorNo: scopeState.lastProcessedFloorNo,
          lastCompactionAt: scopeState.lastCompactionAt,
          updatedAt: completedAt,
        })
        .where(and(
          eq(memoryScopeStates.accountId, scopeRef.accountId),
          eq(memoryScopeStates.scope, scopeRef.scope),
          eq(memoryScopeStates.scopeId, scopeRef.scopeId),
          eq(memoryScopeStates.revision, expectedRevision),
          eq(memoryScopeStates.leaseOwner, this.workerId),
        ))
        .run();

      if (scopeUpdate.changes !== 1) {
        throw new MemoryWorkerLeaseLostError(
          `Failed to finalize scope lease for memory job '${job.id}'`,
        );
      }

      const jobUpdate = tx.update(memoryJobs)
        .set({
          status: "succeeded",
          leaseOwner: null,
          leaseUntil: null,
          lastError: null,
          finishedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(and(
          eq(memoryJobs.id, job.id),
          eq(memoryJobs.status, "running"),
          eq(memoryJobs.leaseOwner, this.workerId),
        ))
        .run();

      if (jobUpdate.changes !== 1) {
        throw new MemoryWorkerLeaseLostError(`Failed to finalize memory job '${job.id}'`);
      }
    });

    this.logger?.info?.({
      jobId: job.id,
      accountId: payload.accountId,
      scope: payload.scope,
      scopeId: payload.scopeId,
      workerId: this.workerId,
    }, "memory rebuild scope job succeeded");
  }

  private async loadIngestContext(
    payload: MemoryIngestTurnJobPayload,
    sourceJobId: string,
  ): Promise<IngestTurnProcessingContext> {
    try {
      const [userMessage, assistantMessage, recentSummaries, existingFacts, existingOpenLoops] = await Promise.all([
        this.loadUserMessage(payload.floorId, payload.accountId),
        this.loadAssistantMessage(payload.assistantMessageId, payload.accountId),
        this.memoryStore.query({
          scope: "chat",
          scopeId: payload.sessionId,
          accountId: payload.accountId,
          type: "summary",
          status: "active",
          lifecycleStatus: "active",
          orderBy: "updatedAt",
          orderDir: "desc",
          limit: 20,
        }),
        this.memoryStore.query({
          scope: "chat",
          scopeId: payload.sessionId,
          accountId: payload.accountId,
          type: "fact",
          status: "active",
          lifecycleStatus: "active",
          orderBy: "importance",
          orderDir: "desc",
          limit: 50,
        }),
        this.memoryStore.query({
          scope: "chat",
          scopeId: payload.sessionId,
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
        existingOpenLoops,
      };
    } catch (error) {
      await this.emitBestEffortEvent("memory.consolidation_context_failed", {
        ...buildMemoryJobEventContext({
          scope: "chat",
          scopeId: payload.sessionId,
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

  private async loadCompactionContext(
    payload: MemoryCompactMacroJobPayload,
    sourceJobId: string,
  ): Promise<CompactMacroProcessingContext> {
    try {
      const [activeSummaries, existingFacts, existingOpenLoops] = await Promise.all([
        this.memoryStore.query({
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
        this.memoryStore.query({
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
        this.memoryStore.query({
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
      await this.emitBestEffortEvent("memory.consolidation_context_failed", {
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

  private async loadUserMessage(floorId: string, accountId: string): Promise<string> {
    const [row] = await this.db
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
      throw new MemoryWorkerFatalJobError(`User message not found for floor '${floorId}'`);
    }

    return row.content;
  }

  private async loadAssistantMessage(messageId: string, accountId: string): Promise<string> {
    const [row] = await this.db
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
      throw new MemoryWorkerFatalJobError(`Assistant message not found for message '${messageId}'`);
    }

    return row.content;
  }

  private async runIngestProcessor(
    payload: MemoryIngestTurnJobPayload,
    context: IngestTurnProcessingContext,
    sourceJobId: string,
  ): Promise<MemoryIngestOutput> {
    try {
      const result = await this.memoryIngestProcessor.process({
        currentFloorContent: context.currentFloorContent,
        extractedSummaries: context.extractedSummaries,
        recentSummaries: context.recentSummaries,
        existingFacts: context.existingFacts,
        existingOpenLoops: context.existingOpenLoops,
        scope: "chat",
        scopeId: payload.sessionId,
        sourceFloorId: payload.floorId,
      });

      if (result.degraded?.reason === "json_parse_failed") {
        await this.emitBestEffortEvent("memory.consolidation_json_parse_failed", {
          ...buildMemoryJobEventContext({
            scope: "chat",
            scopeId: payload.sessionId,
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
      await this.emitBestEffortEvent("memory.consolidation_failed", {
        ...buildMemoryJobEventContext({
          scope: "chat",
          scopeId: payload.sessionId,
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

  private async runCompactionProcessor(
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
      const result = await this.memoryCompactionProcessor.process({
        sourceMicroSummaries: context.sourceMicroSummaries,
        latestMacroSummary: context.latestMacroSummary,
        existingFacts: context.existingFacts,
        existingOpenLoops: context.existingOpenLoops,
        scope: payload.scope,
        scopeId: payload.scopeId,
      });

      if (result.degraded?.reason === "json_parse_failed") {
        await this.emitBestEffortEvent("memory.consolidation_json_parse_failed", {
          ...eventContext,
          rawText: result.degraded.rawText,
          error: result.degraded.error,
        });
      }

      return result.output;
    } catch (error) {
      await this.emitBestEffortEvent("memory.consolidation_failed", {
        ...eventContext,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  private async handleJobFailure(
    job: typeof memoryJobs.$inferSelect,
    error: unknown,
  ): Promise<void> {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const now = Date.now();

    const isFatal = normalizedError instanceof MemoryJobPayloadParseError
      || normalizedError instanceof MemoryWorkerFatalJobError;
    const canRetry = !isFatal && job.attemptCount < job.maxAttempts;

    if (canRetry) {
      const availableAt = now + this.computeRetryDelayMs(job.attemptCount, normalizedError);
      const retryScheduled = this.db.transaction((tx) => {
        this.releaseScopeLease(tx, job.accountId, job.scope, job.scopeId, now);
        return tx.update(memoryJobs)
          .set({
            status: "retry_waiting",
            availableAt,
            leaseOwner: null,
            leaseUntil: null,
            lastError: normalizedError.message,
            updatedAt: now,
            finishedAt: null,
          })
          .where(and(
            eq(memoryJobs.id, job.id),
            eq(memoryJobs.leaseOwner, this.workerId),
          ))
          .run();
      });

      if (retryScheduled.changes !== 1) {
        return;
      }

      this.logger?.warn?.({
        err: normalizedError,
        jobId: job.id,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        retryAt: availableAt,
      }, "memory worker job scheduled for retry");
      return;
    }

    const deadLettered = this.db.transaction((tx) => {
      this.releaseScopeLease(tx, job.accountId, job.scope, job.scopeId, now);
      return tx.update(memoryJobs)
        .set({
          status: "dead_letter",
          leaseOwner: null,
          leaseUntil: null,
          lastError: normalizedError.message,
          finishedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(memoryJobs.id, job.id),
          eq(memoryJobs.leaseOwner, this.workerId),
        ))
        .run();
    });

    if (deadLettered.changes !== 1) {
      return;
    }

    await this.emitBestEffortEvent("memory.persist_failed", {
      ...buildMemoryJobEventContext({
        scope: job.scope,
        scopeId: job.scopeId,
        floorId: job.floorId,
        sourceJobId: job.id,
        jobType: job.jobType,
      }),
      error: normalizedError,
    });

    this.logger?.error?.({
      err: normalizedError,
      jobId: job.id,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
    }, "memory worker job moved to dead letter");
  }

  private computeRetryDelayMs(attemptCount: number, error: Error): number {
    if (error instanceof MemoryRevisionConflictError || error instanceof MemoryWorkerLeaseLostError) {
      return Math.min(this.maxRetryDelayMs, this.retryBaseDelayMs);
    }

    const exponent = Math.max(0, attemptCount - 1);
    return Math.min(this.maxRetryDelayMs, this.retryBaseDelayMs * (2 ** exponent));
  }

  private async emitBestEffortEvent<K extends keyof CoreEventMap>(
    name: K,
    payload: CoreEventMap[K],
  ): Promise<void> {
    try {
      await this.eventBus.emit(name as never, payload as never);
    } catch {
      // 观测类事件不应反向影响作业处理。
    }
  }
}
