import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import type { SessionStateCustomNamespaceService } from "../session-state/session-state-custom-namespace-service.js";
import {
  SessionStateCustomNamespaceServiceError,
} from "../session-state/session-state-custom-namespace-service.js";
import type {
  SessionStatePublicNamespaceDefinition,
  SessionStatePublicResolvedValue,
} from "../session-state/session-state-types.js";
import {
  SESSION_STATE_LOGICAL_OWNER_ID_PATTERN,
  SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN,
  SESSION_STATE_NAMESPACE_PATTERN,
} from "../session-state/session-state-types.js";
import {
  SessionStatePublicService,
  SessionStatePublicServiceError,
} from "../session-state/session-state-public-service.js";
import { SessionStateServiceError } from "../session-state/session-state-service.js";
import {
  operationActorFromRequest,
  operationRequestIdFromRequest,
} from "../services/operation-log-service.js";
import {
  diffSessionStateQueryJsonSchema,
  diffSessionStateValuesResponseJsonSchema,
  listSessionStateNamespacesResponseJsonSchema,
  registerSessionStateNamespaceBodyJsonSchema,
  registerSessionStateNamespaceResponseJsonSchema,
  resolveSessionStateQueryJsonSchema,
  resolveSessionStateValuesResponseJsonSchema,
  sessionStateRouteErrorResponses,
  sessionStateSessionIdParamsJsonSchema,
  sessionStateSnapshotParamsJsonSchema,
  sessionStateResolvedValueResponseJsonSchema,
  snapshotSessionStateQueryJsonSchema,
  snapshotSessionStateValuesResponseJsonSchema,
  writeSessionStateValueBodyJsonSchema,
  deleteSessionStateValueBodyJsonSchema,
} from "./schemas/session-state-schemas.js";

export interface RegisterSessionStateRoutesOptions {
  publicService?: SessionStatePublicService;
  customNamespaceService?: SessionStateCustomNamespaceService;
}

const sessionIdParamsSchema = z.object({ sessionId: z.string().min(1) });
const snapshotParamsSchema = z.object({
  sessionId: z.string().min(1),
  floorId: z.string().min(1),
});

const registerNamespaceBodySchema = z.object({
  namespace: z.string().min(1).max(128).regex(SESSION_STATE_NAMESPACE_PATTERN),
  logical_owner_type: z.string().min(1).max(128).regex(SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN),
  logical_owner_id: z.string().min(1).max(256).regex(SESSION_STATE_LOGICAL_OWNER_ID_PATTERN),
}).strict();

const writeValueBodySchema = z.object({
  branch_id: z.string().min(1),
  namespace: z.string().min(1).max(128).regex(SESSION_STATE_NAMESPACE_PATTERN),
  slot: z.string().min(1).max(256),
  value: z.unknown(),
}).strict();

const deleteValueBodySchema = z.object({
  branch_id: z.string().min(1),
  namespace: z.string().min(1).max(128).regex(SESSION_STATE_NAMESPACE_PATTERN),
  slot: z.string().min(1).max(256),
}).strict();

const resolveQuerySchema = z.object({
  branch_id: z.string().min(1),
  namespace: z.string().min(1).max(128).regex(SESSION_STATE_NAMESPACE_PATTERN).optional(),
  slot: z.string().min(1).optional(),
  source_floor_id: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.slot && !value.namespace) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "slot filter requires namespace",
      path: ["slot"],
    });
  }
});

const snapshotQuerySchema = z.object({
  namespace: z.string().min(1).max(128).regex(SESSION_STATE_NAMESPACE_PATTERN).optional(),
  slot: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.slot && !value.namespace) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "slot filter requires namespace",
      path: ["slot"],
    });
  }
});

const diffAgainstPattern = /^(floor:.+|live)$/;

const diffQuerySchema = z.object({
  floor_id: z.string().min(1),
  against: z.string().regex(diffAgainstPattern),
  branch_id: z.string().min(1).optional(),
  namespace: z.string().min(1).max(128).regex(SESSION_STATE_NAMESPACE_PATTERN).optional(),
  slot: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.slot && !value.namespace) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "slot filter requires namespace",
      path: ["slot"],
    });
  }
  if (value.against === "live" && !value.branch_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "branch_id is required when diffing against live state",
      path: ["branch_id"],
    });
  }
});

export async function registerSessionStateRoutes(
  app: FastifyInstance,
  options: RegisterSessionStateRoutesOptions = {},
): Promise<void> {
  const publicService = options.publicService;
  const customNamespaceService = options.customNamespaceService;

  function ensureServiceAvailable(reply: FastifyReply): SessionStatePublicService | null {
    if (!publicService) {
      sendError(
        reply,
        503,
        "feature_unavailable",
        "Session state is unavailable because client-data is disabled",
      );
      return null;
    }
    return publicService;
  }

  function ensureCustomNamespaceServiceAvailable(reply: FastifyReply): SessionStateCustomNamespaceService | null {
    if (!customNamespaceService) {
      sendError(
        reply,
        503,
        "feature_unavailable",
        "Session state is unavailable because client-data is disabled",
      );
      return null;
    }
    return customNamespaceService;
  }

  app.post("/sessions/:sessionId/state/namespaces", {
    schema: {
      tags: ["session-state"],
      operationId: "registerSessionStateNamespace",
      summary: "Register a custom Session State namespace",
      description: "Control-plane write surface for creating a per-session custom namespace registration and managed binding.",
      params: sessionStateSessionIdParamsJsonSchema,
      body: registerSessionStateNamespaceBodyJsonSchema,
      response: {
        201: registerSessionStateNamespaceResponseJsonSchema,
        ...sessionStateRouteErrorResponses,
      },
    },
  }, async (request, reply) => {
    const service = ensureCustomNamespaceServiceAvailable(reply);
    if (!service) return;

    const params = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(registerNamespaceBodySchema, request.body, reply);
    if (!body.ok) return;

    const { accountId } = getRequestAuthContext(request);
    try {
      const registered = service.registerNamespace({
        accountId,
        sessionId: params.data.sessionId,
        namespace: body.data.namespace,
        logicalOwnerType: body.data.logical_owner_type,
        logicalOwnerId: body.data.logical_owner_id,
        operationLog: {
          ...operationActorFromRequest(request),
          requestId: operationRequestIdFromRequest(request),
          sourceType: "http",
          route: "POST /sessions/:sessionId/state/namespaces",
        },
      });
      return reply.code(201).send({
        data: toNamespaceResponse(registered),
      });
    } catch (error) {
      return handleSessionStateRouteError(error, reply);
    }
  });

  app.get("/sessions/:sessionId/state/namespaces", {
    schema: {
      tags: ["session-state"],
      operationId: "listSessionStateNamespaces",
      summary: "List public session-state namespaces and slot definitions",
      description: "Public read surface for Session State. Returns public-stable built-in slot definitions plus registered custom namespaces.",
      params: sessionStateSessionIdParamsJsonSchema,
      response: {
        200: listSessionStateNamespacesResponseJsonSchema,
        ...sessionStateRouteErrorResponses,
      },
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;

    const params = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!params.ok) return;

    const { accountId } = getRequestAuthContext(request);
    try {
      const namespaces = service.listNamespaces(accountId, params.data.sessionId);
      return reply.code(200).send({
        data: namespaces.map((namespace) => toNamespaceResponse(namespace)),
      });
    } catch (error) {
      return handleSessionStateRouteError(error, reply);
    }
  });

  app.post("/sessions/:sessionId/state/values/write", {
    schema: {
      tags: ["session-state"],
      operationId: "writeSessionStateValue",
      summary: "Write a custom Session State value",
      description: "Public write surface for registered custom namespaces. Performs governed direct write and returns the current-effective single-slot view.",
      params: sessionStateSessionIdParamsJsonSchema,
      body: writeSessionStateValueBodyJsonSchema,
      response: {
        200: sessionStateResolvedValueResponseJsonSchema,
        ...sessionStateRouteErrorResponses,
      },
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;

    const params = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(writeValueBodySchema, request.body, reply);
    if (!body.ok) return;

    const { accountId } = getRequestAuthContext(request);
    try {
      const value = service.writeValue({
        accountId,
        sessionId: params.data.sessionId,
        branchId: body.data.branch_id,
        namespace: body.data.namespace,
        slot: body.data.slot,
        value: body.data.value,
        operationLog: {
          ...operationActorFromRequest(request),
          requestId: operationRequestIdFromRequest(request),
          sourceType: "http",
          route: "POST /sessions/:sessionId/state/values/write",
        },
      });
      return reply.code(200).send({ data: toResolvedValueResponse(value) });
    } catch (error) {
      return handleSessionStateRouteError(error, reply);
    }
  });

  app.delete("/sessions/:sessionId/state/values", {
    schema: {
      tags: ["session-state"],
      operationId: "deleteSessionStateValue",
      summary: "Delete a custom Session State value",
      description: "Public delete surface for registered custom namespaces. Maps delete to governed `present: false` and returns the current-effective single-slot view.",
      params: sessionStateSessionIdParamsJsonSchema,
      body: deleteSessionStateValueBodyJsonSchema,
      response: {
        200: sessionStateResolvedValueResponseJsonSchema,
        ...sessionStateRouteErrorResponses,
      },
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;

    const params = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(deleteValueBodySchema, request.body, reply);
    if (!body.ok) return;

    const { accountId } = getRequestAuthContext(request);
    try {
      const value = service.deleteValue({
        accountId,
        sessionId: params.data.sessionId,
        branchId: body.data.branch_id,
        namespace: body.data.namespace,
        slot: body.data.slot,
        operationLog: {
          ...operationActorFromRequest(request),
          requestId: operationRequestIdFromRequest(request),
          sourceType: "http",
          route: "DELETE /sessions/:sessionId/state/values",
        },
      });
      return reply.code(200).send({ data: toResolvedValueResponse(value) });
    } catch (error) {
      return handleSessionStateRouteError(error, reply);
    }
  });

  app.get("/sessions/:sessionId/state/resolve", {
    schema: {
      tags: ["session-state"],
      operationId: "resolveSessionStateValues",
      summary: "Resolve current-effective Session State values",
      description: "Public read surface for resolving current-effective or source-floor Session State values.",
      params: sessionStateSessionIdParamsJsonSchema,
      querystring: resolveSessionStateQueryJsonSchema,
      response: {
        200: resolveSessionStateValuesResponseJsonSchema,
        ...sessionStateRouteErrorResponses,
      },
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;

    const params = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(resolveQuerySchema, request.query, reply);
    if (!query.ok) return;

    const { accountId } = getRequestAuthContext(request);
    try {
      const values = service.resolveValues({
        accountId,
        sessionId: params.data.sessionId,
        branchId: query.data.branch_id,
        sourceFloorId: query.data.source_floor_id,
        namespace: query.data.namespace,
        slot: query.data.slot,
      });
      return reply.code(200).send({ data: values.map((value) => toResolvedValueResponse(value)) });
    } catch (error) {
      return handleSessionStateRouteError(error, reply);
    }
  });

  app.get("/sessions/:sessionId/state/floors/:floorId/snapshot", {
    schema: {
      tags: ["session-state"],
      operationId: "getSessionStateFloorSnapshot",
      summary: "Read public Session State floor snapshots",
      description: "Public read surface for floor snapshot values of public-stable Session State slots.",
      params: sessionStateSnapshotParamsJsonSchema,
      querystring: snapshotSessionStateQueryJsonSchema,
      response: {
        200: snapshotSessionStateValuesResponseJsonSchema,
        ...sessionStateRouteErrorResponses,
      },
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;

    const params = parseWithSchema(snapshotParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(snapshotQuerySchema, request.query, reply);
    if (!query.ok) return;

    const { accountId } = getRequestAuthContext(request);
    try {
      const snapshots = service.listFloorSnapshots({
        accountId,
        sessionId: params.data.sessionId,
        floorId: params.data.floorId,
        namespace: query.data.namespace,
        slot: query.data.slot,
      });
      return reply.code(200).send({
        data: snapshots.map((snapshot) => ({
          namespace: snapshot.namespace,
          slot: snapshot.slot,
          visibility_mode: snapshot.visibilityMode,
          schema_version: snapshot.schemaVersion,
          present: snapshot.present,
          value: snapshot.value,
          session_id: snapshot.sessionId,
          branch_id: snapshot.branchId,
          floor_id: snapshot.floorId,
          source_mutation_ids: snapshot.sourceMutationIds,
          committed_at: snapshot.committedAt,
        })),
      });
    } catch (error) {
      return handleSessionStateRouteError(error, reply);
    }
  });

  app.get("/sessions/:sessionId/state/diff", {
    schema: {
      tags: ["session-state"],
      operationId: "diffSessionStateValues",
      summary: "Diff public Session State values against live or another floor",
      description: "Public read surface for Session State diffs. Returns full values for public-stable slots.",
      params: sessionStateSessionIdParamsJsonSchema,
      querystring: diffSessionStateQueryJsonSchema,
      response: {
        200: diffSessionStateValuesResponseJsonSchema,
        ...sessionStateRouteErrorResponses,
      },
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;

    const params = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(diffQuerySchema, request.query, reply);
    if (!query.ok) return;

    const { accountId } = getRequestAuthContext(request);
    try {
      const entries = service.diff({
        accountId,
        sessionId: params.data.sessionId,
        floorId: query.data.floor_id,
        against: query.data.against === "live"
          ? { kind: "live", branchId: query.data.branch_id! }
          : { kind: "floor", floorId: query.data.against.slice("floor:".length) },
        namespace: query.data.namespace,
        slot: query.data.slot,
      });
      return reply.code(200).send({
        data: entries.map((entry) => ({
          namespace: entry.namespace,
          slot: entry.slot,
          change_type: entry.changeType,
          left_floor_id: entry.leftFloorId,
          right_floor_id: entry.rightFloorId,
          left_present: entry.leftPresent,
          right_present: entry.rightPresent,
          left_value: entry.leftValue,
          right_value: entry.rightValue,
        })),
      });
    } catch (error) {
      return handleSessionStateRouteError(error, reply);
    }
  });
}

function toNamespaceResponse(namespace: SessionStatePublicNamespaceDefinition) {
  return {
    namespace: namespace.namespace,
    owner_kind: namespace.ownerKind,
    ...(namespace.ownerKind === "custom"
      ? {
          logical_owner_type: namespace.logicalOwnerType,
          logical_owner_id: namespace.logicalOwnerId,
          default_slot_template: {
            default_visibility_mode: namespace.defaultSlotTemplate.defaultVisibilityMode,
            default_write_mode: namespace.defaultSlotTemplate.defaultWriteMode,
            default_replay_safety: namespace.defaultSlotTemplate.defaultReplaySafety,
            client_writable: namespace.defaultSlotTemplate.clientWritable,
            allowed_write_modes: namespace.defaultSlotTemplate.allowedWriteModes,
            supports_snapshot: namespace.defaultSlotTemplate.supportsSnapshot,
            supports_diff: namespace.defaultSlotTemplate.supportsDiff,
            replay_policy_source: namespace.defaultSlotTemplate.replayPolicySource,
          },
        }
      : {}),
    slots: namespace.slots.map((slot) => ({
      slot: slot.slot,
      exposure_lifecycle: slot.exposureLifecycle,
      visibility_mode: slot.visibilityMode,
      default_write_mode: slot.defaultWriteMode,
      default_replay_safety: slot.defaultReplaySafety,
      schema_version: slot.schemaVersion,
      size_budget_bytes: slot.sizeBudgetBytes,
      capabilities: {
        client_readable: slot.capabilities.clientReadable,
        client_writable: slot.capabilities.clientWritable,
        allowed_write_modes: slot.capabilities.allowedWriteModes,
        supports_snapshot: slot.capabilities.supportsSnapshot,
        supports_diff: slot.capabilities.supportsDiff,
      },
    })),
  };
}

function toResolvedValueResponse(value: SessionStatePublicResolvedValue) {
  return {
    namespace: value.namespace,
    slot: value.slot,
    source: value.source,
    visibility_mode: value.visibilityMode,
    schema_version: value.schemaVersion,
    present: value.present,
    value: value.value,
    session_id: value.sessionId,
    branch_id: value.branchId,
    floor_id: value.floorId,
    source_mutation_ids: value.sourceMutationIds,
    updated_at: value.updatedAt,
  };
}

function handleSessionStateRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof SessionStatePublicServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }
  if (error instanceof SessionStateCustomNamespaceServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }
  if (error instanceof SessionStateServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }

  throw error;
}
