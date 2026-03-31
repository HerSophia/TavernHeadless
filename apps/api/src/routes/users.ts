import { and, count, eq, like, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection, DbExecutor } from "../db/client";
import { accountUsers } from "../db/schema";
import { ensureOptionalObjectBody, parseJsonField, parseWithSchema, sendError, stringifyJsonField } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  ResourceWriteRouteError,
  USER_NAME_CONSTRAINT_MAPPING,
  assertRevisionWriteApplied,
  executeResourceWrite,
  withResourceWriteCas,
} from "../services/resource-write.js";
import {
  batchDeleteBodyJsonSchema,
  batchIdArraySchema,
  batchResultResponseJsonSchema,
  batchStatusBodyJsonSchema,
  errorResponseJsonSchema,
  idParamsJsonSchema,
} from "./schemas/common.js";

const userStatusSchema = z.enum(["active", "disabled", "deleted"]);
const expectedRevisionSchema = z.number().int().nonnegative().optional();

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
    status: z.enum(["active", "disabled"]).optional(),
    expected_revision: expectedRevisionSchema
  })
  .refine((value) => Object.keys(value).some((key) => key !== "expected_revision"), "At least one field is required");

const deleteUserBodySchema = z.object({
  expected_revision: expectedRevisionSchema
}).default({});

const userSnapshotExample = {
  name: "Alice",
  description: "A calm strategist who keeps concise notes."
} as const;

const userCreateBodyExample = {
  snapshot: userSnapshotExample
} as const;

const userUpdateBodyExample = {
  snapshot: userSnapshotExample,
  status: "active",
  expected_revision: 3
} as const;

const userExample = {
  id: "usr_demo",
  name: "Alice",
  status: "active",
  snapshot: userSnapshotExample,
  revision: 0,
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
    deleted: true,
    revision: 1
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

const createUserBodyJsonSchema = {
  type: "object",
  required: ["snapshot"],
  properties: {
    snapshot: { type: "object", additionalProperties: true }
  },
  examples: [userCreateBodyExample],
  additionalProperties: false
} as const;

const updateUserBodyJsonSchema = {
  type: "object",
  properties: {
    snapshot: { type: "object", additionalProperties: true },
    status: { type: "string", enum: ["active", "disabled"] },
    expected_revision: { type: "integer", minimum: 0 }
  },
  examples: [userUpdateBodyExample],
  additionalProperties: false,
  minProperties: 1
} as const;

const deleteUserBodyJsonSchema = {
  type: "object",
  properties: {
    expected_revision: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;

const userJsonSchema = {
  type: "object",
  required: ["id", "name", "status", "snapshot", "revision", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["active", "disabled", "deleted"] },
    snapshot: { type: "object", additionalProperties: true },
    revision: { type: "integer", minimum: 0 },
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
      required: ["id", "deleted", "revision"],
      properties: {
        id: { type: "string" },
        deleted: { type: "boolean" },
        revision: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    }
  },
  examples: [userDeleteResponseExample],
  additionalProperties: false
} as const;

function loadOwnedUser(tx: DbExecutor, userId: string, accountId: string) {
  return tx
    .select()
    .from(accountUsers)
    .where(and(eq(accountUsers.id, userId), eq(accountUsers.accountId, accountId)))
    .limit(1)
    .get();
}

function toUserResponse(row: typeof accountUsers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    snapshot: parseJsonField(row.snapshotJson),
    revision: row.revision,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

function createUserRevisionConflictError() {
  return new ResourceWriteRouteError(409, "user_revision_conflict", "User has been modified by another operation");
}

function sendUserWriteError(reply: Parameters<typeof sendError>[0], error: ResourceWriteRouteError) {
  return sendError(reply, error.statusCode, error.code, error.message, error.details);
}

export async function registerUserRoutes(app: FastifyInstance, connection: DatabaseConnection): Promise<void> {
  const { db } = connection;

  app.post("/users", {
    schema: {
      tags: ["users"],
      summary: "Create user",
      body: createUserBodyJsonSchema,
      response: {
        201: userResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createUserSchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const snapshotJson = stringifyJsonField(parsedBody.data.snapshot) ?? "{}";

    try {
      const created = await executeResourceWrite(
        () =>
          db.transaction((tx) => {
            const now = Date.now();
            const userId = nanoid();

            tx.insert(accountUsers).values({
              id: userId,
              accountId: auth.accountId,
              name: parsedBody.data.snapshot.name,
              snapshotJson,
              status: "active",
              revision: 0,
              createdAt: now,
              updatedAt: now
            }).run();

            return loadOwnedUser(tx, userId, auth.accountId);
          }),
        { constraintMappings: [USER_NAME_CONSTRAINT_MAPPING] }
      );

      if (!created) {
        throw new Error("Failed to create user");
      }

      return reply.code(201).send({ data: toUserResponse(created) });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendUserWriteError(reply, error);
      }

      throw error;
    }
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
      body: updateUserBodyJsonSchema,
      response: {
        200: userResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
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

    try {
      const updated = await withResourceWriteCas({
        db,
        expectedRevision: parsedBody.data.expected_revision,
        load: (tx) => loadOwnedUser(tx, parsedParams.data.id, auth.accountId),
        getRevision: (row) => row.revision,
        onMissing: () => new ResourceWriteRouteError(404, "not_found", "User not found"),
        onRevisionConflict: createUserRevisionConflictError,
        validateLoaded: (row) => {
          if (row.status === "deleted") {
            throw new ResourceWriteRouteError(404, "not_found", "User not found");
          }
        },
        constraintMappings: [USER_NAME_CONSTRAINT_MAPPING],
        mutate: ({ tx, row }) => {
          const now = Date.now();
          const updates: Partial<typeof accountUsers.$inferInsert> = {
            updatedAt: now,
            revision: row.revision + 1
          };

          if (parsedBody.data.snapshot) {
            updates.name = parsedBody.data.snapshot.name;
            updates.snapshotJson = stringifyJsonField(parsedBody.data.snapshot) ?? row.snapshotJson;
          }

          if (parsedBody.data.status) {
            updates.status = parsedBody.data.status;
          }

          const updateResult = tx
            .update(accountUsers)
            .set(updates)
            .where(and(eq(accountUsers.id, row.id), eq(accountUsers.accountId, auth.accountId), eq(accountUsers.revision, row.revision)))
            .run();

          assertRevisionWriteApplied(updateResult.changes, createUserRevisionConflictError);

          const refreshed = loadOwnedUser(tx, row.id, auth.accountId);
          if (!refreshed) {
            throw new Error("Failed to reload updated user");
          }

          return refreshed;
        }
      });

      return reply.send({ data: toUserResponse(updated) });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendUserWriteError(reply, error);
      }

      throw error;
    }
  });

  app.delete("/users/:id", {
    preValidation: (request, _reply, done) => {
      ensureOptionalObjectBody(request);
      done();
    },
    schema: {
      tags: ["users"],
      summary: "Delete user",
      params: idParamsJsonSchema,
      body: deleteUserBodyJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(userParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(deleteUserBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const deleted = await withResourceWriteCas({
        db,
        expectedRevision: parsedBody.data.expected_revision,
        load: (tx) => loadOwnedUser(tx, parsedParams.data.id, auth.accountId),
        getRevision: (row) => row.revision,
        onMissing: () => new ResourceWriteRouteError(404, "not_found", "User not found"),
        onRevisionConflict: createUserRevisionConflictError,
        validateLoaded: (row) => {
          if (row.status === "deleted") {
            throw new ResourceWriteRouteError(404, "not_found", "User not found");
          }
        },
        mutate: ({ tx, row }) => {
          const now = Date.now();
          const updateResult = tx
            .update(accountUsers)
            .set({ status: "deleted", updatedAt: now, revision: row.revision + 1 })
            .where(and(eq(accountUsers.id, row.id), eq(accountUsers.accountId, auth.accountId), eq(accountUsers.revision, row.revision)))
            .run();

          assertRevisionWriteApplied(updateResult.changes, createUserRevisionConflictError);

          return {
            id: row.id,
            revision: row.revision + 1
          };
        }
      });

      return reply.send({ data: { id: deleted.id, deleted: true, revision: deleted.revision } });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendUserWriteError(reply, error);
      }

      throw error;
    }
  });

  app.patch("/users/batch/status", {
    schema: {
      tags: ["users"],
      summary: "Batch update user status",
      operationId: "batchUpdateUserStatus",
      body: batchStatusBodyJsonSchema(["active", "disabled"]),
      response: {
        200: batchResultResponseJsonSchema,
        400: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
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

    try {
      const mutation = await executeResourceWrite(() => {
        const results: { index: number; id: string; action: string }[] = [];
        let updated = 0;
        let notFound = 0;

        db.transaction((tx) => {
          ids.forEach((id, index) => {
            const row = tx
              .select({ id: accountUsers.id, status: accountUsers.status, revision: accountUsers.revision })
              .from(accountUsers)
              .where(and(eq(accountUsers.id, id), eq(accountUsers.accountId, auth.accountId)))
              .limit(1)
              .get();

            if (!row || row.status === "deleted") {
              results.push({ index, id, action: "not_found" });
              notFound += 1;
              return;
            }

            tx.update(accountUsers)
              .set({ status, updatedAt: Date.now(), revision: row.revision + 1 })
              .where(eq(accountUsers.id, id))
              .run();

            results.push({ index, id, action: "updated" });
            updated += 1;
          });
        });

        return { results, meta: { total: ids.length, updated, not_found: notFound, status } };
      });

      return reply.send({ data: mutation });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendUserWriteError(reply, error);
      }

      throw error;
    }
  });

  app.post("/users/batch/delete", {
    schema: {
      tags: ["users"],
      summary: "Batch delete users",
      operationId: "batchDeleteUsers",
      body: batchDeleteBodyJsonSchema,
      response: {
        200: batchResultResponseJsonSchema,
        400: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const bodyParsed = parseWithSchema(z.object({ ids: batchIdArraySchema }), request.body, reply);
    if (!bodyParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { ids } = bodyParsed.data;

    try {
      const mutation = await executeResourceWrite(() => {
        const results: { index: number; id: string; action: string }[] = [];
        let deleted = 0;
        let notFound = 0;

        db.transaction((tx) => {
          ids.forEach((id, index) => {
            const row = tx
              .select({ id: accountUsers.id, status: accountUsers.status, revision: accountUsers.revision })
              .from(accountUsers)
              .where(and(eq(accountUsers.id, id), eq(accountUsers.accountId, auth.accountId)))
              .limit(1)
              .get();

            if (!row || row.status === "deleted") {
              results.push({ index, id, action: "not_found" });
              notFound += 1;
              return;
            }

            tx.update(accountUsers)
              .set({ status: "deleted", updatedAt: Date.now(), revision: row.revision + 1 })
              .where(eq(accountUsers.id, id))
              .run();

            results.push({ index, id, action: "deleted" });
            deleted += 1;
          });
        });

        return { results, meta: { total: ids.length, deleted, not_found: notFound } };
      });

      return reply.send({
        data: mutation,
      });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendUserWriteError(reply, error);
      }

      throw error;
    }
  });
}
