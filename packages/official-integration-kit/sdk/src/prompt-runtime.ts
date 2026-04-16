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

export type PromptSnapshotPreview = {
  presetId: string | null;
  presetUpdatedAt: number | null;
  presetVersion: number | null;
  worldbookId: string | null;
  worldbookUpdatedAt: number | null;
  worldbookVersion: number | null;
  regexProfileId: string | null;
  regexProfileUpdatedAt: number | null;
  regexProfileVersion: number | null;
  worldbookActivatedEntryUids: number[];
  regexPreRuleNames: string[];
  regexPostRuleNames: string[];
  promptMode: PromptSnapshotMode;
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
  position: "before" | "after" | "at_depth" | "outlet";
  role?: "system" | "user" | "assistant";
};

export type PromptRuntimeWorldbookMatchSource = {
  kind: "session_worldbook" | "character_book";
  worldbookId: string | null;
  worldbookName: string;
};

export type PromptRuntimeWorldbookMatchDetail = {
  activation: PromptRuntimeWorldbookMatchActivation;
  comment: string;
  contentPreview: string;
  insertion: PromptRuntimeWorldbookMatchInsertion;
  order: number;
  source: PromptRuntimeWorldbookMatchSource;
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

export type PromptRuntimeRegexTrace = {
  aiOutputRules: string[];
  preprocessedUserMessage: string | null;
  userInputRules: string[];
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
  summaryInjected: boolean;
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
  worldbook?: PromptRuntimeWorldbookTrace;
};

export type PromptRuntimePreviewTrace = Pick<PromptRuntimeTrace, "macro" | "sourceSelection" | "visibility">;

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
    worldbookId: readNullableString(record.worldbook_id),
    worldbookUpdatedAt: readNullableNumber(record.worldbook_updated_at),
    worldbookVersion: readNullableNumber(record.worldbook_version),
    regexProfileId: readNullableString(record.regex_profile_id),
    regexProfileUpdatedAt: readNullableNumber(record.regex_profile_updated_at),
    regexProfileVersion: readNullableNumber(record.regex_profile_version),
    worldbookActivatedEntryUids: mapNumberArray(record.worldbook_activated_entry_uids),
    regexPreRuleNames: mapStringArray(record.regex_pre_rule_names),
    regexPostRuleNames: mapStringArray(record.regex_post_rule_names),
    promptMode: readPromptSnapshotMode(record.prompt_mode),
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
  const macro = readRecord(record.macro);
  const delivery = readRecord(record.delivery);
  const visibility = readRecord(record.visibility);

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
            preprocessedUserMessage: readNullableString(regex.preprocessed_user_message),
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
    ...(memory
      ? {
          memory: {
            summaryInjected: readBoolean(memory.summary_injected),
          },
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
  };

  return Object.keys(runtimeTrace).length > 0 ? runtimeTrace : undefined;
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

function mapPromptRuntimeWorldbookMatchDetail(value: unknown): PromptRuntimeWorldbookMatchDetail | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const activation = readRecord(record.activation);
  const insertion = readRecord(record.insertion);
  const source = readRecord(record.source);

  return {
    activation: {
      firstMatch:
        activation?.first_match === null
          ? null
          : mapPromptRuntimeWorldbookFirstMatch(activation?.first_match),
      mode: readString(activation?.mode, "triggered") === "constant" ? "constant" : "triggered",
      recursionLevel: readNumber(activation?.recursion_level),
    },
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
  return position === "before" || position === "after" || position === "at_depth" || position === "outlet"
    ? position
    : "after";
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

function readOptionalPromptMessageRole(
  value: unknown,
): PromptRuntimeWorldbookMatchInsertion["role"] | undefined {
  const role = readOptionalString(value);
  if (role === "system" || role === "user" || role === "assistant") {
    return role;
  }

  return undefined;
}
