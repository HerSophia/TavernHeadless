/**
 * LLM Instance Config route JSON Schema & example constants.
 */

import { nullableLlmGenerationParamsJsonSchema } from "./llm-profiles-schemas.js";

// ── Slot enum ──

export const instanceSlotValues = ["*", "narrator", "director", "verifier", "memory"] as const;

// ── Example constants ──

const instanceConfigExample = {
  id: "ic_demo123",
  scope: "global",
  scope_id: "global",
  instance_slot: "narrator",
  preset_id: null,
  enabled: true,
  params: { temperature: 0.8, max_output_tokens: 1024 },
  created_at: 1735689600000,
  updated_at: 1735689660000,
};

const instanceConfigListResponseExample = {
  data: [instanceConfigExample],
};

const instanceConfigResponseExample = {
  data: instanceConfigExample,
};

const resolvedSlotExample = {
  slot: "narrator",
  source: "global_config",
  scope: "global",
  config_id: "ic_demo123",
  preset_id: null,
  enabled: true,
  params: { temperature: 0.8, max_output_tokens: 1024 },
};

const resolvedResponseExample = {
  data: {
    session_id: null,
    slots: [resolvedSlotExample],
  },
};

const upsertBodyExample = {
  scope: "global",
  preset_id: null,
  enabled: true,
  params: { temperature: 0.8, max_output_tokens: 1024 },
};

const deleteResponseExample = {
  data: {
    instance_slot: "narrator",
    scope: "global",
    deleted: true,
  },
};

// ── JSON Schemas ──

const instanceConfigJsonSchema = {
  type: "object",
  required: ["id", "scope", "scope_id", "instance_slot", "enabled", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: ["global", "session"] },
    scope_id: { type: "string" },
    instance_slot: { type: "string", enum: [...instanceSlotValues] },
    preset_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    enabled: { type: "boolean" },
    params: nullableLlmGenerationParamsJsonSchema,
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

export const instanceConfigListResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: instanceConfigJsonSchema,
    },
  },
  examples: [instanceConfigListResponseExample],
  additionalProperties: false,
} as const;

export const instanceConfigResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: instanceConfigJsonSchema,
  },
  examples: [instanceConfigResponseExample],
  additionalProperties: false,
} as const;

const resolvedSlotJsonSchema = {
  type: "object",
  required: ["slot", "source", "enabled"],
  properties: {
    slot: { type: "string", enum: [...instanceSlotValues] },
    source: { type: "string", enum: ["session_config", "global_config", "default"] },
    scope: { anyOf: [{ type: "string", enum: ["global", "session"] }, { type: "null" }] },
    config_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    preset_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    enabled: { type: "boolean" },
    params: nullableLlmGenerationParamsJsonSchema,
  },
  additionalProperties: false,
} as const;

export const resolvedResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["slots"],
      properties: {
        session_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        slots: {
          type: "array",
          items: resolvedSlotJsonSchema,
        },
      },
      additionalProperties: false,
    },
  },
  examples: [resolvedResponseExample],
  additionalProperties: false,
} as const;

export const listQueryJsonSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["global", "session"] },
    session_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const resolvedQueryJsonSchema = {
  type: "object",
  properties: {
    session_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const nullableInstanceParamsJsonSchema = nullableLlmGenerationParamsJsonSchema;

export const slotParamsJsonSchema = {
  type: "object",
  required: ["slot"],
  properties: {
    slot: {
      type: "string",
      minLength: 1,
      description: "Allowed values: *, narrator, director, verifier, memory.",
    },
  },
  additionalProperties: false,
} as const;

const upsertGlobalBodyJsonSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["global"] },
    session_id: { type: "string", minLength: 1 },
    preset_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    enabled: { type: "boolean" },
    params: nullableInstanceParamsJsonSchema,
  },
  additionalProperties: false,
} as const;

const upsertSessionBodyJsonSchema = {
  type: "object",
  required: ["scope", "session_id"],
  properties: {
    scope: { type: "string", enum: ["session"] },
    session_id: { type: "string", minLength: 1 },
    preset_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    enabled: { type: "boolean" },
    params: nullableInstanceParamsJsonSchema,
  },
  additionalProperties: false,
} as const;

export const upsertBodyJsonSchema = {
  oneOf: [upsertGlobalBodyJsonSchema, upsertSessionBodyJsonSchema],
  examples: [upsertBodyExample],
} as const;

export const deleteQueryJsonSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["global", "session"], default: "global" },
    session_id: {
      type: "string",
      minLength: 1,
      description: "Required when scope=session.",
    },
  },
  additionalProperties: false,
} as const;

export const instanceDeleteResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["instance_slot", "scope", "deleted"],
      properties: {
        instance_slot: { type: "string" },
        scope: { type: "string" },
        deleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  examples: [deleteResponseExample],
  additionalProperties: false,
} as const;
