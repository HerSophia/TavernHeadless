import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { parseJsonField, parseWithSchema } from "../lib/http.js";
import { buildListMeta, listQuerySchemaBase } from "../lib/pagination.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { errorResponseJsonSchema } from "../routes/schemas/common.js";
import { ClientDataService, ClientDataServiceError, type ClientDataConfig } from "./client-data-service.js";

const ownerTypeSchema = z.enum(["application", "plugin"]);
const domainStatusSchema = z.enum(["active", "suspended", "deleted"]);
const domainParamsSchema = z.object({ domainId: z.string().min(1) });
const collectionParamsSchema = z.object({ domainId: z.string().min(1), collectionId: z.string().min(1) });
const itemParamsSchema = z.object({ domainId: z.string().min(1), itemId: z.string().min(1) });
const ownerParamsSchema = z.object({ ownerType: ownerTypeSchema, ownerId: z.string().min(1) });

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
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

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
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

const listItemsQuerySchema = listQuerySchemaBase.extend({
  collection_id: z.string().min(1).optional(),
  sort_by: z.enum(["updated_at", "created_at", "item_key"]).default("updated_at"),
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
  required: ["quota_usage"],
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

export async function registerClientDataRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: { clientData: ClientDataConfig },
): Promise<void> {
  const service = new ClientDataService(connection.db, options.clientData);

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
      const deleted = service.deleteDomain(auth.accountId, parsed.data.domainId);
      return reply.send({ data: { id: deleted.id, deleted: true } });
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
      const deleted = service.deleteDomainsByOwner({ accountId: auth.accountId, ownerType: parsed.data.ownerType, ownerId: parsed.data.ownerId });
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
      return reply.send({ data: service.exportDomain(auth.accountId, parsed.data.domainId) });
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
      const auth = getRequestAuthContext(request);
      const result = service.listItems({
        accountId: auth.accountId,
        domainId: params.data.domainId,
        collectionId: query.data.collection_id,
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

  app.get("/client-data/domains/:domainId/items/:itemId", {
    schema: {
      response: {
        200: itemResponseJsonSchema,
        404: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(itemParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
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
      const auth = getRequestAuthContext(request);
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
      const auth = getRequestAuthContext(request);
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
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const parsed = parseWithSchema(itemParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
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
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const params = parseWithSchema(domainParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(deleteBatchItemsSchema, request.body, reply);
      if (!body.ok) return;
      const auth = getRequestAuthContext(request);
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
