import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { floors, sessions } from "../db/schema.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { buildListMeta } from "../lib/pagination.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  OperationLogService,
  type OperationLogRecord,
  type OperationLogStatus,
} from "../services/operation-log-service.js";
import { ProjectAccessService, ProjectAccessServiceError } from "../services/project-access-service.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";

const operationLogStatusSchema = z.enum(["succeeded", "failed", "denied", "cancelled"]);

const operationLogListQuerySchema = z.object({
  workspace_id: z.string().trim().min(1).optional(),
  project_id: z.string().trim().min(1).optional(),
  actor_account_id: z.string().trim().min(1).optional(),
  actor_client_id: z.string().trim().min(1).optional(),
  permission_action: z.string().trim().min(1).optional(),
  result: z.enum(["allowed", "denied"]).optional(),
  session_id: z.string().trim().min(1).optional(),
  floor_id: z.string().trim().min(1).optional(),
  run_id: z.string().trim().min(1).optional(),
  target_type: z.string().trim().min(1).optional(),
  target_id: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  actor_type: z.string().trim().min(1).optional(),
  status: operationLogStatusSchema.optional(),
  operation_group_id: z.string().trim().min(1).optional(),
  request_id: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

type OperationLogListQuery = z.infer<typeof operationLogListQuerySchema>;

const operationLogListQueryJsonSchema = {
  type: "object" as const,
  properties: {
    workspace_id: { type: "string" as const, minLength: 1 },
    project_id: { type: "string" as const, minLength: 1 },
    actor_account_id: { type: "string" as const, minLength: 1 },
    actor_client_id: { type: "string" as const, minLength: 1 },
    permission_action: { type: "string" as const, minLength: 1 },
    result: { type: "string" as const, enum: ["allowed", "denied"] },
    session_id: { type: "string" as const, minLength: 1 },
    floor_id: { type: "string" as const, minLength: 1 },
    run_id: { type: "string" as const, minLength: 1 },
    target_type: { type: "string" as const, minLength: 1 },
    target_id: { type: "string" as const, minLength: 1 },
    action: { type: "string" as const, minLength: 1 },
    actor_type: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["succeeded", "failed", "denied", "cancelled"] },
    operation_group_id: { type: "string" as const, minLength: 1 },
    request_id: { type: "string" as const, minLength: 1 },
    limit: { type: "integer" as const, minimum: 1, maximum: 200, default: 50 },
    offset: { type: "integer" as const, minimum: 0, default: 0 },
    sort_order: { type: "string" as const, enum: ["asc", "desc"], default: "desc" },
  },
  additionalProperties: false,
} as const;

const listMetaJsonSchema = {
  type: "object" as const,
  required: ["total", "limit", "offset", "has_more", "sort_by", "sort_order"],
  properties: {
    total: { type: "integer" as const, minimum: 0 },
    limit: { type: "integer" as const, minimum: 1 },
    offset: { type: "integer" as const, minimum: 0 },
    has_more: { type: "boolean" as const },
    sort_by: { type: "string" as const },
    sort_order: { type: "string" as const, enum: ["asc", "desc"] },
  },
  additionalProperties: false,
} as const;

const operationLogJsonSchema = {
  type: "object" as const,
  required: [
    "id",
    "account_id",
    "actor_type",
    "actor_id",
    "operation_group_id",
    "request_id",
    "source_type",
    "workspace_id",
    "project_id",
    "actor_account_id",
    "actor_client_id",
    "permission_action",
    "result",
    "reason",
    "action",
    "status",
    "session_id",
    "branch_id",
    "floor_id",
    "run_id",
    "target_type",
    "target_id",
    "before_ref",
    "after_ref",
    "diff",
    "metadata",
    "created_at",
  ],
  properties: {
    id: { type: "string" as const },
    account_id: { type: "string" as const },
    actor_type: { type: "string" as const },
    actor_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    operation_group_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    request_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    source_type: { type: "string" as const },
    workspace_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    project_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    actor_account_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    actor_client_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    permission_action: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
result: { anyOf: [{ type: "string" as const, enum: ["allowed", "denied"] }, { type: "null" as const }] },
    reason: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },

    action: { type: "string" as const },
    status: { type: "string" as const, enum: ["succeeded", "failed", "denied", "cancelled"] },
    session_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    branch_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    floor_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    run_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    target_type: { type: "string" as const },
    target_id: { anyOf: [{ type: "string" as const }, { type: "null" as const }] },
    before_ref: {},
    after_ref: {},
    diff: {},
    metadata: {},
    created_at: { type: "integer" as const, minimum: 0 },
  },
  additionalProperties: false,
} as const;

const operationLogListResponseJsonSchema = {
  type: "object" as const,
  required: ["data", "meta"],
  properties: {
    data: { type: "array" as const, items: operationLogJsonSchema },
    meta: listMetaJsonSchema,
  },
  additionalProperties: false,
} as const;

const idParamsSchema = z.object({
  id: z.string().min(1),
});

export async function registerOperationLogRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const { db } = connection;
  const service = new OperationLogService(db);
  const projectAccessService = new ProjectAccessService(db);

  app.get("/operation-logs", {
    schema: {
      tags: ["operation-logs"],
      summary: "List operation logs",
      operationId: "listOperationLogs",
      querystring: operationLogListQueryJsonSchema,
      response: {
        200: operationLogListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(operationLogListQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    return sendOperationLogList(reply, service, auth.accountId, parsedQuery.data);
  });

  app.get("/sessions/:id/operation-logs", {
    schema: {
      tags: ["operation-logs"],
      summary: "List operation logs for a session",
      operationId: "listSessionOperationLogs",
      params: idParamsJsonSchema,
      querystring: operationLogListQueryJsonSchema,
      response: {
        200: operationLogListResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(operationLogListQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    let session: { id: string } | undefined = (await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, parsedParams.data.id), eq(sessions.accountId, auth.accountId)))
      .limit(1))[0];
    let logAccountId = auth.accountId;

    if (!session) {
      try {
        const access = projectAccessService.requireProjectActionBySessionId(
          auth.accountId,
          parsedParams.data.id,
          "project.read",
        );
        const [fallback] = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, parsedParams.data.id))
          .limit(1);
        if (fallback) {
          session = { id: fallback.id };
          logAccountId = access.project.accountId;
        }
      } catch (error) {
        if (!(error instanceof ProjectAccessServiceError)) throw error;
      }
    }

    if (!session) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    return sendOperationLogList(reply, service, logAccountId, {
      ...parsedQuery.data,
      session_id: session.id,
    });

  });

  app.get("/floors/:id/operation-logs", {
    schema: {
      tags: ["operation-logs"],
      summary: "List operation logs for a floor",
      operationId: "listFloorOperationLogs",
      params: idParamsJsonSchema,
      querystring: operationLogListQueryJsonSchema,
      response: {
        200: operationLogListResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(operationLogListQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    let floor: { id: string } | undefined = (await db
      .select({id: floors.id })
      .from(floors)
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(floors.id, parsedParams.data.id), eq(sessions.accountId, auth.accountId)))
      .limit(1))[0];
    let logAccountId = auth.accountId;

    if (!floor) {
      try {
        const access = projectAccessService.requireProjectActionByFloorId(
          auth.accountId,
          parsedParams.data.id,
          "project.read",
        );
        const [fallback]= await db
          .select({ id: floors.id })
          .from(floors)
          .where(eq(floors.id, parsedParams.data.id))
          .limit(1);
        if (fallback) {
          floor = { id: fallback.id };
          logAccountId = access.project.accountId;
        }
      } catch (error) {
        if (!(error instanceof ProjectAccessServiceError)) throw error;
      }
    }

    if (!floor) {
      return sendError(reply, 404, "not_found", "Floor not found");
    }

    return sendOperationLogList(reply, service, logAccountId, {
      ...parsedQuery.data,
      floor_id: floor.id,
    });

  });
}

function sendOperationLogList(
  reply: { send: (payload: unknown) => unknown },
  service: OperationLogService,
  accountId: string,
  query: OperationLogListQuery,
) {
  const result = service.list({
    accountId,
    workspaceId: query.workspace_id,
    projectId: query.project_id,
    actorAccountId: query.actor_account_id,
    actorClientId: query.actor_client_id,
    permissionAction: query.permission_action,
    result: query.result,

    sessionId: query.session_id,
    floorId: query.floor_id,
    runId: query.run_id,
    targetType: query.target_type,
    targetId: query.target_id,
    action: query.action,
    actorType: query.actor_type,
    status: query.status as OperationLogStatus | undefined,
    operationGroupId: query.operation_group_id,
    requestId: query.request_id,
    limit: query.limit,
    offset: query.offset,
    sortOrder: query.sort_order,
  });

  return reply.send({
    data: result.rows.map(toOperationLogResponse),
    meta: buildListMeta({
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      sortBy: "created_at",
      sortOrder: query.sort_order,
    }),
  });
}

function toOperationLogResponse(record: OperationLogRecord) {
  return {
    id: record.id,
    account_id: record.accountId,
    actor_type: record.actorType,
    actor_id: record.actorId,
    operation_group_id: record.operationGroupId,
    request_id: record.requestId,
    source_type: record.sourceType,
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    actor_account_id: record.actorAccountId,
    actor_client_id: record.actorClientId,
    permission_action: record.permissionAction,
    result: record.result,
    reason: record.reason,
    action: record.action,
    status: record.status,
    session_id: record.sessionId,
    branch_id: record.branchId,
    floor_id: record.floorId,
    run_id: record.runId,
    target_type: record.targetType,
    target_id: record.targetId,
    before_ref: record.beforeRef,
    after_ref: record.afterRef,
    diff: record.diff,
    metadata: record.metadata,
    created_at: record.createdAt,
  };
}
