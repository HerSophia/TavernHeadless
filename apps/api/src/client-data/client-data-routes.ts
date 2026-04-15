import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { parseJsonField, parseWithSchema } from "../lib/http.js";
import { buildListMeta, listQuerySchemaBase } from "../lib/pagination.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { errorResponseJsonSchema } from "../routes/schemas/common.js";
import {
  ClientDataService,
  ClientDataServiceError,
  type ClientDataConfig,
  type ClientDataExportSnapshot,
  type ClientDataImportPayload,
  type ClientDataImportResult,
} from "./client-data-service.js";
import {
  parseClientDataCallerOwner,
  sendClientDataCallerOwnerError,
  type ClientDataCallerOwner,
} from "./client-data-auth.js";

const ownerTypeSchema = z.enum(["application", "plugin"]);
const domainStatusSchema = z.enum(["active", "suspended", "deleted"]);
const domainParamsSchema = z.object({ domainId: z.string().min(1) });
const collectionParamsSchema = z.object({ domainId: z.string().min(1), collectionId: z.string().min(1) });
const itemParamsSchema = z.object({ domainId: z.string().min(1), itemId: z.string().min(1) });
const ownerParamsSchema = z.object({ ownerType: ownerTypeSchema, ownerId: z.string().min(1) });
const grantParamsSchema = z.object({ domainId: z.string().min(1), grantId: z.string().min(1) });
const itemByKeyQuerySchema = z.object({
  collection_name: z.string().trim().min(1).max(128),
  item_key: z.string().trim().min(1).max(256),
});

const createDomainSchema = z.object({
  owner_type: ownerTypeSchema,
  owner_id: z.string().trim().min(1),
  domain_name: z.string().trim().min(1),
  display_name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
});

const listDomainsQuerySchema = listQuerySchemaBase.extend({
  owner_type: ownerTypeSchema.optional(),
  owner_id: z.string().min(1).optional(),
  status: domainStatusSchema.optional(),
  sort_by: z.enum(["updated_at", "created_at", "domain_name"]).default("updated_at"),
});

const updateDomainSchema = z.object({
  display_name: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  if_version: z.number().int().positive().optional(),
}).refine((value) => value.display_name !== undefined || value.description !== undefined, "At least one mutable field is required");

const updateDomainQuotaSchema = z.object({
  quota_max_entries: z.number().int().nonnegative(),
  quota_max_bytes: z.number().int().nonnegative(),
});

const createCollectionSchema = z.object({
  collection_name: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).optional(),
  default_expires_ttl_ms: z.number().int().positive().nullable().optional(),
  max_item_size_bytes: z.number().int().positive().nullable().optional(),
  metadata_json: z.unknown().optional(),
});

const updateCollectionSchema = z.object({
  description: z.string().trim().min(1).nullable().optional(),
  default_expires_ttl_ms: z.number().int().positive().nullable().optional(),
  max_item_size_bytes: z.number().int().positive().nullable().optional(),
  metadata_json: z.unknown().optional(),
  if_version: z.number().int().positive().optional(),
}).refine(
  (value) =>
    value.description !== undefined
    || value.default_expires_ttl_ms !== undefined
    || value.max_item_size_bytes !== undefined
    || value.metadata_json !== undefined,
  "At least one mutable field is required"
);

const listItemsQuerySchema = listQuerySchemaBase.extend({
  collection_id: z.string().min(1).optional(),
  item_key_prefix: z.string().trim().min(1).max(256).optional(),
  updated_after: z.coerce.number().int().nonnegative().optional(),
  updated_before: z.coerce.number().int().nonnegative().optional(),
  expires_after: z.coerce.number().int().nonnegative().optional(),
  expires_before: z.coerce.number().int().nonnegative().optional(),
  expired: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value === "true";
    }),
  sort_by: z.enum(["updated_at", "created_at", "item_key"]).catch("updated_at"),
});

const upsertItemSchema = z.object({
  collection_name: z.string().trim().min(1).max(128),
  item_key: z.string().trim().min(1).max(256),
  value_json: z.unknown(),
  expires_at: z.number().int().nonnegative().nullable().optional(),
  if_version: z.number().int().positive().optional(),
});

const batchUpsertItemSchema = z.object({
  items: z.array(upsertItemSchema).min(1).max(100),
});

const importItemSchema = z.object({
  item_key: z.string().trim().min(1).max(256),
  value_json: z.unknown(),
  version: z.number().int().positive().optional(),
  expires_at: z.number().int().nonnegative().nullable(),
  created_at: z.number().int().nonnegative().optional(),
  updated_at: z.number().int().nonnegative().optional(),
});

const importCollectionSchema = z.object({
  collection_name: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).nullable(),
  default_expires_ttl_ms: z.number().int().positive().nullable(),
  max_item_size_bytes: z.number().int().positive().nullable(),
  metadata_json: z.unknown(),
  items: z.array(importItemSchema),
});

const importPayloadSchema = z.object({
  domain: z.object({
    owner_type: ownerTypeSchema,
    owner_id: z.string().trim().min(1),
    domain_name: z.string().trim().min(1),
    display_name: z.string().trim().min(1).nullable().optional(),
    description: z.string().trim().min(1).nullable().optional(),
  }),
  collections: z.array(importCollectionSchema),
});

const importRequestSchema = z.object({
  conflict_policy: z.enum(["fail", "overwrite", "skip"]),
  payload: importPayloadSchema,
});

const createGrantSchema = z.object({
  grantee_owner_type: ownerTypeSchema,
  grantee_owner_id: z.string().trim().min(1),
  can_read: z.boolean(),
  can_write: z.boolean(),
  can_delete: z.boolean(),
  can_list: z.boolean(),
  expires_at: z.number().int().nonnegative().nullable().optional(),
});

const updateGrantSchema = z.object({
  can_read: z.boolean().optional(),
  can_write: z.boolean().optional(),
  can_delete: z.boolean().optional(),
  can_list: z.boolean().optional(),
  expires_at: z.number().int().nonnegative().nullable().optional(),
}).refine(
  (value) =>
    value.can_read !== undefined
    || value.can_write !== undefined
    || value.can_delete !== undefined
    || value.can_list !== undefined
    || value.expires_at !== undefined,
  "At least one mutable field is required"
);

const listAuditLogsQuerySchema = listQuerySchemaBase.extend({
  actor_type: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  sort_by: z.literal("created_at").catch("created_at"),
});

const deleteBatchItemsSchema = z.object({
  item_ids: z.array(z.string().min(1)).min(1).max(100).optional(),
  collection_id: z.string().min(1).optional(),
}).refine((value) => Boolean(value.item_ids?.length) || Boolean(value.collection_id), "Either item_ids or collection_id is required");

const domainJsonSchema = {
  type: "object",
  required: [
    "id",
    "owner_type",
    "owner_id",
    "domain_name",
    "display_name",
    "description",
    "status",
    "version",
    "quota_max_entries",
    "quota_max_bytes",
    "current_entry_count",
    "current_byte_count",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  properties: {
    id: { type: "string" },
    owner_type: { type: "string", enum: ["application", "plugin"] },
    owner_id: { type: "string" },
    domain_name: { type: "string" },
    display_name: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    status: { type: "string", enum: ["active", "suspended", "deleted"] },
    version: { type: "integer" },
    quota_max_entries: { type: "integer" },
    quota_max_bytes: { type: "integer" },
    current_entry_count: { type: "integer" },
    current_byte_count: { type: "integer" },
    created_at: { type: "integer" },
    updated_at: { type: "integer" },
    deleted_at: { type: ["integer", "null"] },
  },
  additionalProperties: false,
} as const;

const domainDetailJsonSchema = {
  type: "object",
  required: ["quota_usage", "restorable_until"],
  properties: {
    ...domainJsonSchema.properties,
    quota_usage: {
      type: "object",
      required: ["entry_count", "byte_count"],
      properties: {
        entry_count: { type: "integer" },
        byte_count: { type: "integer" },
      },
      additionalProperties: false,
    },
    restorable_until: { type: ["integer", "null"] },
  },
  additionalProperties: false,
} as const;

const domainResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: domainJsonSchema,
  },
  additionalProperties: false,
} as const;

const domainDetailResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: domainDetailJsonSchema,
  },
  additionalProperties: false,
} as const;

const domainListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: {
      type: "array",
      items: domainJsonSchema,
    },
    meta: {
      type: "object",
      required: ["total", "limit", "offset", "has_more", "sort_by", "sort_order"],
      properties: {
        total: { type: "integer" },
        limit: { type: "integer" },
        offset: { type: "integer" },
        has_more: { type: "boolean" },
        sort_by: { type: "string" },
        sort_order: { type: "string" },
      },
      additionalProperties: false,
    },
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
      properties: {
        id: { type: "string" },
        deleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const collectionJsonSchema = {
  type: "object",
  required: [
    "id",
    "domain_id",
    "collection_name",
    "description",
    "default_expires_ttl_ms",
    "max_item_size_bytes",
    "version",
    "metadata_json",
    "item_count",
    "byte_count",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    domain_id: { type: "string" },
    collection_name: { type: "string" },
    description: { type: ["string", "null"] },
    default_expires_ttl_ms: { type: ["integer", "null"] },
    max_item_size_bytes: { type: ["integer", "null"] },
    version: { type: "integer" },
    metadata_json: {},
    item_count: { type: "integer" },
    byte_count: { type: "integer" },
    created_at: { type: "integer" },
    updated_at: { type: "integer" },
  },
  additionalProperties: false,
} as const;

const collectionResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: collectionJsonSchema,
  },
  additionalProperties: false,
} as const;

const collectionListResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: collectionJsonSchema,
    },
  },
  additionalProperties: false,
} as const;

const itemJsonSchema = {
  type: "object",
  required: [
    "id",
    "domain_id",
    "collection_id",
    "item_key",
    "value_json",
    "byte_size",
    "version",
    "expires_at",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    domain_id: { type: "string" },
    collection_id: { type: "string" },
    item_key: { type: "string" },
    value_json: {},
    byte_size: { type: "integer" },
    version: { type: "integer" },
    expires_at: { type: ["integer", "null"] },
    created_at: { type: "integer" },
    updated_at: { type: "integer" },
  },
  additionalProperties: false,
} as const;

const itemResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: itemJsonSchema,
  },
  additionalProperties: false,
} as const;

const itemListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: {
      type: "array",
      items: itemJsonSchema,
    },
    meta: {
      type: "object",
      required: ["total", "limit", "offset", "has_more", "sort_by", "sort_order"],
      properties: {
        total: { type: "integer" },
        limit: { type: "integer" },
        offset: { type: "integer" },
        has_more: { type: "boolean" },
        sort_by: { type: "string" },
        sort_order: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const upsertItemResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["action", "collection", "item"],
      properties: {
        action: { type: "string", enum: ["created", "updated"] },
        collection: collectionJsonSchema,
        item: itemJsonSchema,
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const batchUpsertResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            required: ["action", "collection", "item"],
            properties: {
              action: { type: "string", enum: ["created", "updated"] },
              collection: collectionJsonSchema,
              item: itemJsonSchema,
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const deleteBatchResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "collection_id", "item_key"],
        properties: {
          id: { type: "string" },
          collection_id: { type: "string" },
          item_key: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

const exportResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["domain", "collections", "exported_at"],
      properties: {
        domain: {
          type: "object",
          required: ["id", "owner_type", "owner_id", "domain_name", "display_name", "description", "created_at"],
          properties: {
            id: { type: "string" },
            owner_type: { type: "string", enum: ["application", "plugin"] },
            owner_id: { type: "string" },
            domain_name: { type: "string" },
            display_name: { type: ["string", "null"] },
            description: { type: ["string", "null"] },
            created_at: { type: "integer" },
          },
          additionalProperties: false,
        },
        collections: {
          type: "array",
          items: {
            type: "object",
            required: ["collection_name", "description", "default_expires_ttl_ms", "max_item_size_bytes", "metadata_json", "items"],
            properties: {
              collection_name: { type: "string" },
              description: { type: ["string", "null"] },
              default_expires_ttl_ms: { type: ["integer", "null"] },
              max_item_size_bytes: { type: ["integer", "null"] },
              metadata_json: {},
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: ["item_key", "value_json", "version", "expires_at", "created_at", "updated_at"],
                  properties: {
                    item_key: { type: "string" },
                    value_json: {},
                    version: { type: "integer" },
                    expires_at: { type: ["integer", "null"] },
                    created_at: { type: "integer" },
                    updated_at: { type: "integer" },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        exported_at: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const importSummaryJsonSchema = {
  type: "object",
  required: [
    "collections_created",
    "items_created",
    "items_updated",
    "items_skipped",
    "imported_item_count",
    "imported_byte_count",
    "conflict_policy",
  ],
  properties: {
    collections_created: { type: "integer" },
    items_created: { type: "integer" },
    items_updated: { type: "integer" },
    items_skipped: { type: "integer" },
    imported_item_count: { type: "integer" },
    imported_byte_count: { type: "integer" },
    conflict_policy: { type: "string", enum: ["fail", "overwrite", "skip"] },
  },
  additionalProperties: false,
} as const;

const importResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["domain", "collections", "summary"],
      properties: {
        domain: domainJsonSchema,
        collections: {
          type: "array",
          items: collectionJsonSchema,
        },
        summary: importSummaryJsonSchema,
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const grantJsonSchema = {
  type: "object",
  required: [
    "id",
    "domain_id",
    "grantee_owner_type",
    "grantee_owner_id",
    "can_read",
    "can_write",
    "can_delete",
    "can_list",
    "created_at",
    "updated_at",
    "expires_at",
  ],
  properties: {
    id: { type: "string" },
    domain_id: { type: "string" },
    grantee_owner_type: { type: "string", enum: ["application", "plugin"] },
    grantee_owner_id: { type: "string" },
    can_read: { type: "boolean" },
    can_write: { type: "boolean" },
    can_delete: { type: "boolean" },
    can_list: { type: "boolean" },
    created_at: { type: "integer" },
    updated_at: { type: "integer" },
    expires_at: { type: ["integer", "null"] },
  },
  additionalProperties: false,
} as const;

const grantResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: grantJsonSchema,
  },
  additionalProperties: false,
} as const;

const grantListResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: grantJsonSchema,
    },
  },
  additionalProperties: false,
} as const;

const auditLogJsonSchema = {
  type: "object",
  required: [
    "id",
    "account_id",
    "domain_id",
    "owner_type",
    "owner_id",
    "actor_type",
    "actor_id",
    "action",
    "target_type",
    "target_id",
    "request_id",
    "metadata_json",
    "created_at",
  ],
  properties: {
    id: { type: "string" },
    account_id: { type: "string" },
    domain_id: { type: ["string", "null"] },
    owner_type: { type: ["string", "null"] },
    owner_id: { type: ["string", "null"] },
    actor_type: { type: "string" },
    actor_id: { type: ["string", "null"] },
    action: { type: "string" },
    target_type: { type: "string" },
    target_id: { type: ["string", "null"] },
    request_id: { type: ["string", "null"] },
    metadata_json: {},
    created_at: { type: "integer" },
  },
  additionalProperties: false,
} as const;

const auditLogListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: {
      type: "array",
      items: auditLogJsonSchema,
    },
    meta: {
      type: "object",
      required: ["total", "limit", "offset", "has_more", "sort_by", "sort_order"],
      properties: {
        total: { type: "integer" },
        limit: { type: "integer" },
        offset: { type: "integer" },
        has_more: { type: "boolean" },
        sort_by: { type: "string" },
        sort_order: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

export async function registerClientDataRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: { clientData: ClientDataConfig },
): Promise<void> {
  const service = new ClientDataService(connection.db, options.clientData);

  app.addHook("preHandler", async (request, reply) => {
    const routePath = request.routeOptions.url ?? "";
    if (!routePath.startsWith("/client-data/")) {
      return;
    }

    const params = request.params as Record<string, unknown> | undefined;
    const domainId = typeof params?.domainId === "string" ? params.domainId : undefined;
    if (!domainId) {
      return;
    }

    try {
      service.assertRawDomainAccessAllowed(getRequestAuthContext(request).accountId, domainId);
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.post("/client-data/domains", {
    schema: {
      tags: ["client-data"],
      summary: "Create client data domain",
      response: {
        201: domainResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(createDomainSchema, request.body, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.code(201).send({ data: toDomainResponse(service.createDomain({
        accountId: auth.accountId,
        ownerType: parsed.data.owner_type,
        ownerId: parsed.data.owner_id,
        domainName: parsed.data.domain_name,
        displayName: parsed.data.display_name,
        description: parsed.data.description,
        actor: getAuditActor(request),
        requestId: request.id,
      })) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains", {
    schema: {
      tags: ["client-data"],
      summary: "List client data domains",
      response: {
        200: domainListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(listDomainsQuerySchema, request.query, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      const result = service.listDomains({
        accountId: auth.accountId,
        ownerType: parsed.data.owner_type,
        ownerId: parsed.data.owner_id,
        status: parsed.data.status,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        sortBy: parsed.data.sort_by,
        sortOrder: parsed.data.sort_order,
      });
      return reply.send({
        data: result.rows.map(toDomainResponse),
        meta: buildListMeta({ total: result.total, limit: parsed.data.limit, offset: parsed.data.offset, sortBy: parsed.data.sort_by, sortOrder: parsed.data.sort_order }),
      });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains/:domainId", {
    schema: {
      response: {
        200: domainDetailResponseJsonSchema,
        404: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.send({ data: toDomainDetailResponse(service.getOwnedDomainDetail(auth.accountId, parsed.data.domainId)) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.patch("/client-data/domains/:domainId", {
    schema: {
      response: {
        200: domainResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(updateDomainSchema, request.body, reply);
      if (!body.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.send({ data: toDomainResponse(service.updateDomain({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        displayName: body.data.display_name,
        description: body.data.description,
        ifVersion: body.data.if_version,
        actor: getAuditActor(request),
        requestId: request.id,
      })) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.patch("/client-data/domains/:domainId/quota", {
    schema: {
      response: {
        200: domainResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(updateDomainQuotaSchema, request.body, reply);
      if (!body.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.send({ data: toDomainResponse(service.updateDomainQuota({
        accountId: auth.accountId,
        role: auth.role,
        domainId: params.data.domainId,
        quotaMaxEntries: body.data.quota_max_entries,
        quotaMaxBytes: body.data.quota_max_bytes,
        actor: getAuditActor(request),
        requestId: request.id,
      })) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.delete("/client-data/domains/:domainId", {
    schema: {
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      const deleted = service.deleteDomain(auth.accountId, parsed.data.domainId, getAuditActor(request), request.id);
      return reply.send({ data: { id: deleted.id, deleted: true } });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.post("/client-data/domains/:domainId/restore", {
    schema: {
      response: {
        200: domainResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.send({ data: toDomainResponse(service.restoreDomain(auth.accountId, parsed.data.domainId, getAuditActor(request), request.id)) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.delete("/client-data/owners/:ownerType/:ownerId/domains", {
    schema: {
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: {
            data: {
              type: "array",
              items: domainJsonSchema,
            },
          },
          additionalProperties: false,
        },
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(ownerParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      const deleted = service.deleteDomainsByOwner({
        accountId: auth.accountId,
        ownerType: parsed.data.ownerType,
        ownerId: parsed.data.ownerId,
        actor: getAuditActor(request),
        requestId: request.id,
      });
      return reply.send({ data: deleted.map(toDomainResponse) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains/:domainId/export", {
    schema: {
      response: {
        200: exportResponseJsonSchema,
        404: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.send({ data: toExportResponse(service.exportDomain(auth.accountId, parsed.data.domainId, getAuditActor(request), request.id)) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.post("/client-data/domains/import", {
    schema: {
      response: {
        201: importResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const body = parseWithSchema(importRequestSchema, request.body, reply);
      if (!body.ok) return;
      const auth = getRequestAuthContext(request);
      const result = service.importAsNewDomain({
        accountId: auth.accountId,
        conflictPolicy: body.data.conflict_policy,
        payload: toImportPayload(body.data.payload),
        actor: getAuditActor(request),
        requestId: request.id,
      });
      return reply.code(201).send({ data: toImportResponse(result) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.post("/client-data/domains/:domainId/import", {
    schema: {
      response: {
        200: importResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(importRequestSchema, request.body, reply);
      if (!body.ok) return;
      const auth = getRequestAuthContext(request);
      const result = service.importIntoDomain({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        conflictPolicy: body.data.conflict_policy,
        payload: toImportPayload(body.data.payload),
        actor: getAuditActor(request),
        requestId: request.id,
      });
      return reply.send({ data: toImportResponse(result) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.post("/client-data/domains/:domainId/collections", {
    schema: {
      response: {
        201: collectionResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(createCollectionSchema, request.body, reply);
      if (!body.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.code(201).send({ data: toCollectionResponse(service.createCollection({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        collectionName: body.data.collection_name,
        description: body.data.description,
        defaultExpiresTtlMs: body.data.default_expires_ttl_ms,
        maxItemSizeBytes: body.data.max_item_size_bytes,
        metadataJson: body.data.metadata_json,
      })) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains/:domainId/collections", {
    schema: {
      response: {
        200: collectionListResponseJsonSchema,
        404: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.send({ data: service.listCollections(auth.accountId, params.data.domainId).map(toCollectionResponse) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains/:domainId/collections/:collectionId", {
    schema: {
      response: {
        200: collectionResponseJsonSchema,
        404: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(collectionParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.send({ data: toCollectionResponse(service.getCollectionDetail(auth.accountId, parsed.data.domainId, parsed.data.collectionId)) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.patch("/client-data/domains/:domainId/collections/:collectionId", {
    schema: {
      response: {
        200: collectionResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(collectionParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(updateCollectionSchema, request.body, reply);
      if (!body.ok) return;
      const auth = getRequestAuthContext(request);
      return reply.send({ data: toCollectionResponse(service.updateCollection({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        collectionId: params.data.collectionId,
        description: body.data.description,
        defaultExpiresTtlMs: body.data.default_expires_ttl_ms,
        maxItemSizeBytes: body.data.max_item_size_bytes,
        metadataJson: body.data.metadata_json,
        ifVersion: body.data.if_version,
      })) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.delete("/client-data/domains/:domainId/collections/:collectionId", {
    schema: {
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(collectionParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      const deleted = service.deleteCollection(auth.accountId, parsed.data.domainId, parsed.data.collectionId);
      return reply.send({ data: { id: deleted.id, deleted: true } });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains/:domainId/items", {
    schema: {
      response: {
        200: itemListResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const query = parseWithSchema(listItemsQuerySchema, request.query, reply);
      if (!query.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      service.authorizeDomainAccess({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        callerOwner,
        permission: "list",
      });
      const result = service.listItems({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        collectionId: query.data.collection_id,
        itemKeyPrefix: query.data.item_key_prefix,
        updatedAfter: query.data.updated_after,
        updatedBefore: query.data.updated_before,
        expiresAfter: query.data.expires_after,
        expiresBefore: query.data.expires_before,
        expired: query.data.expired,
        limit: query.data.limit,
        offset: query.data.offset,
        sortBy: query.data.sort_by,
        sortOrder: query.data.sort_order,
      });
      return reply.send({
        data: result.rows.map(toItemResponse),
        meta: buildListMeta({ total: result.total, limit: query.data.limit, offset: query.data.offset, sortBy: query.data.sort_by, sortOrder: query.data.sort_order }),
      });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains/:domainId/items/by-key", {
    schema: {
      response: {
        200: itemResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const query = parseWithSchema(itemByKeyQuerySchema, request.query, reply);
      if (!query.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      service.authorizeDomainAccess({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        callerOwner,
        permission: "read",
      });
      return reply.send({ data: toItemResponse(service.getItemByKey({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        collectionName: query.data.collection_name,
        itemKey: query.data.item_key,
      })) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains/:domainId/items/:itemId", {
    schema: {
      response: {
        200: itemResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(itemParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      service.authorizeDomainAccess({
        accountId: auth.accountId,
        domainId: parsed.data.domainId,
        callerOwner,
        permission: "read",
      });
      return reply.send({ data: toItemResponse(service.getItemDetail(auth.accountId, parsed.data.domainId, parsed.data.itemId)) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.put("/client-data/domains/:domainId/items", {
    schema: {
      response: {
        200: upsertItemResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(upsertItemSchema, request.body, reply);
      if (!body.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      service.authorizeDomainAccess({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        callerOwner,
        permission: "write",
      });
      const result = service.upsertItem({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        collectionName: body.data.collection_name,
        itemKey: body.data.item_key,
        valueJson: body.data.value_json,
        expiresAt: body.data.expires_at,
        ifVersion: body.data.if_version,
      });
      return reply.send({ data: { action: result.action, collection: toCollectionResponse(result.collection), item: toItemResponse(result.item) } });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.put("/client-data/domains/:domainId/items/batch", {
    schema: {
      response: {
        200: batchUpsertResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(batchUpsertItemSchema, request.body, reply);
      if (!body.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      service.authorizeDomainAccess({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        callerOwner,
        permission: "write",
      });
      const result = service.upsertItemsBatch({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        items: body.data.items.map((item) => ({
          collectionName: item.collection_name,
          itemKey: item.item_key,
          valueJson: item.value_json,
          expiresAt: item.expires_at,
          ifVersion: item.if_version,
        })),
      });
      return reply.send({ data: { results: result.results.map((entry) => ({ action: entry.action, collection: toCollectionResponse(entry.collection), item: toItemResponse(entry.item) })) } });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.delete("/client-data/domains/:domainId/items/:itemId", {
    schema: {
      response: {
        200: deleteResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(itemParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      service.authorizeDomainAccess({
        accountId: auth.accountId,
        domainId: parsed.data.domainId,
        callerOwner,
        permission: "delete",
      });
      const deleted = service.deleteItem(auth.accountId, parsed.data.domainId, parsed.data.itemId);
      return reply.send({ data: { id: deleted.id, deleted: true } });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.post("/client-data/domains/:domainId/items/delete-batch", {
    schema: {
      response: {
        200: deleteBatchResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(deleteBatchItemsSchema, request.body, reply);
      if (!body.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      service.authorizeDomainAccess({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        callerOwner,
        permission: "delete",
      });
      const deleted = service.deleteItemsBatch({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        itemIds: body.data.item_ids,
        collectionId: body.data.collection_id,
      });
      return reply.send({ data: deleted.map((item) => ({ id: item.id, collection_id: item.collectionId, item_key: item.itemKey })) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains/:domainId/grants", {
    schema: {
      response: {
        200: grantListResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      const grants = service.listDomainGrants({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        callerOwner,
      });
      return reply.send({ data: grants.map(toGrantResponse) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.post("/client-data/domains/:domainId/grants", {
    schema: {
      response: {
        201: grantResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(createGrantSchema, request.body, reply);
      if (!body.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      const grant = service.createDomainGrant({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        callerOwner,
        granteeOwnerType: body.data.grantee_owner_type,
        granteeOwnerId: body.data.grantee_owner_id,
        canRead: body.data.can_read,
        canWrite: body.data.can_write,
        canDelete: body.data.can_delete,
        canList: body.data.can_list,
        expiresAt: body.data.expires_at,
        actor: getAuditActor(request),
        requestId: request.id,
      });
      return reply.code(201).send({ data: toGrantResponse(grant) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.patch("/client-data/domains/:domainId/grants/:grantId", {
    schema: {
      response: {
        200: grantResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(grantParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(updateGrantSchema, request.body, reply);
      if (!body.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      const grant = service.updateDomainGrant({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        grantId: params.data.grantId,
        callerOwner,
        canRead: body.data.can_read,
        canWrite: body.data.can_write,
        canDelete: body.data.can_delete,
        canList: body.data.can_list,
        expiresAt: body.data.expires_at,
        actor: getAuditActor(request),
        requestId: request.id,
      });
      return reply.send({ data: toGrantResponse(grant) });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.delete("/client-data/domains/:domainId/grants/:grantId", {
    schema: {
      response: {
        200: deleteResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(grantParamsSchema, request.params, reply);
      if (!params.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      const deleted = service.deleteDomainGrant({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        grantId: params.data.grantId,
        callerOwner,
        actor: getAuditActor(request),
        requestId: request.id,
      });
      return reply.send({ data: { id: deleted.id, deleted: true } });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });

  app.get("/client-data/domains/:domainId/audit-logs", {
    schema: {
      response: {
        200: auditLogListResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const query = parseWithSchema(listAuditLogsQuerySchema, request.query, reply);
      if (!query.ok) return;
      const callerOwner = getCallerOwnerOrReply(request, reply);
      if (callerOwner === INVALID_CALLER_OWNER) return;
      const auth = getRequestAuthContext(request);
      const result = service.listAuditLogs({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        callerOwner,
        actorType: query.data.actor_type,
        action: query.data.action,
        limit: query.data.limit,
        offset: query.data.offset,
        sortOrder: query.data.sort_order,
      });
      return reply.send({
        data: result.rows.map(toAuditLogResponse),
        meta: buildListMeta({ total: result.total, limit: query.data.limit, offset: query.data.offset, sortBy: query.data.sort_by, sortOrder: query.data.sort_order }),
      });
    } catch (error) {
      return handleClientDataError(error, reply);
    }
  });
}

function handleClientDataError(error: unknown, reply: any) {
  if (error instanceof ClientDataServiceError) {
    return reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }
  throw error;
}

function toDomainResponse(domain: any) {
  return {
    id: domain.id,
    owner_type: domain.ownerType,
    owner_id: domain.ownerId,
    domain_name: domain.domainName,
    display_name: domain.displayName,
    description: domain.description,
    status: domain.status,
    version: domain.version,
    quota_max_entries: domain.quotaMaxEntries,
    quota_max_bytes: domain.quotaMaxBytes,
    current_entry_count: domain.currentEntryCount,
    current_byte_count: domain.currentByteCount,
    created_at: domain.createdAt,
    updated_at: domain.updatedAt,
    deleted_at: domain.deletedAt,
  };
}

function toDomainDetailResponse(domain: any) {
  return {
    ...toDomainResponse(domain),
    quota_usage: {
      entry_count: domain.quotaUsage.entryCount,
      byte_count: domain.quotaUsage.byteCount,
    },
    restorable_until: domain.restorableUntil,
  };
}

function toCollectionResponse(collection: any) {
  return {
    id: collection.id,
    domain_id: collection.domainId,
    collection_name: collection.collectionName,
    description: collection.description,
    default_expires_ttl_ms: collection.defaultExpiresTtlMs,
    max_item_size_bytes: collection.maxItemSizeBytes,
    version: collection.version,
    metadata_json: parseJsonField(collection.metadataJson),
    item_count: collection.itemCount,
    byte_count: collection.byteCount,
    created_at: collection.createdAt,
    updated_at: collection.updatedAt,
  };
}

function toItemResponse(item: any) {
  return {
    id: item.id,
    domain_id: item.domainId,
    collection_id: item.collectionId,
    item_key: item.itemKey,
    value_json: parseJsonField(item.valueJson),
    byte_size: item.byteSize,
    version: item.version,
    expires_at: item.expiresAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function toGrantResponse(grant: any) {
  return {
    id: grant.id,
    domain_id: grant.domainId,
    grantee_owner_type: grant.granteeOwnerType,
    grantee_owner_id: grant.granteeOwnerId,
    can_read: grant.canRead,
    can_write: grant.canWrite,
    can_delete: grant.canDelete,
    can_list: grant.canList,
    created_at: grant.createdAt,
    updated_at: grant.updatedAt,
    expires_at: grant.expiresAt,
  };
}

function toAuditLogResponse(log: any) {
  return {
    id: log.id,
    account_id: log.accountId,
    domain_id: log.domainId,
    owner_type: log.ownerType,
    owner_id: log.ownerId,
    actor_type: log.actorType,
    actor_id: log.actorId,
    action: log.action,
    target_type: log.targetType,
    target_id: log.targetId,
    request_id: log.requestId,
    metadata_json: parseJsonField(log.metadataJson),
    created_at: log.createdAt,
  };
}

function toExportResponse(snapshot: ClientDataExportSnapshot) {
  return {
    domain: {
      id: snapshot.domain.id,
      owner_type: snapshot.domain.ownerType,
      owner_id: snapshot.domain.ownerId,
      domain_name: snapshot.domain.domainName,
      display_name: snapshot.domain.displayName,
      description: snapshot.domain.description,
      created_at: snapshot.domain.createdAt,
    },
    collections: snapshot.collections.map((collection) => ({
      collection_name: collection.collectionName,
      description: collection.description,
      default_expires_ttl_ms: collection.defaultExpiresTtlMs,
      max_item_size_bytes: collection.maxItemSizeBytes,
      metadata_json: collection.metadataJson,
      items: collection.items.map((item) => ({
        item_key: item.itemKey,
        value_json: item.valueJson,
        version: item.version ?? 1,
        expires_at: item.expiresAt,
        created_at: item.createdAt ?? 0,
        updated_at: item.updatedAt ?? 0,
      })),
    })),
    exported_at: snapshot.exportedAt,
  };
}

function toImportPayload(payload: any): ClientDataImportPayload {
  return {
    domain: {
      ownerType: payload.domain.owner_type,
      ownerId: payload.domain.owner_id,
      domainName: payload.domain.domain_name,
      displayName: payload.domain.display_name,
      description: payload.domain.description,
    },
    collections: payload.collections.map((collection: any) => ({
      collectionName: collection.collection_name,
      description: collection.description,
      defaultExpiresTtlMs: collection.default_expires_ttl_ms,
      maxItemSizeBytes: collection.max_item_size_bytes,
      metadataJson: collection.metadata_json,
      items: collection.items.map((item: any) => ({
        itemKey: item.item_key,
        valueJson: item.value_json,
        version: item.version,
        expiresAt: item.expires_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
    })),
  };
}

function toImportResponse(result: ClientDataImportResult) {
  return {
    domain: toDomainResponse(result.domain),
    collections: result.collections.map(toCollectionResponse),
    summary: {
      collections_created: result.summary.collectionsCreated,
      items_created: result.summary.itemsCreated,
      items_updated: result.summary.itemsUpdated,
      items_skipped: result.summary.itemsSkipped,
      imported_item_count: result.summary.importedItemCount,
      imported_byte_count: result.summary.importedByteCount,
      conflict_policy: result.summary.conflictPolicy,
    },
  };
}

const INVALID_CALLER_OWNER = Symbol("invalid-caller-owner");

function getCallerOwnerOrReply(
  request: Parameters<typeof parseClientDataCallerOwner>[0],
  reply: Parameters<typeof sendClientDataCallerOwnerError>[0],
): ClientDataCallerOwner | null | typeof INVALID_CALLER_OWNER {
  try {
    return parseClientDataCallerOwner(request);
  } catch {
    sendClientDataCallerOwnerError(reply);
    return INVALID_CALLER_OWNER;
  }
}

function getAuditActor(request: Parameters<typeof getRequestAuthContext>[0]) {
  const auth = getRequestAuthContext(request);
  try {
    const callerOwner = parseClientDataCallerOwner(request);
    if (callerOwner) {
      return {
        actorType: `owner:${callerOwner.ownerType}`,
        actorId: callerOwner.ownerId,
      };
    }
  } catch {
    return {
      actorType: "account",
      actorId: auth.accountId,
    };
  }

  return {
    actorType: "account",
    actorId: auth.accountId,
  };
}
