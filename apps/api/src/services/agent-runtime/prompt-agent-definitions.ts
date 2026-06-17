/**
 * PromptAgent 定义：R3 阶段六的旧 prompt mode 迁移落点。
 *
 * 说明（很重要的边界澄清）：
 *  - 本仓库的 `prompt_mode`指 `compat_strict | compat_plus | native`，是提示词拼装模式，
 *    与本文件无关。
 *  - 设计路线里说的「旧 prompt mode」指的是 draft assistant、revision assistant、Q&A assistant
 *    这类“助手型”用法。它们在本仓库此前没有作为独立代码存在。
 *  - 因此 R3 阶段六不是改写既有路由，而是把这三类用法正式定义成运行在
 *    `temporary_conversation` 介质上的 PromptAgent，并给出统一的介质与投递目标映射。
 *  - T3 已提供真实运行入口（PromptAgentRunner），让这三类助手第一次真正运行；是否开放公共 API 由 T3 决定为不开放。
 *    本仓库此前没有这三类助手的旧路由或旧入口，不存在“转发旧入口”的工作。
 */
import type {
  AgentMediumSelection,
} from "./agent-medium-types.js";
import type {
  TemporaryConversationAgentRequest,
  TemporaryConversationAgentSource,
} from "./temporary-conversation-agent-executor.js";
import type { AgentLineageRef } from "./agent-lineage-types.js";

export type PromptAgentKind =
  | "draft_assistant"
  | "revision_assistant"
  | "qa_assistant";

export type PromptAgentAudience = "user_visible" | "internal";

export interface PromptAgentDefinition {
  kind: PromptAgentKind;
  /** 用户可见的助手，还是内部/辅助型助手。 */
  audience: PromptAgentAudience;
  /** 该 PromptAgent 默认运行的执行介质与投递目标。 */
  medium: AgentMediumSelection;
  /** 默认 Agent id，用于 trace 与日志。 */
  agentId: string;
}

export const PROMPT_AGENT_DEFINITIONS: Record<PromptAgentKind, PromptAgentDefinition> = {
  draft_assistant: {
    kind: "draft_assistant",
    audience: "user_visible",
    agentId: "prompt_agent:draft_assistant",
    medium: {
      kind: "temporary_conversation",
      purpose: "draft",
      deliveryTarget: "return_inline",
    },
  },
  revision_assistant: {
    kind: "revision_assistant",
  audience: "internal",
    agentId: "prompt_agent:revision_assistant",
    medium: {
kind: "temporary_conversation",
      purpose: "agent_assist",
      deliveryTarget: "page_staged_write",
    },
  },
  qa_assistant: {
    kind: "qa_assistant",
    audience: "user_visible",
    agentId: "prompt_agent:qa_assistant",
    medium: {
      kind: "temporary_conversation",
      purpose: "agent_assist",
      deliveryTarget: "return_inline",
    },
  },
};

/**
 * 惯用名称到 PromptAgent 的兼容映射。
 *
 *调用方可以用这张表把 draft / revise / qa 等惯用名称解析成 PromptAgentKind。
 * 它只是名称层面的兼容映射；本仓库此前没有这三类助手的旧路由或旧入口，不存在需要迁移的旧实现。
 */
export const LEGACY_PROMPT_MODE_TO_AGENT_KIND: Record<string, PromptAgentKind> = {
  draft: "draft_assistant",
  draft_assistant: "draft_assistant",
  revise: "revision_assistant",
  revision: "revision_assistant",
  revision_assistant: "revision_assistant",
  qa: "qa_assistant",
  question_answer: "qa_assistant",
  qa_assistant: "qa_assistant",
};

export function resolvePromptAgentKindFromLegacyMode(
  legacyMode: string,
): PromptAgentKind | undefined {
  return LEGACY_PROMPT_MODE_TO_AGENT_KIND[legacyMode.trim().toLowerCase()];
}

export function getPromptAgentDefinition(kind: PromptAgentKind): PromptAgentDefinition {
  return PROMPT_AGENT_DEFINITIONS[kind];
}

export interface BuildPromptAgentRequestParams {
  accountId: string;
  source: TemporaryConversationAgentSource;
  inputMessage: string;
  systemMessage?: string| null;
  title?: string | null;
  /** revision_assistant 等导出到 page_staged_write的 Agent 必填。 */
  targetPageId?: string;
  sourceOutputPageId?: string;
  reason?: string | null;
  lineage?: AgentLineageRef;
  /** 允许调用方覆盖默认投递目标，但仍受执行器与权限策略约束。 */
  deliveryTargetOverride?: AgentMediumSelection["deliveryTarget"];
}

/**
 * 把一个 PromptAgent 定义与运行参数组装成临时对话 Agent 请求。
 *
 * 该请求随后交给 TemporaryConversationAgentExecutor 执行。
 */
export function buildPromptAgentTemporaryRequest(
  kind: PromptAgentKind,
  params: BuildPromptAgentRequestParams,
): TemporaryConversationAgentRequest {
  const definition =getPromptAgentDefinition(kind);
  const medium: AgentMediumSelection = params.deliveryTargetOverride
    ? { ...definition.medium, deliveryTarget: params.deliveryTargetOverride }
    : definition.medium;

  return {
    accountId: params.accountId,
    spec: {
      id: definition.agentId,
      // PromptAgent 不属于主回合 inline verifier，这里借用一个中性 roleKind 占位。
      // 真实角色语义由 PromptAgentKind 表达，inline roleKind 不参与临时对话执行判定。
   roleKind: "director",
      phase: "pre_response",
      stabilityHint: "floor",
      failurePolicy: "fail_open",
      medium,
    },
    medium,
    source: params.source,
    title: params.title ??null,
    systemMessage: params.systemMessage ?? null,
    inputMessage: params.inputMessage,
    targetPageId: params.targetPageId,
    sourceOutputPageId: params.sourceOutputPageId,
    reason: params.reason,
    lineage: params.lineage,
  };
}
