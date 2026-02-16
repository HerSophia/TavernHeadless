import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { floors } from "../db/schema";
import { parseWithSchema, requireRow, sendError } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";

const floorStateSchema = z.enum(["draft", "generating", "committed", "failed"]);

const floorParamsSchema = z.object({
  id: z.string().min(1)
});

const branchParamsSchema = z.object({
  id: z.string().min(1)
});

const deleteBranchQuerySchema = z.object({
  session_id: z.string().min(1).optional()
});

const listFloorsQuerySchema = listQuerySchemaBase.extend({
  session_id: z.string().min(1).optional(),
  branch_id: z.string().min(1).optional(),
  state: floorStateSchema.optional(),
  sort_by: z.enum(["created_at", "updated_at", "floor_no"]).default("created_at")
});

const createFloorSchema = z.object({
  session_id: z.string().min(1),
  floor_no: z.number().int().nonnegative(),
  branch_id: z.string().min(1).default("main"),
  parent_floor_id: z.string().min(1).optional(),
  state: floorStateSchema.optional(),
  token_in: z.number().int().nonnegative().optional(),
  token_out: z.number().int().nonnegative().optional()
});

const updateFloorSchema = z
  .object({
    floor_no: z.number().int().nonnegative().optional(),
    branch_id: z.string().min(1).optional(),
    parent_floor_id: z.string().min(1).optional(),
    state: floorStateSchema.optional(),
    token_in: z.number().int().nonnegative().optional(),
    token_out: z.number().int().nonnegative().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const branchBodySchema = z.object({
  branch_id: z.string().trim().min(1).max(100).optional(),
});

const idParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const listQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at", "updated_at", "floor_no"] },
    session_id: { type: "string", minLength: 1 },
    branch_id: { type: "string", minLength: 1 },
    state: { type: "string", enum: ["draft", "generating", "committed", "failed"] },
  },
  additionalProperties: false,
} as const;

const floorBodyJsonSchema = {
  type: "object",
  properties: {
    session_id: { type: "string", minLength: 1 },
    floor_no: { type: "integer", minimum: 0 },
    branch_id: { type: "string", minLength: 1 },
    parent_floor_id: { type: "string", minLength: 1 },
    state: { type: "string", enum: ["draft", "generating", "committed", "failed"] },
    token_in: { type: "integer", minimum: 0 },
    token_out: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const floorJsonSchema = {
  type: "object",
  required: [
    "id",
    "session_id",
    "floor_no",
    "branch_id",
    "parent_floor_id",
    "state",
    "token_in",
    "token_out",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    session_id: { type: "string" },
    floor_no: { type: "integer", minimum: 0 },
    branch_id: { type: "string" },
    parent_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    state: { type: "string", enum: ["draft", "generating", "committed", "failed"] },
    token_in: { type: "integer", minimum: 0 },
    token_out: { type: "integer", minimum: 0 },
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

const floorResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: floorJsonSchema },
  additionalProperties: false,
} as const;

const floorListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: floorJsonSchema },
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

function toFloorResponse(row: typeof floors.$inferSelect) {
  return {
    id: row.id,
    session_id: row.sessionId,
    floor_no: row.floorNo,
    branch_id: row.branchId,
    parent_floor_id: row.parentFloorId,
    state: row.state,
    token_in: row.tokenIn,
    token_out: row.tokenOut,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

export async function registerFloorRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;

  app.post("/floors", {
    schema: {
      tags: ["floors"],
      summary: "Create floor",
      body: {
        ...floorBodyJsonSchema,
        required: ["session_id", "floor_no", "branch_id"],
      },
      response: {
        201: floorResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createFloorSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const now = Date.now();

    const createdRows = await db
      .insert(floors)
      .values({
        id: nanoid(),
        sessionId: parsedBody.data.session_id,
        floorNo: parsedBody.data.floor_no,
        branchId: parsedBody.data.branch_id,
        parentFloorId: parsedBody.data.parent_floor_id ?? null,
        state: parsedBody.data.state ?? "draft",
        tokenIn: parsedBody.data.token_in ?? 0,
        tokenOut: parsedBody.data.token_out ?? 0,
        createdAt: now,
        updatedAt: now
      })
      .returning();

    const created = requireRow(createdRows[0], "Failed to create floor");

    return reply.code(201).send({ data: toFloorResponse(created) });
  });

  app.get("/floors", {
    schema: {
      tags: ["floors"],
      summary: "List floors",
      querystring: listQueryJsonSchema,
      response: {
        200: floorListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listFloorsQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const filters = [];

    if (parsedQuery.data.session_id !== undefined) {
      filters.push(eq(floors.sessionId, parsedQuery.data.session_id));
    }

    if (parsedQuery.data.branch_id !== undefined) {
      filters.push(eq(floors.branchId, parsedQuery.data.branch_id));
    }

    if (parsedQuery.data.state !== undefined) {
      filters.push(eq(floors.state, parsedQuery.data.state));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const sortByColumn =
      parsedQuery.data.sort_by === "updated_at"
        ? floors.updatedAt
        : parsedQuery.data.sort_by === "floor_no"
          ? floors.floorNo
          : floors.createdAt;

    const rows =
      whereClause === undefined
        ? await db
            .select()
            .from(floors)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset)
        : await db
            .select()
            .from(floors)
            .where(whereClause)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset);

    const totalRows =
      whereClause === undefined
        ? await db.select({ total: count() }).from(floors)
        : await db.select({ total: count() }).from(floors).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toFloorResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/floors/:id", {
    schema: {
      tags: ["floors"],
      summary: "Get floor",
      params: idParamsJsonSchema,
      response: {
        200: floorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(floorParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const [row] = await db.select().from(floors).where(eq(floors.id, parsedParams.data.id));

    if (!row) {
      return sendError(reply, 404, "not_found", "Floor not found");
    }

    return reply.send({ data: toFloorResponse(row) });
  });

  app.patch("/floors/:id", {
    schema: {
      tags: ["floors"],
      summary: "Update floor",
      params: idParamsJsonSchema,
      body: {
        ...floorBodyJsonSchema,
        minProperties: 1,
      },
      response: {
        200: floorResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(floorParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(updateFloorSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const updates: Partial<typeof floors.$inferInsert> = {
      updatedAt: Date.now()
    };

    if (parsedBody.data.floor_no !== undefined) {
      updates.floorNo = parsedBody.data.floor_no;
    }

    if (parsedBody.data.branch_id !== undefined) {
      updates.branchId = parsedBody.data.branch_id;
    }

    if (parsedBody.data.parent_floor_id !== undefined) {
      updates.parentFloorId = parsedBody.data.parent_floor_id;
    }

    if (parsedBody.data.state !== undefined) {
      updates.state = parsedBody.data.state;
    }

    if (parsedBody.data.token_in !== undefined) {
      updates.tokenIn = parsedBody.data.token_in;
    }

    if (parsedBody.data.token_out !== undefined) {
      updates.tokenOut = parsedBody.data.token_out;
    }

    const [updated] = await db
      .update(floors)
      .set(updates)
      .where(eq(floors.id, parsedParams.data.id))
      .returning();

    if (!updated) {
      return sendError(reply, 404, "not_found", "Floor not found");
    }

    return reply.send({ data: toFloorResponse(updated) });
  });

  app.delete("/floors/:id", {
    schema: {
      tags: ["floors"],
      summary: "Delete floor",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(floorParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const deleted = await db.delete(floors).where(eq(floors.id, parsedParams.data.id)).returning();

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Floor not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });

  // ── Branch ──────────────────────────────────────────

  app.post("/floors/:id/branch", {
    schema: {
      tags: ["floors"],
      summary: "Prepare branch from floor",
      params: idParamsJsonSchema,
      body: {
        type: "object",
        properties: {
          branch_id: { type: "string", minLength: 1, maxLength: 100 },
        },
        additionalProperties: false,
      },
      response: {
        201: {
          type: "object",
          required: ["data"],
          properties: {
            data: {
              type: "object",
              required: ["branch_id", "source_floor_id", "source_floor_no", "session_id"],
              properties: {
                branch_id: { type: "string" },
                source_floor_id: { type: "string" },
                source_floor_no: { type: "integer", minimum: 0 },
                session_id: { type: "string" },
              },
              additionalProperties: false,
            }
          },
          additionalProperties: false,
        },
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(floorParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    // body 可以为空
    const body = request.body ?? {};
    const parsedBody = parseWithSchema(branchBodySchema, body, reply);
    if (!parsedBody.ok) return;

    // 查找源楼层
    const [sourceFloor] = await db
      .select()
      .from(floors)
      .where(eq(floors.id, parsedParams.data.id));

    if (!sourceFloor) {
      return sendError(reply, 404, "not_found", "Source floor not found");
    }

    if (sourceFloor.state !== "committed") {
      return sendError(reply, 409, "invalid_state", "Can only branch from a committed floor");
    }

    // 生成或使用指定的 branch_id
    const branchId = parsedBody.data.branch_id ?? `branch-${nanoid(8)}`;

    // 检查 branch_id 在该 session 中是否唯一
    const [existing] = await db
      .select({ id: floors.id })
      .from(floors)
      .where(
        and(
          eq(floors.sessionId, sourceFloor.sessionId),
          eq(floors.branchId, branchId)
        )
      )
      .limit(1);

    if (existing) {
      return sendError(reply, 409, "branch_exists", `Branch '${branchId}' already exists in this session`);
    }

    return reply.code(201).send({
      data: {
        branch_id: branchId,
        source_floor_id: sourceFloor.id,
        source_floor_no: sourceFloor.floorNo,
        session_id: sourceFloor.sessionId,
      },
    });
  });

  app.delete("/branches/:id", {
    schema: {
      tags: ["floors"],
      summary: "Delete branch",
      params: idParamsJsonSchema,
      querystring: {
        type: "object",
        properties: {
          session_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: {
            data: {
              type: "object",
              required: ["branch_id", "session_id", "deleted_floor_count"],
              properties: {
                branch_id: { type: "string" },
                session_id: { type: "string" },
                deleted_floor_count: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(branchParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(deleteBranchQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const branchId = parsedParams.data.id;

    if (branchId === "main") {
      return sendError(reply, 409, "protected_branch", "Main branch cannot be deleted");
    }

    const conditions = [eq(floors.branchId, branchId)];
    if (parsedQuery.data.session_id) {
      conditions.push(eq(floors.sessionId, parsedQuery.data.session_id));
    }

    const matchedRows = await db
      .select({ sessionId: floors.sessionId })
      .from(floors)
      .where(and(...conditions));

    if (matchedRows.length === 0) {
      return sendError(reply, 404, "not_found", "Branch not found");
    }

    const sessionIds = Array.from(new Set(matchedRows.map((row) => row.sessionId)));

    if (!parsedQuery.data.session_id && sessionIds.length > 1) {
      return sendError(
        reply,
        409,
        "ambiguous_branch",
        "Branch id exists in multiple sessions, please provide session_id"
      );
    }

    const targetSessionId = parsedQuery.data.session_id ?? sessionIds[0];
    if (!targetSessionId) {
      return sendError(reply, 500, "internal_error", "Failed to resolve branch session");
    }

    const deletedRows = await db
      .delete(floors)
      .where(and(eq(floors.branchId, branchId), eq(floors.sessionId, targetSessionId)))
      .returning({ id: floors.id });

    return reply.send({
      data: {
        branch_id: branchId,
        session_id: targetSessionId,
        deleted_floor_count: deletedRows.length,
      }
    });
  });
}
