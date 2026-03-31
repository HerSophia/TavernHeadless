import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import type { CoreEventBus } from "@tavern/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { runtimeJobs } from "../db/schema.js";
import { LocalChatTransferArtifactStore } from "../services/chat-transfer-artifacts.js";
import {
  CHAT_TRANSFER_FORMATS,
  CHAT_TRANSFER_JOB_KINDS,
  CHAT_TRANSFER_JOB_PHASES,
  CHAT_TRANSFER_JOB_STATUSES,
} from "../services/chat-transfer-job-scheduler.js";
import {
  CHAT_TRANSFER_RUNTIME_SCOPE_TYPE,
  createChatTransferRuntimeJobCatalog,
  fromChatTransferRuntimeJobType,
  readChatTransferJobState,
} from "../services/chat-transfer-runtime-job-definitions.js";
import {
  RuntimeJobInvalidStateError,
  RuntimeJobNotFoundError,
  RuntimeJobQueryService,
} from "../services/runtime-job-query-service.js";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination.js";
import { parseJsonField, parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";

const ADVANCED_CHAT_TRANSFER_DESCRIPTION = "高级开发特性。该组路由用于观察和管理 Background Job Runtime 中的 chat transfer 作业，主要面向开发、调试、运维和自动化工具，不属于普通终端用户的日常导入导出界面。";

export interface ChatTransferJobRoutesOptions {
  artifactDir?: string;
  eventBus?: CoreEventBus;
}

const chatTransferJobKindSchema = z.enum(CHAT_TRANSFER_JOB_KINDS);
const chatTransferJobStatusSchema = z.enum(CHAT_TRANSFER_JOB_STATUSES);
const chatTransferFormatSchema = z.enum(CHAT_TRANSFER_FORMATS);

const chatTransferJobParamsSchema = z.object({
  id: z.string().min(1),
});

const listChatTransferJobsQuerySchema = listQuerySchemaBase.extend({
  job_kind: chatTransferJobKindSchema.optional(),
  status: chatTransferJobStatusSchema.optional(),
  format: chatTransferFormatSchema.optional(),
  requested_session_id: z.string().min(1).optional(),
  result_session_id: z.string().min(1).optional(),
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

const chatTransferJobJsonSchema = {
  type: "object",
  required: [
    "id",
    "job_kind",
    "status",
    "phase",
    "attempt_count",
    "max_attempts",
    "available_at",
    "created_at",
    "updated_at",
    "progress_current",
  ],
  properties: {
    id: { type: "string" },
    job_kind: { type: "string", enum: [...CHAT_TRANSFER_JOB_KINDS] },
    format: { anyOf: [{ type: "string", enum: [...CHAT_TRANSFER_FORMATS] }, { type: "null" }] },
    status: { type: "string", enum: [...CHAT_TRANSFER_JOB_STATUSES] },
    phase: { type: "string", enum: [...CHAT_TRANSFER_JOB_PHASES] },
    requested_session_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    result_session_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    request: {},
    result: { anyOf: [{ type: "object", additionalProperties: true }, { type: "array" }, { type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] },
    input_artifact_path: { anyOf: [{ type: "string" }, { type: "null" }] },
    normalized_artifact_path: { anyOf: [{ type: "string" }, { type: "null" }] },
    output_artifact_path: { anyOf: [{ type: "string" }, { type: "null" }] },
    output_expires_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
    progress_current: { type: "integer", minimum: 0 },
    progress_total: { anyOf: [{ type: "integer" }, { type: "null" }] },
    progress_message: { anyOf: [{ type: "string" }, { type: "null" }] },
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

const chatTransferJobExample = {
  id: "ctj_export_demo",
  job_kind: "export_chat",
  format: "thchat",
  status: "succeeded",
  phase: "completed",
  requested_session_id: "sess_demo",
  result_session_id: null,
  request: {
    format: "thchat",
    includeVariables: true,
    includeMemories: true,
  },
  result: {
    format: "thchat",
    fileName: "demo-export.thchat",
    byteLength: 2048,
  },
  input_artifact_path: null,
  normalized_artifact_path: null,
  output_artifact_path: "data/chat-transfer-artifacts/ctj_export_demo.thchat",
  output_expires_at: 1735689600000,
  progress_current: 1,
  progress_total: 1,
  progress_message: "artifact ready",
  attempt_count: 1,
  max_attempts: 5,
  available_at: 1735686000000,
  lease_owner: null,
  lease_until: null,
  last_error: null,
  created_at: 1735686000000,
  updated_at: 1735686005000,
  finished_at: 1735686005000,
} as const;

const chatTransferJobListResponseExample = {
  data: [chatTransferJobExample],
  meta: { total: 1, limit: 20, offset: 0, has_more: false, sort_by: "created_at", sort_order: "desc" },
} as const;

const chatTransferJobDetailResponseExample = { data: chatTransferJobExample } as const;

const chatTransferJobMutationResponseExample = {
  data: { job_id: "ctj_export_demo", status: "cancelled" },
} as const;

const chatTransferJobListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: chatTransferJobJsonSchema },
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
  examples: [chatTransferJobListResponseExample],
} as const;

const chatTransferJobDetailResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: chatTransferJobJsonSchema,
  },
  additionalProperties: false,
  examples: [chatTransferJobDetailResponseExample],
} as const;

const chatTransferJobMutationResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["job_id", "status"],
      properties: {
        job_id: { type: "string" },
        status: { type: "string", enum: [...CHAT_TRANSFER_JOB_STATUSES] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
  examples: [chatTransferJobMutationResponseExample],
} as const;

function runtimeJobFormatExpression() {
  return sql<string | null>`coalesce(
    json_extract(${runtimeJobs.stateJson}, '$.format'),
    json_extract(${runtimeJobs.resultJson}, '$.format'),
    json_extract(${runtimeJobs.payloadJson}, '$.detectedFormat'),
    json_extract(${runtimeJobs.payloadJson}, '$.format')
  )`;
}

function runtimeJobResultSessionExpression() {
  return sql<string | null>`coalesce(
    json_extract(${runtimeJobs.stateJson}, '$.resultSessionId'),
    json_extract(${runtimeJobs.resultJson}, '$.sessionId')
  )`;
}

function runtimeJobRequestInputArtifactExpression() {
  return sql<string | null>`json_extract(${runtimeJobs.payloadJson}, '$.inputArtifactPath')`;
}

function toChatTransferJobResponse(row: typeof runtimeJobs.$inferSelect) {
  const request = parseJsonField(row.payloadJson) as Record<string, unknown> | null;
  const result = row.resultJson ? parseJsonField(row.resultJson) : null;
  const state = readChatTransferJobState(row.stateJson);
  const format = state.format
    ?? (typeof result === "object" && result && "format" in result && typeof result.format === "string" ? result.format : null)
    ?? (typeof request?.detectedFormat === "string" ? request.detectedFormat : null)
    ?? (typeof request?.format === "string" ? request.format : null);

  return {
    id: row.id,
    job_kind: fromChatTransferRuntimeJobType(row.jobType),
    format,
    status: row.status,
    phase: row.phase ?? "queued",
    requested_session_id: row.sessionId,
    result_session_id: state.resultSessionId
      ?? (typeof result === "object" && result && "sessionId" in result && typeof result.sessionId === "string" ? result.sessionId : null),
    request,
    result,
    input_artifact_path: typeof request?.inputArtifactPath === "string" ? request.inputArtifactPath : null,
    normalized_artifact_path: state.normalizedArtifactPath ?? null,
    output_artifact_path: state.outputArtifactPath ?? null,
    output_expires_at: state.outputExpiresAt ?? null,
    progress_current: row.progressCurrent,
    progress_total: row.progressTotal,
    progress_message: row.progressMessage,
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

export async function registerChatTransferJobRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: ChatTransferJobRoutesOptions = {},
): Promise<void> {
  const { db } = connection;
  const artifactStore = new LocalChatTransferArtifactStore(options.artifactDir ?? "data/chat-transfer-artifacts");
  const runtimeQueryService = new RuntimeJobQueryService(db, {
    catalog: createChatTransferRuntimeJobCatalog(),
    eventBus: options.eventBus,
  });

  app.get("/chat-transfer-jobs", {
    schema: {
      tags: ["chat-transfer-jobs"],
      operationId: "listChatTransferJobs",
      summary: "List chat transfer jobs",
      description: ADVANCED_CHAT_TRANSFER_DESCRIPTION,
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 },
          sort_order: { type: "string", enum: ["asc", "desc"] },
          job_kind: { type: "string", enum: [...CHAT_TRANSFER_JOB_KINDS] },
          status: { type: "string", enum: [...CHAT_TRANSFER_JOB_STATUSES] },
          format: { type: "string", enum: [...CHAT_TRANSFER_FORMATS] },
          requested_session_id: { type: "string", minLength: 1 },
          result_session_id: { type: "string", minLength: 1 },
          created_from: { type: "integer", minimum: 0 },
          created_to: { type: "integer", minimum: 0 },
          available_from: { type: "integer", minimum: 0 },
          available_to: { type: "integer", minimum: 0 },
          sort_by: { type: "string", enum: ["created_at", "updated_at", "available_at"] },
        },
        additionalProperties: false,
      },
      response: {
        200: chatTransferJobListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listChatTransferJobsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const formatExpr = runtimeJobFormatExpression();
    const resultSessionExpr = runtimeJobResultSessionExpression();
    const filters = [
      eq(runtimeJobs.accountId, auth.accountId),
      eq(runtimeJobs.scopeType, CHAT_TRANSFER_RUNTIME_SCOPE_TYPE),
    ];

    if (parsedQuery.data.job_kind !== undefined) {
      filters.push(eq(runtimeJobs.jobType, `chat_transfer.${parsedQuery.data.job_kind}`));
    }
    if (parsedQuery.data.status !== undefined) {
      filters.push(eq(runtimeJobs.status, parsedQuery.data.status));
    }
    if (parsedQuery.data.format !== undefined) {
      filters.push(sql`${formatExpr} = ${parsedQuery.data.format}`);
    }
    if (parsedQuery.data.requested_session_id !== undefined) {
      filters.push(eq(runtimeJobs.sessionId, parsedQuery.data.requested_session_id));
    }
    if (parsedQuery.data.result_session_id !== undefined) {
      filters.push(sql`${resultSessionExpr} = ${parsedQuery.data.result_session_id}`);
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
      data: rows.map(toChatTransferJobResponse),
      meta: buildListMeta({
        total: Number(totalRows[0]?.total ?? 0),
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  app.get("/chat-transfer-jobs/:id", {
    schema: {
      tags: ["chat-transfer-jobs"],
      operationId: "getChatTransferJob",
      summary: "Get chat transfer job detail",
      description: ADVANCED_CHAT_TRANSFER_DESCRIPTION,
      params: idParamsJsonSchema,
      response: {
        200: chatTransferJobDetailResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(chatTransferJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [row] = await db.select().from(runtimeJobs).where(and(
      eq(runtimeJobs.id, parsedParams.data.id),
      eq(runtimeJobs.accountId, auth.accountId),
      eq(runtimeJobs.scopeType, CHAT_TRANSFER_RUNTIME_SCOPE_TYPE),
    ));

    if (!row) {
      return sendError(reply, 404, "not_found", "Chat transfer job not found");
    }

    return reply.send({ data: toChatTransferJobResponse(row) });
  });

  app.post("/chat-transfer-jobs/:id/cancel", {
    schema: {
      tags: ["chat-transfer-jobs"],
      operationId: "cancelChatTransferJob",
      summary: "Cancel a pending chat transfer job",
      description: ADVANCED_CHAT_TRANSFER_DESCRIPTION,
      params: idParamsJsonSchema,
      response: {
        200: chatTransferJobMutationResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(chatTransferJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    try {
      const result = await runtimeQueryService.cancel({
        accountId: auth.accountId,
        jobId: parsedParams.data.id,
        scopeType: CHAT_TRANSFER_RUNTIME_SCOPE_TYPE,
      });
      return reply.send({ data: { job_id: result.job.id, status: result.job.status } });
    } catch (error) {
      if (error instanceof RuntimeJobNotFoundError) {
        return sendError(reply, 404, "not_found", "Chat transfer job not found");
      }
      if (error instanceof RuntimeJobInvalidStateError) {
        return sendError(reply, 409, "invalid_state", error.message);
      }
      throw error;
    }
  });

  app.post("/chat-transfer-jobs/:id/retry", {
    schema: {
      tags: ["chat-transfer-jobs"],
      operationId: "retryChatTransferJob",
      summary: "Retry a chat transfer job",
      description: ADVANCED_CHAT_TRANSFER_DESCRIPTION,
      params: idParamsJsonSchema,
      response: {
        200: chatTransferJobMutationResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(chatTransferJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    try {
      const result = await runtimeQueryService.retry({
        accountId: auth.accountId,
        jobId: parsedParams.data.id,
        scopeType: CHAT_TRANSFER_RUNTIME_SCOPE_TYPE,
      });
      return reply.send({ data: { job_id: result.job.id, status: result.job.status } });
    } catch (error) {
      if (error instanceof RuntimeJobNotFoundError) {
        return sendError(reply, 404, "not_found", "Chat transfer job not found");
      }
      if (error instanceof RuntimeJobInvalidStateError) {
        return sendError(reply, 409, "invalid_state", error.message);
      }
      throw error;
    }
  });

  app.get("/chat-transfer-jobs/:id/file", {
    schema: {
      tags: ["chat-transfer-jobs"],
      operationId: "downloadChatTransferJobFile",
      summary: "Download chat transfer job artifact file",
      description: ADVANCED_CHAT_TRANSFER_DESCRIPTION,
      params: idParamsJsonSchema,
      response: {
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(chatTransferJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [row] = await db.select().from(runtimeJobs).where(and(
      eq(runtimeJobs.id, parsedParams.data.id),
      eq(runtimeJobs.accountId, auth.accountId),
      eq(runtimeJobs.scopeType, CHAT_TRANSFER_RUNTIME_SCOPE_TYPE),
    ));

    if (!row) {
      return sendError(reply, 404, "not_found", "Chat transfer job not found");
    }

    if (row.status !== "succeeded") {
      return sendError(reply, 409, "invalid_state", "Job artifact is only available for succeeded jobs");
    }

    const state = readChatTransferJobState(row.stateJson);
    const outputArtifactPath = state.outputArtifactPath ?? null;
    if (!outputArtifactPath) {
      return sendError(reply, 409, "artifact_unavailable", "This job does not produce a downloadable artifact");
    }

    if (state.outputExpiresAt !== null && state.outputExpiresAt !== undefined && Date.now() > state.outputExpiresAt) {
      return sendError(reply, 410, "artifact_expired", "The job artifact has expired");
    }

    const exists = await artifactStore.exists(outputArtifactPath);
    if (!exists) {
      return sendError(reply, 404, "artifact_not_found", "Job artifact not found");
    }

    const buffer = await artifactStore.readBuffer(outputArtifactPath);
    const result = row.resultJson ? parseJsonField(row.resultJson) as Record<string, unknown> | null : null;
    const fileName = typeof result?.fileName === "string" && result.fileName.trim().length > 0
      ? result.fileName
      : readChatTransferJobState(row.stateJson).format === "st_jsonl"
        ? "export.jsonl"
        : "export.thchat";
    const contentType = typeof result?.contentType === "string" && result.contentType.trim().length > 0
      ? result.contentType
      : readChatTransferJobState(row.stateJson).format === "st_jsonl"
        ? "application/x-ndjson; charset=utf-8"
        : "application/json; charset=utf-8";

    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", `attachment; filename="${fileName}"`)
      .send(buffer);
  });
}
