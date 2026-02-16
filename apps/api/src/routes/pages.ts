import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { messagePages } from "../db/schema";
import { parseWithSchema, requireRow, sendError } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";

const pageKindSchema = z.enum(["input", "output", "mixed"]);

const pageParamsSchema = z.object({
  id: z.string().min(1)
});

const listPagesQuerySchema = listQuerySchemaBase.extend({
  floor_id: z.string().min(1).optional(),
  page_kind: pageKindSchema.optional(),
  is_active: z.coerce.boolean().optional(),
  sort_by: z.enum(["created_at", "updated_at", "page_no", "version"]).default("created_at")
});

const createPageSchema = z.object({
  floor_id: z.string().min(1),
  page_no: z.number().int().nonnegative(),
  page_kind: pageKindSchema,
  is_active: z.boolean().optional(),
  version: z.number().int().positive().optional(),
  checksum: z.string().min(1).optional()
});

const updatePageSchema = z
  .object({
    page_no: z.number().int().nonnegative().optional(),
    page_kind: pageKindSchema.optional(),
    is_active: z.boolean().optional(),
    version: z.number().int().positive().optional(),
    checksum: z.string().min(1).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const idParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const listPagesQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at", "updated_at", "page_no", "version"] },
    floor_id: { type: "string", minLength: 1 },
    page_kind: { type: "string", enum: ["input", "output", "mixed"] },
    is_active: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const pageBodyJsonSchema = {
  type: "object",
  properties: {
    floor_id: { type: "string", minLength: 1 },
    page_no: { type: "integer", minimum: 0 },
    page_kind: { type: "string", enum: ["input", "output", "mixed"] },
    is_active: { type: "boolean" },
    version: { type: "integer", minimum: 1 },
    checksum: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const pageJsonSchema = {
  type: "object",
  required: ["id", "floor_id", "page_no", "page_kind", "is_active", "version", "checksum", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    floor_id: { type: "string" },
    page_no: { type: "integer", minimum: 0 },
    page_kind: { type: "string", enum: ["input", "output", "mixed"] },
    is_active: { type: "boolean" },
    version: { type: "integer", minimum: 1 },
    checksum: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
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

const pageResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: pageJsonSchema },
  additionalProperties: false,
} as const;

const pageListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: pageJsonSchema },
    meta: listMetaJsonSchema,
  },
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
  additionalProperties: false,
} as const;

function toPageResponse(row: typeof messagePages.$inferSelect) {
  return {
    id: row.id,
    floor_id: row.floorId,
    page_no: row.pageNo,
    page_kind: row.pageKind,
    is_active: row.isActive,
    version: row.version,
    checksum: row.checksum,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

export async function registerMessagePageRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;

  app.post("/pages", {
    schema: {
      tags: ["pages"],
      summary: "Create page",
      operationId: "createPage",
      body: {
        ...pageBodyJsonSchema,
        required: ["floor_id", "page_no", "page_kind"],
      },
      response: {
        201: pageResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createPageSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const now = Date.now();

    const createdRows = await db
      .insert(messagePages)
      .values({
        id: nanoid(),
        floorId: parsedBody.data.floor_id,
        pageNo: parsedBody.data.page_no,
        pageKind: parsedBody.data.page_kind,
        isActive: parsedBody.data.is_active ?? true,
        version: parsedBody.data.version ?? 1,
        checksum: parsedBody.data.checksum ?? null,
        createdAt: now,
        updatedAt: now
      })
      .returning();

    const created = requireRow(createdRows[0], "Failed to create message page");

    return reply.code(201).send({ data: toPageResponse(created) });
  });

  app.get("/pages", {
    schema: {
      tags: ["pages"],
      summary: "List pages",
      operationId: "listPages",
      querystring: listPagesQueryJsonSchema,
      response: {
        200: pageListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listPagesQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const filters = [];

    if (parsedQuery.data.floor_id !== undefined) {
      filters.push(eq(messagePages.floorId, parsedQuery.data.floor_id));
    }

    if (parsedQuery.data.page_kind !== undefined) {
      filters.push(eq(messagePages.pageKind, parsedQuery.data.page_kind));
    }

    if (parsedQuery.data.is_active !== undefined) {
      filters.push(eq(messagePages.isActive, parsedQuery.data.is_active));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const sortByColumn =
      parsedQuery.data.sort_by === "updated_at"
        ? messagePages.updatedAt
        : parsedQuery.data.sort_by === "page_no"
          ? messagePages.pageNo
          : parsedQuery.data.sort_by === "version"
            ? messagePages.version
            : messagePages.createdAt;

    const rows =
      whereClause === undefined
        ? await db
            .select()
            .from(messagePages)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset)
        : await db
            .select()
            .from(messagePages)
            .where(whereClause)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset);

    const totalRows =
      whereClause === undefined
        ? await db.select({ total: count() }).from(messagePages)
        : await db.select({ total: count() }).from(messagePages).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toPageResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/pages/:id", {
    schema: {
      tags: ["pages"],
      summary: "Get page",
      operationId: "getPage",
      params: idParamsJsonSchema,
      response: {
        200: pageResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const [row] = await db.select().from(messagePages).where(eq(messagePages.id, parsedParams.data.id));

    if (!row) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }

    return reply.send({ data: toPageResponse(row) });
  });

  app.patch("/pages/:id", {
    schema: {
      tags: ["pages"],
      summary: "Update page",
      operationId: "updatePage",
      params: idParamsJsonSchema,
      body: {
        ...pageBodyJsonSchema,
        minProperties: 1,
      },
      response: {
        200: pageResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(updatePageSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const updates: Partial<typeof messagePages.$inferInsert> = {
      updatedAt: Date.now()
    };

    if (parsedBody.data.page_no !== undefined) {
      updates.pageNo = parsedBody.data.page_no;
    }

    if (parsedBody.data.page_kind !== undefined) {
      updates.pageKind = parsedBody.data.page_kind;
    }

    if (parsedBody.data.is_active !== undefined) {
      updates.isActive = parsedBody.data.is_active;
    }

    if (parsedBody.data.version !== undefined) {
      updates.version = parsedBody.data.version;
    }

    if (parsedBody.data.checksum !== undefined) {
      updates.checksum = parsedBody.data.checksum;
    }

    const [updated] = await db
      .update(messagePages)
      .set(updates)
      .where(eq(messagePages.id, parsedParams.data.id))
      .returning();

    if (!updated) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }

    return reply.send({ data: toPageResponse(updated) });
  });

  app.delete("/pages/:id", {
    schema: {
      tags: ["pages"],
      summary: "Delete page",
      operationId: "deletePage",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const deleted = await db.delete(messagePages).where(eq(messagePages.id, parsedParams.data.id)).returning();

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });

  // ── Activate (Swipe) ────────────────────────────────

  app.patch("/pages/:id/activate", {
    schema: {
      tags: ["pages"],
      summary: "Activate page within floor",
      operationId: "activatePage",
      params: idParamsJsonSchema,
      response: {
        200: pageResponseJsonSchema,
        404: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const targetId = parsedParams.data.id;

    // 查找目标页
    const [targetPage] = await db
      .select()
      .from(messagePages)
      .where(eq(messagePages.id, targetId));

    if (!targetPage) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }

    // 幂等：已经是活跃状态则直接返回
    if (targetPage.isActive) {
      return reply.send({ data: toPageResponse(targetPage) });
    }

    const now = Date.now();

    // 1. 将同楼层所有活跃页 deactivate
    await db
      .update(messagePages)
      .set({ isActive: false, updatedAt: now })
      .where(
        and(
          eq(messagePages.floorId, targetPage.floorId),
          eq(messagePages.isActive, true)
        )
      );

    // 2. activate 目标页
    const [updated] = await db
      .update(messagePages)
      .set({ isActive: true, updatedAt: now })
      .where(eq(messagePages.id, targetId))
      .returning();

    if (!updated) {
      return sendError(reply, 500, "internal_error", "Failed to activate page");
    }

    return reply.send({ data: toPageResponse(updated) });
  });
}
