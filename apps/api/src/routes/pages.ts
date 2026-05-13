import { and, count, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema, batchIdArraySchema, batchDeleteBodyJsonSchema, batchResultResponseJsonSchema } from "./schemas/common.js";
import { floors, messagePages, sessions } from "../db/schema";
import { parseWithSchema, requireRow, sendError } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { getRequestAuthContext } from "../plugins/auth";
import { ProjectAccessService, ProjectAccessServiceError } from "../services/project-access-service.js";
import { getFloorContentMutationRejection, type FloorContentMutationRejection } from "../services/floor-content-mutability-policy";
import {
  ConversationShapePolicyError,
  ConversationShapePolicyService,
  type ConversationShapeMutationRejection,
} from "../services/conversation-shape-policy.js";
import { OwnedFloorRepository, OwnedPageRepository } from "../services/owned-resource-repositories";
import { deleteVariablesForPages } from "../services/variables/cleanup/variable-owned-resource-cleanup.js";
import { PageActivationService } from "../services/page-activation-service";
import { VariableStageInspectionService } from "../services/variables/inspect/variable-stage-inspection-service.js";
import { VariablePromotionTraceService } from "../services/variables/inspect/variable-promotion-trace-service.js";
import { VariableServiceError } from "../services/variable-service-errors.js";
import {
  mapSqliteConstraintErrorToRouteError,
  type SqliteConstraintErrorMapping,
} from "../services/resource-write.js";

const pageKindSchema = z.enum(["input", "output", "mixed"]);

const pageParamsSchema = z.object({
  id: z.string().min(1)
});

const listPagesQuerySchema = listQuerySchemaBase.extend({
  floor_id: z.string().min(1).optional(),
  page_kind: pageKindSchema.optional(),
  is_active: z.coerce.boolean().optional(),
  sort_by: z.enum(["created_at", "updated_at", "page_no", "version"]).default("created_at")
});

const createPageSchema = z.object({
  floor_id: z.string().min(1),
  page_no: z.number().int().nonnegative(),
  page_kind: pageKindSchema,
  is_active: z.never().optional(),
  version: z.number().int().positive().optional(),
  checksum: z.string().min(1).optional()
}).strict();

const updatePageSchema = z
  .object({
    page_no: z.number().int().nonnegative().optional(),
    page_kind: pageKindSchema.optional(),
    is_active: z.never().optional(),
    version: z.number().int().positive().optional(),
    checksum: z.string().min(1).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");


const listPagesQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at", "updated_at", "page_no", "version"] },
    floor_id: { type: "string", minLength: 1 },
    page_kind: { type: "string", enum: ["input", "output", "mixed"] },
    is_active: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const pageBodyJsonSchema = {
  type: "object",
  properties: {
    floor_id: { type: "string", minLength: 1 },
    page_no: { type: "integer", minimum: 0 },
    page_kind: { type: "string", enum: ["input", "output", "mixed"] },
    is_active: { not: {} },
    version: { type: "integer", minimum: 1 },
    checksum: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const pageJsonSchema = {
  type: "object",
  required: ["id", "floor_id", "page_no", "page_kind", "is_active", "version", "checksum", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    floor_id: { type: "string" },
    page_no: { type: "integer", minimum: 0 },
    page_kind: { type: "string", enum: ["input", "output", "mixed"] },
    is_active: { type: "boolean" },
    version: { type: "integer", minimum: 1 },
    checksum: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
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

const pageResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: pageJsonSchema },
  additionalProperties: false,
} as const;

const pageListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: pageJsonSchema },
    meta: listMetaJsonSchema,
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
      properties: { id: { type: "string" }, deleted: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const pageVariableInspectionObjectJsonSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const pageStagedVariableWriteJsonSchema = {
  type: "object",
  required: ["id", "key", "op", "value", "intent", "conflict_policy", "reason", "source", "evidence", "status", "created_at", "resolved_at"],
  properties: {
    id: { type: "string" },
    key: { type: "string" },
    op: { type: "string", enum: ["set", "delete"] },
    value: {},
    intent: { type: "string", enum: ["page_only", "promote_to_floor_on_accept"] },
    conflict_policy: { type: "string", enum: ["replace", "if_absent"] },
    reason: { type: "string" },
    source: pageVariableInspectionObjectJsonSchema,
    evidence: pageVariableInspectionObjectJsonSchema,
    status: { type: "string", enum: ["staged", "accepted_page_only", "promoted", "rejected", "discarded", "rerouted_to_session_state"] },
    decision_reason: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    resolved_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

const pageVariablePromotionTraceJsonSchema = {
  type: "object",
  required: ["id", "staged_write_id", "key", "from_scope", "from_scope_id", "to_scope", "to_scope_id", "conflict_policy", "value", "created_at"],
  properties: {
    id: { type: "string" },
    staged_write_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    key: { type: "string" },
    from_scope: { type: "string", enum: ["page", "floor", "branch", "chat"] },
    from_scope_id: { type: "string" },
    to_scope: { type: "string", enum: ["floor", "branch", "chat", "global"] },
    to_scope_id: { type: "string" },
    conflict_policy: { type: "string", enum: ["replace", "if_absent"] },
    source_variable_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    target_variable_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    value: {},
    created_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const pageStagedVariablesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["page_id", "floor_id", "session_id", "branch_id", "items"],
      properties: {
        page_id: { type: "string" },
        floor_id: { type: "string" },
        session_id: { type: "string" },
        branch_id: { type: "string" },
        items: { type: "array", items: pageStagedVariableWriteJsonSchema },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const pagePromotionsResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["page_id", "floor_id", "session_id", "branch_id", "items"],
      properties: {
        page_id: { type: "string" },
        floor_id: { type: "string" },
        session_id: { type: "string" },
        branch_id: { type: "string" },
        items: { type: "array", items: pageVariablePromotionTraceJsonSchema },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

type PageRowLike = {
  id: string;
  floorId: string;
  pageNo: number;
  pageKind: typeof messagePages.$inferSelect["pageKind"];
  isActive: boolean;
  version: number;
  checksum: string | null;
  createdAt: number;
  updatedAt: number;
};

function toPageResponse(row: PageRowLike) {
  return {
    id: row.id,
    floor_id: row.floorId,
    page_no: row.pageNo,
    page_kind: row.pageKind,
    is_active: row.isActive,
    version: row.version,
    checksum: row.checksum,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

function toPageStagedVariableWriteResponse(item: {
  id: string;
  key: string;
  op: string;
  value: unknown;
  intent: string;
  conflictPolicy: string;
  reason: string;
  source: unknown;
  evidence: unknown;
  status: string;
  decisionReason: string | null;
  createdAt: number;
  resolvedAt: number | null;
}) {
  return {
    id: item.id,
    key: item.key,
    op: item.op,
    value: item.value,
    intent: item.intent,
    conflict_policy: item.conflictPolicy,
    reason: item.reason,
    source: item.source,
    evidence: item.evidence,
    status: item.status,
    decision_reason: item.decisionReason,
    created_at: item.createdAt,
    resolved_at: item.resolvedAt,
  };
}

function toPageVariablePromotionTraceResponse(item: {
  id: string;
  stagedWriteId: string | null;
  key: string;
  fromScope: string;
  fromScopeId: string;
  toScope: string;
  toScopeId: string;
  conflictPolicy: string;
  sourceVariableId: string | null;
  targetVariableId: string | null;
  value: unknown;
  createdAt: number;
}) {
  return {
    id: item.id,
    staged_write_id: item.stagedWriteId,
    key: item.key,
    from_scope: item.fromScope,
    from_scope_id: item.fromScopeId,
    to_scope: item.toScope,
    to_scope_id: item.toScopeId,
    conflict_policy: item.conflictPolicy,
    source_variable_id: item.sourceVariableId,
    target_variable_id: item.targetVariableId,
    value: item.value,
    created_at: item.createdAt,
  };
}

function sendPageMutationRejection(reply: Parameters<typeof sendError>[0], rejection: FloorContentMutationRejection) {
  return sendError(reply, 409, rejection.code, rejection.message);
}

function sendConversationShapeRejection(
  reply: Parameters<typeof sendError>[0],
  rejection: ConversationShapeMutationRejection,
) {
  return sendError(reply, 409, rejection.code, rejection.message, {
    reason: rejection.reason,
    floor_id: rejection.floorId,
    previous_floor_id: rejection.previousFloorId,
    next_floor_id: rejection.nextFloorId,
  });
}

const PAGE_CONSTRAINT_MAPPINGS: SqliteConstraintErrorMapping[] = [
  {
    constraintName: "message_page_floor_no_version_uq",
    fallbackPatterns: ["message_page.floor_id, message_page.page_no, message_page.version"],
    statusCode: 409,
    code: "page_conflict",
    message: "Message page version already exists in the target floor/page slot",
  },
  {
    constraintName: "message_page_floor_no_active_uq",
    fallbackPatterns: ["message_page.floor_id, message_page.page_no"],
    statusCode: 409,
    code: "page_conflict",
    message: "An active message page already exists in the target floor/page slot",
  },
];

const mapPageWriteError = (error: unknown) => mapSqliteConstraintErrorToRouteError(error, PAGE_CONSTRAINT_MAPPINGS);

export async function registerMessagePageRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;
  const ownedFloors = new OwnedFloorRepository(db);
  const ownedPages = new OwnedPageRepository(db);
  const pageActivationService = new PageActivationService(db);
  const variableStageInspectionService = new VariableStageInspectionService(db);
  const variablePromotionTraceService = new VariablePromotionTraceService(db);
  const projectAccessService = new ProjectAccessService(db);

  function authorizeProjectWriteByFloorId(
    reply: FastifyReply,
    actorAccountId: string,
    floorId: string,
  ): { ok: true; hasProjectScope: boolean } | { ok: false } {
    try {
      projectAccessService.requireProjectActionByFloorId(actorAccountId, floorId, "project.write");
      return { ok: true, hasProjectScope: true };
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        if (error.code === "session_project_scope_missing") {
          return { ok: true, hasProjectScope: false };
        }
        if (error.code === "floor_not_found" || error.code === "session_not_found") {
          sendError(reply, 404, "not_found", "Floor not found");
          return { ok: false };
        }
        if (error.code === "project_access_denied" && error.denyReason === "not_a_member") {
          sendError(reply, 404, "not_found", "Floor not found");
          return { ok: false };
        }
        sendError(reply, error.statusCode, error.code,error.message);
        return { ok: false };
      }
      throw error;
    }
  }

  function authorizeProjectWriteByPageId(
    reply: FastifyReply,
    actorAccountId: string,
    pageId: string,
  ): { ok: true; hasProjectScope: boolean; floorId: string } | { ok: false } {
    try {
      const access = projectAccessService.requireProjectActionByPageId(actorAccountId, pageId, "project.write");
      return { ok: true, hasProjectScope: true, floorId: access.floorId };
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        if (error.code === "session_project_scope_missing") {
          return { ok: true, hasProjectScope: false, floorId: "" };
        }
        if (error.code === "page_not_found" || error.code === "floor_not_found" || error.code === "session_not_found") {
          sendError(reply, 404, "not_found", "Page not found");
          return { ok: false };
        }
        if (error.code === "project_access_denied" && error.denyReason === "not_a_member") {
          sendError(reply, 404, "not_found", "Page not found");
          return { ok: false };
        }
        sendError(reply, error.statusCode, error.code, error.message);
        return { ok: false };
      }
      throw error;
    }
  }


  function canReadProjectByFloorId(actorAccountId: string, floorId: string): boolean {
    try {
      projectAccessService.requireProjectActionByFloorId(actorAccountId, floorId, "project.read");
      return true;
    } catch {
      return false;
    }
  }

  function canReadProjectByPageId(actorAccountId: string, pageId: string): boolean {
    try {
      projectAccessService.requireProjectActionByPageId(actorAccountId, pageId, "project.read");
      return true;
    } catch {
      return false;
    }
  }

  async function resolvePageOwnerAccountId(
    _executor: typeof db,
    pageId: string,
  ): Promise<string | null> {
    const row = await db
      .select({ accountId: sessions.accountId })
      .from(messagePages)
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(eq(messagePages.id, pageId))
      .limit(1);
    return row[0]?.accountId ?? null;
  }






  app.post("/pages", {
    schema: {
      tags: ["pages"],
      summary: "Create page",
      operationId: "createPage",
      body: {
        ...pageBodyJsonSchema,
        required: ["floor_id", "page_no", "page_kind"],
      },
      response: {
        201: pageResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createPageSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const writeAuth = authorizeProjectWriteByFloorId(reply, auth.accountId, parsedBody.data.floor_id);
    if (!writeAuth.ok) {
      return;
    }
    let floor: ReturnType<typeof ownedFloors.getById>;
    if (writeAuth.hasProjectScope) {
      const [row] = await db
        .select()
        .from(floors)
        .where(eq(floors.id, parsedBody.data.floor_id))
        .limit(1);
      floor = (row ?? null) as ReturnType<typeof ownedFloors.getById>;
    } else {
      floor = ownedFloors.getById(auth.accountId, parsedBody.data.floor_id);
    }

    if (!floor) {
      return sendError(reply, 404, "not_found", "Floor not found");
    }

    const rejection = getFloorContentMutationRejection({
      mutationKind: "page.create",
      floorState: floor.state,
      floorSupersededAt: floor.supersededAt,
    });

    if (rejection) {
      return sendPageMutationRejection(reply, rejection);
    }

    const now = Date.now();
    let created;
    try {
      created = db.transaction((tx) => {
        const activeSlotRow = tx
          .select({ id: messagePages.id })
          .from(messagePages)
          .where(
            and(
              eq(messagePages.floorId, parsedBody.data.floor_id),
              eq(messagePages.pageNo, parsedBody.data.page_no),
              eq(messagePages.isActive, true)
            )
          )
          .limit(1)
          .all()[0];

        const row = tx
          .insert(messagePages)
          .values({
            id: nanoid(),
            floorId: parsedBody.data.floor_id,
            pageNo: parsedBody.data.page_no,
            pageKind: parsedBody.data.page_kind,
            isActive: activeSlotRow === undefined,
            version: parsedBody.data.version ?? 1,
            checksum: parsedBody.data.checksum ?? null,
            createdAt: now,
            updatedAt: now
          })
          .returning()
          .all()[0];

        new ConversationShapePolicyService(tx).assertFloorMutationAllowed(parsedBody.data.floor_id);
        return requireRow(row, "Failed to create message page");
      });
    } catch (error) {
      if (error instanceof ConversationShapePolicyError) {
        return sendConversationShapeRejection(reply, error.rejection);
      }
      const mapped = mapPageWriteError(error);
      if (mapped) {
        return sendError(reply, mapped.statusCode, mapped.code, mapped.message);
      }
      throw error;
    }

    return reply.code(201).send({ data: toPageResponse(created) });
  });

  app.get("/pages", {
    schema: {
      tags: ["pages"],
      summary: "List pages",
      operationId: "listPages",
      querystring: listPagesQueryJsonSchema,
      response: {
        200: pageListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listPagesQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    let ownedFloorIds = ownedFloors.listIds(
      auth.accountId,
      parsedQuery.data.floor_id !== undefined ? [parsedQuery.data.floor_id] : undefined
    );
    if (ownedFloorIds.length === 0 && parsedQuery.data.floor_id !== undefined && canReadProjectByFloorId(auth.accountId, parsedQuery.data.floor_id)) {
      ownedFloorIds = [parsedQuery.data.floor_id];
    }

    if (ownedFloorIds.length === 0) {
      return reply.send({
        data: [],
        meta: buildListMeta({
          total: 0,
          limit: parsedQuery.data.limit,
          offset: parsedQuery.data.offset,
          sortBy: parsedQuery.data.sort_by,
          sortOrder: parsedQuery.data.sort_order
        })
      });
    }

    const filters = [inArray(messagePages.floorId, ownedFloorIds)];

    if (parsedQuery.data.page_kind !== undefined) {
      filters.push(eq(messagePages.pageKind, parsedQuery.data.page_kind));
    }

    if (parsedQuery.data.is_active !== undefined) {
      filters.push(eq(messagePages.isActive, parsedQuery.data.is_active));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const sortByColumn =
      parsedQuery.data.sort_by === "updated_at"
        ? messagePages.updatedAt
        : parsedQuery.data.sort_by === "page_no"
          ? messagePages.pageNo
          : parsedQuery.data.sort_by === "version"
            ? messagePages.version
            : messagePages.createdAt;

    const rows =
      whereClause === undefined
        ? await db
            .select()
            .from(messagePages)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset)
        : await db
            .select()
            .from(messagePages)
            .where(whereClause)
            .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
            .limit(parsedQuery.data.limit)
            .offset(parsedQuery.data.offset);

    const totalRows =
      whereClause === undefined
        ? await db.select({ total: count() }).from(messagePages)
        : await db.select({ total: count() }).from(messagePages).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toPageResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/pages/:id", {
    schema: {
      tags: ["pages"],
      summary: "Get page",
      operationId: "getPage",
      params: idParamsJsonSchema,
      response: {
        200: pageResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    let row = ownedPages.getContextById(auth.accountId, parsedParams.data.id);
    if (!row && canReadProjectByPageId(auth.accountId, parsedParams.data.id)) {
      row = ownedPages.getContextByIdAnyAccount(parsedParams.data.id);
    }

    if (!row) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }


    return reply.send({ data: toPageResponse(row) });
  });

  app.get("/pages/:id/variables/staged", {
    schema: {
      tags: ["pages"],
      summary: "List staged variable writes for a page",
      operationId: "listPageStagedVariableWrites",
      params: idParamsJsonSchema,
      response: {
        200: pageStagedVariablesResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const snapshot = variableStageInspectionService.getPageSnapshot(auth.accountId, parsedParams.data.id);
      return reply.send({
        data: {
          page_id: snapshot.pageId,
          floor_id: snapshot.floorId,
          session_id: snapshot.sessionId,
          branch_id: snapshot.branchId,
          items: snapshot.items.map(toPageStagedVariableWriteResponse),
        },
      });
    } catch (error) {
      if (error instanceof VariableServiceError && error.code === "variable_host_not_found") {
        return sendError(reply, 404, "not_found", "Message page not found");
      }

      throw error;
    }
  });

  app.get("/pages/:id/variables/promotions", {
    schema: {
      tags: ["pages"],
      summary: "List durable variable promotions for a page",
      operationId: "listPageVariablePromotions",
      params: idParamsJsonSchema,
      response: {
        200: pagePromotionsResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const snapshot = variablePromotionTraceService.getPageSnapshot(auth.accountId, parsedParams.data.id);
      return reply.send({
        data: {
          page_id: snapshot.pageId,
          floor_id: snapshot.floorId,
          session_id: snapshot.sessionId,
          branch_id: snapshot.branchId,
          items: snapshot.items.map(toPageVariablePromotionTraceResponse),
        },
      });
    } catch (error) {
      if (error instanceof VariableServiceError && error.code === "variable_host_not_found") {
        return sendError(reply, 404, "not_found", "Message page not found");
      }

      throw error;
    }
  });

  app.patch("/pages/:id", {
    schema: {
      tags: ["pages"],
      summary: "Update page",
      operationId: "updatePage",
      params: idParamsJsonSchema,
      body: {
        ...pageBodyJsonSchema,
        minProperties: 1,
      },
      response: {
        200: pageResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(updatePageSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const writeAuth = authorizeProjectWriteByPageId(reply, auth.accountId, parsedParams.data.id);
    if (!writeAuth.ok) {
      return;
    }
    const existingPage = writeAuth.hasProjectScope
      ? ownedPages.getContextByIdAnyAccount(parsedParams.data.id)
      : ownedPages.getContextById(auth.accountId, parsedParams.data.id);

    if (!existingPage) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }

    const updates: Partial<typeof messagePages.$inferInsert> = {
      updatedAt: Date.now()
    };

    if (parsedBody.data.page_no !== undefined) {
      updates.pageNo = parsedBody.data.page_no;
    }

    if (parsedBody.data.page_kind !== undefined) {
      updates.pageKind = parsedBody.data.page_kind;
    }

    if (parsedBody.data.version !== undefined) {
      updates.version = parsedBody.data.version;
    }

    if (parsedBody.data.checksum !== undefined) {
      updates.checksum = parsedBody.data.checksum;
    }

    const rejection = getFloorContentMutationRejection({
      mutationKind: "page.update",
      floorState: existingPage.floorState,
      floorSupersededAt: existingPage.floorSupersededAt,
      pageKind: existingPage.pageKind,
    });
    if (rejection) return sendPageMutationRejection(reply, rejection);

    let updated;
    try {
      updated = db.transaction((tx) => {
        const row = tx
          .update(messagePages)
          .set(updates)
          .where(eq(messagePages.id, existingPage.id))
          .returning()
          .all()[0];
        new ConversationShapePolicyService(tx).assertFloorMutationAllowed(existingPage.floorId);
        return row;
      });
    } catch (error) {
      if (error instanceof ConversationShapePolicyError) {
        return sendConversationShapeRejection(reply, error.rejection);
      }
      const mapped = mapPageWriteError(error);
      if (mapped) {
        return sendError(reply, mapped.statusCode, mapped.code, mapped.message);
      }
      throw error;
    }

    if (!updated) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }

    return reply.send({ data: toPageResponse(updated) });
  });

  app.delete("/pages/:id", {
    schema: {
      tags: ["pages"],
      summary: "Delete page",
      operationId: "deletePage",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const writeAuth = authorizeProjectWriteByPageId(reply, auth.accountId, parsedParams.data.id);
    if (!writeAuth.ok) {
      return;
    }
    const existingPage = writeAuth.hasProjectScope
      ? ownedPages.getContextByIdAnyAccount(parsedParams.data.id)
      : ownedPages.getContextById(auth.accountId, parsedParams.data.id);

    if (!existingPage) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }

    const rejection = getFloorContentMutationRejection({
      mutationKind: "page.delete",
      floorState: existingPage.floorState,
      floorSupersededAt: existingPage.floorSupersededAt,
      pageKind: existingPage.pageKind,
    });
    if (rejection) return sendPageMutationRejection(reply, rejection);

    let deleted;
    try {
      deleted = await db.transaction((tx) => {
        deleteVariablesForPages(tx, auth.accountId, [existingPage.id]);
        const rows = tx
          .delete(messagePages)
          .where(eq(messagePages.id, parsedParams.data.id))
          .returning()
          .all();
        new ConversationShapePolicyService(tx).assertFloorMutationAllowed(existingPage.floorId);
        return rows;
      });
    } catch (error) {
      if (error instanceof ConversationShapePolicyError) {
        return sendConversationShapeRejection(reply, error.rejection);
      }
      throw error;
    }

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Message page not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });

  // ── Activate (Swipe) ────────────────────────────────

  app.patch("/pages/:id/activate", {
    schema: {
      tags: ["pages"],
      summary: "Activate page within floor",
      operationId: "activatePage",
      params: idParamsJsonSchema,
      response: {
        200: pageResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(pageParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const targetId = parsedParams.data.id;

    const auth = getRequestAuthContext(request);
    const writeAuth = authorizeProjectWriteByPageId(reply, auth.accountId, targetId);
    if (!writeAuth.ok) {
      return;
    }
    const effectiveAccountId = writeAuth.hasProjectScope ? await resolvePageOwnerAccountId(db, targetId) ?? auth.accountId : auth.accountId;
    const activation = pageActivationService.activateVersion(effectiveAccountId, targetId);
    if (activation.kind === "not_found") {
      return sendError(reply, 404, "not_found", "Message page not found");
    }
    if (activation.kind === "rejected") {
      return sendPageMutationRejection(reply, activation.rejection);
    }
    if (activation.kind === "shape_rejected") {
      return sendConversationShapeRejection(reply, activation.rejection);
    }

    return reply.send({ data: toPageResponse(activation.page) });
  });

  // ── Batch Operations ────────────────────────────────

  /** POST /pages/batch/delete — 批量删除页 */
  app.post("/pages/batch/delete", {
    schema: {
      tags: ["pages"],
      summary: "Batch delete pages",
      operationId: "batchDeletePages",
      body: batchDeleteBodyJsonSchema,
      response: {
        200: batchResultResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const bodyParsed = parseWithSchema(z.object({ ids: batchIdArraySchema }), request.body, reply);
    if (!bodyParsed.ok) return;

    const { ids } = bodyParsed.data;
    const auth = getRequestAuthContext(request);
    // Determine which ids are accessible (owner-account OR Project owner via membership).
    const accessDeniedIds = new Set<string>();
    const ownedAccountById = new Map<string, string>();
    for (const id of ids) {
      try {
        projectAccessService.requireProjectActionByPageId(auth.accountId, id, "project.write");
        const ownerAccountId = await resolvePageOwnerAccountId(db, id);
        if (ownerAccountId) {
          ownedAccountById.set(id, ownerAccountId);
        }
      } catch (error) {
        if (error instanceof ProjectAccessServiceError) {
          if (error.code=== "project_access_denied" && error.denyReason === "role_forbidden") {
            accessDeniedIds.add(id);
          }
          // session_project_scope_missing / not_a_member → fall back to legacy ownership (hide existence)
        } else {
          throw error;
        }
      }
    }
    // Always include legacy account-owned contexts.
    const legacyOwnedContexts = ownedPages.getContextsByIds(auth.accountId, ids);
    const ownedPageContexts = legacyOwnedContexts.slice();
    for (const id of ids) {
      if (ownedAccountById.has(id) && !ownedPageContexts.some((page) => page.id === id)) {
        const ctx = ownedPages.getContextByIdAnyAccount(id);
        if (ctx) ownedPageContexts.push(ctx);
      }
    }
    const ownedPageIds = new Set(ownedPageContexts.map((page) => page.id));

    const lockedPage = ownedPageContexts.find((page) =>
      getFloorContentMutationRejection({
        mutationKind: "page.delete",
        floorState: page.floorState,
        floorSupersededAt: page.floorSupersededAt,
        pageKind: page.pageKind,
      }) !== null
    );
    if (lockedPage) {
      return sendPageMutationRejection(reply, getFloorContentMutationRejection({
        mutationKind: "page.delete",
        floorState: lockedPage.floorState,
        floorSupersededAt: lockedPage.floorSupersededAt,
        pageKind: lockedPage.pageKind,
      })!);
    }

    const results: { index: number; id: string; action: string }[] = [];
    let deleted = 0;
    let notFound = 0;
    let accessDenied = 0;

    try {
      db.transaction((tx) => {
        const deletablePageIds = ids.filter((id) => ownedPageIds.has(id));
        const deletablePageIdSet = new Set(deletablePageIds);
        const affectedFloorIds = Array.from(new Set(ownedPageContexts
          .filter((page) => deletablePageIdSet.has(page.id))
          .map((page) => page.floorId)));
        const deletablePageIdsByAccount = new Map<string, string[]>();
        for (const id of deletablePageIds) {
          const ownerAccountId = ownedAccountById.get(id) ?? auth.accountId;
          const accountPageIds = deletablePageIdsByAccount.get(ownerAccountId) ?? [];
          accountPageIds.push(id);
          deletablePageIdsByAccount.set(ownerAccountId, accountPageIds);
        }
        for (const [accountId, pageIds] of deletablePageIdsByAccount) {
          deleteVariablesForPages(tx, accountId, pageIds);
        }

        ids.forEach((id, index) => {
          if (accessDeniedIds.has(id)) {
            results.push({ index, id, action: "project_access_denied" });
            accessDenied++;
            return;
          }

          if (!ownedPageIds.has(id)) {
            results.push({ index, id, action: "not_found" });
            notFound++;
            return;
          }

          const rows = tx
            .delete(messagePages)
            .where(eq(messagePages.id, id))
            .returning({ id: messagePages.id })
            .all();

          if (rows.length > 0) {
            results.push({ index, id, action: "deleted" });
            deleted++;
          } else {
            results.push({ index, id, action: "not_found" });
            notFound++;
          }
        });

        for (const affectedFloorId of affectedFloorIds) {
          new ConversationShapePolicyService(tx).assertFloorMutationAllowed(affectedFloorId);
        }
      });
    } catch (error) {
      if (error instanceof ConversationShapePolicyError) {
        return sendConversationShapeRejection(reply, error.rejection);
      }
      throw error;
    }

    return reply.send({
      data: { results, meta: ({ total: ids.length, deleted, not_found: notFound, ...(accessDenied > 0 ? { access_denied: accessDenied }: {}) }) },
    });
  });
}
