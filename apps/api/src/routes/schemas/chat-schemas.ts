/**
 * Chat route JSON Schema & example constants.
 *
 * Extracted from chat.ts to reduce file size (F012).
 */

// ── Example constants ─────────────────────────────────

export const turnConfigExample = {
  enableDirector: true,
  enableVerifier: true,
  enableMemoryConsolidation: true,
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
  config: turnConfigExample,
  generation_params: generationParamsExample,
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

export const respondDataExample = {
  floor_id: "floor_12",
  floor_no: 12,
  branch_id: "main",
  generated_text: "The firelight wavers as the next part of the story begins.",
  summaries: ["The group resumes the campfire planning scene."],
  total_usage: usageExample,
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
      worldbook_activated_entry_uids: [7, 9],
      regex_pre_rule_names: ["trim_whitespace"],
      regex_post_rule_names: [],
      prompt_mode: "compat_strict",
      prompt_digest: "0d9bc89c6130435ab870f63d0a4d45f95b9764a4b91c91f8d1c2c5a1f7d4f20c",
      token_estimate: 512,
    },
    assembly: {
      mode: "preset",
      preset_used: true,
      worldbook_hits: 1,
      regex_pre_rules: ["trim_whitespace"],
      regex_post_rules: [],
      memory_summary_injected: true,
      preprocessed_user_message: "Please continue the campfire scene.",
    },
  },
} as const;

export const streamResponseExample = [
  "event: start",
  'data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main"}',
  "",
  "event: chunk",
  'data: {"chunk":"The firelight wavers..."}',
  "",
  "event: done",
  'data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main","generated_text":"The firelight wavers as the next part of the story begins.","summaries":["The group resumes the campfire planning scene."],"total_usage":{"prompt_tokens":320,"completion_tokens":128,"total_tokens":448},"final_state":"committed"}',
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
    enableDirector: { type: "boolean" },
    enableVerifier: { type: "boolean" },
    enableMemoryConsolidation: { type: "boolean" },
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
    config: turnConfigJsonSchema,
    generation_params: generationParamsJsonSchema,
    branch_id: { type: "string", minLength: 1 },
    source_floor_id: { type: "string", minLength: 1 },
  },
  examples: [respondBodyExample],
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
    final_state: { type: "string" },
  },
  examples: [regenerateSuccessResponseExample.data],
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
        "worldbook_hits",
        "regex_pre_rules",
        "regex_post_rules",
        "memory_summary_injected",
        "preprocessed_user_message",
      ],
      properties: {
        mode: { type: "string", enum: ["preset", "fallback"] },
        preset_used: { type: "boolean" },
        worldbook_hits: { type: "integer", minimum: 0 },
        regex_pre_rules: { type: "array", items: { type: "string" } },
        regex_post_rules: { type: "array", items: { type: "string" } },
        memory_summary_injected: { type: "boolean" },
        preprocessed_user_message: { anyOf: [{ type: "string" }, { type: "null" }] },
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
