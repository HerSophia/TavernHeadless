import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema } from "./schemas/common.js";
import { buildZodObjectSchema } from "./schemas/json-schema-zod.js";
import { parseWithSchema, sendError } from "../lib/http";
import { getRequestAuthContext } from "../plugins/auth";
import type { LlmBindingGenerationParams } from "../lib/llm-params";
import type { LlmInstanceCapabilities } from "../lib/llm-capabilities.js";
import { normalizeLlmInstanceCapabilities } from "../lib/llm-capabilities.js";
import type { RuntimeParamsResponse } from "../lib/llm-provider-discovery.js";
import { llmGenerationParamsJsonSchema } from "./schemas/llm-profiles-schemas.js";
import {
  instanceConfigListResponseJsonSchema,
  instanceConfigResponseJsonSchema,
  resolvedResponseJsonSchema,
  listQueryJsonSchema,
  resolvedQueryJsonSchema,
  slotParamsJsonSchema,
  upsertBodyJsonSchema,
  deleteQueryJsonSchema,
  instanceDeleteResponseJsonSchema,
} from "./schemas/llm-instances-schemas.js";
import {
  LlmInstanceService,
  LlmInstanceServiceError,
  type LlmInstanceConfigItem,
  type ResolvedInstanceSlot,
} from "../services/llm-instance-service";
import type { MutationRuntime } from "../services/runtime-mutation-types.js";
import { WorkspaceScopeServiceError } from "../services/workspace-scope-service.js";

// ── Zod schemas for runtime validation ──

const instanceSlotSchema = z.enum(["*", "narrator", "director", "verifier", "memory"]);
const scopeSchema = z.enum(["global", "session"]);

type ListQuery = {
  scope?: z.infer<typeof scopeSchema>;
  session_id?: string;
};

type ResolvedQuery = {
  session_id?: string;
};

type SlotParams = {
  slot: string;
};

type RuntimeCapabilitiesResponse = {
  supports_function_call?: boolean;
  supports_tool_choice?: boolean;
  supports_streaming_tool_call?: boolean;
  unsupported_generation_params?: string[];
};

const generationParamsSchema = buildZodObjectSchema<RuntimeParamsResponse>(llmGenerationParamsJsonSchema);

const capabilitiesSchema = z.object({
  supports_function_call: z.boolean().optional(),
  supports_tool_choice: z.boolean().optional(),
  supports_streaming_tool_call: z.boolean().optional(),
  unsupported_generation_params: z.array(z.string().min(1)).optional(),
}).strict();

const listQuerySchema = buildZodObjectSchema<ListQuery>(listQueryJsonSchema);

const resolvedQuerySchema = buildZodObjectSchema<ResolvedQuery>(resolvedQueryJsonSchema);

const slotParamSchema = buildZodObjectSchema<SlotParams>(slotParamsJsonSchema);

const upsertBodySchema = z.object({
  scope: scopeSchema.default("global"),
  session_id: z.string().min(1).optional(),
  preset_id: z.string().min(1).nullable().optional(),
  model_id_override: z.string().min(1).nullable().optional(),
  enabled: z.boolean().default(true),
  params: generationParamsSchema.nullable().optional(),
  capabilities: capabilitiesSchema.nullable().optional(),
}).refine(
  (data) => data.scope !== "session" || (data.session_id !== undefined && data.session_id !== ""),
  { message: "session_id is required when scope is 'session'", path: ["session_id"] }
);

const deleteQuerySchema = buildZodObjectSchema<{
  scope: z.infer<typeof scopeSchema>;
  session_id?: string;
}>(deleteQueryJsonSchema, {
  defaultValues: {
    scope: "global",
  },
});

// ── Route registration ──

export interface RegisterLlmInstanceRoutesOptions {
  mutationRuntime?: MutationRuntime;
}

export async function registerLlmInstanceRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: RegisterLlmInstanceRoutesOptions = {},
): Promise<void> {
  const service = new LlmInstanceService(connection.db, { mutationRuntime: options.mutationRuntime });

  // GET /llm-instances
  app.get("/llm-instances", {
    schema: {
      tags: ["llm-instances"],
      summary: "List LLM instance configs",
      operationId: "listLlmInstanceConfigs",
      querystring: listQueryJsonSchema,
      response: {
        200: instanceConfigListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(listQuerySchema, request.query, reply);
    if (!parsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { scope, session_id } = parsed.data;
    const scopeId = scope === "session" && session_id ? session_id : undefined;

    try {
      const configs = await service.listConfigs(auth.accountId, scope, scopeId);
      return { data: configs.map(toApiConfig) };
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  // GET /llm-instances/resolved — MUST be registered before /:slot
  app.get("/llm-instances/resolved", {
    schema: {
      tags: ["llm-instances"],
      summary: "Get resolved LLM instance configs for all slots",
      operationId: "getResolvedLlmInstanceConfigs",
      querystring: resolvedQueryJsonSchema,
      response: {
        200: resolvedResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(resolvedQuerySchema, request.query, reply);
    if (!parsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { session_id } = parsed.data;

    try {
      const slots = await service.resolveConfigs(auth.accountId, session_id);
      return {
        data: {
          session_id: session_id ?? null,
          slots: slots.map(toApiResolvedSlot),
        },
      };
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  // GET /llm-instances/:slot
  app.get<{ Params: { slot: string } }>("/llm-instances/:slot", {
    schema: {
      tags: ["llm-instances"],
      summary: "Get LLM instance configs for a specific slot",
      operationId: "getLlmInstanceConfigs",
      params: slotParamsJsonSchema,
      querystring: listQueryJsonSchema,
      response: {
        200: instanceConfigListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const slotParsed = parseWithSchema(slotParamSchema, request.params, reply);
    if (!slotParsed.ok) return;

    const slotResult = instanceSlotSchema.safeParse(slotParsed.data.slot);
    if (!slotResult.success) {
      return sendError(reply, 400, "invalid_slot", `Invalid slot: ${slotParsed.data.slot}. Must be one of: *, narrator, director, verifier, memory`);
    }

    const queryParsed = parseWithSchema(listQuerySchema, request.query, reply);
    if (!queryParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { scope, session_id } = queryParsed.data;
    const scopeId = scope === "session" && session_id ? session_id : undefined;

    try {
      const configs = await service.getConfigsBySlot(auth.accountId, slotResult.data, scope, scopeId);
      return { data: configs.map(toApiConfig) };
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  // PUT /llm-instances/:slot
  app.put<{ Params: { slot: string } }>("/llm-instances/:slot", {
    schema: {
      tags: ["llm-instances"],
      summary: "Create or update an LLM instance config for a slot",
      operationId: "upsertLlmInstanceConfig",
      params: slotParamsJsonSchema,
      body: upsertBodyJsonSchema,
      response: {
        200: instanceConfigResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const slotParsed = parseWithSchema(slotParamSchema, request.params, reply);
    if (!slotParsed.ok) return;

    const slotResult = instanceSlotSchema.safeParse(slotParsed.data.slot);
    if (!slotResult.success) {
      return sendError(reply, 400, "invalid_slot", `Invalid slot: ${slotParsed.data.slot}. Must be one of: *, narrator, director, verifier, memory`);
    }

    const bodyParsed = parseWithSchema(upsertBodySchema, request.body, reply);
    if (!bodyParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { scope, session_id, preset_id, model_id_override, enabled, params, capabilities } = bodyParsed.data;
    const scopeId = scope === "session" ? session_id! : "global";

    try {
      const config = await service.upsertConfig(
        auth.accountId,
        scope,
        scopeId,
        slotResult.data,
        {
          presetId: preset_id,
          ...(model_id_override !== undefined ? { modelIdOverride: model_id_override } : {}),
          enabled,
          params: fromApiParams(params),
          capabilities: fromApiCapabilities(capabilities),
        }
      );
      return { data: toApiConfig(config) };
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  // DELETE /llm-instances/:slot
  app.delete<{ Params: { slot: string } }>("/llm-instances/:slot", {
    schema: {
      tags: ["llm-instances"],
      summary: "Delete an LLM instance config for a slot",
      operationId: "deleteLlmInstanceConfig",
      params: slotParamsJsonSchema,
      querystring: deleteQueryJsonSchema,
      response: {
        200: instanceDeleteResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const slotParsed = parseWithSchema(slotParamSchema, request.params, reply);
    if (!slotParsed.ok) return;

    const slotResult = instanceSlotSchema.safeParse(slotParsed.data.slot);
    if (!slotResult.success) {
      return sendError(reply, 400, "invalid_slot", `Invalid slot: ${slotParsed.data.slot}. Must be one of: *, narrator, director, verifier, memory`);
    }

    const queryParsed = parseWithSchema(deleteQuerySchema, request.query, reply);
    if (!queryParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { scope, session_id } = queryParsed.data;

    if (scope === "session" && !session_id) {
      return sendError(reply, 400, "missing_session_id", "session_id is required when scope is 'session'");
    }

    const scopeId = scope === "session" ? session_id! : "global";

    try {
      await service.deleteConfig(auth.accountId, scope, scopeId, slotResult.data);
      return {
        data: {
          instance_slot: slotResult.data,
          scope,
          deleted: true,
        },
      };
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });
}

// ── Serialization helpers ──

function toApiConfig(config: LlmInstanceConfigItem) {
  return {
    id: config.id,
    scope: config.scope,
    scope_id: config.scopeId,
    instance_slot: config.instanceSlot,
    preset_id: config.presetId,
    model_id_override: config.modelIdOverride,
    enabled: config.enabled,
    params: toApiParams(config.params),
    capabilities: toApiCapabilities(config.capabilities),
    created_at: config.createdAt,
    updated_at: config.updatedAt,
  };
}

function toApiResolvedSlot(slot: ResolvedInstanceSlot) {
  return {
    slot: slot.slot,
    source: slot.source,
    scope: slot.scope,
    config_id: slot.configId,
    preset_id: slot.presetId,
    model_id_override: slot.modelIdOverride,
    enabled: slot.enabled,
    params: toApiParams(slot.params),
    capabilities: toApiCapabilities(slot.capabilities),
  };
}

function toApiParams(params: LlmBindingGenerationParams | null): RuntimeParamsResponse | null {
  if (!params) return null;

  const mapped: RuntimeParamsResponse = {
    max_context_tokens: params.maxContextTokens,
    max_output_tokens: params.maxOutputTokens,
    temperature: params.temperature,
    top_p: params.topP,
    top_k: params.topK,
    frequency_penalty: params.frequencyPenalty,
    presence_penalty: params.presencePenalty,
    stop_sequences: params.stopSequences,
    seed: params.seed,
    repetition_penalty: params.repetitionPenalty,
    min_p: params.minP,
    logit_bias: params.logitBias,
    response_format: params.responseFormat
      ? {
          type: params.responseFormat.type,
          ...(params.responseFormat.jsonSchema ? { json_schema: params.responseFormat.jsonSchema } : {}),
        }
      : params.responseFormat,
    stream: params.stream,
    timeout_ms: params.timeoutMs,
    max_retries: params.maxRetries,
    // profile/instance 的输入 schema仍限制 reasoning_effort 为 low/medium/high 三档，
    // 故持久化值不会出现 core 放宽后的自定义字符串，这里收窄回枚举是安全的。
    reasoning_effort: params.reasoningEffort as "low" | "medium" | "high" | null | undefined,
  };

  const compacted = Object.fromEntries(
    Object.entries(mapped).filter(([, v]) => v !== undefined)
  ) as RuntimeParamsResponse;

  return Object.keys(compacted).length > 0 ? compacted : null;
}

function fromApiParams(
  params: z.infer<typeof generationParamsSchema> | null | undefined
): LlmBindingGenerationParams | null | undefined {
  if (params === undefined) return undefined;
  if (params === null) return null;

  return {
    maxContextTokens: params.max_context_tokens,
    maxOutputTokens: params.max_output_tokens,
    temperature: params.temperature,
    topP: params.top_p,
    topK: params.top_k,
    frequencyPenalty: params.frequency_penalty,
    presencePenalty: params.presence_penalty,
    stopSequences: params.stop_sequences,
    seed: params.seed,
    repetitionPenalty: params.repetition_penalty,
    minP: params.min_p,
    logitBias: params.logit_bias,
    responseFormat: params.response_format
      ? {
          type: params.response_format.type,
          ...(params.response_format.json_schema ? { jsonSchema: params.response_format.json_schema } : {}),
        }
      : params.response_format,
    stream: params.stream,
    timeoutMs: params.timeout_ms,
    maxRetries: params.max_retries,
    reasoningEffort: params.reasoning_effort,
  };
}

function toApiCapabilities(capabilities: LlmInstanceCapabilities | null): RuntimeCapabilitiesResponse | null {
  if (!capabilities) {
    return null;
  }

  return {
    supports_function_call: capabilities.supportsFunctionCall,
    supports_tool_choice: capabilities.supportsToolChoice,
    supports_streaming_tool_call: capabilities.supportsStreamingToolCall,
    unsupported_generation_params: capabilities.unsupportedGenerationParams,
  };
}

function fromApiCapabilities(
  capabilities: z.infer<typeof capabilitiesSchema> | null | undefined,
): LlmInstanceCapabilities | null | undefined {
  if (capabilities === undefined) {
    return undefined;
  }
  if (capabilities === null) {
    return null;
  }

  return normalizeLlmInstanceCapabilities({
    supportsFunctionCall: capabilities.supports_function_call,
    supportsToolChoice: capabilities.supports_tool_choice,
    supportsStreamingToolCall: capabilities.supports_streaming_tool_call,
    unsupportedGenerationParams: capabilities.unsupported_generation_params,
  }) ?? null;
}

function sendServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof WorkspaceScopeServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }

  if (!(error instanceof LlmInstanceServiceError)) {
    throw error;
  }

  switch (error.code) {
    case "config_not_found":
      return sendError(reply, 404, error.code, error.message);
    case "invalid_params":
    case "invalid_slot":
    case "missing_session_id":
      return sendError(reply, 400, error.code, error.message);
    default:
      return sendError(reply, 500, "internal_error", error.message);
  }
}
