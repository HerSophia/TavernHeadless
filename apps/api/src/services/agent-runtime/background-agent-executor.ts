/**
 * BackgroundAgentExecutor：后台 Agent 的执行承载（R4 阶段二）。
 *
 * 对应同步侧的 InlineAgentExecutor 与 TemporaryConversationAgentExecutor。
 *
 * 职责：
 *  - 持有按 agent type key 分发的 BackgroundAgentHandler 注册表。
 *  - 校验 scope_kind 仅允许 project / workspace；floor / session 抛fatal 错误。
 *  - 解析 agentTypeId 对应的 agent type key，分发到对应 handler。
 *  - 在 project / workspace scope 下只读地执行处理逻辑，产出 BackgroundAgentResult。
 *
 * 它不直接落库。真实写入由 Processor 的 commit 阶段统一执行。
 */
import { and, eq } from "drizzle-orm";

import { agentTypes } from "../../db/schema.js";
import type {
  BackgroundAgentExecutionContext,
  BackgroundAgentHandler,
  BackgroundAgentResult,
} from "./background-agent-types.js";

export type BackgroundAgentExecutorErrorKind = "fatal" | "retryable" | "uncertain";

export type BackgroundAgentExecutorErrorCode=
  | "background_agent_scope_kind_not_supported"
  | "background_agent_type_not_found"
  | "background_agent_handler_not_registered";

/**
 * 执行承载层错误。
 *
 * kind 决定 Processor 如何把它转译为 RuntimeJob 错误类别：
 *  - fatal -> RuntimeJobFatalError（dead letter）
 *  - retryable -> RuntimeJobRetryableError（retry_waiting）
 *  - uncertain -> RuntimeJobUncertainOutcomeError（dead letter, uncertain）
 */
export class BackgroundAgentExecutorError extends Error {
  constructor(
    public readonly kind: BackgroundAgentExecutorErrorKind,
    public readonly code: BackgroundAgentExecutorErrorCode | string,
  message: string,
options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BackgroundAgentExecutorError";
  }
}

export class BackgroundAgentExecutor {
  private readonly handlers = new Map<string, BackgroundAgentHandler>();

  constructor(handlers: BackgroundAgentHandler[] = []) {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  register(handler: BackgroundAgentHandler): void {
    if (this.handlers.has(handler.agentKey)) {
      throw new Error(`Background agent handler already registered: ${handler.agentKey}`);
    }
    this.handlers.set(handler.agentKey, handler);
  }

  hasHandler(agentKey: string): boolean {
    return this.handlers.has(agentKey);
  }

  async run(context: BackgroundAgentExecutionContext): Promise<BackgroundAgentResult> {
    if (context.scopeKind !== "project" && context.scopeKind !== "workspace") {
      throw new BackgroundAgentExecutorError(
        "fatal",
        "background_agent_scope_kind_not_supported",
        `Background agent medium does not execute scope_kind '${context.scopeKind}'. `
          + "Only 'project' and 'workspace' scopes run through the background job medium.",
      );
    }

    const agentKey = this.resolveAgentKey(context);
    const handler = this.handlers.get(agentKey);
    if (!handler) {
      throw new BackgroundAgentExecutorError(
        "fatal",
        "background_agent_handler_not_registered",
        `No background agent handler registered for agent key '${agentKey}'.`,
      );
    }

    return handler.run(context);
  }

  private resolveAgentKey(context: BackgroundAgentExecutionContext): string {
    const row = context.db
      .select({ key: agentTypes.key })
      .from(agentTypes)
      .where(and(eq(agentTypes.id, context.agentTypeId), eq(agentTypes.accountId, context.accountId)))
      .limit(1)
      .all()[0];

    if (!row?.key) {
      throw new BackgroundAgentExecutorError(
        "fatal",
        "background_agent_type_not_found",
        `Agent type notfound for background execution: ${context.agentTypeId}`,
      );
    }

    return row.key;
  }
}
