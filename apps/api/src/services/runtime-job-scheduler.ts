import type { CoreEventBus } from "@tavern/core";
import { and, eq } from "drizzle-orm";

import type { DbExecutor } from "../db/client.js";
import { runtimeJobs } from "../db/schema.js";
import { RuntimeJobCatalog } from "./runtime-job-catalog.js";
import { emitRuntimeJobEvent } from "./runtime-job-events.js";
import type {
  EnqueueRuntimeJobInput,
  EnqueueRuntimeJobResult,
  RuntimeJobRecord,
} from "./runtime-job-types.js";

export interface RuntimeJobSchedulerOptions {
  eventBus?: CoreEventBus;
}

function stringifyJson(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

export class RuntimeJobScheduler {
  private readonly eventBus?: CoreEventBus;

  constructor(
    private readonly catalog: RuntimeJobCatalog,
    options: RuntimeJobSchedulerOptions = {},
  ) {
    this.eventBus = options.eventBus;
  }

  enqueue<TPayload>(
    tx: DbExecutor,
    input: EnqueueRuntimeJobInput<TPayload>,
  ): EnqueueRuntimeJobResult {
    const definition = this.catalog.get<TPayload>(input.jobType);
    const payload = definition.payloadSchema.parse(input.payload);
    const jobId = this.catalog.createJobId(
      input.jobType,
      payload,
      input.jobId,
      input.dedupeKey ?? null,
    );
    const availableAt = input.availableAt ?? Date.now();
    const maxAttempts = Math.max(1, input.maxAttempts ?? definition.defaultMaxAttempts ?? 5);
    const createdAt = availableAt;
    const phase = input.phase ?? definition.initialPhase ?? null;
    const dedupeKey = input.dedupeKey?.trim() ? input.dedupeKey.trim() : null;

    const jobRecord: RuntimeJobRecord = {
      id: jobId,
      jobType: input.jobType,
      accountId: input.accountId,
      scopeType: input.scopeType,
      scopeKey: input.scopeKey,
      sessionId: input.sessionId ?? null,
      floorId: input.floorId ?? null,
      pageId: input.pageId ?? null,
      status: "pending",
      phase,
      payloadJson: JSON.stringify(payload),
      stateJson: stringifyJson(input.state),
      resultJson: stringifyJson(input.result),
      attemptCount: 0,
      maxAttempts,
      availableAt,
      startedAt: null,
      finishedAt: null,
      leaseOwner: null,
      leaseUntil: null,
      basedOnRevision: null,
      dedupeKey,
      progressCurrent: input.progressCurrent ?? 0,
      progressTotal: input.progressTotal ?? null,
      progressMessage: input.progressMessage ?? null,
      lastError: null,
      lastErrorCode: null,
      lastErrorClass: null,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      actorClientId: input.actorClientId ?? null,
      sourceEventId: input.sourceEventId ?? null,
      agentTypeId: input.agentTypeId ?? null,
      agentBindingId: input.agentBindingId ?? null,
      createdAt,
      updatedAt: createdAt,
    };

    const insertResult = tx.insert(runtimeJobs)
      .values({
        id: jobRecord.id,
        jobType: jobRecord.jobType,
        accountId: jobRecord.accountId,
        scopeType: jobRecord.scopeType,
        scopeKey: jobRecord.scopeKey,
        sessionId: jobRecord.sessionId,
        floorId: jobRecord.floorId,
        pageId: jobRecord.pageId,
        status: jobRecord.status,
        phase: jobRecord.phase,
        payloadJson: jobRecord.payloadJson,
        stateJson: jobRecord.stateJson,
        resultJson: jobRecord.resultJson,
        attemptCount: jobRecord.attemptCount,
        maxAttempts: jobRecord.maxAttempts,
        availableAt: jobRecord.availableAt,
        startedAt: jobRecord.startedAt,
        finishedAt: jobRecord.finishedAt,
        leaseOwner: jobRecord.leaseOwner,
        leaseUntil: jobRecord.leaseUntil,
        basedOnRevision: jobRecord.basedOnRevision,
        dedupeKey: jobRecord.dedupeKey,
        progressCurrent: jobRecord.progressCurrent,
        progressTotal: jobRecord.progressTotal,
        progressMessage: jobRecord.progressMessage,
        lastError: jobRecord.lastError,
        lastErrorCode: jobRecord.lastErrorCode,
        lastErrorClass: jobRecord.lastErrorClass,
        workspaceId: jobRecord.workspaceId,
        projectId: jobRecord.projectId,
        actorClientId: jobRecord.actorClientId,
        sourceEventId: jobRecord.sourceEventId,
        agentTypeId: jobRecord.agentTypeId,
        agentBindingId: jobRecord.agentBindingId,
        createdAt: jobRecord.createdAt,
        updatedAt: jobRecord.updatedAt,
      })
      .onConflictDoNothing()
      .run();

    if (insertResult.changes === 1) {
      void emitRuntimeJobEvent(this.eventBus, "runtime.job_enqueued", jobRecord, {
        workerId: null,
        message: "job enqueued",
      });

      return {
        jobId,
        created: true,
        dedupeKey,
      };
    }

    if (dedupeKey) {
      const existing = tx
        .select({ id: runtimeJobs.id })
        .from(runtimeJobs)
        .where(and(
          eq(runtimeJobs.accountId, input.accountId),
          eq(runtimeJobs.jobType, input.jobType),
          eq(runtimeJobs.dedupeKey, dedupeKey),
        ))
        .limit(1)
        .all()[0];

      if (existing) {
        return {
          jobId: existing.id,
          created: false,
          dedupeKey,
        };
      }
    }

    return {
      jobId,
      created: false,
      dedupeKey,
    };
  }
}
