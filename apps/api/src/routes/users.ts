import { and, count, eq, like, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema, batchIdArraySchema, batchDeleteBodyJsonSchema, batchStatusBodyJsonSchema, batchResultResponseJsonSchema } from "./schemas/common.js";
import { accountUsers } from "../db/schema";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { parseJsonField, parseWithSchema, sendError, stringifyJsonField } from "../lib/http";
import { getRequestAuthContext } from "../plugins/auth";

const userStatusSchema = z.enum(["active", "disabled", "deleted"]);

const userSnapshotSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional()
  })
  .passthrough();

const userParamsSchema = z.object({
  id: z.string().trim().min(1)
});

const listUsersQuerySchema = listQuerySchemaBase.extend({
  include_deleted: z.coerce.boolean().default(false),
  status: userStatusSchema.optional(),
  keyword: z.string().trim().min(1).max(200).optional(),
  sort_by: z.enum(["created_at", "updated_at", "name"]).default("updated_at")
});

const createUserSchema = z.object({
  snapshot: userSnapshotSchema
});

const updateUserSchema = z
  .object({
    snapshot: userSnapshotSchema.optional(),
    status: z.enum(["active", "disabled"]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const userSnapshotExample = {
  name: "Alice",
  description: "A calm strategist who keeps concise notes."
} as const;

const userBodyExample = {
  snapshot: userSnapshotExample,
  status: "active"
} as const;

const userExample = {
  id: "usr_demo",
  name: "Alice",
  status: "active",
  snapshot: userSnapshotExample,
  created_at: 1735689600000,
  updated_at: 1735689600000
} as const;

const userListMetaExample = {
  total: 1,
  limit: 20,
  offset: 0,
  has_more: false,
  sort_by: "updated_at",
  sort_order: "desc"
} as const;

const userResponseExample = {
  data: userExample
} as const;

const userListResponseExample = {
  data: [userExample],
  meta: userListMetaExample
} as const;

const userDeleteResponseExample = {
  data: {
    id: "usr_demo",
    deleted: true
  }
} as const;


const listQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at", "updated_at", "name"] },
    include_deleted: { type: "boolean", default: false },
    status: { type: "string", enum: ["active", "disabled", "deleted"] },
    keyword: { type: "string", minLength: 1, maxLength: 200 }
  },
  additionalProperties: false
} as const;

const userBodyJsonSchema = {
  type: "object",
  properties: {
    snapshot: { type: "object", additionalProperties: true },
    status: { type: "string", enum: ["active", "disabled"] }
  },
  examples: [userBodyExample],
  additionalProperties: false
} as const;

const userJsonSchema = {
  type: "object",
  required: ["id", "name", "status", "snapshot", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["active", "disabled", "deleted"] },
    snapshot: { type: "object", additionalProperties: true },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 }
  },
  examples: [userExample],
  additionalProperties: false
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
    sort_order: { type: "string", enum: ["asc", "desc"] }
  },
  additionalProperties: false
} as const;


const userResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: userJsonSchema },
  examples: [userResponseExample],
  additionalProperties: false
} as const;

const userListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: userJsonSchema },
    meta: listMetaJsonSchema
  },
  examples: [userListResponseExample],
  additionalProperties: false
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
        deleted: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  examples: [userDeleteResponseExample],
  additionalProperties: false
} as const;

function toUserResponse(row: typeof accountUsers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    snapshot: parseJsonField(row.snapshotJson),
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

export async function registerUserRoutes(app: FastifyInstance, connection: DatabaseConnection): Promise<void> {
  const { db } = connection;

  app.post("/users", {
    schema: {
      tags: ["users"],
      summary: "Create user",
      body: {
        ...userBodyJsonSchema,
        required: ["snapshot"]
      },
      response: {
        201: userResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createUserSchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const now = Date.now();
    const snapshotJson = stringifyJsonField(parsedBody.data.snapshot) ?? "{}";

    const [existingByName] = await db
      .select({ id: accountUsers.id })
      .from(accountUsers)
      .where(and(eq(accountUsers.accountId, auth.accountId), eq(accountUsers.name, parsedBody.data.snapshot.name)))
      .limit(1);

    if (existingByName) {
      return sendError(reply, 409, "user_conflict", `User name already exists: ${parsedBody.data.snapshot.name}`);
    }

    const [created] = await db
      .insert(accountUsers)
      .values({
        id: nanoid(),
        accountId: auth.accountId,
        name: parsedBody.data.snapshot.name,
        snapshotJson,
        status: "active",
        createdAt: now,
        updatedAt: now
      })
      .returning();

    return reply.code(201).send({ data: toUserResponse(created!) });
  });

  app.get("/users", {
    schema: {
      tags: ["users"],
      summary: "List users",
      querystring: listQueryJsonSchema,
      response: {
        200: userListResponseJsonSchema,
        400: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listUsersQuerySchema, request.query, reply);
    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const filters = [eq(accountUsers.accountId, auth.accountId)];

    if (parsedQuery.data.status !== undefined) {
      filters.push(eq(accountUsers.status, parsedQuery.data.status));
    } else if (!parsedQuery.data.include_deleted) {
      filters.push(or(eq(accountUsers.status, "active"), eq(accountUsers.status, "disabled"))!);
    }

    if (parsedQuery.data.keyword) {
      filters.push(like(accountUsers.name, `%${parsedQuery.data.keyword}%`));
    }

    const whereClause = and(...filters.filter(Boolean));
    const sortByColumn =
      parsedQuery.data.sort_by === "name"
        ? accountUsers.name
        : parsedQuery.data.sort_by === "created_at"
          ? accountUsers.createdAt
          : accountUsers.updatedAt;

    const rows = await db
      .select()
      .from(accountUsers)
      .where(whereClause)
      .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
      .limit(parsedQuery.data.limit)
      .offset(parsedQuery.data.offset);

    const [totalRow] = await db.select({ total: count() }).from(accountUsers).where(whereClause);

    return reply.send({
      data: rows.map(toUserResponse),
      meta: buildListMeta({
        total: Number(totalRow?.total ?? 0),
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/users/:id", {
    schema: {
      tags: ["users"],
      summary: "Get user",
      params: idParamsJsonSchema,
      response: {
        200: userResponseJsonSchema,
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(userParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [row] = await db
      .select()
      .from(accountUsers)
      .where(and(eq(accountUsers.id, parsedParams.data.id), eq(accountUsers.accountId, auth.accountId)))
      .limit(1);

    if (!row || row.status === "deleted") {
      return sendError(reply, 404, "not_found", "User not found");
    }

    return reply.send({ data: toUserResponse(row) });
  });

  app.patch("/users/:id", {
    schema: {
      tags: ["users"],
      summary: "Update user",
      params: idParamsJsonSchema,
      body: {
        ...userBodyJsonSchema,
        minProperties: 1
      },
      response: {
        200: userResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(userParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(updateUserSchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [existing] = await db
      .select()
      .from(accountUsers)
      .where(and(eq(accountUsers.id, parsedParams.data.id), eq(accountUsers.accountId, auth.accountId)))
      .limit(1);

    if (!existing || existing.status === "deleted") {
      return sendError(reply, 404, "not_found", "User not found");
    }

    const updates: Partial<typeof accountUsers.$inferInsert> = {
      updatedAt: Date.now()
    };

    if (parsedBody.data.snapshot) {
      const name = parsedBody.data.snapshot.name;
      if (name !== existing.name) {
        const [conflict] = await db
          .select({ id: accountUsers.id })
          .from(accountUsers)
          .where(and(eq(accountUsers.accountId, auth.accountId), eq(accountUsers.name, name)))
          .limit(1);
        if (conflict && conflict.id !== existing.id) {
          return sendError(reply, 409, "user_conflict", `User name already exists: ${name}`);
        }
      }

      updates.name = parsedBody.data.snapshot.name;
      updates.snapshotJson = stringifyJsonField(parsedBody.data.snapshot) ?? existing.snapshotJson;
    }

    if (parsedBody.data.status) {
      updates.status = parsedBody.data.status;
    }

    const [updated] = await db
      .update(accountUsers)
      .set(updates)
      .where(and(eq(accountUsers.id, existing.id), eq(accountUsers.accountId, auth.accountId)))
      .returning();

    if (!updated) {
      return sendError(reply, 404, "not_found", "User not found");
    }

    return reply.send({ data: toUserResponse(updated) });
  });

  app.delete("/users/:id", {
    schema: {
      tags: ["users"],
      summary: "Delete user",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(userParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [updated] = await db
      .update(accountUsers)
      .set({ status: "deleted", updatedAt: Date.now() })
      .where(and(eq(accountUsers.id, parsedParams.data.id), eq(accountUsers.accountId, auth.accountId)))
      .returning();

    if (!updated) {
      return sendError(reply, 404, "not_found", "User not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });

  // ── Batch Operations ────────────────────────────────

  /** PATCH /users/batch/status — 批量更新用户状态 */
  app.patch("/users/batch/status", {
    schema: {
      tags: ["users"],
      summary: "Batch update user status",
      operationId: "batchUpdateUserStatus",
      body: batchStatusBodyJsonSchema(["active", "disabled"]),
      response: {
        200: batchResultResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const bodyParsed = parseWithSchema(
      z.object({ ids: batchIdArraySchema, status: z.enum(["active", "disabled"]) }),
      request.body,
      reply
    );
    if (!bodyParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { ids, status } = bodyParsed.data;
    const results: { index: number; id: string; action: string }[] = [];
    let updated = 0;
    let notFound = 0;

    db.transaction((tx) => {
      ids.forEach((id, index) => {
        const [row] = tx
          .select({ id: accountUsers.id, status: accountUsers.status })
          .from(accountUsers)
          .where(and(eq(accountUsers.id, id), eq(accountUsers.accountId, auth.accountId)))
          .all();

        if (!row || row.status === "deleted") {
          results.push({ index, id, action: "not_found" });
          notFound++;
        } else {
          tx.update(accountUsers).set({ status, updatedAt: Date.now() }).where(eq(accountUsers.id, id)).run();
          results.push({ index, id, action: "updated" });
          updated++;
        }
      });
    });

    return reply.send({
      data: { results, meta: { total: ids.length, updated, not_found: notFound, status } },
    });
  });

  /** POST /users/batch/delete — 批量删除用户（软删除） */
  app.post("/users/batch/delete", {
    schema: {
      tags: ["users"],
      summary: "Batch delete users",
      operationId: "batchDeleteUsers",
      body: batchDeleteBodyJsonSchema,
      response: {
        200: batchResultResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const bodyParsed = parseWithSchema(z.object({ ids: batchIdArraySchema }), request.body, reply);
    if (!bodyParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { ids } = bodyParsed.data;
    const results: { index: number; id: string; action: string }[] = [];
    let deleted = 0;
    let notFound = 0;

    db.transaction((tx) => {
      ids.forEach((id, index) => {
        const [row] = tx
          .select({ id: accountUsers.id, status: accountUsers.status })
          .from(accountUsers)
          .where(and(eq(accountUsers.id, id), eq(accountUsers.accountId, auth.accountId)))
          .all();

        if (!row || row.status === "deleted") {
          results.push({ index, id, action: "not_found" });
          notFound++;
        } else {
          tx.update(accountUsers).set({ status: "deleted", updatedAt: Date.now() }).where(eq(accountUsers.id, id)).run();
          results.push({ index, id, action: "deleted" });
          deleted++;
        }
      });
    });

    return reply.send({
      data: { results, meta: { total: ids.length, deleted, not_found: notFound } },
    });
  });
}
