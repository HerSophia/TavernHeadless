/**
 * LLM Profile route JSON Schema & example constants.
 *
 * Extracted from llm-profiles.ts to reduce file size (F011).
 */

// ── Runtime slot names (shared by JSON schemas and route handler) ──

export const runtimeSlots = ["*", "narrator", "director", "verifier", "memory"] as const;

// ── Example constants ─────────────────────────────────

export const llmGenerationParamsExample = {
  max_output_tokens: 512,
  temperature: 0.7,
  max_retries: 2,
  reasoning_effort: "low",
} as const;

export const llmProfileCreateBodyExample = {
  preset_name: "OpenAI Narrator",
  provider: "openai",
  model_id: "gpt-4o-mini",
  api_key_name: "OPENAI_API_KEY",
  api_key: "sk-demo-key",
} as const;

export const llmProfileUpdateBodyExample = {
  preset_name: "OpenAI Narrator v2",
  status: "active",
  api_key_name: "OPENAI_API_KEY",
} as const;

export const llmProfileExample = {
  id: "lp_narrator",
  preset_name: "OpenAI Narrator",
  provider: "openai",
  model_id: "gpt-4o-mini",
  base_url: null,
  api_key_name: "OPENAI_API_KEY",
  api_key_masked: "sk-***-key",
  status: "active",
  last_used_at: 1735689660000,
  created_at: 1735689600000,
  updated_at: 1735689660000,
} as const;

export const llmProfileResponseExample = {
  data: llmProfileExample,
} as const;

export const llmProfileListResponseExample = {
  data: [llmProfileExample],
} as const;

export const discoverModelsBodyExample = {
  provider: "openai",
  api_key: "sk-demo-key",
} as const;

export const discoverModelsResponseExample = {
  data: [
    { id: "gpt-4o-mini", label: "gpt-4o-mini" },
    { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  ],
} as const;

export const testModelBodyExample = {
  provider: "openai",
  model_id: "gpt-4o-mini",
  api_key: "sk-demo-key",
  reasoning_effort: "low",
} as const;

export const testModelResponseExample = {
  data: {
    request_text: "Hello",
    response_text: "Hello! How can I help you today?",
  },
} as const;

export const activateBodyExample = {
  scope: "session",
  session_id: "sess_demo",
  instance_slot: "director",
  params: llmGenerationParamsExample,
} as const;

export const activateResponseExample = {
  data: {
    profile_id: "lp_narrator",
    scope: "session",
    scope_id: "sess_demo",
    instance_slot: "director",
    params: llmGenerationParamsExample,
    activated: true,
  },
} as const;

export const unbindResponseExample = {
  data: {
    scope: "session",
    scope_id: "sess_demo",
    instance_slot: "director",
    unbound: true,
  },
} as const;

export const runtimeSlotExample = {
  slot: "director",
  source: "session_profile",
  scope: "session",
  profile_id: "lp_narrator",
  params: llmGenerationParamsExample,
  preset_name: "OpenAI Narrator",
  provider: "openai",
  model_id: "gpt-4o-mini",
} as const;

export const runtimeResponseExample = {
  data: {
    session_id: "sess_demo",
    slots: [runtimeSlotExample],
  },
} as const;

export const llmProfileDeleteResponseExample = {
  data: {
    id: "lp_narrator",
    deleted: true,
  },
} as const;

// ── JSON Schema constants ─────────────────────────────

export const profileJsonSchema = {
  type: "object",
  required: [
    "id",
    "preset_name",
    "provider",
    "model_id",
    "base_url",
    "api_key_name",
    "api_key_masked",
    "status",
    "last_used_at",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    preset_name: { type: "string" },
    provider: { type: "string", enum: ["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"] },
    model_id: { type: "string" },
    base_url: { anyOf: [{ type: "string" }, { type: "null" }] },
    api_key_name: { anyOf: [{ type: "string" }, { type: "null" }] },
    api_key_masked: { type: "string" },
    status: { type: "string", enum: ["active", "disabled", "deleted"] },
    last_used_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  examples: [llmProfileExample],
  additionalProperties: false,
} as const;

export const profileResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: profileJsonSchema,
  },
  examples: [llmProfileResponseExample],
  additionalProperties: false,
} as const;

export const profileListResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: profileJsonSchema,
    },
  },
  examples: [llmProfileListResponseExample],
  additionalProperties: false,
} as const;

export const createBodyJsonSchema = {
  type: "object",
  required: ["preset_name", "provider", "model_id", "api_key"],
  properties: {
    preset_name: { type: "string", minLength: 1, maxLength: 120 },
    provider: { type: "string", enum: ["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"] },
    model_id: { type: "string", minLength: 1, maxLength: 200 },
    base_url: { type: "string", minLength: 1, maxLength: 500 },
    api_key_name: { type: "string", minLength: 1, maxLength: 120 },
    api_key: { type: "string", minLength: 1, maxLength: 2048 },
  },
  examples: [llmProfileCreateBodyExample],
  additionalProperties: false,
} as const;

export const updateBodyJsonSchema = {
  type: "object",
  properties: {
    preset_name: { type: "string", minLength: 1, maxLength: 120 },
    provider: { type: "string", enum: ["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"] },
    model_id: { type: "string", minLength: 1, maxLength: 200 },
    base_url: { anyOf: [{ type: "string", minLength: 1, maxLength: 500 }, { type: "null" }] },
    api_key_name: { anyOf: [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }] },
    api_key: { type: "string", minLength: 1, maxLength: 2048 },
    status: { type: "string", enum: ["active", "disabled"] },
  },
  examples: [llmProfileUpdateBodyExample],
  additionalProperties: false,
} as const;

export const generationParamsJsonSchemaProperties = {
  max_context_tokens: { type: "integer", minimum: 1 },
  max_output_tokens: { type: "integer", minimum: 1 },
  temperature: { type: "number", minimum: 0, maximum: 2 },
  top_p: { type: "number", minimum: 0, maximum: 1 },
  top_k: { type: "integer", minimum: 0 },
  frequency_penalty: { type: "number", minimum: -2, maximum: 2 },
  presence_penalty: { type: "number", minimum: -2, maximum: 2 },
  stream: { type: "boolean" },
  timeout_ms: { type: "integer", minimum: 1 },
  max_retries: { type: "integer", minimum: 0, maximum: 10 },
  reasoning_effort: { type: "string", enum: ["low", "medium", "high"] },
} as const;

export const activateBodyJsonSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["global", "session"], default: "global" },
    session_id: { type: "string", minLength: 1 },
    params: {
      anyOf: [
        {
          type: "object",
          properties: generationParamsJsonSchemaProperties,
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    instance_slot: { type: "string", enum: ["*", "narrator", "director", "verifier", "memory"], default: "*" },
  },
  examples: [activateBodyExample],
  additionalProperties: false,
} as const;

export const bindingSlotParamsJsonSchema = {
  type: "object",
  required: ["slot"],
  properties: {
    slot: { type: "string", enum: [...runtimeSlots] },
  },
  additionalProperties: false,
} as const;

export const unbindQueryJsonSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["global", "session"], default: "global" },
    session_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const discoverModelsBodyJsonSchema = {
  type: "object",
  required: ["api_key", "provider"],
  properties: {
    api_key: { type: "string", minLength: 1, maxLength: 2048 },
    base_url: { type: "string", minLength: 1, maxLength: 500 },
    provider: { type: "string", enum: ["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"] },
    allow_private_network: { type: "boolean" },
  },
  examples: [discoverModelsBodyExample],
  additionalProperties: false,
} as const;

export const testModelBodyJsonSchema = {
  type: "object",
  required: ["api_key", "model_id", "provider"],
  properties: {
    api_key: { type: "string", minLength: 1, maxLength: 2048 },
    base_url: { type: "string", minLength: 1, maxLength: 500 },
    model_id: { type: "string", minLength: 1, maxLength: 200 },
    provider: { type: "string", enum: ["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"] },
    reasoning_effort: { type: "string", enum: ["low", "medium", "high"] },
    allow_private_network: { type: "boolean" },
  },
  examples: [testModelBodyExample],
  additionalProperties: false,
} as const;

const discoveredModelJsonSchema = {
  type: "object",
  required: ["id", "label"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
  },
  additionalProperties: false,
} as const;

export const discoverModelsResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: discoveredModelJsonSchema,
    },
  },
  examples: [discoverModelsResponseExample],
  additionalProperties: false,
} as const;

export const testModelResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["request_text", "response_text"],
      properties: {
        request_text: { type: "string" },
        response_text: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  examples: [testModelResponseExample],
  additionalProperties: false,
} as const;

export const activateResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["profile_id", "scope", "scope_id", "instance_slot", "params", "activated"],
      properties: {
        profile_id: { type: "string" },
        scope: { type: "string", enum: ["global", "session"] },
        scope_id: { type: "string" },
        instance_slot: { type: "string" },
        params: {
          anyOf: [
            {
              type: "object",
              properties: generationParamsJsonSchemaProperties,
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
        activated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  examples: [activateResponseExample],
  additionalProperties: false,
} as const;

export const unbindResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["scope", "scope_id", "instance_slot", "unbound"],
      properties: {
        scope: { type: "string", enum: ["global", "session"] },
        scope_id: { type: "string" },
        instance_slot: { type: "string", enum: [...runtimeSlots] },
        unbound: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  examples: [unbindResponseExample],
  additionalProperties: false,
} as const;

export const deleteResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["id", "deleted"],
      properties: {
        id: { type: "string" },
        deleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  examples: [llmProfileDeleteResponseExample],
  additionalProperties: false,
} as const;

const runtimeParamsJsonSchema = {
  type: "object",
  properties: generationParamsJsonSchemaProperties,
  additionalProperties: false,
} as const;

const runtimeSlotJsonSchema = {
  type: "object",
  required: ["model_id", "params", "preset_name", "profile_id", "provider", "scope", "slot", "source"],
  properties: {
    slot: { type: "string", enum: [...runtimeSlots] },
    source: { type: "string", enum: ["env", "global_profile", "session_profile"] },
    scope: { anyOf: [{ type: "string", enum: ["global", "session"] }, { type: "null" }] },
    profile_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    params: { anyOf: [runtimeParamsJsonSchema, { type: "null" }] },
    preset_name: { anyOf: [{ type: "string" }, { type: "null" }] },
    provider: { type: "string" },
    model_id: { type: "string" },
  },
  examples: [runtimeSlotExample],
  additionalProperties: false,
} as const;

export const runtimeResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["session_id", "slots"],
      properties: {
        session_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        slots: {
          type: "array",
          items: runtimeSlotJsonSchema,
        },
      },
      additionalProperties: false,
    },
  },
  examples: [runtimeResponseExample],
  additionalProperties: false,
} as const;
