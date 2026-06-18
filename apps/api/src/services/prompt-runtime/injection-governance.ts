import type {
  PromptRuntimeInjectionSourceKind,
  PromptRuntimeInjectionVisibility,
} from "../prompt-runtime-injection-types.js";

export const PROMPT_RUNTIME_INJECTION_BUDGET_GROUP = "injection";

/**
 * I4 可见性矩阵：把受控 source_kind 映射到对外可见性层级。
 *
 * 这是 source_kind -> visibility 的唯一权威映射，contributor builder 与所有
 * presenter 都从这里取值，避免出现多套来源->可见性的口径。
 */
export const INJECTION_VISIBILITY_BY_SOURCE_KIND: Record<
  PromptRuntimeInjectionSourceKind,
  PromptRuntimeInjectionVisibility
> = {
  client_injection: "client",
  agent_injection: "agent_private",
  debug_injection: "debug",
  system_override: "system",
};

/**
 * 把任意 source_kind 字符串解析为可见性层级。
 *
 * 未知来源按最保守的 `client` 处理（不会比受限来源更宽松，因为 client 永远完整可见，
 * 但未知来源本就不应由公共面声明；真正受限的 agent/debug/system 会显式命中）。
 */
export function resolveInjectionVisibility(
  sourceKind: string,
): PromptRuntimeInjectionVisibility {
  switch (sourceKind) {
    case "agent_injection":
      return "agent_private";
    case "debug_injection":
      return "debug";
    case "system_override":
      return "system";
    case "client_injection":
    default:
      return "client";
  }
}

/**
 * 受限可见性集合：这些来源的正文（title）与内部来源链（source_chain）默认对普通读取裁剪。
 */
export const RESTRICTED_INJECTION_VISIBILITIES: readonly PromptRuntimeInjectionVisibility[] = [
  "agent_private",
  "debug",
  "system",
];

export function isRestrictedInjectionVisibility(
  visibility: PromptRuntimeInjectionVisibility,
): boolean {
  return RESTRICTED_INJECTION_VISIBILITIES.includes(visibility);
}

/**
 * I4 裁剪判定：给定可见性与「是否获授读取受限内容」，判断本条 injection 的敏感字段是否需要裁剪。
 *
 * - `client` 永远不裁剪。
 * - `agent_private` / `debug` / `system` 默认裁剪，仅在显式授予 debug 读取权限时放行完整内容。
 *
 * 裁剪只针对正文 title 与内部 source_chain；结构性可观察字段（位置、是否生效、不生效原因、
 * 预算状态、token、可见性本身）始终保留，符合「任何 injection 都应可见、不静默吞掉」的原则。
 */
export function shouldRedactInjectionContent(
  visibility: PromptRuntimeInjectionVisibility,
  options?: { includeRestrictedContent?: boolean },
): boolean {
  if (options?.includeRestrictedContent === true) {
    return false;
  }
  return isRestrictedInjectionVisibility(visibility);
}

export interface PromptRuntimeInjectionGovernanceLimits {
  requestMaxCount: number;
  sessionMaxCount: number;
  branchMaxCount: number;
  titleMaxLength: number;
  contentMaxLength: number;
  contentMaxTokens: number;
  totalMaxTokens: number;
}

/**
 * Prompt Runtime Injection I4 的第一版治理上限。
 *
 * 这些值用于阻止单次请求、持久作用域和单条内容明显失控。
 * 后续如需要项目级或账号级配额，可以在此基础上再增加配置入口。
 */
export const PROMPT_RUNTIME_INJECTION_LIMITS: PromptRuntimeInjectionGovernanceLimits = {
  requestMaxCount: 32,
  sessionMaxCount: 128,
  branchMaxCount: 128,
  titleMaxLength: 256,
  contentMaxLength: 8_000,
  contentMaxTokens: 2_000,
  totalMaxTokens: 4_000,
};

export type PromptRuntimeInjectionScopeLimitKey =
  | "requestMaxCount"
  | "sessionMaxCount"
  | "branchMaxCount";

export function getPromptRuntimeInjectionScopeLimit(
  limits: PromptRuntimeInjectionGovernanceLimits,
  scope: "request" | "session" | "branch",
): number {
  switch (scope) {
    case "request":
      return limits.requestMaxCount;
    case "session":
      return limits.sessionMaxCount;
    case "branch":
      return limits.branchMaxCount;
  }
}
