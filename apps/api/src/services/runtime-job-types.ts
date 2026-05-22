import type { ZodTypeAny } from "zod";

import type { AppDb, DbExecutor } from "../db/client.js";
import { runtimeJobs, runtimeScopeStates } from "../db/schema.js";

export const RUNTIME_JOB_STATUSES = [
  "pending",
  "leased",
  "running",
  "retry_waiting",
  "succeeded",
  "dead_letter",
  "cancelled",
] as const;

export type RuntimeJobStatus = (typeof RUNTIME_JOB_STATUSES)[number];

export type RuntimeExpiredRunningPolicy = "replay" | "mark_uncertain";

export type RuntimeScopeMutation = "none" | "changed";

export interface RuntimeScopeRef {
  accountId: string;
  scopeType: string;
  scopeKey: string;
}

export type RuntimeJobRecord = typeof runtimeJobs.$inferSelect;
export type RuntimeScopeStateRecord = typeof runtimeScopeStates.$inferSelect;

export interface RuntimeJobDefinition<TPayload = unknown> {
  jobType: string;
  payloadSchema: ZodTypeAny;
  defaultMaxAttempts?: number;
  initialPhase?: string | null;
  expiredRunningPolicy?: RuntimeExpiredRunningPolicy;
  createJobId?: (input: {
    jobType: string;
    payload: TPayload;
    requestedId?: string;
    dedupeKey?: string | null;
  }) => string;
}

export interface EnqueueRuntimeJobInput<TPayload = unknown> {
  jobId?: string;
  jobType: string;
  accountId: string;
  scopeType: string;
  scopeKey: string;
  sessionId?: string | null;
  floorId?: string | null;
  pageId?: string | null;
  payload: TPayload;
  availableAt?: number;
  maxAttempts?: number;
  phase?: string | null;
  state?: unknown;
  result?: unknown;
  dedupeKey?: string | null;
  progressCurrent?: number;
  progressTotal?: number | null;
  progressMessage?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  actorClientId?: string | null;
  sourceEventId?: string | null;
  agentTypeId?: string | null;
  agentBindingId?: string | null;
}

export interface EnqueueRuntimeJobResult {
  jobId: string;
  created: boolean;
  dedupeKey?: string | null;
}

export interface RuntimeJobProgressUpdate {
  phase?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  progressMessage?: string | null;
  state?: unknown;
  stateMode?: "replace" | "merge";
}

export interface RuntimeJobExecutionContext {
  heartbeat(): Promise<void>;
  updateProgress(update: RuntimeJobProgressUpdate): Promise<void>;
}

export interface RuntimeJobPrepareContext<TPayload> extends RuntimeJobExecutionContext {
  db: AppDb;
  job: RuntimeJobRecord;
  payload: TPayload;
  workerId: string;
  leaseTtlMs: number;
  readState<T = unknown>(): T | null;
  withHeartbeat<T = unknown>(
    fn: (context: RuntimeJobExecutionContext) => Promise<T>,
  ): Promise<T>;
}

export interface RuntimeJobCommitContext<TPayload, TPrepared> {
  tx: DbExecutor;
  db: AppDb;
  job: RuntimeJobRecord;
  payload: TPayload;
  prepared: TPrepared;
  scopeRef: RuntimeScopeRef;
  scopeState: RuntimeScopeStateRecord;
  workerId: string;
  completedAt: number;
  readState<T = unknown>(): T | null;
}

export interface RuntimeJobExpiredRunningContext<TPayload> {
  tx: DbExecutor;
  db: AppDb;
  job: RuntimeJobRecord;
  payload: TPayload;
  scopeRef: RuntimeScopeRef;
  scopeState: RuntimeScopeStateRecord;
  workerId: string;
  recoveredAt: number;
}

export interface RuntimeJobCommitResult<TResult = unknown> {
  phase?: string | null;
  state?: unknown;
  stateMode?: "replace" | "merge";
  result?: TResult;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  progressMessage?: string | null;
  scopeMutation?: RuntimeScopeMutation;
  scopeMetadata?: Record<string, unknown> | null;
  scopeMetadataMode?: "replace" | "merge";
  lastProcessedAt?: number | null;
  afterCommit?: (() => Promise<void> | void) | undefined;
}

export interface RuntimeJobProcessor<
  TPayload = unknown,
  TPrepared = unknown,
  TResult = unknown,
> {
  prepare(context: RuntimeJobPrepareContext<TPayload>): Promise<TPrepared>;
  commit(context: RuntimeJobCommitContext<TPayload, TPrepared>): RuntimeJobCommitResult<TResult>;
  recoverExpiredRunning?(
    context: RuntimeJobExpiredRunningContext<TPayload>,
  ): RuntimeJobCommitResult<TResult>;
}
