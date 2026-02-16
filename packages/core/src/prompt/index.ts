// ── Types ─────────────────────────────────────────────
export type {
  ChatRole,
  IRMessage,
  IRSection,
  PromptIR,
  PromptMetadata,
  TokenCounter,
  ChatMessage,
  AssembledPrompt,
} from './types.js';

// ── Template Engine ───────────────────────────────────
export { TemplateEngine, TemplateVariableError } from './template-engine.js';
export type { TemplateOptions } from './template-engine.js';

// ── Token Budget ──────────────────────────────────────
export { TokenBudget, SimpleTokenCounter } from './token-budget.js';

// ── Message Builder ───────────────────────────────────
export { MessageBuilder } from './message-builder.js';
export type { MessageBuilderOptions } from './message-builder.js';

// ── Native Pipeline ────────────────────────────────────
export {
  assembleNativePrompt,
  TemplateNode,
  WorldbookResolveNode,
  MemoryInjectNode,
  TokenBudgetNode,
  PackMessagesNode,
  NativePipelineError,
} from './native-pipeline.js';
export type { NativePromptMode, NativeWorldbookEntry, NativePipelineInput, NativePipelineState, NativePipelineNode, NativePipelineInputSummary, NativePipelineStateSummary } from './native-pipeline.js';
