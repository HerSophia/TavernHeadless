import type { CoreEventBus, CoreEventMap } from "@tavern/core";

import type { RuntimeJobRecord, RuntimeJobStatus } from "./runtime-job-types.js";

type RuntimeJobEventName =
  | "runtime.job_enqueued"
  | "runtime.job_leased"
  | "runtime.job_started"
  | "runtime.job_progress_updated"
  | "runtime.job_succeeded"
  | "runtime.job_retry_scheduled"
  | "runtime.job_dead_lettered"
  | "runtime.job_cancelled"
  | "runtime.job_lease_lost";

export interface RuntimeJobEventOverrides {
  status?: RuntimeJobStatus;
  phase?: string | null;
  availableAt?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  workerId?: string | null;
  attemptCount?: number;
  progressCurrent?: number;
  progressTotal?: number | null;
  progressMessage?: string | null;
  errorCode?: string | null;
  errorClass?: string | null;
  message?: string | null;
  durationMs?: number | null;
  retryAt?: number;
}

function deriveSessionId(job: RuntimeJobRecord): string | undefined {
  if (typeof job.sessionId === "string" && job.sessionId.length > 0) {
    return job.sessionId;
  }

  if (job.scopeType === "memory" && job.scopeKey.startsWith("chat:")) {
    return job.scopeKey.slice("chat:".length);
  }

  if (job.scopeType === "chat_transfer" && job.scopeKey.startsWith("session:")) {
    return job.scopeKey.slice("session:".length);
  }

  return undefined;
}

function buildDurationMs(
  job: RuntimeJobRecord,
  overrides: RuntimeJobEventOverrides,
): number | null {
  if (overrides.durationMs !== undefined) {
    return overrides.durationMs;
  }

  const startedAt = overrides.startedAt ?? job.startedAt;
  const finishedAt = overrides.finishedAt ?? job.finishedAt;
  if (typeof startedAt !== "number" || typeof finishedAt !== "number") {
    return null;
  }

  return Math.max(0, finishedAt - startedAt);
}

export function buildRuntimeJobEventPayload(
  job: RuntimeJobRecord,
  overrides: RuntimeJobEventOverrides = {},
): CoreEventMap[RuntimeJobEventName] {
  const base = {
    jobId: job.id,
    jobType: job.jobType,
    accountId: job.accountId,
    scopeType: job.scopeType,
    scopeKey: job.scopeKey,
    status: overrides.status ?? job.status,
    phase: overrides.phase ?? job.phase,
    attemptCount: overrides.attemptCount ?? job.attemptCount,
    maxAttempts: job.maxAttempts,
    availableAt: overrides.availableAt ?? job.availableAt,
    startedAt: overrides.startedAt ?? job.startedAt,
    finishedAt: overrides.finishedAt ?? job.finishedAt,
    workerId: overrides.workerId ?? job.leaseOwner ?? null,
    basedOnRevision: job.basedOnRevision,
    dedupeKey: job.dedupeKey,
    progressCurrent: overrides.progressCurrent ?? job.progressCurrent,
    progressTotal: overrides.progressTotal !== undefined ? overrides.progressTotal : job.progressTotal,
    progressMessage: overrides.progressMessage !== undefined ? overrides.progressMessage : job.progressMessage,
    errorCode: overrides.errorCode !== undefined ? overrides.errorCode : job.lastErrorCode,
    errorClass: overrides.errorClass !== undefined ? overrides.errorClass : job.lastErrorClass,
    message: overrides.message !== undefined ? overrides.message : job.lastError,
    durationMs: buildDurationMs(job, overrides),
    sessionId: deriveSessionId(job),
    floorId: job.floorId ?? undefined,
    pageId: job.pageId ?? undefined,
  };

  if (overrides.retryAt !== undefined) {
    return {
      ...base,
      retryAt: overrides.retryAt,
    };
  }

  return base;
}

export async function emitRuntimeJobEvent(
  eventBus: CoreEventBus | undefined,
  name: RuntimeJobEventName,
  job: RuntimeJobRecord,
  overrides: RuntimeJobEventOverrides = {},
): Promise<void> {
  if (!eventBus) {
    return;
  }

  try {
    const payload = buildRuntimeJobEventPayload(job, overrides);
    await eventBus.emit(name as never, payload as never);
  } catch {
    // Runtime 观测事件使用 best-effort 语义，不反向影响作业生命周期。
  }
}
