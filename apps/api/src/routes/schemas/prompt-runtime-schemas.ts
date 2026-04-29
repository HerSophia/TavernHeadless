import {
  DERIVED_NO_ASSISTANT_STRUCTURE_WARNING,
  PROMPT_RUNTIME_POLICY_SOURCES,
  PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES,
  PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES,
  PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES,
  PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES,
  PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES,
  PROMPT_RUNTIME_SUPPORTED_TRIM_REASON_CODES,
  PROMPT_RUNTIME_SUPPORTED_VISIBILITY_MODES,
  PROMPT_RUNTIME_HISTORICAL_EXPLAIN_LIMITATIONS,
  PROMPT_RUNTIME_LIMITATIONS,
  PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS,
  PROMPT_RUNTIME_UNSUPPORTED_ROUTES,
} from "../../services/prompt-runtime-control-service.js";
import {
  dryRunVisibilityJsonSchema,
  floorVisibilityRangeJsonSchema,
  generationParamsJsonSchema,
  liveDebugOptionsJsonSchema,
  promptBudgetJsonSchema,
  livePromptSnapshotExample,
  livePromptSnapshotJsonSchema,
  promptDeliveryJsonSchema,
  promptIntentValues,
  promptSourceSelectionJsonSchema,
  promptStructureJsonSchema,
  turnConfigJsonSchema,
  dryRunRuntimeTraceJsonSchema,
  turnSessionStateWritesJsonSchema,
} from "./chat-schemas.js";

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

const promptRuntimeVisibilityExample = {
  mode: "allow_all_except_hidden",
  hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }],
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
  visibility: promptRuntimeVisibilityExample,
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

const promptRuntimeResolvedVisibilityExample = {
  ...promptRuntimeVisibilityExample,
} as const;

const promptRuntimeDebugPolicyExample = {
  include_prompt_snapshot: false,
  include_runtime_trace: false,
  include_worldbook_matches: false,
} as const;

const promptRuntimeAssetsExample = {
  preset: {
    id: "preset-1",
    name: "Story Preset",
  },
  character_card: {
    id: "char-hero",
    name: "Hero",
  },
  worldbook: {
    id: "worldbook-1",
    name: "Campfire Worldbook",
  },
  regex_profile: {
    id: "regex-1",
    name: "Safety Regex",
  },
} as const;

const promptRuntimeBranchPersistentPolicyExample = {
  delivery: {
    no_assistant: true,
  },
} as const;

const promptRuntimePersistentPolicyEnvelopeExample = {
  version: 2,
  updated_at: 1710000004500,
  updated_by: "user-1",
  value: {
    delivery: {
      no_assistant: true,
    },
    budget: promptRuntimeBudgetExample,
    source_selection: promptRuntimeSourceSelectionExample,
    visibility: promptRuntimeVisibilityExample,
  },
} as const;

const promptRuntimeSectionStatsExample = [
  { section_name: "history", token_count: 320 },
  { section_name: "main", token_count: 96 },
] as const;

const promptRuntimeGovernanceExample = {
  entries: [
    {
      source_kind: "history",
      declared_level: "budget_prunable",
      registered: true,
      effective_retention: "budget_prunable",
      pinned: false,
      prunable: true,
      budget_groups: ["history"],
      section_names: ["chatHistory"],
      token_count: 320,
      retained_token_count: 256,
      pruned_token_count: 64,
    },
    {
      source_kind: "memory",
      declared_level: "soft_required",
      registered: true,
      effective_retention: "soft_required",
      pinned: false,
      prunable: false,
      budget_groups: ["memory"],
      section_names: ["memory"],
      token_count: 64,
      retained_token_count: 64,
      pruned_token_count: 0,
    },
  ],
  mismatches: [],
  limitations: [],
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
  visibility: {
    mode: "request_override",
    hidden_floor_ranges: "request_override",
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
    visibility: promptRuntimeResolvedVisibilityExample,
    debug: promptRuntimeDebugPolicyExample,
  },
  persistent_policy: {
    structure: promptRuntimePersistentStructureExample,
    delivery: promptRuntimePersistentDeliveryExample,
  },
  persistent_policy_envelope: {
    version: 1,
    updated_at: 1710000004200,
    updated_by: "user-1",
    value: {
      structure: promptRuntimePersistentStructureExample,
      delivery: promptRuntimePersistentDeliveryExample,
      visibility: promptRuntimeVisibilityExample,
    },
  },
  branch_persistent_policy: promptRuntimeBranchPersistentPolicyExample,
  branch_persistent_policy_envelope: promptRuntimePersistentPolicyEnvelopeExample,
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
  persistent_policy_envelope: {
    version: 1,
    updated_at: 1710000004300,
    updated_by: "user-1",
    value: {
      structure: promptRuntimePersistentStructureExample,
      delivery: promptRuntimePersistentDeliveryExample,
    },
  },
  resolved_policy: {
    structure: promptRuntimeResolvedStructureExample,
    delivery: promptRuntimeResolvedDeliveryExample,
    budget: promptRuntimeBudgetExample,
    source_selection: promptRuntimeSourceSelectionExample,
    visibility: promptRuntimeResolvedVisibilityExample,
    debug: promptRuntimeDebugPolicyExample,
  },
  warnings: [],
} as const;

export const promptRuntimeInspectBodyExample = {
  message: "Please continue the campfire scene.",
  branch_id: "alt-branch",
  source_floor_id: "floor-source",
  prompt_intent: "normal",
  config: {
    enableTools: false,
    enableDirector: false,
    enableVerifier: false,
  },
  generation_params: {
    temperature: 0.7,
    max_output_tokens: 256,
  },
  session_state_writes: [
    {
      namespace: "quest_flags",
      slot: "companion",
      value: { mood: "ally" },
    },
  ],
  debug_options: {
    include_worldbook_matches: true,
  },
  visibility: promptRuntimeVisibilityExample,
  structure: promptRuntimeResolvedStructureExample,
  delivery: promptRuntimeResolvedDeliveryExample,
  budget: promptRuntimeBudgetExample,
  source_selection: promptRuntimeSourceSelectionExample,
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
    visibility: promptRuntimeResolvedVisibilityExample,
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
    visibility: {
      mode: "request_override",
      hidden_floor_ranges: "request_override",
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
    message: "This floor has no committed prompt runtime explain snapshot, so historical explain returns resolved_policy as null instead of recomputing it.",
    severity: "info",
    source: "policy",
    field_path: "resolved_policy",
    phase: "explain",
  },
  {
    code: "historical_trim_reasons_unavailable",
    message: "This floor has no committed prompt runtime explain snapshot, so explain returns trim_reasons as null instead of recomputing budget decisions.",
    severity: "info",
    source: "budget",
    field_path: "trim_reasons",
    phase: "explain",
  },
  {
    code: "historical_excluded_sources_unavailable",
    message: "This floor has no committed prompt runtime explain snapshot, so explain returns excluded_sources as null instead of recomputing source selection.",
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
  snapshot_available: true,
  assets: promptRuntimeAssetsExample,
  prompt_snapshot: livePromptSnapshotExample,
  resolved_policy: promptRuntimePolicyViewExample.resolved_policy,
  source_map: promptRuntimeSourceMapExample,
  trim_reasons: [
    {
      group: "section:main",
      reason: "budget_exceeded",
      detail: "Prompt runtime pruned 128 tokens from budget group 'section:main'.",
      pruned_token_count: 128,
    },
  ],
  excluded_sources: [
    {
      source: "examples",
      reason: "disabled_by_policy",
      detail: "sourceSelection.examples.enabled=false removed example dialogue from prompt assembly.",
    },
  ],
  section_stats: promptRuntimeSectionStatsExample,
  diagnostics: promptRuntimeDiagnosticsExample,
  limitations: promptRuntimeLimitationsExample,
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
  governance: promptRuntimeGovernanceExample,
} as const;

export const promptRuntimeInspectResponseExample = {
  scope: promptRuntimeScopeExample,
  policy: promptRuntimePolicyViewExample.resolved_policy,
  source_map: promptRuntimeSourceMapExample,
  diagnostics: promptRuntimeDiagnosticsExample,
  trim_reasons: [
    {
      group: "history",
      reason: "group_limit_exceeded",
      detail: "Prompt runtime pruned 64 tokens from budget group 'history'.",
      pruned_token_count: 64,
    },
  ],
  excluded_sources: [
    {
      source: "examples",
      reason: "disabled_by_policy",
      detail: "sourceSelection.examples.enabled=false removed example dialogue from prompt assembly.",
    },
  ],
  section_stats: promptRuntimeSectionStatsExample,
  limitations: promptRuntimeLimitationsExample,
  prepared_turn: {
    messages: [
      { role: "system", content: "Stay in character and keep the tone warm." },
      { role: "user", content: "Please continue the campfire scene." },
    ],
    token_estimate: 512,
    available_for_reply: 1536,
    preprocessed_user_message: "Please continue the campfire scene.",
    prompt_snapshot: promptRuntimeHistoricalExplainResponseExample.prompt_snapshot,
    runtime_trace: promptRuntimePreviewResponseExample.runtime_trace,
    memory_summary: "The party recently agreed to search the northern pass.",
    generation_params: { temperature: 0.7, max_output_tokens: 256 },
    requested_turn_config: { enableTools: false, enableDirector: false, enableVerifier: false },
    turn_config: { enableTools: false, enableDirector: false, enableVerifier: false },
    session_state_writes: { total: 1, writes: [{ namespace: "quest_flags", slot: "companion", operation: "set" }] },
  },
  governance: promptRuntimeGovernanceExample,
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
    persistent_patch_supported: true,
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
    persistent_patch_supported: true,
    supported_sources: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES],
    history_modes: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES],
    exclusion_reason_codes: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES],
  },
  governance: {
    session: {
      envelope_metadata: true,
      null_clears_field: true,
      object_patch: "deep_merge",
      supported_fields: [...PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS],
    },
    branch: {
      envelope_metadata: true,
      materialized_branches_only: true,
      null_clears_field: true,
      object_patch: "deep_merge",
      supported_fields: [...PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS],
    },
  },
  compare: {
    enabled: true,
    committed_floors_only: true,
    mixed_preview_supported: false,
    limitations_instead_of_recompute: true,
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
    inspect: {
      enabled: true,
      mode: "prepared_turn",
      supports_branch: true,
      supports_source_floor: true,
      supports_visibility: true,
      returns_prepared_turn: true,
      returns_governance: true,
      llm_call: false,
      creates_floor: false,
      writes_prompt_snapshot: false,
      writes_explain_snapshot: false,
      commits_side_effects: false,
    },
    preview: {
      enabled: true,
      mode: "macro_text_preview",
      returns_runtime_trace: true,
      returns_assembly_truth: false,
      supports_visibility: true,
      single_text_only: true,
      llm_call: false,
      creates_floor: false,
      writes_prompt_snapshot: false,
      commits_side_effects: false,
      trace_subset: ["macro", "source_selection", "visibility"],
    },
    explain: {
      enabled: true,
      read_only: true,
      returns_governance: true,
      requires_committed_floor: true,
      persisted_truth_only: true,
      recompute: false,
      snapshot_supported: true,
      legacy_floor_fallback: true,
      snapshot_availability_field: "snapshot_available",
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

const promptRuntimeVisibilityJsonSchema = {
  ...dryRunVisibilityJsonSchema,
  examples: [promptRuntimeVisibilityExample],
} as const;

const promptRuntimeResolvedVisibilityJsonSchema = {
  type: "object",
  required: ["mode"],
  properties: {
    hidden_floor_ranges: {
      type: "array",
      items: floorVisibilityRangeJsonSchema,
    },
    visible_floor_ranges: {
      type: "array",
      items: floorVisibilityRangeJsonSchema,
    },
    hidden_floor_ids: { type: "array", items: { type: "string", minLength: 1 } },
    mode: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_VISIBILITY_MODES] },
  },
  additionalProperties: false,
} as const;

export const promptRuntimePolicyPatchBodyJsonSchema = {
  type: "object",
  properties: {
    structure: { anyOf: [promptRuntimePersistentStructureJsonSchema, { type: "null" }] },
    delivery: { anyOf: [promptRuntimePersistentDeliveryJsonSchema, { type: "null" }] },
    budget: { anyOf: [promptRuntimeBudgetJsonSchema, { type: "null" }] },
    source_selection: { anyOf: [promptRuntimePersistentSourceSelectionJsonSchema, { type: "null" }] },
    visibility: { anyOf: [promptRuntimeVisibilityJsonSchema, { type: "null" }] },
  },
  anyOf: [
    { required: ["structure"] },
    { required: ["delivery"] },
    { required: ["budget"] },
    { required: ["source_selection"] },
    { required: ["visibility"] },
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
    visibility: promptRuntimeVisibilityJsonSchema,
  },
  additionalProperties: false,
} as const;

const promptRuntimePersistentPolicyEnvelopeJsonSchema = {
  type: "object",
  required: ["version", "updated_at", "updated_by", "value"],
  properties: {
    version: { type: "integer", minimum: 1 },
    updated_at: { type: "integer", minimum: 0 },
    updated_by: { anyOf: [{ type: "string" }, { type: "null" }] },
    value: promptRuntimePersistentPolicyJsonSchema,
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

const promptRuntimeVisibilitySourceMapJsonSchema = {
  type: "object",
  properties: {
    hidden_floor_ranges: promptRuntimePolicySourceJsonSchema,
    visible_floor_ranges: promptRuntimePolicySourceJsonSchema,
    hidden_floor_ids: promptRuntimePolicySourceJsonSchema,
    mode: promptRuntimePolicySourceJsonSchema,
  },
  additionalProperties: false,
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
    visibility: promptRuntimeVisibilitySourceMapJsonSchema,
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
  required: ["structure", "delivery", "budget", "source_selection", "visibility", "debug"],
  properties: {
    structure: promptRuntimeResolvedStructureJsonSchema,
    delivery: promptRuntimeResolvedDeliveryJsonSchema,
    budget: promptRuntimeBudgetJsonSchema,
    source_selection: promptRuntimeResolvedSourceSelectionJsonSchema,
    visibility: promptRuntimeResolvedVisibilityJsonSchema,
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

const promptRuntimeGovernanceEntryJsonSchema = {
  type: "object",
  required: ["source_kind", "registered", "effective_retention", "pinned", "prunable", "budget_groups", "section_names", "token_count", "retained_token_count", "pruned_token_count"],
  properties: {
    source_kind: { type: "string" },
    declared_level: { anyOf: [{ type: "string", enum: ["hard_required", "soft_required", "budget_prunable"] }, { type: "null" }] },
    registered: { type: "boolean" },
    effective_retention: { type: "string", enum: ["fixed", "soft_required", "budget_prunable", "mixed"] },
    pinned: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    prunable: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    budget_groups: { type: "array", items: { type: "string" } },
    section_names: { type: "array", items: { type: "string" } },
    token_count: { type: "integer", minimum: 0 },
    retained_token_count: { type: "integer", minimum: 0 },
    pruned_token_count: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const promptRuntimeGovernanceMismatchJsonSchema = {
  type: "object",
  required: ["code", "source_kind", "effective_retention", "budget_groups", "message"],
  properties: {
    code: { type: "string", enum: ["declared_budget_prunable_but_effectively_fixed", "declared_soft_required_but_effectively_budget_prunable", "unregistered_governed_source", "mixed_effective_retention"] },
    source_kind: { type: "string" },
    declared_level: { anyOf: [{ type: "string", enum: ["hard_required", "soft_required", "budget_prunable"] }, { type: "null" }] },
    effective_retention: { type: "string", enum: ["fixed", "soft_required", "budget_prunable", "mixed"] },
    budget_groups: { type: "array", items: { type: "string" } },
    message: { type: "string" },
  },
  additionalProperties: false,
} as const;

const promptRuntimeGovernanceJsonSchema = {
  type: "object",
  required: ["entries", "mismatches", "limitations"],
  properties: {
    entries: { type: "array", items: promptRuntimeGovernanceEntryJsonSchema },
    mismatches: { type: "array", items: promptRuntimeGovernanceMismatchJsonSchema },
    limitations: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
} as const;

const promptRuntimeHistoricalPromptSnapshotJsonSchema = livePromptSnapshotJsonSchema;

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
    group: {
      type: "string",
      description: "Budget group label. This may include concrete section groups such as `section:main`.",
    },
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
    source: {
      type: "string",
      enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES],
      description: "Public source kind. Internal budget groups such as `section:*` do not appear here.",
    },
    reason: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES] },
    detail: { type: "string" },
  },
  additionalProperties: false,
} as const;

const promptRuntimeSectionStatJsonSchema = {
  type: "object",
  required: ["section_name", "token_count"],
  properties: {
    section_name: {
      type: "string",
      description: "Prompt section name. Section stats remain section-level even when budget groups use concrete labels such as `section:main`.",
    },
    token_count: { type: "integer", minimum: 0 },
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
    persistent_policy_envelope: { anyOf: [promptRuntimePersistentPolicyEnvelopeJsonSchema, { type: "null" }] },
    branch_persistent_policy: { anyOf: [promptRuntimePersistentPolicyJsonSchema, { type: "null" }] },
    branch_persistent_policy_envelope: { anyOf: [promptRuntimePersistentPolicyEnvelopeJsonSchema, { type: "null" }] },
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
    persistent_policy_envelope: { anyOf: [promptRuntimePersistentPolicyEnvelopeJsonSchema, { type: "null" }] },
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
  required: ["structure", "delivery", "budget", "source_selection", "governance", "compare", "observability", "macro", "unsupported"],
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
        persistent_patch_supported: { const: true },
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
        persistent_patch_supported: { const: true },
        supported_sources: {
          type: "array",
          description: "Public source kinds only. Internal budget groups such as `section:*` do not appear here.",
          items: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES] },
        },
        history_modes: { type: "array", items: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES] } },
        exclusion_reason_codes: { type: "array", items: { type: "string", enum: [...PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES] } },
      },
      additionalProperties: false,
    },
    governance: {
      type: "object",
      required: ["session", "branch"],
      properties: {
        session: {
          type: "object",
          required: ["envelope_metadata", "null_clears_field", "object_patch", "supported_fields"],
          properties: {
            envelope_metadata: { const: true },
            null_clears_field: { const: true },
            object_patch: { type: "string", enum: ["deep_merge"] },
            supported_fields: { type: "array", items: { type: "string", enum: [...PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS] } },
          },
          additionalProperties: false,
        },
        branch: {
          type: "object",
          required: ["envelope_metadata", "materialized_branches_only", "null_clears_field", "object_patch", "supported_fields"],
          properties: {
            envelope_metadata: { const: true },
            materialized_branches_only: { const: true },
            null_clears_field: { const: true },
            object_patch: { type: "string", enum: ["deep_merge"] },
            supported_fields: { type: "array", items: { type: "string", enum: [...PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS] } },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    compare: {
      type: "object",
      required: ["enabled", "committed_floors_only", "mixed_preview_supported", "limitations_instead_of_recompute"],
      properties: {
        enabled: { const: true },
        committed_floors_only: { const: true },
        mixed_preview_supported: { const: false },
        limitations_instead_of_recompute: { const: true },
      },
      additionalProperties: false,
    },
    observability: {
      type: "object",
      required: ["live", "dry_run", "inspect", "preview", "explain", "stream"],
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
        inspect: {
          type: "object",
          required: ["enabled", "mode", "supports_branch", "supports_source_floor", "supports_visibility", "returns_prepared_turn", "returns_governance", "llm_call", "creates_floor", "writes_prompt_snapshot", "writes_explain_snapshot", "commits_side_effects"],
          properties: {
            enabled: { type: "boolean" },
            mode: { type: "string", enum: ["prepared_turn"] },
            supports_branch: { const: true },
            supports_source_floor: { const: true },
            supports_visibility: { const: true },
            returns_prepared_turn: { const: true },
            returns_governance: { const: true },
            llm_call: { const: false },
            creates_floor: { const: false },
            writes_prompt_snapshot: { const: false },
            writes_explain_snapshot: { const: false },
            commits_side_effects: { const: false },
          },
          additionalProperties: false,
        },
        preview: {
          type: "object",
          required: [
            "enabled",
            "mode",
            "returns_runtime_trace",
            "returns_assembly_truth",
            "supports_visibility",
            "single_text_only",
            "llm_call",
            "creates_floor",
            "writes_prompt_snapshot",
            "commits_side_effects",
            "trace_subset",
          ],
          properties: {
            enabled: { type: "boolean" },
            mode: { type: "string", enum: ["macro_text_preview"] },
            returns_runtime_trace: { const: true },
            returns_assembly_truth: { const: false },
            supports_visibility: { const: true },
            single_text_only: { const: true },
            llm_call: { const: false },
            creates_floor: { const: false },
            writes_prompt_snapshot: { const: false },
            commits_side_effects: { const: false },
            trace_subset: {
              type: "array",
              items: { type: "string", enum: ["macro", "source_selection", "visibility"] },
            },
          },
          additionalProperties: false,
        },
        explain: {
          type: "object",
          required: ["enabled", "read_only", "returns_governance", "requires_committed_floor", "persisted_truth_only", "recompute", "snapshot_supported", "legacy_floor_fallback", "snapshot_availability_field"],
          properties: {
            enabled: { const: true },
            read_only: { const: true },
            returns_governance: { const: true },
            requires_committed_floor: { const: true },
            persisted_truth_only: { const: true },
            recompute: { const: false },
            snapshot_supported: { const: true },
            legacy_floor_fallback: { const: true },
            snapshot_availability_field: { type: "string", enum: ["snapshot_available"] },
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

export const promptRuntimeInspectBodyJsonSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1 },
    branch_id: { type: "string", minLength: 1 },
    source_floor_id: { type: "string", minLength: 1 },
    prompt_intent: { type: "string", enum: promptIntentValues },
    config: turnConfigJsonSchema,
    generation_params: generationParamsJsonSchema,
    session_state_writes: turnSessionStateWritesJsonSchema,
    debug_options: liveDebugOptionsJsonSchema,
    visibility: dryRunVisibilityJsonSchema,
    structure: promptStructureJsonSchema,
    delivery: promptDeliveryJsonSchema,
    budget: promptBudgetJsonSchema,
    source_selection: promptSourceSelectionJsonSchema,
  },
  examples: [promptRuntimeInspectBodyExample],
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

export const promptRuntimeInspectResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["scope", "policy", "source_map", "diagnostics", "trim_reasons", "excluded_sources", "section_stats", "limitations", "prepared_turn", "governance"],
      properties: {
        scope: promptRuntimeScopeJsonSchema,
        policy: promptRuntimeResolvedPolicyJsonSchema,
        source_map: promptRuntimeSourceMapJsonSchema,
        diagnostics: { type: "array", items: promptRuntimeDiagnosticJsonSchema },
        trim_reasons: { type: "array", items: promptRuntimeHistoricalExplainTrimReasonJsonSchema },
        excluded_sources: { type: "array", items: promptRuntimeHistoricalExplainSourceExclusionJsonSchema },
        section_stats: { type: "array", items: promptRuntimeSectionStatJsonSchema },
        limitations: { type: "array", items: { type: "string" } },
        prepared_turn: {
          type: "object",
          required: ["messages", "token_estimate", "available_for_reply", "preprocessed_user_message", "prompt_snapshot", "runtime_trace", "memory_summary", "generation_params", "requested_turn_config", "turn_config", "session_state_writes"],
          properties: {
            messages: { type: "array", items: { type: "object", required: ["role", "content"], properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: { type: "string" } }, additionalProperties: false } },
            token_estimate: { type: "integer", minimum: 0 },
            available_for_reply: { type: "integer", minimum: 0 },
            preprocessed_user_message: { anyOf: [{ type: "string" }, { type: "null" }] },
            prompt_snapshot: { anyOf: [promptRuntimeHistoricalPromptSnapshotJsonSchema, { type: "null" }] },
            runtime_trace: { anyOf: [dryRunRuntimeTraceJsonSchema, { type: "null" }] },
            memory_summary: { anyOf: [{ type: "string" }, { type: "null" }] },
            generation_params: { type: "object" },
            requested_turn_config: { anyOf: [{ type: "object" }, { type: "null" }] },
            turn_config: { anyOf: [{ type: "object" }, { type: "null" }] },
            session_state_writes: {
              type: "object",
              required: ["total", "writes"],
              properties: {
                total: { type: "integer", minimum: 0 },
                writes: { type: "array", items: { type: "object", required: ["namespace", "slot", "operation"], properties: { namespace: { type: "string" }, slot: { type: "string" }, operation: { type: "string", enum: ["set", "delete"] } }, additionalProperties: false } },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        governance: promptRuntimeGovernanceJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [{ data: promptRuntimeInspectResponseExample }],
  additionalProperties: false,
} as const;

export const promptRuntimeHistoricalExplainResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["floor", "scope", "snapshot_available", "assets", "prompt_snapshot", "resolved_policy", "governance", "trim_reasons", "excluded_sources", "section_stats", "diagnostics", "limitations", "result"],
      properties: {
        floor: promptRuntimeHistoricalExplainFloorJsonSchema,
        scope: promptRuntimeScopeJsonSchema,
        snapshot_available: { type: "boolean" },
        assets: { anyOf: [promptRuntimeAssetsViewJsonSchema, { type: "null" }] },
        prompt_snapshot: promptRuntimeHistoricalPromptSnapshotJsonSchema,
        resolved_policy: { anyOf: [promptRuntimeResolvedPolicyJsonSchema, { type: "null" }] },
        governance: { anyOf: [promptRuntimeGovernanceJsonSchema, { type: "null" }] },
        source_map: promptRuntimeSourceMapJsonSchema,
        trim_reasons: { anyOf: [{ type: "array", items: promptRuntimeHistoricalExplainTrimReasonJsonSchema }, { type: "null" }] },
        excluded_sources: { anyOf: [{ type: "array", items: promptRuntimeHistoricalExplainSourceExclusionJsonSchema }, { type: "null" }] },
        section_stats: { anyOf: [{ type: "array", items: promptRuntimeSectionStatJsonSchema }, { type: "null" }] },
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

const promptRuntimeDiffEntryJsonSchema = {
  type: "object",
  required: ["path", "change_type"],
  properties: {
    path: { type: "string" },
    change_type: { type: "string", enum: ["added", "removed", "changed"] },
    left: {},
    right: {},
  },
  additionalProperties: false,
} as const;

const promptRuntimeCompareResponseExample = {
  left: { floor_id: "floor-left", snapshot_available: true },
  right: { floor_id: "floor-right", snapshot_available: true },
  scope_changes: [],
  policy_changes: [
    {
      path: "policy.resolved_policy.budget.max_input_tokens",
      change_type: "changed",
      left: 4096,
      right: 2048,
    },
    {
      path: "policy.resolved_policy.visibility.mode",
      change_type: "changed",
      left: "allow_all_except_hidden",
      right: "deny_all_except_visible",
    },
    {
      path: "policy.source_map.visibility.mode",
      change_type: "changed",
      left: "session_policy",
      right: "request_override",
    },
  ],
  asset_changes: [],
  diagnostics_changes: [],
  governance_changes: [],
  trim_changes: [
    {
      path: "trim_reasons",
      change_type: "changed",
      left: [{ group: "section:main", reason: "group_limit_exceeded", pruned_token_count: 32 }],
      right: [{ group: "section:main", reason: "group_limit_exceeded", pruned_token_count: 64 }],
    },
  ],
  exclusion_changes: [
    {
      path: "excluded_sources",
      change_type: "changed",
      left: [{ source: "history", reason: "visibility_filtered" }],
      right: [{ source: "examples", reason: "disabled_by_policy" }],
    },
  ],
  limitations: [],
} as const;

export const promptRuntimeCompareBodyJsonSchema = {
  type: "object",
  required: ["left", "right"],
  properties: {
    left: {
      type: "object",
      required: ["floor_id"],
      properties: {
        floor_id: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    right: {
      type: "object",
      required: ["floor_id"],
      properties: {
        floor_id: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

export const promptRuntimeCompareResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["left", "right", "scope_changes", "policy_changes", "asset_changes", "diagnostics_changes", "trim_changes", "exclusion_changes", "governance_changes", "limitations"],
      properties: {
        left: {
          type: "object",
          required: ["floor_id", "snapshot_available"],
          properties: {
            floor_id: { type: "string" },
            snapshot_available: { type: "boolean" },
          },
          additionalProperties: false,
        },
        right: {
          type: "object",
          required: ["floor_id", "snapshot_available"],
          properties: {
            floor_id: { type: "string" },
            snapshot_available: { type: "boolean" },
          },
          additionalProperties: false,
        },
        scope_changes: { type: "array", items: promptRuntimeDiffEntryJsonSchema },
        policy_changes: { type: "array", items: promptRuntimeDiffEntryJsonSchema },
        asset_changes: { type: "array", items: promptRuntimeDiffEntryJsonSchema },
        diagnostics_changes: { type: "array", items: promptRuntimeDiffEntryJsonSchema },
        trim_changes: { type: "array", items: promptRuntimeDiffEntryJsonSchema },
        exclusion_changes: { type: "array", items: promptRuntimeDiffEntryJsonSchema },
        governance_changes: { type: "array", items: promptRuntimeDiffEntryJsonSchema },
        limitations: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  examples: [{ data: promptRuntimeCompareResponseExample }],
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
