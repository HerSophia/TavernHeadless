import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { AccountMode } from "../accounts/constants.js";
import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { parseWithSchema, sendError } from "../lib/http";
import { buildZodObjectSchema } from "./schemas/json-schema-zod.js";
import { getRequestAuthContext } from "../plugins/auth";
import { assertSafeUrl, UrlGuardError } from "../lib/url-guard";
import {
  discoverModels,
  testProviderModelWithHello,
  LlmModelDiscoveryError,
  LlmModelTestError,
  type RuntimeParamsResponse,
  type RuntimeSlotResponse,
} from "../lib/llm-provider-discovery.js";
import {
  runtimeSlots,
  createBodyJsonSchema,
  profileResponseJsonSchema,
  profileListQueryJsonSchema,
  runtimeQueryJsonSchema,
  profileListResponseJsonSchema,
  updateBodyJsonSchema,
  deleteResponseJsonSchema,
  activateBodyJsonSchema,
  activateResponseJsonSchema,
  bindingSlotParamsJsonSchema,
  discoverModelsBodyJsonSchema,
  discoverModelsResponseJsonSchema,
  testModelBodyJsonSchema,
  testModelResponseJsonSchema,
  unbindQueryJsonSchema,
  unbindResponseJsonSchema,
  runtimeResponseJsonSchema,
  llmGenerationParamsJsonSchema,
} from "./schemas/llm-profiles-schemas.js";
import {
  LlmProfileService,
  LlmProfileServiceError,
  type LlmBindingGenerationParams,
  type LlmProfileListItem,
} from "../services/llm-profile-service";
import type { MutationRuntime } from "../services/runtime-mutation-types.js";
import { WorkspaceScopeServiceError } from "../services/workspace-scope-service.js";

const providerSchema = z.enum(["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"]);
const profileStatusSchema = z.enum(["active", "disabled", "deleted"]);
const instanceSlotSchema = z.enum(["*", "narrator", "director", "verifier", "memory"]);
const activateScopeSchema = z.enum(["global", "session"]);

type IdParams = {
  id: string;
};

type RuntimeQuery = {
  session_id?: string;
};

type BindingSlotParams = {
  slot: z.infer<typeof instanceSlotSchema>;
};

type CreateProfileBody = {
  preset_name: string;
  provider: z.infer<typeof providerSchema>;
  model_id: string;
  base_url?: string;
  api_key_name?: string;
  api_key: string;
};

type DiscoverModelsBody = {
  api_key: string;
  base_url?: string;
  provider: z.infer<typeof providerSchema>;
  allow_private_network?: boolean;
};

type TestModelBody = {
  api_key: string;
  base_url?: string;
  model_id: string;
  provider: z.infer<typeof providerSchema>;
  reasoning_effort?: RuntimeParamsResponse["reasoning_effort"];
  allow_private_network?: boolean;
};

const generationParamsSchema = buildZodObjectSchema<RuntimeParamsResponse>(llmGenerationParamsJsonSchema);

const runtimeQuerySchema = buildZodObjectSchema<RuntimeQuery>(runtimeQueryJsonSchema, {
  trimStringFields: ["session_id"],
});

const runtimeSourceSchema = z.enum(["env", "global_profile", "session_profile"]);
const runtimeScopeSchema = z.enum(["global", "session"]);

const idParamsSchema = buildZodObjectSchema<IdParams>(idParamsJsonSchema);

const listQuerySchema = buildZodObjectSchema<{
  include_deleted: boolean;
  status?: z.infer<typeof profileStatusSchema>;
}>(profileListQueryJsonSchema, {
  coerceBooleanFields: ["include_deleted"],
  defaultValues: {
    include_deleted: false,
  },
});

const createProfileSchema = buildZodObjectSchema<CreateProfileBody>(createBodyJsonSchema, {
  trimStringFields: [
    "preset_name",
    "model_id",
    "base_url",
    "api_key_name",
    "api_key",
  ],
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

const bindingSlotParamsSchema = buildZodObjectSchema<BindingSlotParams>(bindingSlotParamsJsonSchema);

const unbindBindingSchema = z
  .object({
    scope: activateScopeSchema.default("global"),
    session_id: z.string().trim().min(1).optional(),
  })
  .refine((value) => value.scope === "global" || Boolean(value.session_id), {
    message: "session_id is required when scope=session",
    path: ["session_id"],
  });

const discoverModelsSchema = buildZodObjectSchema<DiscoverModelsBody>(discoverModelsBodyJsonSchema, {
  trimStringFields: ["api_key", "base_url"],
});

const testModelSchema = buildZodObjectSchema<TestModelBody>(testModelBodyJsonSchema, {
  trimStringFields: ["api_key", "base_url", "model_id"],
});


export interface RegisterLlmProfileRoutesOptions {
  mutationRuntime?: MutationRuntime;
  accountMode?: AccountMode;
}

export async function registerLlmProfileRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: RegisterLlmProfileRoutesOptions = {},
): Promise<void> {
  const service = new LlmProfileService(connection.db, {
    mutationRuntime: options.mutationRuntime,
    accountMode: options.accountMode,
  });

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

      const createBaseUrlError = guardProfileBaseUrl(reply, parsed.data.base_url);
      if (createBaseUrlError) {
        return createBaseUrlError;
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
        querystring: profileListQueryJsonSchema,
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

      try {
        const profiles = await service.listProfiles({
          includeDeleted: parsed.data.include_deleted,
          accountId: auth.accountId,
        });

        const filtered = parsed.data.status ? profiles.filter((profile) => profile.status === parsed.data.status) : profiles;
        return reply.send({ data: filtered.map(toApiProfile) });
      } catch (error) {
        return sendServiceError(reply, error);
      }
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

      const discoverBaseUrlError = guardProfileBaseUrl(reply, body.data.base_url, {
        allowPrivateNetwork: body.data.allow_private_network || isPrivateBaseUrlAllowed(),
      });
      if (discoverBaseUrlError) {
        return discoverBaseUrlError;
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

      const testBaseUrlError = guardProfileBaseUrl(reply, body.data.base_url, {
        allowPrivateNetwork: body.data.allow_private_network || isPrivateBaseUrlAllowed(),
      });
      if (testBaseUrlError) {
        return testBaseUrlError;
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
      try {
        const profile = await service.getProfile(params.data.id, auth.accountId);
        if (!profile) {
          return sendError(reply, 404, "profile_not_found", `Profile not found: ${params.data.id}`);
        }

        return reply.send({ data: toApiProfile(profile) });
      } catch (error) {
        return sendServiceError(reply, error);
      }
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

      const updateBaseUrlError = guardProfileBaseUrl(reply, body.data.base_url);
      if (updateBaseUrlError) {
        return updateBaseUrlError;
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
        querystring: runtimeQueryJsonSchema,
        response: {
          200: runtimeResponseJsonSchema,
          400: errorResponseJsonSchema,
          500: errorResponseJsonSchema,
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

  app.delete(
    "/llm-profiles/bindings/:slot",
    {
      schema: {
        tags: ["llm-profiles"],
        summary: "Unbind LLM profile from a scope slot",
        operationId: "unbindLlmProfile",
        params: bindingSlotParamsJsonSchema,
        querystring: unbindQueryJsonSchema,
        response: {
          200: unbindResponseJsonSchema,
          400: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const params = parseWithSchema(bindingSlotParamsSchema, request.params, reply);
      if (!params.ok) {
        return;
      }

      const query = parseWithSchema(unbindBindingSchema, request.query, reply);
      if (!query.ok) {
        return;
      }

      const scopeId = query.data.scope === "global" ? "global" : query.data.session_id ?? "";

      try {
        const auth = getRequestAuthContext(request);
        await service.unbindProfile(query.data.scope, scopeId, params.data.slot, auth.accountId);
        return reply.send({
          data: {
            scope: query.data.scope,
            scope_id: scopeId,
            instance_slot: params.data.slot,
            unbound: true,
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
  if (error instanceof WorkspaceScopeServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }

  if (error instanceof LlmProfileServiceError) {
    if (error.code === "profile_not_found") {
      return sendError(reply, 404, error.code, error.message);
    }

    if (error.code === "binding_not_found" || error.code === "session_scope_not_found") {
      return sendError(reply, 404, error.code, error.message);
    }

    if (error.code === "profile_conflict" || error.code === "profile_in_use" || error.code === "profile_inactive") {
      return sendError(reply, 409, error.code, error.message);
    }

    if (error.code === "invalid_params") {
      return sendError(reply, 400, error.code, error.message);
    }

    if (error.code === "secret_invalid_format") {
      return sendError(reply, 500, error.code, error.message);
    }

    if (error.code === "secret_unavailable") {
      return sendError(reply, 503, error.code, error.message);
    }
  }

  throw error;
}

function isPrivateBaseUrlAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_BASE_URL === "true";
}

function guardProfileBaseUrl(
  reply: FastifyReply,
  baseUrl: string | null | undefined,
  options?: { allowPrivateNetwork?: boolean },
): FastifyReply | undefined {
  if (!baseUrl) {
    return undefined;
  }

  try {
    assertSafeUrl(baseUrl, {
      allowPrivateNetwork: options?.allowPrivateNetwork ?? isPrivateBaseUrlAllowed(),
    });
  } catch (error) {
    if (error instanceof UrlGuardError) {
      return sendError(reply, 400, error.code, error.message);
    }
    throw error;
  }

  return undefined;
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
