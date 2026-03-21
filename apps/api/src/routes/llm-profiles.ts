import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { parseWithSchema, sendError } from "../lib/http";
import { getRequestAuthContext } from "../plugins/auth";
import {
  LlmProfileService,
  LlmProfileServiceError,
  type LlmBindingGenerationParams,
  type LlmProfileListItem,
} from "../services/llm-profile-service";

const providerSchema = z.enum(["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"]);
const profileStatusSchema = z.enum(["active", "disabled", "deleted"]);
const instanceSlotSchema = z.enum(["*", "narrator", "director", "verifier", "memory"]);
const activateScopeSchema = z.enum(["global", "session"]);
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
});

const runtimeQuerySchema = z.object({
  session_id: z.string().trim().min(1).optional(),
});

const runtimeSourceSchema = z.enum(["env", "global_profile", "session_profile"]);
const runtimeScopeSchema = z.enum(["global", "session"]);
const runtimeSlots = ["*", "narrator", "director", "verifier", "memory"] as const;

const idParamsSchema = z.object({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  include_deleted: z.coerce.boolean().optional().default(false),
  status: profileStatusSchema.optional(),
});

const createProfileSchema = z.object({
  preset_name: z.string().trim().min(1).max(120),
  provider: providerSchema,
  model_id: z.string().trim().min(1).max(200),
  base_url: z.string().trim().min(1).max(500).optional(),
  api_key_name: z.string().trim().min(1).max(120).optional(),
  api_key: z.string().trim().min(1).max(2048),
});

const updateProfileSchema = z
  .object({
    preset_name: z.string().trim().min(1).max(120).optional(),
    provider: providerSchema.optional(),
    model_id: z.string().trim().min(1).max(200).optional(),
    base_url: z.string().trim().min(1).max(500).nullable().optional(),
    api_key_name: z.string().trim().min(1).max(120).nullable().optional(),
    api_key: z.string().trim().min(1).max(2048).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const activateProfileSchema = z
  .object({
    scope: activateScopeSchema.default("global"),
    session_id: z.string().trim().min(1).optional(),
    instance_slot: instanceSlotSchema.default("*"),
    params: generationParamsSchema.nullable().optional(),
  })
  .refine((value) => value.scope === "global" || Boolean(value.session_id), {
    message: "session_id is required when scope=session",
    path: ["session_id"],
  });

const discoverModelsSchema = z.object({
  api_key: z.string().trim().min(1).max(2048),
  base_url: z.string().trim().min(1).max(500).optional(),
  provider: providerSchema,
});

const testModelSchema = z.object({
  api_key: z.string().trim().min(1).max(2048),
  base_url: z.string().trim().min(1).max(500).optional(),
  model_id: z.string().trim().min(1).max(200),
  provider: providerSchema,
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
});

const llmGenerationParamsExample = {
  max_output_tokens: 512,
  temperature: 0.7,
  max_retries: 2,
  reasoning_effort: "low",
} as const;

const llmProfileCreateBodyExample = {
  preset_name: "OpenAI Narrator",
  provider: "openai",
  model_id: "gpt-4o-mini",
  api_key_name: "OPENAI_API_KEY",
  api_key: "sk-demo-key",
} as const;

const llmProfileUpdateBodyExample = {
  preset_name: "OpenAI Narrator v2",
  status: "active",
  api_key_name: "OPENAI_API_KEY",
} as const;

const llmProfileExample = {
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

const llmProfileResponseExample = {
  data: llmProfileExample,
} as const;

const llmProfileListResponseExample = {
  data: [llmProfileExample],
} as const;

const discoverModelsBodyExample = {
  provider: "openai",
  api_key: "sk-demo-key",
} as const;

const discoverModelsResponseExample = {
  data: [
    { id: "gpt-4o-mini", label: "gpt-4o-mini" },
    { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  ],
} as const;

const testModelBodyExample = {
  provider: "openai",
  model_id: "gpt-4o-mini",
  api_key: "sk-demo-key",
  reasoning_effort: "low",
} as const;

const testModelResponseExample = {
  data: {
    request_text: "Hello",
    response_text: "Hello! How can I help you today?",
  },
} as const;

const activateBodyExample = {
  scope: "session",
  session_id: "sess_demo",
  instance_slot: "director",
  params: llmGenerationParamsExample,
} as const;

const activateResponseExample = {
  data: {
    profile_id: "lp_narrator",
    scope: "session",
    scope_id: "sess_demo",
    instance_slot: "director",
    params: llmGenerationParamsExample,
    activated: true,
  },
} as const;

const runtimeSlotExample = {
  slot: "director",
  source: "session_profile",
  scope: "session",
  profile_id: "lp_narrator",
  params: llmGenerationParamsExample,
  preset_name: "OpenAI Narrator",
  provider: "openai",
  model_id: "gpt-4o-mini",
} as const;

const runtimeResponseExample = {
  data: {
    session_id: "sess_demo",
    slots: [runtimeSlotExample],
  },
} as const;

const llmProfileDeleteResponseExample = {
  data: {
    id: "lp_narrator",
    deleted: true,
  },
} as const;

const idParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const errorResponseJsonSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
      },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
} as const;

const profileJsonSchema = {
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

const profileResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: profileJsonSchema,
  },
  examples: [llmProfileResponseExample],
  additionalProperties: false,
} as const;

const profileListResponseJsonSchema = {
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

const createBodyJsonSchema = {
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

const updateBodyJsonSchema = {
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

const activateBodyJsonSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["global", "session"], default: "global" },
    session_id: { type: "string", minLength: 1 },
    params: {
      anyOf: [
        {
          type: "object",
          properties: {
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
          },
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

const discoverModelsBodyJsonSchema = {
  type: "object",
  required: ["api_key", "provider"],
  properties: {
    api_key: { type: "string", minLength: 1, maxLength: 2048 },
    base_url: { type: "string", minLength: 1, maxLength: 500 },
    provider: { type: "string", enum: ["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"] },
  },
  examples: [discoverModelsBodyExample],
  additionalProperties: false,
} as const;

const testModelBodyJsonSchema = {
  type: "object",
  required: ["api_key", "model_id", "provider"],
  properties: {
    api_key: { type: "string", minLength: 1, maxLength: 2048 },
    base_url: { type: "string", minLength: 1, maxLength: 500 },
    model_id: { type: "string", minLength: 1, maxLength: 200 },
    provider: { type: "string", enum: ["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"] },
    reasoning_effort: { type: "string", enum: ["low", "medium", "high"] },
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

const discoverModelsResponseJsonSchema = {
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

const testModelResponseJsonSchema = {
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

const activateResponseJsonSchema = {
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
              properties: {
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
              },
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

const deleteResponseJsonSchema = {
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
  properties: {
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
  },
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

const runtimeResponseJsonSchema = {
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

type RuntimeParamsResponse = {
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
  reasoning_effort?: "low" | "medium" | "high";
};

type RuntimeSlotResponse = {
  model_id: string;
  params: RuntimeParamsResponse | null;
  preset_name: string | null;
  profile_id: string | null;
  provider: string;
  scope: z.infer<typeof runtimeScopeSchema> | null;
  slot: z.infer<typeof instanceSlotSchema>;
  source: z.infer<typeof runtimeSourceSchema>;
};

type DiscoveredModelResponse = {
  id: string;
  label: string;
};

type TestedModelResponse = {
  request_text: string;
  response_text: string;
};

class LlmModelDiscoveryError extends Error {
  readonly code: "model_discovery_failed" | "model_discovery_invalid_response";
  readonly statusCode: number;

  constructor(
    code: "model_discovery_failed" | "model_discovery_invalid_response",
    message: string,
    statusCode = 502,
  ) {
    super(message);
    this.name = "LlmModelDiscoveryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

class LlmModelTestError extends Error {
  readonly code: "model_test_failed" | "model_test_invalid_response";
  readonly statusCode: number;
  readonly upstreamStatus?: number;

  constructor(
    code: "model_test_failed" | "model_test_invalid_response",
    message: string,
    statusCode = 502,
    upstreamStatus?: number,
  ) {
    super(message);
    this.name = "LlmModelTestError";
    this.code = code;
    this.statusCode = statusCode;
    this.upstreamStatus = upstreamStatus;
  }
}

export async function registerLlmProfileRoutes(app: FastifyInstance, connection: DatabaseConnection): Promise<void> {
  const service = new LlmProfileService(connection.db);

  app.post(
    "/llm-profiles",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "Create LLM profile",
        operationId: "createLlmProfile",
        body: createBodyJsonSchema,
        response: {
          201: profileResponseJsonSchema,
          400: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          503: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseWithSchema(createProfileSchema, request.body, reply);
      if (!parsed.ok) {
        return;
      }

      try {
        const auth = getRequestAuthContext(request);
        const profile = await service.createProfile({
          presetName: parsed.data.preset_name,
          provider: parsed.data.provider,
          modelId: parsed.data.model_id,
          baseUrl: parsed.data.base_url,
          apiKeyName: parsed.data.api_key_name,
          apiKey: parsed.data.api_key,
        }, auth.accountId);

        return reply.code(201).send({ data: toApiProfile(profile) });
      } catch (error) {
        return sendServiceError(reply, error);
      }
    }
  );

  app.get(
    "/llm-profiles",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "List LLM profiles",
        operationId: "listLlmProfiles",
        querystring: {
          type: "object",
          properties: {
            include_deleted: { type: "boolean", default: false },
            status: { type: "string", enum: ["active", "disabled", "deleted"] },
          },
          additionalProperties: false,
        },
        response: {
          200: profileListResponseJsonSchema,
          400: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseWithSchema(listQuerySchema, request.query, reply);
      if (!parsed.ok) {
        return;
      }

      const auth = getRequestAuthContext(request);

      const profiles = await service.listProfiles({
        includeDeleted: parsed.data.include_deleted,
        accountId: auth.accountId,
      });

      const filtered = parsed.data.status ? profiles.filter((profile) => profile.status === parsed.data.status) : profiles;
      return reply.send({ data: filtered.map(toApiProfile) });
    }
  );

  app.post(
    "/llm-profiles/models/discover",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "Discover provider model list",
        operationId: "discoverLlmProfileModels",
        body: discoverModelsBodyJsonSchema,
        response: {
          200: discoverModelsResponseJsonSchema,
          400: errorResponseJsonSchema,
          502: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const body = parseWithSchema(discoverModelsSchema, request.body, reply);
      if (!body.ok) {
        return;
      }

      try {
        const models = await discoverModels({
          apiKey: body.data.api_key,
          baseUrl: body.data.base_url,
          provider: body.data.provider,
        });

        return reply.send({ data: models });
      } catch (error) {
        if (error instanceof LlmModelDiscoveryError) {
          return sendError(reply, error.statusCode, error.code, error.message);
        }

        throw error;
      }
    }
  );

  app.post(
    "/llm-profiles/models/test",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "Send a Hello probe to provider model",
        operationId: "testLlmProfileModel",
        body: testModelBodyJsonSchema,
        response: {
          200: testModelResponseJsonSchema,
          400: errorResponseJsonSchema,
          502: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const body = parseWithSchema(testModelSchema, request.body, reply);
      if (!body.ok) {
        return;
      }

      try {
        const tested = await testProviderModelWithHello({
          apiKey: body.data.api_key,
          baseUrl: body.data.base_url,
          modelId: body.data.model_id,
          provider: body.data.provider,
          reasoningEffort: body.data.reasoning_effort,
        });

        return reply.send({ data: tested });
      } catch (error) {
        if (error instanceof LlmModelTestError) {
          return sendError(reply, error.statusCode, error.code, error.message);
        }

        throw error;
      }
    }
  );

  app.get(
    "/llm-profiles/:id",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "Get LLM profile by id",
        operationId: "getLlmProfile",
        params: idParamsJsonSchema,
        response: {
          200: profileResponseJsonSchema,
          400: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const params = parseWithSchema(idParamsSchema, request.params, reply);
      if (!params.ok) {
        return;
      }

      const auth = getRequestAuthContext(request);
      const profile = await service.getProfile(params.data.id, auth.accountId);
      if (!profile) {
        return sendError(reply, 404, "profile_not_found", `Profile not found: ${params.data.id}`);
      }

      return reply.send({ data: toApiProfile(profile) });
    }
  );

  app.patch(
    "/llm-profiles/:id",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "Update LLM profile",
        operationId: "updateLlmProfile",
        params: idParamsJsonSchema,
        body: updateBodyJsonSchema,
        response: {
          200: profileResponseJsonSchema,
          400: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          503: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const params = parseWithSchema(idParamsSchema, request.params, reply);
      if (!params.ok) {
        return;
      }

      const body = parseWithSchema(updateProfileSchema, request.body, reply);
      if (!body.ok) {
        return;
      }

      try {
        const auth = getRequestAuthContext(request);
        const profile = await service.updateProfile(params.data.id, {
          presetName: body.data.preset_name,
          provider: body.data.provider,
          modelId: body.data.model_id,
          baseUrl: body.data.base_url,
          apiKeyName: body.data.api_key_name,
          apiKey: body.data.api_key,
          status: body.data.status,
        }, auth.accountId);

        return reply.send({ data: toApiProfile(profile) });
      } catch (error) {
        return sendServiceError(reply, error);
      }
    }
  );

  app.delete(
    "/llm-profiles/:id",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "Delete LLM profile",
        operationId: "deleteLlmProfile",
        params: idParamsJsonSchema,
        response: {
          200: deleteResponseJsonSchema,
          400: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const params = parseWithSchema(idParamsSchema, request.params, reply);
      if (!params.ok) {
        return;
      }

      try {
        const auth = getRequestAuthContext(request);
        await service.deleteProfile(params.data.id, auth.accountId);
        return reply.send({
          data: {
            id: params.data.id,
            deleted: true,
          },
        });
      } catch (error) {
        return sendServiceError(reply, error);
      }
    }
  );

  app.get(
    "/llm-profiles/runtime",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "Get runtime LLM info for all instance slots",
        operationId: "getLlmRuntimeProfiles",
        querystring: {
          type: "object",
          properties: {
            session_id: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
        response: {
          200: runtimeResponseJsonSchema,
          400: errorResponseJsonSchema,
          503: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const query = parseWithSchema(runtimeQuerySchema, request.query, reply);
      if (!query.ok) {
        return;
      }

      try {
        const auth = getRequestAuthContext(request);
        const resolvedBySlot = await service.resolveActiveProfiles(query.data.session_id, auth.accountId);

        const fallbackProvider = process.env.LLM_PROVIDER ?? "openai-compatible";
        const fallbackDefaultModel = process.env.LLM_MODEL ?? "gpt-4o-mini";
        const fallbackBySlot: Record<z.infer<typeof instanceSlotSchema>, string> = {
          "*": fallbackDefaultModel,
          narrator: fallbackDefaultModel,
          director: process.env.LLM_DIRECTOR_MODEL ?? fallbackDefaultModel,
          verifier: process.env.LLM_VERIFIER_MODEL ?? fallbackDefaultModel,
          memory: process.env.LLM_MEMORY_MODEL ?? fallbackDefaultModel,
        };

        const slots: RuntimeSlotResponse[] = runtimeSlots.map((slot) => {
          const resolved = resolvedBySlot[slot];
          if (!resolved) {
            return buildEnvRuntimeSlot(slot, fallbackProvider, fallbackBySlot[slot]);
          }
          return toProfileRuntimeSlot(slot, resolved);
        });

        return reply.send({ data: { session_id: query.data.session_id ?? null, slots } });
      } catch (error) {
        return sendServiceError(reply, error);
      }
    }
  );

  app.post(
    "/llm-profiles/:id/activate",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "Activate LLM profile",
        operationId: "activateLlmProfile",
        params: idParamsJsonSchema,
        body: activateBodyJsonSchema,
        response: {
          200: activateResponseJsonSchema,
          400: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const params = parseWithSchema(idParamsSchema, request.params, reply);
      if (!params.ok) {
        return;
      }

      const body = parseWithSchema(activateProfileSchema, request.body, reply);
      if (!body.ok) {
        return;
      }

      const scopeId = body.data.scope === "global" ? "global" : body.data.session_id ?? "";
      const instanceSlot = body.data.instance_slot;
      const bindingParams = fromApiGenerationParams(body.data.params);

      try {
        const auth = getRequestAuthContext(request);
        await service.activateProfile(body.data.scope, scopeId, params.data.id, instanceSlot, bindingParams, auth.accountId);
        return reply.send({
          data: {
            profile_id: params.data.id,
            scope: body.data.scope,
            scope_id: scopeId,
            instance_slot: instanceSlot,
            params: toApiGenerationParams(bindingParams),
            activated: true,
          },
        });
      } catch (error) {
        return sendServiceError(reply, error);
      }
    }
  );
}

function toApiProfile(profile: LlmProfileListItem) {
  return {
    id: profile.id,
    preset_name: profile.presetName,
    provider: profile.provider,
    model_id: profile.modelId,
    base_url: profile.baseUrl,
    api_key_name: profile.apiKeyName,
    api_key_masked: profile.apiKeyMasked,
    status: profile.status,
    last_used_at: profile.lastUsedAt,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

function sendServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof LlmProfileServiceError) {
    if (error.code === "profile_not_found") {
      return sendError(reply, 404, error.code, error.message);
    }

    if (error.code === "profile_conflict" || error.code === "profile_in_use" || error.code === "profile_inactive") {
      return sendError(reply, 409, error.code, error.message);
    }

    if (error.code === "invalid_params") {
      return sendError(reply, 400, error.code, error.message);
    }

    if (error.code === "secret_unavailable") {
      return sendError(reply, 503, error.code, error.message);
    }
  }

  throw error;
}

function fromApiGenerationParams(
  params: z.infer<typeof generationParamsSchema> | null | undefined,
): LlmBindingGenerationParams | null | undefined {
  if (params === undefined) {
    return undefined;
  }
  if (params === null) {
    return null;
  }

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

function toApiGenerationParams(
  params: LlmBindingGenerationParams | null | undefined,
): RuntimeParamsResponse | null {
  if (!params) {
    return null;
  }

  const mapped: RuntimeParamsResponse = {
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
    Object.entries(mapped).filter(([, value]) => value !== undefined),
  ) as RuntimeParamsResponse;
  return Object.keys(compacted).length > 0 ? compacted : null;
}

function toProfileRuntimeSlot(
  slot: z.infer<typeof instanceSlotSchema>,
  resolved: {
    source: "global" | "session";
    profileId: string;
    presetName: string;
    provider: string;
    modelId: string;
    params: LlmBindingGenerationParams;
  }
): RuntimeSlotResponse {
  return {
    slot,
    source: resolved.source === "session" ? "session_profile" : "global_profile",
    scope: resolved.source,
    profile_id: resolved.profileId,
    params: toApiGenerationParams(resolved.params),
    preset_name: resolved.presetName,
    provider: resolved.provider,
    model_id: resolved.modelId,
  };
}

function buildEnvRuntimeSlot(slot: z.infer<typeof instanceSlotSchema>, provider: string, modelId: string): RuntimeSlotResponse {
  return {
    slot,
    source: "env",
    scope: null,
    profile_id: null,
    params: null,
    preset_name: null,
    provider,
    model_id: modelId,
  };
}

const PROVIDER_DEFAULT_BASE_URLS: Record<z.infer<typeof providerSchema>, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  xai: "https://api.x.ai/v1",
  "openai-compatible": process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
};

type HelloProbeStrategy =
  | { kind: "provider-native" }
  | { kind: "chat-completions"; stream: boolean }
  | { kind: "responses"; stream: boolean };

function buildProviderHelloProbeStrategies(provider: z.infer<typeof providerSchema>): HelloProbeStrategy[] {
  if (!isOpenAICompatibleProvider(provider)) {
    return [{ kind: "provider-native" }];
  }

  return [
    { kind: "chat-completions", stream: false },
    { kind: "chat-completions", stream: true },
    { kind: "responses", stream: false },
    { kind: "responses", stream: true },
  ];
}

async function discoverModels(input: {
  apiKey: string;
  baseUrl?: string;
  provider: z.infer<typeof providerSchema>;
}): Promise<DiscoveredModelResponse[]> {
  const request = buildProviderModelRequest(input);

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LlmModelDiscoveryError("model_discovery_failed", "Model discovery request failed");
  }

  if (!response.ok) {
    throw new LlmModelDiscoveryError(
      "model_discovery_failed",
      `Model discovery request failed with status ${response.status}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LlmModelDiscoveryError("model_discovery_invalid_response", "Model discovery response is not valid JSON");
  }

  return parseDiscoveredModels(payload);
}

function buildProviderModelRequest(input: {
  apiKey: string;
  baseUrl?: string;
  provider: z.infer<typeof providerSchema>;
}): { headers: Record<string, string>; url: string } {
  if (input.provider === "anthropic") {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS.anthropic);
    return {
      url: buildProviderUrl(baseUrl, "models"),
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
    };
  }

  if (input.provider === "google") {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS.google);
    const requestUrl = new URL(buildProviderUrl(baseUrl, "models"));
    requestUrl.searchParams.set("key", input.apiKey);
    return {
      url: requestUrl.toString(),
      headers: {
        "x-goog-api-key": input.apiKey,
      },
    };
  }

  const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[input.provider];
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? defaultBaseUrl);
  return {
    url: buildProviderUrl(baseUrl, "models"),
    headers: {
      authorization: `Bearer ${input.apiKey}`,
    },
  };
}

async function testProviderModelWithHello(input: {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  provider: z.infer<typeof providerSchema>;
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<TestedModelResponse> {
  const strategies = buildProviderHelloProbeStrategies(input.provider);
  let lastError: LlmModelTestError | null = null;

  for (let index = 0; index < strategies.length; index += 1) {
    const strategy = strategies[index]!;
    const attempt = await attemptProviderHelloProbe(input, strategy);
    if (attempt.ok) {
      return attempt.value;
    }

    lastError = attempt.error;
    const hasNextStrategy = index < strategies.length - 1;
    if (!hasNextStrategy || !shouldRetryModelTestWithFallback(input.provider, attempt.error)) {
      throw attempt.error;
    }
  }

  throw lastError ?? new LlmModelTestError("model_test_failed", "Model test request failed");
}

async function attemptProviderHelloProbe(
  input: {
    apiKey: string;
    baseUrl?: string;
    modelId: string;
    provider: z.infer<typeof providerSchema>;
    reasoningEffort?: "low" | "medium" | "high";
  },
  strategy: HelloProbeStrategy,
): Promise<{ ok: true; value: TestedModelResponse } | { ok: false; error: LlmModelTestError }> {
  try {
    return {
      ok: true,
      value: await executeProviderHelloProbe(input, strategy),
    };
  } catch (error) {
    if (error instanceof LlmModelTestError) {
      return {
        ok: false,
        error,
      };
    }

    throw error;
  }
}

async function executeProviderHelloProbe(
  input: {
    apiKey: string;
    baseUrl?: string;
    modelId: string;
    provider: z.infer<typeof providerSchema>;
    reasoningEffort?: "low" | "medium" | "high";
  },
  strategy: HelloProbeStrategy,
): Promise<TestedModelResponse> {
  const request = buildProviderHelloRequest(input, strategy);
  const streamRequested = strategy.kind !== "provider-native" && strategy.stream;

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LlmModelTestError("model_test_failed", "Model test request failed");
  }

  if (!response.ok) {
    throw new LlmModelTestError(
      "model_test_failed",
      `Model test request failed with status ${response.status}`,
      502,
      response.status,
    );
  }

  const contentType = response.headers.get("content-type");
  let rawText: string;
  try {
    rawText = await response.text();
  } catch {
    throw new LlmModelTestError("model_test_invalid_response", "Model test response body could not be read");
  }

  const responseText = parseTestedModelResponseBody(input.provider, rawText, contentType, streamRequested);
  return {
    request_text: "Hello",
    response_text: responseText,
  };
}

function shouldRetryModelTestWithFallback(
  provider: z.infer<typeof providerSchema>,
  error: LlmModelTestError,
): boolean {
  if (!isOpenAICompatibleProvider(provider)) {
    return false;
  }

  if (error.code === "model_test_invalid_response") {
    return true;
  }

  if (error.code !== "model_test_failed") {
    return false;
  }

  if (error.upstreamStatus === undefined) {
    return false;
  }

  return error.upstreamStatus === 400
    || error.upstreamStatus === 405
    || error.upstreamStatus === 415
    || error.upstreamStatus === 422
    || error.upstreamStatus >= 500;
}

function isOpenAICompatibleProvider(provider: z.infer<typeof providerSchema>): boolean {
  return provider === "openai"
    || provider === "deepseek"
    || provider === "xai"
    || provider === "openai-compatible";
}

function buildProviderHelloRequest(input: {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  provider: z.infer<typeof providerSchema>;
  reasoningEffort?: "low" | "medium" | "high";
}, strategy: HelloProbeStrategy): { body: Record<string, unknown>; headers: Record<string, string>; url: string } {
  if (input.provider === "anthropic") {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS.anthropic);
    return {
      url: buildProviderUrl(baseUrl, "messages"),
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: input.modelId,
        max_tokens: 64,
        messages: [{ role: "user", content: "Hello" }],
      },
    };
  }

  if (input.provider === "google") {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS.google);
    const normalizedModelId = input.modelId.replace(/^models\//, "");
    const requestUrl = new URL(buildProviderUrl(baseUrl, `models/${normalizedModelId}:generateContent`));
    requestUrl.searchParams.set("key", input.apiKey);
    return {
      url: requestUrl.toString(),
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: {
        contents: [
          {
            role: "user",
            parts: [{ text: "Hello" }],
          },
        ],
      },
    };
  }

  const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[input.provider];
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? defaultBaseUrl);

  if (strategy.kind === "responses") {
    return {
      url: buildProviderUrl(baseUrl, "responses"),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: {
        model: input.modelId,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Hello" }],
          },
        ],
        max_output_tokens: 64,
        ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        ...(strategy.stream ? { stream: true } : {}),
      },
    };
  }

  return {
    url: buildProviderUrl(baseUrl, "chat/completions"),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`,
    },
    body: {
      model: input.modelId,
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 64,
      temperature: 0,
      ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
      ...(strategy.kind === "chat-completions" && strategy.stream ? { stream: true } : {}),
    },
  };
}

function parseTestedModelResponseBody(
  provider: z.infer<typeof providerSchema>,
  rawText: string,
  contentType: string | null,
  streamRequested: boolean,
): string {
  const shouldTryStream = streamRequested || Boolean(contentType?.includes("text/event-stream"));
  if (shouldTryStream) {
    const streamedText = parseStreamedTestedModelResponse(provider, rawText);
    if (streamedText) {
      return streamedText;
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new LlmModelTestError("model_test_invalid_response", "Model test response is not valid JSON");
  }

  return parseTestedModelResponse(provider, payload);
}

function parseStreamedTestedModelResponse(
  provider: z.infer<typeof providerSchema>,
  rawText: string,
): string | null {
  if (!isOpenAICompatibleProvider(provider)) {
    return null;
  }

  return extractOpenAICompatibleStreamText(rawText);
}

function extractOpenAICompatibleStreamText(rawText: string): string | null {
  const chunks: string[] = [];

  for (const payloadText of extractSseDataPayloads(rawText)) {
    if (payloadText === "[DONE]") {
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      continue;
    }

    if (!payload || typeof payload !== "object") {
      continue;
    }

    const chunkText = extractOpenAICompatibleStreamChunk(payload as Record<string, unknown>);
    if (chunkText) {
      chunks.push(chunkText);
    }
  }

  const text = chunks.join("").trim();
  return text || null;
}

function extractSseDataPayloads(rawText: string): string[] {
  const payloads: string[] = [];
  let current: string[] = [];

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length === 0) {
      if (current.length > 0) {
        payloads.push(current.join("\n"));
        current = [];
      }
      continue;
    }

    if (line.startsWith("data:")) {
      current.push(line.slice(5).trimStart());
    }
  }

  if (current.length > 0) {
    payloads.push(current.join("\n"));
  }

  return payloads;
}

function parseTestedModelResponse(provider: z.infer<typeof providerSchema>, payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new LlmModelTestError("model_test_invalid_response", "Model test response payload is invalid");
  }

  const record = payload as Record<string, unknown>;
  if (provider === "anthropic") {
    const text = extractAnthropicText(record);
    if (!text) {
      throw new LlmModelTestError("model_test_invalid_response", "Model test response missing anthropic text content");
    }

    return text;
  }

  if (provider === "google") {
    const text = extractGoogleText(record);
    if (!text) {
      throw new LlmModelTestError("model_test_invalid_response", "Model test response missing google text content");
    }

    return text;
  }

  const text = extractOpenAICompatibleText(record);
  if (!text) {
    throw new LlmModelTestError("model_test_invalid_response", "Model test response missing completion content");
  }

  return text;
}

function extractOpenAICompatibleText(payload: Record<string, unknown>): string | null {
  if (Array.isArray(payload.choices) && payload.choices.length > 0) {
    const first = payload.choices[0];
    if (!first || typeof first !== "object") {
      return null;
    }

    const message = (first as Record<string, unknown>).message;
    if (!message || typeof message !== "object") {
      return null;
    }

    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string") {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }

          const value = (part as Record<string, unknown>).text;
          return typeof value === "string" ? value : "";
        })
        .join("")
        .trim();

      return text || null;
    }
  }

  const outputText = extractResponseOutputText(payload);
  if (outputText) {
    return outputText;
  }

  return null;
}

function extractOpenAICompatibleStreamChunk(payload: Record<string, unknown>): string {
  if (typeof payload.delta === "string") {
    return payload.delta;
  }

  if (Array.isArray(payload.choices)) {
    return payload.choices
      .map((choice) => {
        if (!choice || typeof choice !== "object") {
          return "";
        }

        const record = choice as Record<string, unknown>;
        const delta = record.delta;
        if (delta && typeof delta === "object") {
          const deltaText = extractTextContent((delta as Record<string, unknown>).content);
          if (deltaText) {
            return deltaText;
          }
        }

        const message = record.message;
        if (message && typeof message === "object") {
          const messageText = extractTextContent((message as Record<string, unknown>).content);
          if (messageText) {
            return messageText;
          }
        }

        return typeof record.text === "string" ? record.text : "";
      })
      .join("");
  }

  const outputText = extractResponseOutputText(payload);
  return outputText ?? "";
}

function extractResponseOutputText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") {
    const outputText = payload.output_text.trim();
    return outputText || null;
  }

  if (!Array.isArray(payload.output)) {
    return null;
  }

  const text = payload.output
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      return extractTextContent((item as Record<string, unknown>).content) ?? "";
    })
    .join("")
    .trim();

  return text || null;
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") {
        return record.text;
      }

      return typeof record.delta === "string" ? record.delta : "";
    })
    .join("");

  return text || null;
}

function extractAnthropicText(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.content)) {
    return null;
  }

  const text = payload.content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const entry = part as Record<string, unknown>;
      return typeof entry.text === "string" ? entry.text : "";
    })
    .join("")
    .trim();

  return text || null;
}

function extractGoogleText(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    return null;
  }

  const first = payload.candidates[0];
  if (!first || typeof first !== "object") {
    return null;
  }

  const content = (first as Record<string, unknown>).content;
  if (!content || typeof content !== "object") {
    return null;
  }

  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const entry = part as Record<string, unknown>;
      return typeof entry.text === "string" ? entry.text : "";
    })
    .join("")
    .trim();

  return text || null;
}

function parseDiscoveredModels(payload: unknown): DiscoveredModelResponse[] {
  if (!payload || typeof payload !== "object") {
    throw new LlmModelDiscoveryError("model_discovery_invalid_response", "Model discovery response payload is invalid");
  }

  const rowList = extractModelRows(payload as Record<string, unknown>);
  const models = rowList
    .map((row) => toDiscoveredModel(row))
    .filter((row): row is DiscoveredModelResponse => row !== null);

  const unique = new Map<string, DiscoveredModelResponse>();
  for (const model of models) {
    if (!unique.has(model.id)) {
      unique.set(model.id, model);
    }
  }

  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function extractModelRows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(payload.data)) {
    return payload.data.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  }

  if (Array.isArray(payload.models)) {
    return payload.models.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  }

  throw new LlmModelDiscoveryError("model_discovery_invalid_response", "Model discovery response does not contain model list");
}

function toDiscoveredModel(row: Record<string, unknown>): DiscoveredModelResponse | null {
  const rawId =
    typeof row.id === "string"
      ? row.id
      : typeof row.name === "string"
        ? row.name
        : null;

  if (!rawId) {
    return null;
  }

  const id = rawId.replace(/^models\//, "").trim();
  if (!id) {
    return null;
  }

  const rawLabel =
    typeof row.display_name === "string"
      ? row.display_name
      : typeof row.displayName === "string"
        ? row.displayName
        : typeof row.name === "string"
          ? row.name
          : typeof row.id === "string"
            ? row.id
            : id;

  return {
    id,
    label: rawLabel.replace(/^models\//, ""),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildProviderUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), baseUrl).toString();
}
