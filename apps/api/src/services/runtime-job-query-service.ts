import { and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { CoreEventBus } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { runtimeJobs, runtimeScopeStates } from "../db/schema.js";
import { RuntimeJobCatalog } from "./runtime-job-catalog.js";
import { emitRuntimeJobEvent } from "./runtime-job-events.js";
import { parseRuntimeScopeMetadata } from "./runtime-scope-state-repository.js";
import type {
  RuntimeJobRecord,
  RuntimeJobStatus,
  RuntimeScopeStateRecord,
} from "./runtime-job-types.js";

export type RuntimeJobSortBy = "created_at" | "updated_at" | "available_at";
export type RuntimeScopeSortBy = "updated_at" | "revision" | "last_processed_at";
export type RuntimeSortOrder = "asc" | "desc";

export interface RuntimeJobView {
  id: string;
  jobType: string;
  accountId: string;
  scopeType: string;
  scopeKey: string;
  sessionId: string | null;
  floorId: string | null;
  pageId: string | null;
  status: RuntimeJobStatus;
  phase: string | null;
  payload: unknown;
  state: unknown;
  result: unknown;
  attemptCount: number;
  maxAttempts: number;
  availableAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  basedOnRevision: number | null;
  dedupeKey: string | null;
  progressCurrent: number;
  progressTotal: number | null;
  progressMessage: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastErrorClass: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RuntimeScopeStateView {
  accountId: string;
  scopeType: string;
  scopeKey: string;
  revision: number;
  leaseOwner: string | null;
  leaseUntil: number | null;
  lastProcessedAt: number | null;
  lastSuccessJobId: string | null;
  metadata: Record<string, unknown>;
  updatedAt: number;
}

export interface RuntimeJobListQuery {
  accountId: string;
  scopeType?: string;
  scopeKey?: string;
  scopeKeyPrefix?: string;
  jobType?: string;
  jobTypePrefix?: string;
  sessionId?: string;
  status?: RuntimeJobStatus;
  createdFrom?: number;
  createdTo?: number;
  availableFrom?: number;
  availableTo?: number;
  limit?: number;
  offset?: number;
  sortBy?: RuntimeJobSortBy;
  sortOrder?: RuntimeSortOrder;
}

export interface RuntimeScopeListQuery {
  accountId: string;
  scopeType?: string;
  scopeKey?: string;
  scopeKeyPrefix?: string;
  limit?: number;
  offset?: number;
  sortBy?: RuntimeScopeSortBy;
  sortOrder?: RuntimeSortOrder;
}

export interface RuntimeJobMutationInput {
  accountId: string;
  jobId: string;
  scopeType?: string;
}

export interface RuntimeJobRetryInput extends RuntimeJobMutationInput {
  phase?: string | null;
  progressCurrent?: number;
  progressTotal?: number | null;
  progressMessage?: string | null;
  message?: string | null;
}

export interface RuntimeJobMutationResult {
  previousStatus: RuntimeJobStatus;
  job: RuntimeJobView;
}

export class RuntimeJobQueryServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeJobQueryServiceError";
  }
}

export class RuntimeJobNotFoundError extends RuntimeJobQueryServiceError {
  constructor(public readonly jobId: string) {
    super(`Runtime job not found: ${jobId}`);
    this.name = "RuntimeJobNotFoundError";
  }
}

export class RuntimeJobInvalidStateError extends RuntimeJobQueryServiceError {
  constructor(
    public readonly jobId: string,
    public readonly currentStatus: RuntimeJobStatus,
    public readonly allowedStatuses: readonly RuntimeJobStatus[],
    action: "cancel" | "retry",
  ) {
    super(`Cannot ${action} runtime job '${jobId}' while status is '${currentStatus}'. Allowed: ${allowedStatuses.join(", ")}`);
    this.name = "RuntimeJobInvalidStateError";
  }
}

function safeParseJson(value: string | null | undefined): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toRuntimeJobView(row: RuntimeJobRecord): RuntimeJobView {
  return {
    id: row.id,
    jobType: row.jobType,
    accountId: row.accountId,
    scopeType: row.scopeType,
    scopeKey: row.scopeKey,
    sessionId: row.sessionId,
    floorId: row.floorId,
    pageId: row.pageId,
    status: row.status,
    phase: row.phase,
    payload: safeParseJson(row.payloadJson),
    state: safeParseJson(row.stateJson),
    result: safeParseJson(row.resultJson),
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    leaseOwner: row.leaseOwner,
    leaseUntil: row.leaseUntil,
    basedOnRevision: row.basedOnRevision,
    dedupeKey: row.dedupeKey,
    progressCurrent: row.progressCurrent,
    progressTotal: row.progressTotal,
    progressMessage: row.progressMessage,
    lastError: row.lastError,
    lastErrorCode: row.lastErrorCode,
    lastErrorClass: row.lastErrorClass,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRuntimeScopeStateView(row: RuntimeScopeStateRecord): RuntimeScopeStateView {
  return {
    accountId: row.accountId,
    scopeType: row.scopeType,
    scopeKey: row.scopeKey,
    revision: row.revision,
    leaseOwner: row.leaseOwner,
    leaseUntil: row.leaseUntil,
    lastProcessedAt: row.lastProcessedAt,
    lastSuccessJobId: row.lastSuccessJobId,
    metadata: parseRuntimeScopeMetadata(row.metadataJson),
    updatedAt: row.updatedAt,
  };
}

function jobOrderBy(sortBy: RuntimeJobSortBy, sortOrder: RuntimeSortOrder) {
  const column = sortBy === "updated_at"
    ? runtimeJobs.updatedAt
    : sortBy === "available_at"
      ? runtimeJobs.availableAt
      : runtimeJobs.createdAt;
  return sortOrder === "asc" ? asc(column) : desc(column);
}

function scopeOrderBy(sortBy: RuntimeScopeSortBy, sortOrder: RuntimeSortOrder) {
  const column = sortBy === "revision"
    ? runtimeScopeStates.revision
    : sortBy === "last_processed_at"
      ? runtimeScopeStates.lastProcessedAt
      : runtimeScopeStates.updatedAt;
  return sortOrder === "asc" ? asc(column) : desc(column);
}

export interface RuntimeJobQueryServiceOptions {
  catalog?: RuntimeJobCatalog;
  eventBus?: CoreEventBus;
}

export class RuntimeJobQueryService {
  private readonly catalog?: RuntimeJobCatalog;
  private readonly eventBus?: CoreEventBus;

  constructor(
    private readonly db: AppDb,
    options: RuntimeJobQueryServiceOptions = {},
  ) {
    this.catalog = options.catalog;
    this.eventBus = options.eventBus;
  }

  async get(input: RuntimeJobMutationInput): Promise<RuntimeJobView | undefined> {
    const row = await this.findJob(input);
    return row ? toRuntimeJobView(row) : undefined;
  }

  async list(query: RuntimeJobListQuery): Promise<{ jobs: RuntimeJobView[]; total: number }> {
    const limit = Math.max(1, Math.min(100, query.limit ?? 50));
    const offset = Math.max(0, query.offset ?? 0);
    const sortBy = query.sortBy ?? "created_at";
    const sortOrder = query.sortOrder ?? "desc";
    const whereClause = and(
      eq(runtimeJobs.accountId, query.accountId),
      query.scopeType ? eq(runtimeJobs.scopeType, query.scopeType) : undefined,
      query.scopeKey ? eq(runtimeJobs.scopeKey, query.scopeKey) : undefined,
      query.scopeKeyPrefix ? sql`${runtimeJobs.scopeKey} like ${`${query.scopeKeyPrefix}%`}` : undefined,
      query.jobType ? eq(runtimeJobs.jobType, query.jobType) : undefined,
      query.jobTypePrefix ? sql`${runtimeJobs.jobType} like ${`${query.jobTypePrefix}%`}` : undefined,
      query.sessionId ? eq(runtimeJobs.sessionId, query.sessionId) : undefined,
      query.status ? eq(runtimeJobs.status, query.status) : undefined,
      query.createdFrom !== undefined ? gte(runtimeJobs.createdAt, query.createdFrom) : undefined,
      query.createdTo !== undefined ? lte(runtimeJobs.createdAt, query.createdTo) : undefined,
      query.availableFrom !== undefined ? gte(runtimeJobs.availableAt, query.availableFrom) : undefined,
      query.availableTo !== undefined ? lte(runtimeJobs.availableAt, query.availableTo) : undefined,
    );

    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(runtimeJobs)
        .where(whereClause)
        .orderBy(jobOrderBy(sortBy, sortOrder))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(runtimeJobs)
        .where(whereClause),
    ]);

    return {
      jobs: rows.map(toRuntimeJobView),
      total: Number(totals[0]?.total ?? 0),
    };
  }

  async listScopes(query: RuntimeScopeListQuery): Promise<{ scopes: RuntimeScopeStateView[]; total: number }> {
    const limit = Math.max(1, Math.min(100, query.limit ?? 50));
    const offset = Math.max(0, query.offset ?? 0);
    const sortBy = query.sortBy ?? "updated_at";
    const sortOrder = query.sortOrder ?? "desc";
    const whereClause = and(
      eq(runtimeScopeStates.accountId, query.accountId),
      query.scopeType ? eq(runtimeScopeStates.scopeType, query.scopeType) : undefined,
      query.scopeKey ? eq(runtimeScopeStates.scopeKey, query.scopeKey) : undefined,
      query.scopeKeyPrefix ? sql`${runtimeScopeStates.scopeKey} like ${`${query.scopeKeyPrefix}%`}` : undefined,
    );

    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(runtimeScopeStates)
        .where(whereClause)
        .orderBy(scopeOrderBy(sortBy, sortOrder))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(runtimeScopeStates)
        .where(whereClause),
    ]);

    return {
      scopes: rows.map(toRuntimeScopeStateView),
      total: Number(totals[0]?.total ?? 0),
    };
  }

  async cancel(input: RuntimeJobMutationInput): Promise<RuntimeJobMutationResult> {
    const existing = await this.requireJob(input);
    const allowedStatuses: RuntimeJobStatus[] = ["pending", "retry_waiting"];
    if (!allowedStatuses.includes(existing.status)) {
      throw new RuntimeJobInvalidStateError(existing.id, existing.status, allowedStatuses, "cancel");
    }

    const now = Date.now();
    const updatedRows = await this.db.update(runtimeJobs)
      .set({
        status: "cancelled",
        leaseOwner: null,
        leaseUntil: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(runtimeJobs.id, existing.id),
        eq(runtimeJobs.accountId, input.accountId),
        eq(runtimeJobs.status, existing.status),
        input.scopeType ? eq(runtimeJobs.scopeType, input.scopeType) : undefined,
      ))
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      const current = await this.findJob(input);
      if (!current) {
        throw new RuntimeJobNotFoundError(existing.id);
      }

      throw new RuntimeJobInvalidStateError(existing.id, current.status, allowedStatuses, "cancel");
    }

    await emitRuntimeJobEvent(this.eventBus, "runtime.job_cancelled", updated, {
      workerId: null,
      message: "cancelled via runtime management",
      finishedAt: updated.finishedAt,
    });

    return {
      previousStatus: existing.status,
      job: toRuntimeJobView(updated),
    };
  }

  async retry(input: RuntimeJobRetryInput): Promise<RuntimeJobMutationResult> {
    const existing = await this.requireJob(input);
    const allowedStatuses: RuntimeJobStatus[] = ["dead_letter", "cancelled"];
    if (!allowedStatuses.includes(existing.status)) {
      throw new RuntimeJobInvalidStateError(existing.id, existing.status, allowedStatuses, "retry");
    }

    const now = Date.now();
    const definition = this.catalog?.find(existing.jobType);
    const phase = input.phase !== undefined
      ? input.phase
      : definition?.initialPhase ?? existing.phase;
    const progressCurrent = input.progressCurrent ?? 0;
    const progressTotal = input.progressTotal !== undefined ? input.progressTotal : existing.progressTotal;
    const progressMessage = input.progressMessage !== undefined
      ? input.progressMessage
      : definition?.initialPhase ?? existing.progressMessage;

    const updatedRows = await this.db.update(runtimeJobs)
      .set({
        status: "retry_waiting",
        phase,
        attemptCount: 0,
        availableAt: now,
        startedAt: null,
        finishedAt: null,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: null,
        progressCurrent,
        progressTotal,
        progressMessage,
        lastError: null,
        lastErrorCode: null,
        lastErrorClass: null,
        updatedAt: now,
      })
      .where(and(
        eq(runtimeJobs.id, existing.id),
        eq(runtimeJobs.accountId, input.accountId),
        eq(runtimeJobs.status, existing.status),
        input.scopeType ? eq(runtimeJobs.scopeType, input.scopeType) : undefined,
      ))
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      const current = await this.findJob(input);
      if (!current) {
        throw new RuntimeJobNotFoundError(existing.id);
      }

      throw new RuntimeJobInvalidStateError(existing.id, current.status, allowedStatuses, "retry");
    }

    await emitRuntimeJobEvent(this.eventBus, "runtime.job_retry_scheduled", updated, {
      workerId: null,
      message: input.message ?? "manual retry requested",
      retryAt: updated.availableAt,
    });

    return {
      previousStatus: existing.status,
      job: toRuntimeJobView(updated),
    };
  }

  private async findJob(input: RuntimeJobMutationInput): Promise<RuntimeJobRecord | undefined> {
    const [row] = await this.db.select().from(runtimeJobs).where(and(
      eq(runtimeJobs.id, input.jobId),
      eq(runtimeJobs.accountId, input.accountId),
      input.scopeType ? eq(runtimeJobs.scopeType, input.scopeType) : undefined,
    ));

    return row;
  }

  private async requireJob(input: RuntimeJobMutationInput): Promise<RuntimeJobRecord> {
    const row = await this.findJob(input);
    if (!row) {
      throw new RuntimeJobNotFoundError(input.jobId);
    }

    return row;
  }
}
