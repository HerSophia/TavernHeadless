/**
 * P9：Prompt Assembly Agent 化 —— turn 级处理器合同。
 *
 * `TurnAssemblyProcessor` 是 turn 级（整条 prompt 编排）的上位处理器，
 * 区别于既有 inline `AgentProcessor`（子 Agent 级，见 `inline-agent-types.ts`）：
 *
 * - 既有 `AgentProcessor` 处理「单个 preflight / post-response 子 Agent」。
 * - `TurnAssemblyProcessor` 处理「整条 prompt 编排怎么被调度、复用、追踪」。
 *
 * `composite` processor 在内部复用既有 inline `AgentProcessor` 体系（preflight / post
 * 子 Agent 仍走 `InlineAgentExecutor`），二者是层级关系，不是替代关系。
 *
 * 命名遵循 `docs/contributing.md` §8.3：`Runtime` 留给平台层运行时能力，
 * 本处理器属于一次主链业务运行（turn）内的装配处理，故用 `TurnAssembly*` 命名。
 *
 * 合同约束（写入注释，供实现遵守）：
 * 1. `prepare` 必须在启动时解析出自己的 `ResolvedRunModelSnapshot`，执行期不回读 profile / instance。
 * 2. processor 沿用批次 8 治理契约（`runtime_kind = "chat_turn"`、`contract_version = "b8-governance.v1"`），不另造一套。
 * 3. processor 不直接写 live state；持久副作用经 page staged write / proposal / CommitGate / AgentOutputDispatcher。
 * 4. 「deterministic」指编排过程确定（compose 出的 messages / token 分配 / 装配顺序可复现），
 *    模型采样随机性不在确定性范围内，但被记录在 `ResolvedRunModelSnapshot`。
 */
import type { PromptIR } from "@tavern/core";

import type { RuntimeGovernanceTraceSummary } from "../governance/runtime-governance-types.js";
import type { PromptMode } from "../prompt-assembler.js";
import type { AgentRuntimeTrace } from "./inline-agent-types.js";
import type { PromptProcessorRecipe, PromptProcessorRecipeKind } from "./prompt-processor-recipe.js";

export type TurnAssemblyProcessorKind = "prompt_mode" | "composite" | "node_graph";

export const TURN_ASSEMBLY_PROCESSOR_KINDS = [
  "prompt_mode",
  "composite",
  "node_graph",
] as const satisfies readonly TurnAssemblyProcessorKind[];

/**
 * 一次运行解析出的模型快照。
 *
 * P9 阶段只固化「编排所依赖的、可被记录的模型上下文」；模型采样随机性记录在此，
 * 不进入确定性 `assemblyInputHash`。后续可由 `turn-model-service.ts` 收口填充。
 */
export interface ResolvedRunModelSnapshot {
  source: "env" | "global_profile" | "session_profile" | "unresolved";
  providerType?: string;
  model?: string;
  profileId?: string;
  /** 采样相关生成参数。仅记录，不进入确定性 hash。 */
  generationParams?: Record<string, unknown>;
  capturedAt: number;
}

/** 未解析到模型时的占位快照。 */
export function unresolvedRunModelSnapshot(capturedAt = Date.now()): ResolvedRunModelSnapshot {
  return { source: "unresolved", capturedAt };
}

/**
 * mode 专属 compose 的产物。
 *
 * 这是三种 prompt mode 在 `assemblePrompt` 中唯一分流的部分（构造 `PromptIR` 与两个布尔标志）。
 * 由调用方（`prompt-assembler.ts`）以闭包形式提供给 processor，保持既有分流逻辑逐字不变。
 */
export interface PromptModeComposeResult {
  promptIr: PromptIR;
  characterOverridesHandledInPromptIR: boolean;
  memorySummaryHandledInPromptIR: boolean;
}

/**
 * turn 级装配上下文。
 *
 * 携带 promptMode、recipe、追踪引用、可选模型快照，以及：
 * - `assemblyInputDigest`：确定性输入的结构化摘要（在 `prepare` 中被 hash）。
 * - `composePromptModeIr`：mode 专属 compose 闭包（由调用方提供，processor 在 `execute` 中调用）。
 */
export interface TurnAssemblyContext {
  promptMode: PromptMode;
  recipe: PromptProcessorRecipe;
  accountId?: string | null;
  sessionId?: string | null;
  branchId?: string | null;
  floorId?: string | null;
  pageId?: string | null;
  intent?: string | null;
  preview?: boolean;
  dryRun?: boolean;
  modelSnapshot?: ResolvedRunModelSnapshot;
  /** 确定性输入摘要：input snapshot + effective config + recipe version + preset / graph 版本。 */
  assemblyInputDigest: unknown;
  /** mode 专属 compose（调用方提供的执行体）。 */
  composePromptModeIr: () => PromptModeComposeResult;
  /**
   * composite（native_prompt）专用：既有 inline agentic 子 Agent 的运行 trace。
   *
   * 由调用方（chat-service 的 AgenticTurnStrategy）在 inline agentic 开启时提供，
   * composite processor 把它收口到 `TurnAssemblyResult.agentRuntimeTrace`，不改变子 Agent 行为。
   */
  agentRuntimeTrace?: AgentRuntimeTrace;
}

/** `prepare` 产物：不产生持久副作用。 */
export interface PreparedTurnAssembly {
  kind: TurnAssemblyProcessorKind;
  recipe: PromptProcessorRecipe;
  modelSnapshot: ResolvedRunModelSnapshot;
  /** 覆盖确定性输入 + recipe version 的稳定 hash，作为 NG2-CORE checkpoint 的前置 key。 */
  assemblyInputHash: string;
  context: TurnAssemblyContext;
}

/** `execute` 产物：结构化结果，仍不直接写正史。 */
export interface TurnAssemblyResult {
  processorKind: TurnAssemblyProcessorKind;
  recipeKind: PromptProcessorRecipeKind;
  recipeVersion: string;
  assemblyInputHash: string;
  promptIr: PromptIR;
  characterOverridesHandledInPromptIR: boolean;
  memorySummaryHandledInPromptIR: boolean;
  modelSnapshot: ResolvedRunModelSnapshot;
  /** 批次 8 统一治理 trace summary（`runtime_kind = "chat_turn"`）。 */
  governanceSummary: RuntimeGovernanceTraceSummary;
  /** composite processor 在 inline agentic 开启时可携带；prompt_mode 永不携带。 */
  agentRuntimeTrace?: AgentRuntimeTrace;
  /** composite processor 导出的可复用中间态（供 NG2-CORE checkpoint）。 */
  checkpoint?: TurnAssemblyCheckpoint;
}

/**
 * 可复用的 turn 装配中间态。
 *
 * P9 只产出结构（covering `assemblyInputHash` + recipe），不接持久表；
 * 持久 checkpoint 表由 NG2-CORE（批次 9 阶段 7）落地。
 */
export interface TurnAssemblyCheckpoint {
  kind: TurnAssemblyProcessorKind;
  recipeKind: PromptProcessorRecipeKind;
  recipeVersion: string;
  assemblyInputHash: string;
  characterOverridesHandledInPromptIR: boolean;
  memorySummaryHandledInPromptIR: boolean;
  createdAt: number;
}

/**
 * turn 级 prompt 装配处理器。
 *
 * `prepare → PreparedTurnAssembly`、`execute → TurnAssemblyResult`，
 * 可选 `checkpoint` / `resume`（供 NG2-CORE 复用）。
 */
export interface TurnAssemblyProcessor {
  readonly kind: TurnAssemblyProcessorKind;
  readonly recipe: PromptProcessorRecipe;
  prepare(context: TurnAssemblyContext): Promise<PreparedTurnAssembly> | PreparedTurnAssembly;
  execute(prepared: PreparedTurnAssembly): Promise<TurnAssemblyResult> | TurnAssemblyResult;
  checkpoint?(prepared: PreparedTurnAssembly): TurnAssemblyCheckpoint;
  resume?(
    checkpoint: TurnAssemblyCheckpoint,
    context: TurnAssemblyContext,
  ): Promise<TurnAssemblyResult> | TurnAssemblyResult;
}
