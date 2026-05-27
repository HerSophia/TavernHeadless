import {
  compactObject,
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readOptionalString,
  readRecord,
  readString,
} from "./resources/utils.js";

export type PromptLiveDebugOptions = {
  includePromptSnapshot?: boolean;
  includeRuntimeTrace?: boolean;
  includeWorldbookMatches?: boolean;
};

export type PromptSnapshotMode = "compat_strict" | "compat_plus" | "native";

export type PromptSnapshotWorldbookActivationSource = {
  kind: "session_worldbook" | "character_book";
  worldbookId: string | null;
  worldbookName: string;
  assetScopeId: string;
};

export type PromptSnapshotWorldbookInsertion = {
  depth?: number;
  outletName?: string;
  position:
    | "before"
    | "after"
    | "an_top"
    | "an_bottom"
    | "em_top"
    | "em_bottom"
    | "at_depth"
    | "outlet";
  role?: "system" | "user" | "assistant";
};

export type PromptSnapshotWorldbookActivation = {
  uid: number;
  activationKey: string;
  source: PromptSnapshotWorldbookActivationSource;
  insertion: PromptSnapshotWorldbookInsertion;
};

export type PromptSnapshotPreview = {
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
  characterId?: string | null;
  characterVersionId?: string | null;
  characterImportedFormat?: string | null;
  characterContentHash?: string | null;
  worldbookActivatedEntryUids: number[];
  worldbookActivatedEntries?: PromptSnapshotWorldbookActivation[];
  regexPreRuleNames: string[];
  regexPostRuleNames: string[];
  promptMode: PromptSnapshotMode;
  assetManifestDigest?: string | null;
  promptDigest: string;
  tokenEstimate: number;
};

export type PromptRuntimeWorldbookFirstMatch = {
  charEnd: number;
  charStart: number;
  excerpt: string;
  injectionIndex?: number;
  matchedKey: string;
  matchedKeyScope: "primary" | "secondary";
  matchedKeyType: "plain" | "regex";
  messageIndexFromLatest?: number;
  sourceKind:
    | "message"
    | "persona_description"
    | "character_description"
    | "character_personality"
    | "character_depth_prompt"
    | "scenario"
    | "creator_notes"
    | "injection"
    | "recursion_buffer";
};

export type PromptRuntimeWorldbookMatchActivation = {
  firstMatch: PromptRuntimeWorldbookFirstMatch | null;
  mode: "constant" | "triggered";
  recursionLevel: number;
};

export type PromptRuntimeWorldbookMatchInsertion = {
  depth?: number;
  outletName?: string;
  position:
    | "before"
    | "after"
    | "an_top"
    | "an_bottom"
    | "em_top"
    | "em_bottom"
    | "at_depth"
    | "outlet";
  role?: "system" | "user" | "assistant";
};

export type PromptRuntimeWorldbookMatchSource = {
  kind: "session_worldbook" | "character_book";
  worldbookId: string | null;
  assetScopeId?: string;
  worldbookName: string;
};

export type PromptRuntimeWorldbookMatchDetail = {
  activation: PromptRuntimeWorldbookMatchActivation;
  comment: string;
  contentPreview: string;
  insertion: PromptRuntimeWorldbookMatchInsertion;
  order: number;
  source: PromptRuntimeWorldbookMatchSource;
  activationKey?: string;
  assetScopeId?: string;
  uid: number;
};

export type PromptRuntimePresetTrace = {
  continueNudgeApplied: boolean;
  continueNudgeText: string | null;
  ignoredFields: string[];
  ignoredPromptOrderCharacterIds: number[];
  inChatInsertedEntryIds: string[];
  namesBehaviorApplied: "off" | "always" | null;
  selectedPromptOrderCharacterId: number | null;
  triggerFilteredEntryIds: string[];
  unresolvedMarkers: string[];
  unsupportedFields: string[];
  warnings: string[];
};

export type PromptRuntimeWorldbookTrace = {
  hitCount: number;
  matches?: PromptRuntimeWorldbookMatchDetail[];
};

export type PromptRuntimeRegexPhaseId =
  | "persist.user_input"
  | "prompt.user_input"
  | "persist.ai_output"
  | "prompt.world_info.reserved";

export type PromptRuntimeRegexPhaseStatus = "executed" | "reserved";

export type PromptRuntimeRegexSkipReason =
  | "channel_filtered"
  | "depth_filtered"
  | "invalid_regex"
  | "no_match"
  | "reserved_non_executable";

export type PromptRuntimeRegexSubstitutionMode = "bare_variable_only";

export type PromptRuntimeRegexSkippedRule = {
  ruleName: string;
  reason: PromptRuntimeRegexSkipReason;
};

export type PromptRuntimeRegexPhaseTrace = {
  phaseId: PromptRuntimeRegexPhaseId;
  placement: number;
  channel: "persist" | "prompt" | "display" | "edit" | null;
  status: PromptRuntimeRegexPhaseStatus;
  changed: boolean;
  depth: number | null;
  inputTextHash: string | null;
  outputTextHash: string | null;
  candidateRuleNames: string[];
  matchedRuleNames: string[];
  skippedRules: PromptRuntimeRegexSkippedRule[];
};

export type PromptRuntimeRegexTrace = {
  aiOutputRules: string[];
  preprocessedUserMessage: string | null;
  userInputRules: string[];
  phases?: PromptRuntimeRegexPhaseTrace[];
  reservedPlacements?: number[];
  substitutionMode?: PromptRuntimeRegexSubstitutionMode;
};

export type PromptRuntimeBudgetGroupTrace = {
  allocatedTokenCount?: number;
  estimatedTokenCount?: number;
  group: string;
  prunedTokenCount?: number;
  tokenCount: number;
};

export type PromptTrimReasonCode =
  | "budget_exceeded"
  | "group_limit_exceeded"
  | "provider_constraint"
  | "policy_disabled";

export type PromptTrimReason = {
  detail?: string;
  group: string;
  prunedTokenCount?: number;
  reason: PromptTrimReasonCode;
};

export type PromptRuntimeBudgetTrace = {
  byGroup: PromptRuntimeBudgetGroupTrace[];
  trimReasons?: PromptTrimReason[];
};

export type PromptRuntimeSourceKind = "history" | "summary" | "memory" | "worldbook" | "examples" | "authors_note";
export type PromptSourceExclusionReasonCode = "disabled_by_policy" | "budget_trimmed" | "provider_constraint" | "visibility_filtered" | "not_triggered";
export type PromptSourceExclusionReason = {
  detail?: string;
  reason: PromptSourceExclusionReasonCode;
  source: PromptRuntimeSourceKind;
};
export type PromptRuntimeSourceSelectionTrace = { excludedSources: PromptSourceExclusionReason[] };

export type PromptRuntimeStructureTrace = {
  assistantRewriteCount: number;
  assistantRewriteStrategy: "to_system" | "to_user_transcript" | null;
  assistantPrefillTranscriptized?: boolean;
  mergeAdjacentSameRole: boolean;
  mode: "default" | "strict_alternating" | "no_assistant" | "flattened";
  tailAssistantDetected: boolean;
  transcriptized?: boolean;
  transcriptMessageCount?: number;
};

export type PromptRuntimeMemoryTrace = {
  effectiveWrite?: boolean;
  pageId?: string;
  promotionStatus?: PromptRuntimeMemoryPromotionStatus;
  proposalBatchId?: string;
  proposalStatus?: PromptRuntimeMemoryProposalStatus;
  requestedWrite?: boolean;
  runtimeMode?: PromptRuntimeMemoryRuntimeMode;
  scopeResolution?: PromptRuntimeMemoryScopeResolutionTrace;
  selectedItems?: PromptRuntimeMemorySelectedItemTrace[];
  strategy?: PromptRuntimeMemoryStrategy;
  summaryText?: string;
  summaryTextHash?: string | null;
  summaryInjected: boolean;
  tokenStats?: PromptRuntimeMemoryTokenStats;
};

export type PromptRuntimeMemoryRuntimeMode = "disabled" | "legacy_sync" | "async_primary";
export type PromptRuntimeMemoryStrategy = "none" | "single_summary" | "dual_summary" | "direct_items";
export type PromptRuntimeMemorySelectedItemScope = "global" | "chat" | "branch" | "floor";
export type PromptRuntimeMemorySelectedItemKind = "fact" | "micro_summary" | "macro_summary" | "summary" | "open_loop";
export type PromptRuntimeMemorySelectedItemSource = "store" | "summary" | "open_loop" | "fallback";
export type PromptRuntimeMemoryScopeResolutionMode =
  | "branch_aware"
  | "explicit_scope"
  | "fallback"
  | "strict_empty"
  | "resolver_error"
  | "legacy_direct";
export type PromptRuntimeMemoryProposalStatus =
  | "not_requested"
  | "skipped_by_request"
  | "proposed"
  | "promoted"
  | "rejected"
  | "superseded";
export type PromptRuntimeMemoryPromotionStatus = "not_requested" | "promoted" | "rejected" | "superseded";

export type PromptRuntimeMemorySelectedItemTrace = {
  branchId?: string | null;
  kind: PromptRuntimeMemorySelectedItemKind;
  memoryId: string;
  scope: PromptRuntimeMemorySelectedItemScope;
  scopeId: string;
  score?: number | null;
  selectedReason?: string | null;
  source?: PromptRuntimeMemorySelectedItemSource;
  tokenCount?: number | null;
};

export type PromptRuntimeMemoryTokenStats = {
  budget?: number | null;
  directItems: number;
  macroSummary: number;
  microSummary: number;
  used: number;
};

export type PromptRuntimeMemoryScopeResolutionTrace = {
  fallbackReason?: string | null;
  mode: PromptRuntimeMemoryScopeResolutionMode;
  requestedBranchId?: string | null;
  requestedScopes: PromptRuntimeMemorySelectedItemScope[];
  resolvedBranchId?: string | null;
  resolvedScopes: PromptRuntimeMemorySelectedItemScope[];
  strict?: boolean;
};

export type PromptRuntimeMemoryInjectionScope = "global" | "chat" | "branch" | "floor";
export type PromptRuntimeMemoryInjectionType = "fact" | "summary" | "open_loop";
export type PromptRuntimeMemoryInjectionStatus = "active" | "deprecated";
export type PromptRuntimeMemoryInjectionSummaryTier = "micro" | "macro";
export type PromptRuntimeMemoryInjectionScopeResolutionMode =
  | "visible_refs"
  | "explicit_scope"
  | "direct_scope_fallback"
  | "strict_empty"
  | "resolver_error";

export type PromptRuntimeMemoryInjectionScopeRef = {
  scope: PromptRuntimeMemoryInjectionScope;
  scopeId: string;
};

export type PromptRuntimeMemoryInjectionScopeResolution = {
  mode: PromptRuntimeMemoryInjectionScopeResolutionMode;
  strict: boolean;
  scopeRefs?: PromptRuntimeMemoryInjectionScopeRef[];
  explicitScope?: PromptRuntimeMemoryInjectionScopeRef;
  fallbackScopeId?: string;
  error?: { name: string; message: string };
} | null;

export type PromptRuntimeMemoryInjectionItem = {
  confidence: number;
  content: string;
  createdAt: number;
  factKey: string | null;
  id: string;
  importance: number;
  scope: PromptRuntimeMemoryInjectionScope;
  scopeId: string;
  sourceFloorId: string | null;
  sourceMessageId: string | null;
  status: PromptRuntimeMemoryInjectionStatus;
  summaryTier: PromptRuntimeMemoryInjectionSummaryTier | null;
  tokenCountEstimate: number | null;
  type: PromptRuntimeMemoryInjectionType;
  updatedAt: number;
};

export type PromptRuntimeMemoryInjectionResult = {
  formattedText: string;
  items: PromptRuntimeMemoryInjectionItem[];
  scopeResolution: PromptRuntimeMemoryInjectionScopeResolution;
  tokenCount: number;
};

export type PromptRuntimeMacroWarning = {
  code: string;
  macroName?: string;
  message: string;
  rawText?: string;
};

export type PromptRuntimeMacroMutationPreview = {
  key: string;
  kind: "set" | "delete";
  scope: "branch" | "global";
  value?: string;
};

export type PromptRuntimeMacroStagedMutation = PromptRuntimeMacroMutationPreview & {
  sourceMacro: string;
};

export type PromptRuntimeMacroTraceEntry = {
  macroName: string;
  phase?: string;
  rawText: string;
  resolvedText: string;
  selectedBranch?: string;
  sourceKind?: string;
};

export type PromptRuntimeMacroTrace = {
  mutationPreview: PromptRuntimeMacroMutationPreview[];
  stagedMutations: PromptRuntimeMacroStagedMutation[];
  traces: PromptRuntimeMacroTraceEntry[];
  usedNames: string[];
  warnings: PromptRuntimeMacroWarning[];
};

export type PromptRuntimeDeliveryDegradeReason =
  | "assistant_prefill_disabled"
  | "assistant_prefill_unsupported"
  | "require_last_user"
  | "no_assistant_override";

export type PromptRuntimeDeliveryTrace = {
  allowAssistantPrefill: boolean;
  assistantPrefillApplied: boolean;
  assistantPrefillRequested: boolean;
  assistantPrefillStrategy: "provider_native" | "assistant_message_fallback" | "transcript_append" | "unsupported" | "none" | null;
  degradeReasons: PromptRuntimeDeliveryDegradeReason[];
  degraded: boolean;
  endsWithUser: boolean;
  lastMessageRole: "system" | "user" | "assistant" | null;
  noAssistant: boolean;
  requireLastUser: boolean;
};

export type PromptRuntimeVisibilityRange = {
  startFloorNo: number;
  endFloorNo: number;
};

export type PromptRuntimeVisibilityTrace = {
  filteredFloorNos: number[];
  hiddenFloorRanges?: PromptRuntimeVisibilityRange[];
};

export type PromptRuntimeHistoryNormalizationViolation = {
  code: "adjacent_assistant_floors";
  message: string;
  sourceFloorIds: string[];
  sourceMessageIds: string[];
};

export type PromptRuntimeMergedUserGroupSummary = {
  effectiveRole: "user";
  sourceFloorIds: string[];
  sourceMessageIds: string[];
  includesCurrentInput: boolean;
};

export type PromptRuntimeHistoryNormalizationTrace = {
  rawEntryCount: number;
  effectiveTurnCount: number;
  selectedTurnCount: number;
  trailingUserSourceFloorIds: string[];
  mergedUserGroups: PromptRuntimeMergedUserGroupSummary[];
  violations: PromptRuntimeHistoryNormalizationViolation[];
};

export type PromptRuntimeTrace = {
  budgets?: PromptRuntimeBudgetTrace;
  delivery?: PromptRuntimeDeliveryTrace;
  macro?: PromptRuntimeMacroTrace;
  memory?: PromptRuntimeMemoryTrace;
  sourceSelection?: PromptRuntimeSourceSelectionTrace;
  preset?: PromptRuntimePresetTrace;
  regex?: PromptRuntimeRegexTrace;
  structure?: PromptRuntimeStructureTrace;
  visibility?: PromptRuntimeVisibilityTrace;
  historyNormalization?: PromptRuntimeHistoryNormalizationTrace;
  worldbook?: PromptRuntimeWorldbookTrace;
};

export type PromptRuntimePreviewTrace = Pick<PromptRuntimeTrace, "macro" | "sourceSelection" | "visibility" | "historyNormalization">;

export type PromptDebugPayload = {
  promptSnapshot?: PromptSnapshotPreview;
  runtimeTrace?: PromptRuntimeTrace;
};

export function mapPromptLiveDebugOptionsRequest(
  debugOptions?: PromptLiveDebugOptions,
): Record<string, unknown> | undefined {
  if (!debugOptions) {
    return undefined;
  }

  const mapped = compactObject({
    include_prompt_snapshot: debugOptions.includePromptSnapshot,
    include_runtime_trace: debugOptions.includeRuntimeTrace,
    include_worldbook_matches: debugOptions.includeWorldbookMatches,
  });

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

export function mapPromptSnapshotPayload(value: unknown): PromptSnapshotPreview | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    presetId: readNullableString(record.preset_id),
    presetUpdatedAt: readNullableNumber(record.preset_updated_at),
    presetVersion: readNullableNumber(record.preset_version),
    ...(record.preset_version_id !== undefined
      ? { presetVersionId: readNullableString(record.preset_version_id) }
      : {}),
    ...(record.preset_content_hash !== undefined
      ? { presetContentHash: readNullableString(record.preset_content_hash) }
      : {}),
    worldbookId: readNullableString(record.worldbook_id),
    worldbookUpdatedAt: readNullableNumber(record.worldbook_updated_at),
    worldbookVersion: readNullableNumber(record.worldbook_version),
    ...(record.worldbook_version_id !== undefined
      ? { worldbookVersionId: readNullableString(record.worldbook_version_id) }
      : {}),
    ...(record.worldbook_content_hash !== undefined
      ? { worldbookContentHash: readNullableString(record.worldbook_content_hash) }
      : {}),
    regexProfileId: readNullableString(record.regex_profile_id),
    regexProfileUpdatedAt: readNullableNumber(record.regex_profile_updated_at),
    regexProfileVersion: readNullableNumber(record.regex_profile_version),
    ...(record.regex_profile_version_id !== undefined
      ? { regexProfileVersionId: readNullableString(record.regex_profile_version_id) }
      : {}),
    ...(record.regex_profile_content_hash !== undefined
      ? { regexProfileContentHash: readNullableString(record.regex_profile_content_hash) }
      : {}),
    ...(record.character_id !== undefined
      ? { characterId: readNullableString(record.character_id) }
      : {}),
    ...(record.character_version_id !== undefined
      ? { characterVersionId: readNullableString(record.character_version_id) }
      : {}),
    ...(record.character_imported_format !== undefined
      ? { characterImportedFormat: readNullableString(record.character_imported_format) }
      : {}),
    ...(record.character_content_hash !== undefined
      ? { characterContentHash: readNullableString(record.character_content_hash) }
      : {}),
    worldbookActivatedEntryUids: mapNumberArray(record.worldbook_activated_entry_uids),
    ...(record.worldbook_activated_entries !== undefined
      ? {
          worldbookActivatedEntries: readArray(record.worldbook_activated_entries)
            .map(mapPromptSnapshotWorldbookActivation)
            .filter((item): item is PromptSnapshotWorldbookActivation => item !== null),
        }
      : {}),
    regexPreRuleNames: mapStringArray(record.regex_pre_rule_names),
    regexPostRuleNames: mapStringArray(record.regex_post_rule_names),
    promptMode: readPromptSnapshotMode(record.prompt_mode),
    ...(record.asset_manifest_digest !== undefined
      ? { assetManifestDigest: readNullableString(record.asset_manifest_digest) }
      : {}),
    promptDigest: readString(record.prompt_digest),
    tokenEstimate: readNumber(record.token_estimate),
  };
}

export function mapPromptDebugPayload(value: unknown): PromptDebugPayload {
  const record = readRecord(value);
  if (!record) {
    return {};
  }

  const promptSnapshot = mapPromptSnapshotPayload(record.prompt_snapshot);
  const runtimeTrace = mapPromptRuntimeTracePayload(record.runtime_trace);

  return {
    ...(promptSnapshot
      ? { promptSnapshot }
      : {}),
    ...(runtimeTrace
      ? { runtimeTrace }
      : {}),
  };
}

export function mapPromptRuntimePreviewTracePayload(value: unknown): PromptRuntimePreviewTrace | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const runtimeTrace = mapPromptRuntimeTracePayload(record);
  if (!runtimeTrace) {
    return {};
  }

  return {
    ...(runtimeTrace.macro ? { macro: runtimeTrace.macro } : {}),
    ...(runtimeTrace.sourceSelection ? { sourceSelection: runtimeTrace.sourceSelection } : {}),
    ...(runtimeTrace.historyNormalization ? { historyNormalization: runtimeTrace.historyNormalization } : {}),
    ...(runtimeTrace.visibility ? { visibility: runtimeTrace.visibility } : {}),
  };
}

export function mapPromptRuntimeTracePayload(value: unknown): PromptRuntimeTrace | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const preset = readRecord(record.preset);
  const worldbook = readRecord(record.worldbook);
  const regex = readRecord(record.regex);
  const budgets = readRecord(record.budgets);
  const structure = readRecord(record.structure);
  const memory = readRecord(record.memory);
  const memoryTrace = mapPromptRuntimeTraceMemoryPayload(memory);
  const macro = readRecord(record.macro);
  const delivery = readRecord(record.delivery);
  const visibility = readRecord(record.visibility);
  const historyNormalization = mapPromptRuntimeHistoryNormalization(record.history_normalization);

  const runtimeTrace: PromptRuntimeTrace = {
    ...(preset
      ? {
          preset: {
            continueNudgeApplied: readBoolean(preset.continue_nudge_applied),
            continueNudgeText: readNullableString(preset.continue_nudge_text),
            ignoredFields: mapStringArray(preset.ignored_fields),
            ignoredPromptOrderCharacterIds: mapNumberArray(preset.ignored_prompt_order_character_ids),
            inChatInsertedEntryIds: mapStringArray(preset.in_chat_inserted_entry_ids),
            namesBehaviorApplied: readNullablePromptNamesBehavior(preset.names_behavior_applied),
            selectedPromptOrderCharacterId: readNullableNumber(preset.selected_prompt_order_character_id),
            triggerFilteredEntryIds: mapStringArray(preset.trigger_filtered_entry_ids),
            unresolvedMarkers: mapStringArray(preset.unresolved_markers),
            unsupportedFields: mapStringArray(preset.unsupported_fields),
            warnings: mapStringArray(preset.warnings),
          },
        }
      : {}),
    ...(worldbook
      ? {
          worldbook: {
            hitCount: readNumber(worldbook.hit_count),
            ...(worldbook.matches !== undefined
              ? {
                  matches: readArray(worldbook.matches)
                    .map(mapPromptRuntimeWorldbookMatchDetail)
                    .filter((match): match is PromptRuntimeWorldbookMatchDetail => match !== null),
                }
              : {}),
          },
        }
      : {}),
    ...(regex
      ? {
          regex: {
            aiOutputRules: mapStringArray(regex.ai_output_rules),
            ...(regex.phases !== undefined
              ? {
                  phases: readArray(regex.phases).map(mapPromptRuntimeRegexPhaseTrace).filter((item): item is PromptRuntimeRegexPhaseTrace => item !== null),
                }
              : {}),
            preprocessedUserMessage: readNullableString(regex.preprocessed_user_message),
            ...(regex.reserved_placements !== undefined ? { reservedPlacements: mapNumberArray(regex.reserved_placements) } : {}),
            ...(regex.substitution_mode !== undefined
              ? { substitutionMode: readNullablePromptRuntimeRegexSubstitutionMode(regex.substitution_mode) ?? undefined }
              : {}),
            userInputRules: mapStringArray(regex.user_input_rules),
          },
        }
      : {}),
    ...(budgets
      ? {
          budgets: {
            byGroup: readArray(budgets.by_group)
              .map(mapPromptRuntimeBudgetGroupTrace)
              .filter((item): item is PromptRuntimeBudgetGroupTrace => item !== null),
            ...(budgets.trim_reasons !== undefined
              ? {
                  trimReasons: readArray(budgets.trim_reasons).map(mapPromptTrimReason).filter((item): item is PromptTrimReason => item !== null),
                }
              : {}),
          },
        }
      : {}),
    ...(structure
      ? {
          structure: {
            assistantRewriteCount: readNumber(structure.assistant_rewrite_count),
            assistantRewriteStrategy: readNullablePromptAssistantRewriteStrategy(structure.assistant_rewrite_strategy),
            assistantPrefillTranscriptized: typeof structure.assistant_prefill_transcriptized === "boolean" ? structure.assistant_prefill_transcriptized : undefined,
            mergeAdjacentSameRole: readBoolean(structure.merge_adjacent_same_role),
            mode: readPromptStructureMode(structure.mode),
            tailAssistantDetected: readBoolean(structure.tail_assistant_detected),
            transcriptized: typeof structure.transcriptized === "boolean" ? structure.transcriptized : undefined,
            transcriptMessageCount: typeof structure.transcript_message_count === "number" ? structure.transcript_message_count : undefined,
          },
        }
      : {}),
    ...(memoryTrace
      ? {
          memory: memoryTrace,
        }
      : {}),
    ...(macro
      ? {
          macro: {
            warnings: readArray(macro.warnings).map(mapPromptRuntimeMacroWarning).filter((warning): warning is PromptRuntimeMacroWarning => warning !== null),
            usedNames: mapStringArray(macro.used_names),
            mutationPreview: readArray(macro.mutation_preview).map(mapPromptRuntimeMacroMutationPreview).filter((item): item is PromptRuntimeMacroMutationPreview => item !== null),
            stagedMutations: readArray(macro.staged_mutations).map(mapPromptRuntimeMacroStagedMutation).filter((item): item is PromptRuntimeMacroStagedMutation => item !== null),
            traces: readArray(macro.traces).map(mapPromptRuntimeMacroTraceEntry).filter((trace): trace is PromptRuntimeMacroTraceEntry => trace !== null),
          },
        }
      : {}),
    ...(delivery
      ? {
          delivery: {
            allowAssistantPrefill: readBoolean(delivery.allow_assistant_prefill),
            assistantPrefillApplied: readBoolean(delivery.assistant_prefill_applied),
            assistantPrefillRequested: readBoolean(delivery.assistant_prefill_requested),
            assistantPrefillStrategy: readNullablePromptAssistantPrefillStrategy(delivery.assistant_prefill_strategy),
            degradeReasons: readArray(delivery.degrade_reasons)
              .map((item) => readOptionalString(item))
              .filter((item): item is PromptRuntimeDeliveryDegradeReason => {
                return item === "assistant_prefill_disabled"
                  || item === "assistant_prefill_unsupported"
                  || item === "require_last_user"
                  || item === "no_assistant_override";
              }),
            degraded: readBoolean(delivery.degraded),
            endsWithUser: readBoolean(delivery.ends_with_user),
            lastMessageRole: readNullablePromptMessageRole(delivery.last_message_role),
            noAssistant: readBoolean(delivery.no_assistant),
            requireLastUser: readBoolean(delivery.require_last_user),
          },
        }
      : {}),
    ...(visibility
      ? {
          visibility: {
            filteredFloorNos: mapNumberArray(visibility.filtered_floor_nos),
            ...(visibility.hidden_floor_ranges !== undefined
              ? {
                  hiddenFloorRanges: readArray(visibility.hidden_floor_ranges)
                    .map(mapPromptRuntimeVisibilityRange)
                    .filter((range): range is PromptRuntimeVisibilityRange => range !== null),
                }
              : {}),
          },
        }
      : {}),
    ...(readRecord(record.source_selection)
      ? {
          sourceSelection: {
            excludedSources: readArray(readRecord(record.source_selection)?.excluded_sources)
              .map(mapPromptSourceExclusionReason)
              .filter((item): item is PromptSourceExclusionReason => item !== null),
          },
        }
      : {}),
    ...(historyNormalization
      ? {
          historyNormalization,
        }
      : {}),
  };

  return Object.keys(runtimeTrace).length > 0 ? runtimeTrace : undefined;
}

function mapPromptRuntimeHistoryNormalization(value: unknown): PromptRuntimeHistoryNormalizationTrace | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    rawEntryCount: readNumber(record.raw_entry_count),
    effectiveTurnCount: readNumber(record.effective_turn_count),
    selectedTurnCount: readNumber(record.selected_turn_count),
    trailingUserSourceFloorIds: mapStringArray(record.trailing_user_source_floor_ids),
    mergedUserGroups: readArray(record.merged_user_groups)
      .map((item) => {
        const group = readRecord(item);
        if (!group) {
          return null;
        }

        return {
          effectiveRole: "user" as const,
          sourceFloorIds: mapStringArray(group.source_floor_ids),
          sourceMessageIds: mapStringArray(group.source_message_ids),
          includesCurrentInput: readBoolean(group.includes_current_input),
        };
      })
      .filter((item): item is PromptRuntimeMergedUserGroupSummary => item !== null),
    violations: readArray(record.violations)
      .map((item) => {
        const violation = readRecord(item);
        if (!violation) {
          return null;
        }

        return {
          code: "adjacent_assistant_floors" as const,
          message: readString(violation.message),
          sourceFloorIds: mapStringArray(violation.source_floor_ids),
          sourceMessageIds: mapStringArray(violation.source_message_ids),
        };
      })
      .filter((item): item is PromptRuntimeHistoryNormalizationViolation => item !== null),
  };
}

export function mapPromptRuntimeTraceMemoryPayload(value: unknown): PromptRuntimeMemoryTrace | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const mapped: PromptRuntimeMemoryTrace = {
    summaryInjected: readBoolean(record.summary_injected),
  };

  const runtimeMode = readOptionalPromptRuntimeMemoryRuntimeMode(record.runtime_mode);
  if (runtimeMode) mapped.runtimeMode = runtimeMode;
  if (record.requested_write !== undefined) mapped.requestedWrite = readBoolean(record.requested_write);
  if (record.effective_write !== undefined) mapped.effectiveWrite = readBoolean(record.effective_write);

  const strategy = readOptionalPromptRuntimeMemoryStrategy(record.strategy);
  if (strategy) mapped.strategy = strategy;
  if (record.summary_text !== undefined) mapped.summaryText = readString(record.summary_text);
  if (record.summary_text_hash !== undefined) mapped.summaryTextHash = readNullableString(record.summary_text_hash);

  if (record.selected_items !== undefined) {
    mapped.selectedItems = readArray(record.selected_items)
      .map(mapPromptRuntimeMemorySelectedItemTrace)
      .filter((item): item is PromptRuntimeMemorySelectedItemTrace => item !== null);
  }

  const tokenStats = mapPromptRuntimeMemoryTokenStats(record.token_stats);
  if (tokenStats) mapped.tokenStats = tokenStats;

  const scopeResolution = mapPromptRuntimeMemoryScopeResolutionTrace(record.scope_resolution);
  if (scopeResolution) mapped.scopeResolution = scopeResolution;

  const pageId = readOptionalString(record.page_id);
  if (pageId) mapped.pageId = pageId;

  const proposalBatchId = readOptionalString(record.proposal_batch_id);
  if (proposalBatchId) mapped.proposalBatchId = proposalBatchId;

  const proposalStatus = readOptionalPromptRuntimeMemoryProposalStatus(record.proposal_status);
  if (proposalStatus) mapped.proposalStatus = proposalStatus;

  const promotionStatus = readOptionalPromptRuntimeMemoryPromotionStatus(record.promotion_status);
  if (promotionStatus) mapped.promotionStatus = promotionStatus;

  return mapped;
}

export function mapPromptRuntimeMemoryInjectionPayload(value: unknown): PromptRuntimeMemoryInjectionResult | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    formattedText: readString(record.formatted_text),
    items: readArray(record.items)
      .map(mapPromptRuntimeMemoryInjectionItem)
      .filter((item): item is PromptRuntimeMemoryInjectionItem => item !== null),
    scopeResolution: record.scope_resolution === null
      ? null
      : mapPromptRuntimeMemoryInjectionScopeResolution(record.scope_resolution) ?? null,
    tokenCount: readNumber(record.token_count),
  };
}

function mapPromptRuntimeMemorySelectedItemTrace(value: unknown): PromptRuntimeMemorySelectedItemTrace | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const scope = readOptionalPromptRuntimeMemorySelectedItemScope(record.scope);
  const kind = readOptionalPromptRuntimeMemorySelectedItemKind(record.kind);
  if (!scope || !kind) {
    return null;
  }

  const mapped: PromptRuntimeMemorySelectedItemTrace = {
    memoryId: readString(record.memory_id),
    scope,
    scopeId: readString(record.scope_id),
    kind,
  };

  if (record.branch_id !== undefined) mapped.branchId = readNullableString(record.branch_id);

  const source = readOptionalPromptRuntimeMemorySelectedItemSource(record.source);
  if (source) mapped.source = source;
  if (record.score !== undefined) mapped.score = readNullableNumber(record.score);
  if (record.token_count !== undefined) mapped.tokenCount = readNullableNumber(record.token_count);
  if (record.selected_reason !== undefined) mapped.selectedReason = readNullableString(record.selected_reason);

  return mapped;
}

function mapPromptRuntimeMemoryInjectionItem(value: unknown): PromptRuntimeMemoryInjectionItem | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const scope = readOptionalPromptRuntimeMemoryInjectionScope(record.scope);
  const type = readOptionalPromptRuntimeMemoryInjectionType(record.type);
  const status = readOptionalPromptRuntimeMemoryInjectionStatus(record.status);
  if (!scope || !type || !status) {
    return null;
  }

  return {
    confidence: readNumber(record.confidence),
    content: readString(record.content),
    createdAt: readNumber(record.created_at),
    factKey: readNullableString(record.fact_key),
    id: readString(record.id),
    importance: readNumber(record.importance),
    scope,
    scopeId: readString(record.scope_id),
    sourceFloorId: readNullableString(record.source_floor_id),
    sourceMessageId: readNullableString(record.source_message_id),
    status,
    summaryTier: readOptionalPromptRuntimeMemoryInjectionSummaryTier(record.summary_tier) ?? null,
    tokenCountEstimate: readNullableNumber(record.token_count_estimate),
    type,
    updatedAt: readNumber(record.updated_at),
  };
}

function mapPromptRuntimeMacroWarning(value: unknown): PromptRuntimeMacroWarning | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    code: readString(record.code),
    macroName: readNullableString(record.macro_name) ?? undefined,
    message: readString(record.message),
    rawText: readNullableString(record.raw_text) ?? undefined,
  };
}

function mapPromptRuntimeMacroMutationPreview(value: unknown): PromptRuntimeMacroMutationPreview | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const kind = readString(record.kind, "set");
  const scope = readString(record.scope, "branch");
  return {
    key: readString(record.key),
    kind: kind === "delete" ? "delete" : "set",
    scope: scope === "global" ? "global" : "branch",
    value: readNullableString(record.value) ?? undefined,
  };
}

function mapPromptRuntimeMacroStagedMutation(value: unknown): PromptRuntimeMacroStagedMutation | null {
  const preview = mapPromptRuntimeMacroMutationPreview(value);
  const record = readRecord(value);
  if (!preview || !record) {
    return null;
  }

  return {
    ...preview,
    sourceMacro: readString(record.source_macro),
  };
}

function mapPromptRuntimeMacroTraceEntry(value: unknown): PromptRuntimeMacroTraceEntry | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    macroName: readString(record.macro_name),
    phase: readNullableString(record.phase) ?? undefined,
    rawText: readString(record.raw_text),
    resolvedText: readString(record.resolved_text),
    selectedBranch: readNullableString(record.selected_branch) ?? undefined,
    sourceKind: readNullableString(record.source_kind) ?? undefined,
  };
}

function mapPromptSnapshotWorldbookActivation(value: unknown): PromptSnapshotWorldbookActivation | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const source = readRecord(record.source);
  const insertion = readRecord(record.insertion);

  return {
    uid: readNumber(record.uid),
    activationKey: readString(record.activation_key),
    source: {
      kind: readString(source?.kind, "session_worldbook") === "character_book" ? "character_book" : "session_worldbook",
      worldbookId: readNullableString(source?.worldbook_id),
      worldbookName: readString(source?.worldbook_name),
      assetScopeId: readString(source?.asset_scope_id),
    },
    insertion: {
      depth: readNullableNumber(insertion?.depth) ?? undefined,
      outletName: readNullableString(insertion?.outlet_name) ?? undefined,
      position: readPromptWorldbookInsertionPosition(insertion?.position),
      role: readOptionalPromptMessageRole(insertion?.role),
    },
  };
}

function mapPromptRuntimeWorldbookMatchDetail(value: unknown): PromptRuntimeWorldbookMatchDetail | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const activation = readRecord(record.activation);
  const insertion = readRecord(record.insertion);
  const source = readRecord(record.source);
  const sourceAssetScopeId = readOptionalString(source?.asset_scope_id) ?? undefined;
  const assetScopeId = readOptionalString(record.asset_scope_id) ?? sourceAssetScopeId;

  return {
    activation: {
      firstMatch:
        activation?.first_match === null
          ? null
          : mapPromptRuntimeWorldbookFirstMatch(activation?.first_match),
      mode: readString(activation?.mode, "triggered") === "constant" ? "constant" : "triggered",
      recursionLevel: readNumber(activation?.recursion_level),
    },
    ...(readOptionalString(record.activation_key) ? { activationKey: readString(record.activation_key) } : {}),
    ...(assetScopeId ? { assetScopeId } : {}),
    comment: readString(record.comment),
    contentPreview: readString(record.content_preview),
    insertion: {
      depth: readNullableNumber(insertion?.depth) ?? undefined,
      outletName: readNullableString(insertion?.outlet_name) ?? undefined,
      position: readPromptWorldbookInsertionPosition(insertion?.position),
      role: readOptionalPromptMessageRole(insertion?.role),
    },
    order: readNumber(record.order),
    source: {
      kind: readString(source?.kind, "session_worldbook") === "character_book" ? "character_book" : "session_worldbook",
      worldbookId: readNullableString(source?.worldbook_id),
      ...(sourceAssetScopeId ? { assetScopeId: sourceAssetScopeId } : {}),
      worldbookName: readString(source?.worldbook_name),
    },
    uid: readNumber(record.uid),
  };
}

function mapPromptRuntimeWorldbookFirstMatch(value: unknown): PromptRuntimeWorldbookFirstMatch | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const sourceKind = readString(record.source_kind);
  if (
    sourceKind !== "message"
    && sourceKind !== "persona_description"
    && sourceKind !== "character_description"
    && sourceKind !== "character_personality"
    && sourceKind !== "character_depth_prompt"
    && sourceKind !== "scenario"
    && sourceKind !== "creator_notes"
    && sourceKind !== "injection"
    && sourceKind !== "recursion_buffer"
  ) {
    return null;
  }

  return {
    charEnd: readNumber(record.char_end),
    charStart: readNumber(record.char_start),
    excerpt: readString(record.excerpt),
    injectionIndex: readNullableNumber(record.injection_index) ?? undefined,
    matchedKey: readString(record.matched_key),
    matchedKeyScope: readString(record.matched_key_scope, "primary") === "secondary" ? "secondary" : "primary",
    matchedKeyType: readString(record.matched_key_type, "plain") === "regex" ? "regex" : "plain",
    messageIndexFromLatest: readNullableNumber(record.message_index_from_latest) ?? undefined,
    sourceKind,
  };
}

function mapPromptRuntimeBudgetGroupTrace(value: unknown): PromptRuntimeBudgetGroupTrace | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    allocatedTokenCount: readNullableNumber(record.allocated_token_count) ?? undefined,
    estimatedTokenCount: readNullableNumber(record.estimated_token_count) ?? undefined,
    group: readString(record.group),
    prunedTokenCount: readNullableNumber(record.pruned_token_count) ?? undefined,
    tokenCount: readNumber(record.token_count),
  };
}

function mapPromptTrimReason(value: unknown): PromptTrimReason | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const reason = readString(record.reason);
  if (reason !== "budget_exceeded" && reason !== "group_limit_exceeded" && reason !== "provider_constraint" && reason !== "policy_disabled") {
    return null;
  }

  return {
    group: readString(record.group),
    reason,
    detail: readOptionalString(record.detail),
    prunedTokenCount: readNullableNumber(record.pruned_token_count) ?? undefined,
  };
}

function mapPromptSourceExclusionReason(value: unknown): PromptSourceExclusionReason | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    source: readString(record.source) as PromptRuntimeSourceKind,
    reason: readString(record.reason) as PromptSourceExclusionReasonCode,
    detail: readOptionalString(record.detail),
  };
}

function mapPromptRuntimeVisibilityRange(value: unknown): PromptRuntimeVisibilityRange | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    startFloorNo: readNumber(record.start_floor_no),
    endFloorNo: readNumber(record.end_floor_no),
  };
}

function mapPromptRuntimeMemoryTokenStats(value: unknown): PromptRuntimeMemoryTokenStats | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    ...(record.budget !== undefined ? { budget: readNullableNumber(record.budget) } : {}),
    used: readNumber(record.used),
    microSummary: readNumber(record.micro_summary),
    macroSummary: readNumber(record.macro_summary),
    directItems: readNumber(record.direct_items),
  };
}

function mapPromptRuntimeMemoryScopeResolutionTrace(value: unknown): PromptRuntimeMemoryScopeResolutionTrace | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const mode = readOptionalPromptRuntimeMemoryScopeResolutionMode(record.mode);
  if (!mode) {
    return null;
  }

  return {
    mode,
    ...(record.strict !== undefined ? { strict: readBoolean(record.strict) } : {}),
    requestedScopes: mapPromptRuntimeMemoryScopeArray(record.requested_scopes),
    resolvedScopes: mapPromptRuntimeMemoryScopeArray(record.resolved_scopes),
    ...(record.requested_branch_id !== undefined ? { requestedBranchId: readNullableString(record.requested_branch_id) } : {}),
    ...(record.resolved_branch_id !== undefined ? { resolvedBranchId: readNullableString(record.resolved_branch_id) } : {}),
    ...(record.fallback_reason !== undefined ? { fallbackReason: readNullableString(record.fallback_reason) } : {}),
  };
}

function mapPromptRuntimeMemoryInjectionScopeResolution(value: unknown): Exclude<PromptRuntimeMemoryInjectionScopeResolution, null> | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const mode = readOptionalPromptRuntimeMemoryInjectionScopeResolutionMode(record.mode);
  if (!mode) {
    return null;
  }

  const error = mapPromptRuntimeMemoryInjectionScopeResolutionError(record.error);

  const explicitScope = mapPromptRuntimeMemoryInjectionScopeRef(record.explicit_scope);

  return {
    mode,
    strict: readBoolean(record.strict),
    ...(record.scope_refs !== undefined
      ? {
          scopeRefs: readArray(record.scope_refs)
            .map(mapPromptRuntimeMemoryInjectionScopeRef)
            .filter((item): item is PromptRuntimeMemoryInjectionScopeRef => item !== null),
        }
      : {}),
    ...(explicitScope ? { explicitScope } : {}),
    ...(record.fallback_scope_id !== undefined ? { fallbackScopeId: readString(record.fallback_scope_id) } : {}),
    ...(error ? { error } : {}),
  };
}

function mapPromptRuntimeMemoryInjectionScopeRef(value: unknown): PromptRuntimeMemoryInjectionScopeRef | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const scope = readOptionalPromptRuntimeMemoryInjectionScope(record.scope);
  if (!scope) {
    return null;
  }

  return { scope, scopeId: readString(record.scopeId ?? record.scope_id) };
}

function mapStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readOptionalString(item))
    .filter((item): item is string => item !== undefined);
}

function mapNumberArray(value: unknown): number[] {
  return readArray(value)
    .map((item) => (typeof item === "number" ? item : undefined))
    .filter((item): item is number => item !== undefined);
}

function readPromptSnapshotMode(value: unknown): PromptSnapshotMode {
  const mode = readString(value);
  if (mode === "native" || mode === "compat_plus") {
    return mode;
  }

  return "compat_strict";
}

function readPromptStructureMode(value: unknown): PromptRuntimeStructureTrace["mode"] {
  const mode = readString(value);
  if (mode === "strict_alternating" || mode === "no_assistant" || mode === "flattened") {
    return mode;
  }

  return "default";
}

function readPromptWorldbookInsertionPosition(
  value: unknown,
): PromptRuntimeWorldbookMatchInsertion["position"] {
  const position = readString(value, "after");
  return position === "before"
    || position === "after"
    || position === "an_top"
    || position === "an_bottom"
    || position === "em_top"
    || position === "em_bottom"
    || position === "at_depth"
    || position === "outlet"
    ? position
    : "after";
}

function mapPromptRuntimeRegexPhaseTrace(
  value: unknown,
): PromptRuntimeRegexPhaseTrace | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const phaseId = readNullablePromptRuntimeRegexPhaseId(record.phase_id);
  const status = readNullablePromptRuntimeRegexPhaseStatus(record.status);
  if (!phaseId || !status) {
    return null;
  }

  return {
    phaseId,
    placement: readNumber(record.placement),
    channel: readNullablePromptRuntimeRegexChannel(record.channel),
    status,
    changed: readBoolean(record.changed),
    depth: readNullableNumber(record.depth),
    inputTextHash: readNullableString(record.input_text_hash),
    outputTextHash: readNullableString(record.output_text_hash),
    candidateRuleNames: mapStringArray(record.candidate_rule_names),
    matchedRuleNames: mapStringArray(record.matched_rule_names),
    skippedRules: readArray(record.skipped_rules)
      .map(mapPromptRuntimeRegexSkippedRule)
      .filter((item): item is PromptRuntimeRegexSkippedRule => item !== null),
  };
}

function mapPromptRuntimeRegexSkippedRule(
  value: unknown,
): PromptRuntimeRegexSkippedRule | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const reason = readNullablePromptRuntimeRegexSkipReason(record.reason);
  if (!reason) {
    return null;
  }

  return {
    ruleName: readString(record.rule_name),
    reason,
  };
}

function readNullablePromptRuntimeRegexPhaseId(
  value: unknown,
): PromptRuntimeRegexPhaseTrace["phaseId"] | null {
  const phaseId = readOptionalString(value);
  if (
    phaseId === "persist.user_input"
    || phaseId === "prompt.user_input"
    || phaseId === "persist.ai_output"
    || phaseId === "prompt.world_info.reserved"
  ) {
    return phaseId;
  }

  return null;
}

function readNullablePromptRuntimeRegexPhaseStatus(
  value: unknown,
): PromptRuntimeRegexPhaseTrace["status"] | null {
  const status = readOptionalString(value);
  if (status === "executed" || status === "reserved") {
    return status;
  }

  return null;
}

function readNullablePromptAssistantRewriteStrategy(
  value: unknown,
): PromptRuntimeStructureTrace["assistantRewriteStrategy"] {
  const strategy = readOptionalString(value);
  if (strategy === "to_system" || strategy === "to_user_transcript") {
    return strategy;
  }

  return null;
}

function readNullablePromptAssistantPrefillStrategy(
  value: unknown,
): PromptRuntimeDeliveryTrace["assistantPrefillStrategy"] {
  const strategy = readOptionalString(value);
  if (
    strategy === "provider_native"
    || strategy === "assistant_message_fallback"
    || strategy === "transcript_append"
    || strategy === "unsupported"
    || strategy === "none"
  ) {
    return strategy;
  }

  return null;
}

function readNullablePromptNamesBehavior(
  value: unknown,
): PromptRuntimePresetTrace["namesBehaviorApplied"] {
  const behavior = readOptionalString(value);
  if (behavior === "off" || behavior === "always") {
    return behavior;
  }

  return null;
}

function readNullablePromptMessageRole(value: unknown): PromptRuntimeDeliveryTrace["lastMessageRole"] {
  const role = readOptionalString(value);
  if (role === "system" || role === "user" || role === "assistant") {
    return role;
  }

  return null;
}

function readNullablePromptRuntimeRegexChannel(
  value: unknown,
): PromptRuntimeRegexPhaseTrace["channel"] {
  const channel = readNullableString(value);
  if (channel === "persist" || channel === "prompt" || channel === "display" || channel === "edit") {
    return channel;
  }

  return null;
}

function readNullablePromptRuntimeRegexSkipReason(
  value: unknown,
): PromptRuntimeRegexSkippedRule["reason"] | null {
  const reason = readOptionalString(value);
  if (
    reason === "channel_filtered"
    || reason === "depth_filtered"
    || reason === "invalid_regex"
    || reason === "no_match"
    || reason === "reserved_non_executable"
  ) {
    return reason;
  }

  return null;
}

function readNullablePromptRuntimeRegexSubstitutionMode(
  value: unknown,
): PromptRuntimeRegexTrace["substitutionMode"] | null {
  const mode = readOptionalString(value);
  return mode === "bare_variable_only" ? mode : null;
}

function readOptionalPromptRuntimeMemoryRuntimeMode(
  value: unknown,
): PromptRuntimeMemoryRuntimeMode | undefined {
  const mode = readOptionalString(value);
  if (mode === "disabled" || mode === "legacy_sync" || mode === "async_primary") {
    return mode;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemoryStrategy(value: unknown): PromptRuntimeMemoryStrategy | undefined {
  const strategy = readOptionalString(value);
  if (strategy === "none" || strategy === "single_summary" || strategy === "dual_summary" || strategy === "direct_items") {
    return strategy;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemorySelectedItemScope(value: unknown): PromptRuntimeMemorySelectedItemScope | undefined {
  const scope = readOptionalString(value);
  if (scope === "global" || scope === "chat" || scope === "branch" || scope === "floor") {
    return scope;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemorySelectedItemKind(value: unknown): PromptRuntimeMemorySelectedItemKind | undefined {
  const kind = readOptionalString(value);
  if (kind === "fact" || kind === "micro_summary" || kind === "macro_summary" || kind === "summary" || kind === "open_loop") {
    return kind;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemorySelectedItemSource(value: unknown): PromptRuntimeMemorySelectedItemSource | undefined {
  const source = readOptionalString(value);
  if (source === "store" || source === "summary" || source === "open_loop" || source === "fallback") {
    return source;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemoryScopeResolutionMode(
  value: unknown,
): PromptRuntimeMemoryScopeResolutionMode | undefined {
  const mode = readOptionalString(value);
  if (
    mode === "branch_aware"
    || mode === "explicit_scope"
    || mode === "fallback"
    || mode === "strict_empty"
    || mode === "resolver_error"
    || mode === "legacy_direct"
  ) {
    return mode;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemoryProposalStatus(value: unknown): PromptRuntimeMemoryProposalStatus | undefined {
  const status = readOptionalString(value);
  if (status === "not_requested" || status === "skipped_by_request" || status === "proposed" || status === "promoted" || status === "rejected" || status === "superseded") {
    return status;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemoryPromotionStatus(value: unknown): PromptRuntimeMemoryPromotionStatus | undefined {
  const status = readOptionalString(value);
  if (status === "not_requested" || status === "promoted" || status === "rejected" || status === "superseded") {
    return status;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemoryInjectionScope(
  value: unknown,
): PromptRuntimeMemoryInjectionScope | undefined {
  const scope = readOptionalString(value);
  if (scope === "global" || scope === "chat" || scope === "branch" || scope === "floor") {
    return scope;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemoryInjectionType(
  value: unknown,
): PromptRuntimeMemoryInjectionType | undefined {
  const type = readOptionalString(value);
  if (type === "fact" || type === "summary" || type === "open_loop") {
    return type;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemoryInjectionStatus(
  value: unknown,
): PromptRuntimeMemoryInjectionStatus | undefined {
  const status = readOptionalString(value);
  if (status === "active" || status === "deprecated") {
    return status;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemoryInjectionSummaryTier(
  value: unknown,
): PromptRuntimeMemoryInjectionSummaryTier | undefined {
  const tier = readOptionalString(value);
  if (tier === "micro" || tier === "macro") {
    return tier;
  }

  return undefined;
}

function readOptionalPromptRuntimeMemoryInjectionScopeResolutionMode(
  value: unknown,
): PromptRuntimeMemoryInjectionScopeResolutionMode | undefined {
  const mode = readOptionalString(value);
  if (mode === "visible_refs" || mode === "explicit_scope" || mode === "direct_scope_fallback" || mode === "strict_empty" || mode === "resolver_error") {
    return mode;
  }

  return undefined;
}

function mapPromptRuntimeMemoryScopeArray(value: unknown): PromptRuntimeMemorySelectedItemScope[] {
  return readArray(value)
    .map((item) => readOptionalPromptRuntimeMemorySelectedItemScope(item))
    .filter((item): item is PromptRuntimeMemorySelectedItemScope => item !== undefined);
}

function mapPromptRuntimeMemoryInjectionScopeResolutionError(
  value: unknown,
): { name: string; message: string } | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const name = readOptionalString(record.name);
  const message = readOptionalString(record.message);
  if (!name || !message) {
    return null;
  }

  return { name, message };
}

function readOptionalPromptMessageRole(
  value: unknown,
): PromptRuntimeWorldbookMatchInsertion["role"] | undefined {
  const role = readOptionalString(value);
  if (role === "system" || role === "user" || role === "assistant") {
    return role;
  }

  return undefined;
}
