import { and, count, eq, gte, inArray, like, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { memoryEdges, memoryItems } from "../db/schema";
import { parseJsonField, parseWithSchema, requireRow, sendError, stringifyJsonField } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { getRequestAuthContext } from "../plugins/auth.js";

const memoryScopeSchema = z.enum(["global", "chat", "floor"]);
const memoryTypeSchema = z.enum(["fact", "summary", "open_loop"]);
const memorySummaryTierSchema = z.enum(["micro", "macro"]);
const memoryStatusSchema = z.enum(["active", "deprecated"]);
const memoryLifecycleStatusSchema = z.enum(["active", "compacted", "deprecated"]);
const memoryFactKeyInputSchema = z.string().trim().min(1).nullable().optional();
const memoryFactKeyFilterSchema = z.string().trim().min(1).optional();
const memoryRelationSchema = z.enum(["supports", "contradicts", "updates", "derived_from", "compacts", "resolves"]);

function normalizeFactKey(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveStoredFactKey(
  type: z.infer<typeof memoryTypeSchema>,
  value: string | null | undefined
): string | null {
  if (type !== "fact") {
    return null;
  }

  return normalizeFactKey(value) ?? null;
}

function toLifecycleStatus(status: z.infer<typeof memoryStatusSchema>) {
  return status === "deprecated" ? "deprecated" : "active";
}

function resolveStoredStatus(
  status: z.infer<typeof memoryStatusSchema> | undefined,
  lifecycleStatus: z.infer<typeof memoryLifecycleStatusSchema> | undefined,
) {
  if (status !== undefined) {
    return status;
  }

  return lifecycleStatus === "deprecated" ? "deprecated" : "active";
}

function resolveStoredLifecycleStatus(status: z.infer<typeof memoryStatusSchema>, lifecycleStatus: z.infer<typeof memoryLifecycleStatusSchema> | undefined) {
  return lifecycleStatus ?? toLifecycleStatus(status);
}

const memoryItemParamsSchema = z.object({
  id: z.string().min(1)
});

const memoryEdgeParamsSchema = z.object({
  id: z.string().min(1)
});

const createMemoryItemSchema = z.object({
  scope: memoryScopeSchema,
  scope_id: z.string().min(1),
  type: memoryTypeSchema,
  summary_tier: memorySummaryTierSchema.optional(),
  content: z.unknown(),
  importance: z.number().min(0).max(1).optional(),
  fact_key: memoryFactKeyInputSchema,
  confidence: z.number().min(0).max(1).optional(),
  source_floor_id: z.string().min(1).optional(),
  source_message_id: z.string().min(1).optional(),
  status: memoryStatusSchema.optional(),
  lifecycle_status: memoryLifecycleStatusSchema.optional(),
});

const updateMemoryItemSchema = z
  .object({
    scope: memoryScopeSchema.optional(),
    scope_id: z.string().min(1).optional(),
    type: memoryTypeSchema.optional(),
    summary_tier: memorySummaryTierSchema.optional(),
    content: z.unknown().optional(),
    importance: z.number().min(0).max(1).optional(),
    fact_key: memoryFactKeyInputSchema,
    confidence: z.number().min(0).max(1).optional(),
    source_floor_id: z.string().min(1).optional(),
    source_message_id: z.string().min(1).optional(),
    status: memoryStatusSchema.optional(),
    lifecycle_status: memoryLifecycleStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const memoryIdArraySchema = z.array(z.string().min(1)).min(1).max(100).superRefine((ids, ctx) => {
  const seen = new Map<string, number>();

  ids.forEach((id, index) => {
    const firstIndex = seen.get(id);

    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `Duplicate memory id also appears at ids.${firstIndex}`
      });
      return;
    }

    seen.set(id, index);
  });
});

const batchUpdateMemoryStatusSchema = z.object({
  ids: memoryIdArraySchema,
  status: memoryStatusSchema
});

const batchDeleteMemoriesSchema = z.object({
  ids: memoryIdArraySchema
});

const memoryFilterSchemaShape = {
  scope: memoryScopeSchema.optional(),
  scope_id: z.string().min(1).optional(),
  type: memoryTypeSchema.optional(),
  summary_tier: memorySummaryTierSchema.optional(),
  status: memoryStatusSchema.optional(),
  lifecycle_status: memoryLifecycleStatusSchema.optional(),
  fact_key: memoryFactKeyFilterSchema,
  source_floor_id: z.string().min(1).optional(),
  source_message_id: z.string().min(1).optional(),
  created_from: z.coerce.number().int().min(0).optional(),
  created_to: z.coerce.number().int().min(0).optional(),
  updated_from: z.coerce.number().int().min(0).optional(),
  updated_to: z.coerce.number().int().min(0).optional(),
  importance_min: z.number().min(0).max(1).optional(),
  importance_max: z.number().min(0).max(1).optional(),
  confidence_min: z.number().min(0).max(1).optional(),
  confidence_max: z.number().min(0).max(1).optional(),
  q: z.string().trim().min(1).optional(),
} as const;

const listMemoryItemsQuerySchema = listQuerySchemaBase
  .extend({
    ...memoryFilterSchemaShape,
    sort_by: z.enum(["created_at", "updated_at", "importance", "confidence"]).default("created_at")
  })
  .refine(
    (value) =>
      value.created_from === undefined || value.created_to === undefined || value.created_from <= value.created_to,
    "created_from must be less than or equal to created_to"
  )
  .refine(
    (value) =>
      value.updated_from === undefined || value.updated_to === undefined || value.updated_from <= value.updated_to,
    "updated_from must be less than or equal to updated_to"
  )
  .refine(
    (value) =>
      value.importance_min === undefined || value.importance_max === undefined || value.importance_min <= value.importance_max,
    "importance_min must be less than or equal to importance_max"
  )
  .refine(
    (value) =>
      value.confidence_min === undefined || value.confidence_max === undefined || value.confidence_min <= value.confidence_max,
    "confidence_min must be less than or equal to confidence_max"
  );

const memoryStatsQuerySchema = z
  .object(memoryFilterSchemaShape)
  .refine(
    (value) =>
      value.created_from === undefined || value.created_to === undefined || value.created_from <= value.created_to,
    "created_from must be less than or equal to created_to"
  )
  .refine(
    (value) =>
      value.updated_from === undefined || value.updated_to === undefined || value.updated_from <= value.updated_to,
    "updated_from must be less than or equal to updated_to"
  )
  .refine(
    (value) =>
      value.importance_min === undefined || value.importance_max === undefined || value.importance_min <= value.importance_max,
    "importance_min must be less than or equal to importance_max"
  )
  .refine(
    (value) =>
      value.confidence_min === undefined || value.confidence_max === undefined || value.confidence_min <= value.confidence_max,
    "confidence_min must be less than or equal to confidence_max"
  );

const createMemoryEdgeSchema = z.object({
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  relation: memoryRelationSchema
});

const updateMemoryEdgeSchema = z.object({
  relation: memoryRelationSchema
});

const listMemoryEdgesQuerySchema = listQuerySchemaBase.extend({
  from_id: z.string().min(1).optional(),
  to_id: z.string().min(1).optional(),
  relation: memoryRelationSchema.optional(),
  sort_by: z.enum(["created_at"]).default("created_at")
});

const memoryItemExample = {
  id: "mem_fact_1",
  scope: "chat",
  scope_id: "session-memory",
  type: "fact",
  content: { text: "Alice carries a silver sword." },
  fact_key: "equipment",
  importance: 0.8,
  confidence: 0.9,
  source_floor_id: "floor_12",
  source_message_id: "msg_21",
  status: "active",
  created_at: 1735689600000,
  updated_at: 1735689660000
} as const;

const deprecatedMemoryItemExample = {
  ...memoryItemExample,
  status: "deprecated",
  updated_at: 1735689720000
} as const;

const memoryItemResponseExample = {
  data: memoryItemExample
} as const;

const memoryListResponseExample = {
  data: [memoryItemExample],
  meta: {
    total: 1,
    limit: 10,
    offset: 0,
    has_more: false,
    sort_by: "created_at",
    sort_order: "desc"
  }
} as const;

const deleteMemoryResponseExample = {
  data: { id: "mem_fact_1", deleted: true }
} as const;

const batchUpdateMemoryStatusBodyExample = {
  ids: ["mem_fact_1", "mem_missing"],
  status: "deprecated"
} as const;

const batchUpdateMemoryStatusResponseExample = {
  data: {
    results: [
      {
        index: 0,
        id: "mem_fact_1",
        action: "updated",
        data: deprecatedMemoryItemExample
      },
      {
        index: 1,
        id: "mem_missing",
        action: "not_found"
      }
    ],
    meta: {
      total: 2,
      updated: 1,
      not_found: 1,
      status: "deprecated"
    }
  }
} as const;

const batchDeleteMemoriesBodyExample = {
  ids: ["mem_fact_1", "mem_missing"]
} as const;

const batchDeleteMemoriesResponseExample = {
  data: {
    results: [
      {
        index: 0,
        id: "mem_fact_1",
        action: "deleted"
      },
      {
        index: 1,
        id: "mem_missing",
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


const memoryItemJsonSchema = {
  type: "object",
  required: [
    "id",
    "scope",
    "scope_id",
    "type",
    "content",
    "importance",
    "confidence",
    "status",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: ["global", "chat", "floor"] },
    scope_id: { type: "string" },
    type: { type: "string", enum: ["fact", "summary", "open_loop"] },
    summary_tier: { anyOf: [{ type: "string", enum: ["micro", "macro"] }, { type: "null" }] },
    content: {},
    importance: { type: "number", minimum: 0, maximum: 1 },
    fact_key: { anyOf: [{ type: "string" }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    source_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    source_message_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    status: { type: "string", enum: ["active", "deprecated"] },
    lifecycle_status: { type: "string", enum: ["active", "compacted", "deprecated"] },
    source_job_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    token_count_estimate: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    last_used_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    coverage_start_floor_no: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    coverage_end_floor_no: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    derived_from_count: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  examples: [memoryItemExample],
  additionalProperties: false,
} as const;

const memoryEdgeJsonSchema = {
  type: "object",
  required: ["id", "from_id", "to_id", "relation", "created_at"],
  properties: {
    id: { type: "string" },
    from_id: { type: "string" },
    to_id: { type: "string" },
    relation: { type: "string", enum: ["supports", "contradicts", "updates", "derived_from", "compacts", "resolves"] },
    created_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const memoryFilterJsonSchemaProperties = {
  scope: { type: "string", enum: ["global", "chat", "floor"] },
  scope_id: { type: "string", minLength: 1 },
  type: { type: "string", enum: ["fact", "summary", "open_loop"] },
  summary_tier: { type: "string", enum: ["micro", "macro"] },
  status: { type: "string", enum: ["active", "deprecated"] },
  lifecycle_status: { type: "string", enum: ["active", "compacted", "deprecated"] },
  fact_key: { type: "string", minLength: 1 },
  source_floor_id: { type: "string", minLength: 1 },
  source_message_id: { type: "string", minLength: 1 },
  created_from: { type: "integer", minimum: 0 },
  created_to: { type: "integer", minimum: 0 },
  updated_from: { type: "integer", minimum: 0 },
  updated_to: { type: "integer", minimum: 0 },
  importance_min: { type: "number", minimum: 0, maximum: 1 },
  importance_max: { type: "number", minimum: 0, maximum: 1 },
  confidence_min: { type: "number", minimum: 0, maximum: 1 },
  confidence_max: { type: "number", minimum: 0, maximum: 1 },
  q: { type: "string", minLength: 1 },
} as const;

const createMemoryBodyJsonSchema = {
  type: "object",
  required: ["scope", "scope_id", "type", "content"],
  properties: {
    scope: { type: "string", enum: ["global", "chat", "floor"] },
    scope_id: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["fact", "summary", "open_loop"] },
    summary_tier: { type: "string", enum: ["micro", "macro"] },
    content: {},
    importance: { type: "number", minimum: 0, maximum: 1 },
    fact_key: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    source_floor_id: { type: "string", minLength: 1 },
    source_message_id: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["active", "deprecated"] },
    lifecycle_status: { type: "string", enum: ["active", "compacted", "deprecated"] },
  },
  additionalProperties: false,
} as const;

const updateMemoryBodyJsonSchema = {
  type: "object",
  properties: createMemoryBodyJsonSchema.properties,
  additionalProperties: false,
  minProperties: 1,
} as const;

const memoryBatchIdsJsonSchema = {
  type: "array",
  minItems: 1,
  maxItems: 100,
  items: { type: "string", minLength: 1 },
} as const;

const batchUpdateMemoryStatusBodyJsonSchema = {
  type: "object",
  required: ["ids", "status"],
  properties: {
    ids: memoryBatchIdsJsonSchema,
    status: { type: "string", enum: ["active", "deprecated"] },
  },
  examples: [batchUpdateMemoryStatusBodyExample],
  additionalProperties: false,
} as const;

const batchDeleteMemoriesBodyJsonSchema = {
  type: "object",
  required: ["ids"],
  properties: {
    ids: memoryBatchIdsJsonSchema,
  },
  examples: [batchDeleteMemoriesBodyExample],
  additionalProperties: false,
} as const;

const listMemoriesQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at", "updated_at", "importance", "confidence"] },
    ...memoryFilterJsonSchemaProperties,
  },
  additionalProperties: false,
} as const;

const listMemoryEdgesQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at"] },
    from_id: { type: "string", minLength: 1 },
    to_id: { type: "string", minLength: 1 },
    relation: { type: "string", enum: ["supports", "contradicts", "updates", "derived_from", "compacts", "resolves"] },
  },
  additionalProperties: false,
} as const;

const statsQueryJsonSchema = {
  type: "object",
  properties: memoryFilterJsonSchemaProperties,
  additionalProperties: false,
} as const;

const createMemoryEdgeBodyJsonSchema = {
  type: "object",
  required: ["from_id", "to_id", "relation"],
  properties: {
    from_id: { type: "string", minLength: 1 },
    to_id: { type: "string", minLength: 1 },
    relation: { type: "string", enum: ["supports", "contradicts", "updates", "derived_from", "compacts", "resolves"] },
  },
  additionalProperties: false,
} as const;

const updateMemoryEdgeBodyJsonSchema = {
  type: "object",
  required: ["relation"],
  properties: {
    relation: { type: "string", enum: ["supports", "contradicts", "updates", "derived_from", "compacts", "resolves"] },
  },
  additionalProperties: false,
} as const;

const memoryItemResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: memoryItemJsonSchema },
  examples: [memoryItemResponseExample],
  additionalProperties: false,
} as const;

const memoryEdgeResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: memoryEdgeJsonSchema },
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
  examples: [deleteMemoryResponseExample],
  additionalProperties: false,
} as const;

const memoryListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: memoryItemJsonSchema },
    meta: listMetaJsonSchema,
  },
  examples: [memoryListResponseExample],
  additionalProperties: false,
} as const;

const memoryEdgeListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: memoryEdgeJsonSchema },
    meta: listMetaJsonSchema,
  },
  additionalProperties: false,
} as const;

const memoryStatsResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "total",
        "active",
        "deprecated",
        "by_type",
        "avg_importance",
        "avg_confidence",
        "estimated_tokens",
      ],
      properties: {
        total: { type: "integer", minimum: 0 },
        active: { type: "integer", minimum: 0 },
        deprecated: { type: "integer", minimum: 0 },
        by_type: {
          type: "object",
          required: ["fact", "summary", "open_loop"],
          properties: {
            fact: { type: "integer", minimum: 0 },
            summary: { type: "integer", minimum: 0 },
            open_loop: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
        avg_importance: { type: "number", minimum: 0 },
        avg_confidence: { type: "number", minimum: 0 },
        estimated_tokens: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const batchUpdateMemoryStatusResultJsonSchema = {
  type: "object",
  required: ["index", "id", "action"],
  properties: {
    index: { type: "integer", minimum: 0 },
    id: { type: "string" },
    action: { type: "string", enum: ["updated", "not_found"] },
    data: memoryItemJsonSchema,
  },
  additionalProperties: false,
} as const;

const batchUpdateMemoryStatusMetaJsonSchema = {
  type: "object",
  required: ["total", "updated", "not_found", "status"],
  properties: {
    total: { type: "integer", minimum: 1 },
    updated: { type: "integer", minimum: 0 },
    not_found: { type: "integer", minimum: 0 },
    status: { type: "string", enum: ["active", "deprecated"] },
  },
  additionalProperties: false,
} as const;

const batchUpdateMemoryStatusResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results", "meta"],
      properties: {
        results: {
          type: "array",
          items: batchUpdateMemoryStatusResultJsonSchema,
        },
        meta: batchUpdateMemoryStatusMetaJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [batchUpdateMemoryStatusResponseExample],
  additionalProperties: false,
} as const;

const batchDeleteMemoryResultJsonSchema = {
  type: "object",
  required: ["index", "id", "action"],
  properties: {
    index: { type: "integer", minimum: 0 },
    id: { type: "string" },
    action: { type: "string", enum: ["deleted", "not_found"] },
  },
  additionalProperties: false,
} as const;

const batchDeleteMemoriesMetaJsonSchema = {
  type: "object",
  required: ["total", "deleted", "not_found"],
  properties: {
    total: { type: "integer", minimum: 1 },
    deleted: { type: "integer", minimum: 0 },
    not_found: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const batchDeleteMemoriesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results", "meta"],
      properties: {
        results: {
          type: "array",
          items: batchDeleteMemoryResultJsonSchema,
        },
        meta: batchDeleteMemoriesMetaJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [batchDeleteMemoriesResponseExample],
  additionalProperties: false,
} as const;

function toMemoryItemResponse(row: typeof memoryItems.$inferSelect) {
  return {
    id: row.id,
    scope: row.scope,
    scope_id: row.scopeId,
    type: row.type,
    summary_tier: row.summaryTier,
    content: parseJsonField(row.contentJson),
    fact_key: row.factKey,
    importance: row.importance,
    confidence: row.confidence,
    source_floor_id: row.sourceFloorId,
    source_message_id: row.sourceMessageId,
    status: row.status,
    lifecycle_status: row.lifecycleStatus,
    source_job_id: row.sourceJobId,
    token_count_estimate: row.tokenCountEstimate,
    last_used_at: row.lastUsedAt,
    coverage_start_floor_no: row.coverageStartFloorNo,
    coverage_end_floor_no: row.coverageEndFloorNo,
    derived_from_count: row.derivedFromCount,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

function toMemoryEdgeResponse(row: typeof memoryEdges.$inferSelect) {
  return {
    id: row.id,
    from_id: row.fromId,
    to_id: row.toId,
    relation: row.relation,
    created_at: row.createdAt
  };
}

function buildMemoryFilters(
  accountId: string,
  query: Pick<
    z.infer<typeof listMemoryItemsQuerySchema>,
    | "scope"
    | "scope_id"
    | "type"
    | "summary_tier"
    | "status"
    | "lifecycle_status"
    | "fact_key"
    | "source_floor_id"
    | "source_message_id"
    | "created_from"
    | "created_to"
    | "updated_from"
    | "updated_to"
    | "importance_min"
    | "importance_max"
    | "confidence_min"
    | "confidence_max"
    | "q"
  >
) {
  const filters = [];
  filters.push(eq(memoryItems.accountId, accountId));

  if (query.scope !== undefined) {
    filters.push(eq(memoryItems.scope, query.scope));
  }

  if (query.scope_id !== undefined) {
    filters.push(eq(memoryItems.scopeId, query.scope_id));
  }

  if (query.type !== undefined) {
    filters.push(eq(memoryItems.type, query.type));
  }

  if (query.summary_tier !== undefined) {
    filters.push(eq(memoryItems.summaryTier, query.summary_tier));
  }

  if (query.status !== undefined) {
    filters.push(eq(memoryItems.status, query.status));
  }

  if (query.lifecycle_status !== undefined) {
    filters.push(eq(memoryItems.lifecycleStatus, query.lifecycle_status));
  }

  if (query.fact_key !== undefined) {
    filters.push(eq(memoryItems.factKey, normalizeFactKey(query.fact_key) ?? query.fact_key));
  }

  if (query.source_floor_id !== undefined) {
    filters.push(eq(memoryItems.sourceFloorId, query.source_floor_id));
  }

  if (query.source_message_id !== undefined) {
    filters.push(eq(memoryItems.sourceMessageId, query.source_message_id));
  }

  if (query.created_from !== undefined) {
    filters.push(gte(memoryItems.createdAt, query.created_from));
  }

  if (query.created_to !== undefined) {
    filters.push(lte(memoryItems.createdAt, query.created_to));
  }

  if (query.updated_from !== undefined) {
    filters.push(gte(memoryItems.updatedAt, query.updated_from));
  }

  if (query.updated_to !== undefined) {
    filters.push(lte(memoryItems.updatedAt, query.updated_to));
  }

  if (query.importance_min !== undefined) {
    filters.push(gte(memoryItems.importance, query.importance_min));
  }

  if (query.importance_max !== undefined) {
    filters.push(lte(memoryItems.importance, query.importance_max));
  }

  if (query.confidence_min !== undefined) {
    filters.push(gte(memoryItems.confidence, query.confidence_min));
  }

  if (query.confidence_max !== undefined) {
    filters.push(lte(memoryItems.confidence, query.confidence_max));
  }

  if (query.q !== undefined) {
    filters.push(like(memoryItems.contentJson, `%${query.q}%`));
  }

  return filters;
}

export async function registerMemoryRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;
  const tokenCounter = new SimpleTokenCounter();

  app.post("/memories", {
    schema: {
      tags: ["memories"],
      summary: "Create memory item",
      body: createMemoryBodyJsonSchema,
      response: {
        201: memoryItemResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createMemoryItemSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const contentJson = stringifyJsonField(parsedBody.data.content);

    if (contentJson === null) {
      return sendError(reply, 400, "validation_error", "Memory content cannot be undefined");
    }

    const now = Date.now();
    const storedStatus = resolveStoredStatus(parsedBody.data.status, parsedBody.data.lifecycle_status);
    const storedLifecycleStatus = resolveStoredLifecycleStatus(storedStatus, parsedBody.data.lifecycle_status);

    const createdRows = await db
      .insert(memoryItems)
      .values({
        id: nanoid(),
        accountId: auth.accountId,
        scope: parsedBody.data.scope,
        scopeId: parsedBody.data.scope_id,
        type: parsedBody.data.type,
        summaryTier: parsedBody.data.type === "summary" ? parsedBody.data.summary_tier ?? null : null,
        contentJson,
        factKey: resolveStoredFactKey(parsedBody.data.type, parsedBody.data.fact_key),
        importance: parsedBody.data.importance ?? 0.5,
        confidence: parsedBody.data.confidence ?? 1,
        sourceFloorId: parsedBody.data.source_floor_id ?? null,
        sourceMessageId: parsedBody.data.source_message_id ?? null,
        status: storedStatus,
        lifecycleStatus: storedLifecycleStatus,
        sourceJobId: null,
        tokenCountEstimate: null,
        lastUsedAt: null,
        coverageStartFloorNo: null,
        coverageEndFloorNo: null,
        derivedFromCount: null,
        createdAt: now,
        updatedAt: now
      })
      .returning();

    const created = requireRow(createdRows[0], "Failed to create memory item");

    return reply.code(201).send({ data: toMemoryItemResponse(created) });
  });

  app.get("/memories", {
    schema: {
      tags: ["memories"],
      summary: "List memory items",
      querystring: listMemoriesQueryJsonSchema,
      response: {
        200: memoryListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listMemoryItemsQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const filters = buildMemoryFilters(auth.accountId, parsedQuery.data);
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const sortByColumn =
      parsedQuery.data.sort_by === "updated_at"
        ? memoryItems.updatedAt
        : parsedQuery.data.sort_by === "importance"
          ? memoryItems.importance
          : parsedQuery.data.sort_by === "confidence"
            ? memoryItems.confidence
            : memoryItems.createdAt;

    const rows =
      whereClause === undefined
        ? await db
            .select()
            .from(memoryItems)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset)
        : await db
            .select()
            .from(memoryItems)
            .where(whereClause)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset);

    const totalRows =
      whereClause === undefined
        ? await db.select({ total: count() }).from(memoryItems)
        : await db.select({ total: count() }).from(memoryItems).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toMemoryItemResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/memories/stats", {
    schema: {
      tags: ["memories"],
      summary: "Memory statistics",
      querystring: statsQueryJsonSchema,
      response: {
        200: memoryStatsResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(memoryStatsQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const filters = buildMemoryFilters(auth.accountId, parsedQuery.data);
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows =
      whereClause === undefined
        ? await db
            .select({
              type: memoryItems.type,
              status: memoryItems.status,
              importance: memoryItems.importance,
              confidence: memoryItems.confidence,
              contentJson: memoryItems.contentJson,
            })
            .from(memoryItems)
        : await db
            .select({
              type: memoryItems.type,
              status: memoryItems.status,
              importance: memoryItems.importance,
              confidence: memoryItems.confidence,
              contentJson: memoryItems.contentJson,
            })
            .from(memoryItems)
            .where(whereClause);

    let active = 0;
    let deprecated = 0;
    let fact = 0;
    let summary = 0;
    let openLoop = 0;
    let importanceTotal = 0;
    let confidenceTotal = 0;
    let estimatedTokens = 0;

    for (const row of rows) {
      if (row.status === "active") {
        active += 1;
      } else {
        deprecated += 1;
      }

      if (row.type === "fact") {
        fact += 1;
      } else if (row.type === "summary") {
        summary += 1;
      } else {
        openLoop += 1;
      }

      importanceTotal += row.importance;
      confidenceTotal += row.confidence;

      const parsed = parseJsonField(row.contentJson);
      const text = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      if (text) {
        estimatedTokens += tokenCounter.count(text);
      }
    }

    const total = rows.length;

    return reply.send({
      data: {
        total,
        active,
        deprecated,
        by_type: {
          fact,
          summary,
          open_loop: openLoop,
        },
        avg_importance: total === 0 ? 0 : importanceTotal / total,
        avg_confidence: total === 0 ? 0 : confidenceTotal / total,
        estimated_tokens: estimatedTokens,
      }
    });
  });

  app.patch("/memories/batch/status", {
    schema: {
      tags: ["memories"],
      summary: "Batch update memory item status",
      operationId: "batchUpdateMemoryItemStatus",
      body: batchUpdateMemoryStatusBodyJsonSchema,
      response: {
        200: batchUpdateMemoryStatusResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(batchUpdateMemoryStatusSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const now = Date.now();
    const updatedRows = await db
      .update(memoryItems)
      .set({
        status: parsedBody.data.status,
        lifecycleStatus: toLifecycleStatus(parsedBody.data.status),
        updatedAt: now,
      })
      .where(and(inArray(memoryItems.id, parsedBody.data.ids), eq(memoryItems.accountId, auth.accountId)))
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
        data: toMemoryItemResponse(row)
      };
    });

    return reply.send({
      data: {
        results,
        meta: {
          total: results.length,
          updated: updatedRows.length,
          not_found: results.length - updatedRows.length,
          status: parsedBody.data.status
        }
      }
    });
  });

  app.post("/memories/batch/delete", {
    schema: {
      tags: ["memories"],
      summary: "Batch delete memory items",
      operationId: "batchDeleteMemoryItems",
      body: batchDeleteMemoriesBodyJsonSchema,
      response: {
        200: batchDeleteMemoriesResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(batchDeleteMemoriesSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const deletedRows = await db
      .delete(memoryItems)
      .where(and(inArray(memoryItems.id, parsedBody.data.ids), eq(memoryItems.accountId, auth.accountId)))
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

  app.get("/memories/:id", {
    schema: {
      tags: ["memories"],
      summary: "Get memory item",
      params: idParamsJsonSchema,
      response: {
        200: memoryItemResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryItemParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [row] = await db.select().from(memoryItems).where(and(eq(memoryItems.id, parsedParams.data.id), eq(memoryItems.accountId, auth.accountId)));

    if (!row) {
      return sendError(reply, 404, "not_found", "Memory item not found");
    }

    return reply.send({ data: toMemoryItemResponse(row) });
  });

  app.patch("/memories/:id", {
    schema: {
      tags: ["memories"],
      summary: "Update memory item",
      params: idParamsJsonSchema,
      body: updateMemoryBodyJsonSchema,
      response: {
        200: memoryItemResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryItemParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const parsedBody = parseWithSchema(updateMemoryItemSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const [existing] = await db
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.id, parsedParams.data.id), eq(memoryItems.accountId, auth.accountId)));

    if (!existing) {
      return sendError(reply, 404, "not_found", "Memory item not found");
    }

    const updates: Partial<typeof memoryItems.$inferInsert> = {
      updatedAt: Date.now()
    };
    const nextType = parsedBody.data.type ?? existing.type;

    if (parsedBody.data.scope !== undefined) {
      updates.scope = parsedBody.data.scope;
    }

    if (parsedBody.data.scope_id !== undefined) {
      updates.scopeId = parsedBody.data.scope_id;
    }

    if (parsedBody.data.type !== undefined) {
      updates.type = parsedBody.data.type;
    }

    if (nextType === "summary") {
      if (parsedBody.data.summary_tier !== undefined) {
        updates.summaryTier = parsedBody.data.summary_tier;
      }
    } else if (parsedBody.data.type !== undefined || parsedBody.data.summary_tier !== undefined) {
      updates.summaryTier = null;
    }

    if (parsedBody.data.content !== undefined) {
      const contentJson = stringifyJsonField(parsedBody.data.content);

      if (contentJson === null) {
        return sendError(reply, 400, "validation_error", "Memory content cannot be undefined");
      }

      updates.contentJson = contentJson;
    }

    if (parsedBody.data.importance !== undefined) {
      updates.importance = parsedBody.data.importance;
    }

    if (parsedBody.data.confidence !== undefined) {
      updates.confidence = parsedBody.data.confidence;
    }

    if (nextType === "fact") {
      if (parsedBody.data.fact_key !== undefined) {
        updates.factKey = resolveStoredFactKey(nextType, parsedBody.data.fact_key);
      }
    } else if (parsedBody.data.type !== undefined || parsedBody.data.fact_key !== undefined) {
      updates.factKey = null;
    }

    if (parsedBody.data.source_floor_id !== undefined) {
      updates.sourceFloorId = parsedBody.data.source_floor_id;
    }

    if (parsedBody.data.source_message_id !== undefined) {
      updates.sourceMessageId = parsedBody.data.source_message_id;
    }

    if (parsedBody.data.status !== undefined) {
      updates.status = parsedBody.data.status;
    }

    if (parsedBody.data.lifecycle_status !== undefined) {
      updates.lifecycleStatus = parsedBody.data.lifecycle_status;
    } else if (parsedBody.data.status !== undefined) {
      updates.lifecycleStatus = toLifecycleStatus(parsedBody.data.status);
    }

    const updatedRows = await db
      .update(memoryItems)
      .set(updates)
      .where(and(eq(memoryItems.id, parsedParams.data.id), eq(memoryItems.accountId, auth.accountId)))
      .returning();

    const updated = requireRow(updatedRows[0], "Failed to update memory item");
    return reply.send({ data: toMemoryItemResponse(updated) });
  });

  app.delete("/memories/:id", {
    schema: {
      tags: ["memories"],
      summary: "Delete memory item",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryItemParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const deleted = await db.delete(memoryItems).where(and(eq(memoryItems.id, parsedParams.data.id), eq(memoryItems.accountId, auth.accountId))).returning();

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Memory item not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });

  app.post("/memory-edges", {
    schema: {
      tags: ["memories"],
      summary: "Create memory edge",
      body: createMemoryEdgeBodyJsonSchema,
      response: {
        201: memoryEdgeResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createMemoryEdgeSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const createdRows = await db
      .insert(memoryEdges)
      .values({
        id: nanoid(),
        accountId: auth.accountId,
        fromId: parsedBody.data.from_id,
        toId: parsedBody.data.to_id,
        relation: parsedBody.data.relation,
        createdAt: Date.now()
      })
      .returning();

    const created = requireRow(createdRows[0], "Failed to create memory edge");

    return reply.code(201).send({ data: toMemoryEdgeResponse(created) });
  });

  app.get("/memory-edges", {
    schema: {
      tags: ["memories"],
      summary: "List memory edges",
      querystring: listMemoryEdgesQueryJsonSchema,
      response: {
        200: memoryEdgeListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listMemoryEdgesQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const filters = [eq(memoryEdges.accountId, auth.accountId)];

    if (parsedQuery.data.from_id !== undefined) {
      filters.push(eq(memoryEdges.fromId, parsedQuery.data.from_id));
    }

    if (parsedQuery.data.to_id !== undefined) {
      filters.push(eq(memoryEdges.toId, parsedQuery.data.to_id));
    }

    if (parsedQuery.data.relation !== undefined) {
      filters.push(eq(memoryEdges.relation, parsedQuery.data.relation));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows =
      whereClause === undefined
        ? await db
            .select()
            .from(memoryEdges)
            .orderBy(toOrderBy(memoryEdges.createdAt, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset)
        : await db
            .select()
            .from(memoryEdges)
            .where(whereClause)
            .orderBy(toOrderBy(memoryEdges.createdAt, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset);

    const totalRows =
      whereClause === undefined
        ? await db.select({ total: count() }).from(memoryEdges)
        : await db.select({ total: count() }).from(memoryEdges).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toMemoryEdgeResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/memory-edges/:id", {
    schema: {
      tags: ["memories"],
      summary: "Get memory edge",
      params: idParamsJsonSchema,
      response: {
        200: memoryEdgeResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryEdgeParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [row] = await db.select().from(memoryEdges).where(and(eq(memoryEdges.id, parsedParams.data.id), eq(memoryEdges.accountId, auth.accountId)));

    if (!row) {
      return sendError(reply, 404, "not_found", "Memory edge not found");
    }

    return reply.send({ data: toMemoryEdgeResponse(row) });
  });

  app.patch("/memory-edges/:id", {
    schema: {
      tags: ["memories"],
      summary: "Update memory edge relation",
      params: idParamsJsonSchema,
      body: updateMemoryEdgeBodyJsonSchema,
      response: {
        200: memoryEdgeResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryEdgeParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(updateMemoryEdgeSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [updated] = await db
      .update(memoryEdges)
      .set({ relation: parsedBody.data.relation })
      .where(and(eq(memoryEdges.id, parsedParams.data.id), eq(memoryEdges.accountId, auth.accountId)))
      .returning();

    if (!updated) {
      return sendError(reply, 404, "not_found", "Memory edge not found");
    }

    return reply.send({ data: toMemoryEdgeResponse(updated) });
  });

  app.delete("/memory-edges/:id", {
    schema: {
      tags: ["memories"],
      summary: "Delete memory edge",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryEdgeParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const deleted = await db
      .delete(memoryEdges)
      .where(and(eq(memoryEdges.id, parsedParams.data.id), eq(memoryEdges.accountId, auth.accountId)))
      .returning();

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Memory edge not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });
}
