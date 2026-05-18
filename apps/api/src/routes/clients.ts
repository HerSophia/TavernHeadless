import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  ClientApiKeyService,
  ClientApiKeyServiceError,
  type ClientApiKeyRecord,
  type CreatedClientApiKey,
} from "../services/client-api-key-service.js";
import {
  ClientService,
  ClientServiceError,
  type ClientKind,
  type ClientRecord,
} from "../services/client-service.js";
import { OperationLogService } from "../services/operation-log-service.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";

const CLIENT_KIND_VALUES = ["basic", "advanced", "deriver", "worker", "custom"] as const;
const CLIENT_STATUS_VALUES = ["active", "disabled"] as const;
const CLIENT_API_KEY_STATUS_VALUES = ["active", "revoked"] as const;

const clientIdParamsSchema = z.object({ id: z.string().min(1) });
const clientKeyParamsSchema = z.object({ id: z.string().min(1), key_id: z.string().min(1) });

const clientKindSchema = z.enum(CLIENT_KIND_VALUES);
const clientStatusSchema = z.enum(CLIENT_STATUS_VALUES);
const clientApiKeyStatusSchema = z.enum(CLIENT_API_KEY_STATUS_VALUES);

const listClientsQuerySchema = z.object({
  status: clientStatusSchema.optional(),
  kind: clientKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional(),
});

const createClientBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: clientKindSchema.optional(),
    metadata: z.unknown().optional(),
  })
  .strict();

const updateClientBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    kind: clientKindSchema.optional(),
    metadata: z.unknown().optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.prototype.hasOwnProperty.call(value, "name")
        || Object.prototype.hasOwnProperty.call(value, "kind")
        || Object.prototype.hasOwnProperty.call(value, "metadata"),
    { message: "At least one client field must be provided" },
  );

const listClientApiKeysQuerySchema = z.object({
  status: clientApiKeyStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional(),
});

const createClientApiKeyBodySchema = z
  .object({
    name: z.string().trim().max(120).optional().nullable(),
    expires_at: z.number().int().optional().nullable(),
  })
  .strict()
  .optional();

const nullableStringJsonSchema = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const nullableIntegerJsonSchema = { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] } as const;

const clientJsonSchema = {
  type: "object",
  required: [
    "id",
    "account_id",
    "name",
    "kind",
    "status",
    "is_default",
    "metadata",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    account_id: { type: "string" },
    name: { type: "string" },
    kind: { type: "string", enum: [...CLIENT_KIND_VALUES] },
    status: { type: "string", enum: [...CLIENT_STATUS_VALUES] },
    is_default: { type: "boolean" },
    metadata: {},
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const clientResponseJsonSchema = {
  type: "object",
  required: ["item"],
  properties: { item: clientJsonSchema },
  additionalProperties: false,
} as const;

const clientListResponseJsonSchema = {
  type: "object",
  required: ["items", "next_cursor"],
  properties: {
    items: { type: "array", items: clientJsonSchema },
    next_cursor: nullableStringJsonSchema,
  },
  additionalProperties: false,
} as const;

const clientApiKeyJsonSchema = {
  type: "object",
  required: [
    "id",
    "account_id",
    "client_id",
    "name",
    "key_prefix",
    "status",
    "last_used_at",
    "expires_at",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    account_id: { type: "string" },
    client_id: { type: "string" },
    name: nullableStringJsonSchema,
    key_prefix: { type: "string" },
    status: { type: "string", enum: [...CLIENT_API_KEY_STATUS_VALUES] },
    last_used_at: nullableIntegerJsonSchema,
    expires_at: nullableIntegerJsonSchema,
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const clientApiKeyListResponseJsonSchema = {
  type: "object",
  required: ["items", "next_cursor"],
  properties: {
    items: { type: "array", items: clientApiKeyJsonSchema },
    next_cursor: nullableStringJsonSchema,
  },
  additionalProperties: false,
} as const;

const clientApiKeyResponseJsonSchema = {
  type: "object",
  required: ["item"],
  properties: { item: clientApiKeyJsonSchema },
  additionalProperties: false,
} as const;

const clientApiKeyCreateResponseJsonSchema = {
  type: "object",
  required: ["item", "secret"],
  properties: {
    item: clientApiKeyJsonSchema,
    secret: { type: "string" },
  },
  additionalProperties: false,
} as const;

export async function registerClientRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const { db } = connection;
  const clientService = new ClientService(db);
  const apiKeyService = new ClientApiKeyService(db);
  const operationLogService = new OperationLogService(db);

  function requireAccountActor(request: FastifyRequest, reply: FastifyReply): {accountId: string; actorId: string } | null {
    const auth = getRequestAuthContext(request);
    if (auth.actorType !== "account") {
      sendError(
        reply,
        403,
        "client_management_actor_invalid",
        "Client management endpoints require account actor authentication",
      );
      return null;
    }
    return { accountId: auth.accountId, actorId: auth.actorId };
  }

  function handleServiceError(error: unknown, reply: FastifyReply): boolean {
    if (error instanceof ClientServiceError) {
      sendError(reply, error.statusCode, error.code, error.message);
      return true;
    }
    if (error instanceof ClientApiKeyServiceError) {
      sendError(reply, error.statusCode, error.code, error.message);
      return true;
    }
    return false;
  }

  app.get("/clients", {
    schema: {
      tags: ["clients"],
      summary: "List clients for the current account",
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: [...CLIENT_STATUS_VALUES] },
          kind: { type: "string", enum: [...CLIENT_KIND_VALUES] },
      limit: { type: "integer", minimum: 1, maximum:200, default: 50 },
          cursor: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: clientListResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const actor = requireAccountActor(request, reply);
    if (!actor) return;
    const parsedQuery = parseWithSchema(listClientsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    try {
      const result = clientService.list({
        accountId: actor.accountId,
        status: parsedQuery.data.status,
        kind: parsedQuery.data.kind as ClientKind | undefined,
        limit: parsedQuery.data.limit,
        cursor: parsedQuery.data.cursor,
      });
      return reply.send({
        items: result.items.map(toClientResponse),
        next_cursor: result.nextCursor,
      });
    } catch (error) {
      if (handleServiceError(error, reply)) return;
      throw error;
    }
  });

  app.post("/clients", {
    schema: {
      tags: ["clients"],
 summary: "Create a client",
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          kind: { type: "string", enum: [...CLIENT_KIND_VALUES] },
          metadata: {},
        },
        additionalProperties: false,
      },
      response: {
        201: clientResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        413: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const actor = requireAccountActor(request, reply);
    if (!actor) return;
    const parsedBody = parseWithSchema(createClientBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    try {
  const record = clientService.create({
      accountId: actor.accountId,
        name: parsedBody.data.name,
        kind: parsedBody.data.kind,
        metadata: parsedBody.data.metadata,
      });
      writeOperationLog(operationLogService, {
        accountId: actor.accountId,
        actorId: actor.actorId,
        action: "client.create",
        targetId: record.id,
      });
      return reply.code(201).send({ item: toClientResponse(record) });
    } catch (error) {
      if (handleServiceError(error, reply)) return;
      throw error;
    }
  });

  app.get("/clients/:id", {
    schema: {
      tags: ["clients"],
      summary:"Get client detail",
      params: idParamsJsonSchema,
      response: {
        200: clientResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const actor = requireAccountActor(request, reply);
    if (!actor) return;
    const parsedParams = parseWithSchema(clientIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    try {
      const record = clientService.getById({
        accountId: actor.accountId,
        clientId: parsedParams.data.id,
      });
      return reply.send({ item: toClientResponse(record) });
    } catch (error) {
      if (handleServiceError(error, reply)) return;
      throw error;
    }
  });

  app.patch("/clients/:id", {
    schema: {
      tags: ["clients"],
      summary: "Update a client",
      params: idParamsJsonSchema,
      body: {
        type: "object",
        properties: {
       name: { type: "string", minLength: 1, maxLength: 120 },
          kind: { type: "string", enum: [...CLIENT_KIND_VALUES] },
          metadata: {},
        },
        anyOf: [
          { required: ["name"] },
          { required: ["kind"] },
          { required: ["metadata"] },
        ],
      additionalProperties: false,
      },
      response: {
        200: clientResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
    413: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const actor = requireAccountActor(request, reply);
   if (!actor) return;
    const parsedParams = parseWithSchema(clientIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(updateClientBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    try {
      const record = clientService.update({
        accountId: actor.accountId,
        clientId: parsedParams.data.id,
        name: parsedBody.data.name,
        kind: parsedBody.data.kind,
        metadata:parsedBody.data.metadata,
      });
      writeOperationLog(operationLogService, {
        accountId: actor.accountId,
       actorId: actor.actorId,
        action: "client.update",
        targetId: record.id,
      });
      return reply.send({ item: toClientResponse(record) });
    } catch (error) {
      if (handleServiceError(error, reply)) return;
      throw error;
    }
  });

  app.post("/clients/:id/disable", {
    schema: {
      tags: ["clients"],
      summary: "Disable a client",
      params: idParamsJsonSchema,
      response: {
        200: clientResponseJsonSchema,
        403: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const actor = requireAccountActor(request, reply);
    if (!actor) return;
    const parsedParams = parseWithSchema(clientIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    try {
      const record = clientService.disable({
        accountId: actor.accountId,
        clientId: parsedParams.data.id,
      });
      writeOperationLog(operationLogService, {
   accountId: actor.accountId,
        actorId: actor.actorId,
        action: "client.disable",
        targetId: record.id,
      });
      return reply.send({ item: toClientResponse(record) });
    } catch (error) {
      if (handleServiceError(error, reply)) return;
      throw error;
    }
  });

  app.post("/clients/:id/enable", {
    schema: {
      tags: ["clients"],
      summary: "Enable a client",
      params: idParamsJsonSchema,
      response: {
  200: clientResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
    },
    },
  }, async (request, reply) => {
    const actor = requireAccountActor(request, reply);
    if (!actor) return;
    const parsedParams = parseWithSchema(clientIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    try {
      const record = clientService.enable({
        accountId: actor.accountId,
        clientId: parsedParams.data.id,
      });
      writeOperationLog(operationLogService, {
        accountId: actor.accountId,
        actorId: actor.actorId,
        action: "client.enable",
        targetId: record.id,
      });
      return reply.send({ item: toClientResponse(record) });
    } catch (error) {
      if(handleServiceError(error, reply)) return;
      throw error;
    }
  });

  app.get("/clients/:id/api-keys", {
    schema: {
      tags: ["clients"],
      summary: "List client API keys",
      params: idParamsJsonSchema,
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: [...CLIENT_API_KEY_STATUS_VALUES] },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          cursor: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: clientApiKeyListResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const actor = requireAccountActor(request, reply);
    if (!actor) return;
    const parsedParams = parseWithSchema(clientIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedQuery = parseWithSchema(listClientApiKeysQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

   try {
      const result = apiKeyService.list({
        accountId: actor.accountId,
        clientId: parsedParams.data.id,
status: parsedQuery.data.status,
        limit: parsedQuery.data.limit,
        cursor: parsedQuery.data.cursor,
      });
      return reply.send({
        items: result.items.map(toApiKeyResponse),
        next_cursor: result.nextCursor,
      });
    }catch (error) {
      if (handleServiceError(error, reply)) return;
      throw error;
    }
  });

  app.post("/clients/:id/api-keys", {
    schema: {
      tags: ["clients"],
      summary: "Create a client API key",
      params: idParamsJsonSchema,
      body: {
        type: "object",
        properties: {
          name: nullableStringJsonSchema,
          expires_at: nullableIntegerJsonSchema,
        },
        additionalProperties: false,
      },
      response: {
        201: clientApiKeyCreateResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const actor = requireAccountActor(request, reply);
    if (!actor) return;
    const parsedParams = parseWithSchema(clientIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(createClientApiKeyBodySchema, request.body ?? {}, reply);
    if (!parsedBody.ok) return;

    try {
      const result = apiKeyService.create({
       accountId: actor.accountId,
        clientId: parsedParams.data.id,
        name: parsedBody.data?.name ?? null,
        expiresAt: parsedBody.data?.expires_at ?? null,
      });
      writeOperationLog(operationLogService, {
        accountId: actor.accountId,
        actorId: actor.actorId,
        action: "client_api_key.create",
        targetId: result.apiKey.id,
      });
      return reply.code(201).send(toCreatedApiKeyResponse(result));
    } catch (error) {
      if(handleServiceError(error, reply)) return;
      throw error;
    }
  });

  app.post("/clients/:id/api-keys/:key_id/revoke", {
    schema: {
      tags:["clients"],
      summary: "Revoke a client API key",
      params: {
        type: "object",
        required: ["id", "key_id"],
        properties: {
          id: { type: "string", minLength: 1 },
          key_id: { type: "string", minLength: 1 },
   },
        additionalProperties: false,
      },
      response: {
        200: clientApiKeyResponseJsonSchema,
        403: errorResponseJsonSchema,
404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const actor = requireAccountActor(request, reply);
    if (!actor) return;
    const parsedParams = parseWithSchema(clientKeyParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    try {
      const record = apiKeyService.revoke({
        accountId: actor.accountId,
        clientId: parsedParams.data.id,
        apiKeyId: parsedParams.data.key_id,
      });
 writeOperationLog(operationLogService, {
        accountId: actor.accountId,
        actorId: actor.actorId,
        action: "client_api_key.revoke",
        targetId: record.id,
      });
      return reply.send({ item: toApiKeyResponse(record) });
    } catch (error) {
      if (handleServiceError(error, reply)) return;
      throw error;
    }
  });
}

function writeOperationLog(
  operationLogService: OperationLogService,
  input: { accountId: string; actorId: string; action: string; targetId: string },
): void {
  try {
    operationLogService.append({
      accountId: input.accountId,
      actorType: "account",
      actorId: input.actorId,
      actorAccountId: input.actorId,
      sourceType: "http",
      action: input.action,
      status: "succeeded",
      targetType: "client",
      targetId: input.targetId,
    });
  } catch {
    // Audit failures must never block business writes for client management.
  }
}

function toClientResponse(record: ClientRecord) {
  return {
    id: record.id,
    account_id: record.accountId,
    name: record.name,
    kind: record.kind,
    status: record.status,
    is_default: record.isDefault,
    metadata: record.metadata,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function toApiKeyResponse(record: ClientApiKeyRecord) {
  return {
    id: record.id,
    account_id: record.accountId,
    client_id: record.clientId,
    name: record.name,
    key_prefix: record.keyPrefix,
    status: record.status,
    last_used_at: record.lastUsedAt,
    expires_at: record.expiresAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function toCreatedApiKeyResponse(result: CreatedClientApiKey) {
  return {
    item: toApiKeyResponse(result.apiKey),
    secret: result.secret,
  };
}
