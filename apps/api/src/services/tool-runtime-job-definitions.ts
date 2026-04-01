import { z } from "zod";

import { RuntimeJobCatalog } from "./runtime-job-catalog.js";

const TOOL_EXECUTION_PROVIDER_TYPES = ["builtin", "preset", "mcp", "unknown"] as const;
const TOOL_EXECUTION_DELIVERY_MODES = ["inline", "async_job"] as const;
const TOOL_ASYNC_CAPABILITIES = ["inline_only", "deferred_ok"] as const;
const TOOL_RESULT_VISIBILITIES = ["immediate", "deferred_receipt"] as const;
const TOOL_SIDE_EFFECT_LEVELS = ["none", "sandbox", "irreversible"] as const;
const TOOL_CALLER_SLOTS = ["narrator", "director", "verifier", "memory"] as const;

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
});

export type ToolExecuteJobPayload = z.infer<typeof toolExecuteJobPayloadSchema>;

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
