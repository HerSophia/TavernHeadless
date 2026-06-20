/**
 * P9：`TurnAssemblyProcessor` 共享支撑工具。
 *
 * - `computeAssemblyInputHash`：确定性 input-hash（覆盖输入摘要 + recipe kind / version）。
 * - `buildChatTurnGovernanceSummary`：批次 8 统一 `runtime_kind = "chat_turn"` 治理 summary。
 *
 * 这两者被 prompt_mode / composite processor 共用，避免每个 processor 各造一套 hash 与 trace。
 */
import { createHash } from "node:crypto";

import {
  RUNTIME_GOVERNANCE_CONTRACT_VERSION,
  type RuntimeGovernanceRef,
  type RuntimeGovernanceStatus,
  type RuntimeGovernanceTraceSummary,
} from "../governance/runtime-governance-types.js";
import { normalizeReasonCode } from "../governance/trace-summary.js";
import type { PromptProcessorRecipe } from "./prompt-processor-recipe.js";
import type {
  ResolvedRunModelSnapshot,
  TurnAssemblyContext,
  TurnAssemblyProcessorKind,
} from "./turn-assembly-processor-types.js";

/** 稳定序列化（key 排序），用于确定性 hash。 */
function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * 确定性 `assemblyInputHash`。
 *
 * 覆盖：调用方提供的输入摘要（input snapshot + effective config + preset / graph 版本）
 * 与 recipe kind / version。模型采样随机性不在其中（记录在 `ResolvedRunModelSnapshot`）。
 */
export function computeAssemblyInputHash(digest: unknown, recipe: PromptProcessorRecipe): string {
  const payload = stableStringify({
    recipe_kind: recipe.kind,
    recipe_version: recipe.version,
    enable_inline_agents: recipe.enableInlineAgents,
    digest,
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function compactRef(input: Record<string, string | number | boolean | null | undefined>): RuntimeGovernanceRef {
  const ref: RuntimeGovernanceRef = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      ref[key] = value;
    }
  }
  return ref;
}

export interface ChatTurnGovernanceSummaryInput {
  status: RuntimeGovernanceStatus;
  reasonCode: string;
  processorKind: TurnAssemblyProcessorKind;
  recipe: PromptProcessorRecipe;
  assemblyInputHash: string;
  context: TurnAssemblyContext;
  modelSnapshot: ResolvedRunModelSnapshot;
  startedAt?: number | null;
  finishedAt?: number | null;
  inlineAgentsEngaged?: boolean;
}

/** 构造一次 turn 装配的批次 8 统一治理 summary（`runtime_kind = "chat_turn"`）。 */
export function buildChatTurnGovernanceSummary(
  input: ChatTurnGovernanceSummaryInput,
): RuntimeGovernanceTraceSummary {
  const startedAt = input.startedAt ?? null;
  const finishedAt = input.finishedAt ?? null;
  return {
    contract_version: RUNTIME_GOVERNANCE_CONTRACT_VERSION,
    runtime_kind: "chat_turn",
    run_id: input.assemblyInputHash,
    root_run_id: input.assemblyInputHash,
    parent_run_id: null,
    source_kind: "prompt_assembly",
    source_ref: compactRef({
      processor_kind: input.processorKind,
      recipe_kind: input.recipe.kind,
      recipe_version: input.recipe.version,
    }),
    target_kind: "chat_turn",
    target_ref: compactRef({
      account_id: input.context.accountId ?? null,
      session_id: input.context.sessionId ?? null,
      branch_id: input.context.branchId ?? null,
      floor_id: input.context.floorId ?? null,
      page_id: input.context.pageId ?? null,
      prompt_mode: input.context.promptMode,
    }),
    status: input.status,
    reason_code: normalizeReasonCode(input.reasonCode, "succeeded"),
    diagnostics: {
      processor_kind: input.processorKind,
      recipe_kind: input.recipe.kind,
      recipe_version: input.recipe.version,
      enable_inline_agents: input.recipe.enableInlineAgents,
      inline_agents_engaged: input.inlineAgentsEngaged ?? false,
      model_source: input.modelSnapshot.source,
      intent: input.context.intent ?? null,
    },
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: startedAt !== null && finishedAt !== null ? Math.max(0, finishedAt - startedAt) : null,
    dry_run: input.context.dryRun ?? false,
    preview: input.context.preview ?? false,
    side_effects: {
      // prompt 装配本身不写 live state；持久副作用经 staged write / proposal / CommitGate。
      live_state: { written: false },
      inline_agents: { count: input.inlineAgentsEngaged ? 1 : 0 },
    },
  };
}
