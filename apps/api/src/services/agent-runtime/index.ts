/**
 * Agent Runtime R1（单回合 MVP）对外入口。
 *
 * 仅导出 inline 主回合所需的语义层、调用入口、执行器、聚合器、trace helper
 * 与内建 Agent 注册表。后台 Agent、临时对话执行介质、NodeGraph 不在此范围内。
 */
export * from "./inline-agent-types.js";
export { AgentInvocationService } from "./agent-invocation-service.js";
export {
  InlineAgentExecutor,
  type InlineAgentRegistry,
  type InlineAgentExecutorContext,
} from "./inline-agent-executor.js";
export { AgentContextAggregator } from "./agent-context-aggregator.js";
export { buildPostResponseEnvelope, buildAgentRuntimeTrace } from "./agent-runtime-trace.js";
export {
  BuiltinInlineAgentRegistry,
  createBuiltinInlineAgentRegistry,
} from "./builtin/index.js";
