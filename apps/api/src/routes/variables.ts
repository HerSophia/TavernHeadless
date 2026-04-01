import type { CoreEventBus } from "@tavern/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { buildListMeta, listQuerySchemaBase } from "../lib/pagination";
import { parseWithSchema, sendError } from "../lib/http";
import { getRequestAuthContext } from "../plugins/auth.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import {
  VariableService,
  type VariableRecord,
  type VariableLayerSnapshot,
  type ResolvedVariableRecord,
  type ResolvedVariablesSnapshot,
} from "../services/variable-service.js";
import { VariableServiceError } from "../services/variable-service-errors.js";
import type { MutationRuntime } from "../services/runtime-mutation-types.js";

const variableScopeSchema = z.enum(["global", "chat", "floor", "page"]);

const variableParamsSchema = z.object({
  id: z.string().min(1),
});

const listVariablesQuerySchema = listQuerySchemaBase.extend({
  scope: variableScopeSchema.optional(),
  scope_id: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  sort_by: z.enum(["updated_at", "key"]).default("updated_at"),
});

const upsertVariableSchema = z.object({
  scope: variableScopeSchema,
  scope_id: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown(),
});

const batchUpsertVariablesSchema = z.object({
  items: z.array(upsertVariableSchema).min(1).max(100),
}).superRefine((value, ctx) => {
  const seen = new Map<string, number>();

  value.items.forEach((item, index) => {
    const identity = buildVariableIdentity(item);
    const firstIndex = seen.get(identity);

    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index],
        message: `Duplicate variable target also appears at items.${firstIndex}`,
      });
      return;
    }

    seen.set(identity, index);
  });
});

const resolveVariablesQuerySchema = z.object({
  session_id: z.string().min(1),
  floor_id: z.string().min(1).optional(),
  page_id: z.string().min(1).optional(),
  include_layers: z.coerce.boolean().optional().default(false),
});

const upsertVariableBodyExample = {
  scope: "chat",
  scope_id: "session-a",
  key: "mood",
  value: { score: 20 },
} as const;

const variableExample = {
  id: "var_mood",
  scope: "chat",
  scope_id: "session-a",
  key: "mood",
  value: { score: 20 },
  updated_at: 1735689720000,
} as const;

const variableResponseExample = {
  data: variableExample,
} as const;

const variableListResponseExample = {
  data: [variableExample],
  meta: {
    total: 1,
    limit: 10,
    offset: 0,
    has_more: false,
    sort_by: "updated_at",
    sort_order: "desc",
  },
} as const;

const deleteVariableResponseExample = {
  data: { id: "var_mood", deleted: true },
} as const;

const batchUpsertVariablesBodyExample = {
  items: [
    upsertVariableBodyExample,
    {
      scope: "chat",
      scope_id: "session-a",
      key: "topic",
      value: "campfire",
    },
  ],
} as const;

const batchUpsertVariablesResponseExample = {
  data: {
    results: [
      {
        index: 0,
        action: "updated",
        data: variableExample,
      },
      {
        index: 1,
        action: "created",
        data: {
          id: "var_topic",
          scope: "chat",
          scope_id: "session-a",
          key: "topic",
          value: "campfire",
          updated_at: 1735689720000,
        },
      },
    ],
    meta: {
      total: 2,
      created: 1,
      updated: 1,
    },
  },
} as const;

const resolveVariablesResponseExample = {
  data: {
    context: {
      account_id: "default-admin",
      session_id: "session-a",
      floor_id: "floor-a",
      page_id: "page-a",
      global_scope_id: "global",
    },
    resolved: [
      {
        key: "mood",
        value: "tense",
        source_scope: "floor",
        source_scope_id: "floor-a",
        updated_at: 1735689720000,
      },
    ],
    layers: {
      global: {
        scope: "global",
        scope_id: "global",
        items: [
          {
            id: "var_global_theme",
            scope: "global",
            scope_id: "global",
            key: "theme",
            value: "midnight",
            updated_at: 1735689700000,
          },
        ],
      },
      chat: {
        scope: "chat",
        scope_id: "session-a",
        items: [variableExample],
      },
    },
  },
} as const;

const listVariablesQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["updated_at", "key"] },
    scope: { type: "string", enum: ["global", "chat", "floor", "page"] },
    scope_id: { type: "string", minLength: 1 },
    key: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const resolveVariablesQueryJsonSchema = {
  type: "object",
  required: ["session_id"],
  properties: {
    session_id: { type: "string", minLength: 1 },
    floor_id: { type: "string", minLength: 1 },
    page_id: { type: "string", minLength: 1 },
    include_layers: { type: "boolean", default: false },
  },
  additionalProperties: false,
} as const;

const upsertVariableBodyJsonSchema = {
  type: "object",
  required: ["scope", "scope_id", "key", "value"],
  properties: {
    scope: { type: "string", enum: ["global", "chat", "floor", "page"] },
    scope_id: { type: "string", minLength: 1 },
    key: { type: "string", minLength: 1 },
    value: {},
  },
  examples: [upsertVariableBodyExample],
  additionalProperties: false,
} as const;

const batchUpsertVariablesBodyJsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: upsertVariableBodyJsonSchema,
    },
  },
  examples: [batchUpsertVariablesBodyExample],
  additionalProperties: false,
} as const;

const variableJsonSchema = {
  type: "object",
  required: ["id", "scope", "scope_id", "key", "value", "updated_at"],
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: ["global", "chat", "floor", "page"] },
    scope_id: { type: "string" },
    key: { type: "string" },
    value: {},
    updated_at: { type: "integer", minimum: 0 },
  },
  examples: [variableExample],
  additionalProperties: false,
} as const;

const resolvedVariableJsonSchema = {
  type: "object",
  required: ["key", "value", "source_scope", "source_scope_id", "updated_at"],
  properties: {
    key: { type: "string" },
    value: {},
    source_scope: { type: "string", enum: ["global", "chat", "floor", "page"] },
    source_scope_id: { type: "string" },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const variableLayerJsonSchema = {
  type: "object",
  required: ["scope", "scope_id", "items"],
  properties: {
    scope: { type: "string", enum: ["global", "chat", "floor", "page"] },
    scope_id: { type: "string" },
    items: { type: "array", items: variableJsonSchema },
  },
  additionalProperties: false,
} as const;

const listMetaJsonSchema = {
  type: "object",
  required: ["total", "limit", "offset", "has_more", "sort_by", "sort_order"],
  properties: {
    total: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1 },
    offset: { type: "integer", minimum: 0 },
    has_more: { type: "boolean" },
    sort_by: { type: "string" },
    sort_order: { type: "string", enum: ["asc", "desc"] },
  },
  additionalProperties: false,
} as const;

const resolvedContextJsonSchema = {
  type: "object",
  required: ["account_id", "session_id", "global_scope_id"],
  properties: {
    account_id: { type: "string" },
    session_id: { type: "string" },
    floor_id: { type: "string" },
    page_id: { type: "string" },
    global_scope_id: { type: "string" },
  },
  additionalProperties: false,
} as const;

const variableResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: variableJsonSchema,
  },
  examples: [variableResponseExample],
  additionalProperties: false,
} as const;

const variableListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: variableJsonSchema },
    meta: listMetaJsonSchema,
  },
  examples: [variableListResponseExample],
  additionalProperties: false,
} as const;

const batchUpsertVariableResultJsonSchema = {
  type: "object",
  required: ["index", "action", "data"],
  properties: {
    index: { type: "integer", minimum: 0 },
    action: { type: "string", enum: ["created", "updated"] },
    data: variableJsonSchema,
  },
  additionalProperties: false,
} as const;

const batchUpsertVariableMetaJsonSchema = {
  type: "object",
  required: ["total", "created", "updated"],
  properties: {
    total: { type: "integer", minimum: 1 },
    created: { type: "integer", minimum: 0 },
    updated: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const batchUpsertVariablesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results", "meta"],
      properties: {
        results: {
          type: "array",
          items: batchUpsertVariableResultJsonSchema,
        },
        meta: batchUpsertVariableMetaJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [batchUpsertVariablesResponseExample],
  additionalProperties: false,
} as const;

const resolvedVariablesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["context", "resolved"],
      properties: {
        context: resolvedContextJsonSchema,
        resolved: {
          type: "array",
          items: resolvedVariableJsonSchema,
        },
        layers: {
          type: "object",
          properties: {
            global: variableLayerJsonSchema,
            chat: variableLayerJsonSchema,
            floor: variableLayerJsonSchema,
            page: variableLayerJsonSchema,
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  examples: [resolveVariablesResponseExample],
  additionalProperties: false,
} as const;

const deleteResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["id", "deleted"],
      properties: { id: { type: "string" }, deleted: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  examples: [deleteVariableResponseExample],
  additionalProperties: false,
} as const;

function buildVariableIdentity(input: Pick<z.infer<typeof upsertVariableSchema>, "scope" | "scope_id" | "key">) {
  return `${input.scope}\u0000${input.scope_id}\u0000${input.key}`;
}

function toVariableResponse(record: VariableRecord) {
  return {
    id: record.id,
    scope: record.scope,
    scope_id: record.scopeId,
    key: record.key,
    value: record.value,
    updated_at: record.updatedAt,
  };
}

function toResolvedVariableResponse(record: ResolvedVariableRecord) {
  return {
    key: record.key,
    value: record.value,
    source_scope: record.sourceScope,
    source_scope_id: record.sourceScopeId,
    updated_at: record.updatedAt,
  };
}

function toVariableLayerResponse(layer: VariableLayerSnapshot) {
  return {
    scope: layer.scope,
    scope_id: layer.scopeId,
    items: layer.items.map(toVariableResponse),
  };
}

function toResolvedSnapshotResponse(snapshot: ResolvedVariablesSnapshot) {
  const layers = snapshot.layers
    ? Object.fromEntries(
        Object.entries(snapshot.layers).map(([scope, layer]) => [scope, layer ? toVariableLayerResponse(layer) : undefined])
      )
    : undefined;

  return {
    context: {
      account_id: snapshot.context.accountId,
      session_id: snapshot.context.sessionId,
      floor_id: snapshot.context.floorId,
      page_id: snapshot.context.pageId,
      global_scope_id: snapshot.context.globalScopeId,
    },
    resolved: snapshot.resolved.map(toResolvedVariableResponse),
    ...(layers ? { layers } : {}),
  };
}

export async function registerVariableRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: { eventBus?: CoreEventBus; mutationRuntime?: MutationRuntime } = {}
): Promise<void> {
  const service = new VariableService(connection.db, {
    eventBus: options.eventBus,
    mutationRuntime: options.mutationRuntime,
  });

  app.put("/variables", {
    schema: {
      tags: ["variables"],
      summary: "Upsert variable",
      operationId: "upsertVariable",
      body: upsertVariableBodyJsonSchema,
      response: {
        200: variableResponseJsonSchema,
        201: variableResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(upsertVariableSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const result = await service.upsert({
        accountId: auth.accountId,
        scope: parsedBody.data.scope,
        scopeId: parsedBody.data.scope_id,
        key: parsedBody.data.key,
        value: parsedBody.data.value,
      });

      return reply.code(result.action === "created" ? 201 : 200).send({ data: toVariableResponse(result.variable) });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.put("/variables/batch", {
    schema: {
      tags: ["variables"],
      summary: "Batch upsert variables",
      operationId: "batchUpsertVariables",
      body: batchUpsertVariablesBodyJsonSchema,
      response: {
        200: batchUpsertVariablesResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(batchUpsertVariablesSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const result = await service.upsertMany({
        accountId: auth.accountId,
        items: parsedBody.data.items.map((item) => ({
          accountId: auth.accountId,
          scope: item.scope,
          scopeId: item.scope_id,
          key: item.key,
          value: item.value,
        })),
      });

      return reply.send({
        data: {
          results: result.results.map((item) => ({
            index: item.index,
            action: item.action,
            data: toVariableResponse(item.variable),
          })),
          meta: result.meta,
        },
      });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.get("/variables", {
    schema: {
      tags: ["variables"],
      summary: "List variables",
      operationId: "listVariables",
      querystring: listVariablesQueryJsonSchema,
      response: {
        200: variableListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listVariablesQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const result = await service.list({
      accountId: auth.accountId,
      limit: parsedQuery.data.limit,
      offset: parsedQuery.data.offset,
      sortBy: parsedQuery.data.sort_by,
      sortOrder: parsedQuery.data.sort_order,
      scope: parsedQuery.data.scope,
      scopeId: parsedQuery.data.scope_id,
      key: parsedQuery.data.key,
    });

    return reply.send({
      data: result.items.map(toVariableResponse),
      meta: buildListMeta({
        total: result.total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  app.get("/variables/resolve", {
    schema: {
      tags: ["variables"],
      summary: "Resolve visible variable snapshot",
      operationId: "resolveVariablesContext",
      querystring: resolveVariablesQueryJsonSchema,
      response: {
        200: resolvedVariablesResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(resolveVariablesQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const snapshot = await service.resolveSnapshot({
        accountId: auth.accountId,
        sessionId: parsedQuery.data.session_id,
        floorId: parsedQuery.data.floor_id,
        pageId: parsedQuery.data.page_id,
        includeLayers: parsedQuery.data.include_layers,
      });

      return reply.send({ data: toResolvedSnapshotResponse(snapshot) });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.get("/variables/:id", {
    schema: {
      tags: ["variables"],
      summary: "Get variable",
      operationId: "getVariable",
      params: idParamsJsonSchema,
      response: {
        200: variableResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(variableParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const variable = await service.getDetail(parsedParams.data.id, auth.accountId);
      return reply.send({ data: toVariableResponse(variable) });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.delete("/variables/:id", {
    schema: {
      tags: ["variables"],
      summary: "Delete variable",
      operationId: "deleteVariable",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(variableParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      await service.remove(parsedParams.data.id, auth.accountId);
      return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });
}

function sendServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof VariableServiceError) {
    switch (error.code) {
      case "duplicate_variable_target":
      case "invalid_variable_context":
      case "invalid_variable_value":
        return sendError(reply, 400, error.code, error.message);
      case "variable_host_not_found":
      case "variable_not_found":
        return sendError(reply, 404, error.code, error.message);
      case "variable_target_locked":
        return sendError(reply, 409, error.code, error.message);
      default:
        break;
    }
  }

  throw error;
}
