import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema } from "./schemas/common.js";
import { parseWithSchema, sendError } from "../lib/http";
import { getRequestAuthContext } from "../plugins/auth";
import type { LlmBindingGenerationParams } from "../lib/llm-params";
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

// ── Zod schemas for runtime validation ──

const instanceSlotSchema = z.enum(["*", "narrator", "director", "verifier", "memory"]);
const scopeSchema = z.enum(["global", "session"]);

const generationParamsSchema = z.object({
  max_context_tokens: z.number().int().min(1).optional(),
  max_output_tokens: z.number().int().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().min(0).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stream: z.boolean().optional(),
  timeout_ms: z.number().int().min(1).optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
}).strict();

const listQuerySchema = z.object({
  scope: scopeSchema.optional(),
  session_id: z.string().min(1).optional(),
});

const resolvedQuerySchema = z.object({
  session_id: z.string().min(1).optional(),
});

const slotParamSchema = z.object({
  slot: z.string().min(1),
});

const upsertBodySchema = z.object({
  scope: scopeSchema.default("global"),
  session_id: z.string().min(1).optional(),
  preset_id: z.string().min(1).nullable().optional(),
  enabled: z.boolean().default(true),
  params: generationParamsSchema.nullable().optional(),
}).refine(
  (data) => data.scope !== "session" || (data.session_id !== undefined && data.session_id !== ""),
  { message: "session_id is required when scope is 'session'", path: ["session_id"] }
);

const deleteQuerySchema = z.object({
  scope: scopeSchema.default("global"),
  session_id: z.string().min(1).optional(),
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

    const configs = await service.listConfigs(auth.accountId, scope, scopeId);
    return { data: configs.map(toApiConfig) };
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

    const slots = await service.resolveConfigs(auth.accountId, session_id);
    return {
      data: {
        session_id: session_id ?? null,
        slots: slots.map(toApiResolvedSlot),
      },
    };
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
      if (error instanceof LlmInstanceServiceError) {
        return sendServiceError(reply, error);
      }
      throw error;
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
    const { scope, session_id, preset_id, enabled, params } = bodyParsed.data;
    const scopeId = scope === "session" ? session_id! : "global";

    try {
      const config = await service.upsertConfig(
        auth.accountId,
        scope,
        scopeId,
        slotResult.data,
        {
          presetId: preset_id,
          enabled,
          params: fromApiParams(params),
        }
      );
      return { data: toApiConfig(config) };
    } catch (error) {
      if (error instanceof LlmInstanceServiceError) {
        return sendServiceError(reply, error);
      }
      throw error;
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
      if (error instanceof LlmInstanceServiceError) {
        return sendServiceError(reply, error);
      }
      throw error;
    }
  });
}

// ── Serialization helpers ──

type ApiGenerationParams = {
  max_context_tokens?: number;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  timeout_ms?: number;
  max_retries?: number;
  reasoning_effort?: string;
};

function toApiConfig(config: LlmInstanceConfigItem) {
  return {
    id: config.id,
    scope: config.scope,
    scope_id: config.scopeId,
    instance_slot: config.instanceSlot,
    preset_id: config.presetId,
    enabled: config.enabled,
    params: toApiParams(config.params),
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
    enabled: slot.enabled,
    params: toApiParams(slot.params),
  };
}

function toApiParams(params: LlmBindingGenerationParams | null): ApiGenerationParams | null {
  if (!params) return null;

  const mapped: ApiGenerationParams = {
    max_context_tokens: params.maxContextTokens,
    max_output_tokens: params.maxOutputTokens,
    temperature: params.temperature,
    top_p: params.topP,
    top_k: params.topK,
    frequency_penalty: params.frequencyPenalty,
    presence_penalty: params.presencePenalty,
    stream: params.stream,
    timeout_ms: params.timeoutMs,
    max_retries: params.maxRetries,
    reasoning_effort: params.reasoningEffort,
  };

  const compacted = Object.fromEntries(
    Object.entries(mapped).filter(([, v]) => v !== undefined)
  ) as ApiGenerationParams;

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
    stream: params.stream,
    timeoutMs: params.timeout_ms,
    maxRetries: params.max_retries,
    reasoningEffort: params.reasoning_effort,
  };
}

function sendServiceError(reply: FastifyReply, error: LlmInstanceServiceError) {
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
