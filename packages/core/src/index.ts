// ── Events ────────────────────────────────────────────
export { createEventBus } from './events/index.js';
export type { CoreEventBus } from './events/index.js';
export type {
  CoreEventMap,
  FloorStateChangedEvent,
  FloorCommittedEvent,
  FloorFailedEvent,
  FloorRunType,
  FloorRunStatus,
  FloorRunPhase,
  FloorRunPublicPhase,
  FloorRunPendingOutputState,
  FloorRunVerifierStatus,
  FloorRunVerifierIssue,
  FloorRunVerifierSnapshot,
  FloorRunPendingOutput,
  FloorRunError,
  FloorRunSnapshot,
  FloorRunUpdatedEvent,
  FloorRunCompletedEvent,
  FloorRunFailedEvent,
  VariableSetEvent,
  VariablePromotedEvent,
  VariableDeletedEvent,
  GenerationStartedEvent,
  GenerationChunkEvent,
  GenerationCompletedEvent,
  GenerationFailedEvent,
  CommitRetryEvent,
  CommitBusyEvent,
  CommitSucceededAfterRetryEvent,
  MemoryEventContext,
  MemoryJobEventContext,
  MemoryCreatedEvent,
  MemoryUpdatedEvent,
  MemoryDeprecatedEvent,
  MemoryInjectionFailedEvent,
  MemoryPersistFailedEvent,
  MemoryConsolidationContextFailedEvent,
  MemoryConsolidationJsonParseFailedEvent,
  MemoryConsolidatedEvent,
  MemoryConsolidationFailedEvent,
  RuntimeJobEvent,
  RuntimeJobEnqueuedEvent,
  RuntimeJobLeasedEvent,
  RuntimeJobStartedEvent,
  RuntimeJobProgressUpdatedEvent,
  RuntimeJobSucceededEvent,
  RuntimeJobRetryScheduledEvent,
  RuntimeJobDeadLetteredEvent,
  RuntimeJobCancelledEvent,
  RuntimeJobLeaseLostEvent,
  RuntimeMutationEvent,
  RuntimeMutationCreatedEvent,
  RuntimeMutationAppliedEvent,
  RuntimeMutationSkippedEvent,
  RuntimeMutationFailedEvent,
  RuntimeMutationEventOutcome,
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
export { FloorNotFoundError, FloorStateConflictError, InvalidStateTransitionError } from './errors.js';
export type { FloorEntity } from './types.js';
export type { FloorRepository } from './ports/floor-repository.js';

// ── Variables ─────────────────────────────────────────
export { VariableResolver } from './variables/index.js';
export { VariableStore } from './variables/index.js';
export type { VariableContext } from './types.js';
export type { VariableRepository, VariableRepositoryOptions } from './ports/variable-repository.js';

// ── Repository Ports ──────────────────────────────────
export type { MemoryRepository } from './ports/memory-repository.js';

// ── Prompt ────────────────────────────────────────────
export type {
  ChatRole,
  IRMessage,
  IRSection,
  IRSectionInsertion,
  IRSectionSemantic,
  PromptIR,
  PromptMetadata,
  PromptBudgetGroup,
  TokenCounter,
  ChatMessage,
  AssembledPrompt,
  PromptSnapshotRecord,
  PromptRuntimeBudgetGroupTrace,
  PromptTrimReasonCode,
  PromptTrimReason,
  PromptRuntimeBudgetTrace,
  PromptRuntimeSourceKind,
  PromptSourceExclusionReasonCode,
  PromptSourceExclusionReason,
  PromptRuntimePresetTrace,
  PromptRuntimeWorldbookTrace,
  PromptRuntimeRegexTrace,
  PromptRuntimeStructureTrace,
  PromptRuntimeMemoryTrace,
  PromptRuntimeMacroWarning,
  PromptRuntimeMacroMutationPreview,
  PromptRuntimeMacroStagedMutation,
  PromptRuntimeMacroTraceEntry,
  PromptRuntimeMacroTrace,
  PromptRuntimeDeliveryDegradeReason,
  PromptRuntimeDeliveryTrace,
  PromptRuntimeVisibilityRange,
  PromptRuntimeVisibilityTrace,
  PromptRuntimeSourceSelectionTrace,
  PromptRuntimeSectionStat,
  PromptRuntimeDiffChangeType,
  PromptRuntimeDiffEntry,
  PromptRuntimeTrace,
  PromptRuntimeDebugView,
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

// ── Prompt Graph ──────────────────────────────────────
export type {
  PromptRunIntent,
  PromptTrigger,
  PromptPlacement,
  PromptNodeBase,
  StaticTextNode,
  VariableTemplateNode,
  MarkerNode,
  ChatHistoryNode,
  CharacterNode,
  PersonaNode,
  WorldbookNode,
  ExampleDialogueNode,
  MemoryNode,
  ToolResultNode,
  PromptNode,
  PromptEdge,
  PromptNodeGroup,
  PromptExecutionPolicy,
  PromptGraphImportBinding,
  PromptGraphDocument,
  PromptGraphCharacterInput,
  PromptGraphPersonaInput,
  PromptGraphWorldbookEntry,
  PromptGraphCompilerInput,
  PromptGraphCompiler,
} from './prompt-graph/index.js';
export { compilePromptGraph, PromptGraphCompileError } from './prompt-graph/index.js';

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
  MemoryFactAddOperation,
  MemoryFactUpdateOperation,
  MemoryFactDeprecateOperation,
  MemoryOpenLoopAddOperation,
  MemoryOpenLoopResolveOperation,
  MemoryCompactionOutput,
  MemoryIngestOutput,
  MemoryInjectionOptions,
  MemoryInjectionResult,
  MemoryAccessOptions,
  MemoryScopeContext,
  MemoryScopeRef,
} from './memory/index.js';
export { MemoryStore } from './memory/index.js';
export { MemoryConsolidator } from './memory/index.js';
export { MemoryInjectionSelector } from './memory/index.js';
export { MemoryIngestProcessor } from './memory/index.js';
export { MemoryCompactionPlanner, MemoryCompactionProcessor } from './memory/index.js';
export {
  MemoryScopeResolver,
  MemoryScopeResolutionError,
  MemoryMutationApplier,
  MemoryRevisionGuard,
  MemoryRevisionConflictError,
} from './memory/index.js';
export type {
  MemoryInjectionStrategy,
  MemoryScopeResolutionContext,
  ResolvedMemoryScopeRef,
  MemoryMutationStore,
  MemoryMutationEvent,
  MemoryMutationCounts,
  MemorySummaryMutationResult,
  MemoryRevisionRef,
  MemoryRevisionSnapshot,
} from './memory/index.js';

// ── Orchestration ─────────────────────────────────────
export { TurnOrchestrator, TurnError, ToolReplayBlockedError, UnsupportedToolModeError } from './orchestration/turn-orchestrator.js';
export { Director } from './orchestration/director.js';
export { Verifier } from './orchestration/verifier.js';
export type {
  TurnConfig,
  VerifierFailStrategy,
  ToolMode,
  TurnInput,
  TurnExecutionResult,
  TurnOutput,
  TurnRunObserver,
} from './orchestration/types.js';
export type { DirectorInput, DirectorResult } from './orchestration/director.js';
export type { VerifierInput, VerifierResult } from './orchestration/verifier.js';

// ── Tools ─────────────────────────────────────────────
export { ToolRegistry } from './tools/tool-registry.js';
export { ToolExecutor } from './tools/tool-executor.js';
export { BuiltinToolProvider } from './tools/builtin-provider.js';
export { PresetToolProvider } from './tools/preset-provider.js';
export { ToolMutationBuffer } from './tools/tool-mutation-buffer.js';
export type {
  ToolDefinition,
  ToolSideEffectLevel,
  ToolExecutionDeliveryMode,
  ToolAsyncCapability,
  ToolResultVisibility,
  ToolParameterProperty,
  ToolParameterSchema,
  ToolAsyncReceipt,
  RuntimeToolEnvelope,
  PendingToolJobRequest,
  RuntimeToolDispatchResult,
  ToolCallResult,
  ToolCallStatus,
  ToolProvider,
  BufferedToolVariableMutation,
  ToolPermissions,
  ToolProviderType,
  ToolDenyReason,
  ToolCallRecord,
  ExecutedToolCallRecord,
  ToolExecutionOpenRecord,
  ToolExecutionFinishPatch,
  ToolExecutionContext,
  ToolExecutionStatus,
  ToolExecutionCommitOutcome,
  ToolExecutionLifecycleState,
  ToolReplaySafety,
  ToolProviderCompensationMode,
  ToolReplaySafetyEvaluation,
  ToolExecutionProviderType,
  McpToolProviderConfig,
} from './tools/types.js';
export type { PresetToolInput } from './tools/preset-provider.js';
export {
  evaluateToolReplaySafety,
  evaluateExecutedToolCallReplaySafety,
  isAutoReplaySafe,
  resolveToolProviderCompensationMode,
} from './tools/replay-safety.js';

// ── Ports ─────────────────────────────────────────────
export type { PromptSnapshotRepository } from './ports/prompt-snapshot-repository.js';
export type { ToolExecutionRepository } from './ports/tool-execution-repository.js';
