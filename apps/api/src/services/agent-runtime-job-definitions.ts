import { nanoid } from "nanoid";
import { z } from "zod";

import { RuntimeJobCatalog } from "./runtime-job-catalog.js";
import type { RuntimeJobDefinition } from "./runtime-job-types.js";
import { AGENT_SCOPE_KIND_VALUES } from "./agent-scope-types.js";
import {
  AGENT_STEP_STATE_STATUS_VALUES,
  TOOL_EXECUTION_TRIGGER_SCOPE_VALUES,
} from "./agent-step-state-types.js";

export const AGENT_RUNTIME_SCOPE_TYPE = "agent";

export const AGENT_RUN_JOB_TYPE = "agent.run" as const;

const recordSchema = z.record(z.string(), z.unknown());

const resolvedMcpSchema = z.object({
  mcpServerId: z.string().min(1),
  allowedTools: z.array(z.string()).optional(),
  configOverrideJson: z.record(z.string(), z.unknown()).nullable().optional(),
});

const resolvedSubscriptionSchema = z.object({
  type: z.string().min(1),
  filterJson: z.record(z.string(), z.unknown()).nullable().optional(),
});

const resolvedConfigSchema = z.object({
  llmProfileId: z.string().nullable().optional(),
  toolPolicyId: z.string().nullable().optional(),
  mcpBindings: z.array(resolvedMcpSchema).default([]),
  eventSubscriptions: z.array(resolvedSubscriptionSchema).default([]),
  grants: recordSchema.default({}),
  allowedOutputTargets: z.array(z.string()).default([]),
});

const agentStepStateSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(AGENT_STEP_STATE_STATUS_VALUES),
  triggerScope: z.enum(TOOL_EXECUTION_TRIGGER_SCOPE_VALUES),
  parentRunJobId: z.string().nullable().optional(),
  resumeToken: z.string().nullable().optional(),
  toolExecutionIds: z.array(z.string()).default([]),
});

/**
 * B8-GOV R6-1 nested lineage（缺口 3）。
 *
 * 当后台 Agent 是被另一条运行（例如 NodeGraph run 的 `agent.call` 节点）入队时，
 * 在 payload 上记录父级 run 引用，让运行 trace 查询能从 job 反查到父级 run。
 * graph trace 侧已有 `nestedJobRefs(jobId)`（父 -> 子），本字段补齐子 -> 父方向。
 */
const agentRunLineageSchema = z.object({
  rootRunId: z.string().min(1).nullable().optional(),
  parentRunId: z.string().min(1).nullable().optional(),
  parentRuntimeKind: z.string().min(1).nullable().optional(),
});

export type AgentRunLineage = z.infer<typeof agentRunLineageSchema>;

export const agentRunJobPayloadSchema = z.object({
  accountId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  agentTypeId: z.string().min(1),
  agentBindingId: z.string().min(1),
  sourceEventId: z.string().nullable().optional(),
  actorClientId: z.string().nullable().optional(),
  triggerType: z.enum(["event", "manual"]).default("event"),
  triggerReason: z.string().nullable().optional(),
  scopeKind: z.enum(AGENT_SCOPE_KIND_VALUES),
  resolvedConfig: resolvedConfigSchema,
  dryRun: z.boolean().default(true),
  inputJson: recordSchema.default({}),
  stepState: agentStepStateSchema.optional(),
  lineage: agentRunLineageSchema.optional(),
  provenance: z.object({ triggerScope: z.enum(TOOL_EXECUTION_TRIGGER_SCOPE_VALUES) }).optional(),
});

export type AgentRunJobPayload = z.infer<typeof agentRunJobPayloadSchema>;

export function buildAgentRuntimeScopeKey(input: { workspaceId: string; projectId: string; agentTypeId: string }): string {
  return `${input.workspaceId}:${input.projectId}:${input.agentTypeId}`;
}

export function parseAgentRuntimeScopeKey(scopeKey: string): {
  workspaceId: string;
  projectId: string;
  agentTypeId: string;
} {
  const parts = scopeKey.split(":");
  return {
    workspaceId: parts[0] ?? "",
    projectId: parts[1] ?? "",
    agentTypeId: parts[2] ?? "",
  };
}

export function makeAgentRunJobId(input: {
  agentBindingId: string;
  sourceEventId?: string | null;
  triggerType: "event" | "manual";
}): string {
  const seed = input.sourceEventId && input.sourceEventId.length > 0 ? input.sourceEventId : nanoid(10);
  return `agent-job:${input.triggerType}:${input.agentBindingId}:${seed}`;
}

function createDefinition<TPayload>(definition: RuntimeJobDefinition<TPayload>): RuntimeJobDefinition<TPayload> {
  return definition;
}

export function createAgentRuntimeJobCatalog(): RuntimeJobCatalog {
  const catalog = new RuntimeJobCatalog();

  catalog.register(createDefinition<AgentRunJobPayload>({
    jobType: AGENT_RUN_JOB_TYPE,
    payloadSchema: agentRunJobPayloadSchema,
    defaultMaxAttempts: 3,
    initialPhase: "queued",
    createJobId({ payload }) {
      return makeAgentRunJobId({
        agentBindingId: payload.agentBindingId,
        sourceEventId: payload.sourceEventId ?? null,
        triggerType: payload.triggerType,
      });
    },
  }));

  return catalog;
}
