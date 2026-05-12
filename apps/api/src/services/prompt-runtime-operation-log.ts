import { createHash } from "node:crypto";

import type { DbExecutor } from "../db/client.js";
import {
  OperationLogService,
  type OperationLogActor,
} from "./operation-log-service.js";
import type {
  PromptRuntimePersistedPolicyEnvelope,
  PromptRuntimePersistentPolicy,
} from "./prompt-runtime/control-service.js";
import { VcDiffService } from "./vc-diff-service.js";

export type PromptRuntimePolicyOperationScope = "session" | "branch";

export type PromptRuntimePolicyOperationLogContext = OperationLogActor & {
  requestId?: string | null;
  operationGroupId?: string | null;
  sourceType: string;
  route: string;
};

export type PromptRuntimePolicyOperationRefInput = {
  scope: PromptRuntimePolicyOperationScope;
  sessionId: string;
  branchId?: string | null;
  policy?: PromptRuntimePersistentPolicy;
  envelope?: PromptRuntimePersistedPolicyEnvelope;
};

export type AppendPromptRuntimePolicyOperationLogInput = OperationLogActor & {
  operationId?: string;
  accountId: string;
  operationGroupId?: string | null;
  requestId?: string | null;
  sourceType: string;
  action: string;
  sessionId: string;
  branchId?: string | null;
  scope: PromptRuntimePolicyOperationScope;
  beforeRef?: unknown;
  afterRef?: unknown;
  metadata?: unknown;
  createdAt?: number;
};

export function toPromptRuntimePolicyOperationRef(
  input: PromptRuntimePolicyOperationRefInput,
): Record<string, unknown> {
  const policySummary = summarizePromptRuntimePolicy(input.policy);

  return {
    policy_scope: input.scope,
    session_id: input.sessionId,
    branch_id: input.scope === "branch" ? input.branchId ?? null : null,
    policy_version: input.envelope?.version ?? null,
    policy_updated_at: input.envelope?.updatedAt ?? null,
    policy_updated_by: input.envelope?.updatedBy ?? null,
    ...policySummary,
  };
}

export function appendPromptRuntimePolicyOperationLog(
  tx: DbExecutor,
  input: AppendPromptRuntimePolicyOperationLogInput,
): void {
  const beforeRef = input.beforeRef ?? null;
  const afterRef = input.afterRef ?? null;

  new OperationLogService(tx).append({
    id: input.operationId,
    accountId: input.accountId,
    actorType: input.actorType,
    actorId: input.actorId,
    operationGroupId: input.operationGroupId,
    requestId: input.requestId,
    sourceType: input.sourceType,
    action: input.action,
    status: "succeeded",
    sessionId: input.sessionId,
    branchId: input.scope === "branch" ? input.branchId ?? null : null,
    targetType: "prompt_runtime_policy",
    targetId: buildPromptRuntimePolicyTargetId(input.sessionId, input.scope, input.branchId),
    beforeRef,
    afterRef,
    diff: new VcDiffService().diff(beforeRef, afterRef),
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
}

function summarizePromptRuntimePolicy(policy: PromptRuntimePersistentPolicy | undefined): Record<string, unknown> {
  const policyFields = [
    ...(policy?.structure ? ["structure"] : []),
    ...(policy?.delivery ? ["delivery"] : []),
    ...(policy?.budget ? ["budget"] : []),
    ...(policy?.sourceSelection ? ["sourceSelection"] : []),
    ...(policy?.visibility ? ["visibility"] : []),
  ];

  return {
    policy_present: policy !== undefined,
    policy_fields: policyFields,
    policy_field_count: policyFields.length,
    structure: summarizeStructurePolicy(policy?.structure),
    delivery: summarizeDeliveryPolicy(policy?.delivery),
    budget: summarizeBudgetPolicy(policy?.budget),
    source_selection: summarizeSourceSelectionPolicy(policy?.sourceSelection),
    visibility: summarizeVisibilityPolicy(policy?.visibility),
  };
}

function summarizeStructurePolicy(policy: PromptRuntimePersistentPolicy["structure"] | undefined): Record<string, unknown> | null {
  if (!policy) return null;

  return {
    mode: policy.mode,
    merge_adjacent_same_role: policy.mergeAdjacentSameRole ?? null,
    preserve_system_messages: policy.preserveSystemMessages ?? null,
    assistant_rewrite_strategy: policy.assistantRewriteStrategy ?? null,
  };
}

function summarizeDeliveryPolicy(policy: PromptRuntimePersistentPolicy["delivery"] | undefined): Record<string, unknown> | null {
  if (!policy) return null;

  return {
    allow_assistant_prefill: policy.allowAssistantPrefill ?? null,
    require_last_user: policy.requireLastUser ?? null,
    no_assistant: policy.noAssistant ?? null,
  };
}

function summarizeBudgetPolicy(policy: PromptRuntimePersistentPolicy["budget"] | undefined): Record<string, unknown> | null {
  if (!policy) return null;

  return {
    max_input_tokens: policy.maxInputTokens ?? null,
    reserved_completion_tokens: policy.reservedCompletionTokens ?? null,
  };
}

function summarizeSourceSelectionPolicy(policy: PromptRuntimePersistentPolicy["sourceSelection"] | undefined): Record<string, unknown> | null {
  if (!policy) return null;

  return {
    history: policy.history
      ? {
          mode: policy.history.mode ?? null,
          max_messages: policy.history.maxMessages ?? null,
        }
      : null,
    memory_enabled: policy.memory?.enabled ?? null,
    worldbook_enabled: policy.worldbook?.enabled ?? null,
    examples_enabled: policy.examples?.enabled ?? null,
  };
}

function summarizeVisibilityPolicy(policy: PromptRuntimePersistentPolicy["visibility"] | undefined): Record<string, unknown> | null {
  if (!policy) return null;

  return {
    mode: policy.mode ?? null,
    hidden_floor_range_count: policy.hiddenFloorRanges?.length ?? 0,
    hidden_floor_ranges_hash: hashJsonArray(policy.hiddenFloorRanges),
    visible_floor_range_count: policy.visibleFloorRanges?.length ?? 0,
    visible_floor_ranges_hash: hashJsonArray(policy.visibleFloorRanges),
    hidden_floor_id_count: policy.hiddenFloorIds?.length ?? 0,
    hidden_floor_ids_hash: hashJsonArray(policy.hiddenFloorIds),
  };
}

function buildPromptRuntimePolicyTargetId(
  sessionId: string,
  scope: PromptRuntimePolicyOperationScope,
  branchId: string | null | undefined,
): string {
  return scope === "branch" && branchId ? `${sessionId}:${branchId}` : sessionId;
}

function hashJsonArray(value: unknown[] | readonly unknown[] | undefined): string | null {
  if (value === undefined) return null;
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value === "object" && value !== null && !Array.isArray(value);
}
