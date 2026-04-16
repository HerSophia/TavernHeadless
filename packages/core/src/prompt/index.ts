// ── Types ─────────────────────────────────────────────
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
} from './types.js';

// ── Template Engine ───────────────────────────────────
export { TemplateEngine, TemplateVariableError } from './template-engine.js';
export type { TemplateOptions } from './template-engine.js';

// ── Token Budget ──────────────────────────────────────
export { TokenBudget, SimpleTokenCounter } from './token-budget.js';
export {
  buildPromptRuntimeSectionBudgetGroup,
  resolvePromptRuntimeSourceDescriptor,
  resolvePromptRuntimeBudgetGroupDescriptor,
  resolvePromptRuntimeBudgetGroupDefaults,
  resolvePromptRuntimeBudgetGroupExclusionSource,
  resolvePromptRuntimeBudgetGroupTraceLabel,
  resolvePromptRuntimeSourceGovernanceLevel,
  PROMPT_MEMORY_SECTION_NAME,
  PROMPT_MEMORY_MESSAGE_SOURCE,
} from './runtime-registry.js';
export type {
  PromptRuntimeSourceDescriptor,
  PromptRuntimeBudgetGroupDescriptor,
  PromptRuntimeSourceGovernanceLevel,
} from './runtime-registry.js';

// ── Message Builder ───────────────────────────────────
export { MessageBuilder } from './message-builder.js';
export type { MessageBuilderOptions } from './message-builder.js';

// ── Native Pipeline ────────────────────────────────────
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
} from './native-pipeline.js';
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
} from './native-pipeline.js';
