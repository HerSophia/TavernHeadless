// ── Chat Role ─────────────────────────────────────────

import type { MemoryRuntimeMode } from '../memory/types.js';

/** LLM 消息角色 */
export type ChatRole = 'system' | 'user' | 'assistant';

// ── Prompt IR ─────────────────────────────────────────

/**
 * IR 消息：Prompt IR 的最小单元
 *
 * 每条消息携带角色、内容、以及用于裁剪决策的元数据。
 */
export interface IRMessage {
  /** 消息角色 */
  role: ChatRole;
  /** 消息内容（纯文本） */
  content: string;
  /** 消息来源标记，用于调试追溯（如 'system_prompt', 'worldbook:entry_42'） */
  source?: string;
  /** token 估算值（由 TokenBudget.estimate 填充） */
  tokenCount?: number;
  /** 是否可被裁剪（默认 true；系统提示通常设为 false） */
  prunable?: boolean;
  /** 裁剪优先级（0 = 最高优先保留，数值越大越先被裁剪） */
  priority?: number;
}

export interface IRSectionInsertion {
  /** 插入方式 */
  kind: 'relative' | 'in_chat';
  /** in-chat 插入深度 */
  depth?: number;
  /** 同深度下的排序值 */
  order?: number;
}

export type IRSectionSemantic = 'chat_history';

export type PromptBudgetGroup = 'history' | 'worldbook' | 'memory' | (string & {});

/**
 * IR 分区：按逻辑分组的消息块
 *
 * 典型分区：system_prompt, worldbook, history, jailbreak, memory 等。
 */
export interface IRSection {
  /** 分区名称 */
  name: string;
  /** 该分区的消息列表 */
  messages: IRMessage[];
  /** 分区是否固定（固定分区不参与裁剪） */
  pinned?: boolean;
  /** 可选：预算来源组（如 history / worldbook / memory） */
  budgetGroup?: PromptBudgetGroup;
  /** 可选：组内预算优先级（第一版仅保留字段，不参与复杂分配） */
  budgetPriority?: number;
  /** 分区排序权重（数值小的排前面） */
  order: number;
  /** 可选：分区的插入语义 */
  insertion?: IRSectionInsertion;
  /** 可选：分区的语义类型 */
  semantic?: IRSectionSemantic;
}

/**
 * 完整的 Prompt IR
 *
 * 所有编排路径（compat / native）的输出都是 PromptIR，
 * 所有渲染器的输入也是 PromptIR。
 */
export interface PromptIR {
  /** 所有分区 */
  sections: IRSection[];
  /** 全局元信息 */
  metadata: PromptMetadata;
}

/** Prompt 元信息 */
export interface PromptMetadata {
  /** 最大 token 预算（包含回复预留） */
  maxTokens: number;
  /** 预留给 LLM 回复的 token 数 */
  reservedForReply: number;
  /** 使用的 token 计数方式标识 */
  tokenizer?: string;
}

// ── Token Counter ─────────────────────────────────────

/**
 * Token 计数策略接口
 *
 * 通过接口注入不同的计数实现（简单估算 / tiktoken / 模型自带计数）。
 */
export interface TokenCounter {
  /** 估算字符串的 token 数 */
  count(text: string): number;
  /** 计数器标识名 */
  name: string;
}

// ── 拼装输出 ──────────────────────────────────────────

/** 最终发给 LLM 的单条消息 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** 消息拼装结果 */
export interface AssembledPrompt {
  /** 最终消息数组 */
  messages: ChatMessage[];
  /** token 使用统计 */
  tokenUsage: {
    /** 总 token 数 */
    total: number;
    /** 各分区 token 占用 */
    bySection: Record<string, number>;
    /** 各预算组 token 占用 */
    byGroup: Record<string, number>;
    /** 各预算组被裁剪的 token 占用 */
    prunedByGroup: Record<string, number>;
    /** 可选：allocator 级预算分配信息 */
    allocator?: {
      /** 各预算组进入 allocator 前的可裁剪 token 估算 */
      estimatedByGroup: Record<string, number>;
      /** 各预算组的目标分配结果 */
      allocatedByGroup: Record<string, number>;
      /** allocator 生成的 trim reason */
      trimReasons: PromptTrimReason[];
    };
    /** 留给回复的 token 数 */
    availableForReply: number;
  };
  /** 被裁剪的消息数量 */
  prunedCount: number;
}

/**
 * 单轮 Prompt 快照记录。
 *
 * 用于记录某个 floor 在实际生成时冻结使用的 Prompt 资源版本与摘要信息。
 */
export interface PromptSnapshotWorldbookActivationSource {
  kind: 'session_worldbook' | 'character_book';
  worldbookId: string | null;
  worldbookName: string;
  assetScopeId: string;
}

export interface PromptSnapshotWorldbookInsertion {
  position:
    | 'before'
    | 'after'
    | 'an_top'
    | 'an_bottom'
    | 'em_top'
    | 'em_bottom'
    | 'at_depth'
    | 'outlet';
  depth?: number;
  role?: ChatRole;
  outletName?: string;
}

export interface PromptSnapshotWorldbookActivation {
  uid: number;
  activationKey: string;
  source: PromptSnapshotWorldbookActivationSource;
  insertion: PromptSnapshotWorldbookInsertion;
}

export interface PromptSnapshotRecord {
  floorId: string;
  sessionId: string;
  presetId: string | null;
  presetUpdatedAt: number | null;
  presetVersion: number | null;
  presetVersionId?: string | null;
  presetContentHash?: string | null;
  worldbookId: string | null;
  worldbookUpdatedAt: number | null;
  worldbookVersion: number | null;
  worldbookVersionId?: string | null;
  worldbookContentHash?: string | null;
  regexProfileId: string | null;
  regexProfileUpdatedAt: number | null;
  regexProfileVersion: number | null;
  regexProfileVersionId?: string | null;
  regexProfileContentHash?: string | null;
  characterId: string | null;
  characterVersionId: string | null;
  characterImportedFormat: string | null;
  characterContentHash: string | null;
  worldbookActivatedEntryUids: number[];
  worldbookActivatedEntries: PromptSnapshotWorldbookActivation[];
  regexPreRuleNames: string[];
  regexPostRuleNames: string[];
  promptMode: 'native' | 'compat_plus' | 'compat_strict';
  assetManifestDigest: string | null;
  promptDigest: string;
  tokenEstimate: number;
  createdAt: number;
}

// ── Prompt Runtime Trace ───────────────────────────────

export interface PromptRuntimePresetTrace {
  selectedPromptOrderCharacterId: number | null;
  ignoredPromptOrderCharacterIds: number[];
  unsupportedFields: string[];
  ignoredFields: string[];
  unresolvedMarkers: string[];
  warnings: string[];
  triggerFilteredEntryIds: string[];
  inChatInsertedEntryIds: string[];
  continueNudgeApplied: boolean;
  continueNudgeText?: string;
  namesBehaviorApplied?: 'off' | 'always';
}

export interface PromptRuntimeWorldbookTrace<TWorldbookMatch = unknown> {
  hitCount: number;
  matches?: TWorldbookMatch[];
}

export type PromptRuntimeRegexPhaseId =
  | 'persist.user_input'
  | 'prompt.user_input'
  | 'persist.ai_output'
  | 'prompt.world_info.reserved';

export type PromptRuntimeRegexPhaseStatus = 'executed' | 'reserved';

export type PromptRuntimeRegexSkipReason =
  | 'channel_filtered'
  | 'depth_filtered'
  | 'invalid_regex'
  | 'no_match'
  | 'reserved_non_executable';

export type PromptRuntimeRegexSubstitutionMode = 'bare_variable_only';

export interface PromptRuntimeRegexSkippedRule {
  ruleName: string;
  reason: PromptRuntimeRegexSkipReason;
}

export interface PromptRuntimeRegexPhaseTrace {
  phaseId: PromptRuntimeRegexPhaseId;
  placement: number;
  channel: 'persist' | 'prompt' | 'display' | 'edit' | null;
  status: PromptRuntimeRegexPhaseStatus;
  changed: boolean;
  depth: number | null;
  inputTextHash: string | null;
  outputTextHash: string | null;
  candidateRuleNames: string[];
  matchedRuleNames: string[];
  skippedRules: PromptRuntimeRegexSkippedRule[];
}

export interface PromptRuntimeRegexTrace {
  userInputRules: string[];
  aiOutputRules: string[];
  preprocessedUserMessage?: string;
  phases?: PromptRuntimeRegexPhaseTrace[];
  reservedPlacements?: number[];
  substitutionMode?: PromptRuntimeRegexSubstitutionMode;
}

export interface PromptRuntimeBudgetGroupTrace {
  group: string;
  tokenCount: number;
  estimatedTokenCount?: number;
  allocatedTokenCount?: number;
  prunedTokenCount?: number;
}

export type PromptTrimReasonCode =
  | 'budget_exceeded'
  | 'group_limit_exceeded'
  | 'provider_constraint'
  | 'policy_disabled';

export interface PromptTrimReason {
  group: string;
  reason: PromptTrimReasonCode;
  detail?: string;
  prunedTokenCount?: number;
}

export type PromptRuntimeSourceKind =
  | 'history'
  | 'summary'
  | 'memory'
  | 'worldbook'
  | 'examples'
  | 'authors_note'
  | 'state_projection';

export type PromptSourceExclusionReasonCode =
  | 'disabled_by_policy'
  | 'budget_trimmed'
  | 'provider_constraint'
  | 'visibility_filtered'
  | 'not_triggered';

export interface PromptSourceExclusionReason {
  source: PromptRuntimeSourceKind;
  reason: PromptSourceExclusionReasonCode;
  detail?: string;
}

export interface PromptRuntimeBudgetTrace {
  byGroup: PromptRuntimeBudgetGroupTrace[];
  trimReasons?: PromptTrimReason[];
}

export type PromptRuntimeMemoryStrategy = 'none' | 'single_summary' | 'dual_summary' | 'direct_items';

export interface PromptRuntimeMemorySelectedItemTrace {
  memoryId: string;
  scope: 'global' | 'chat' | 'branch' | 'floor';
  scopeId: string;
  branchId?: string | null;
  kind: 'fact' | 'micro_summary' | 'macro_summary' | 'summary' | 'open_loop';
  source?: 'store' | 'summary' | 'open_loop' | 'fallback';
  score?: number | null;
  tokenCount?: number | null;
  selectedReason?: string | null;
}

export interface PromptRuntimeMemoryTokenStats {
  budget?: number | null;
  used: number;
  microSummary: number;
  macroSummary: number;
  directItems: number;
}

export interface PromptRuntimeMemoryScopeResolutionTrace {
  mode: 'branch_aware' | 'explicit_scope' | 'fallback' | 'strict_empty' | 'resolver_error' | 'legacy_direct';
  strict?: boolean;
  requestedScopes: Array<'global' | 'chat' | 'branch' | 'floor'>;
  resolvedScopes: Array<'global' | 'chat' | 'branch' | 'floor'>;
  requestedBranchId?: string | null;
  resolvedBranchId?: string | null;
  fallbackReason?: string | null;
}

export type PromptRuntimeMemoryProposalStatus =
  | 'not_requested'
  | 'skipped_by_request'
  | 'proposed'
  | 'promoted'
  | 'rejected'
  | 'superseded';

export type PromptRuntimeMemoryPromotionStatus =
  | 'not_requested'
  | 'promoted'
  | 'rejected'
  | 'superseded';

export interface PromptRuntimeMemoryTrace {
  /** 本轮最终是否真的把 memory summary 注入到了 prompt 中。 */
  summaryInjected: boolean;
  /** 当前回合落到哪条记忆写入主链。 */
  runtimeMode?: MemoryRuntimeMode;
  /** 当前请求是否要求产生记忆写入。 */
  requestedWrite?: boolean;
  /** 当前请求在现有主链与开关下，最终是否会产生真实写入。 */
  effectiveWrite?: boolean;
  /** 当前注入策略的外部可见说明。 */
  strategy?: PromptRuntimeMemoryStrategy;
  /** 兼容 `memorySummary` 的结构化别名。 */
  summaryText?: string;
  /** 注入摘要文本的稳定 hash。 */
  summaryTextHash?: string | null;
  /** 本轮实际进入注入块的记忆条目。 */
  selectedItems?: PromptRuntimeMemorySelectedItemTrace[];
  /** 注入预算与各类汇总占用。 */
  tokenStats?: PromptRuntimeMemoryTokenStats;
  /** 可见 scope 解析与 fallback 诊断。 */
  scopeResolution?: PromptRuntimeMemoryScopeResolutionTrace;
  /** 当前 proposal / promotion 关联的 pageId（若有）。 */
  pageId?: string;
  /** 当前 proposal batch id（若有）。 */
  proposalBatchId?: string;
  /** proposal 生命周期状态。 */
  proposalStatus?: PromptRuntimeMemoryProposalStatus;
  /** promotion 生命周期状态。 */
  promotionStatus?: PromptRuntimeMemoryPromotionStatus;
}

export interface PromptRuntimeMacroWarning {
  code: string;
  message: string;
  macroName?: string;
  rawText?: string;
}

export interface PromptRuntimeMacroMutationPreview {
  kind: 'set' | 'delete';
  scope: 'branch' | 'global';
  key: string;
  value?: string;
}

export interface PromptRuntimeMacroStagedMutation extends PromptRuntimeMacroMutationPreview {
  sourceMacro: string;
}

export interface PromptRuntimeMacroTraceEntry {
  macroName: string;
  rawText: string;
  resolvedText: string;
  phase?: string;
  sourceKind?: string;
  selectedBranch?: string;
}

export interface PromptRuntimeMacroTrace {
  warnings: PromptRuntimeMacroWarning[];
  usedNames: string[];
  mutationPreview: PromptRuntimeMacroMutationPreview[];
  stagedMutations: PromptRuntimeMacroStagedMutation[];
  traces: PromptRuntimeMacroTraceEntry[];
}

type PromptRuntimeAssistantPrefillStrategy = 'provider_native' | 'assistant_message_fallback' | 'transcript_append' | 'unsupported' | 'none';

type PromptRuntimeStructureMode = 'default' | 'strict_alternating' | 'no_assistant' | 'flattened';

type PromptRuntimeStructureAssistantRewriteStrategy = 'to_system' | 'to_user_transcript';

export interface PromptRuntimeStructureTrace {
  mode: PromptRuntimeStructureMode;
  mergeAdjacentSameRole: boolean;
  assistantRewriteCount: number;
  assistantRewriteStrategy?: PromptRuntimeStructureAssistantRewriteStrategy;
  tailAssistantDetected: boolean;
  transcriptized?: boolean;
  transcriptMessageCount?: number;
  assistantPrefillTranscriptized?: boolean;
}

export type PromptRuntimeDeliveryDegradeReason =
  | 'assistant_prefill_disabled'
  | 'assistant_prefill_unsupported'
  | 'require_last_user'
  | 'no_assistant_override';

export interface PromptRuntimeDeliveryTrace {
  assistantPrefillRequested: boolean;
  assistantPrefillApplied: boolean;
  assistantPrefillStrategy?: PromptRuntimeAssistantPrefillStrategy;
  allowAssistantPrefill: boolean;
  requireLastUser: boolean;
  noAssistant: boolean;
  lastMessageRole?: ChatRole | null;
  endsWithUser: boolean;
  degraded: boolean;
  degradeReasons: PromptRuntimeDeliveryDegradeReason[];
}

export interface PromptRuntimeVisibilityRange {
  startFloorNo: number;
  endFloorNo: number;
}

export interface PromptRuntimeVisibilityTrace {
  hiddenFloorRanges?: PromptRuntimeVisibilityRange[];
  filteredFloorNos?: number[];
}

export interface PromptRuntimeSourceSelectionTrace {
  excludedSources: PromptSourceExclusionReason[];
}

export interface PromptRuntimeSectionStat {
  sectionName: string;
  tokenCount: number;
}

export type PromptRuntimeGovernanceRetention =
  | 'fixed'
  | 'soft_required'
  | 'budget_prunable'
  | 'mixed';

export interface PromptRuntimeGovernancePolicy {
  sourceKind: string;
  budgetGroup: string;
  declaredLevel?: import('./runtime-registry.js').PromptRuntimeSourceGovernanceLevel;
  pinned: boolean;
  prunable: boolean;
  effectiveRetention: PromptRuntimeGovernanceRetention;
}

export interface PromptRuntimeGovernanceSeedEntry {
  sourceKind: string;
  declaredLevel?: import('./runtime-registry.js').PromptRuntimeSourceGovernanceLevel;
  registered: boolean;
  budgetGroups: string[];
  sectionNames: string[];
  pinnedValues: boolean[];
  prunableValues: boolean[];
  tokenCount: number;
  retainedTokenCount: number;
  prunedTokenCount: number;
}

export interface PromptRuntimeGovernanceSeed {
  entries: PromptRuntimeGovernanceSeedEntry[];
}

export type PromptRuntimeDiffChangeType = 'added' | 'removed' | 'changed';

export interface PromptRuntimeDiffEntry<TValue = unknown> {
  path: string;
  changeType: PromptRuntimeDiffChangeType;
  left?: TValue;
  right?: TValue;
}

export interface PromptRuntimeTrace<TWorldbookMatch = unknown> {
  preset?: PromptRuntimePresetTrace;
  worldbook?: PromptRuntimeWorldbookTrace<TWorldbookMatch>;
  regex?: PromptRuntimeRegexTrace;
  budgets?: PromptRuntimeBudgetTrace;
  sourceSelection?: PromptRuntimeSourceSelectionTrace;
  memory?: PromptRuntimeMemoryTrace;
  macro?: PromptRuntimeMacroTrace;
  structure?: PromptRuntimeStructureTrace;
  delivery?: PromptRuntimeDeliveryTrace;
  visibility?: PromptRuntimeVisibilityTrace;
}

export interface PromptRuntimeDebugView<TWorldbookMatch = unknown> {
  finalMessages?: ChatMessage[];
  trace?: PromptRuntimeTrace<TWorldbookMatch>;
}
