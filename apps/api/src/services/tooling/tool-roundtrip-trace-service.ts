import { inArray } from "drizzle-orm";
import {
  evaluateExecutedToolCallReplaySafety,
  type ExecutedToolCallRecord,
  type ToolExecutionCommitOutcome,
  type ToolExecutionLifecycleState,
  type ToolExecutionProviderType,
  type ToolExecutionStatus,
  type ToolReplaySafety,
} from "@tavern/core";

import {
  DrizzleToolExecutionRepository,
  type ToolExecutionRecordQuery,
} from "../../adapters/drizzle-tool-execution-repository.js";
import type { AppDb } from "../../db/client.js";
import { parseJsonField } from "../../lib/http.js";
import { runtimeJobs } from "../../db/schema.js";
import type { RuntimeJobRecord, RuntimeJobStatus } from "../runtime-job-types.js";
import type { ToolExecutionProvenanceRef } from "../agent-step-state-types.js";
import {
  toolExecuteJobPayloadSchema,
  type ToolExecuteJobPayload,
} from "./runtime/tool-runtime-job-definitions.js";
import type { ToolRuntimeExecutionPolicySnapshot } from "./runtime/tool-runtime-policy.js";

export interface ToolRoundtripTraceRuntimeJobView {
  id: string | null;
  jobType: string | null;
  status: RuntimeJobStatus | null;
  phase: string | null;
  attemptCount: number | null;
  maxAttempts: number | null;
  availableAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
}

export interface ToolRoundtripTrace {
  executionId: string;
  runId: string;
  floorId: string;
  pageId: string | null;
  callerSlot: string;
  providerId: string;
  providerType: ToolExecutionProviderType;
  toolName: string;
  deliveryMode: "inline" | "async_job";
  status: ToolExecutionStatus;
  lifecycleState: ToolExecutionLifecycleState;
  commitOutcome: ToolExecutionCommitOutcome;
  startedAt: number;
  finishedAt: number | null;
  args: unknown;
  result: unknown;
  sideEffectLevel: string | null;
  errorMessage: string | null;
  durationMs: number;
  attemptNo: number;
  runtimeJobId: string | null;
  replayParentExecutionId: string | null;
  createdAt: number;
  replaySafety: ToolReplaySafety;
  replayReason: string;
  runtimeJob: ToolRoundtripTraceRuntimeJobView;
  policy: ToolRuntimeExecutionPolicySnapshot | null;
  provenance: ToolExecutionProvenanceRef;
  roundtrip: {
    wasAccepted: boolean;
    wasEnqueued: boolean;
    wasStarted: boolean;
    wasCompleted: boolean;
    wasUncertain: boolean;
  };
}

function safeParseToolExecuteJobPayload(
  payloadJson: string | null | undefined,
): ToolExecuteJobPayload | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const value = JSON.parse(payloadJson);
    const parsed = toolExecuteJobPayloadSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function clonePolicySnapshot(
  snapshot: ToolRuntimeExecutionPolicySnapshot,
): ToolRuntimeExecutionPolicySnapshot {
  return {
    ...snapshot,
    deferredToolAllowlist: [...snapshot.deferredToolAllowlist],
    retryableStatuses: [...snapshot.retryableStatuses],
  };
}

function buildRuntimeJobView(
  runtimeJob: RuntimeJobRecord | null,
): ToolRoundtripTraceRuntimeJobView {
  if (!runtimeJob) {
    return {
      id: null,
      jobType: null,
      status: null,
      phase: null,
      attemptCount: null,
      maxAttempts: null,
      availableAt: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
    };
  }

  return {
    id: runtimeJob.id,
    jobType: runtimeJob.jobType,
    status: runtimeJob.status,
    phase: runtimeJob.phase,
    attemptCount: runtimeJob.attemptCount,
    maxAttempts: runtimeJob.maxAttempts,
    availableAt: runtimeJob.availableAt,
    startedAt: runtimeJob.startedAt,
    finishedAt: runtimeJob.finishedAt,
    lastError: runtimeJob.lastError,
  };
}

function buildPolicySnapshot(
  runtimeJob: RuntimeJobRecord | null,
): ToolRuntimeExecutionPolicySnapshot | null {
  const payload = safeParseToolExecuteJobPayload(runtimeJob?.payloadJson);
  return payload?.policy
    ? clonePolicySnapshot({
        enableDeferredIrreversibleTools: payload.policy.enableDeferredIrreversibleTools,
        deferredToolAllowlist: [...payload.policy.deferredToolAllowlist],
        timeoutMs: payload.policy.timeoutMs ?? null,
        maxAttempts: payload.policy.maxAttempts ?? null,
        retryableStatuses: [...payload.policy.retryableStatuses],
        maxDeferredJobsPerRun: payload.policy.maxDeferredJobsPerRun ?? null,
        maxIrreversibleCallsPerRun: payload.policy.maxIrreversibleCallsPerRun ?? null,
      })
    : null;
}

function buildProvenance(
  runtimeJob: RuntimeJobRecord | null,
): ToolExecutionProvenanceRef {
  const payload = safeParseToolExecuteJobPayload(runtimeJob?.payloadJson);
  const provenance = payload?.provenance;

  return {
    triggerScope: provenance?.triggerScope ?? "unknown",
    ...(provenance?.stepId ? { stepId: provenance.stepId } : {}),
    ...(provenance?.parentRunJobId
      ? { parentRunJobId: provenance.parentRunJobId }
      : {}),
    ...(provenance?.agentBindingId
      ? { agentBindingId: provenance.agentBindingId }
      : runtimeJob?.agentBindingId
        ? { agentBindingId: runtimeJob.agentBindingId }
        : {}),
    ...(provenance?.sourceEventId
      ? { sourceEventId: provenance.sourceEventId }
      : runtimeJob?.sourceEventId
        ? { sourceEventId: runtimeJob.sourceEventId }
        : {}),
  };
}

function wasStarted(
  record: ExecutedToolCallRecord,
  runtimeJob: RuntimeJobRecord | null,
): boolean {
  if ((record.deliveryMode ?? "inline") !== "async_job") {
    return record.status !== "denied" && record.status !== "blocked";
  }

  if (record.status !== "queued") {
    return true;
  }

  return runtimeJob !== null
    && runtimeJob.status !== "pending"
    && runtimeJob.status !== "retry_waiting";
}

function wasCompleted(
  record: ExecutedToolCallRecord,
  runtimeJob: RuntimeJobRecord | null,
): boolean {
  if (record.lifecycleState === "finished" && record.status !== "queued") {
    return true;
  }

  return runtimeJob !== null
    && (
      runtimeJob.status === "succeeded"
      || runtimeJob.status === "dead_letter"
      || runtimeJob.status === "cancelled"
    );
}

export class ToolRoundtripTraceService {
  private readonly executionRepo: DrizzleToolExecutionRepository;

  constructor(private readonly db: AppDb) {
    this.executionRepo = new DrizzleToolExecutionRepository(db);
  }

  async list(query: ToolExecutionRecordQuery): Promise<{
    traces: ToolRoundtripTrace[];
    total: number;
  }> {
    const result = await this.executionRepo.query(query);
    const runtimeJobIds = Array.from(new Set(
      result.records
        .map((record) => record.runtimeJobId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ));

    const runtimeJobRows = runtimeJobIds.length > 0
      ? await this.db
          .select()
          .from(runtimeJobs)
          .where(inArray(runtimeJobs.id, runtimeJobIds))
      : [];
    const runtimeJobsById = new Map(runtimeJobRows.map((row) => [row.id, row] as const));

    return {
      traces: result.records.map((record) => {
        const runtimeJob = record.runtimeJobId
          ? runtimeJobsById.get(record.runtimeJobId) ?? null
          : null;
        return this.toTrace(record, runtimeJob);
      }),
      total: result.total,
    };
  }

  private toTrace(
    record: ExecutedToolCallRecord,
    runtimeJob: RuntimeJobRecord | null,
  ): ToolRoundtripTrace {
    const replaySafety = evaluateExecutedToolCallReplaySafety(record);

    return {
      executionId: record.id,
      runId: record.runId,
      floorId: record.floorId,
      pageId: record.pageId ?? null,
      callerSlot: record.callerSlot,
      providerId: record.providerId,
      providerType: record.providerType ?? "unknown",
      toolName: record.toolName,
      deliveryMode: record.deliveryMode ?? "inline",
      status: record.status,
      lifecycleState: record.lifecycleState ?? "finished",
      commitOutcome: record.commitOutcome ?? "pending",
      startedAt: record.startedAt ?? record.createdAt,
      finishedAt: record.finishedAt ?? null,
      args: parseJsonField(record.argsJson),
      result: parseJsonField(record.resultJson),
      sideEffectLevel: record.sideEffectLevel ?? null,
      errorMessage: record.errorMessage ?? null,
      durationMs: record.durationMs,
      attemptNo: record.attemptNo ?? 1,
      runtimeJobId: record.runtimeJobId ?? null,
      replayParentExecutionId: record.replayParentExecutionId ?? null,
      createdAt: record.createdAt,
      replaySafety: replaySafety.replaySafety,
      replayReason: replaySafety.reason,
      runtimeJob: buildRuntimeJobView(runtimeJob),
      policy: buildPolicySnapshot(runtimeJob),
      provenance: buildProvenance(runtimeJob),
      roundtrip: {
        wasAccepted: record.status !== "denied" && record.status !== "blocked",
        wasEnqueued: Boolean(record.runtimeJobId),
        wasStarted: wasStarted(record, runtimeJob),
        wasCompleted: wasCompleted(record, runtimeJob),
        wasUncertain: record.status === "uncertain"
          || (record.commitOutcome ?? "pending") === "uncertain",
      },
    };
  }
}
