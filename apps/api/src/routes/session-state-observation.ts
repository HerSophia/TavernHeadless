import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { parseWithSchema, sendError } from "../lib/http.js";
import { buildListMeta } from "../lib/pagination.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  SessionStateObservationService,
  SessionStateObservationServiceError,
  type SessionStateObservedDiffEntry,
  type SessionStateObservedLiveHeadSummary,
  type SessionStateObservedMutationDetail,
  type SessionStateObservedMutationSummary,
  type SessionStateObservedSnapshotSummary,
} from "../session-state/session-state-observation-service.js";
import { SessionStateServiceError } from "../session-state/session-state-service.js";
import type {
  SessionStateFloorSnapshotView,
  SessionStateReplayBlocker,
  SessionStateReplayEvaluation,
  SessionStateResolvedValue,
} from "../session-state/session-state-types.js";

/**
 * Phase 3 观察面路由包。
 *
 * 这组端点是 session-state 的内部观察面，完全只读，按账号严格隔离。
 * 它不会被进一步封装进 `@tavern/sdk` 或 `@tavern/client-helpers`；
 * 相关 OpenAPI 定义会随路由自动生成，但官方资源层不会绑定。
 */
export interface RegisterSessionStateObservationRoutesOptions {
  observationService?: SessionStateObservationService;
}

const sessionIdParamsSchema = z.object({ sessionId: z.string().min(1) });
const floorIdParamsSchema = z.object({ floorId: z.string().min(1) });
const mutationIdParamsSchema = z.object({ sessionId: z.string().min(1), mutationId: z.string().min(1) });
const liveSlotParamsSchema = z.object({
  sessionId: z.string().min(1),
  namespace: z.string().min(1),
  slot: z.string().min(1),
});
const snapshotSlotParamsSchema = z.object({
  floorId: z.string().min(1),
  namespace: z.string().min(1),
  slot: z.string().min(1),
});

const statusSchema = z.enum(["staged", "applied", "discarded", "blocked", "uncertain"]);
const writeModeSchema = z.enum(["direct", "commit_bound"]);
const replaySafetySchema = z.enum(["safe", "confirm_on_replay", "never_auto_replay", "uncertain"]);

const listMutationsQuerySchema = z.object({
  branch_id: z.string().min(1).optional(),
  status: statusSchema.optional(),
  source_floor_id: z.string().min(1).optional(),
  run_id: z.string().min(1).optional(),
  target_slot: z.string().min(1).optional(),
  state_namespace: z.string().min(1).optional(),
  write_mode: writeModeSchema.optional(),
  replay_safety: replaySafetySchema.optional(),
  created_after: z.coerce.number().int().nonnegative().optional(),
  created_before: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

const listLiveHeadsQuerySchema = z.object({
  branch_id: z.string().min(1).optional(),
  state_namespace: z.string().min(1).optional(),
});

const liveSlotQuerySchema = z.object({
  branch_id: z.string().min(1),
  source_floor_id: z.string().min(1).optional(),
});

const listFloorSnapshotsQuerySchema = z.object({
  state_namespace: z.string().min(1).optional(),
});

const replaySafetyQuerySchema = z.object({
  confirmed_mutation_ids: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const trimmed = value.trim();
      if (trimmed.length === 0) return [] as string[];
      return trimmed
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }),
});

const diffAgainstPattern = /^(floor:.+|live)$/;

const diffQuerySchema = z.object({
  against: z.string().regex(diffAgainstPattern),
  branch_id: z.string().min(1).optional(),
  state_namespace: z.string().min(1).optional(),
  include_values: z.coerce.boolean().optional().default(false),
});

export async function registerSessionStateObservationRoutes(
  app: FastifyInstance,
  options: RegisterSessionStateObservationRoutesOptions = {},
): Promise<void> {
  const observationService = options.observationService;

  function ensureServiceAvailable(reply: FastifyReply): SessionStateObservationService | null {
    if (!observationService) {
      sendError(
        reply,
        503,
        "feature_unavailable",
        "Session state observation is unavailable because client-data is disabled",
      );
      return null;
    }
    return observationService;
  }

  app.get("/sessions/:sessionId/session-state/bindings", {
    schema: {
      tags: ["session-state"],
      summary: "List managed domain bindings for a session",
      description:
        "Session-state internal observation endpoint. Not wrapped by @tavern/sdk or @tavern/client-helpers.",
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;
    const params = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const { accountId } = getRequestAuthContext(request);
    try {
      const bindings = service.listBindingsForSession(accountId, params.data.sessionId);
      return reply.code(200).send({
        data: bindings.map((binding) => ({
          domain_id: binding.domainId,
          account_id: binding.accountId,
          manager_kind: binding.managerKind,
          host_type: binding.hostType,
          host_id: binding.hostId,
          state_namespace: binding.stateNamespace,
          require_caller_owner: binding.requireCallerOwner,
          allow_auto_create_collection: binding.allowAutoCreateCollection,
          created_at: binding.createdAt,
          updated_at: binding.updatedAt,
        })),
      });
    } catch (error) {
      return handleObservationError(error, reply);
    }
  });

  app.get("/sessions/:sessionId/session-state/mutations", {
    schema: {
      tags: ["session-state"],
      summary: "List session-state mutations",
      description:
        "Internal observation endpoint. Returns summaries with payload_preview and payload_size_bytes only; the full value is not returned here.",
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;
    const params = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(listMutationsQuerySchema, request.query, reply);
    if (!query.ok) return;
    const { accountId } = getRequestAuthContext(request);
    try {
      const { rows, total } = service.listMutationsForSession(
        accountId,
        params.data.sessionId,
        {
          branchId: query.data.branch_id,
          status: query.data.status,
          sourceFloorId: query.data.source_floor_id,
          runId: query.data.run_id,
          targetSlot: query.data.target_slot,
          stateNamespace: query.data.state_namespace,
          writeMode: query.data.write_mode,
          replaySafety: query.data.replay_safety,
          createdAfter: query.data.created_after,
          createdBefore: query.data.created_before,
        },
        {
          limit: query.data.limit,
          offset: query.data.offset,
          sortOrder: query.data.sort_order,
        },
      );
      return reply.code(200).send({
        data: rows.map(mapMutationSummary),
        meta: buildListMeta({
          total,
          limit: query.data.limit,
          offset: query.data.offset,
          sortBy: "created_at",
          sortOrder: query.data.sort_order,
        }),
      });
    } catch (error) {
      return handleObservationError(error, reply);
    }
  });

  app.get("/sessions/:sessionId/session-state/mutations/:mutationId", {
    schema: {
      tags: ["session-state"],
      summary: "Get a single session-state mutation with full payload",
      description: "Internal observation endpoint. Returns full payload for a single mutation.",
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;
    const params = parseWithSchema(mutationIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const { accountId } = getRequestAuthContext(request);
    try {
      const detail = service.getMutationById(accountId, params.data.sessionId, params.data.mutationId);
      return reply.code(200).send({ data: mapMutationDetail(detail) });
    } catch (error) {
      return handleObservationError(error, reply);
    }
  });

  app.get("/sessions/:sessionId/session-state/live", {
    schema: {
      tags: ["session-state"],
      summary: "List live head metadata for a session",
      description:
        "Internal observation endpoint. Returns metadata only; the full value is not returned in the list endpoint.",
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;
    const params = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(listLiveHeadsQuerySchema, request.query, reply);
    if (!query.ok) return;
    const { accountId } = getRequestAuthContext(request);
    try {
      const heads = service.listLiveHeadsForSession(accountId, params.data.sessionId, {
        ...(query.data.state_namespace ? { stateNamespace: query.data.state_namespace } : {}),
        ...(query.data.branch_id ? { branchId: query.data.branch_id } : {}),
      });
      return reply.code(200).send({ data: heads.map(mapLiveHeadSummary) });
    } catch (error) {
      return handleObservationError(error, reply);
    }
  });

  app.get("/sessions/:sessionId/session-state/live/:namespace/:slot", {
    schema: {
      tags: ["session-state"],
      summary: "Resolve the live value for a single slot",
      description: "Internal observation endpoint. Returns the full resolved value, source-floor-aware when requested.",
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;
    const params = parseWithSchema(liveSlotParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(liveSlotQuerySchema, request.query, reply);
    if (!query.ok) return;
    const { accountId } = getRequestAuthContext(request);
    try {
      const resolved = service.resolveLive(
        accountId,
        params.data.sessionId,
        query.data.branch_id,
        params.data.namespace,
        params.data.slot,
        query.data.source_floor_id,
      );
      if (!resolved) {
        return sendError(reply, 404, "not_found", "Resource not found");
      }
      return reply.code(200).send({ data: mapResolvedValue(resolved) });
    } catch (error) {
      return handleObservationError(error, reply);
    }
  });

  app.get("/floors/:floorId/session-state/snapshots", {
    schema: {
      tags: ["session-state"],
      summary: "List floor snapshot metadata",
      description:
        "Internal observation endpoint. Returns metadata only; the full value is not returned in the list endpoint.",
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;
    const params = parseWithSchema(floorIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(listFloorSnapshotsQuerySchema, request.query, reply);
    if (!query.ok) return;
    const { accountId } = getRequestAuthContext(request);
    try {
      const meta = service.resolveOwnedFloorMeta(accountId, params.data.floorId);
      if (!meta) return sendError(reply, 404, "not_found", "Resource not found");
      const snapshots = service.listFloorSnapshots(
        accountId,
        meta.sessionId,
        params.data.floorId,
        {
          ...(query.data.state_namespace ? { stateNamespace: query.data.state_namespace } : {}),
        },
      );
      return reply.code(200).send({ data: snapshots.map(mapFloorSnapshotSummary) });
    } catch (error) {
      return handleObservationError(error, reply);
    }
  });

  app.get("/floors/:floorId/session-state/snapshots/:namespace/:slot", {
    schema: {
      tags: ["session-state"],
      summary: "Get a single floor snapshot with full value",
      description: "Internal observation endpoint. Returns the full snapshot value for one slot.",
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;
    const params = parseWithSchema(snapshotSlotParamsSchema, request.params, reply);
    if (!params.ok) return;
    const { accountId } = getRequestAuthContext(request);
    try {
      const meta = service.resolveOwnedFloorMeta(accountId, params.data.floorId);
      if (!meta) return sendError(reply, 404, "not_found", "Resource not found");
      const snapshot = service.getFloorSnapshot(
        accountId,
        meta.sessionId,
        params.data.floorId,
        params.data.namespace,
        params.data.slot,
      );
      if (!snapshot) {
        return sendError(reply, 404, "not_found", "Resource not found");
      }
      return reply.code(200).send({ data: mapFloorSnapshotDetail(snapshot) });
    } catch (error) {
      return handleObservationError(error, reply);
    }
  });

  app.get("/floors/:floorId/session-state/replay-safety", {
    schema: {
      tags: ["session-state"],
      summary: "Evaluate session-state replay blockers for a floor",
      description: "Internal observation endpoint. Mirrors SessionStateService.evaluateReplaySafetyForFloor.",
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;
    const params = parseWithSchema(floorIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(replaySafetyQuerySchema, request.query, reply);
    if (!query.ok) return;
    const { accountId } = getRequestAuthContext(request);
    try {
      const meta = service.resolveOwnedFloorMeta(accountId, params.data.floorId);
      if (!meta) return sendError(reply, 404, "not_found", "Resource not found");
      const evaluation = service.evaluateReplaySafetyForFloor(
        accountId,
        meta.sessionId,
        params.data.floorId,
        query.data.confirmed_mutation_ids,
      );
      return reply.code(200).send({ data: mapReplayEvaluation(evaluation) });
    } catch (error) {
      return handleObservationError(error, reply);
    }
  });

  app.get("/floors/:floorId/session-state/diff", {
    schema: {
      tags: ["session-state"],
      summary: "Diff a floor snapshot against another floor or live",
      description:
        "Internal observation endpoint. against=floor:<id> compares two floor snapshots; against=live compares live head vs floor snapshot. include_values=true opt-in returns raw value bodies.",
    },
  }, async (request, reply) => {
    const service = ensureServiceAvailable(reply);
    if (!service) return;
    const params = parseWithSchema(floorIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(diffQuerySchema, request.query, reply);
    if (!query.ok) return;
    const { accountId } = getRequestAuthContext(request);
    try {
      const meta = service.resolveOwnedFloorMeta(accountId, params.data.floorId);
      if (!meta) return sendError(reply, 404, "not_found", "Resource not found");

      const against = query.data.against;
      let parsedAgainst: { kind: "floor"; floorId: string } | { kind: "live"; branchId: string };
      if (against === "live") {
        if (!query.data.branch_id) {
          return sendError(reply, 400, "validation_error", "branch_id is required when against=live");
        }
        parsedAgainst = { kind: "live", branchId: query.data.branch_id };
      } else {
        const targetFloorId = against.slice("floor:".length);
        if (targetFloorId.length === 0) {
          return sendError(reply, 400, "validation_error", "against must be 'floor:<id>' or 'live'");
        }
        parsedAgainst = { kind: "floor", floorId: targetFloorId };
      }

      const entries = service.diffFloorAgainst(
        accountId,
        meta.sessionId,
        params.data.floorId,
        parsedAgainst,
        {
          ...(query.data.state_namespace ? { stateNamespace: query.data.state_namespace } : {}),
          includeValues: query.data.include_values,
        },
      );
      return reply.code(200).send({ data: entries.map(mapDiffEntry) });
    } catch (error) {
      return handleObservationError(error, reply);
    }
  });
}

function handleObservationError(error: unknown, reply: FastifyReply) {
  if (error instanceof SessionStateObservationServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }
  if (error instanceof SessionStateServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }
  throw error;
}

function mapMutationSummary(row: SessionStateObservedMutationSummary) {
  return {
    id: row.id,
    state_namespace: row.stateNamespace,
    target_slot: row.targetSlot,
    session_id: row.sessionId,
    branch_id: row.branchId,
    source_floor_id: row.sourceFloorId,
    source_snapshot_floor_id: row.sourceSnapshotFloorId,
    visibility_mode: row.visibilityMode,
    write_mode: row.writeMode,
    status: row.status,
    replay_safety: row.replaySafety,
    request_id: row.requestId,
    run_id: row.runId,
    live_head_key: row.liveHeadKey,
    discard_reason: row.discardReason,
    blocked_reason: row.blockedReason,
    payload_size_bytes: row.payloadSizeBytes,
    payload_present: row.payloadPresent,
    payload_preview: row.payloadPreview,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    applied_at: row.appliedAt,
  };
}

function mapMutationDetail(detail: SessionStateObservedMutationDetail) {
  return {
    ...mapMutationSummary(detail),
    payload: {
      present: detail.payload.present,
      value: detail.payload.value,
    },
  };
}

function mapLiveHeadSummary(entry: SessionStateObservedLiveHeadSummary) {
  return {
    state_namespace: entry.stateNamespace,
    slot: entry.slot,
    branch_id: entry.branchId,
    visibility_mode: entry.visibilityMode,
    schema_version: entry.schemaVersion,
    present: entry.present,
    source_floor_id: entry.sourceFloorId,
    last_mutation_id: entry.lastMutationId,
    updated_at: entry.updatedAt,
    payload_size_bytes: entry.payloadSizeBytes,
  };
}

function mapFloorSnapshotSummary(entry: SessionStateObservedSnapshotSummary) {
  return {
    state_namespace: entry.stateNamespace,
    slot: entry.slot,
    visibility_mode: entry.visibilityMode,
    schema_version: entry.schemaVersion,
    present: entry.present,
    session_id: entry.sessionId,
    branch_id: entry.branchId,
    floor_id: entry.floorId,
    source_mutation_ids: entry.sourceMutationIds,
    committed_at: entry.committedAt,
    payload_size_bytes: entry.payloadSizeBytes,
  };
}

function mapFloorSnapshotDetail(view: SessionStateFloorSnapshotView) {
  return {
    state_namespace: view.namespace,
    slot: view.slot,
    visibility_mode: view.visibilityMode,
    schema_version: view.schemaVersion,
    present: view.present,
    value: view.value,
    session_id: view.sessionId,
    branch_id: view.branchId,
    floor_id: view.floorId,
    source_mutation_ids: view.sourceMutationIds,
    committed_at: view.committedAt,
  };
}

function mapResolvedValue(resolved: SessionStateResolvedValue) {
  return {
    state_namespace: resolved.namespace,
    slot: resolved.slot,
    source: resolved.source,
    visibility_mode: resolved.visibilityMode,
    schema_version: resolved.schemaVersion,
    present: resolved.present,
    value: resolved.value,
    session_id: resolved.sessionId,
    branch_id: resolved.branchId,
    floor_id: resolved.floorId,
    source_mutation_ids: resolved.sourceMutationIds,
    updated_at: resolved.updatedAt,
  };
}

function mapReplayEvaluation(evaluation: SessionStateReplayEvaluation) {
  return {
    allowed: evaluation.allowed,
    blockers: evaluation.blockers.map(mapReplayBlocker),
  };
}

function mapReplayBlocker(blocker: SessionStateReplayBlocker) {
  return {
    mutation_id: blocker.mutationId,
    state_namespace: blocker.stateNamespace,
    target_slot: blocker.targetSlot,
    replay_safety: blocker.replaySafety,
    status: blocker.status,
    reason: blocker.reason,
  };
}

function mapDiffEntry(entry: SessionStateObservedDiffEntry) {
  const base: Record<string, unknown> = {
    state_namespace: entry.stateNamespace,
    slot: entry.slot,
    change_type: entry.changeType,
    left_floor_id: entry.leftFloorId,
    right_floor_id: entry.rightFloorId,
    left_present: entry.leftPresent,
    right_present: entry.rightPresent,
  };
  if (Object.prototype.hasOwnProperty.call(entry, "leftValue")) {
    base.left_value = entry.leftValue ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(entry, "rightValue")) {
    base.right_value = entry.rightValue ?? null;
  }
  return base;
}
