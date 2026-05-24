import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { parseWithSchema, sendError } from "../../lib/http.js";
import { getRequestAuthContext } from "../../plugins/auth.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "../schemas/common.js";
import {
  SessionToolRegistryService,
  SessionToolRegistryServiceError,
  type SessionRuntimeToolCatalogSnapshot,
} from "../../services/tooling/session-tool-registry-service.js";
import {
  RUNTIME_METADATA_BASIS_VALUES,
  RUNTIME_METADATA_SCOPE_VALUES,
} from "../../services/tooling/shared/metadata-basis.js";

const sessionIdParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * runtime catalog metadata basis 枚举。
 *
 * 不是 trust score，只描述字段来源，避免把粗推断伪装成 tool-declared 真相。
 */
const runtimeMetadataBasisSchema = {
  anyOf: [
    {
      type: "string",
      enum: [...RUNTIME_METADATA_BASIS_VALUES],
    },
    { type: "null" },
  ],
} as const;

const runtimeMetadataScopeSchema = {
  type: "string",
  enum: [...RUNTIME_METADATA_SCOPE_VALUES],
} as const;

const runtimeMetadataBasisDetailEntryJsonSchema = {
  type: "object",
  required: ["basis", "scope"],
  properties: {
    basis: { type: "string", enum: [...RUNTIME_METADATA_BASIS_VALUES] },
    scope: runtimeMetadataScopeSchema,
  },
  additionalProperties: false,
} as const;

const runtimeMetadataBasisDetailJsonSchema = {
  type: "object",
  properties: {
    side_effect_level: runtimeMetadataBasisDetailEntryJsonSchema,
    allowed_slots: runtimeMetadataBasisDetailEntryJsonSchema,
    parameter_schema: runtimeMetadataBasisDetailEntryJsonSchema,
    replay_safety: runtimeMetadataBasisDetailEntryJsonSchema,
  },
  additionalProperties: false,
} as const;


const runtimeToolJsonSchema = {
  type: "object",
  required: [
    "name",
    "provider_id",
    "provider_type",
    "source",
    "side_effect_level",
    "allowed_slots",
    "availability",
    "replay_safety",
    "async_capability",
    "default_delivery_mode",
    "result_visibility",
  ],
  properties: {
    name: { type: "string" },
    provider_id: { type: "string" },
    provider_type: { type: "string", enum: ["builtin", "preset", "mcp"] },
    source: { type: "string", enum: ["builtin", "resource", "custom", "preset", "character", "mcp"] },
    side_effect_level: { type: "string", enum: ["none", "sandbox", "irreversible"] },
    async_capability: { type: "string", enum: ["inline_only", "deferred_ok"] },
    allowed_slots: { type: "array", items: { type: "string" } },
    availability: { type: "string", enum: ["available", "unavailable", "conflict"] },
    availability_reason: { anyOf: [{ type: "string" }, { type: "null" }] },
    default_delivery_mode: { type: "string", enum: ["inline", "async_job"] },
    replay_safety: { type: "string", enum: ["safe", "confirm_on_replay", "never_auto_replay", "uncertain"] },
    catalog_source: { anyOf: [{ type: "string", enum: ["live", "cached", "unavailable"] }, { type: "null" }] },
    exposure: {
      anyOf: [{
        type: "object",
        properties: {
          scope: { type: "string", enum: ["legacy", "project_binding"] },
          server_state: { type: "string", enum: ["enabled", "disabled"] },
          allowed_tools_mode: { type: "string", enum: ["all", "allow_list"] },
          allowed_tools: { type: "array", items: { type: "string" } },
        },
        required: ["scope", "server_state", "allowed_tools_mode", "allowed_tools"],
        additionalProperties: false,
      }, { type: "null" }],
    },
    result_visibility: { type: "string", enum: ["immediate", "deferred_receipt"] },
    side_effect_level_basis: runtimeMetadataBasisSchema,
    allowed_slots_basis: runtimeMetadataBasisSchema,
    parameter_schema_basis: runtimeMetadataBasisSchema,
    replay_safety_basis: runtimeMetadataBasisSchema,
    metadata_basis_detail: {
      anyOf: [runtimeMetadataBasisDetailJsonSchema, { type: "null" }],
    },
  },
  additionalProperties: false,
} as const;

const runtimeToolConflictJsonSchema = {
  type: "object",
  required: ["tool_name", "provider_ids", "reason"],
  properties: {
    tool_name: { type: "string" },
    provider_ids: { type: "array", items: { type: "string" } },
    reason: { type: "string", enum: ["name_conflict"] },
  },
  additionalProperties: false,
} as const;

const runtimeCatalogJsonSchema = {
  type: "object",
  required: ["session_id", "generated_at", "tools", "conflicts"],
  properties: {
    session_id: { type: "string" },
    generated_at: { type: "integer", minimum: 0 },
    tools: { type: "array", items: runtimeToolJsonSchema },
    conflicts: { type: "array", items: runtimeToolConflictJsonSchema },
  },
  additionalProperties: false,
} as const;

const runtimeCatalogResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: runtimeCatalogJsonSchema,
  },
  additionalProperties: false,
} as const;

export interface RegisterSessionRuntimeToolRoutesOptions {
  sessionToolRegistryService?: SessionToolRegistryService;
}

function formatCatalog(snapshot: SessionRuntimeToolCatalogSnapshot) {
  return {
    session_id: snapshot.sessionId,
    generated_at: snapshot.generatedAt,
    tools: snapshot.tools.map((tool) => ({
      name: tool.name,
      provider_id: tool.providerId,
      provider_type: tool.providerType,
      source: tool.source,
      side_effect_level: tool.sideEffectLevel,
      async_capability: tool.asyncCapability,
      allowed_slots: tool.allowedSlots,
      availability: tool.availability,
      availability_reason: tool.availabilityReason ?? null,
      default_delivery_mode: tool.defaultDeliveryMode,
      catalog_source: tool.catalogSource ?? null,
      exposure: tool.exposure
        ? {
            scope: tool.exposure.scope,
            server_state: tool.exposure.serverState,
            allowed_tools_mode: tool.exposure.allowedToolsMode,
            allowed_tools: tool.exposure.allowedTools,
          }
        : null,
      replay_safety: tool.replaySafety,
      result_visibility: tool.resultVisibility,
      side_effect_level_basis: tool.sideEffectLevelBasis ?? null,
      allowed_slots_basis: tool.allowedSlotsBasis ?? null,
      parameter_schema_basis: tool.parameterSchemaBasis ?? null,
      replay_safety_basis: tool.replaySafetyBasis ?? null,
      metadata_basis_detail: tool.metadataBasisDetail
        ? {
            ...(tool.metadataBasisDetail.sideEffectLevel
              ? { side_effect_level: tool.metadataBasisDetail.sideEffectLevel }
              : {}),
            ...(tool.metadataBasisDetail.allowedSlots
              ? { allowed_slots: tool.metadataBasisDetail.allowedSlots }
              : {}),
            ...(tool.metadataBasisDetail.parameterSchema
              ? { parameter_schema: tool.metadataBasisDetail.parameterSchema }
              : {}),
            ...(tool.metadataBasisDetail.replaySafety
              ? { replay_safety: tool.metadataBasisDetail.replaySafety }
              : {}),
          }
        : null,
    })),
    conflicts: snapshot.conflicts.map((conflict) => ({
      tool_name: conflict.toolName,
      provider_ids: conflict.providerIds,
      reason: conflict.reason,
    })),
  };
}

export async function registerSessionRuntimeToolRoutes(
  app: FastifyInstance,
  options: RegisterSessionRuntimeToolRoutesOptions = {},
): Promise<void> {
  app.get("/sessions/:id/tools/runtime", {
    schema: {
      tags: ["sessions", "tools"],
      summary: "Get session runtime tool catalog",
      description: [
        "Returns the session-level runtime tool catalog snapshot for the session.",
        "It does not expose future run/node/step permission overlays, which only participate when specific executions are prepared.",
      ].join(" "),
      operationId: "getSessionRuntimeToolCatalog",
      params: idParamsJsonSchema,
      response: {
        200: runtimeCatalogResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const service = options.sessionToolRegistryService;
    if (!service) {
      return sendError(
        reply,
        503,
        "feature_unavailable",
        "Session runtime tool catalog is unavailable because orchestration is disabled",
      );
    }

    const auth = getRequestAuthContext(request);

    try {
      const catalog = await service.getRuntimeCatalog(parsedParams.data.id, auth.accountId);
      return reply.send({ data: formatCatalog(catalog) });
    } catch (error) {
      if (error instanceof SessionToolRegistryServiceError) {
        if (error.code === "session_not_found") {
          return sendError(reply, 404, "not_found", error.message);
        }

        if (error.code === "tool_catalog_conflict") {
          return sendError(reply, 409, error.code, error.message, error.details);
        }
      }

      throw error;
    }
  });
}
