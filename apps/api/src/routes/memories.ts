import { and, count, eq, gte, inArray, like, lte } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { SimpleTokenCounter, type CoreEventBus } from "@tavern/core";
import { MEMORY_SCOPES, parseBranchMemoryScopeId, type MemoryScope } from "@tavern/shared";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { floors, memoryEdges, memoryItems, sessions } from "../db/schema";
import { parseJsonField, parseWithSchema, sendError, stringifyJsonField } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  ManualMemoryMutationService,
  ManualMemoryMutationServiceError,
} from "../services/manual-memory-mutation-service.js";
import { ProjectAccessService, ProjectAccessServiceError } from "../services/project-access-service.js";

const memoryScopeSchema = z.enum(MEMORY_SCOPES);
const memoryTypeSchema = z.enum(["fact", "summary", "open_loop"]);
const memorySummaryTierSchema = z.enum(["micro", "macro"]);
const memoryStatusSchema = z.enum(["active", "deprecated"]);
const memoryLifecycleStatusSchema = z.enum(["active", "compacted", "deprecated"]);
const memoryFactKeyInputSchema = z.string().trim().min(1).nullable().optional();
const memoryFactKeyFilterSchema = z.string().trim().min(1).optional();
const memoryRelationSchema = z.enum(["supports", "contradicts", "updates", "derived_from", "compacts", "resolves"]);
const memoryTextContentObjectSchema = z.object({
  text: z.string().min(1)
}).strict();
const memoryContentSchema = z.union([
  z.string().min(1),
  memoryTextContentObjectSchema
]);

type MemoryTextContent = z.infer<typeof memoryContentSchema>;

function isMemoryTextContentObject(value: unknown): value is { text: string } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { text?: unknown }).text === "string";
}

function normalizeFactKey(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeMemoryContent(value: unknown): MemoryTextContent {
  if (typeof value === "string") {
    return value;
  }

  if (isMemoryTextContentObject(value)) {
    return { text: value.text };
  }

  return JSON.stringify(value);
}

function getMemoryContentText(value: unknown): string {
  const normalized = normalizeMemoryContent(value);
  return typeof normalized === "string" ? normalized : normalized.text;
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
  content: memoryContentSchema,
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
    content: memoryContentSchema.optional(),
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

const memoryContentJsonSchema = {
  anyOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  ],
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
    scope: { type: "string", enum: [...MEMORY_SCOPES] },
    scope_id: { type: "string" },
    type: { type: "string", enum: ["fact", "summary", "open_loop"] },
    summary_tier: { anyOf: [{ type: "string", enum: ["micro", "macro"] }, { type: "null" }] },
    content: memoryContentJsonSchema,
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
  scope: { type: "string", enum: [...MEMORY_SCOPES] },
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
    scope: { type: "string", enum: [...MEMORY_SCOPES] },
    scope_id: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["fact", "summary", "open_loop"] },
    summary_tier: { type: "string", enum: ["micro", "macro"] },
    content: memoryContentJsonSchema,
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
    action: { type: "string", enum: ["updated", "not_found", "project_access_denied"] },
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
    access_denied: { type: "integer", minimum: 0 },
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
    action: { type: "string", enum: ["deleted", "not_found", "project_access_denied"] },
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
    access_denied: { type: "integer", minimum: 0 },
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
    content: normalizeMemoryContent(parseJsonField(row.contentJson)),
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

export interface MemoryRoutesOptions {
  eventBus?: CoreEventBus;
}

type MemoryWriteAccess =
  | { ok: true; accountId: string }
  | { ok: false; error: ProjectAccessServiceError };

type MemoryScopeRow = Pick<typeof memoryItems.$inferSelect, "accountId" | "scope" | "scopeId">;

function handleManualMemoryMutationError(reply: Parameters<typeof sendError>[0], error: unknown) {
  if (error instanceof ManualMemoryMutationServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }

  throw error;
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
  connection: DatabaseConnection,
  options: MemoryRoutesOptions = {}
): Promise<void> {
  const { db } = connection;
  const tokenCounter = new SimpleTokenCounter();
  const mutationService = new ManualMemoryMutationService(db, {
    eventBus: options.eventBus,
  });
  const projectAccessService = new ProjectAccessService(db);

  async function resolveSessionOwnerForMemoryScope(
    scope: MemoryScope,
    scopeId: string,
  ): Promise<{ sessionId: string; accountId: string } | null> {
    if (scope === "global") {
      return null;
    }

    if (scope === "chat") {
      const [row] = await db
        .select({ sessionId: sessions.id, accountId: sessions.accountId })
        .from(sessions)
        .where(eq(sessions.id, scopeId))
        .limit(1);
      return row ?? null;
    }

    if (scope === "branch") {
      const parsed = parseBranchMemoryScopeId(scopeId);
      if (!parsed) {
        return null;
      }

      const [row] = await db
        .select({ sessionId: sessions.id, accountId: sessions.accountId })
        .from(sessions)
        .where(eq(sessions.id, parsed.sessionId))
        .limit(1);
      return row ?? null;
    }

    const [row] = await db
      .select({ sessionId: floors.sessionId, accountId: sessions.accountId })
      .from(floors)
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(eq(floors.id, scopeId))
      .limit(1);
    return row ?? null;
  }

  async function resolveMemoryWriteAccess(
    actorAccountId: string,
    scope: MemoryScope,
    scopeId: string,
  ): Promise<MemoryWriteAccess> {
    const target = await resolveSessionOwnerForMemoryScope(scope, scopeId);
    if (!target) {
      return { ok: true, accountId: actorAccountId };
    }

    try {
      projectAccessService.requireProjectActionBySessionId(actorAccountId, target.sessionId, "project.write");
      return { ok: true, accountId: target.accountId };
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        if (error.code === "session_project_scope_missing") {
          return { ok: true, accountId: actorAccountId };
        }
        if (error.code === "project_access_denied" && error.denyReason === "not_a_member") {
          return { ok: true, accountId: actorAccountId };
        }
        return { ok: false, error };
      }
      throw error;
    }
  }

  async function resolveMemoryWriteAccountId(
    reply: FastifyReply,
    actorAccountId: string,
    scope: MemoryScope,
    scopeId: string,
  ): Promise<string | null> {
    const access = await resolveMemoryWriteAccess(actorAccountId, scope, scopeId);
    if (!access.ok) {
      sendMemoryProjectAccessError(reply, access.error);
      return null;
    }

    return access.accountId;
  }

  async function findMemoryItemScopeRow(id: string): Promise<MemoryScopeRow | null> {
    const [row] = await db
      .select({ accountId: memoryItems.accountId, scope: memoryItems.scope, scopeId: memoryItems.scopeId })
      .from(memoryItems)
      .where(eq(memoryItems.id, id))
      .limit(1);
    return row ?? null;
  }

  async function resolveExistingMemoryItemWriteAccountId(
    reply: FastifyReply,
    actorAccountId: string,
    id: string,
  ): Promise<string | null> {
    const existing = await findMemoryItemScopeRow(id);
    if (!existing) {
      return actorAccountId;
    }

    const access = await resolveMemoryWriteAccess(actorAccountId, existing.scope, existing.scopeId);
    if (!access.ok) {
      sendMemoryProjectAccessError(reply, access.error);
      return null;
    }

    return access.accountId === existing.accountId ? access.accountId : actorAccountId;
  }

  async function resolveMemoryEdgeCreateAccountId(
    reply: FastifyReply,
    actorAccountId: string,
    fromId: string,
  ): Promise<string | null> {
    const fromItem = await findMemoryItemScopeRow(fromId);
    if (!fromItem) {
      return actorAccountId;
    }

    const access = await resolveMemoryWriteAccess(actorAccountId, fromItem.scope, fromItem.scopeId);
    if (!access.ok) {
      sendMemoryProjectAccessError(reply, access.error);
      return null;
    }

    return access.accountId === fromItem.accountId ? access.accountId : actorAccountId;
  }

  async function resolveMemoryEdgeWriteAccountId(
    reply: FastifyReply,
    actorAccountId: string,
    edgeId: string,
  ): Promise<string | null> {
    const [edge] = await db
      .select({ accountId: memoryEdges.accountId, fromId: memoryEdges.fromId })
      .from(memoryEdges)
      .where(eq(memoryEdges.id, edgeId))
      .limit(1);

    if (!edge) {
      return actorAccountId;
    }

    const fromItem = await findMemoryItemScopeRow(edge.fromId);
    if (!fromItem) {
      return actorAccountId;
    }

    const access = await resolveMemoryWriteAccess(actorAccountId, fromItem.scope, fromItem.scopeId);
    if (!access.ok) {
      sendMemoryProjectAccessError(reply, access.error);
      return null;
    }

    return access.accountId === edge.accountId ? access.accountId : actorAccountId;
  }

  function sendBatchMemoryProjectAccessError(reply: FastifyReply, error: ProjectAccessServiceError) {
    return sendMemoryProjectAccessError(reply, error);
  }

  app.post("/memories", {
    schema: {
      tags: ["memories"],
      summary: "Create memory item",
      body: createMemoryBodyJsonSchema,
      response: {
        201: memoryItemResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
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

    const accountId = await resolveMemoryWriteAccountId(
      reply,
      auth.accountId,
      parsedBody.data.scope,
      parsedBody.data.scope_id,
    );
    if (!accountId) return;

    const created = await mutationService.createItem({
      accountId,
      scope: parsedBody.data.scope,
      scopeId: parsedBody.data.scope_id,
      type: parsedBody.data.type,
      summaryTier: parsedBody.data.summary_tier,
      contentJson,
      factKey: parsedBody.data.fact_key,
      importance: parsedBody.data.importance,
      confidence: parsedBody.data.confidence,
      sourceFloorId: parsedBody.data.source_floor_id,
      sourceMessageId: parsedBody.data.source_message_id,
      status: parsedBody.data.status,
      lifecycleStatus: parsedBody.data.lifecycle_status,
    });

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
      const text = getMemoryContentText(parsed);
      if (text.length > 0) {
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
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(batchUpdateMemoryStatusSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const accessibleIdsByAccount = new Map<string, string[]>();
    const accessDeniedIds = new Set<string>();

    for (const id of parsedBody.data.ids) {
      const existing = await findMemoryItemScopeRow(id);
      if (!existing) {
        continue;
      }

      const access = await resolveMemoryWriteAccess(auth.accountId, existing.scope, existing.scopeId);
      if (!access.ok) {
        if (access.error.code === "project_access_denied" && access.error.denyReason === "role_forbidden") {
          accessDeniedIds.add(id);
          continue;
        }
        if (access.error.code === "project_access_denied" && access.error.denyReason === "not_a_member") {
          continue;
        }

        return sendBatchMemoryProjectAccessError(reply, access.error);
      }

      if (access.accountId !== existing.accountId) {
        continue;
      }

      const ids = accessibleIdsByAccount.get(access.accountId) ?? [];
      ids.push(id);
      accessibleIdsByAccount.set(access.accountId, ids);
    }

    const updatedRows = [] as Array<typeof memoryItems.$inferSelect>;
    for (const [accountId, ids] of accessibleIdsByAccount.entries()) {
      updatedRows.push(...await mutationService.batchUpdateItemStatus({
        accountId,
        ids,
        status: parsedBody.data.status,
      }));
    }

    const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
    const results = parsedBody.data.ids.map((id, index) => {
      if (accessDeniedIds.has(id)) {
        return { index, id, action: "project_access_denied" as const };
      }

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
        meta: ({
          total: results.length,
          updated: updatedRows.length,
          not_found: results.length - updatedRows.length - accessDeniedIds.size,
          ...(accessDeniedIds.size > 0 ? { access_denied: accessDeniedIds.size } : {}),
          status: parsedBody.data.status
        })
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
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(batchDeleteMemoriesSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const accessibleIdsByAccount = new Map<string, string[]>();
    const accessDeniedIds = new Set<string>();

    for (const id of parsedBody.data.ids) {
      const existing = await findMemoryItemScopeRow(id);
      if (!existing) {
        continue;
      }

      const access = await resolveMemoryWriteAccess(auth.accountId, existing.scope, existing.scopeId);
      if (!access.ok) {
        if (access.error.code === "project_access_denied" && access.error.denyReason === "role_forbidden") {
          accessDeniedIds.add(id);
          continue;
        }
        if (access.error.code === "project_access_denied"&& access.error.denyReason === "not_a_member") {
          continue;
        }

        return sendBatchMemoryProjectAccessError(reply, access.error);
      }

      if (access.accountId !== existing.accountId) {
        continue;
      }

      const ids = accessibleIdsByAccount.get(access.accountId) ?? [];
      ids.push(id);
      accessibleIdsByAccount.set(access.accountId, ids);
    }

    const deletedRows = [] as Array<typeof memoryItems.$inferSelect>;
    for (const [accountId, ids] of accessibleIdsByAccount.entries()) {
      deletedRows.push(...await mutationService.deleteItems({
        accountId,
        ids,
      }));
    }

    const deletedIds = new Set(deletedRows.map((row) => row.id));
    const results = parsedBody.data.ids.map((id, index) => ({
      index,
      id,
      action: accessDeniedIds.has(id)
        ? ("project_access_denied" as const)
        : deletedIds.has(id) ? ("deleted" as const) : ("not_found" as const)
    }));

    return reply.send({
      data: {
        results,
        meta: ({
          total: results.length,
          deleted: deletedRows.length,
          not_found: results.length - deletedRows.length - accessDeniedIds.size,
          ...(accessDeniedIds.size> 0 ? { access_denied: accessDeniedIds.size } : {}),
        })
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
        403: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
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

    const contentJson = parsedBody.data.content !== undefined
      ? stringifyJsonField(parsedBody.data.content)
      : undefined;
    const normalizedContentJson = contentJson === null ? undefined : contentJson;

    if (parsedBody.data.content !== undefined && contentJson === null) {
      return sendError(reply, 400, "validation_error", "Memory content cannot be undefined");
    }

    const existing = await findMemoryItemScopeRow(parsedParams.data.id);
    let accountId = auth.accountId;

    if (existing) {
      const existingAccess = await resolveMemoryWriteAccess(auth.accountId, existing.scope, existing.scopeId);
      if (!existingAccess.ok) {
        return sendMemoryProjectAccessError(reply, existingAccess.error);
      }

      accountId = existingAccess.accountId === existing.accountId ? existingAccess.accountId : auth.accountId;

      const targetScope = parsedBody.data.scope ?? existing.scope;
      const targetScopeId = parsedBody.data.scope_id ?? existing.scopeId;
      if (targetScope !== existing.scope || targetScopeId !== existing.scopeId) {
        const targetAccess = await resolveMemoryWriteAccess(auth.accountId, targetScope, targetScopeId);
        if (!targetAccess.ok) {
          return sendMemoryProjectAccessError(reply, targetAccess.error);
        }
        if (targetAccess.accountId !== accountId) {
          return sendError(reply, 403, "project_access_denied", "Project action denied: project.write");
        }
      }
    }

    const updated = await mutationService.updateItem({
      accountId,
      id: parsedParams.data.id,
      scope: parsedBody.data.scope,
      scopeId: parsedBody.data.scope_id,
      type: parsedBody.data.type,
      summaryTier: parsedBody.data.summary_tier,
      contentJson: normalizedContentJson,
      factKey: parsedBody.data.fact_key,
      importance: parsedBody.data.importance,
      confidence: parsedBody.data.confidence,
      sourceFloorId: parsedBody.data.source_floor_id,
      sourceMessageId: parsedBody.data.source_message_id,
      status: parsedBody.data.status,
      lifecycleStatus: parsedBody.data.lifecycle_status,
    });

    if (!updated) {
      return sendError(reply, 404, "not_found", "Memory item not found");
    }

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
        403: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryItemParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const accountId = await resolveExistingMemoryItemWriteAccountId(reply, auth.accountId, parsedParams.data.id);
    if (!accountId) return;

    const deleted = await mutationService.deleteItem({
      accountId,
      id: parsedParams.data.id,
    });

    if (!deleted) {
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
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createMemoryEdgeSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const accountId = await resolveMemoryEdgeCreateAccountId(reply, auth.accountId, parsedBody.data.from_id);
    if (!accountId) return;

    try {
      const created = await mutationService.createEdge({
        accountId,
        fromId: parsedBody.data.from_id,
        toId: parsedBody.data.to_id,
        relation: parsedBody.data.relation,
      });

      return reply.code(201).send({ data: toMemoryEdgeResponse(created) });
    } catch (error) {
      return handleManualMemoryMutationError(reply, error);
    }
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
        409: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
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
    const accountId = await resolveMemoryEdgeWriteAccountId(reply, auth.accountId, parsedParams.data.id);
    if (!accountId) return;

    try {
      const updated = await mutationService.updateEdgeRelation({
        accountId,
        id: parsedParams.data.id,
        relation: parsedBody.data.relation,
      });

      if (!updated) {
        return sendError(reply, 404, "not_found", "Memory edge not found");
      }

      return reply.send({ data: toMemoryEdgeResponse(updated) });
    } catch (error) {
      return handleManualMemoryMutationError(reply, error);
    }
  });

  app.delete("/memory-edges/:id", {
    schema: {
      tags: ["memories"],
      summary: "Delete memory edge",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryEdgeParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const accountId = await resolveMemoryEdgeWriteAccountId(reply, auth.accountId, parsedParams.data.id);
    if (!accountId) return;

    const deleted = await mutationService.deleteEdge({
      accountId,
      id: parsedParams.data.id,
    });

    if (!deleted) {
      return sendError(reply, 404, "not_found", "Memory edge not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });
}

function sendMemoryProjectAccessError(reply: FastifyReply, error: ProjectAccessServiceError) {
  if (error.code === "session_not_found") {
    return sendError(reply, 404, "not_found", "Memory target not found");
  }

  return sendError(reply, error.statusCode, error.code, error.message);
}
