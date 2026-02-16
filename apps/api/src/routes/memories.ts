import { and, count, eq, gte, like, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { memoryEdges, memoryItems } from "../db/schema";
import { parseJsonField, parseWithSchema, requireRow, sendError, stringifyJsonField } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";

const memoryScopeSchema = z.enum(["global", "chat", "floor"]);
const memoryTypeSchema = z.enum(["fact", "summary", "open_loop"]);
const memoryStatusSchema = z.enum(["active", "deprecated"]);
const memoryRelationSchema = z.enum(["supports", "contradicts", "updates"]);

const memoryItemParamsSchema = z.object({
  id: z.string().min(1)
});

const memoryEdgeParamsSchema = z.object({
  id: z.string().min(1)
});

const createMemoryItemSchema = z.object({
  scope: memoryScopeSchema,
  scope_id: z.string().min(1),
  type: memoryTypeSchema,
  content: z.unknown(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source_floor_id: z.string().min(1).optional(),
  source_message_id: z.string().min(1).optional(),
  status: memoryStatusSchema.optional()
});

const updateMemoryItemSchema = z
  .object({
    scope: memoryScopeSchema.optional(),
    scope_id: z.string().min(1).optional(),
    type: memoryTypeSchema.optional(),
    content: z.unknown().optional(),
    importance: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    source_floor_id: z.string().min(1).optional(),
    source_message_id: z.string().min(1).optional(),
    status: memoryStatusSchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const memoryFilterSchemaShape = {
  scope: memoryScopeSchema.optional(),
  scope_id: z.string().min(1).optional(),
  type: memoryTypeSchema.optional(),
  status: memoryStatusSchema.optional(),
  source_floor_id: z.string().min(1).optional(),
  source_message_id: z.string().min(1).optional(),
  created_from: z.coerce.number().int().min(0).optional(),
  created_to: z.coerce.number().int().min(0).optional(),
  updated_from: z.coerce.number().int().min(0).optional(),
  updated_to: z.coerce.number().int().min(0).optional(),
  importance_min: z.number().min(0).max(1).optional(),
  importance_max: z.number().min(0).max(1).optional(),
  confidence_min: z.number().min(0).max(1).optional(),
  confidence_max: z.number().min(0).max(1).optional(),
  q: z.string().trim().min(1).optional(),
} as const;

const listMemoryItemsQuerySchema = listQuerySchemaBase
  .extend({
    ...memoryFilterSchemaShape,
    sort_by: z.enum(["created_at", "updated_at", "importance", "confidence"]).default("created_at")
  })
  .refine(
    (value) =>
      value.created_from === undefined || value.created_to === undefined || value.created_from <= value.created_to,
    "created_from must be less than or equal to created_to"
  )
  .refine(
    (value) =>
      value.updated_from === undefined || value.updated_to === undefined || value.updated_from <= value.updated_to,
    "updated_from must be less than or equal to updated_to"
  )
  .refine(
    (value) =>
      value.importance_min === undefined || value.importance_max === undefined || value.importance_min <= value.importance_max,
    "importance_min must be less than or equal to importance_max"
  )
  .refine(
    (value) =>
      value.confidence_min === undefined || value.confidence_max === undefined || value.confidence_min <= value.confidence_max,
    "confidence_min must be less than or equal to confidence_max"
  );

const memoryStatsQuerySchema = z
  .object(memoryFilterSchemaShape)
  .refine(
    (value) =>
      value.created_from === undefined || value.created_to === undefined || value.created_from <= value.created_to,
    "created_from must be less than or equal to created_to"
  )
  .refine(
    (value) =>
      value.updated_from === undefined || value.updated_to === undefined || value.updated_from <= value.updated_to,
    "updated_from must be less than or equal to updated_to"
  )
  .refine(
    (value) =>
      value.importance_min === undefined || value.importance_max === undefined || value.importance_min <= value.importance_max,
    "importance_min must be less than or equal to importance_max"
  )
  .refine(
    (value) =>
      value.confidence_min === undefined || value.confidence_max === undefined || value.confidence_min <= value.confidence_max,
    "confidence_min must be less than or equal to confidence_max"
  );

const createMemoryEdgeSchema = z.object({
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  relation: memoryRelationSchema
});

const listMemoryEdgesQuerySchema = listQuerySchemaBase.extend({
  from_id: z.string().min(1).optional(),
  to_id: z.string().min(1).optional(),
  relation: memoryRelationSchema.optional(),
  sort_by: z.enum(["created_at"]).default("created_at")
});

const idParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
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

const memoryItemJsonSchema = {
  type: "object",
  required: [
    "id",
    "scope",
    "scope_id",
    "type",
    "content",
    "importance",
    "confidence",
    "status",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: ["global", "chat", "floor"] },
    scope_id: { type: "string" },
    type: { type: "string", enum: ["fact", "summary", "open_loop"] },
    content: {},
    importance: { type: "number", minimum: 0, maximum: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    source_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    source_message_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    status: { type: "string", enum: ["active", "deprecated"] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const memoryEdgeJsonSchema = {
  type: "object",
  required: ["id", "from_id", "to_id", "relation", "created_at"],
  properties: {
    id: { type: "string" },
    from_id: { type: "string" },
    to_id: { type: "string" },
    relation: { type: "string", enum: ["supports", "contradicts", "updates"] },
    created_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const memoryFilterJsonSchemaProperties = {
  scope: { type: "string", enum: ["global", "chat", "floor"] },
  scope_id: { type: "string", minLength: 1 },
  type: { type: "string", enum: ["fact", "summary", "open_loop"] },
  status: { type: "string", enum: ["active", "deprecated"] },
  source_floor_id: { type: "string", minLength: 1 },
  source_message_id: { type: "string", minLength: 1 },
  created_from: { type: "integer", minimum: 0 },
  created_to: { type: "integer", minimum: 0 },
  updated_from: { type: "integer", minimum: 0 },
  updated_to: { type: "integer", minimum: 0 },
  importance_min: { type: "number", minimum: 0, maximum: 1 },
  importance_max: { type: "number", minimum: 0, maximum: 1 },
  confidence_min: { type: "number", minimum: 0, maximum: 1 },
  confidence_max: { type: "number", minimum: 0, maximum: 1 },
  q: { type: "string", minLength: 1 },
} as const;

const createMemoryBodyJsonSchema = {
  type: "object",
  required: ["scope", "scope_id", "type", "content"],
  properties: {
    scope: { type: "string", enum: ["global", "chat", "floor"] },
    scope_id: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["fact", "summary", "open_loop"] },
    content: {},
    importance: { type: "number", minimum: 0, maximum: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    source_floor_id: { type: "string", minLength: 1 },
    source_message_id: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["active", "deprecated"] },
  },
  additionalProperties: false,
} as const;

const updateMemoryBodyJsonSchema = {
  type: "object",
  properties: createMemoryBodyJsonSchema.properties,
  additionalProperties: false,
  minProperties: 1,
} as const;

const listMemoriesQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at", "updated_at", "importance", "confidence"] },
    ...memoryFilterJsonSchemaProperties,
  },
  additionalProperties: false,
} as const;

const listMemoryEdgesQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at"] },
    from_id: { type: "string", minLength: 1 },
    to_id: { type: "string", minLength: 1 },
    relation: { type: "string", enum: ["supports", "contradicts", "updates"] },
  },
  additionalProperties: false,
} as const;

const statsQueryJsonSchema = {
  type: "object",
  properties: memoryFilterJsonSchemaProperties,
  additionalProperties: false,
} as const;

const createMemoryEdgeBodyJsonSchema = {
  type: "object",
  required: ["from_id", "to_id", "relation"],
  properties: {
    from_id: { type: "string", minLength: 1 },
    to_id: { type: "string", minLength: 1 },
    relation: { type: "string", enum: ["supports", "contradicts", "updates"] },
  },
  additionalProperties: false,
} as const;

const memoryItemResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: memoryItemJsonSchema },
  additionalProperties: false,
} as const;

const memoryEdgeResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: memoryEdgeJsonSchema },
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
  additionalProperties: false,
} as const;

const memoryListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: memoryItemJsonSchema },
    meta: listMetaJsonSchema,
  },
  additionalProperties: false,
} as const;

const memoryEdgeListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: memoryEdgeJsonSchema },
    meta: listMetaJsonSchema,
  },
  additionalProperties: false,
} as const;

const memoryStatsResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "total",
        "active",
        "deprecated",
        "by_type",
        "avg_importance",
        "avg_confidence",
        "estimated_tokens",
      ],
      properties: {
        total: { type: "integer", minimum: 0 },
        active: { type: "integer", minimum: 0 },
        deprecated: { type: "integer", minimum: 0 },
        by_type: {
          type: "object",
          required: ["fact", "summary", "open_loop"],
          properties: {
            fact: { type: "integer", minimum: 0 },
            summary: { type: "integer", minimum: 0 },
            open_loop: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
        avg_importance: { type: "number", minimum: 0 },
        avg_confidence: { type: "number", minimum: 0 },
        estimated_tokens: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

function toMemoryItemResponse(row: typeof memoryItems.$inferSelect) {
  return {
    id: row.id,
    scope: row.scope,
    scope_id: row.scopeId,
    type: row.type,
    content: parseJsonField(row.contentJson),
    importance: row.importance,
    confidence: row.confidence,
    source_floor_id: row.sourceFloorId,
    source_message_id: row.sourceMessageId,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

function toMemoryEdgeResponse(row: typeof memoryEdges.$inferSelect) {
  return {
    id: row.id,
    from_id: row.fromId,
    to_id: row.toId,
    relation: row.relation,
    created_at: row.createdAt
  };
}

function buildMemoryFilters(
  query: Pick<
    z.infer<typeof listMemoryItemsQuerySchema>,
    | "scope"
    | "scope_id"
    | "type"
    | "status"
    | "source_floor_id"
    | "source_message_id"
    | "created_from"
    | "created_to"
    | "updated_from"
    | "updated_to"
    | "importance_min"
    | "importance_max"
    | "confidence_min"
    | "confidence_max"
    | "q"
  >
) {
  const filters = [];

  if (query.scope !== undefined) {
    filters.push(eq(memoryItems.scope, query.scope));
  }

  if (query.scope_id !== undefined) {
    filters.push(eq(memoryItems.scopeId, query.scope_id));
  }

  if (query.type !== undefined) {
    filters.push(eq(memoryItems.type, query.type));
  }

  if (query.status !== undefined) {
    filters.push(eq(memoryItems.status, query.status));
  }

  if (query.source_floor_id !== undefined) {
    filters.push(eq(memoryItems.sourceFloorId, query.source_floor_id));
  }

  if (query.source_message_id !== undefined) {
    filters.push(eq(memoryItems.sourceMessageId, query.source_message_id));
  }

  if (query.created_from !== undefined) {
    filters.push(gte(memoryItems.createdAt, query.created_from));
  }

  if (query.created_to !== undefined) {
    filters.push(lte(memoryItems.createdAt, query.created_to));
  }

  if (query.updated_from !== undefined) {
    filters.push(gte(memoryItems.updatedAt, query.updated_from));
  }

  if (query.updated_to !== undefined) {
    filters.push(lte(memoryItems.updatedAt, query.updated_to));
  }

  if (query.importance_min !== undefined) {
    filters.push(gte(memoryItems.importance, query.importance_min));
  }

  if (query.importance_max !== undefined) {
    filters.push(lte(memoryItems.importance, query.importance_max));
  }

  if (query.confidence_min !== undefined) {
    filters.push(gte(memoryItems.confidence, query.confidence_min));
  }

  if (query.confidence_max !== undefined) {
    filters.push(lte(memoryItems.confidence, query.confidence_max));
  }

  if (query.q !== undefined) {
    filters.push(like(memoryItems.contentJson, `%${query.q}%`));
  }

  return filters;
}

export async function registerMemoryRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;
  const tokenCounter = new SimpleTokenCounter();

  app.post("/memories", {
    schema: {
      tags: ["memories"],
      summary: "Create memory item",
      body: createMemoryBodyJsonSchema,
      response: {
        201: memoryItemResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createMemoryItemSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const contentJson = stringifyJsonField(parsedBody.data.content);

    if (contentJson === null) {
      return sendError(reply, 400, "validation_error", "Memory content cannot be undefined");
    }

    const now = Date.now();

    const createdRows = await db
      .insert(memoryItems)
      .values({
        id: nanoid(),
        scope: parsedBody.data.scope,
        scopeId: parsedBody.data.scope_id,
        type: parsedBody.data.type,
        contentJson,
        importance: parsedBody.data.importance ?? 0.5,
        confidence: parsedBody.data.confidence ?? 1,
        sourceFloorId: parsedBody.data.source_floor_id ?? null,
        sourceMessageId: parsedBody.data.source_message_id ?? null,
        status: parsedBody.data.status ?? "active",
        createdAt: now,
        updatedAt: now
      })
      .returning();

    const created = requireRow(createdRows[0], "Failed to create memory item");

    return reply.code(201).send({ data: toMemoryItemResponse(created) });
  });

  app.get("/memories", {
    schema: {
      tags: ["memories"],
      summary: "List memory items",
      querystring: listMemoriesQueryJsonSchema,
      response: {
        200: memoryListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listMemoryItemsQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const filters = buildMemoryFilters(parsedQuery.data);
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const sortByColumn =
      parsedQuery.data.sort_by === "updated_at"
        ? memoryItems.updatedAt
        : parsedQuery.data.sort_by === "importance"
          ? memoryItems.importance
          : parsedQuery.data.sort_by === "confidence"
            ? memoryItems.confidence
            : memoryItems.createdAt;

    const rows =
      whereClause === undefined
        ? await db
            .select()
            .from(memoryItems)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset)
        : await db
            .select()
            .from(memoryItems)
            .where(whereClause)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset);

    const totalRows =
      whereClause === undefined
        ? await db.select({ total: count() }).from(memoryItems)
        : await db.select({ total: count() }).from(memoryItems).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toMemoryItemResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/memories/stats", {
    schema: {
      tags: ["memories"],
      summary: "Memory statistics",
      querystring: statsQueryJsonSchema,
      response: {
        200: memoryStatsResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(memoryStatsQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const filters = buildMemoryFilters(parsedQuery.data);
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows =
      whereClause === undefined
        ? await db
            .select({
              type: memoryItems.type,
              status: memoryItems.status,
              importance: memoryItems.importance,
              confidence: memoryItems.confidence,
              contentJson: memoryItems.contentJson,
            })
            .from(memoryItems)
        : await db
            .select({
              type: memoryItems.type,
              status: memoryItems.status,
              importance: memoryItems.importance,
              confidence: memoryItems.confidence,
              contentJson: memoryItems.contentJson,
            })
            .from(memoryItems)
            .where(whereClause);

    let active = 0;
    let deprecated = 0;
    let fact = 0;
    let summary = 0;
    let openLoop = 0;
    let importanceTotal = 0;
    let confidenceTotal = 0;
    let estimatedTokens = 0;

    for (const row of rows) {
      if (row.status === "active") {
        active += 1;
      } else {
        deprecated += 1;
      }

      if (row.type === "fact") {
        fact += 1;
      } else if (row.type === "summary") {
        summary += 1;
      } else {
        openLoop += 1;
      }

      importanceTotal += row.importance;
      confidenceTotal += row.confidence;

      const parsed = parseJsonField(row.contentJson);
      const text = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      if (text) {
        estimatedTokens += tokenCounter.count(text);
      }
    }

    const total = rows.length;

    return reply.send({
      data: {
        total,
        active,
        deprecated,
        by_type: {
          fact,
          summary,
          open_loop: openLoop,
        },
        avg_importance: total === 0 ? 0 : importanceTotal / total,
        avg_confidence: total === 0 ? 0 : confidenceTotal / total,
        estimated_tokens: estimatedTokens,
      }
    });
  });

  app.get("/memories/:id", {
    schema: {
      tags: ["memories"],
      summary: "Get memory item",
      params: idParamsJsonSchema,
      response: {
        200: memoryItemResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryItemParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const [row] = await db.select().from(memoryItems).where(eq(memoryItems.id, parsedParams.data.id));

    if (!row) {
      return sendError(reply, 404, "not_found", "Memory item not found");
    }

    return reply.send({ data: toMemoryItemResponse(row) });
  });

  app.patch("/memories/:id", {
    schema: {
      tags: ["memories"],
      summary: "Update memory item",
      params: idParamsJsonSchema,
      body: updateMemoryBodyJsonSchema,
      response: {
        200: memoryItemResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryItemParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(updateMemoryItemSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const updates: Partial<typeof memoryItems.$inferInsert> = {
      updatedAt: Date.now()
    };

    if (parsedBody.data.scope !== undefined) {
      updates.scope = parsedBody.data.scope;
    }

    if (parsedBody.data.scope_id !== undefined) {
      updates.scopeId = parsedBody.data.scope_id;
    }

    if (parsedBody.data.type !== undefined) {
      updates.type = parsedBody.data.type;
    }

    if (parsedBody.data.content !== undefined) {
      const contentJson = stringifyJsonField(parsedBody.data.content);

      if (contentJson === null) {
        return sendError(reply, 400, "validation_error", "Memory content cannot be undefined");
      }

      updates.contentJson = contentJson;
    }

    if (parsedBody.data.importance !== undefined) {
      updates.importance = parsedBody.data.importance;
    }

    if (parsedBody.data.confidence !== undefined) {
      updates.confidence = parsedBody.data.confidence;
    }

    if (parsedBody.data.source_floor_id !== undefined) {
      updates.sourceFloorId = parsedBody.data.source_floor_id;
    }

    if (parsedBody.data.source_message_id !== undefined) {
      updates.sourceMessageId = parsedBody.data.source_message_id;
    }

    if (parsedBody.data.status !== undefined) {
      updates.status = parsedBody.data.status;
    }

    const [updated] = await db
      .update(memoryItems)
      .set(updates)
      .where(eq(memoryItems.id, parsedParams.data.id))
      .returning();

    if (!updated) {
      return sendError(reply, 404, "not_found", "Memory item not found");
    }

    return reply.send({ data: toMemoryItemResponse(updated) });
  });

  app.delete("/memories/:id", {
    schema: {
      tags: ["memories"],
      summary: "Delete memory item",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryItemParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const deleted = await db.delete(memoryItems).where(eq(memoryItems.id, parsedParams.data.id)).returning();

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Memory item not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });

  app.post("/memory-edges", {
    schema: {
      tags: ["memories"],
      summary: "Create memory edge",
      body: createMemoryEdgeBodyJsonSchema,
      response: {
        201: memoryEdgeResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createMemoryEdgeSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const createdRows = await db
      .insert(memoryEdges)
      .values({
        id: nanoid(),
        fromId: parsedBody.data.from_id,
        toId: parsedBody.data.to_id,
        relation: parsedBody.data.relation,
        createdAt: Date.now()
      })
      .returning();

    const created = requireRow(createdRows[0], "Failed to create memory edge");

    return reply.code(201).send({ data: toMemoryEdgeResponse(created) });
  });

  app.get("/memory-edges", {
    schema: {
      tags: ["memories"],
      summary: "List memory edges",
      querystring: listMemoryEdgesQueryJsonSchema,
      response: {
        200: memoryEdgeListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listMemoryEdgesQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const filters = [];

    if (parsedQuery.data.from_id !== undefined) {
      filters.push(eq(memoryEdges.fromId, parsedQuery.data.from_id));
    }

    if (parsedQuery.data.to_id !== undefined) {
      filters.push(eq(memoryEdges.toId, parsedQuery.data.to_id));
    }

    if (parsedQuery.data.relation !== undefined) {
      filters.push(eq(memoryEdges.relation, parsedQuery.data.relation));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows =
      whereClause === undefined
        ? await db
            .select()
            .from(memoryEdges)
            .orderBy(toOrderBy(memoryEdges.createdAt, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset)
        : await db
            .select()
            .from(memoryEdges)
            .where(whereClause)
            .orderBy(toOrderBy(memoryEdges.createdAt, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset);

    const totalRows =
      whereClause === undefined
        ? await db.select({ total: count() }).from(memoryEdges)
        : await db.select({ total: count() }).from(memoryEdges).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toMemoryEdgeResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/memory-edges/:id", {
    schema: {
      tags: ["memories"],
      summary: "Get memory edge",
      params: idParamsJsonSchema,
      response: {
        200: memoryEdgeResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryEdgeParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const [row] = await db.select().from(memoryEdges).where(eq(memoryEdges.id, parsedParams.data.id));

    if (!row) {
      return sendError(reply, 404, "not_found", "Memory edge not found");
    }

    return reply.send({ data: toMemoryEdgeResponse(row) });
  });

  app.delete("/memory-edges/:id", {
    schema: {
      tags: ["memories"],
      summary: "Delete memory edge",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryEdgeParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const deleted = await db
      .delete(memoryEdges)
      .where(eq(memoryEdges.id, parsedParams.data.id))
      .returning();

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Memory edge not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });
}
