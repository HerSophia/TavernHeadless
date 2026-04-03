import type { CoreEventBus } from "@tavern/core";
import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { runtimeJobs } from "../db/schema.js";
import { ResourceBusyError } from "../lib/retry.js";
import { RuntimeJobCatalog } from "./runtime-job-catalog.js";
import {
  RuntimeJobFatalError,
  RuntimeJobLeaseLostError,
  RuntimeJobRetryableError,
  RuntimeJobUncertainOutcomeError,
} from "./runtime-job-errors.js";
import { RuntimeJobProcessorRegistry } from "./runtime-job-processor-registry.js";
import { RuntimeRevisionConflictError, RuntimeRevisionGuard } from "./runtime-revision-guard.js";
import { emitRuntimeJobEvent } from "./runtime-job-events.js";
import {
  RuntimeScopeStateRepository,
  parseRuntimeScopeMetadata,
} from "./runtime-scope-state-repository.js";
import type {
  RuntimeJobCommitResult,
  RuntimeJobExecutionContext,
  RuntimeJobProgressUpdate,
  RuntimeJobRecord,
  RuntimeJobStatus,
  RuntimeScopeRef,
} from "./runtime-job-types.js";

const TERMINAL_JOB_STATUSES: RuntimeJobStatus[] = ["succeeded", "dead_letter", "cancelled"];
const CANDIDATE_JOB_STATUSES: RuntimeJobStatus[] = ["pending", "retry_waiting", "leased", "running"];
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_MAX_CONCURRENT_JOBS = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_CANDIDATE_SCAN_LIMIT = 32;

export interface RuntimeWorkerLogger {
  info?: (meta: Record<string, unknown>, message: string) => void;
  warn?: (meta: Record<string, unknown>, message: string) => void;
  error?: (meta: Record<string, unknown>, message: string) => void;
}

export interface RuntimeWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  maxConcurrentJobs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  candidateScanLimit?: number;
  jobTypes?: string[];
  jobTypePrefixes?: string[];
  logger?: RuntimeWorkerLogger;
  eventBus?: CoreEventBus;
}

type LeasedRuntimeJob = {
  job: RuntimeJobRecord;
  scopeRef: RuntimeScopeRef;
  leasedFromStatus: RuntimeJobStatus;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJobJson<T>(json: string | null | undefined): T | null {
  if (!json) {
    return null;
  }

  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function mergeJobState(
  currentJson: string | null,
  nextState: unknown,
  mode: "replace" | "merge" = "merge",
): string | null {
  if (nextState === undefined) {
    return currentJson;
  }

  if (mode === "replace") {
    return JSON.stringify(nextState);
  }

  const current = parseJobJson<Record<string, unknown>>(currentJson);
  if (isRecord(current) && isRecord(nextState)) {
    return JSON.stringify({ ...current, ...nextState });
  }

  return JSON.stringify(nextState);
}

function matchesPrefixes(jobType: string, prefixes: readonly string[]): boolean {
  return prefixes.length === 0 || prefixes.some((prefix) => jobType.startsWith(prefix));
}

export class RuntimeWorker {
  private readonly revisionGuard = new RuntimeRevisionGuard();
  private readonly scopeStates = new RuntimeScopeStateRepository();
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseTtlMs: number;
  private readonly maxConcurrentJobs: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly candidateScanLimit: number;
  private readonly jobTypes?: readonly string[];
  private readonly jobTypePrefixes: readonly string[];
  private readonly logger?: RuntimeWorkerLogger;
  private readonly eventBus?: CoreEventBus;

  private pollTimer: NodeJS.Timeout | undefined;
  private started = false;
  private pumping = false;
  private readonly activeJobs = new Map<string, Promise<void>>();

  constructor(
    private readonly db: AppDb,
    private readonly catalog: RuntimeJobCatalog,
    private readonly processors: RuntimeJobProcessorRegistry,
    options: RuntimeWorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `runtime-worker-${nanoid(8)}`;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.maxConcurrentJobs = Math.max(1, options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.candidateScanLimit = Math.max(1, options.candidateScanLimit ?? DEFAULT_CANDIDATE_SCAN_LIMIT);
    this.jobTypes = options.jobTypes?.length ? [...options.jobTypes] : undefined;
    this.jobTypePrefixes = options.jobTypePrefixes?.length ? [...options.jobTypePrefixes] : [];
    this.logger = options.logger;
    this.eventBus = options.eventBus;
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

    await this.emitJobEvent("runtime.job_leased", leased.job, { workerId: this.workerId });
    await this.processLeasedJob(leased);
    return true;
  }

  get activeJobCount(): number {
    return this.activeJobs.size;
  }

  private async emitJobEvent(
    name: Parameters<typeof emitRuntimeJobEvent>[1],
    job: RuntimeJobRecord,
    overrides: Parameters<typeof emitRuntimeJobEvent>[3] = {},
  ): Promise<void> {
    await emitRuntimeJobEvent(this.eventBus, name, job, overrides);
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

        await this.emitJobEvent("runtime.job_leased", leased.job, { workerId: this.workerId });
        const promise = this.processLeasedJob(leased)
          .catch((error) => {
            this.logger?.error?.({ err: error, jobId: leased.job.id }, "runtime worker job failed");
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

  private tryLeaseNextJob(tx: DbExecutor, now: number): LeasedRuntimeJob | null {
    let builder = tx
      .select()
      .from(runtimeJobs)
      .where(and(
        inArray(runtimeJobs.status, CANDIDATE_JOB_STATUSES),
        lte(runtimeJobs.availableAt, now),
        or(
          isNull(runtimeJobs.leaseUntil),
          lte(runtimeJobs.leaseUntil, now),
        ),
        this.jobTypes && this.jobTypes.length > 0
          ? inArray(runtimeJobs.jobType, [...this.jobTypes])
          : undefined,
      ))
      .orderBy(asc(runtimeJobs.availableAt), asc(runtimeJobs.createdAt))
      .limit(this.candidateScanLimit)
      .$dynamic();

    const candidates = builder.all();

    for (const candidate of candidates) {
      if (!matchesPrefixes(candidate.jobType, this.jobTypePrefixes)) {
        continue;
      }

      const leased = this.tryLeaseCandidate(tx, candidate, now);
      if (leased) {
        return leased;
      }
    }

    return null;
  }

  private tryLeaseCandidate(
    tx: DbExecutor,
    candidate: RuntimeJobRecord,
    now: number,
  ): LeasedRuntimeJob | null {
    const blockingOlderJob = tx
      .select({ id: runtimeJobs.id, status: runtimeJobs.status })
      .from(runtimeJobs)
      .where(and(
        eq(runtimeJobs.accountId, candidate.accountId),
        eq(runtimeJobs.scopeType, candidate.scopeType),
        eq(runtimeJobs.scopeKey, candidate.scopeKey),
        lt(runtimeJobs.createdAt, candidate.createdAt),
      ))
      .orderBy(asc(runtimeJobs.createdAt))
      .all()
      .find((job) => !TERMINAL_JOB_STATUSES.includes(job.status));

    if (blockingOlderJob) {
      return null;
    }

    const scopeRef = {
      accountId: candidate.accountId,
      scopeType: candidate.scopeType,
      scopeKey: candidate.scopeKey,
    } as const;
    const leaseUntil = now + this.leaseTtlMs;
    const leasedScope = this.scopeStates.tryLease(tx, scopeRef, this.workerId, now, leaseUntil);
    if (!leasedScope) {
      return null;
    }

    const updateResult = tx.update(runtimeJobs)
      .set({
        status: "leased",
        basedOnRevision: leasedScope.revision,
        leaseOwner: this.workerId,
        leaseUntil,
        updatedAt: now,
        finishedAt: null,
      })
      .where(and(
        eq(runtimeJobs.id, candidate.id),
        lte(runtimeJobs.availableAt, now),
        or(
          eq(runtimeJobs.status, "pending"),
          eq(runtimeJobs.status, "retry_waiting"),
          and(eq(runtimeJobs.status, "leased"), lte(runtimeJobs.leaseUntil, now)),
          and(eq(runtimeJobs.status, "running"), lte(runtimeJobs.leaseUntil, now)),
        ),
        or(
          isNull(runtimeJobs.leaseUntil),
          lte(runtimeJobs.leaseUntil, now),
          eq(runtimeJobs.leaseOwner, this.workerId),
        ),
      ))
      .run();

    if (updateResult.changes !== 1) {
      this.scopeStates.releaseLease(tx, scopeRef, this.workerId, now);
      return null;
    }

    return {
      job: {
        ...candidate,
        status: "leased",
        basedOnRevision: leasedScope.revision,
        leaseOwner: this.workerId,
        leaseUntil,
        updatedAt: now,
        finishedAt: null,
      },
      scopeRef,
      leasedFromStatus: candidate.status,
    };
  }

  private async processLeasedJob(leased: LeasedRuntimeJob): Promise<void> {
    let job = leased.job;
    const scopeRef = leased.scopeRef;

    try {
      const definition = this.catalog.get(job.jobType);
      const processor = this.processors.get(job.jobType);
      const shouldRecoverExpiredRunning = leased.leasedFromStatus === "running"
        && definition.expiredRunningPolicy === "mark_uncertain";

      if (shouldRecoverExpiredRunning && !processor.recoverExpiredRunning) {
        throw new RuntimeJobFatalError(
          `Runtime job processor '${job.jobType}' does not implement recoverExpiredRunning() for conservative expired running recovery`,
        );
      }

      let payload: unknown;
      let prepared: unknown;

      if (shouldRecoverExpiredRunning) {
        payload = this.catalog.parsePayload(job.jobType, job.payloadJson);
      } else {
        job = await this.markRunning(job, scopeRef);
        payload = this.catalog.parsePayload(job.jobType, job.payloadJson);
        const executionContext = this.createExecutionContext(
          scopeRef,
          () => job,
          (updatedJob) => {
            job = updatedJob;
          },
        );

        prepared = await processor.prepare({
          db: this.db,
          job,
          payload,
          workerId: this.workerId,
          leaseTtlMs: this.leaseTtlMs,
          readState: <T>() => parseJobJson<T>(job.stateJson),
          heartbeat: executionContext.heartbeat,
          updateProgress: executionContext.updateProgress,
          withHeartbeat: <T>(execute: (context: RuntimeJobExecutionContext) => Promise<T>) =>
            this.withJobHeartbeat(executionContext, execute),
        });
      }

      const completedAt = Date.now();
      const expectedRevision = job.basedOnRevision ?? 0;
      const revisionSnapshot = this.revisionGuard.snapshot(scopeRef, expectedRevision);
      let afterCommit: (() => Promise<void> | void) | undefined;

      job = this.db.transaction((tx) => {
        const scopeState = this.scopeStates.ensure(tx, scopeRef, completedAt);
        this.revisionGuard.assertExpected(revisionSnapshot, scopeState.revision);

        const commitResult = shouldRecoverExpiredRunning
          ? processor.recoverExpiredRunning!({
              tx,
              db: this.db,
              job,
              payload,
              scopeRef,
              scopeState,
              workerId: this.workerId,
              recoveredAt: completedAt,
            })
          : processor.commit({
              tx,
              db: this.db,
              job,
              payload,
              prepared,
              scopeRef,
              scopeState,
              workerId: this.workerId,
              completedAt,
              readState: <T>() => parseJobJson<T>(job.stateJson),
            });

        afterCommit = commitResult.afterCommit;
        this.scopeStates.finalizeSuccess(tx, {
          ref: scopeRef,
          expectedRevision,
          workerId: this.workerId,
          completedAt,
          scopeMutation: commitResult.scopeMutation ?? "none",
          scopeMetadata: commitResult.scopeMetadata,
          scopeMetadataMode: commitResult.scopeMetadataMode ?? "merge",
          lastProcessedAt: commitResult.lastProcessedAt ?? completedAt,
          lastSuccessJobId: job.id,
        });

        return this.finalizeSuccessfulJob(tx, job, commitResult, completedAt);
      });

      if (afterCommit) {
        await afterCommit();
      }

      await this.emitJobEvent("runtime.job_succeeded", job, {
        workerId: this.workerId,
        finishedAt: job.finishedAt,
        durationMs: typeof job.startedAt === "number" && typeof job.finishedAt === "number" ? Math.max(0, job.finishedAt - job.startedAt) : null,
      });

      this.logger?.info?.({
        jobId: job.id,
        jobType: job.jobType,
        scopeType: job.scopeType,
        scopeKey: job.scopeKey,
        attemptCount: job.attemptCount,
        workerId: this.workerId,
        phase: job.phase,
      }, "runtime worker job succeeded");
    } catch (error) {
      await this.handleJobFailure(job, scopeRef, error);
    }
  }

  private async markRunning(
    job: RuntimeJobRecord,
    scopeRef: RuntimeScopeRef,
  ): Promise<RuntimeJobRecord> {
    const now = Date.now();
    const leaseUntil = now + this.leaseTtlMs;

    this.db.transaction((tx) => {
      this.scopeStates.renewLease(tx, scopeRef, this.workerId, now, leaseUntil);
      const updateResult = tx.update(runtimeJobs)
        .set({
          status: "running",
          attemptCount: job.attemptCount + 1,
          startedAt: job.startedAt ?? now,
          leaseUntil,
          updatedAt: now,
        })
        .where(and(
          eq(runtimeJobs.id, job.id),
          eq(runtimeJobs.status, "leased"),
          eq(runtimeJobs.leaseOwner, this.workerId),
        ))
        .run();

      if (updateResult.changes !== 1) {
        throw new RuntimeJobLeaseLostError(`Failed to mark runtime job '${job.id}' as running`);
      }
    });

    const updatedJob: RuntimeJobRecord = {
      ...job,
      status: "running",
      attemptCount: job.attemptCount + 1,
      startedAt: job.startedAt ?? now,
      leaseUntil,
      updatedAt: now,
    };

    await this.emitJobEvent("runtime.job_started", updatedJob, { workerId: this.workerId });

    return updatedJob;
  }

  private async heartbeatRunningJob(
    job: RuntimeJobRecord,
    scopeRef: RuntimeScopeRef,
  ): Promise<RuntimeJobRecord> {
    const now = Date.now();
    const leaseUntil = now + this.leaseTtlMs;

    this.db.transaction((tx) => {
      this.scopeStates.renewLease(tx, scopeRef, this.workerId, now, leaseUntil);
      const updateResult = tx.update(runtimeJobs)
        .set({
          leaseUntil,
          updatedAt: now,
        })
        .where(and(
          eq(runtimeJobs.id, job.id),
          eq(runtimeJobs.status, "running"),
          eq(runtimeJobs.leaseOwner, this.workerId),
        ))
        .run();

      if (updateResult.changes !== 1) {
        throw new RuntimeJobLeaseLostError(`Failed to renew runtime job '${job.id}' heartbeat`);
      }
    });

    return {
      ...job,
      leaseUntil,
      updatedAt: now,
    };
  }

  private createExecutionContext(
    scopeRef: RuntimeScopeRef,
    getJob: () => RuntimeJobRecord,
    setJob: (job: RuntimeJobRecord) => void,
  ): RuntimeJobExecutionContext {
    let updateQueue: Promise<RuntimeJobRecord> = Promise.resolve(getJob());

    const runUpdate = async (
      updater: (job: RuntimeJobRecord) => Promise<RuntimeJobRecord>,
    ): Promise<void> => {
      updateQueue = updateQueue.then(async (currentJob) => {
        const updatedJob = await updater(currentJob);
        setJob(updatedJob);
        return updatedJob;
      });

      await updateQueue;
    };

    return {
      heartbeat: async () => {
        await runUpdate((currentJob) => this.heartbeatRunningJob(currentJob, scopeRef));
      },
      updateProgress: async (update) => {
        await runUpdate((currentJob) => this.updateRunningJob(currentJob, scopeRef, update));
      },
    };
  }

  private async withJobHeartbeat<T>(
    context: RuntimeJobExecutionContext,
    execute: (context: RuntimeJobExecutionContext) => Promise<T>,
  ): Promise<T> {
    const intervalMs = this.computeHeartbeatIntervalMs();
    let active = true;
    let heartbeatError: unknown;
    let rejectHeartbeatFailure: ((reason?: unknown) => void) | undefined;
    let inFlightHeartbeat = Promise.resolve();

    const heartbeatFailure = new Promise<never>((_resolve, reject) => {
      rejectHeartbeatFailure = reject;
    });

    const runHeartbeat = () => {
      if (!active || heartbeatError !== undefined) {
        return;
      }

      inFlightHeartbeat = inFlightHeartbeat.then(async () => {
        if (!active || heartbeatError !== undefined) {
          return;
        }

        await context.heartbeat();
      });

      void inFlightHeartbeat.catch((error) => {
        if (heartbeatError !== undefined) {
          return;
        }

        heartbeatError = error;
        rejectHeartbeatFailure?.(error);
      });
    };

    const timer = setInterval(runHeartbeat, intervalMs);
    const execution = Promise.resolve().then(() => execute(context));
    void execution.catch(() => {});

    try {
      const result = await Promise.race([execution, heartbeatFailure]);
      active = false;
      clearInterval(timer);
      await Promise.allSettled([inFlightHeartbeat]);
      if (heartbeatError !== undefined) {
        throw heartbeatError;
      }
      return result;
    } catch (error) {
      active = false;
      clearInterval(timer);
      await Promise.allSettled([inFlightHeartbeat]);
      if (heartbeatError !== undefined) {
        throw heartbeatError;
      }
      throw error;
    }
  }

  private async updateRunningJob(
    job: RuntimeJobRecord,
    scopeRef: RuntimeScopeRef,
    update: RuntimeJobProgressUpdate,
  ): Promise<RuntimeJobRecord> {
    const now = Date.now();
    const leaseUntil = now + this.leaseTtlMs;
    const nextStateJson = mergeJobState(job.stateJson, update.state, update.stateMode ?? "merge");

    this.db.transaction((tx) => {
      this.scopeStates.renewLease(tx, scopeRef, this.workerId, now, leaseUntil);
      const updateResult = tx.update(runtimeJobs)
        .set({
          ...(update.phase !== undefined ? { phase: update.phase } : {}),
          ...(update.progressCurrent !== undefined ? { progressCurrent: update.progressCurrent ?? 0 } : {}),
          ...(update.progressTotal !== undefined ? { progressTotal: update.progressTotal } : {}),
          ...(update.progressMessage !== undefined ? { progressMessage: update.progressMessage } : {}),
          ...(update.state !== undefined ? { stateJson: nextStateJson } : {}),
          leaseUntil,
          updatedAt: now,
        })
        .where(and(
          eq(runtimeJobs.id, job.id),
          eq(runtimeJobs.status, "running"),
          eq(runtimeJobs.leaseOwner, this.workerId),
        ))
        .run();

        if (updateResult.changes !== 1) {
          throw new RuntimeJobLeaseLostError(`Failed to update runtime job '${job.id}' while running`);
        }
    });

    const updatedJob: RuntimeJobRecord = {
      ...job,
      ...(update.phase !== undefined ? { phase: update.phase } : {}),
      ...(update.progressCurrent !== undefined ? { progressCurrent: update.progressCurrent ?? 0 } : {}),
      ...(update.progressTotal !== undefined ? { progressTotal: update.progressTotal } : {}),
      ...(update.progressMessage !== undefined ? { progressMessage: update.progressMessage } : {}),
      ...(update.state !== undefined ? { stateJson: nextStateJson } : {}),
      leaseUntil,
      updatedAt: now,
    };

    await this.emitJobEvent("runtime.job_progress_updated", updatedJob, { workerId: this.workerId });

    return updatedJob;
  }

  private finalizeSuccessfulJob(
    tx: DbExecutor,
    job: RuntimeJobRecord,
    result: RuntimeJobCommitResult<any>,
    completedAt: number,
  ): RuntimeJobRecord {
    const nextStateJson = mergeJobState(job.stateJson, result.state, result.stateMode ?? "merge");
    const updateResult = tx.update(runtimeJobs)
      .set({
        status: "succeeded",
        phase: result.phase ?? job.phase,
        stateJson: result.state !== undefined ? nextStateJson : job.stateJson,
        resultJson: result.result !== undefined ? JSON.stringify(result.result) : job.resultJson,
        progressCurrent: result.progressCurrent ?? job.progressCurrent,
        progressTotal: result.progressTotal !== undefined ? result.progressTotal : job.progressTotal,
        progressMessage: result.progressMessage !== undefined ? result.progressMessage : job.progressMessage,
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
        lastErrorCode: null,
        lastErrorClass: null,
        finishedAt: completedAt,
        updatedAt: completedAt,
      })
      .where(and(
        eq(runtimeJobs.id, job.id),
        eq(runtimeJobs.status, job.status),
        eq(runtimeJobs.leaseOwner, this.workerId),
      ))
      .run();

    if (updateResult.changes !== 1) {
      throw new RuntimeJobLeaseLostError(`Failed to finalize runtime job '${job.id}'`);
    }

    return {
      ...job,
      status: "succeeded",
      phase: result.phase ?? job.phase,
      stateJson: result.state !== undefined ? nextStateJson : job.stateJson,
      resultJson: result.result !== undefined ? JSON.stringify(result.result) : job.resultJson,
      progressCurrent: result.progressCurrent ?? job.progressCurrent,
      progressTotal: result.progressTotal !== undefined ? result.progressTotal : job.progressTotal,
      progressMessage: result.progressMessage !== undefined ? result.progressMessage : job.progressMessage,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      lastErrorCode: null,
      lastErrorClass: null,
      finishedAt: completedAt,
      updatedAt: completedAt,
    };
  }

  private async handleJobFailure(
    job: RuntimeJobRecord,
    scopeRef: RuntimeScopeRef,
    error: unknown,
  ): Promise<void> {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const now = Date.now();
    const errorCode = typeof (normalizedError as { code?: unknown }).code === "string"
      ? (normalizedError as unknown as { code: string }).code
      : null;
    const errorClass = normalizedError.constructor?.name ?? "Error";

    const isFatal = normalizedError instanceof RuntimeJobFatalError;
    const isUncertain = normalizedError instanceof RuntimeJobUncertainOutcomeError;
    const isLeaseLost = normalizedError instanceof RuntimeJobLeaseLostError;
    const isFastRetry = normalizedError instanceof RuntimeJobLeaseLostError
      || normalizedError instanceof RuntimeRevisionConflictError
      || normalizedError instanceof ResourceBusyError;
    const canRetry = !isFatal
      && !isUncertain
      && job.attemptCount < job.maxAttempts;

    if (isLeaseLost) {
      await this.emitJobEvent("runtime.job_lease_lost", job, {
        workerId: this.workerId,
        errorCode,
        errorClass,
        message: normalizedError.message,
      });
    }

    if (canRetry) {
      const availableAt = now + this.computeRetryDelayMs(job.attemptCount, normalizedError, isFastRetry);
      const updateResult = this.db.transaction((tx) => {
        this.scopeStates.releaseLease(tx, scopeRef, this.workerId, now);
        return tx.update(runtimeJobs)
          .set({
            status: "retry_waiting",
            availableAt,
            leaseOwner: null,
            leaseUntil: null,
            lastError: normalizedError.message,
            lastErrorCode: errorCode,
            lastErrorClass: errorClass,
            updatedAt: now,
            finishedAt: null,
          })
          .where(and(
            eq(runtimeJobs.id, job.id),
            eq(runtimeJobs.leaseOwner, this.workerId),
          ))
          .run();
      });

      if (updateResult.changes !== 1) {
        return;
      }

      const updatedJob: RuntimeJobRecord = {
        ...job,
        status: "retry_waiting",
        availableAt,
        leaseOwner: null,
        leaseUntil: null,
        lastError: normalizedError.message,
        lastErrorCode: errorCode,
        lastErrorClass: errorClass,
        updatedAt: now,
        finishedAt: null,
      };

      await this.emitJobEvent("runtime.job_retry_scheduled", updatedJob, {
        workerId: this.workerId,
        errorCode,
        errorClass,
        message: normalizedError.message,
        retryAt: availableAt,
      });

      this.logger?.warn?.({
        err: normalizedError,
        jobId: job.id,
        jobType: job.jobType,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        retryAt: availableAt,
        workerId: this.workerId,
        errorCode,
        errorClass,
      }, "runtime worker job scheduled for retry");
      return;
    }

    const updateResult = this.db.transaction((tx) => {
      this.scopeStates.releaseLease(tx, scopeRef, this.workerId, now);
      return tx.update(runtimeJobs)
        .set({
          status: "dead_letter",
          leaseOwner: null,
          leaseUntil: null,
          lastError: normalizedError.message,
          lastErrorCode: errorCode,
          lastErrorClass: errorClass,
          finishedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(runtimeJobs.id, job.id),
          eq(runtimeJobs.leaseOwner, this.workerId),
        ))
        .run();
    });

    if (updateResult.changes !== 1) {
      return;
    }

    const updatedJob: RuntimeJobRecord = {
      ...job,
      status: "dead_letter",
      leaseOwner: null,
      leaseUntil: null,
      lastError: normalizedError.message,
      lastErrorCode: errorCode,
      lastErrorClass: errorClass,
      finishedAt: now,
      updatedAt: now,
    };

    await this.emitJobEvent("runtime.job_dead_lettered", updatedJob, {
      workerId: this.workerId,
      errorCode,
      errorClass,
      message: normalizedError.message,
      finishedAt: now,
      durationMs: typeof job.startedAt === "number" ? Math.max(0, now - job.startedAt) : null,
    });

    this.logger?.error?.({
      err: normalizedError,
      jobId: job.id,
      jobType: job.jobType,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      workerId: this.workerId,
      errorCode,
      errorClass,
    }, "runtime worker job moved to dead letter");
  }

  private computeHeartbeatIntervalMs(): number {
    return Math.max(1, Math.floor(this.leaseTtlMs / 3));
  }

  private computeRetryDelayMs(
    attemptCount: number,
    error: Error,
    isFastRetry: boolean,
  ): number {
    if (isFastRetry || error instanceof RuntimeJobRetryableError) {
      return Math.min(this.maxRetryDelayMs, this.retryBaseDelayMs);
    }

    const exponent = Math.max(0, attemptCount - 1);
    return Math.min(this.maxRetryDelayMs, this.retryBaseDelayMs * (2 ** exponent));
  }
}

export function readRuntimeScopeMetadata(
  job: RuntimeJobRecord,
): Record<string, unknown> {
  return parseRuntimeScopeMetadata(job.stateJson);
}
