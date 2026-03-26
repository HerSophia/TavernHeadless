// ── Events ────────────────────────────────────────────
export { createEventBus } from './events/index.js';
export type { CoreEventBus } from './events/index.js';
export type {
  CoreEventMap,
  FloorStateChangedEvent,
  FloorCommittedEvent,
  FloorFailedEvent,
  VariableSetEvent,
  VariablePromotedEvent,
  VariableDeletedEvent,
  GenerationStartedEvent,
  GenerationChunkEvent,
  GenerationCompletedEvent,
  GenerationFailedEvent,
  MemoryCreatedEvent,
  MemoryUpdatedEvent,
  MemoryDeprecatedEvent,
  MemoryInjectionFailedEvent,
  MemoryPersistFailedEvent,
  MemoryConsolidationContextFailedEvent,
  MemoryConsolidationJsonParseFailedEvent,
  MemoryConsolidatedEvent,
  MemoryConsolidationFailedEvent,
  ToolCallStartedEvent,
  ToolCallCompletedEvent,
  ToolCallFailedEvent,
  ToolCallDeniedEvent,
  McpServerConnectedEvent,
  McpServerDisconnectedEvent,
  McpServerErrorEvent,
} from './events/index.js';

// ── Floor ─────────────────────────────────────────────
export { FloorStateMachine } from './floor/index.js';
export { FloorLifecycle } from './floor/index.js';

// ── Variables ─────────────────────────────────────────
export { VariableResolver } from './variables/index.js';
export { VariableStore } from './variables/index.js';

// ── Prompt ────────────────────────────────────────────
export type {
  ChatRole,
  IRMessage,
  IRSection,
  PromptIR,
  PromptMetadata,
  TokenCounter,
  ChatMessage,
  AssembledPrompt,
  PromptSnapshotRecord,
  TemplateOptions,
  MessageBuilderOptions,
} from './prompt/index.js';
export { TemplateEngine, TemplateVariableError } from './prompt/index.js';
export { TokenBudget, SimpleTokenCounter } from './prompt/index.js';
export type {
  NativePromptMode,
  NativeWorldbookEntry,
  NativePipelineInput,
  NativePipelineState,
  NativePipelineNode,
  NativePipelineInputSummary,
  NativePipelineStateSummary,
  ConditionNodeOptions,
  TransformRule,
  TransformNodeOptions,
} from './prompt/index.js';
export {
  assembleNativePrompt,
  TemplateNode,
  ConditionNode,
  WorldbookResolveNode,
  TransformNode,
  MemoryInjectNode,
  TokenBudgetNode,
  PackMessagesNode,
  NativePipelineError,
} from './prompt/index.js';
export { MessageBuilder } from './prompt/index.js';

// ── LLM ───────────────────────────────────────────────
export type {
  ProviderType,
  InstanceSlot,
  ProviderConfig,
  ModelConfig,
  GenerationParams,
  LLMRole,
  LLMInstance,
  LLMRequest,
  TokenUsage,
  LLMResponse,
  StreamCallbacks,
  LLMPort,
  ProviderFactory,
  LLMToolDefinition,
  LLMToolCall,
  LLMStepResult,
} from './llm/index.js';
export { ProviderRegistry, ProviderNotFoundError, ProviderInitError } from './llm/index.js';
export { LLMService, LLMServiceError, LLMTimeoutError, LLMAbortError } from './llm/index.js';

// ── Generation ────────────────────────────────────────
export type {
  GenerationInput,
  GenerationOutput,
  AssemblyInfo,
  PipelineCallbacks,
  SummaryExtractionResult,
  SummaryExtractorOptions,
} from './generation/index.js';
export { extractSummaries } from './generation/index.js';
export { GenerationPipeline, GenerationPipelineError } from './generation/index.js';

// ── Memory ────────────────────────────────────────────
export type {
  MemoryItem,
  MemoryEdge,
  MemoryQuery,
  MemoryConsolidationOutput,
  MemoryInjectionOptions,
  MemoryInjectionResult,
} from './memory/index.js';
export { MemoryStore } from './memory/index.js';
export { MemoryConsolidator } from './memory/index.js';
export type { ConsolidationInput, ConsolidationResult } from './memory/index.js';

// ── Orchestration ─────────────────────────────────────
export { Director } from './orchestration/index.js';
export type {
  DirectorInput,
  DirectorOutput,
  DirectorResult,
} from './orchestration/index.js';
export { Verifier } from './orchestration/index.js';
export type {
  VerifierInput,
  VerifierOutput,
  VerifierIssue,
  VerifierResult,
} from './orchestration/index.js';
export { TurnOrchestrator, TurnError } from './orchestration/index.js';
export type {
  TurnOrchestratorDeps,
  TurnPhase,
  TurnConfig,
  TurnInput,
  TurnExecutionResult,
  TurnOutput,
  VerifierFailStrategy,
  ToolMode,
} from './orchestration/index.js';

// ── Ports ─────────────────────────────────────────────
export type { FloorRepository } from './ports/index.js';
export type { VariableRepository } from './ports/index.js';
export type { MemoryRepository } from './ports/index.js';
export type { PromptSnapshotRepository } from './ports/index.js';
export type { ToolExecutionRepository } from './ports/index.js';

// ── Types ─────────────────────────────────────────────
export type { VariableContext, FloorEntity } from './types.js';

// ── Errors ────────────────────────────────────────────
export {
  InvalidStateTransitionError,
  FloorImmutableError,
  FloorNotFoundError,
  FloorStateConflictError,
  VariableNotFoundError,
  InvalidScopePromotionError,
  MissingScopeIdError,
} from './errors.js';

// ── Tools ─────────────────────────────────────────────
export type {
  ToolSideEffectLevel,
  ToolParameterProperty,
  ToolParameterSchema,
  ToolDefinition,
  ToolCallResult,
  ToolCallStatus,
  ToolCallRecord,
  ExecutedToolCallRecord,
  ToolExecutionContext,
  ToolPermissions,
  ToolProviderType,
  ToolProvider,
  McpToolProviderConfig,
  ToolDenyReason,
} from './tools/index.js';
export { ToolRegistry } from './tools/index.js';
export { ToolExecutor } from './tools/index.js';
export type { LLMToolEntry } from './tools/index.js';
export { BuiltinToolProvider } from './tools/index.js';
export { PresetToolProvider } from './tools/index.js';
export type { PresetToolInput } from './tools/index.js';

