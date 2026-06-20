/**
 * Agent Runtime R1（单回合 MVP）对外入口。
 *
 * 仅导出 inline 主回合所需的语义层、调用入口、执行器、聚合器、trace helper
 * 与内建 Agent 注册表。后台 Agent、临时对话执行介质、NodeGraph 不在此范围内。
 */
export * from "./inline-agent-types.js";
export * from "./agent-medium-types.js";
export * from "./agent-lineage-types.js";
export { AgentMediumResolver } from "./agent-medium-resolver.js";
export { AgentExecutorRouter } from "./agent-executor-router.js";
export {
  AgentJobTriggerBackgroundJobEnqueuer,
  AgentJobTriggerBackgroundJobEnqueuerError,
  type AgentJobTriggerBackgroundJobEnqueuerErrorCode,
} from "./background-job-enqueuer.js";
export {
  TemporaryConversationAgentExecutor,
  type TemporaryConversationAgentService,
  type TemporaryConversationAgentRequest,
  type TemporaryConversationAgentSource,
  type TemporaryConversationAgentExecutionResult,
  type TemporaryConversationAgentExecutionStatus,
  type AgentDerivedOutputDeliveryParams,
  type AgentProjectInboxDeliveryParams,
  type AgentSessionStateProposalDeliveryParams,
  type TemporaryConversationAgentOperationLogType,
  type TemporaryConversationAgentOperationLogEntry,
  type TemporaryConversationAgentAuditSnapshot,
} from "./temporary-conversation-agent-executor.js";
export {
  AgentOutputDispatcher,
  AgentOutputDispatchError,
 type AgentOutputDispatchRequest,
  type AgentOutputDispatchResult,
  type AgentOutputDispatcherDeps,
  type PageStagedWriteSink,
  type DerivedOutputSink,
  type ProjectInboxSink,
  type SessionStateProposalSink,
  type SessionStateProposalDraft,
} from "./agent-output-dispatcher.js";
export {
  PROMPT_AGENT_DEFINITIONS,
  LEGACY_PROMPT_MODE_TO_AGENT_KIND,
  resolvePromptAgentKindFromLegacyMode,
  getPromptAgentDefinition,
  buildPromptAgentTemporaryRequest,
  type PromptAgentKind,
  type PromptAgentAudience,
  type PromptAgentDefinition,
  type BuildPromptAgentRequestParams,
}from "./prompt-agent-definitions.js";
export {
  PromptAgentRunner,
  PromptAgentRunError,
  resolvePromptAgentKind,
  getPromptAgentRunnerDefinition,
type RunPromptAgentParams,
} from "./prompt-agent-runner.js";
export { AgentInvocationService } from "./agent-invocation-service.js";
export {
  InlineAgentExecutor,
  type InlineAgentRegistry,
  type InlineAgentExecutorContext,
} from "./inline-agent-executor.js";
export { AgentContextAggregator } from "./agent-context-aggregator.js";
export {
  buildPostResponseEnvelope,
  buildAgentRuntimeTrace,
  buildAgentRuntimeMediumTrace,
} from "./agent-runtime-trace.js";
export {
  BuiltinInlineAgentRegistry,
  createBuiltinInlineAgentRegistry,
} from "./builtin/index.js";
export {
  PROMPT_PROCESSOR_RECIPE_KINDS,
  PROMPT_PROCESSOR_RECIPE_VERSION,
  COMPAT_STRICT_RECIPE,
  COMPAT_PLUS_RECIPE,
  NATIVE_PROMPT_RECIPE,
  resolvePromptProcessorRecipe,
  resolvePromptProcessorRecipeKind,
  resolveTurnAssemblyProcessorKind,
  type PromptProcessorRecipe,
  type PromptProcessorRecipeKind,
} from "./prompt-processor-recipe.js";
export {
  TURN_ASSEMBLY_PROCESSOR_KINDS,
  unresolvedRunModelSnapshot,
  type TurnAssemblyProcessor,
  type TurnAssemblyProcessorKind,
  type TurnAssemblyContext,
  type PreparedTurnAssembly,
  type TurnAssemblyResult,
  type TurnAssemblyCheckpoint,
  type PromptModeComposeResult,
  type ResolvedRunModelSnapshot,
} from "./turn-assembly-processor-types.js";
export {
  computeAssemblyInputHash,
  buildChatTurnGovernanceSummary,
  type ChatTurnGovernanceSummaryInput,
} from "./turn-assembly-support.js";
export {
  PromptModeTurnProcessor,
  PromptModeTurnProcessorError,
  createPromptModeTurnProcessor,
} from "./prompt-mode-turn-processor.js";
export {
  CompositeTurnProcessor,
  CompositeTurnProcessorError,
  createCompositeTurnProcessor,
} from "./composite-turn-processor.js";
export {
  NodeGraphTurnProcessor,
  NodeGraphTurnProcessorError,
  createNodeGraphTurnProcessor,
} from "./node-graph-turn-processor.js";
export {
  NATIVE_PROMPT_CARRIERS,
  DEFAULT_NATIVE_PROMPT_BRIDGE_DECISION,
  resolveNativePromptBridgeDecision,
  readNativePromptBridgeWorkspaceDefault,
  compareTurnAssemblyResults,
  type NativePromptCarrier,
  type NativePromptBridgeDecision,
  type NativePromptBridgeLayers,
  type NativePromptBridgeComparison,
} from "./native-prompt-bridge.js";
export { selectTurnAssemblyProcessor } from "./turn-assembly-processor-factory.js";
