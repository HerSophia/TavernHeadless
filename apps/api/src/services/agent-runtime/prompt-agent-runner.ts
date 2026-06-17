/**
 * PromptAgent 运行入口：T3 阶段三的落点。
 *
 * 背景（重要边界）：
 *  - draft / revision / qa 这三类「助手型」用法此前在本仓库没有独立代码。
 *    R3 阶段六只新建了它们的定义（prompt-agent-definitions.ts），没有真实运行入口。
 *  - 本文件是它们第一次真正运行的入口，不是迁移既有实现，也不存在旧路由转发。
 *  - `LEGACY_PROMPT_MODE_TO_AGENT_KIND` 只是惯用名称（draft / revise / qa）到
 *    PromptAgentKind 的字符串映射，方便调用方用熟悉的名称触发，不代表存在旧实现。
 *
 * 职责：
 *  - 把 PromptAgentKind 或惯用名称解析为定义，组装临时对话 Agent 请求。
 *  - 通过 AgentExecutorRouter 把请求路由到 TemporaryConversationAgentExecutor。
 *  - 透传可选的 AgentOutputDispatcher，让需要持久导出目标的助手能正常工作。
 *    draft / qa 默认 return_inline、revision 默认 page_staged_write，二者都不强制依赖 dispatcher。
 */
import {
  buildPromptAgentTemporaryRequest,
  getPromptAgentDefinition,
  resolvePromptAgentKindFromLegacyMode,
  type BuildPromptAgentRequestParams,
  type PromptAgentDefinition,
  type PromptAgentKind,
} from "./prompt-agent-definitions.js";
import type {
  AgentExecutorRouter,
  AgentExecutorRouteResult,
} from "./agent-executor-router.js";
import type { TemporaryConversationAgentExecutionResult } from "./temporary-conversation-agent-executor.js";

export class PromptAgentRunError extends Error {
  constructor(
    public readonly code: "prompt_agent_kind_unknown",
    message: string,
  ) {
    super(message);
    this.name = "PromptAgentRunError";
  }
}

export interface RunPromptAgentParams extends BuildPromptAgentRequestParams {
  /**
   * 助手类型。可传 PromptAgentKind（draft_assistant / revision_assistant / qa_assistant），
   * 也可传惯用名称字符串（draft / revise / qa 等），后者会先经
   * resolvePromptAgentKindFromLegacyMode 解析。
   */
  agent: PromptAgentKind | string;
}

/**
 * 运行一个 PromptAgent 助手，返回临时对话执行结果。
 *
 * 该入口只负责编排：解析助手类型 -> 组装请求 -> 经 router 执行。
 * 真实生命周期（创建、respond、导出、finalize/discard/cancel）由
 * TemporaryConversationAgentExecutor 处理。
 */
export class PromptAgentRunner {
  constructor(private readonly executorRouter: AgentExecutorRouter) {}

  async run(
    params: RunPromptAgentParams,
  ): Promise<TemporaryConversationAgentExecutionResult> {
    const kind = resolvePromptAgentKind(params.agent);
    const { agent: _agent, ...requestParams } = params;
    const request = buildPromptAgentTemporaryRequest(kind, requestParams);

    const routeResult: AgentExecutorRouteResult =
      await this.executorRouter.routeTemporaryConversation(request);

    // routeTemporaryConversation 固定返回 temporary_conversation 分支。
    // 这里做一次收窄断言，避免把 union 直接外抛。
    if (routeResult.kind !== "temporary_conversation") {
      throw new PromptAgentRunError(
        "prompt_agent_kind_unknown",
        `Unexpected executor route result kind: ${routeResult.kind}`,
      );
    }
    return routeResult.result;
  }
}

/**
 * 把助手类型入参解析为 PromptAgentKind。
 *
 * 先按 PromptAgentKind 直接匹配；不匹配时按惯用名称解析；都失败则抛错。
 */
export function resolvePromptAgentKind(agent: PromptAgentKind | string): PromptAgentKind {
  if (isPromptAgentKind(agent)) {
    return agent;
  }
  const resolved = resolvePromptAgentKindFromLegacyMode(agent);
  if (resolved) {
    return resolved;
  }
  throw new PromptAgentRunError(
    "prompt_agent_kind_unknown",
    `Unknown prompt agent kind or legacy mode: ${agent}`,
  );
}

function isPromptAgentKind(value: string): value is PromptAgentKind {
  return (
    value === "draft_assistant" ||
    value === "revision_assistant" ||
    value === "qa_assistant"
  );
}

/**
 * 读取某个助手的定义，便于调用方在运行前查询默认介质与投递目标。
 */
export function getPromptAgentRunnerDefinition(
  agent: PromptAgentKind | string,
): PromptAgentDefinition {
  return getPromptAgentDefinition(resolvePromptAgentKind(agent));
}
