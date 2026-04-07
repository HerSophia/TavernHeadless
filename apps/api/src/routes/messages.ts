import { and, count, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { messages } from "../db/schema";
import { parseWithSchema, requireRow, sendError } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { getRequestAuthContext } from "../plugins/auth";
import { getFloorContentMutationRejection, type FloorContentMutationRejection } from "../services/floor-content-mutability-policy";
import { OwnedMessageRepository, OwnedPageRepository } from "../services/owned-resource-repositories";
import {
  mapSqliteConstraintErrorToRouteError,
  type SqliteConstraintErrorMapping,
} from "../services/resource-write.js";

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

const messageIdArraySchema = z.array(z.string().min(1)).min(1).max(100).superRefine((ids, ctx) => {
  const seen = new Map<string, number>();

  ids.forEach((id, index) => {
    const firstIndex = seen.get(id);

    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `Duplicate message id also appears at ids.${firstIndex}`
      });
      return;
    }

    seen.set(id, index);
  });
});

const batchUpdateMessageVisibilitySchema = z.object({
  ids: messageIdArraySchema,
  is_hidden: z.boolean()
});

const batchDeleteMessagesSchema = z.object({
  ids: messageIdArraySchema
});

const createMessageBodyExample = {
  page_id: "page_12",
  seq: 1,
  role: "assistant",
  content: "The fire settles into a steady glow.",
  content_format: "text",
  token_count: 128,
  is_hidden: false,
  source: "model"
} as const;

const messageExample = {
  id: "msg_21",
  ...createMessageBodyExample,
  created_at: 1735689720000
} as const;

const hiddenMessageExample = {
  ...messageExample,
  is_hidden: true
} as const;

const batchUpdateMessageVisibilityBodyExample = {
  ids: ["msg_21", "msg_missing"],
  is_hidden: true
} as const;

const batchUpdateMessageVisibilityResponseExample = {
  data: {
    results: [
      {
        index: 0,
        id: "msg_21",
        action: "updated",
        data: hiddenMessageExample
      },
      {
        index: 1,
        id: "msg_missing",
        action: "not_found"
      }
    ],
    meta: {
      total: 2,
      updated: 1,
      not_found: 1,
      is_hidden: true
    }
  }
} as const;

const batchDeleteMessagesBodyExample = {
  ids: ["msg_21", "msg_missing"]
} as const;

const batchDeleteMessagesResponseExample = {
  data: {
    results: [
      {
        index: 0,
        id: "msg_21",
        action: "deleted"
      },
      {
        index: 1,
        id: "msg_missing",
        action: "not_found"
      }
    ],
    meta: {
      total: 2,
      deleted: 1,
      not_found: 1
    }
  }
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
  examples: [createMessageBodyExample],
  additionalProperties: false,
} as const;

const messageBatchIdsJsonSchema = {
  type: "array",
  minItems: 1,
  maxItems: 100,
  items: { type: "string", minLength: 1 },
} as const;

const batchUpdateMessageVisibilityBodyJsonSchema = {
  type: "object",
  required: ["ids", "is_hidden"],
  properties: {
    ids: messageBatchIdsJsonSchema,
    is_hidden: { type: "boolean" },
  },
  examples: [batchUpdateMessageVisibilityBodyExample],
  additionalProperties: false,
} as const;

const batchDeleteMessagesBodyJsonSchema = {
  type: "object",
  required: ["ids"],
  properties: {
    ids: messageBatchIdsJsonSchema,
  },
  examples: [batchDeleteMessagesBodyExample],
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
  examples: [messageExample],
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

const batchUpdateMessageVisibilityResultJsonSchema = {
  type: "object",
  required: ["index", "id", "action"],
  properties: {
    index: { type: "integer", minimum: 0 },
    id: { type: "string" },
    action: { type: "string", enum: ["updated", "not_found"] },
    data: messageJsonSchema,
  },
  additionalProperties: false,
} as const;

const batchUpdateMessageVisibilityMetaJsonSchema = {
  type: "object",
  required: ["total", "updated", "not_found", "is_hidden"],
  properties: {
    total: { type: "integer", minimum: 1 },
    updated: { type: "integer", minimum: 0 },
    not_found: { type: "integer", minimum: 0 },
    is_hidden: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const batchUpdateMessageVisibilityResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results", "meta"],
      properties: {
        results: {
          type: "array",
          items: batchUpdateMessageVisibilityResultJsonSchema,
        },
        meta: batchUpdateMessageVisibilityMetaJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [batchUpdateMessageVisibilityResponseExample],
  additionalProperties: false,
} as const;

const batchDeleteMessageResultJsonSchema = {
  type: "object",
  required: ["index", "id", "action"],
  properties: {
    index: { type: "integer", minimum: 0 },
    id: { type: "string" },
    action: { type: "string", enum: ["deleted", "not_found"] },
  },
  additionalProperties: false,
} as const;

const batchDeleteMessagesMetaJsonSchema = {
  type: "object",
  required: ["total", "deleted", "not_found"],
  properties: {
    total: { type: "integer", minimum: 1 },
    deleted: { type: "integer", minimum: 0 },
    not_found: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const batchDeleteMessagesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results", "meta"],
      properties: {
        results: {
          type: "array",
          items: batchDeleteMessageResultJsonSchema,
        },
        meta: batchDeleteMessagesMetaJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [batchDeleteMessagesResponseExample],
  additionalProperties: false,
} as const;

type MessageRowLike = {
  id: string;
  pageId: string;
  seq: number;
  role: typeof messages.$inferSelect["role"];
  content: string;
  contentFormat: typeof messages.$inferSelect["contentFormat"];
  tokenCount: number;
  isHidden: boolean;
  source: string | null;
  createdAt: number;
};

function toMessageResponse(row: MessageRowLike) {
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

function sendMessageMutationRejection(
  reply: Parameters<typeof sendError>[0],
  rejection: FloorContentMutationRejection
) {
  return sendError(reply, 409, rejection.code, rejection.message);
}

const MESSAGE_CONSTRAINT_MAPPINGS: SqliteConstraintErrorMapping[] = [
  {
    constraintName: "message_page_seq_uq",
    fallbackPatterns: ["message.page_id, message.seq"],
    statusCode: 409,
    code: "message_conflict",
    message: "Message sequence already exists in the target page",
  },
];
const mapMessageWriteError = (error: unknown) => mapSqliteConstraintErrorToRouteError(error, MESSAGE_CONSTRAINT_MAPPINGS);

export async function registerMessageRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;
  const ownedPages = new OwnedPageRepository(db);
  const ownedMessages = new OwnedMessageRepository(db);

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
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createMessageSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const page = ownedPages.getContextById(auth.accountId, parsedBody.data.page_id);

    if (!page) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }

    const rejection = getFloorContentMutationRejection({
      mutationKind: "message.create",
      floorState: page.floorState,
      floorSupersededAt: page.floorSupersededAt,
      pageKind: page.pageKind,
    });

    if (rejection) {
      return sendMessageMutationRejection(reply, rejection);
    }

    let createdRows;
    try {
      createdRows = await db
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
    } catch (error) {
      const mapped = mapMessageWriteError(error);
      if (mapped) {
        return sendError(reply, mapped.statusCode, mapped.code, mapped.message);
      }
      throw error;
    }

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

    const auth = getRequestAuthContext(request);
    const ownedPageIds = ownedPages.listIds(
      auth.accountId,
      parsedQuery.data.page_id !== undefined ? [parsedQuery.data.page_id] : undefined
    );

    if (ownedPageIds.length === 0) {
      return reply.send({
        data: [],
        meta: buildListMeta({
          total: 0,
          limit: parsedQuery.data.limit,
          offset: parsedQuery.data.offset,
          sortBy: parsedQuery.data.sort_by,
          sortOrder: parsedQuery.data.sort_order
        })
      });
    }

    const filters = [inArray(messages.pageId, ownedPageIds)];

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

  app.patch("/messages/batch/visibility", {
    schema: {
      tags: ["messages"],
      summary: "Batch update message visibility",
      operationId: "batchUpdateMessageVisibility",
      body: batchUpdateMessageVisibilityBodyJsonSchema,
      response: {
        200: batchUpdateMessageVisibilityResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(batchUpdateMessageVisibilitySchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const ownedMessageContexts = ownedMessages.getContextsByIds(auth.accountId, parsedBody.data.ids);
    const ownedMessageIds = ownedMessageContexts.map((message) => message.id);
    const mutationKind = parsedBody.data.is_hidden ? "message.hide" : "message.unhide";

    const lockedMessage = ownedMessageContexts.find((message) =>
      getFloorContentMutationRejection({
        mutationKind,
        floorState: message.floorState,
        floorSupersededAt: message.floorSupersededAt,
        pageKind: message.pageKind,
      }) !== null
    );

    if (lockedMessage) {
      return sendMessageMutationRejection(reply, getFloorContentMutationRejection({
        mutationKind,
        floorState: lockedMessage.floorState,
        floorSupersededAt: lockedMessage.floorSupersededAt,
        pageKind: lockedMessage.pageKind,
      })!);
    }

    const updatedRows =
      ownedMessageIds.length === 0
        ? []
        : await db
            .update(messages)
            .set({
              isHidden: parsedBody.data.is_hidden,
            })
            .where(inArray(messages.id, ownedMessageIds))
            .returning();

    const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
    const results = parsedBody.data.ids.map((id, index) => {
      const row = updatedById.get(id);

      if (!row) {
        return { index, id, action: "not_found" as const };
      }

      return {
        index,
        id,
        action: "updated" as const,
        data: toMessageResponse(row)
      };
    });

    return reply.send({
      data: {
        results,
        meta: {
          total: results.length,
          updated: updatedRows.length,
          not_found: results.length - updatedRows.length,
          is_hidden: parsedBody.data.is_hidden
        }
      }
    });
  });

  app.post("/messages/batch/delete", {
    schema: {
      tags: ["messages"],
      summary: "Batch delete messages",
      operationId: "batchDeleteMessages",
      body: batchDeleteMessagesBodyJsonSchema,
      response: {
        200: batchDeleteMessagesResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(batchDeleteMessagesSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const ownedMessageContexts = ownedMessages.getContextsByIds(auth.accountId, parsedBody.data.ids);
    const ownedMessageIds = ownedMessageContexts.map((message) => message.id);

    const lockedMessage = ownedMessageContexts.find((message) =>
      getFloorContentMutationRejection({
        mutationKind: "message.delete",
        floorState: message.floorState,
        floorSupersededAt: message.floorSupersededAt,
        pageKind: message.pageKind,
      }) !== null
    );
    if (lockedMessage) {
      return sendMessageMutationRejection(reply, getFloorContentMutationRejection({
        mutationKind: "message.delete",
        floorState: lockedMessage.floorState,
        floorSupersededAt: lockedMessage.floorSupersededAt,
        pageKind: lockedMessage.pageKind,
      })!);
    }

    const deletedRows =
      ownedMessageIds.length === 0
        ? []
        : await db
            .delete(messages)
            .where(inArray(messages.id, ownedMessageIds))
            .returning();

    const deletedIds = new Set(deletedRows.map((row) => row.id));
    const results = parsedBody.data.ids.map((id, index) => ({
      index,
      id,
      action: deletedIds.has(id) ? ("deleted" as const) : ("not_found" as const)
    }));

    return reply.send({
      data: {
        results,
        meta: {
          total: results.length,
          deleted: deletedRows.length,
          not_found: results.length - deletedRows.length
        }
      }
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

    const auth = getRequestAuthContext(request);
    const row = ownedMessages.getContextById(auth.accountId, parsedParams.data.id);

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
        409: errorResponseJsonSchema,
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

    const auth = getRequestAuthContext(request);
    const existingMessage = ownedMessages.getContextById(auth.accountId, parsedParams.data.id);

    if (!existingMessage) {
      return sendError(reply, 404, "not_found", "Message not found");
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

    const rejection = getFloorContentMutationRejection({
      mutationKind: "message.update",
      floorState: existingMessage.floorState,
      floorSupersededAt: existingMessage.floorSupersededAt,
      pageKind: existingMessage.pageKind,
    });
    if (rejection) return sendMessageMutationRejection(reply, rejection);

    let updated;
    try {
      [updated] = await db
        .update(messages)
        .set(updates)
        .where(eq(messages.id, existingMessage.id))
        .returning();
    } catch (error) {
      const mapped = mapMessageWriteError(error);
      if (mapped) {
        return sendError(reply, mapped.statusCode, mapped.code, mapped.message);
      }
      throw error;
    }

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
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(messageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const existingMessage = ownedMessages.getContextById(auth.accountId, parsedParams.data.id);

    if (!existingMessage) {
      return sendError(reply, 404, "not_found", "Message not found");
    }

    const rejection = getFloorContentMutationRejection({
      mutationKind: "message.delete",
      floorState: existingMessage.floorState,
      floorSupersededAt: existingMessage.floorSupersededAt,
      pageKind: existingMessage.pageKind,
    });
    if (rejection) return sendMessageMutationRejection(reply, rejection);

    const deleted = await db.delete(messages).where(eq(messages.id, parsedParams.data.id)).returning();

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Message not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });
}
