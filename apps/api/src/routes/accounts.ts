import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { accounts } from "../db/schema";
import { parseWithSchema, sendError } from "../lib/http";
import { getRequestAuthContext } from "../plugins/auth";

const createAccountSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["admin", "user"]).default("user"),
});

const idParamsSchema = z.object({
  id: z.string().min(1),
});

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).refine(
  (v) => Object.keys(v).length > 0,
  "At least one field is required"
);

const createAccountBodyExample = {
  id: "acc_demo",
  name: "Demo Workspace",
  role: "user",
} as const;

const accountExample = {
  id: "acc_demo",
  name: "Demo Workspace",
  role: "user",
  status: "active",
  is_default: false,
  created_at: 1735689600000,
  updated_at: 1735689600000,
} as const;

const accountListResponseExample = {
  data: [accountExample],
} as const;

const accountResponseExample = {
  data: accountExample,
} as const;

const updateAccountBodyExample = {
  name: "Updated Workspace",
} as const;

const accountDeleteResponseExample = {
  data: {
    id: "acc_demo",
    deleted: true,
  },
} as const;

const accountJsonSchema = {
  type: "object",
  required: ["id", "name", "role", "status", "is_default", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    role: { type: "string", enum: ["admin", "user"] },
    status: { type: "string", enum: ["active", "disabled"] },
    is_default: { type: "boolean" },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  examples: [accountExample],
  additionalProperties: false,
} as const;

const accountListResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: accountJsonSchema,
    },
  },
  examples: [accountListResponseExample],
  additionalProperties: false,
} as const;

const accountResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: accountJsonSchema,
  },
  examples: [accountResponseExample],
  additionalProperties: false,
} as const;

const updateAccountBodyJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    role: { type: "string", enum: ["admin", "user"] },
    status: { type: "string", enum: ["active", "disabled"] },
  },
  minProperties: 1,
  examples: [updateAccountBodyExample],
  additionalProperties: false,
} as const;

const accountDeleteResponseJsonSchema = {
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
  examples: [accountDeleteResponseExample],
  additionalProperties: false,
} as const;

const createBodyJsonSchema = {
  type: "object",
  required: ["name"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 120 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    role: { type: "string", enum: ["admin", "user"] },
  },
  examples: [createAccountBodyExample],
  additionalProperties: false,
} as const;


export async function registerAccountRoutes(app: FastifyInstance, connection: DatabaseConnection): Promise<void> {
  const db = connection.db;

  app.get(
    "/accounts",
    {
      schema: {
        tags: ["accounts"],
        summary: "List accounts",
        operationId: "listAccounts",
        response: {
          200: accountListResponseJsonSchema,
          403: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      if (auth.role !== "admin") {
        return sendError(reply, 403, "account_forbidden", "Only admin can list accounts");
      }

      const rows = await db.select().from(accounts).orderBy(desc(accounts.updatedAt));
      return reply.send({ data: rows.map(toAccountResponse) });
    }
  );

  app.post(
    "/accounts",
    {
      schema: {
        tags: ["accounts"],
        summary: "Create account",
        operationId: "createAccount",
        body: createBodyJsonSchema,
        response: {
          201: accountResponseJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      if (auth.role !== "admin") {
        return sendError(reply, 403, "account_forbidden", "Only admin can create accounts");
      }

      const parsed = parseWithSchema(createAccountSchema, request.body, reply);
      if (!parsed.ok) {
        return;
      }

      const accountId = parsed.data.id ?? nanoid();
      const [existing] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .limit(1);

      if (existing) {
        return sendError(reply, 409, "account_conflict", `Account id already exists: ${accountId}`);
      }

      const now = Date.now();
      await db.insert(accounts).values({
        id: accountId,
        name: parsed.data.name,
        role: parsed.data.role,
        status: "active",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });

      const [created] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      if (!created) {
        return sendError(reply, 500, "account_create_failed", `Failed to create account: ${accountId}`);
      }

      return reply.code(201).send({ data: toAccountResponse(created) });
    }
  );

  /** GET /accounts/:id — 获取单个账号 */
  app.get(
    "/accounts/:id",
    {
      schema: {
        tags: ["accounts"],
        summary: "Get account by id",
        operationId: "getAccount",
        params: idParamsJsonSchema,
        response: {
          200: accountResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      if (auth.role !== "admin") {
        return sendError(reply, 403, "account_forbidden", "Only admin can access accounts");
      }

      const parsed = parseWithSchema(idParamsSchema, request.params, reply);
      if (!parsed.ok) return;

      const [row] = await db.select().from(accounts).where(eq(accounts.id, parsed.data.id)).limit(1);
      if (!row) {
        return sendError(reply, 404, "account_not_found", "Account not found");
      }

      return reply.send({ data: toAccountResponse(row) });
    }
  );

  /** PATCH /accounts/:id — 更新账号 */
  app.patch(
    "/accounts/:id",
    {
      schema: {
        tags: ["accounts"],
        summary: "Update account by id",
        operationId: "updateAccount",
        params: idParamsJsonSchema,
        body: updateAccountBodyJsonSchema,
        response: {
          200: accountResponseJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      if (auth.role !== "admin") {
        return sendError(reply, 403, "account_forbidden", "Only admin can update accounts");
      }

      const paramsParsed = parseWithSchema(idParamsSchema, request.params, reply);
      if (!paramsParsed.ok) return;
      const bodyParsed = parseWithSchema(updateAccountSchema, request.body, reply);
      if (!bodyParsed.ok) return;

      const [row] = await db.select().from(accounts).where(eq(accounts.id, paramsParsed.data.id)).limit(1);
      if (!row) {
        return sendError(reply, 404, "account_not_found", "Account not found");
      }

      if (row.isDefault && (bodyParsed.data.role !== undefined || bodyParsed.data.status !== undefined)) {
        return sendError(reply, 409, "account_protected", "Cannot modify role or status of the default account");
      }

      const now = Date.now();
      await db.update(accounts).set({
        ...(bodyParsed.data.name !== undefined && { name: bodyParsed.data.name }),
        ...(bodyParsed.data.role !== undefined && { role: bodyParsed.data.role }),
        ...(bodyParsed.data.status !== undefined && { status: bodyParsed.data.status }),
        updatedAt: now,
      }).where(eq(accounts.id, row.id));

      const [updated] = await db.select().from(accounts).where(eq(accounts.id, row.id)).limit(1);
      return reply.send({ data: toAccountResponse(updated!) });
    }
  );

  /** DELETE /accounts/:id — 删除账号 */
  app.delete(
    "/accounts/:id",
    {
      schema: {
        tags: ["accounts"],
        summary: "Delete account by id",
        operationId: "deleteAccount",
        params: idParamsJsonSchema,
        response: {
          200: accountDeleteResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      if (auth.role !== "admin") {
        return sendError(reply, 403, "account_forbidden", "Only admin can delete accounts");
      }

      const parsed = parseWithSchema(idParamsSchema, request.params, reply);
      if (!parsed.ok) return;

      const [row] = await db.select().from(accounts).where(eq(accounts.id, parsed.data.id)).limit(1);
      if (!row) {
        return sendError(reply, 404, "account_not_found", "Account not found");
      }

      if (row.isDefault) {
        return sendError(reply, 409, "account_protected", "Cannot delete the default account");
      }

      try {
        await db.delete(accounts).where(eq(accounts.id, row.id));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("FOREIGN KEY")) {
          return sendError(reply, 409, "account_has_resources", "Account has associated resources. Delete them first.");
        }
        throw error;
      }

      return reply.send({ data: { id: row.id, deleted: true } });
    }
  );
}

function toAccountResponse(row: typeof accounts.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    is_default: row.isDefault,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
