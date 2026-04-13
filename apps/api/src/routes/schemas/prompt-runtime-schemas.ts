import {
  DERIVED_NO_ASSISTANT_STRUCTURE_WARNING,
  PROMPT_RUNTIME_POLICY_SOURCES,
  PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES,
  PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES,
  PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES,
  PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES,
  PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES,
  PROMPT_RUNTIME_SUPPORTED_TRIM_REASON_CODES,
  PROMPT_RUNTIME_HISTORICAL_EXPLAIN_LIMITATIONS,
  PROMPT_RUNTIME_LIMITATIONS,
  PROMPT_RUNTIME_UNSUPPORTED_ROUTES,
} from "../../services/prompt-runtime-control-service.js";
import { dryRunVisibilityJsonSchema, floorVisibilityRangeJsonSchema } from "./chat-schemas.js";

const promptRuntimePersistentStructureExample = {
  mode: "strict_alternating",
} as const;

const promptRuntimePersistentDeliveryExample = {
  require_last_user: true,
} as const;

export const promptRuntimePolicyPatchBodyExample = {
  structure: {
    mode: "strict_alternating",
    preserve_system_messages: true,
  },
  delivery: {
    require_last_user: true,
  },
} as const;

const promptRuntimeBudgetExample = {
  max_input_tokens: 4096,
  reserved_completion_tokens: 1024,
} as const;

const promptRuntimeSourceSelectionExample = {
  history: { mode: "windowed", max_messages: 24 },
  memory: { enabled: true },
  worldbook: { enabled: true }, examples: { enabled: false },
} as const;

export const promptRuntimePreviewBodyExample = {
  text: "{{setvar::资产.金币::3}}{{getvar::资产}}",
  branch_id: "alt-preview",
  source_floor_id: "floor-source",
  delivery: {
    no_assistant: true,
  },
  budget: promptRuntimeBudgetExample,
  source_selection: promptRuntimeSourceSelectionExample,
  visibility: {
    mode: "allow_all_except_hidden",
    hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }],
  },
} as const;

const promptRuntimeScopeExample = {
  session_id: "session-1",
  target_branch_id: "alt-branch",
  branch_exists: true,
  source_floor_id: null,
  history_source_branch_id: "alt-branch",
  history_source_mode: "existing_branch",
} as const;

const promptRuntimeResolvedStructureExample = {
  mode: "no_assistant",
  merge_adjacent_same_role: true,
  preserve_system_messages: true,
  assistant_rewrite_strategy: "to_system",
} as const;

const promptRuntimeResolvedDeliveryExample = {
  allow_assistant_prefill: true,
  require_last_user: true,
  no_assistant: true,
} as const;

const promptRuntimeDebugPolicyExample = {
  include_prompt_snapshot: false,
  include_runtime_trace: false,
  include_worldbook_matches: false,
} as const;

const promptRuntimeAssetsExample = {
  preset: {
    id: "preset-story",
    name: "Story Preset",
  },
  character_card: {
    id: "char-hero",
    name: "Hero",
  },
  worldbook: {
    id: "wb-lore",
    name: "Lorebook",
  },
  regex_profile: {
    id: "regex-safe",
    name: "Safety Regex",
  },
} as const;

const promptRuntimeBranchPersistentPolicyExample = {
  delivery: {
    no_assistant: true,
  },
} as const;

const promptRuntimeDiagnosticsExample = [
  {
    code: "derived_no_assistant_structure",
    message: DERIVED_NO_ASSISTANT_STRUCTURE_WARNING,
    severity: "warning",
    source: "policy",
    field_path: "policy.structure.mode",
  },
] as const;

const promptRuntimeLimitationsExample = [...PROMPT_RUNTIME_LIMITATIONS] as const;

const promptRuntimeSourceMapExample = {
  structure: {
    mode: "branch_policy",
    merge_adjacent_same_role: "branch_policy",
    preserve_system_messages: "system_default",
    assistant_rewrite_strategy: "system_default",
  },
  delivery: {
    allow_assistant_prefill: "system_default",
    require_last_user: "session_policy",
    no_assistant: "branch_policy",
  },
  budget: {
    max_input_tokens: "request_override",
    reserved_completion_tokens: "request_override",
  },
  source_selection: {
    history: {
      mode: "request_override",
      max_messages: "request_override",
    },
    memory: { enabled: "system_default" },
    worldbook: { enabled: "system_default" },
    examples: { enabled: "request_override" },
  },
  history: {
    source_branch_id: "alt-branch",
    source_mode: "existing_branch",
  },
} as const;

export const promptRuntimeResolvedStateExample = {
  scope: promptRuntimeScopeExample,
  policy: {
    structure: promptRuntimeResolvedStructureExample,
    delivery: promptRuntimeResolvedDeliveryExample,
    budget: promptRuntimeBudgetExample,
    source_selection: promptRuntimeSourceSelectionExample,
    debug: promptRuntimeDebugPolicyExample,
  },
  persistent_policy: {
    structure: promptRuntimePersistentStructureExample,
    delivery: promptRuntimePersistentDeliveryExample,
  },
  branch_persistent_policy: promptRuntimeBranchPersistentPolicyExample,
  assets: promptRuntimeAssetsExample,
  source_map: promptRuntimeSourceMapExample,
  warnings: [DERIVED_NO_ASSISTANT_STRUCTURE_WARNING],
  diagnostics: promptRuntimeDiagnosticsExample,
  limitations: promptRuntimeLimitationsExample,
} as const;

export const promptRuntimePolicyViewExample = {
  persistent_policy: {
    structure: promptRuntimePersistentStructureExample,
    delivery: promptRuntimePersistentDeliveryExample,
  },
  resolved_policy: {
    structure: promptRuntimeResolvedStructureExample,
    delivery: promptRuntimeResolvedDeliveryExample,
    budget: promptRuntimeBudgetExample,
    source_selection: promptRuntimeSourceSelectionExample,
    debug: promptRuntimeDebugPolicyExample,
  },
  warnings: [],
} as const;

export const promptRuntimePreviewResponseExample = {
  scope: {
    session_id: "session-1",
    target_branch_id: "alt-preview",
    branch_exists: false,
    source_floor_id: "floor-source",
    history_source_branch_id: "fork-branch",
    history_source_mode: "source_floor_branch",
  },
  policy: {
    structure: promptRuntimeResolvedStructureExample,
    delivery: promptRuntimeResolvedDeliveryExample,
    budget: promptRuntimeBudgetExample,
    source_selection: promptRuntimeSourceSelectionExample,
    debug: promptRuntimeDebugPolicyExample,
  },
  source_map: {
    structure: {
      mode: "request_override",
      merge_adjacent_same_role: "request_override",
      preserve_system_messages: "system_default",
      assistant_rewrite_strategy: "system_default",
    },
    delivery: {
      allow_assistant_prefill: "system_default",
      require_last_user: "session_policy",
      no_assistant: "request_override",
    },
    budget: {
      max_input_tokens: "request_override",
      reserved_completion_tokens: "request_override",
    },
    source_selection: {
      history: {
        mode: "request_override",
        max_messages: "request_override",
      },
      memory: { enabled: "system_default" },
      worldbook: { enabled: "system_default" },
      examples: { enabled: "request_override" },
    },
    history: { source_branch_id: "fork-branch", source_mode: "source_floor_branch" },
  },
  runtime_trace: {
    macro: {
      warnings: [
        {
          code: "macro_preview_side_effect_suppressed",
          message: "Macro setvar side effect was previewed but not committed.",
          macro_name: "setvar",
        },
      ],
      used_names: ["setvar", "getvar"],
      mutation_preview: [{ kind: "set", scope: "branch", key: "资产", value: '{"金币":3}' }],
      staged_mutations: [],
      traces: [
        { macro_name: "setvar", raw_text: "{{setvar::资产.金币::3}}", resolved_text: "", phase: "preview", source_kind: "macro" },
        { macro_name: "getvar", raw_text: "{{getvar::资产}}", resolved_text: '{"金币":3}', phase: "preview", source_kind: "macro" },
      ],
    },
    source_selection: {
      excluded_sources: [
        {
          source: "history",
          reason: "visibility_filtered",
          detail: "Visibility filtered 2 floor(s) from the available history window.",
        },
      ],
    },
    visibility: {
      hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }],
      filtered_floor_nos: [1, 2],
    },
  },
  text: '{"金币":3}',
  diagnostics: [
    ...promptRuntimeDiagnosticsExample,
    {
      code: "unmaterialized_branch_preview",
      message: "Preview targeted unmaterialized branch 'alt-preview'. Branch policy overlay is unavailable until the branch is materialized.",
      severity: "info",
      source: "branch",
      phase: "preview",
    },
  ],
  limitations: promptRuntimeLimitationsExample,
} as const;

const promptRuntimeHistoricalExplainDiagnosticsExample = [
  {
    code: "historical_resolved_policy_unavailable",
    message: "Historical explain did not persist the resolved policy for this floor. The explain view returns persisted prompt snapshot and committed result truth only.",
    severity: "info",
    source: "policy",
    field_path: "resolved_policy",
    phase: "explain",
  },
  {
    code: "historical_trim_reasons_unavailable",
    message: "Historical explain did not persist trim reasons for this floor, so explain returns trim_reasons as null instead of recomputing budget decisions.",
    severity: "info",
    source: "budget",
    field_path: "trim_reasons",
    phase: "explain",
  },
  {
    code: "historical_excluded_sources_unavailable",
    message: "Historical explain did not persist excluded sources for this floor, so explain returns excluded_sources as null instead of recomputing source selection.",
    severity: "info",
    source: "source_selection",
    field_path: "excluded_sources",
    phase: "explain",
  },
] as const;

const promptRuntimeHistoricalExplainLimitationsExample = [
  ...PROMPT_RUNTIME_LIMITATIONS,
  ...PROMPT_RUNTIME_HISTORICAL_EXPLAIN_LIMITATIONS,
] as const;

export const promptRuntimeHistoricalExplainResponseExample = {
  floor: {
    id: "floor-12",
    session_id: "session-1",
    floor_no: 12,
    branch_id: "main",
    parent_floor_id: "floor-11",
    state: "committed",
    prompt_snapshot_created_at: 1710000003000,
    committed_at: 1710000004000,
  },
  scope: {
    session_id: "session-1",
    target_branch_id: "main",
    branch_exists: true,
    source_floor_id: null,
    history_source_branch_id: "main",
    history_source_mode: "existing_branch",
  },
  prompt_snapshot: {
    preset_id: "preset-story",
    preset_updated_at: 1710000000000,
    preset_version: 3,
    worldbook_id: "wb-lore",
    worldbook_updated_at: 1710000001000,
    worldbook_version: 5,
    regex_profile_id: "regex-safe",
    regex_profile_updated_at: 1710000002000,
    regex_profile_version: 2,
    worldbook_activated_entry_uids: [7, 12],
    regex_pre_rule_names: ["trim_whitespace"],
    regex_post_rule_names: [],
    prompt_mode: "compat_strict",
    prompt_digest: "0d9bc89c6130435ab870f63d0a4d45f95b9764a4b91c91f8d1c2c5a1f7d4f20c",
    token_estimate: 512,
  },
  resolved_policy: null,
  source_map: {
    history: { source_branch_id: "main", source_mode: "existing_branch" },
  },
  trim_reasons: null,
  excluded_sources: null,
  diagnostics: promptRuntimeHistoricalExplainDiagnosticsExample,
  limitations: promptRuntimeHistoricalExplainLimitationsExample,
  result: {
    output_page_id: "page-output-12",
    assistant_message_id: "msg-assistant-12",
    generated_text: "The firelight wavers as the next part of the story begins.",
    summaries: ["The group resumes the campfire planning scene."],
    usage: {
      prompt_tokens: 320,
      completion_tokens: 128,
      total_tokens: 448,
    },
    verifier: null,
    committed_at: 1710000004000,
  },
} as const;

export const promptRuntimeCapabilitiesExample = {
  structure: {
    modes: [...PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES],
    defaults: {
      mode: "default",
      merge_adjacent_same_role: false,
      preserve_system_messages: true,
    },
  },
  delivery: {
    defaults: {
      allow_assistant_prefill: true,
      require_last_user: false,
      no_assistant: false,
    },
  },
  budget: {
    defaults: {},
    request_override_supported: true,
    persistent_patch_supported: false,
    supported_fields: ["maxInputTokens", "reservedCompletionTokens"],
    trim_reason_codes: [...PROMPT_RUNTIME_SUPPORTED_TRIM_REASON_CODES],
  },
  source_selection: {
    defaults: {
      history: { mode: "full" },
      memory: { enabled: true },
      worldbook: { enabled: true },
      examples: { enabled: true },
    },
    request_override_supported: true,
    persistent_patch_supported: false,
    supported_sources: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES],
    history_modes: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES],
    exclusion_reason_codes: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES],
  },
  observability: {
    live: {
      enabled: true,
      default_off: true,
      request_scoped_only: true,
      include_prompt_snapshot: true,
      include_runtime_trace: true,
      include_worldbook_matches: true,
      worldbook_matches_requires_runtime_trace: true,
      worldbook_matches_requires_opt_in: true,
      visibility_request_supported: false,
    },
    dry_run: {
      enabled: true,
      returns_assembly: true,
      returns_runtime_trace: true,
      supports_visibility: true,
      include_worldbook_matches: true,
    },
    preview: {
      enabled: true,
      returns_runtime_trace: true,
      supports_visibility: true,
      single_text_only: true,
      llm_call: false,
      creates_floor: false,
      writes_prompt_snapshot: false,
      commits_side_effects: false,
    },
    explain: {
      enabled: true,
      read_only: true,
      requires_committed_floor: true,
      persisted_truth_only: true,
      recompute: false,
    },
    stream: {
      enabled: true,
      prompt_debug_payload: "done_only",
      new_sse_event_family: false,
    },
  },
  macro: {
    built_in_read_only_values_persistable: false,
    st_compatibility_snapshots_persistable: false,
    run_kind_persistable: false,
    diagnostics_surface: "unified_observability",
    dedicated_macros_route: false,
    recent_message_respects_visibility: true,
  },
  unsupported: [...PROMPT_RUNTIME_UNSUPPORTED_ROUTES],
} as const;

const promptRuntimePersistentStructureJsonSchema = {
  type: "object",
  required: ["mode"],
  properties: {
    mode: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES] },
    merge_adjacent_same_role: { type: "boolean" },
    assistant_rewrite_strategy: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES] },
    preserve_system_messages: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const promptRuntimePersistentDeliveryJsonSchema = {
  type: "object",
  properties: {
    allow_assistant_prefill: { type: "boolean" },
    require_last_user: { type: "boolean" },
    no_assistant: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const promptRuntimeBudgetJsonSchema = {
  type: "object",
  properties: {
    max_input_tokens: { type: "integer", minimum: 1 },
    reserved_completion_tokens: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
} as const;

const promptRuntimePersistentSourceSelectionJsonSchema = {
  type: "object",
  properties: {
    history: {
      type: "object",
      properties: {
        mode: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES] },
        max_messages: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    memory: { type: "object", properties: { enabled: { type: "boolean" } }, additionalProperties: false },
    worldbook: { type: "object", properties: { enabled: { type: "boolean" } }, additionalProperties: false },
    examples: { type: "object", properties: { enabled: { type: "boolean" } }, additionalProperties: false },
  },
  additionalProperties: false,
} as const;

export const promptRuntimePolicyPatchBodyJsonSchema = {
  type: "object",
  properties: {
    structure: { anyOf: [promptRuntimePersistentStructureJsonSchema, { type: "null" }] },
    delivery: { anyOf: [promptRuntimePersistentDeliveryJsonSchema, { type: "null" }] },
  },
  anyOf: [
    { required: ["structure"] },
    { required: ["delivery"] },
  ],
  examples: [promptRuntimePolicyPatchBodyExample],
  additionalProperties: false,
} as const;

export const promptRuntimePersistentPolicyJsonSchema = {
  type: "object",
  properties: {
    structure: promptRuntimePersistentStructureJsonSchema,
    delivery: promptRuntimePersistentDeliveryJsonSchema,
    budget: promptRuntimeBudgetJsonSchema,
    source_selection: promptRuntimePersistentSourceSelectionJsonSchema,
  },
  additionalProperties: false,
} as const;

const promptRuntimeResolvedSourceSelectionJsonSchema = {
  type: "object",
  required: ["history", "memory", "worldbook", "examples"],
  properties: {
    history: {
      type: "object",
      required: ["mode"],
      properties: {
        mode: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES] },
        max_messages: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    memory: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } }, additionalProperties: false },
    worldbook: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } }, additionalProperties: false },
    examples: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } }, additionalProperties: false },
  },
  additionalProperties: false,
} as const;

const promptRuntimeResolvedStructureJsonSchema = {
  type: "object",
  required: ["mode", "merge_adjacent_same_role", "preserve_system_messages"],
  properties: {
    mode: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES] },
    merge_adjacent_same_role: { type: "boolean" },
    preserve_system_messages: { type: "boolean" },
    assistant_rewrite_strategy: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES] },
  },
  additionalProperties: false,
} as const;

const promptRuntimeResolvedDeliveryJsonSchema = {
  type: "object",
  required: ["allow_assistant_prefill", "require_last_user", "no_assistant"],
  properties: {
    allow_assistant_prefill: { type: "boolean" },
    require_last_user: { type: "boolean" },
    no_assistant: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const promptRuntimeDebugPolicyJsonSchema = {
  type: "object",
  required: ["include_prompt_snapshot", "include_runtime_trace", "include_worldbook_matches"],
  properties: {
    include_prompt_snapshot: { type: "boolean" },
    include_runtime_trace: { type: "boolean" },
    include_worldbook_matches: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const promptRuntimePolicySourceJsonSchema = {
  type: "string",
  enum: [...PROMPT_RUNTIME_POLICY_SOURCES],
} as const;

const promptRuntimeSourceSelectionSourceMapJsonSchema = {
  type: "object",
  properties: {
    history: {
      type: "object",
      properties: {
        mode: promptRuntimePolicySourceJsonSchema,
        max_messages: promptRuntimePolicySourceJsonSchema,
      },
      additionalProperties: false,
    },
    memory: { type: "object", properties: { enabled: promptRuntimePolicySourceJsonSchema }, additionalProperties: false },
    worldbook: { type: "object", properties: { enabled: promptRuntimePolicySourceJsonSchema }, additionalProperties: false },
    examples: { type: "object", properties: { enabled: promptRuntimePolicySourceJsonSchema }, additionalProperties: false },
  },
  additionalProperties: false,
} as const;

const promptRuntimeSourceMapJsonSchema = {
  type: "object",
  properties: {
    structure: {
      type: "object",
      properties: {
        mode: promptRuntimePolicySourceJsonSchema,
        merge_adjacent_same_role: promptRuntimePolicySourceJsonSchema,
        preserve_system_messages: promptRuntimePolicySourceJsonSchema,
        assistant_rewrite_strategy: promptRuntimePolicySourceJsonSchema,
      },
      additionalProperties: false,
    },
    delivery: {
      type: "object",
      properties: {
        allow_assistant_prefill: promptRuntimePolicySourceJsonSchema,
        require_last_user: promptRuntimePolicySourceJsonSchema,
        no_assistant: promptRuntimePolicySourceJsonSchema,
      },
      additionalProperties: false,
    },
    debug: {
      type: "object",
      properties: {
        include_prompt_snapshot: promptRuntimePolicySourceJsonSchema,
        include_runtime_trace: promptRuntimePolicySourceJsonSchema,
        include_worldbook_matches: promptRuntimePolicySourceJsonSchema,
      },
      additionalProperties: false,
    },
    budget: {
      type: "object",
      properties: {
        max_input_tokens: promptRuntimePolicySourceJsonSchema,
        reserved_completion_tokens: promptRuntimePolicySourceJsonSchema,
      },
      additionalProperties: false,
    },
    source_selection: promptRuntimeSourceSelectionSourceMapJsonSchema,
    history: {
      type: "object",
      properties: {
        source_branch_id: { type: "string" },
        source_mode: { type: "string", enum: ["existing_branch", "source_floor_branch", "main_fallback"] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const promptRuntimeAssetSummaryJsonSchema = {
  anyOf: [
    {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      additionalProperties: false,
    },
    {
      type: "null",
    },
  ],
} as const;

export const promptRuntimeAssetsViewJsonSchema = {
  type: "object",
  required: ["preset", "character_card", "worldbook", "regex_profile"],
  properties: {
    preset: promptRuntimeAssetSummaryJsonSchema,
    character_card: promptRuntimeAssetSummaryJsonSchema,
    worldbook: promptRuntimeAssetSummaryJsonSchema,
    regex_profile: promptRuntimeAssetSummaryJsonSchema,
  },
  additionalProperties: false,
} as const;

const promptRuntimeResolvedPolicyJsonSchema = {
  type: "object",
  required: ["structure", "delivery", "budget", "source_selection", "debug"],
  properties: {
    structure: promptRuntimeResolvedStructureJsonSchema,
    delivery: promptRuntimeResolvedDeliveryJsonSchema,
    budget: promptRuntimeBudgetJsonSchema,
    source_selection: promptRuntimeResolvedSourceSelectionJsonSchema,
    debug: promptRuntimeDebugPolicyJsonSchema,
  },
  additionalProperties: false,
} as const;

const promptRuntimeScopeJsonSchema = {
  type: "object",
  required: ["session_id", "target_branch_id", "branch_exists", "history_source_branch_id", "history_source_mode"],
  properties: {
    session_id: { type: "string" },
    target_branch_id: { type: "string" },
    branch_exists: { type: "boolean" },
    source_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    history_source_branch_id: { type: "string" },
    history_source_mode: { type: "string", enum: ["existing_branch", "source_floor_branch", "main_fallback"] },
  },
  additionalProperties: false,
} as const;

const promptRuntimeDiagnosticJsonSchema = {
  type: "object",
  required: ["code", "message", "severity"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    severity: { type: "string", enum: ["info", "warning", "error"] },
    source: { type: "string", enum: ["policy", "branch", "macro", "budget", "source_selection", "provider_constraint"] },
    field_path: { type: "string" },
    phase: { type: "string", enum: ["preview", "dry_run", "assemble", "commit_consume", "explain"] },
  },
  additionalProperties: false,
} as const;

const promptRuntimeHistoricalPromptSnapshotJsonSchema = {
  type: "object",
  required: [
    "preset_id",
    "preset_updated_at",
    "preset_version",
    "worldbook_id",
    "worldbook_updated_at",
    "worldbook_version",
    "regex_profile_id",
    "regex_profile_updated_at",
    "regex_profile_version",
    "worldbook_activated_entry_uids",
    "regex_pre_rule_names",
    "regex_post_rule_names",
    "prompt_mode",
    "prompt_digest",
    "token_estimate",
  ],
  properties: {
    preset_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    preset_updated_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
    preset_version: { anyOf: [{ type: "integer" }, { type: "null" }] },
    worldbook_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    worldbook_updated_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
    worldbook_version: { anyOf: [{ type: "integer" }, { type: "null" }] },
    regex_profile_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    regex_profile_updated_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
    regex_profile_version: { anyOf: [{ type: "integer" }, { type: "null" }] },
    worldbook_activated_entry_uids: { type: "array", items: { type: "integer" } },
    regex_pre_rule_names: { type: "array", items: { type: "string" } },
    regex_post_rule_names: { type: "array", items: { type: "string" } },
    prompt_mode: { type: "string", enum: ["compat_strict", "compat_plus", "native"] },
    prompt_digest: { type: "string" },
    token_estimate: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const promptRuntimeHistoricalExplainFloorJsonSchema = {
  type: "object",
  required: ["id", "session_id", "floor_no", "branch_id", "parent_floor_id", "state", "prompt_snapshot_created_at", "committed_at"],
  properties: {
    id: { type: "string" },
    session_id: { type: "string" },
    floor_no: { type: "integer", minimum: 0 },
    branch_id: { type: "string" },
    parent_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    state: { type: "string", enum: ["committed"] },
    prompt_snapshot_created_at: { type: "integer", minimum: 0 },
    committed_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const promptRuntimeHistoricalExplainTrimReasonJsonSchema = {
  type: "object",
  required: ["group", "reason"],
  properties: {
    group: { type: "string" },
    reason: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_TRIM_REASON_CODES] },
    detail: { type: "string" },
    pruned_token_count: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const promptRuntimeHistoricalExplainSourceExclusionJsonSchema = {
  type: "object",
  required: ["source", "reason"],
  properties: {
    source: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES] },
    reason: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES] },
    detail: { type: "string" },
  },
  additionalProperties: false,
} as const;

const promptRuntimeHistoricalExplainResultJsonSchema = {
  type: "object",
  required: ["output_page_id", "assistant_message_id", "generated_text", "summaries", "usage", "verifier", "committed_at"],
  properties: {
    output_page_id: { type: "string" },
    assistant_message_id: { type: "string" },
    generated_text: { type: "string" },
    summaries: { type: "array", items: { type: "string" } },
    usage: {
      type: "object",
      required: ["prompt_tokens", "completion_tokens", "total_tokens"],
      properties: {
        prompt_tokens: { type: "integer", minimum: 0 },
        completion_tokens: { type: "integer", minimum: 0 },
        total_tokens: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    verifier: {
      anyOf: [
        {
          type: "object",
          required: ["status", "suggestion", "issues"],
          properties: {
            status: { type: "string" },
            suggestion: { anyOf: [{ type: "string" }, { type: "null" }] },
            issues: {
              anyOf: [
                {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["description", "severity"],
                    properties: {
                      description: { type: "string" },
                      severity: { type: "string", enum: ["warning", "error"] },
                    },
                    additionalProperties: false,
                  },
                },
                { type: "null" },
              ],
            },
          },
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    committed_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

export const promptRuntimeResolvedStateJsonSchema = {
  type: "object",
  required: ["scope", "policy", "branch_persistent_policy", "assets", "warnings", "diagnostics", "limitations"],
  properties: {
    scope: promptRuntimeScopeJsonSchema,
    policy: promptRuntimeResolvedPolicyJsonSchema,
    persistent_policy: promptRuntimePersistentPolicyJsonSchema,
    branch_persistent_policy: { anyOf: [promptRuntimePersistentPolicyJsonSchema, { type: "null" }] },
    assets: promptRuntimeAssetsViewJsonSchema,
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    diagnostics: {
      type: "array",
      items: promptRuntimeDiagnosticJsonSchema,
    },
    limitations: {
      type: "array",
      items: { type: "string" },
    },
    source_map: promptRuntimeSourceMapJsonSchema,
  },
  additionalProperties: false,
} as const;

export const promptRuntimePolicyViewJsonSchema = {
  type: "object",
  required: ["resolved_policy", "warnings"],
  properties: {
    persistent_policy: promptRuntimePersistentPolicyJsonSchema,
    resolved_policy: promptRuntimeResolvedPolicyJsonSchema,
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
} as const;

const promptRuntimePreviewMacroWarningJsonSchema = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    macro_name: { type: "string" },
    raw_text: { type: "string" },
  },
  additionalProperties: false,
} as const;

const promptRuntimePreviewMacroMutationPreviewJsonSchema = {
  type: "object",
  required: ["kind", "scope", "key"],
  properties: {
    kind: { type: "string", enum: ["set", "delete"] },
    scope: { type: "string", enum: ["branch", "global"] },
    key: { type: "string" },
    value: { type: "string" },
  },
  additionalProperties: false,
} as const;

const promptRuntimePreviewMacroStagedMutationJsonSchema = {
  type: "object",
  required: ["kind", "scope", "key", "source_macro"],
  properties: {
    kind: { type: "string", enum: ["set", "delete"] },
    scope: { type: "string", enum: ["branch", "global"] },
    key: { type: "string" },
    value: { type: "string" },
    source_macro: { type: "string" },
  },
  additionalProperties: false,
} as const;

const promptRuntimePreviewMacroTraceEntryJsonSchema = {
  type: "object",
  required: ["macro_name", "raw_text", "resolved_text"],
  properties: {
    macro_name: { type: "string" },
    raw_text: { type: "string" },
    resolved_text: { type: "string" },
    phase: { type: "string" },
    source_kind: { type: "string", enum: ["text", "raw", "macro", "if"] },
    selected_branch: { type: "string", enum: ["then", "else", "raw"] },
  },
  additionalProperties: false,
} as const;

const promptRuntimePreviewMacroJsonSchema = {
  type: "object",
  required: ["warnings", "used_names", "mutation_preview", "staged_mutations", "traces"],
  properties: {
    warnings: { type: "array", items: promptRuntimePreviewMacroWarningJsonSchema },
    used_names: { type: "array", items: { type: "string" } },
    mutation_preview: { type: "array", items: promptRuntimePreviewMacroMutationPreviewJsonSchema },
    staged_mutations: { type: "array", items: promptRuntimePreviewMacroStagedMutationJsonSchema },
    traces: { type: "array", items: promptRuntimePreviewMacroTraceEntryJsonSchema },
  },
  examples: [promptRuntimePreviewResponseExample.runtime_trace.macro],
  additionalProperties: false,
} as const;

const promptRuntimePreviewSourceExclusionReasonJsonSchema = {
  type: "object",
  required: ["source", "reason"],
  properties: {
    source: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES] },
    reason: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES] },
    detail: { type: "string" },
  },
  additionalProperties: false,
} as const;

const promptRuntimePreviewSourceSelectionTraceJsonSchema = {
  type: "object",
  required: ["excluded_sources"],
  properties: {
    excluded_sources: {
      type: "array",
      items: promptRuntimePreviewSourceExclusionReasonJsonSchema,
    },
  },
  additionalProperties: false,
} as const;

const promptRuntimePreviewRuntimeTraceJsonSchema = {
  type: "object",
  properties: {
    macro: promptRuntimePreviewMacroJsonSchema,
    source_selection: promptRuntimePreviewSourceSelectionTraceJsonSchema,
    visibility: {
      type: "object",
      required: ["filtered_floor_nos"],
      properties: {
        hidden_floor_ranges: { type: "array", items: floorVisibilityRangeJsonSchema },
        filtered_floor_nos: { type: "array", items: { type: "integer" } },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

export const promptRuntimeCapabilitiesJsonSchema = {
  type: "object",
  required: ["structure", "delivery", "budget", "source_selection", "observability", "macro", "unsupported"],
  properties: {
    structure: {
      type: "object",
      required: ["modes", "defaults"],
      properties: {
        modes: {
          type: "array",
          items: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES] },
        },
        defaults: promptRuntimeResolvedStructureJsonSchema,
      },
      additionalProperties: false,
    },
    delivery: {
      type: "object",
      required: ["defaults"],
      properties: {
        defaults: promptRuntimeResolvedDeliveryJsonSchema,
      },
      additionalProperties: false,
    },
    budget: {
      type: "object",
      required: ["defaults", "request_override_supported", "persistent_patch_supported", "supported_fields", "trim_reason_codes"],
      properties: {
        defaults: promptRuntimeBudgetJsonSchema,
        request_override_supported: { const: true },
        persistent_patch_supported: { const: false },
        supported_fields: { type: "array", items: { type: "string", enum: ["maxInputTokens", "reservedCompletionTokens"] } },
        trim_reason_codes: { type: "array", items: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_TRIM_REASON_CODES] } },
      },
      additionalProperties: false,
    },
    source_selection: {
      type: "object",
      required: ["defaults", "request_override_supported", "persistent_patch_supported", "supported_sources", "history_modes", "exclusion_reason_codes"],
      properties: {
        defaults: promptRuntimeResolvedSourceSelectionJsonSchema,
        request_override_supported: { const: true },
        persistent_patch_supported: { const: false },
        supported_sources: { type: "array", items: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES] } },
        history_modes: { type: "array", items: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES] } },
        exclusion_reason_codes: { type: "array", items: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES] } },
      },
      additionalProperties: false,
    },
    observability: {
      type: "object",
      required: ["live", "dry_run", "preview", "explain", "stream"],
      properties: {
        live: {
          type: "object",
          required: [
            "enabled",
            "default_off",
            "request_scoped_only",
            "include_prompt_snapshot",
            "include_runtime_trace",
            "include_worldbook_matches",
            "worldbook_matches_requires_runtime_trace",
            "worldbook_matches_requires_opt_in",
            "visibility_request_supported",
          ],
          properties: {
            enabled: { type: "boolean" },
            default_off: { const: true },
            request_scoped_only: { const: true },
            include_prompt_snapshot: { const: true },
            include_runtime_trace: { const: true },
            include_worldbook_matches: { const: true },
            worldbook_matches_requires_runtime_trace: { const: true },
            worldbook_matches_requires_opt_in: { const: true },
            visibility_request_supported: { const: false },
          },
          additionalProperties: false,
        },
        dry_run: {
          type: "object",
          required: [
            "enabled",
            "returns_assembly",
            "returns_runtime_trace",
            "supports_visibility",
            "include_worldbook_matches",
          ],
          properties: {
            enabled: { type: "boolean" },
            returns_assembly: { const: true },
            returns_runtime_trace: { const: true },
            supports_visibility: { const: true },
            include_worldbook_matches: { const: true },
          },
          additionalProperties: false,
        },
        preview: {
          type: "object",
          required: [
            "enabled",
            "returns_runtime_trace",
            "supports_visibility",
            "single_text_only",
            "llm_call",
            "creates_floor",
            "writes_prompt_snapshot",
            "commits_side_effects",
          ],
          properties: {
            enabled: { type: "boolean" },
            returns_runtime_trace: { const: true },
            supports_visibility: { const: true },
            single_text_only: { const: true },
            llm_call: { const: false },
            creates_floor: { const: false },
            writes_prompt_snapshot: { const: false },
            commits_side_effects: { const: false },
          },
          additionalProperties: false,
        },
        explain: {
          type: "object",
          required: ["enabled", "read_only", "requires_committed_floor", "persisted_truth_only", "recompute"],
          properties: {
            enabled: { const: true },
            read_only: { const: true },
            requires_committed_floor: { const: true },
            persisted_truth_only: { const: true },
            recompute: { const: false },
          },
          additionalProperties: false,
        },
        stream: {
          type: "object",
          required: ["enabled", "prompt_debug_payload", "new_sse_event_family"],
          properties: {
            enabled: { type: "boolean" },
            prompt_debug_payload: { type: "string", enum: ["done_only", "unsupported"] },
            new_sse_event_family: { const: false },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    macro: {
      type: "object",
      required: [
        "built_in_read_only_values_persistable",
        "st_compatibility_snapshots_persistable",
        "run_kind_persistable",
        "diagnostics_surface",
        "dedicated_macros_route",
        "recent_message_respects_visibility",
      ],
      properties: {
        built_in_read_only_values_persistable: { const: false },
        st_compatibility_snapshots_persistable: { const: false },
        run_kind_persistable: { const: false },
        diagnostics_surface: { type: "string", enum: ["unified_observability"] },
        dedicated_macros_route: { const: false },
        recent_message_respects_visibility: { const: true },
      },
      additionalProperties: false,
    },
    unsupported: {
      type: "array",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
} as const;

export const promptRuntimeResolvedStateResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: promptRuntimeResolvedStateJsonSchema,
  },
  examples: [{ data: promptRuntimeResolvedStateExample }],
  additionalProperties: false,
} as const;

export const promptRuntimePolicyViewResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: promptRuntimePolicyViewJsonSchema,
  },
  examples: [{ data: promptRuntimePolicyViewExample }],
  additionalProperties: false,
} as const;

export const promptRuntimeAssetsResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: promptRuntimeAssetsViewJsonSchema,
  },
  examples: [{ data: promptRuntimeAssetsExample }],
  additionalProperties: false,
} as const;

export const promptRuntimePreviewBodyJsonSchema = {
  type: "object",
  required: ["text"],
  properties: {
    text: { type: "string", minLength: 1 },
    branch_id: { type: "string", minLength: 1 },
    source_floor_id: { type: "string", minLength: 1 },
    structure: promptRuntimePersistentStructureJsonSchema,
    delivery: promptRuntimePersistentDeliveryJsonSchema,
    budget: promptRuntimeBudgetJsonSchema,
    source_selection: promptRuntimePersistentSourceSelectionJsonSchema,
    visibility: dryRunVisibilityJsonSchema,
  },
  examples: [promptRuntimePreviewBodyExample],
  additionalProperties: false,
} as const;

export const promptRuntimePreviewResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["scope", "policy", "text", "runtime_trace", "diagnostics", "limitations"],
      properties: {
        scope: promptRuntimeScopeJsonSchema,
        policy: promptRuntimeResolvedPolicyJsonSchema,
        source_map: promptRuntimeSourceMapJsonSchema,
        text: { type: "string" },
        runtime_trace: promptRuntimePreviewRuntimeTraceJsonSchema,
        diagnostics: { type: "array", items: promptRuntimeDiagnosticJsonSchema },
        limitations: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
  },
  examples: [{ data: promptRuntimePreviewResponseExample }],
  additionalProperties: false,
} as const;

export const promptRuntimeHistoricalExplainResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["floor", "scope", "prompt_snapshot", "resolved_policy", "trim_reasons", "excluded_sources", "diagnostics", "limitations", "result"],
      properties: {
        floor: promptRuntimeHistoricalExplainFloorJsonSchema,
        scope: promptRuntimeScopeJsonSchema,
        prompt_snapshot: promptRuntimeHistoricalPromptSnapshotJsonSchema,
        resolved_policy: { anyOf: [promptRuntimeResolvedPolicyJsonSchema, { type: "null" }] },
        source_map: promptRuntimeSourceMapJsonSchema,
        trim_reasons: { anyOf: [{ type: "array", items: promptRuntimeHistoricalExplainTrimReasonJsonSchema }, { type: "null" }] },
        excluded_sources: { anyOf: [{ type: "array", items: promptRuntimeHistoricalExplainSourceExclusionJsonSchema }, { type: "null" }] },
        diagnostics: { type: "array", items: promptRuntimeDiagnosticJsonSchema },
        limitations: { type: "array", items: { type: "string" } },
        result: promptRuntimeHistoricalExplainResultJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [{ data: promptRuntimeHistoricalExplainResponseExample }],
  additionalProperties: false,
} as const;

export const promptRuntimeCapabilitiesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: promptRuntimeCapabilitiesJsonSchema,
  },
  examples: [{ data: promptRuntimeCapabilitiesExample }],
  additionalProperties: false,
} as const;
