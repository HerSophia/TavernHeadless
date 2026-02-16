import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { messages } from "../db/schema";
import { parseWithSchema, requireRow, sendError } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";

const messageRoleSchema = z.enum(["user", "assistant", "system", "narrator"]);
const messageFormatSchema = z.enum(["text", "markdown", "json"]);

const messageParamsSchema = z.object({
  id: z.string().min(1)
});

const listMessagesQuerySchema = listQuerySchemaBase.extend({
  page_id: z.string().min(1).optional(),
  role: messageRoleSchema.optional(),
  is_hidden: z.coerce.boolean().optional(),
  sort_by: z.enum(["created_at", "seq"]).default("created_at")
});

const createMessageSchema = z.object({
  page_id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  role: messageRoleSchema,
  content: z.string().min(1),
  content_format: messageFormatSchema.optional(),
  token_count: z.number().int().nonnegative().optional(),
  is_hidden: z.boolean().optional(),
  source: z.string().min(1).optional()
});

const updateMessageSchema = z
  .object({
    seq: z.number().int().nonnegative().optional(),
    role: messageRoleSchema.optional(),
    content: z.string().min(1).optional(),
    content_format: messageFormatSchema.optional(),
    token_count: z.number().int().nonnegative().optional(),
    is_hidden: z.boolean().optional(),
    source: z.string().min(1).optional()
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

const listMessagesQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at", "seq"] },
    page_id: { type: "string", minLength: 1 },
    role: { type: "string", enum: ["user", "assistant", "system", "narrator"] },
    is_hidden: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const messageBodyJsonSchema = {
  type: "object",
  properties: {
    page_id: { type: "string", minLength: 1 },
    seq: { type: "integer", minimum: 0 },
    role: { type: "string", enum: ["user", "assistant", "system", "narrator"] },
    content: { type: "string", minLength: 1 },
    content_format: { type: "string", enum: ["text", "markdown", "json"] },
    token_count: { type: "integer", minimum: 0 },
    is_hidden: { type: "boolean" },
    source: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const messageJsonSchema = {
  type: "object",
  required: ["id", "page_id", "seq", "role", "content", "content_format", "token_count", "is_hidden", "source", "created_at"],
  properties: {
    id: { type: "string" },
    page_id: { type: "string" },
    seq: { type: "integer", minimum: 0 },
    role: { type: "string", enum: ["user", "assistant", "system", "narrator"] },
    content: { type: "string" },
    content_format: { type: "string", enum: ["text", "markdown", "json"] },
    token_count: { type: "integer", minimum: 0 },
    is_hidden: { type: "boolean" },
    source: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
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

function toMessageResponse(row: typeof messages.$inferSelect) {
  return {
    id: row.id,
    page_id: row.pageId,
    seq: row.seq,
    role: row.role,
    content: row.content,
    content_format: row.contentFormat,
    token_count: row.tokenCount,
    is_hidden: row.isHidden,
    source: row.source,
    created_at: row.createdAt
  };
}

export async function registerMessageRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;

  app.post("/messages", {
    schema: {
      tags: ["messages"],
      summary: "Create message",
      operationId: "createMessage",
      body: {
        ...messageBodyJsonSchema,
        required: ["page_id", "seq", "role", "content"],
      },
      response: {
        201: {
          type: "object",
          required: ["data"],
          properties: { data: messageJsonSchema },
          additionalProperties: false,
        },
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createMessageSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const createdRows = await db
      .insert(messages)
      .values({
        id: nanoid(),
        pageId: parsedBody.data.page_id,
        seq: parsedBody.data.seq,
        role: parsedBody.data.role,
        content: parsedBody.data.content,
        contentFormat: parsedBody.data.content_format ?? "text",
        tokenCount: parsedBody.data.token_count ?? 0,
        isHidden: parsedBody.data.is_hidden ?? false,
        source: parsedBody.data.source ?? null,
        createdAt: Date.now()
      })
      .returning();

    const created = requireRow(createdRows[0], "Failed to create message");

    return reply.code(201).send({ data: toMessageResponse(created) });
  });

  app.get("/messages", {
    schema: {
      tags: ["messages"],
      summary: "List messages",
      operationId: "listMessages",
      querystring: listMessagesQueryJsonSchema,
      response: {
        200: {
          type: "object",
          required: ["data", "meta"],
          properties: { data: { type: "array", items: messageJsonSchema }, meta: listMetaJsonSchema },
          additionalProperties: false,
        },
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listMessagesQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const filters = [];

    if (parsedQuery.data.page_id !== undefined) {
      filters.push(eq(messages.pageId, parsedQuery.data.page_id));
    }

    if (parsedQuery.data.role !== undefined) {
      filters.push(eq(messages.role, parsedQuery.data.role));
    }

    if (parsedQuery.data.is_hidden !== undefined) {
      filters.push(eq(messages.isHidden, parsedQuery.data.is_hidden));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;
    const sortByColumn = parsedQuery.data.sort_by === "seq" ? messages.seq : messages.createdAt;

    const rows =
      whereClause === undefined
        ? await db
            .select()
            .from(messages)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset)
        : await db
            .select()
            .from(messages)
            .where(whereClause)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset);

    const totalRows =
      whereClause === undefined
        ? await db.select({ total: count() }).from(messages)
        : await db.select({ total: count() }).from(messages).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toMessageResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/messages/:id", {
    schema: {
      tags: ["messages"],
      summary: "Get message",
      operationId: "getMessage",
      params: idParamsJsonSchema,
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: { data: messageJsonSchema },
          additionalProperties: false,
        },
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(messageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const [row] = await db.select().from(messages).where(eq(messages.id, parsedParams.data.id));

    if (!row) {
      return sendError(reply, 404, "not_found", "Message not found");
    }

    return reply.send({ data: toMessageResponse(row) });
  });

  app.patch("/messages/:id", {
    schema: {
      tags: ["messages"],
      summary: "Update message",
      operationId: "updateMessage",
      params: idParamsJsonSchema,
      body: {
        ...messageBodyJsonSchema,
        minProperties: 1,
      },
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: { data: messageJsonSchema },
          additionalProperties: false,
        },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(messageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(updateMessageSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const updates: Partial<typeof messages.$inferInsert> = {};

    if (parsedBody.data.seq !== undefined) {
      updates.seq = parsedBody.data.seq;
    }

    if (parsedBody.data.role !== undefined) {
      updates.role = parsedBody.data.role;
    }

    if (parsedBody.data.content !== undefined) {
      updates.content = parsedBody.data.content;
    }

    if (parsedBody.data.content_format !== undefined) {
      updates.contentFormat = parsedBody.data.content_format;
    }

    if (parsedBody.data.token_count !== undefined) {
      updates.tokenCount = parsedBody.data.token_count;
    }

    if (parsedBody.data.is_hidden !== undefined) {
      updates.isHidden = parsedBody.data.is_hidden;
    }

    if (parsedBody.data.source !== undefined) {
      updates.source = parsedBody.data.source;
    }

    const [updated] = await db
      .update(messages)
      .set(updates)
      .where(eq(messages.id, parsedParams.data.id))
      .returning();

    if (!updated) {
      return sendError(reply, 404, "not_found", "Message not found");
    }

    return reply.send({ data: toMessageResponse(updated) });
  });

  app.delete("/messages/:id", {
    schema: {
      tags: ["messages"],
      summary: "Delete message",
      operationId: "deleteMessage",
      params: idParamsJsonSchema,
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: {
            data: {
              type: "object",
              required: ["id", "deleted"],
              properties: { id: { type: "string" }, deleted: { type: "boolean" } },
            },
          },
        },
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(messageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const deleted = await db.delete(messages).where(eq(messages.id, parsedParams.data.id)).returning();

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Message not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });
}
