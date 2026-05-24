import { z } from "zod";

import type { ToolExecutionStatus } from "@tavern/core";

import { RuntimeJobCatalog } from "../../runtime-job-catalog.js";
import type { ToolExecutionProvenanceRef } from "../../agent-step-state-types.js";

const TOOL_EXECUTION_PROVIDER_TYPES = ["builtin", "preset", "mcp", "unknown"] as const;
const TOOL_EXECUTION_DELIVERY_MODES = ["inline", "async_job"] as const;
const TOOL_ASYNC_CAPABILITIES = ["inline_only", "deferred_ok"] as const;
const TOOL_RESULT_VISIBILITIES = ["immediate", "deferred_receipt"] as const;
const TOOL_SIDE_EFFECT_LEVELS = ["none", "sandbox", "irreversible"] as const;
const TOOL_CALLER_SLOTS = ["narrator", "director", "verifier", "memory"] as const;
const TOOL_EXECUTION_TRIGGER_SCOPE_VALUES = [
  "chat_turn",
  "manual",
  "unknown",
  "agent_step",
] as const;
const TOOL_RETRYABLE_STATUSES = [
  "running",
  "queued",
  "success",
  "error",
  "denied",
  "timeout",
  "uncertain",
  "blocked",
] as const satisfies readonly ToolExecutionStatus[];

const runtimeToolPolicySnapshotSchema = z.object({
  enableDeferredIrreversibleTools: z.boolean(),
  deferredToolAllowlist: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().nullable().optional(),
  maxAttempts: z.number().int().positive().nullable().optional(),
  retryableStatuses: z.array(z.enum(TOOL_RETRYABLE_STATUSES)).default([]),
  maxDeferredJobsPerRun: z.number().int().positive().nullable().optional(),
  maxIrreversibleCallsPerRun: z.number().int().positive().nullable().optional(),
});

const toolExecutionProvenanceSchema = z.object({
  triggerScope: z.enum(TOOL_EXECUTION_TRIGGER_SCOPE_VALUES),
  stepId: z.string().min(1).optional(),
  parentRunJobId: z.string().min(1).optional(),
  agentBindingId: z.string().min(1).optional(),
  sourceEventId: z.string().min(1).optional(),
});

export const TOOL_RUNTIME_JOB_TYPES = {
  execute: "tool.execute",
} as const;

export const runtimeToolEnvelopeSchema = z.object({
  executionId: z.string().min(1),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  accountId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  floorId: z.string().min(1),
  pageId: z.string().min(1).optional(),
  callerSlot: z.enum(TOOL_CALLER_SLOTS),
  providerId: z.string().min(1),
  providerType: z.enum(TOOL_EXECUTION_PROVIDER_TYPES),
  toolName: z.string().min(1),
  args: z.record(z.unknown()),
  sideEffectLevel: z.enum(TOOL_SIDE_EFFECT_LEVELS),
  deliveryMode: z.enum(TOOL_EXECUTION_DELIVERY_MODES),
  asyncCapability: z.enum(TOOL_ASYNC_CAPABILITIES),
  resultVisibility: z.enum(TOOL_RESULT_VISIBILITIES),
  providerPayload: z.unknown().optional(),
  acceptedAt: z.number().int(),
});

export const toolExecuteJobPayloadSchema = z.object({
  envelope: runtimeToolEnvelopeSchema,
  policy: runtimeToolPolicySnapshotSchema.optional(),
  provenance: toolExecutionProvenanceSchema.optional(),
});

export type ToolExecuteJobPayload = z.infer<typeof toolExecuteJobPayloadSchema>;
export type ToolRuntimeJobProvenance = z.infer<typeof toolExecutionProvenanceSchema>;

export function createToolRuntimeJobCatalog(): RuntimeJobCatalog {
  const catalog = new RuntimeJobCatalog();

  catalog.register<ToolExecuteJobPayload>({
    jobType: TOOL_RUNTIME_JOB_TYPES.execute,
    payloadSchema: toolExecuteJobPayloadSchema,
    defaultMaxAttempts: 3,
    initialPhase: "queued",
    expiredRunningPolicy: "mark_uncertain",
    createJobId({ payload, requestedId }) {
      return requestedId && requestedId.trim().length > 0
        ? requestedId
        : `tool-job:${payload.envelope.executionId}`;
    },
  });

  return catalog;
}
