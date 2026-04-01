import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import {
  SessionToolRegistryService,
  SessionToolRegistryServiceError,
  type SessionRuntimeToolCatalogSnapshot,
} from "../services/session-tool-registry-service.js";

const sessionIdParamsSchema = z.object({
  id: z.string().min(1),
});

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
    result_visibility: { type: "string", enum: ["immediate", "deferred_receipt"] },
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
      replay_safety: tool.replaySafety,
      result_visibility: tool.resultVisibility,
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
