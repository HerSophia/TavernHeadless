import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { accounts } from "../db/schema";
import { parseWithSchema, sendError } from "../lib/http";
import { getRequestAuthContext } from "../plugins/auth";

const createAccountSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["admin", "user"]).default("user"),
});

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
