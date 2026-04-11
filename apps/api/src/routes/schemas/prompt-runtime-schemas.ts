import {
  PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES,
  PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES,
  PROMPT_RUNTIME_UNSUPPORTED_ROUTES,
} from "../../services/prompt-runtime-control-service.js";

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

const promptRuntimeResolvedStructureExample = {
  mode: "strict_alternating",
  merge_adjacent_same_role: true,
  preserve_system_messages: true,
} as const;

const promptRuntimeResolvedDeliveryExample = {
  allow_assistant_prefill: true,
  require_last_user: true,
  no_assistant: false,
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

export const promptRuntimeResolvedStateExample = {
  policy: {
    structure: promptRuntimeResolvedStructureExample,
    delivery: promptRuntimeResolvedDeliveryExample,
    debug: promptRuntimeDebugPolicyExample,
  },
  persistent_policy: {
    structure: promptRuntimePersistentStructureExample,
    delivery: promptRuntimePersistentDeliveryExample,
  },
  assets: promptRuntimeAssetsExample,
  warnings: [],
} as const;

export const promptRuntimePolicyViewExample = {
  persistent_policy: {
    structure: promptRuntimePersistentStructureExample,
    delivery: promptRuntimePersistentDeliveryExample,
  },
  resolved_policy: {
    structure: promptRuntimeResolvedStructureExample,
    delivery: promptRuntimeResolvedDeliveryExample,
    debug: promptRuntimeDebugPolicyExample,
  },
  warnings: [],
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
  required: ["structure", "delivery", "debug"],
  properties: {
    structure: promptRuntimeResolvedStructureJsonSchema,
    delivery: promptRuntimeResolvedDeliveryJsonSchema,
    debug: promptRuntimeDebugPolicyJsonSchema,
  },
  additionalProperties: false,
} as const;

export const promptRuntimeResolvedStateJsonSchema = {
  type: "object",
  required: ["policy", "assets", "warnings"],
  properties: {
    policy: promptRuntimeResolvedPolicyJsonSchema,
    persistent_policy: promptRuntimePersistentPolicyJsonSchema,
    assets: promptRuntimeAssetsViewJsonSchema,
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    source_map: {
      type: "object",
      additionalProperties: true,
    },
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

export const promptRuntimeCapabilitiesJsonSchema = {
  type: "object",
  required: ["structure", "delivery", "observability", "macro", "unsupported"],
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
    observability: {
      type: "object",
      required: ["live", "dry_run", "stream"],
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

export const promptRuntimeCapabilitiesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: promptRuntimeCapabilitiesJsonSchema,
  },
  examples: [{ data: promptRuntimeCapabilitiesExample }],
  additionalProperties: false,
} as const;
