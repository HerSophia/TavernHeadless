/**
 * Chat route JSON Schema & example constants.
 *
 * Extracted from chat.ts to reduce file size (F012).
 */

// ── Example constants ─────────────────────────────────

export const turnConfigExample = {
  enableTools: true,
  enableDirector: true,
  enableVerifier: true,
  enableMemoryConsolidation: true,
  toolMode: "inline",
  verifierFailStrategy: "warn",
  maxRetries: 1,
} as const;

export const generationParamsExample = {
  temperature: 0.7,
  max_output_tokens: 256,
  top_p: 0.9,
  reasoning_effort: "low",
} as const;

export const respondBodyExample = {
  message: "Please continue the campfire scene.",
  branch_id: "main",
  prompt_intent: "normal",
  config: turnConfigExample,
  generation_params: generationParamsExample,
} as const;

export const dryRunBodyExample = {
  message: "Please continue the campfire scene.",
  prompt_intent: "normal",
  debug_options: {
    include_worldbook_matches: true,
  },
} as const;

export const regenerateBodyExample = {
  config: {
    enableDirector: true,
  },
  generation_params: generationParamsExample,
} as const;

export const editAndRegenerateBodyExample = {
  content: "I step closer to the fire and lower my voice.",
  branch_id: "alt-branch",
  config: {
    enableDirector: false,
  },
  generation_params: generationParamsExample,
} as const;

export const usageExample = {
  prompt_tokens: 320,
  completion_tokens: 128,
  total_tokens: 448,
} as const;

export const memoryReceiptExample = {
  mode: "sync",
  status: "applied",
  job_id: null,
} as const;

export const respondDataExample = {
  floor_id: "floor_12",
  floor_no: 12,
  branch_id: "main",
  generated_text: "The firelight wavers as the next part of the story begins.",
  summaries: ["The group resumes the campfire planning scene."],
  total_usage: usageExample,
  memory: memoryReceiptExample,
  final_state: "committed",
} as const;

export const respondSuccessResponseExample = {
  data: respondDataExample,
} as const;

export const regenerateSuccessResponseExample = {
  data: {
    floor_id: "floor_13",
    floor_no: 13,
    previous_floor_id: "floor_12",
    generated_text: "The assistant retries the last turn with a different phrasing.",
    summaries: ["The last assistant turn was regenerated."],
    total_usage: usageExample,
    memory: memoryReceiptExample,
    final_state: "committed",
  },
} as const;

export const editAndRegenerateSuccessResponseExample = {
  data: {
    ...respondDataExample,
    branch_id: "alt-branch",
    source_floor_id: "floor_11",
    source_message_id: "msg_21",
  },
} as const;

export const dryRunSuccessResponseExample = {
  data: {
    messages: [
      { role: "system", content: "Stay in character and keep the tone warm." },
      { role: "user", content: "Please continue the campfire scene." },
    ],
    token_estimate: 512,
    available_for_reply: 1536,
    memory_summary: "The party recently agreed to search the northern pass.",
    prompt_snapshot: {
      preset_id: "preset-1",
      preset_updated_at: 1710000000000,
      preset_version: 3,
      worldbook_id: "worldbook-1",
      worldbook_updated_at: 1710000001000,
      worldbook_version: 5,
      regex_profile_id: "regex-1",
      regex_profile_updated_at: 1710000002000,
      regex_profile_version: 2,
      worldbook_activated_entry_uids: [7],
      regex_pre_rule_names: ["trim_whitespace"],
      regex_post_rule_names: [],
      prompt_mode: "compat_strict",
      prompt_digest: "0d9bc89c6130435ab870f63d0a4d45f95b9764a4b91c91f8d1c2c5a1f7d4f20c",
      token_estimate: 512,
    },
    assembly: {
      mode: "preset",
      prompt_intent: "continue",
      assistant_prefill_applied: true,
      assistant_prefill_strategy: "assistant_message_fallback",
      preset_used: true,
      selected_prompt_order_character_id: 100000,
      ignored_prompt_order_character_ids: [200001],
      continue_nudge_applied: true,
      continue_nudge_text: "[Continue your last message without repeating its original content.]",
      names_behavior_applied: "always",
      trigger_filtered_entry_ids: ["quietPrompt"],
      in_chat_inserted_entry_ids: ["continueHint"],
      worldbook_hits: 1,
      regex_pre_rules: ["trim_whitespace"],
      regex_post_rules: [],
      memory_summary_injected: true,
      reserved_variable_collisions: [],
      unsupported_preset_fields: [],
      ignored_preset_fields: [],
      unresolved_preset_markers: [],
      preset_warnings: [
        "检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。",
      ],
      preprocessed_user_message: "Please continue the campfire scene.",
      worldbook_matches: [
        {
          uid: 7,
          comment: "Campfire Lore",
          content_preview: "The northern pass is watched by old sentries.",
          order: 100,
          source: {
            kind: "session_worldbook",
            worldbook_id: "worldbook-1",
            worldbook_name: "Campfire Worldbook",
          },
          insertion: {
            position: "before",
          },
          activation: {
            mode: "triggered",
            recursion_level: 0,
            first_match: {
              source_kind: "message",
              message_index_from_latest: 0,
              matched_key: "campfire",
              matched_key_scope: "primary",
              matched_key_type: "plain",
              char_start: 20,
              char_end: 28,
              excerpt: "Please continue the campfire scene.",
            },
          },
        },
      ],
    },
  },
} as const;

export const streamResponseExample = [
  "event: start",
  'data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main"}',
  "",
  "event: run",
  'data: {"floor_id":"floor_12","run_id":"run_12","run_type":"respond","status":"running","phase":"page_generating","public_phase":"generating","phase_seq":5,"attempt_no":1,"started_at":1735689720000,"updated_at":1735689720300,"completed_at":null,"pending_output":{"temp_id":"temp_12","attempt_no":1,"state":"streaming","text":"The firelight wavers...","started_at":1735689720100,"updated_at":1735689720300,"error":null},"verifier":null,"error":null}',
  "",
  "event: chunk",
  'data: {"chunk":"The firelight wavers..."}',
  "",
  "event: done",
  'data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main","generated_text":"The firelight wavers as the next part of the story begins.","summaries":["The group resumes the campfire planning scene."],"total_usage":{"prompt_tokens":320,"completion_tokens":128,"total_tokens":448},"memory":{"mode":"sync","status":"applied","job_id":null},"final_state":"committed"}',
].join("\n");

// ── JSON Schema constants ─────────────────────────────

export const sessionIdParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const turnConfigJsonSchema = {
  type: "object",
  properties: {
    enableTools: { type: "boolean" },
    enableDirector: { type: "boolean" },
    enableVerifier: { type: "boolean" },
    enableMemoryConsolidation: { type: "boolean" },
    toolMode: { type: "string", enum: ["inline", "standalone", "both"] },
    verifierFailStrategy: { type: "string", enum: ["warn", "block", "retry"] },
    maxRetries: { type: "integer", minimum: 0, maximum: 5 },
  },
  examples: [turnConfigExample],
  additionalProperties: false,
} as const;

export const generationParamsJsonSchema = {
  type: "object",
  properties: {
    temperature: { type: "number", minimum: 0, maximum: 2 },
    max_output_tokens: { type: "integer", minimum: 1 },
    top_p: { type: "number", minimum: 0, maximum: 1 },
    top_k: { type: "integer", minimum: 1 },
    frequency_penalty: { type: "number" },
    presence_penalty: { type: "number" },
    stop_sequences: {
      type: "array",
      items: { type: "string" },
    },
    stream: { type: "boolean" },
    reasoning_effort: { type: "string", enum: ["low", "medium", "high"] },
  },
  examples: [generationParamsExample],
  additionalProperties: false,
} as const;

export const editAndRegenerateBodyJsonSchema = {
  type: "object",
  required: ["content"],
  properties: {
    content: { type: "string", minLength: 1 },
    branch_id: { type: "string", minLength: 1 },
    config: turnConfigJsonSchema,
    generation_params: generationParamsJsonSchema,
  },
  examples: [editAndRegenerateBodyExample],
  additionalProperties: false,
} as const;

export const respondBodyJsonSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1 },
    prompt_intent: { type: "string", enum: ["normal", "continue", "impersonate", "swipe", "regenerate", "quiet"] },
    config: turnConfigJsonSchema,
    generation_params: generationParamsJsonSchema,
    branch_id: { type: "string", minLength: 1 },
    source_floor_id: { type: "string", minLength: 1 },
  },
  examples: [respondBodyExample],
  additionalProperties: false,
} as const;

export const dryRunBodyJsonSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1 },
    prompt_intent: { type: "string", enum: ["normal", "continue", "impersonate", "swipe", "regenerate", "quiet"] },
    debug_options: {
      type: "object",
      properties: {
        include_worldbook_matches: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  examples: [dryRunBodyExample],
  additionalProperties: false,
} as const;

export const regenerateBodyJsonSchema = {
  type: "object",
  properties: {
    config: turnConfigJsonSchema,
    generation_params: generationParamsJsonSchema,
  },
  examples: [regenerateBodyExample],
  additionalProperties: false,
} as const;

export const retryFloorBodyJsonSchema = {
  type: "object",
  properties: {
    config: turnConfigJsonSchema,
    generation_params: generationParamsJsonSchema,
    confirmed_execution_ids: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
  },
  examples: [regenerateBodyExample],
  additionalProperties: false,
} as const;

export const usageJsonSchema = {
  type: "object",
  required: ["prompt_tokens", "completion_tokens", "total_tokens"],
  properties: {
    prompt_tokens: { type: "integer", minimum: 0 },
    completion_tokens: { type: "integer", minimum: 0 },
    total_tokens: { type: "integer", minimum: 0 },
  },
  examples: [usageExample],
  additionalProperties: false,
} as const;

export const memoryReceiptJsonSchema = {
  type: "object",
  required: ["mode", "status", "job_id"],
  properties: {
    mode: { type: "string", enum: ["sync", "async"] },
    status: { type: "string", enum: ["applied", "queued"] },
    job_id: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  examples: [memoryReceiptExample],
  additionalProperties: false,
} as const;

export const respondDataJsonSchema = {
  type: "object",
  required: ["floor_id", "floor_no", "branch_id", "generated_text", "summaries", "total_usage", "final_state"],
  properties: {
    floor_id: { type: "string" },
    floor_no: { type: "integer", minimum: 0 },
    branch_id: { type: "string" },
    generated_text: { type: "string" },
    summaries: { type: "array", items: { type: "string" } },
    total_usage: usageJsonSchema,
    memory: memoryReceiptJsonSchema,
    final_state: { type: "string" },
  },
  examples: [respondDataExample],
  additionalProperties: false,
} as const;

export const editAndRegenerateDataJsonSchema = {
  ...respondDataJsonSchema,
  required: [...respondDataJsonSchema.required, "source_floor_id", "source_message_id"],
  properties: {
    ...respondDataJsonSchema.properties,
    source_floor_id: { type: "string" },
    source_message_id: { type: "string" },
  },
  examples: [editAndRegenerateSuccessResponseExample.data],
} as const;

export const editAndRegenerateSuccessResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: editAndRegenerateDataJsonSchema },
  examples: [editAndRegenerateSuccessResponseExample],
  additionalProperties: false,
} as const;

export const regenerateDataJsonSchema = {
  type: "object",
  required: ["floor_id", "floor_no", "previous_floor_id", "generated_text", "summaries", "total_usage", "final_state"],
  properties: {
    floor_id: { type: "string" },
    floor_no: { type: "integer", minimum: 0 },
    previous_floor_id: { type: "string" },
    generated_text: { type: "string" },
    summaries: { type: "array", items: { type: "string" } },
    total_usage: usageJsonSchema,
    memory: memoryReceiptJsonSchema,
    final_state: { type: "string" },
  },
  examples: [regenerateSuccessResponseExample.data],
  additionalProperties: false,
} as const;

const dryRunWorldbookFirstMatchJsonSchema = {
  type: "object",
  required: [
    "source_kind",
    "matched_key",
    "matched_key_scope",
    "matched_key_type",
    "char_start",
    "char_end",
    "excerpt",
  ],
  properties: {
    source_kind: {
      type: "string",
      enum: ["message", "persona_description", "character_description", "character_personality", "character_depth_prompt", "scenario", "creator_notes", "injection", "recursion_buffer"],
    },
    message_index_from_latest: { type: "integer", minimum: 0 },
    injection_index: { type: "integer", minimum: 0 },
    matched_key: { type: "string" },
    matched_key_scope: { type: "string", enum: ["primary", "secondary"] },
    matched_key_type: { type: "string", enum: ["plain", "regex"] },
    char_start: { type: "integer", minimum: 0 },
    char_end: { type: "integer", minimum: 0 },
    excerpt: { type: "string" },
  },
  additionalProperties: false,
} as const;

const dryRunWorldbookActivationJsonSchema = {
  type: "object",
  required: ["mode", "recursion_level", "first_match"],
  properties: {
    mode: { type: "string", enum: ["constant", "triggered"] },
    recursion_level: { type: "integer", minimum: 0 },
    first_match: { anyOf: [dryRunWorldbookFirstMatchJsonSchema, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

const dryRunWorldbookInsertionJsonSchema = {
  type: "object",
  required: ["position"],
  properties: {
    position: { type: "string", enum: ["before", "after", "at_depth", "outlet"] },
    depth: { type: "integer" },
    role: { type: "string", enum: ["system", "user", "assistant"] },
    outlet_name: { type: "string" },
  },
  additionalProperties: false,
} as const;

const dryRunWorldbookSourceJsonSchema = {
  type: "object",
  required: ["kind", "worldbook_id", "worldbook_name"],
  properties: {
    kind: { type: "string", enum: ["session_worldbook", "character_book"] },
    worldbook_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    worldbook_name: { type: "string" },
  },
  additionalProperties: false,
} as const;

const dryRunWorldbookMatchJsonSchema = {
  type: "object",
  required: ["uid", "comment", "content_preview", "order", "source", "insertion", "activation"],
  properties: {
    uid: { type: "integer" },
    comment: { type: "string" },
    content_preview: { type: "string" },
    order: { type: "integer" },
    source: dryRunWorldbookSourceJsonSchema,
    insertion: dryRunWorldbookInsertionJsonSchema,
    activation: dryRunWorldbookActivationJsonSchema,
  },
  additionalProperties: false,
} as const;

export const dryRunDataJsonSchema = {
  type: "object",
  required: [
    "messages",
    "token_estimate",
    "available_for_reply",
    "memory_summary",
    "prompt_snapshot",
    "assembly",
  ],
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["system", "user", "assistant"] },
          content: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    token_estimate: { type: "integer", minimum: 0 },
    available_for_reply: { type: "integer", minimum: 0 },
    memory_summary: { anyOf: [{ type: "string" }, { type: "null" }] },
    prompt_snapshot: {
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
        preset_version: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
        worldbook_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        worldbook_updated_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
        worldbook_version: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
        regex_profile_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        regex_profile_updated_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
        regex_profile_version: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
        worldbook_activated_entry_uids: { type: "array", items: { type: "integer" } },
        regex_pre_rule_names: { type: "array", items: { type: "string" } },
        regex_post_rule_names: { type: "array", items: { type: "string" } },
        prompt_mode: { type: "string", enum: ["compat_strict", "compat_plus", "native"] },
        prompt_digest: { type: "string" },
        token_estimate: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    assembly: {
      type: "object",
      required: [
        "mode",
        "preset_used",
        "assistant_prefill_applied",
        "assistant_prefill_strategy",
        "prompt_intent",
        "worldbook_hits",
        "regex_pre_rules",
        "regex_post_rules",
        "memory_summary_injected",
        "reserved_variable_collisions",
        "selected_prompt_order_character_id",
        "ignored_prompt_order_character_ids",
        "unsupported_preset_fields",
        "ignored_preset_fields",
        "unresolved_preset_markers",
        "preset_warnings",
        "continue_nudge_applied",
        "continue_nudge_text",
        "names_behavior_applied",
        "trigger_filtered_entry_ids",
        "in_chat_inserted_entry_ids",
        "preprocessed_user_message",
      ],
      properties: {
        mode: { type: "string", enum: ["preset", "fallback"] },
        prompt_intent: { type: "string", enum: ["normal", "continue", "impersonate", "swipe", "regenerate", "quiet"] },
        assistant_prefill_applied: { type: "boolean" },
        assistant_prefill_strategy: { type: "string", enum: ["provider_native", "assistant_message_fallback", "unsupported", "none"] },
        preset_used: { type: "boolean" },
        worldbook_hits: { type: "integer", minimum: 0 },
        selected_prompt_order_character_id: { anyOf: [{ type: "integer" }, { type: "null" }] },
        ignored_prompt_order_character_ids: { type: "array", items: { type: "integer" } },
        regex_pre_rules: { type: "array", items: { type: "string" } },
        regex_post_rules: { type: "array", items: { type: "string" } },
        memory_summary_injected: { type: "boolean" },
        reserved_variable_collisions: { type: "array", items: { type: "string", enum: ["char", "user"] } },
        unsupported_preset_fields: { type: "array", items: { type: "string" } },
        ignored_preset_fields: { type: "array", items: { type: "string" } },
        unresolved_preset_markers: { type: "array", items: { type: "string" } },
        preset_warnings: { type: "array", items: { type: "string" } },
        continue_nudge_applied: { type: "boolean" },
        continue_nudge_text: { anyOf: [{ type: "string" }, { type: "null" }] },
        names_behavior_applied: { type: "string", enum: ["off", "always"] },
        trigger_filtered_entry_ids: { type: "array", items: { type: "string" } },
        in_chat_inserted_entry_ids: { type: "array", items: { type: "string" } },
        preprocessed_user_message: { anyOf: [{ type: "string" }, { type: "null" }] },
        worldbook_matches: {
          type: "array",
          items: dryRunWorldbookMatchJsonSchema,
        },
      },
      additionalProperties: false,
    },
  },
  examples: [dryRunSuccessResponseExample.data],
  additionalProperties: false,
} as const;

export const respondSuccessResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: respondDataJsonSchema,
  },
  examples: [respondSuccessResponseExample],
  additionalProperties: false,
} as const;

export const regenerateSuccessResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: regenerateDataJsonSchema,
  },
  examples: [regenerateSuccessResponseExample],
  additionalProperties: false,
} as const;

export const dryRunSuccessResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: dryRunDataJsonSchema,
  },
  examples: [dryRunSuccessResponseExample],
  additionalProperties: false,
} as const;
