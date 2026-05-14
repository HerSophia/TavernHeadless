import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { projectMemberships, projects, sessions } from "../db/schema.js";
import { parseJsonField, parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { ProjectAccessService, ProjectAccessServiceError, type ProjectRole } from "../services/project-access-service.js";
import type { ProjectEventLiveHub } from "../services/project-event-live-hub.js";
import { ProjectEventService, type ProjectEventVisibility } from "../services/project-event-service.js";
import { DerivedOutputService, DerivedOutputServiceError, type DerivedOutputRecord } from "../services/derived-output-service.js";
import {
  ProjectEventStreamService,
  toProjectEventResponse,
} from "../services/project-event-stream-service.js";
import {
  ProjectMembershipService,
  ProjectMembershipServiceError,
  type ProjectMemberRecord,
} from "../services/project-membership-service.js";
import { ProjectInboxService, ProjectInboxServiceError, type ProjectInboxItemRecord } from "../services/project-inbox-service.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";

export type RegisterProjectRoutesOptions = {
  projectEventLiveHub?: ProjectEventLiveHub;
  projectEventHeartbeatIntervalMs?: number;
};

type ProjectStatus = "active" | "archived";
type TimeIdCursor = { updatedAt: number; id: string };

type ProjectListEntry = {
  id: string;
  accountId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  kind: "session_default" | "manual";
  status: ProjectStatus;
  settingsOverrideJson: string;
  createdAt: number;
  updatedAt: number;
  role: ProjectRole;
};

const projectIdParamsSchema = z.object({ id: z.string().min(1) });
const projectMemberParamsSchema = z.object({
  id: z.string().min(1),
  account_id: z.string().min(1),
});

const projectItemParamsSchema = z.object({
  id: z.string().min(1),
  item_id: z.string().min(1),
});

const projectRoleSchema = z.enum(["owner", "observer", "deriver"]);
const projectStatusSchema = z.enum(["active", "archived"]);
const sessionStatusSchema = z.enum(["active", "archived"]);
const derivedOutputStatusSchema = z.enum(["draft", "published", "archived"]);
const projectInboxItemStatusSchema = z.enum(["pending", "accepted", "rejected", "archived"]);
const projectInboxDecisionSchema = z.enum(["accept", "reject", "archive"]);

const listProjectsQuerySchema = z.object({
  role: projectRoleSchema.optional(),
  status: projectStatusSchema.default("active"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional(),
});

const listProjectSessionsQuerySchema = z.object({
  status: sessionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional(),
});

const projectEventsQuerySchema = z.object({
  after: z.union([z.string(), z.number()]).optional(),
  types: z.string().optional(),
  session_id: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const projectEventsStreamQuerySchema = projectEventsQuerySchema.omit({ limit: true });

const addProjectMemberSchema = z.object({
  account_id: z.string().trim().min(1),
  role: z.string().trim().min(1),
});

const listDerivedOutputsQuerySchema = z.object({
  domain: z.string().trim().min(1).optional(),
  status: derivedOutputStatusSchema.optional(),
  source_session_id: z.string().trim().min(1).optional(),
  owner_account_id: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional(),
});

const createDerivedOutputSchema = z.object({
  domain: z.string().trim().min(1).max(128),
  source_session_id: z.string().trim().min(1).optional(),
  source_floor_id: z.string().trim().min(1).optional(),
  source_page_id: z.string().trim().min(1).optional(),
  value: z.unknown().optional(),
  status: z.enum(["draft", "published"]).optional(),
}).strict();

const updateDerivedOutputSchema = z.object({
  value: z.unknown().optional(),
  status: derivedOutputStatusSchema.optional(),
}).strict().refine(
  (value) => Object.prototype.hasOwnProperty.call(value, "value") || Object.prototype.hasOwnProperty.call(value, "status"),
  { message: "At least one derived output field must be provided" },
);

const listProjectInboxQuerySchema = z.object({
  status: projectInboxItemStatusSchema.optional(),
  type: z.string().trim().min(1).optional(),
  sender_account_id: z.string().trim().min(1).optional(),
  source_session_id: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional(),
});

const createProjectInboxItemSchema = z.object({
  type: z.string().trim().min(1).max(128),
  title: z.string().trim().max(200).optional().nullable(),
  payload: z.unknown().optional(),
  source_event_id: z.string().trim().min(1).optional(),
  source_session_id: z.string().trim().min(1).optional(),
  source_floor_id: z.string().trim().min(1).optional(),
  source_page_id: z.string().trim().min(1).optional(),
}).strict();

const decideProjectInboxItemSchema = z.object({
  decision: projectInboxDecisionSchema,
  note: z.string().trim().max(500).optional().nullable(),
}).strict();

const nullableStringJsonSchema = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

const projectJsonSchema = {
  type: "object",
  required: [
    "id",
    "workspace_id",
    "account_id",
    "name",
    "description",
    "kind",
    "status",
    "role",
    "settings_override",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    workspace_id: { type: "string" },
    account_id: { type: "string" },
    name: { type: "string" },
    description: nullableStringJsonSchema,
    kind: { type: "string", enum: ["session_default", "manual"] },
    status: { type: "string", enum: ["active", "archived"] },
    role: { type: "string", enum: ["owner", "observer", "deriver"] },
    settings_override: {},
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const projectListResponseJsonSchema = {
  type: "object",
  required: ["items", "next_cursor"],
  properties: {
    items: { type: "array", items: projectJsonSchema },
    next_cursor: nullableStringJsonSchema,
  },
  additionalProperties: false,
} as const;

const projectSessionJsonSchema = {
  type: "object",
  required: ["id", "workspace_id", "project_id", "title", "status", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    workspace_id: nullableStringJsonSchema,
    project_id: nullableStringJsonSchema,
    title: nullableStringJsonSchema,
    status: { type: "string", enum: ["active", "archived"] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const projectSessionListResponseJsonSchema = {
  type: "object",
  required: ["items", "next_cursor"],
  properties: {
    items: { type: "array", items: projectSessionJsonSchema },
    next_cursor: nullableStringJsonSchema,
  },
  additionalProperties: false,
} as const;

const projectEventJsonSchema = {
  type: "object",
  required: [
    "id",
    "workspace_id",
    "project_id",
    "sequence",
    "type",
    "visibility",
    "source",
    "actor_account_id",
    "session_id",
    "branch_id",
    "floor_id",
    "page_id",
    "message_id",
    "operation_log_id",
    "correlation_id",
    "causation_event_id",
    "payload",
    "created_at",
  ],
  properties: {
    id: { type: "string" },
    workspace_id: { type: "string" },
    project_id: { type: "string" },
    sequence: { type: "integer", minimum: 1 },
    type: { type: "string" },
    visibility: { type: "string", enum: ["project", "owner", "internal"] },
    source: { type: "string", enum: ["api", "runtime_job", "migration", "system"] },
    actor_account_id: nullableStringJsonSchema,
    session_id: nullableStringJsonSchema,
    branch_id: nullableStringJsonSchema,
    floor_id: nullableStringJsonSchema,
    page_id: nullableStringJsonSchema,
    message_id: nullableStringJsonSchema,
    operation_log_id: nullableStringJsonSchema,
    correlation_id: nullableStringJsonSchema,
    causation_event_id: nullableStringJsonSchema,
    payload: {},
    created_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const projectEventListResponseJsonSchema = {
  type: "object",
  required: ["items", "next_after", "has_more"],
  properties: {
    items: { type: "array", items: projectEventJsonSchema },
    next_after: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    has_more: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const projectMemberJsonSchema = {
  type: "object",
  required: ["id", "workspace_id", "project_id", "account_id", "role", "status", "created_by_account_id", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    workspace_id: { type: "string" },
    project_id: { type: "string" },
    account_id: { type: "string" },
    role: { type: "string", enum: ["owner", "observer", "deriver"] },
    status: { type: "string", enum: ["active", "removed"] },
    created_by_account_id: nullableStringJsonSchema,
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const projectMemberListResponseJsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: projectMemberJsonSchema },
  },
  additionalProperties: false,
} as const;

const projectMemberResponseJsonSchema = {
  type: "object",
  required: ["item"],
  properties: {
    item: projectMemberJsonSchema,
  },
  additionalProperties: false,
} as const;

const projectEventsQueryJsonSchema = {
  type: "object",
  properties: {
    after: { anyOf: [{ type: "integer", minimum: 0 }, { type: "string" }] },
    types: { type: "string" },
    session_id: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
  },
  additionalProperties: false,
} as const;

const derivedOutputJsonSchema = {
  type: "object",
  required: [
    "id",
    "workspace_id",
    "project_id",
    "account_id",
    "owner_account_id",
    "source_session_id",
    "source_floor_id",
    "source_page_id",
    "domain",
    "value",
    "status",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    workspace_id: { type: "string" },
    project_id: { type: "string" },
    account_id: { type: "string" },
    owner_account_id: { type: "string" },
    source_session_id: nullableStringJsonSchema,
    source_floor_id: nullableStringJsonSchema,
    source_page_id: nullableStringJsonSchema,
    domain: { type: "string" },
    value: {},
    status: { type: "string", enum: ["draft", "published", "archived"] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const derivedOutputListResponseJsonSchema = {
  type: "object",
  required: ["items", "next_cursor"],
  properties: {
    items: { type: "array", items: derivedOutputJsonSchema },
    next_cursor: nullableStringJsonSchema,
  },
  additionalProperties: false,
} as const;

const derivedOutputResponseJsonSchema = {
  type: "object",
  required: ["item"],
  properties: {
    item: derivedOutputJsonSchema,
  },
  additionalProperties: false,
} as const;

const projectInboxItemJsonSchema = {
  type: "object",
  required: [
    "id",
    "workspace_id",
    "project_id",
    "account_id",
    "sender_account_id",
    "type",
    "title",
    "payload",
    "source_event_id",
    "source_session_id",
    "source_floor_id",
    "source_page_id",
    "status",
    "decided_by_account_id",
    "decided_at",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    workspace_id: { type: "string" },
    project_id: { type: "string" },
    account_id: { type: "string" },
    sender_account_id: { type: "string" },
    type: { type: "string" },
    title: nullableStringJsonSchema,
    payload: {},
    source_event_id: nullableStringJsonSchema,
    source_session_id: nullableStringJsonSchema,
    source_floor_id: nullableStringJsonSchema,
    source_page_id: nullableStringJsonSchema,
    status: { type: "string", enum: ["pending", "accepted", "rejected", "archived"] },
    decided_by_account_id: nullableStringJsonSchema,
    decided_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const projectInboxListResponseJsonSchema = {
  type: "object",
  required: ["items", "next_cursor"],
  properties: {
    items: { type: "array", items: projectInboxItemJsonSchema },
    next_cursor: nullableStringJsonSchema,
  },
  additionalProperties: false,
} as const;

const projectInboxItemResponseJsonSchema = {
  type: "object",
  required: ["item"],
  properties: {
    item: projectInboxItemJsonSchema,
  },
  additionalProperties: false,
} as const;

export async function registerProjectRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: RegisterProjectRoutesOptions = {},
): Promise<void> {
  const { db } = connection;
  const accessService = new ProjectAccessService(db);
  const eventService = new ProjectEventService(db);
  const membershipService = new ProjectMembershipService(db);
  const derivedOutputService = new DerivedOutputService(db, {
    projectEventLiveHub: options.projectEventLiveHub,
  });
  const projectInboxService = new ProjectInboxService(db, {
    projectEventLiveHub: options.projectEventLiveHub,
  });
  const streamService = options.projectEventLiveHub
    ? new ProjectEventStreamService(eventService, options.projectEventLiveHub, {
        heartbeatIntervalMs: options.projectEventHeartbeatIntervalMs,
      })
    : null;

  app.get("/projects", {
    schema: {
      tags: ["projects"],
      summary: "List accessible projects",
      querystring: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["owner", "observer", "deriver"] },
          status: { type: "string", enum: ["active", "archived"], default: "active" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          cursor: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: projectListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listProjectsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const cursor = decodeTimeIdCursor(parsedQuery.data.cursor);
    if (cursor instanceof ProjectRouteValidationError) {
      return sendError(reply, cursor.statusCode, cursor.code, cursor.message);
    }

    const auth = getRequestAuthContext(request);
    const rows = listAccessibleProjects(db, auth.accountId, parsedQuery.data.status, parsedQuery.data.role);
    const page = paginateByTimeId(rows, parsedQuery.data.limit, cursor);

    return reply.send({
      items: page.items.map(toProjectResponse),
      next_cursor: page.nextCursor,
    });
  });

  app.get("/projects/:id", {
    schema: {
      tags: ["projects"],
      summary: "Get project detail",
      params: idParamsJsonSchema,
      response: {
        200: projectJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const access = accessService.requireProjectAction(auth.accountId, parsedParams.data.id, "project.read");
      const row = getProjectById(db, access.project.id);
      if (!row) {
        return sendError(reply, 404, "project_not_found", `Project not found: ${access.project.id}`);
      }
      return reply.send(toProjectResponse({ ...row, role: access.role }));
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.get("/projects/:id/sessions", {
    schema: {
      tags: ["projects"],
      summary: "List sessions in a project",
      params: idParamsJsonSchema,
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "archived"] },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          cursor: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: projectSessionListResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedQuery = parseWithSchema(listProjectSessionsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const cursor = decodeTimeIdCursor(parsedQuery.data.cursor);
    if (cursor instanceof ProjectRouteValidationError) {
      return sendError(reply, cursor.statusCode, cursor.code, cursor.message);
    }

    const auth = getRequestAuthContext(request);
    try {
      accessService.requireProjectAction(auth.accountId, parsedParams.data.id, "project.read");
      const rows = listProjectSessions(db, parsedParams.data.id, parsedQuery.data.status);
      const page = paginateByTimeId(rows, parsedQuery.data.limit, cursor);
      return reply.send({
        items: page.items.map(toProjectSessionResponse),
        next_cursor: page.nextCursor,
      });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.get("/projects/:id/events", {
    schema: {
      tags: ["projects"],
      summary: "List project events",
      params: idParamsJsonSchema,
      querystring: projectEventsQueryJsonSchema,
      response: {
        200: projectEventListResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseProjectEventRequest(request, reply, projectEventsQuerySchema);
    if (!parsed) return;

    const auth = getRequestAuthContext(request);
    try {
      const access = accessService.requireProjectAction(auth.accountId, parsed.projectId, "project.observe");
      if (parsed.sessionId && !ensureSessionBelongsToProject(db, reply, parsed.projectId, parsed.sessionId)) {
        return;
      }

      const result = eventService.list(parsed.projectId, {
        after: parsed.after,
        limit: parsed.limit,
        types: parsed.types,
        sessionId: parsed.sessionId,
        visibilitySet: visibilitySetForRole(access.role),
      });

      return reply.send({
        items: result.items.map(toProjectEventResponse),
        next_after: result.nextAfter,
        has_more: result.hasMore,
      });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.get("/projects/:id/events/stream", {
    schema: {
      tags: ["projects"],
      summary: "Stream project events",
      params: idParamsJsonSchema,
      querystring: {
        type: "object",
        properties: {
          after: { anyOf: [{ type: "integer", minimum: 0 }, { type: "string" }] },
          types: { type: "string" },
          session_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: { type: "string", description: "text/event-stream" },
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    if (!streamService) {
      return sendError(reply, 503, "feature_unavailable", "Project event stream is unavailable");
    }

    const parsed = parseProjectEventRequest(request, reply, projectEventsStreamQuerySchema, { streamCursor: true });
    if (!parsed) return;

    const auth = getRequestAuthContext(request);
    try {
      const access = accessService.requireProjectAction(auth.accountId, parsed.projectId, "project.observe");
      if (parsed.sessionId && !ensureSessionBelongsToProject(db, reply, parsed.projectId, parsed.sessionId)) {
        return;
      }

      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      reply.raw.flushHeaders?.();

      const abortController = new AbortController();
      reply.raw.on("close", () => abortController.abort());

      await streamService.stream({
        projectId: parsed.projectId,
        after: parsed.after,
        types: parsed.types,
        sessionId: parsed.sessionId,
        visibilitySet: visibilitySetForRole(access.role),
        writer: reply.raw,
        abortSignal: abortController.signal,
      });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.get("/projects/:id/derived-outputs", {
    schema: {
      tags: ["projects"],
      summary: "List project derived outputs",
      params: idParamsJsonSchema,
      querystring: {
        type: "object",
        properties: {
          domain: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["draft", "published", "archived"] },
          source_session_id: { type: "string", minLength: 1 },
          owner_account_id: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          cursor: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: derivedOutputListResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedQuery = parseWithSchema(listDerivedOutputsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const result = derivedOutputService.list({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        domain: parsedQuery.data.domain,
        status: parsedQuery.data.status,
        sourceSessionId: parsedQuery.data.source_session_id,
        ownerAccountId: parsedQuery.data.owner_account_id,
        limit: parsedQuery.data.limit,
        cursor: parsedQuery.data.cursor,
      });
      return reply.send({
        items: result.items.map(toDerivedOutputResponse),
        next_cursor: result.nextCursor,
      });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.post("/projects/:id/derived-outputs", {
    schema: {
      tags: ["projects"],
      summary: "Create project derived output",
      params: idParamsJsonSchema,
      body: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", minLength: 1, maxLength: 128 },
          source_session_id: { type: "string", minLength: 1 },
          source_floor_id: { type: "string", minLength: 1 },
          source_page_id: { type: "string", minLength: 1 },
          value: {},
          status: { type: "string", enum: ["draft", "published"] },
        },
        additionalProperties: false,
      },
      response: {
        201: derivedOutputResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        413: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(createDerivedOutputSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const record = derivedOutputService.create({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        domain: parsedBody.data.domain,
        value: parsedBody.data.value,
        status: parsedBody.data.status,
        sourceSessionId: parsedBody.data.source_session_id,
        sourceFloorId: parsedBody.data.source_floor_id,
        sourcePageId: parsedBody.data.source_page_id,
        correlationId: requestCorrelationId(request),
        requestId: requestCorrelationId(request),
      });
      return reply.code(201).send({ item: toDerivedOutputResponse(record) });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.get("/projects/:id/derived-outputs/:item_id", {
    schema: {
      tags: ["projects"],
      summary: "Get project derived output",
      params: {
        type: "object",
        required: ["id", "item_id"],
        properties: {
          id: { type: "string", minLength: 1 },
          item_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: derivedOutputResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectItemParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const record = derivedOutputService.getById({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        itemId: parsedParams.data.item_id,
      });
      return reply.send({ item: toDerivedOutputResponse(record) });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.patch("/projects/:id/derived-outputs/:item_id", {
    schema: {
      tags: ["projects"],
      summary: "Update project derived output",
      params: {
        type: "object",
        required: ["id", "item_id"],
        properties: {
          id: { type: "string", minLength: 1 },
          item_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      body: {
        type: "object",
        properties: {
          value: {},
          status: { type: "string", enum: ["draft", "published", "archived"] },
        },
        anyOf: [
          { required: ["value"] },
          { required: ["status"] },
        ],
        additionalProperties: false,
      },
      response: {
        200: derivedOutputResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        413: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectItemParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(updateDerivedOutputSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const valuePatch = Object.prototype.hasOwnProperty.call(parsedBody.data, "value")
      ? { value: parsedBody.data.value }
      : {};
    try {
      const record = derivedOutputService.update({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        itemId: parsedParams.data.item_id,
        ...valuePatch,
        status: parsedBody.data.status,
        correlationId: requestCorrelationId(request),
        requestId: requestCorrelationId(request),
      });
      return reply.send({ item: toDerivedOutputResponse(record) });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.delete("/projects/:id/derived-outputs/:item_id", {
    schema: {
      tags: ["projects"],
      summary: "Archive project derived output",
      params: {
        type: "object",
        required: ["id", "item_id"],
        properties: {
          id: { type: "string", minLength: 1 },
          item_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: derivedOutputResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectItemParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const record = derivedOutputService.archive({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        itemId: parsedParams.data.item_id,
        correlationId: requestCorrelationId(request),
        requestId: requestCorrelationId(request),
      });
      return reply.send({ item: toDerivedOutputResponse(record) });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.get("/projects/:id/inbox", {
    schema: {
      tags: ["projects"],
      summary: "List project inbox items",
      params: idParamsJsonSchema,
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "accepted", "rejected", "archived"] },
          type: { type: "string", minLength: 1 },
          sender_account_id: { type: "string", minLength: 1 },
          source_session_id: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          cursor: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: projectInboxListResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedQuery = parseWithSchema(listProjectInboxQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const result = projectInboxService.list({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        status: parsedQuery.data.status,
        type: parsedQuery.data.type,
        senderAccountId: parsedQuery.data.sender_account_id,
        sourceSessionId: parsedQuery.data.source_session_id,
        limit: parsedQuery.data.limit,
        cursor: parsedQuery.data.cursor,
      });
      return reply.send({
        items: result.items.map(toProjectInboxItemResponse),
        next_cursor: result.nextCursor,
      });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.post("/projects/:id/inbox", {
    schema: {
      tags: ["projects"],
      summary: "Create project inbox item",
      params: idParamsJsonSchema,
      body: {
        type: "object",
        required: ["type"],
        properties: {
          type: { type: "string", minLength: 1, maxLength: 128 },
          title: nullableStringJsonSchema,
          payload: {},
          source_event_id: { type: "string", minLength: 1 },
          source_session_id: { type: "string", minLength: 1 },
          source_floor_id: { type: "string", minLength: 1 },
          source_page_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        201: projectInboxItemResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        413: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(createProjectInboxItemSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const record = projectInboxService.create({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        type: parsedBody.data.type,
        title: parsedBody.data.title,
        payload: parsedBody.data.payload,
        sourceEventId: parsedBody.data.source_event_id,
        sourceSessionId: parsedBody.data.source_session_id,
        sourceFloorId: parsedBody.data.source_floor_id,
        sourcePageId: parsedBody.data.source_page_id,
        correlationId: requestCorrelationId(request),
        requestId: requestCorrelationId(request),
      });
      return reply.code(201).send({ item: toProjectInboxItemResponse(record) });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.get("/projects/:id/inbox/:item_id", {
    schema: {
      tags: ["projects"],
      summary: "Get project inbox item",
      params: {
        type: "object",
        required: ["id", "item_id"],
        properties: {
          id: { type: "string", minLength: 1 },
          item_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: projectInboxItemResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectItemParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const record = projectInboxService.getById({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        itemId: parsedParams.data.item_id,
      });
      return reply.send({ item: toProjectInboxItemResponse(record) });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.patch("/projects/:id/inbox/:item_id", {
    schema: {
      tags: ["projects"],
      summary: "Decide project inbox item",
      params: {
        type: "object",
        required: ["id", "item_id"],
        properties: {
          id: { type: "string", minLength: 1 },
          item_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      body: {
        type: "object",
        required: ["decision"],
        properties: {
          decision: { type: "string", enum: ["accept", "reject", "archive"] },
          note: nullableStringJsonSchema,
        },
        additionalProperties: false,
      },
      response: {
        200: projectInboxItemResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectItemParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(decideProjectInboxItemSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const record = projectInboxService.decide({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        itemId: parsedParams.data.item_id,
        decision: parsedBody.data.decision,
        note: parsedBody.data.note,
        correlationId: requestCorrelationId(request),
        requestId: requestCorrelationId(request),
      });
      return reply.send({ item: toProjectInboxItemResponse(record) });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });


  app.get("/projects/:id/members", {
    schema: {
      tags: ["projects"],
      summary: "List project members",
      params: idParamsJsonSchema,
      response: {
        200: projectMemberListResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      accessService.requireProjectAction(auth.accountId, parsedParams.data.id, "project.read");
      return reply.send({
        items: membershipService.listMembers(parsedParams.data.id).map(toProjectMemberResponse),
      });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.post("/projects/:id/members", {
    schema: {
      tags: ["projects"],
      summary: "Add project observer member",
      params: idParamsJsonSchema,
      body: {
        type: "object",
        required: ["account_id", "role"],
        properties: {
          account_id: { type: "string", minLength: 1 },
          role: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        201: projectMemberResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(addProjectMemberSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const member = membershipService.addMember({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        accountId: parsedBody.data.account_id,
        role: parsedBody.data.role,
      });
      return reply.code(201).send({ item: toProjectMemberResponse(member) });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });

  app.delete("/projects/:id/members/:account_id", {
    schema: {
      tags: ["projects"],
      summary: "Remove project observer member",
      params: {
        type: "object",
        required: ["id", "account_id"],
        properties: {
          id: { type: "string", minLength: 1 },
          account_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: projectMemberResponseJsonSchema,
        400: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(projectMemberParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      const member = membershipService.removeMember({
        actorAccountId: auth.accountId,
        projectId: parsedParams.data.id,
        accountId: parsedParams.data.account_id,
      });
      return reply.send({ item: toProjectMemberResponse(member) });
    } catch (error) {
      return handleProjectRouteError(error, reply);
    }
  });
}

function parseProjectEventRequest<TSchema extends typeof projectEventsQuerySchema | typeof projectEventsStreamQuerySchema>(
  request: FastifyRequest,
  reply: FastifyReply,
  schema: TSchema,
  options: { streamCursor?: boolean } = {},
): { projectId: string; after: number; types: string[]; sessionId: string | null; limit?: number } | null {
  const parsedParams = parseWithSchema(projectIdParamsSchema, request.params, reply);
  if (!parsedParams.ok) return null;
  const parsedQuery = parseWithSchema(schema, request.query, reply);
  if (!parsedQuery.ok) return null;

  const query = parsedQuery.data as z.infer<typeof projectEventsQuerySchema>;
  const afterInput = options.streamCursor && query.after === undefined
    ? readLastEventIdHeader(request)
    : query.after;
  const after = parseSequenceCursor(afterInput);
  if (after instanceof ProjectRouteValidationError) {
    sendError(reply, after.statusCode, after.code, after.message);
    return null;
  }

  const types = parseEventTypes(query.types);
  if (types instanceof ProjectRouteValidationError) {
    sendError(reply, types.statusCode, types.code, types.message);
    return null;
  }

  return {
    projectId: parsedParams.data.id,
    after,
    types,
    sessionId: query.session_id ?? null,
    ...("limit" in query ? { limit: query.limit } : {}),
  };
}

function listAccessibleProjects(
  db: DatabaseConnection["db"],
  accountId: string,
  status: ProjectStatus,
  roleFilter?: ProjectRole,
): ProjectListEntry[] {
  const entries = new Map<string, ProjectListEntry>();

  const ownedRows = db
    .select()
    .from(projects)
    .where(and(eq(projects.accountId, accountId), eq(projects.status, status)))
    .all();

  for (const row of ownedRows) {
    addProjectEntry(entries, {
      ...row,
      role: "owner",
    }, roleFilter);
  }

  const membershipRows = db
    .select({
      id: projects.id,
      accountId: projects.accountId,
      workspaceId: projects.workspaceId,
      name: projects.name,
      description: projects.description,
      kind: projects.kind,
      status: projects.status,
      settingsOverrideJson: projects.settingsOverrideJson,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      membershipRole: projectMemberships.role,
    })
    .from(projectMemberships)
    .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
    .where(and(
      eq(projectMemberships.accountId, accountId),
      eq(projectMemberships.status, "active"),
      eq(projects.status, status),
    ))
    .all();

  for (const row of membershipRows) {
    const role: ProjectRole = row.accountId === accountId || row.membershipRole === "owner" ? "owner" : row.membershipRole;
    addProjectEntry(entries, { ...row, role }, roleFilter);
  }

  return Array.from(entries.values()).sort(compareTimeIdDesc);
}

function addProjectEntry(
  entries: Map<string, ProjectListEntry>,
  row: ProjectListEntry,
  roleFilter?: ProjectRole,
): void {
  if (roleFilter && row.role !== roleFilter) {
    return;
  }

  const existing = entries.get(row.id);
  if (!existing || existing.role !== "owner") {
    entries.set(row.id, row);
  }
}

function getProjectById(db: DatabaseConnection["db"], projectId: string): Omit<ProjectListEntry, "role"> | null {
  const row = db.select().from(projects).where(eq(projects.id, projectId)).limit(1).get();
  return row ?? null;
}

function listProjectSessions(
  db: DatabaseConnection["db"],
  projectId: string,
  status?: "active" | "archived",
) {
  const filters = [eq(sessions.projectId, projectId)];
  if (status) {
    filters.push(eq(sessions.status, status));
  }

  return db
    .select()
    .from(sessions)
    .where(and(...filters))
    .orderBy(desc(sessions.updatedAt), desc(sessions.id))
    .all();
}

function paginateByTimeId<T extends { updatedAt: number; id: string }>(
  rows: T[],
  limit: number,
  cursor: TimeIdCursor | null,
): { items: T[]; nextCursor: string | null } {
  const sorted = rows.slice().sort(compareTimeIdDesc);
  const filtered = cursor ? sorted.filter((row) => isAfterCursor(row, cursor)) : sorted;
  const items = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeTimeIdCursor(last) : null,
  };
}

function compareTimeIdDesc(left: { updatedAt: number; id: string }, right: { updatedAt: number; id: string }): number {
  const updatedDiff = right.updatedAt - left.updatedAt;
  return updatedDiff !== 0 ? updatedDiff : right.id.localeCompare(left.id);
}

function isAfterCursor(row: { updatedAt: number; id: string }, cursor: TimeIdCursor): boolean {
  return row.updatedAt < cursor.updatedAt || (row.updatedAt === cursor.updatedAt && row.id < cursor.id);
}

function encodeTimeIdCursor(row: { updatedAt: number; id: string }): string {
  return Buffer.from(JSON.stringify({ updated_at: row.updatedAt, id: row.id }), "utf-8").toString("base64url");
}

function decodeTimeIdCursor(cursor: string | undefined): TimeIdCursor | null | ProjectRouteValidationError {
  if (!cursor) {
    return null;
  }

  try {
    const raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as Record<string, unknown>;
    const updatedAt = raw.updated_at;
    const id = raw.id;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || typeof id !== "string" || id.length === 0) {
      return new ProjectRouteValidationError(400, "invalid_cursor", "Project cursor is invalid");
    }
    return { updatedAt: Math.trunc(updatedAt), id };
  } catch {
    return new ProjectRouteValidationError(400, "invalid_cursor", "Project cursor is invalid");
  }
}

function parseSequenceCursor(value: string | number | undefined): number | ProjectRouteValidationError {
  if (value === undefined) {
    return 0;
  }

  const numberValue = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(numberValue) || numberValue < 0 || !Number.isInteger(numberValue)) {
    return new ProjectRouteValidationError(400, "invalid_event_cursor", "Project event cursor must be a non-negative integer");
  }

  return numberValue;
}

function parseEventTypes(value: string | undefined): string[] | ProjectRouteValidationError {
  if (value === undefined) {
    return [];
  }

  const types = Array.from(new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean)));
  if (types.length > 20) {
    return new ProjectRouteValidationError(400, "validation_error", "At most 20 project event types can be requested");
  }
  return types;
}

function readLastEventIdHeader(request: FastifyRequest): string | undefined {
  const value = request.headers["last-event-id"];
  if (typeof value === "string") {
    return value;
  }
  return Array.isArray(value) ? value[0] : undefined;
}

function visibilitySetForRole(role: ProjectRole): ProjectEventVisibility[] {
  return role === "owner" ? ["project", "owner"] : ["project"];
}

function ensureSessionBelongsToProject(
  db: DatabaseConnection["db"],
  reply: FastifyReply,
  projectId: string,
  sessionId: string,
): boolean {
  const row = db
    .select({ id: sessions.id, projectId: sessions.projectId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)
    .get();

  if (!row || row.projectId !== projectId) {
    sendError(reply, 400, "session_project_mismatch", "Session does not belong to the project");
    return false;
  }

  return true;
}

function toProjectResponse(row: ProjectListEntry) {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    account_id: row.accountId,
    name: row.name,
    description: row.description,
    kind: row.kind,
    status: row.status,
    role: row.role,
    settings_override: parseJsonField(row.settingsOverrideJson),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toProjectSessionResponse(row: typeof sessions.$inferSelect) {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    title: row.title,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toProjectMemberResponse(member: ProjectMemberRecord) {
  return {
    id: member.id,
    workspace_id: member.workspaceId,
    project_id: member.projectId,
    account_id: member.accountId,
    role: member.role,
    status: member.status,
    created_by_account_id: member.createdByAccountId,
    created_at: member.createdAt,
    updated_at: member.updatedAt,
  };
}

function toDerivedOutputResponse(record: DerivedOutputRecord) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    account_id: record.accountId,
    owner_account_id: record.ownerAccountId,
    source_session_id: record.sourceSessionId,
    source_floor_id: record.sourceFloorId,
    source_page_id: record.sourcePageId,
    domain: record.domain,
    value: record.value,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function toProjectInboxItemResponse(record: ProjectInboxItemRecord) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    account_id: record.accountId,
    sender_account_id: record.senderAccountId,
    type: record.type,
    title: record.title,
    payload: record.payload,
    source_event_id: record.sourceEventId,
    source_session_id: record.sourceSessionId,
    source_floor_id: record.sourceFloorId,
    source_page_id: record.sourcePageId,
    status: record.status,
    decided_by_account_id: record.decidedByAccountId,
    decided_at: record.decidedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function requestCorrelationId(request: FastifyRequest): string | null {
  return typeof request.id === "string" && request.id.trim().length > 0 ? request.id : null;
}

function handleProjectRouteError(error: unknown, reply: FastifyReply) {
  if (
    error instanceof ProjectAccessServiceError
    || error instanceof ProjectMembershipServiceError
    || error instanceof DerivedOutputServiceError
    || error instanceof ProjectInboxServiceError
  ) {
    if (error instanceof ProjectAccessServiceError && error.code === "project_access_denied" && error.denyReason === "not_a_member") {
      return sendError(reply, 404, "project_not_found", "Project not found");
    }
    return sendError(reply, error.statusCode, error.code, error.message);
  }

  throw error;
}

class ProjectRouteValidationError extends Error {
  constructor(
    public readonly statusCode: 400,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectRouteValidationError";
  }
}
