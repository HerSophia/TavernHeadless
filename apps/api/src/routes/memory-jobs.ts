import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MEMORY_JOB_STATUSES,
  MEMORY_JOB_TYPES,
  MEMORY_SCOPES,
} from "@tavern/shared";
import {
  MemoryCompactionPlanner,
  type CoreEventBus,
  type MemoryItem,
} from "@tavern/core";

import type { DatabaseConnection } from "../db/client.js";
import { memoryItems, runtimeJobs, runtimeScopeStates } from "../db/schema.js";
import { parseJsonField, parseWithSchema, sendError } from "../lib/http.js";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { MemoryJobScheduler } from "../services/memory-job-scheduler.js";
import {
  RuntimeJobInvalidStateError,
  RuntimeJobNotFoundError,
  RuntimeJobQueryService,
} from "../services/runtime-job-query-service.js";
import {
  MEMORY_RUNTIME_SCOPE_TYPE,
  createMemoryRuntimeJobCatalog,
  buildMemoryRuntimeScopeKey,
  fromMemoryRuntimeJobType,
  parseMemoryRuntimeScopeKey,
  readMemoryRuntimeScopeMetadata,
  toMemoryRuntimeJobType,
} from "../services/memory-runtime-job-definitions.js";

const ADVANCED_MEMORY_RUNTIME_DESCRIPTION = "高级开发特性。该组路由用于观察和管理 Background Job Runtime 中的 memory 作业与 scope 状态，主要面向开发、调试、运维和自动化工具，不属于普通聊天主流程接口。";

const memoryScopeSchema = z.enum(MEMORY_SCOPES);
const memoryJobTypeSchema = z.enum(MEMORY_JOB_TYPES);
const memoryJobStatusSchema = z.enum(MEMORY_JOB_STATUSES);

const memoryJobParamsSchema = z.object({
  id: z.string().min(1),
});

const memoryScopeParamsSchema = z.object({
  scope: memoryScopeSchema,
  scopeId: z.string().min(1),
});

const listMemoryJobsQuerySchema = listQuerySchemaBase.extend({
  scope: memoryScopeSchema.optional(),
  scope_id: z.string().min(1).optional(),
  job_type: memoryJobTypeSchema.optional(),
  status: memoryJobStatusSchema.optional(),
  floor_id: z.string().min(1).optional(),
  created_from: z.coerce.number().int().min(0).optional(),
  created_to: z.coerce.number().int().min(0).optional(),
  available_from: z.coerce.number().int().min(0).optional(),
  available_to: z.coerce.number().int().min(0).optional(),
  sort_by: z.enum(["created_at", "updated_at", "available_at"]).default("created_at"),
}).refine(
  (value) => value.created_from === undefined || value.created_to === undefined || value.created_from <= value.created_to,
  "created_from must be less than or equal to created_to",
).refine(
  (value) => value.available_from === undefined || value.available_to === undefined || value.available_from <= value.available_to,
  "available_from must be less than or equal to available_to",
);

const listMemoryScopesQuerySchema = listQuerySchemaBase.extend({
  scope: memoryScopeSchema.optional(),
  scope_id: z.string().min(1).optional(),
  sort_by: z.enum(["updated_at", "revision", "last_compaction_at", "last_processed_floor_no"]).default("updated_at"),
});

const enqueueRebuildScopeSchema = z.object({
  trigger_floor_id: z.string().min(1).optional(),
  force_compaction: z.boolean().optional(),
}).optional().default({});

const enqueueCompactScopeSchema = z.object({
  trigger_floor_id: z.string().min(1).optional(),
  force: z.boolean().optional(),
}).optional().default({});

const memoryJobJsonSchema = {
  type: "object",
  required: [
    "id",
    "scope",
    "scope_id",
    "job_type",
    "status",
    "attempt_count",
    "max_attempts",
    "available_at",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: [...MEMORY_SCOPES] },
    scope_id: { type: "string" },
    job_type: { type: "string", enum: [...MEMORY_JOB_TYPES] },
    status: { type: "string", enum: [...MEMORY_JOB_STATUSES] },
    floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    based_on_revision: { anyOf: [{ type: "integer" }, { type: "null" }] },
    payload: {},
    attempt_count: { type: "integer", minimum: 0 },
    max_attempts: { type: "integer", minimum: 1 },
    available_at: { type: "integer", minimum: 0 },
    lease_owner: { anyOf: [{ type: "string" }, { type: "null" }] },
    lease_until: { anyOf: [{ type: "integer" }, { type: "null" }] },
    last_error: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
    finished_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

const memoryJobListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: memoryJobJsonSchema },
    meta: {
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
    },
  },
  additionalProperties: false,
} as const;

const memoryScopeStateJsonSchema = {
  type: "object",
  required: ["scope", "scope_id", "revision", "updated_at"],
  properties: {
    scope: { type: "string", enum: [...MEMORY_SCOPES] },
    scope_id: { type: "string" },
    revision: { type: "integer", minimum: 0 },
    lease_owner: { anyOf: [{ type: "string" }, { type: "null" }] },
    lease_until: { anyOf: [{ type: "integer" }, { type: "null" }] },
    last_processed_floor_no: { anyOf: [{ type: "integer" }, { type: "null" }] },
    last_compaction_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const memoryScopeListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: memoryScopeStateJsonSchema },
    meta: {
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
    },
  },
  additionalProperties: false,
} as const;

const enqueueJobResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["job_id", "created"],
      properties: {
        job_id: { type: "string" },
        created: { type: "boolean" },
        scope: { type: "string", enum: [...MEMORY_SCOPES] },
        scope_id: { type: "string" },
        reason: { type: "string" },
        source_micro_ids: { type: "array", items: { type: "string" } },
        coverage_start_floor_no: { anyOf: [{ type: "integer" }, { type: "null" }] },
        coverage_end_floor_no: { anyOf: [{ type: "integer" }, { type: "null" }] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

function parseMemoryContent(contentJson: string): string {
  const parsed = parseJsonField(contentJson);
  if (typeof parsed === "string") {
    return parsed;
  }

  if (parsed && typeof parsed === "object" && "text" in parsed && typeof parsed.text === "string") {
    return parsed.text;
  }

  return JSON.stringify(parsed);
}

function toMemoryItem(row: typeof memoryItems.$inferSelect): MemoryItem {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    type: row.type,
    summaryTier: row.summaryTier ?? undefined,
    content: parseMemoryContent(row.contentJson),
    factKey: row.factKey ?? undefined,
    importance: row.importance,
    confidence: row.confidence,
    sourceFloorId: row.sourceFloorId ?? undefined,
    sourceMessageId: row.sourceMessageId ?? undefined,
    status: row.status,
    lifecycleStatus: row.lifecycleStatus ?? undefined,
    sourceJobId: row.sourceJobId ?? undefined,
    tokenCountEstimate: row.tokenCountEstimate ?? undefined,
    lastUsedAt: row.lastUsedAt ?? undefined,
    coverageStartFloorNo: row.coverageStartFloorNo ?? undefined,
    coverageEndFloorNo: row.coverageEndFloorNo ?? undefined,
    derivedFromCount: row.derivedFromCount ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildScopeIdEquals(column: typeof runtimeJobs.scopeKey | typeof runtimeScopeStates.scopeKey, scopeId: string) {
  return sql`substr(${column}, instr(${column}, ':') + 1) = ${scopeId}`;
}

function toMemoryJobResponse(row: typeof runtimeJobs.$inferSelect) {
  const scopeRef = parseMemoryRuntimeScopeKey(row.scopeKey);
  return {
    id: row.id,
    scope: scopeRef.scope,
    scope_id: scopeRef.scopeId,
    job_type: fromMemoryRuntimeJobType(row.jobType),
    status: row.status,
    floor_id: row.floorId,
    based_on_revision: row.basedOnRevision,
    payload: parseJsonField(row.payloadJson),
    attempt_count: row.attemptCount,
    max_attempts: row.maxAttempts,
    available_at: row.availableAt,
    lease_owner: row.leaseOwner,
    lease_until: row.leaseUntil,
    last_error: row.lastError,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    finished_at: row.finishedAt,
  };
}

function toMemoryScopeStateResponse(row: typeof runtimeScopeStates.$inferSelect) {
  const scopeRef = parseMemoryRuntimeScopeKey(row.scopeKey);
  const metadata = readMemoryRuntimeScopeMetadata(row.metadataJson);
  return {
    scope: scopeRef.scope,
    scope_id: scopeRef.scopeId,
    revision: row.revision,
    lease_owner: row.leaseOwner,
    lease_until: row.leaseUntil,
    last_processed_floor_no: metadata.lastProcessedFloorNo ?? null,
    last_compaction_at: metadata.lastCompactionAt ?? null,
    updated_at: row.updatedAt,
  };
}

export interface MemoryJobRoutesOptions {
  enableBackgroundWorker?: boolean;
  eventBus?: CoreEventBus;
}

export async function registerMemoryJobRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: MemoryJobRoutesOptions = {},
): Promise<void> {
  const { db } = connection;
  const scheduler = new MemoryJobScheduler({ eventBus: options.eventBus });
  const runtimeQueryService = new RuntimeJobQueryService(db, {
    catalog: createMemoryRuntimeJobCatalog(),
    eventBus: options.eventBus,
  });
  const planner = new MemoryCompactionPlanner();

  app.get("/memory/jobs", {
    schema: {
      tags: ["memories"],
      summary: "List memory jobs",
      description: ADVANCED_MEMORY_RUNTIME_DESCRIPTION,
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 },
          sort_order: { type: "string", enum: ["asc", "desc"] },
          scope: { type: "string", enum: [...MEMORY_SCOPES] },
          scope_id: { type: "string", minLength: 1 },
          job_type: { type: "string", enum: [...MEMORY_JOB_TYPES] },
          status: { type: "string", enum: [...MEMORY_JOB_STATUSES] },
          floor_id: { type: "string", minLength: 1 },
          created_from: { type: "integer", minimum: 0 },
          created_to: { type: "integer", minimum: 0 },
          available_from: { type: "integer", minimum: 0 },
          available_to: { type: "integer", minimum: 0 },
          sort_by: { type: "string", enum: ["created_at", "updated_at", "available_at"] },
        },
        additionalProperties: false,
      },
      response: {
        200: memoryJobListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listMemoryJobsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const filters = [
      eq(runtimeJobs.accountId, auth.accountId),
      eq(runtimeJobs.scopeType, MEMORY_RUNTIME_SCOPE_TYPE),
    ];

    if (parsedQuery.data.scope !== undefined && parsedQuery.data.scope_id !== undefined) {
      filters.push(eq(runtimeJobs.scopeKey, buildMemoryRuntimeScopeKey(parsedQuery.data.scope, parsedQuery.data.scope_id)));
    } else if (parsedQuery.data.scope !== undefined) {
      filters.push(sql`${runtimeJobs.scopeKey} like ${`${parsedQuery.data.scope}:%`}`);
    } else if (parsedQuery.data.scope_id !== undefined) {
      filters.push(buildScopeIdEquals(runtimeJobs.scopeKey, parsedQuery.data.scope_id));
    }
    if (parsedQuery.data.job_type !== undefined) {
      filters.push(eq(runtimeJobs.jobType, toMemoryRuntimeJobType(parsedQuery.data.job_type)));
    }
    if (parsedQuery.data.status !== undefined) {
      filters.push(eq(runtimeJobs.status, parsedQuery.data.status));
    }
    if (parsedQuery.data.floor_id !== undefined) {
      filters.push(eq(runtimeJobs.floorId, parsedQuery.data.floor_id));
    }
    if (parsedQuery.data.created_from !== undefined) {
      filters.push(gte(runtimeJobs.createdAt, parsedQuery.data.created_from));
    }
    if (parsedQuery.data.created_to !== undefined) {
      filters.push(lte(runtimeJobs.createdAt, parsedQuery.data.created_to));
    }
    if (parsedQuery.data.available_from !== undefined) {
      filters.push(gte(runtimeJobs.availableAt, parsedQuery.data.available_from));
    }
    if (parsedQuery.data.available_to !== undefined) {
      filters.push(lte(runtimeJobs.availableAt, parsedQuery.data.available_to));
    }

    const whereClause = and(...filters);
    const sortByColumn = parsedQuery.data.sort_by === "updated_at"
      ? runtimeJobs.updatedAt
      : parsedQuery.data.sort_by === "available_at"
        ? runtimeJobs.availableAt
        : runtimeJobs.createdAt;

    const rows = await db
      .select()
      .from(runtimeJobs)
      .where(whereClause)
      .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
      .limit(parsedQuery.data.limit)
      .offset(parsedQuery.data.offset);

    const totalRows = await db
      .select({ total: count() })
      .from(runtimeJobs)
      .where(whereClause);

    return reply.send({
      data: rows.map(toMemoryJobResponse),
      meta: buildListMeta({
        total: Number(totalRows[0]?.total ?? 0),
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  app.post("/memory/jobs/:id/retry", {
    schema: {
      tags: ["memories"],
      summary: "Retry a memory job",
      description: ADVANCED_MEMORY_RUNTIME_DESCRIPTION,
      params: idParamsJsonSchema,
      response: {
        200: enqueueJobResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    try {
      const result = await runtimeQueryService.retry({
        accountId: auth.accountId,
        jobId: parsedParams.data.id,
        scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      });
      const scopeRef = parseMemoryRuntimeScopeKey(result.job.scopeKey);

      return reply.send({
        data: {
          job_id: result.job.id,
          created: true,
          scope: scopeRef.scope,
          scope_id: scopeRef.scopeId,
        },
      });
    } catch (error) {
      if (error instanceof RuntimeJobNotFoundError) {
        return sendError(reply, 404, "not_found", "Memory job not found");
      }
      if (error instanceof RuntimeJobInvalidStateError) {
        return sendError(reply, 409, "invalid_state", error.message);
      }
      throw error;
    }
  });

  app.post("/memory/jobs/:id/cancel", {
    schema: {
      tags: ["memories"],
      summary: "Cancel a pending memory job",
      description: ADVANCED_MEMORY_RUNTIME_DESCRIPTION,
      params: idParamsJsonSchema,
      response: {
        200: enqueueJobResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(memoryJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    try {
      const result = await runtimeQueryService.cancel({
        accountId: auth.accountId,
        jobId: parsedParams.data.id,
        scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      });
      const scopeRef = parseMemoryRuntimeScopeKey(result.job.scopeKey);

      return reply.send({
        data: {
          job_id: result.job.id,
          created: true,
          scope: scopeRef.scope,
          scope_id: scopeRef.scopeId,
        },
      });
    } catch (error) {
      if (error instanceof RuntimeJobNotFoundError) {
        return sendError(reply, 404, "not_found", "Memory job not found");
      }
      if (error instanceof RuntimeJobInvalidStateError) {
        return sendError(reply, 409, "invalid_state", error.message);
      }
      throw error;
    }
  });

  app.get("/memory/scopes", {
    schema: {
      tags: ["memories"],
      summary: "List memory scope states",
      description: ADVANCED_MEMORY_RUNTIME_DESCRIPTION,
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 },
          sort_order: { type: "string", enum: ["asc", "desc"] },
          scope: { type: "string", enum: [...MEMORY_SCOPES] },
          scope_id: { type: "string", minLength: 1 },
          sort_by: { type: "string", enum: ["updated_at", "revision", "last_compaction_at", "last_processed_floor_no"] },
        },
        additionalProperties: false,
      },
      response: {
        200: memoryScopeListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listMemoryScopesQuerySchema, request.query, reply);
    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const filters = [
      eq(runtimeScopeStates.accountId, auth.accountId),
      eq(runtimeScopeStates.scopeType, MEMORY_RUNTIME_SCOPE_TYPE),
    ];

    if (parsedQuery.data.scope !== undefined && parsedQuery.data.scope_id !== undefined) {
      filters.push(eq(runtimeScopeStates.scopeKey, buildMemoryRuntimeScopeKey(parsedQuery.data.scope, parsedQuery.data.scope_id)));
    } else if (parsedQuery.data.scope !== undefined) {
      filters.push(sql`${runtimeScopeStates.scopeKey} like ${`${parsedQuery.data.scope}:%`}`);
    } else if (parsedQuery.data.scope_id !== undefined) {
      filters.push(buildScopeIdEquals(runtimeScopeStates.scopeKey, parsedQuery.data.scope_id));
    }

    const whereClause = and(...filters);
    const sortByColumn = parsedQuery.data.sort_by === "revision"
      ? runtimeScopeStates.revision
      : parsedQuery.data.sort_by === "last_compaction_at"
        ? sql<number | null>`json_extract(${runtimeScopeStates.metadataJson}, '$.lastCompactionAt')`
        : parsedQuery.data.sort_by === "last_processed_floor_no"
          ? sql<number | null>`json_extract(${runtimeScopeStates.metadataJson}, '$.lastProcessedFloorNo')`
          : runtimeScopeStates.updatedAt;

    const rows = await db
      .select()
      .from(runtimeScopeStates)
      .where(whereClause)
      .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
      .limit(parsedQuery.data.limit)
      .offset(parsedQuery.data.offset);

    const totalRows = await db
      .select({ total: count() })
      .from(runtimeScopeStates)
      .where(whereClause);

    return reply.send({
      data: rows.map(toMemoryScopeStateResponse),
      meta: buildListMeta({
        total: Number(totalRows[0]?.total ?? 0),
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  app.post("/memory/scopes/:scope/:scopeId/rebuild", {
    schema: {
      tags: ["memories"],
      summary: "Enqueue a scope rebuild job",
      description: ADVANCED_MEMORY_RUNTIME_DESCRIPTION,
      params: {
        type: "object",
        required: ["scope", "scopeId"],
        properties: {
          scope: { type: "string", enum: [...MEMORY_SCOPES] },
          scopeId: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      body: {
        type: "object",
        properties: {
          trigger_floor_id: { type: "string", minLength: 1 },
          force_compaction: { type: "boolean" },
        },
        additionalProperties: false,
      },
      response: {
        200: enqueueJobResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    if (options.enableBackgroundWorker !== true) {
      return sendError(reply, 409, "invalid_state", "Background memory worker is not enabled");
    }

    const parsedParams = parseWithSchema(memoryScopeParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(enqueueRebuildScopeSchema, request.body ?? {}, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const now = Date.now();
    const result = db.transaction((tx) => scheduler.enqueueRebuildScope(tx, {
      accountId: auth.accountId,
      scope: parsedParams.data.scope,
      scopeId: parsedParams.data.scopeId,
      triggerFloorId: parsedBody.data.trigger_floor_id,
      committedAt: now,
      forceCompaction: parsedBody.data.force_compaction !== false,
      seed: `${now}`,
    }));

    return reply.send({
      data: {
        job_id: result.jobId,
        created: result.created,
        scope: parsedParams.data.scope,
        scope_id: parsedParams.data.scopeId,
      },
    });
  });

  app.post("/memory/scopes/:scope/:scopeId/compact", {
    schema: {
      tags: ["memories"],
      summary: "Enqueue a manual macro compaction job",
      description: ADVANCED_MEMORY_RUNTIME_DESCRIPTION,
      params: {
        type: "object",
        required: ["scope", "scopeId"],
        properties: {
          scope: { type: "string", enum: [...MEMORY_SCOPES] },
          scopeId: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      body: {
        type: "object",
        properties: {
          trigger_floor_id: { type: "string", minLength: 1 },
          force: { type: "boolean" },
        },
        additionalProperties: false,
      },
      response: {
        200: enqueueJobResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    if (options.enableBackgroundWorker !== true) {
      return sendError(reply, 409, "invalid_state", "Background memory worker is not enabled");
    }

    const parsedParams = parseWithSchema(memoryScopeParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(enqueueCompactScopeSchema, request.body ?? {}, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const activeSummaryRows = await db
      .select()
      .from(memoryItems)
      .where(and(
        eq(memoryItems.accountId, auth.accountId),
        eq(memoryItems.scope, parsedParams.data.scope),
        eq(memoryItems.scopeId, parsedParams.data.scopeId),
        eq(memoryItems.type, "summary"),
        eq(memoryItems.status, "active"),
        eq(memoryItems.lifecycleStatus, "active"),
      ))
      .orderBy(desc(memoryItems.updatedAt))
      .limit(200);

    const [scopeState] = await db
      .select()
      .from(runtimeScopeStates)
      .where(and(
        eq(runtimeScopeStates.accountId, auth.accountId),
        eq(runtimeScopeStates.scopeType, MEMORY_RUNTIME_SCOPE_TYPE),
        eq(runtimeScopeStates.scopeKey, buildMemoryRuntimeScopeKey(parsedParams.data.scope, parsedParams.data.scopeId)),
      ));

    const activeSummaries = activeSummaryRows.map(toMemoryItem);
    const latestMacroSummary = activeSummaries.find((item) => item.summaryTier === "macro");
    const metadata = scopeState ? readMemoryRuntimeScopeMetadata(scopeState.metadataJson) : {};
    const plan = planner.plan({
      activeSummaries,
      latestMacroSummary,
      lastProcessedFloorNo: metadata.lastProcessedFloorNo ?? undefined,
      force: parsedBody.data.force !== false,
    });

    if (!plan.shouldCompact || plan.sourceMicroIds.length === 0) {
      return sendError(reply, 409, "invalid_state", "No compaction candidates are available for this scope");
    }

    const now = Date.now();
    const result = db.transaction((tx) => scheduler.enqueueCompactMacro(tx, {
      accountId: auth.accountId,
      scope: parsedParams.data.scope,
      scopeId: parsedParams.data.scopeId,
      sessionId: parsedParams.data.scope === "chat" ? parsedParams.data.scopeId : undefined,
      sourceMicroIds: plan.sourceMicroIds,
      coverageStartFloorNo: plan.coverageStartFloorNo,
      coverageEndFloorNo: plan.coverageEndFloorNo,
      triggerFloorId: parsedBody.data.trigger_floor_id,
      committedAt: now,
      force: parsedBody.data.force !== false,
    }));

    return reply.send({
      data: {
        job_id: result.jobId,
        created: result.created,
        scope: parsedParams.data.scope,
        scope_id: parsedParams.data.scopeId,
        reason: plan.reason,
        source_micro_ids: plan.sourceMicroIds,
        coverage_start_floor_no: plan.coverageStartFloorNo ?? null,
        coverage_end_floor_no: plan.coverageEndFloorNo ?? null,
      },
    });
  });
}
