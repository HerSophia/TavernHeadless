/**
 * P9：Prompt Assembly Agent 化 —— recipe 层。
 *
 * recipe 是 `TurnAssemblyProcessor`（turn 级 prompt 装配处理器）的可配置实例。
 * processor 决定执行机制，recipe 决定启用哪些 SubAgent / 注入 / 预算。
 * 三种 prompt mode 进入同一 Agent 体系，但内部行为差异由 recipe 表达：
 *
 * - `prompt_mode` processor + `compat_strict` recipe → 严格兼容编排（零 Agentic）。
 * - `prompt_mode` processor + `compat_plus`  recipe → 轻量增强（memory / renderable injection）。
 * - `composite`   processor + `native_prompt` recipe → preflight SubAgent + Narrator + post verifier。
 *
 * 该文件只定义 recipe 类型与三个内建 recipe 常量，不接入任何生产运行路径。
 */
import type { InlineAgentRoleKind } from "./inline-agent-types.js";
import type { PromptMode } from "../prompt-assembler.js";

export type PromptProcessorRecipeKind = "compat_strict" | "compat_plus" | "native_prompt";

export const PROMPT_PROCESSOR_RECIPE_KINDS = [
  "compat_strict",
  "compat_plus",
  "native_prompt",
] as const satisfies readonly PromptProcessorRecipeKind[];

/**
 * recipe 版本号。进入确定性 `assemblyInputHash`，使 recipe 自身的语义升级
 * 也会让 checkpoint / replay 失效，避免跨版本错误复用。
 */
export const PROMPT_PROCESSOR_RECIPE_VERSION = "p9.v1" as const;

export interface PromptProcessorRecipe {
  kind: PromptProcessorRecipeKind;
  /** recipe 版本，进入确定性 input-hash。 */
  version: string;
  /**
   * 是否启用 inline 子 Agent（preflight / post verifier）。
   * compat_strict / compat_plus 恒为 false：严格兼容模式语义零改变，不引入 Agentic 行为。
   * 仅 native_prompt 有意义，且实际执行仍受 `enableAgenticInlineMvp` 总开关约束。
   */
  enableInlineAgents: boolean;
  /** 声明性：native composite 的 preflight 子 Agent 角色（与既有内建 inline plan 对齐）。 */
  preflightRoles?: InlineAgentRoleKind[];
  /** 声明性：native composite 的 post verifier 子 Agent 角色（与既有内建 inline plan 对齐）。 */
  postVerifierRoles?: InlineAgentRoleKind[];
}

/**
 * compat_strict：以 deterministic processor 形式运行的同一套旧逻辑，零 Agentic。
 */
export const COMPAT_STRICT_RECIPE: PromptProcessorRecipe = {
  kind: "compat_strict",
  version: PROMPT_PROCESSOR_RECIPE_VERSION,
  enableInlineAgents: false,
};

/**
 * compat_plus：轻量增强（memory injection / renderable injection），核心语义不变，仍零 Agentic。
 */
export const COMPAT_PLUS_RECIPE: PromptProcessorRecipe = {
  kind: "compat_plus",
  version: PROMPT_PROCESSOR_RECIPE_VERSION,
  enableInlineAgents: false,
};

/**
 * native_prompt：composite turn agent。
 *
 * preflight / post verifier 角色与 `agent-invocation-service.ts` 的内建 inline plan 对齐，
 * 仅作声明性元数据；真实执行仍由既有 `InlineAgentExecutor` 在 `enableAgenticInlineMvp`
 * 开启时调度，P9 不改变子 Agent 行为。
 */
export const NATIVE_PROMPT_RECIPE: PromptProcessorRecipe = {
  kind: "native_prompt",
  version: PROMPT_PROCESSOR_RECIPE_VERSION,
  enableInlineAgents: true,
  preflightRoles: ["scene_state", "memory_selection", "worldbook_focus", "director", "agency_guard"],
  postVerifierRoles: ["continuity_verifier", "agency_guard", "style_verifier", "state_proposal", "memory_proposal"],
};

const RECIPE_BY_KIND: Record<PromptProcessorRecipeKind, PromptProcessorRecipe> = {
  compat_strict: COMPAT_STRICT_RECIPE,
  compat_plus: COMPAT_PLUS_RECIPE,
  native_prompt: NATIVE_PROMPT_RECIPE,
};

/** prompt mode → recipe kind。compat_strict / compat_plus 直接同名，native → native_prompt。 */
export function resolvePromptProcessorRecipeKind(promptMode: PromptMode): PromptProcessorRecipeKind {
  switch (promptMode) {
    case "native":
      return "native_prompt";
    case "compat_plus":
      return "compat_plus";
    case "compat_strict":
    default:
      return "compat_strict";
  }
}

/** prompt mode → 内建 recipe 常量。 */
export function resolvePromptProcessorRecipe(promptMode: PromptMode): PromptProcessorRecipe {
  return RECIPE_BY_KIND[resolvePromptProcessorRecipeKind(promptMode)];
}

/** recipe kind → 承载它的 turn 级 processor kind。 */
export function resolveTurnAssemblyProcessorKind(
  recipeKind: PromptProcessorRecipeKind,
): "prompt_mode" | "composite" {
  return recipeKind === "native_prompt" ? "composite" : "prompt_mode";
}
