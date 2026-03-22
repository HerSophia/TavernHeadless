import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { variables } from "../db/schema";
import { parseJsonField, parseWithSchema, requireRow, sendError, stringifyJsonField } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";

const variableScopeSchema = z.enum(["global", "chat", "floor", "page"]);

const variableParamsSchema = z.object({
  id: z.string().min(1)
});

const listVariablesQuerySchema = listQuerySchemaBase.extend({
  scope: variableScopeSchema.optional(),
  scope_id: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  sort_by: z.enum(["updated_at", "key"]).default("updated_at")
});

const upsertVariableSchema = z.object({
  scope: variableScopeSchema,
  scope_id: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown()
});

type VariableWriteInput = z.infer<typeof upsertVariableSchema>;

type PreparedVariableWriteInput = VariableWriteInput & {
  valueJson: string;
};

const batchUpsertVariablesSchema = z.object({
  items: z.array(upsertVariableSchema).min(1).max(100)
}).superRefine((value, ctx) => {
  const seen = new Map<string, number>();

  value.items.forEach((item, index) => {
    const identity = buildVariableIdentity(item);
    const firstIndex = seen.get(identity);

    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index],
        message: `Duplicate variable target also appears at items.${firstIndex}`
      });
      return;
    }

    seen.set(identity, index);
  });
});

const upsertVariableBodyExample = {
  scope: "chat",
  scope_id: "session-a",
  key: "mood",
  value: { score: 20 }
} as const;

const variableExample = {
  id: "var_mood",
  scope: "chat",
  scope_id: "session-a",
  key: "mood",
  value: { score: 20 },
  updated_at: 1735689720000
} as const;

const variableResponseExample = {
  data: variableExample
} as const;

const variableListResponseExample = {
  data: [variableExample],
  meta: {
    total: 1,
    limit: 10,
    offset: 0,
    has_more: false,
    sort_by: "updated_at",
    sort_order: "desc"
  }
} as const;

const deleteVariableResponseExample = {
  data: { id: "var_mood", deleted: true }
} as const;

const batchUpsertVariablesBodyExample = {
  items: [
    upsertVariableBodyExample,
    {
      scope: "chat",
      scope_id: "session-a",
      key: "topic",
      value: "campfire"
    }
  ]
} as const;

const batchUpsertVariablesResponseExample = {
  data: {
    results: [
      {
        index: 0,
        action: "updated",
        data: variableExample
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
          updated_at: 1735689720000
        }
      }
    ],
    meta: {
      total: 2,
      created: 1,
      updated: 1
    }
  }
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

function toVariableResponse(row: typeof variables.$inferSelect) {
  return {
    id: row.id,
    scope: row.scope,
    scope_id: row.scopeId,
    key: row.key,
    value: parseJsonField(row.valueJson),
    updated_at: row.updatedAt
  };
}

function buildVariableIdentity(input: Pick<VariableWriteInput, "scope" | "scope_id" | "key">) {
  return `${input.scope}\u0000${input.scope_id}\u0000${input.key}`;
}

function toVariableResponseFromInput(input: VariableWriteInput, id: string, updatedAt: number) {
  return {
    id,
    scope: input.scope,
    scope_id: input.scope_id,
    key: input.key,
    value: input.value,
    updated_at: updatedAt
  };
}

export async function registerVariableRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;

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
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(upsertVariableSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const now = Date.now();

    const [existing] = await db
      .select()
      .from(variables)
      .where(
        and(
          eq(variables.scope, parsedBody.data.scope),
          eq(variables.scopeId, parsedBody.data.scope_id),
          eq(variables.key, parsedBody.data.key)
        )
      );

    const valueJson = stringifyJsonField(parsedBody.data.value);

    if (valueJson === null) {
      return sendError(reply, 400, "validation_error", "Variable value cannot be undefined");
    }

    if (existing) {
      const updatedRows = await db
        .update(variables)
        .set({
          valueJson,
          updatedAt: now
        })
        .where(eq(variables.id, existing.id))
        .returning();

      const updated = requireRow(updatedRows[0], "Failed to update variable");

      return reply.send({ data: toVariableResponse(updated) });
    }

    const createdRows = await db
      .insert(variables)
      .values({
        id: nanoid(),
        scope: parsedBody.data.scope,
        scopeId: parsedBody.data.scope_id,
        key: parsedBody.data.key,
        valueJson,
        updatedAt: now
      })
      .returning();

    const created = requireRow(createdRows[0], "Failed to create variable");

    return reply.code(201).send({ data: toVariableResponse(created) });
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
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(batchUpsertVariablesSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const preparedItems: PreparedVariableWriteInput[] = [];

    for (const item of parsedBody.data.items) {
      const valueJson = stringifyJsonField(item.value);

      if (valueJson === null) {
        return sendError(reply, 400, "validation_error", "Variable value cannot be undefined");
      }

      preparedItems.push({
        ...item,
        valueJson,
      });
    }

    const now = Date.now();
    const batchResult = db.transaction((tx) => {
      let created = 0;
      let updated = 0;

      const results = preparedItems.map((item, index) => {
        const existing = tx
          .select({ id: variables.id })
          .from(variables)
          .where(and(eq(variables.scope, item.scope), eq(variables.scopeId, item.scope_id), eq(variables.key, item.key)))
          .limit(1)
          .get();

        if (existing) {
          tx.update(variables).set({ valueJson: item.valueJson, updatedAt: now }).where(eq(variables.id, existing.id)).run();
          updated += 1;
          return { index, action: "updated" as const, data: toVariableResponseFromInput(item, existing.id, now) };
        }

        const id = nanoid();
        tx.insert(variables).values({ id, scope: item.scope, scopeId: item.scope_id, key: item.key, valueJson: item.valueJson, updatedAt: now }).run();
        created += 1;
        return { index, action: "created" as const, data: toVariableResponseFromInput(item, id, now) };
      });

      return {
        results,
        meta: { total: results.length, created, updated }
      };
    });

    return reply.send({ data: batchResult });
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

    const filters = [];

    if (parsedQuery.data.scope !== undefined) {
      filters.push(eq(variables.scope, parsedQuery.data.scope));
    }

    if (parsedQuery.data.scope_id !== undefined) {
      filters.push(eq(variables.scopeId, parsedQuery.data.scope_id));
    }

    if (parsedQuery.data.key !== undefined) {
      filters.push(eq(variables.key, parsedQuery.data.key));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;
    const sortByColumn = parsedQuery.data.sort_by === "key" ? variables.key : variables.updatedAt;

    const rows =
      whereClause === undefined
        ? await db
            .select()
            .from(variables)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset)
        : await db
            .select()
            .from(variables)
            .where(whereClause)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset);

    const totalRows =
      whereClause === undefined
        ? await db.select({ total: count() }).from(variables)
        : await db.select({ total: count() }).from(variables).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toVariableResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
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

    const [row] = await db.select().from(variables).where(eq(variables.id, parsedParams.data.id));

    if (!row) {
      return sendError(reply, 404, "not_found", "Variable not found");
    }

    return reply.send({ data: toVariableResponse(row) });
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
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(variableParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const deleted = await db.delete(variables).where(eq(variables.id, parsedParams.data.id)).returning();

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Variable not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });
}
