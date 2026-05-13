import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection, DbExecutor } from "../db/client.js";
import {
  branchLocalVariableSnapshots,
  floorResultSnapshots,
  floors,
  messagePages,
  messages,
  promptRuntimeExplainSnapshots,
  promptSnapshots,
  sessions,
} from "../db/schema.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { FloorLineageService, type FloorBranchDiff, type FloorLineageNode } from "../services/floor-lineage-service.js";
import { FloorRunService, type FloorRunServiceOptions } from "../services/floor-run-service.js";
import {
  OperationLogService,
  operationActorFromRequest,
  operationRequestIdFromRequest,
} from "../services/operation-log-service.js";
import { ProjectAccessService, ProjectAccessServiceError } from "../services/project-access-service.js";
import { VcDiffService } from "../services/vc-diff-service.js";
import { SessionBranchRegistryService } from "../services/variables/host/session-branch-registry-service.js";
import { errorResponseJsonSchema } from "./schemas/common.js";

const branchResetParamsSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().min(1),
});

const branchResetBodySchema = z.object({
  target_floor_id: z.string().min(1),
  expected_head_floor_id: z.string().min(1),
});

const branchMergeParamsSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().min(1),
});

const branchMergePreviewBodySchema = z.object({
  target_branch_id: z.string().min(1),
});

const branchMergeBodySchema = branchMergePreviewBodySchema.extend({
  expected_target_head_floor_id: z.string().min(1),
});

const branchResetParamsJsonSchema = {
  type: "object",
  required: ["id", "branch_id"],
  properties: {
    id: { type: "string", minLength: 1 },
    branch_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const branchResetBodyJsonSchema = {
  type: "object",
  required: ["target_floor_id", "expected_head_floor_id"],
  properties: {
    target_floor_id: { type: "string", minLength: 1 },
    expected_head_floor_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const branchMergeParamsJsonSchema = branchResetParamsJsonSchema;

const branchMergePreviewBodyJsonSchema = {
  type: "object",
  required: ["target_branch_id"],
  properties: {
    target_branch_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const branchMergeBodyJsonSchema = {
  type: "object",
  required: ["target_branch_id", "expected_target_head_floor_id"],
  properties: {
    target_branch_id: { type: "string", minLength: 1 },
    expected_target_head_floor_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const branchFloorSummaryJsonSchema = {
  type: "object",
  required: ["id", "branch_id", "floor_no", "state", "parent_floor_id"],
  properties: {
    id: { type: "string" },
    branch_id: { type: "string" },
    floor_no: { type: "integer" },
    state: { type: "string" },
    parent_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

const branchMergeConflictJsonSchema = {
  type: "object",
  required: ["code", "message", "scope"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    scope: { type: "string", enum: ["branch", "floor", "state", "run"] },
    source_floor_id: { type: "string" },
    target_floor_id: { type: "string" },
  },
  additionalProperties: false,
} as const;

const branchMergePreviewDataJsonSchema = {
  type: "object",
  required: [
    "session_id",
    "source_branch_id",
    "target_branch_id",
    "strategy",
    "can_merge",
    "source_head_floor_id",
    "target_head_floor_id",
    "fork_floor_id",
    "source_only_floors",
    "target_only_floors",
    "shared_floor_ids",
    "conflicts",
  ],
  properties: {
    session_id: { type: "string" },
    source_branch_id: { type: "string" },
    target_branch_id: { type: "string" },
    strategy: { type: "string", enum: ["fast_forward", "no_op", "blocked"] },
    can_merge: { type: "boolean" },
    source_head_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    target_head_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    fork_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    source_only_floors: { type: "array", items: branchFloorSummaryJsonSchema },
    target_only_floors: { type: "array", items: branchFloorSummaryJsonSchema },
    shared_floor_ids: { type: "array", items: { type: "string" } },
    conflicts: { type: "array", items: branchMergeConflictJsonSchema },
  },
  additionalProperties: false,
} as const;

const branchMergePreviewResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: branchMergePreviewDataJsonSchema,
  },
  additionalProperties: false,
} as const;

const branchMergeResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "session_id",
        "source_branch_id",
        "target_branch_id",
        "strategy",
        "merged_floor_ids",
        "merged_count",
        "operation_id",
        "preview",
      ],
      properties: {
        session_id: { type: "string" },
        source_branch_id: { type: "string" },
        target_branch_id: { type: "string" },
        strategy: { type: "string", enum: ["fast_forward", "no_op", "blocked"] },
        merged_floor_ids: { type: "array", items: { type: "string" } },
        merged_count: { type: "integer", minimum: 0 },
        operation_id: { type: "string" },
        preview: branchMergePreviewDataJsonSchema,
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const branchResetResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "session_id",
        "branch_id",
        "target_floor_id",
        "expected_head_floor_id",
        "superseded_floor_ids",
        "superseded_count",
      ],
      properties: {
        session_id: { type: "string" },
        branch_id: { type: "string" },
        target_floor_id: { type: "string" },
        expected_head_floor_id: { type: "string" },
        superseded_floor_ids: { type: "array", items: { type: "string" } },
        superseded_count: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

type FloorResetRow = typeof floors.$inferSelect;
type FloorInsertRow = typeof floors.$inferInsert;
type PageInsertRow = typeof messagePages.$inferInsert;
type MessageInsertRow = typeof messages.$inferInsert;
type PromptSnapshotInsertRow = typeof promptSnapshots.$inferInsert;
type FloorResultSnapshotInsertRow = typeof floorResultSnapshots.$inferInsert;
type PromptRuntimeExplainSnapshotInsertRow = typeof promptRuntimeExplainSnapshots.$inferInsert;
type BranchLocalVariableSnapshotInsertRow = typeof branchLocalVariableSnapshots.$inferInsert;

type BranchMergeStrategy = "fast_forward" | "no_op" | "blocked";

type BranchMergeConflict = {
  code: string;
  message: string;
  scope: "branch" | "floor" | "state" | "run";
  source_floor_id?: string;
  target_floor_id?: string;
};

type BranchMergeFloorSummary = {
  id: string;
  branch_id: string;
  floor_no: number;
  state: string;
  parent_floor_id: string | null;
};

type BranchMergePreviewData = {
  session_id: string;
  source_branch_id: string;
  target_branch_id: string;
  strategy: BranchMergeStrategy;
  can_merge: boolean;
  source_head_floor_id: string | null;
  target_head_floor_id: string | null;
  fork_floor_id: string | null;
  source_only_floors: BranchMergeFloorSummary[];
  target_only_floors: BranchMergeFloorSummary[];
  shared_floor_ids: string[];
  conflicts: BranchMergeConflict[];
};

type BranchResetOperationRefInput = {
  sessionId: string;
  branchId: string;
  headFloor: FloorResetRow;
  targetFloor: FloorResetRow;
  supersededCount: number;
};

type BranchMergePreviewInput = {
  sessionId: string;
  sourceBranchId: string;
  targetBranchId: string;
  diff: FloorBranchDiff;
  sourceActiveRun: boolean;
  targetActiveRun: boolean;
};

type CloneFloorResult = {
  newFloorIds: string[];
  floorIdMap: Map<string, string>;
};

export interface BranchVcRoutesOptions {
  floorRun?: FloorRunServiceOptions;
}

export async function registerBranchVcRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: BranchVcRoutesOptions = {},
): Promise<void> {
  const db = connection.db;
  const floorRunService = new FloorRunService(db, undefined, options.floorRun);
  const lineageService = new FloorLineageService(db);
  const projectAccessService = new ProjectAccessService(db);

  type BranchAccessOk = { ok: true; accountId: string };
  type BranchAccessFail = { ok: false };
  type BranchAccessResult = BranchAccessOk | BranchAccessFail;

  function authorizeProjectActionBySessionId(
    reply: import("fastify").FastifyReply,
    actorAccountId: string,
    sessionId: string,
    action: "project.read" | "project.write",
  ): BranchAccessResult {
    try {
      const access = projectAccessService.requireProjectActionBySessionId(
        actorAccountId,
        sessionId,
        action,
      );
      return { ok: true, accountId: access.project.accountId };
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        if (error.code === "session_project_scope_missing") {
          return { ok: true, accountId: actorAccountId };
        }
        if (error.code === "session_not_found") {
          sendError(reply, 404, "not_found", "Session not found");
          return { ok: false };
        }
        sendError(reply, error.statusCode, error.code, error.message);
        return { ok: false };
      }
      throw error;
    }
  }

  app.post("/sessions/:id/branches/:branch_id/merge/preview", {
    schema: {
      tags: ["sessions"],
      summary: "Preview a non-conflicting session branch merge",
      operationId: "previewSessionBranchMerge",
      params: branchMergeParamsJsonSchema,
      body: branchMergePreviewBodyJsonSchema,
      response: {
        200: branchMergePreviewResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(branchMergeParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(branchMergePreviewBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const sessionId = parsedParams.data.id;
    const sourceBranchId = parsedParams.data.branch_id;
    const targetBranchId = parsedBody.data.target_branch_id;

    let session = db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, auth.accountId)))
      .limit(1)
      .get();

    if (!session) {
      const readAccess = authorizeProjectActionBySessionId(reply, auth.accountId, sessionId, "project.read");
      if (!readAccess.ok) return;
      session = db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1)
        .get();
    }

    if (!session) {
      return sendError(reply, 404, "not_found", "Session not found");
    }


    const preview = await buildBranchMergePreview({
      sessionId,
      sourceBranchId,
      targetBranchId,
      lineageService,
      floorRunService,
    });

    return reply.send({ data: preview });
  });

  app.post("/sessions/:id/branches/:branch_id/merge", {
    schema: {
      tags: ["sessions"],
      summary: "Merge a non-conflicting session branch into another branch",
      operationId: "mergeSessionBranch",
      params: branchMergeParamsJsonSchema,
      body: branchMergeBodyJsonSchema,
      response: {
        200: branchMergeResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(branchMergeParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(branchMergeBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const sessionId = parsedParams.data.id;
    const sourceBranchId = parsedParams.data.branch_id;
    const targetBranchId = parsedBody.data.target_branch_id;

    let session = db
      .select({ id: sessions.id, accountId: sessions.accountId })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, auth.accountId)))
      .limit(1)
      .get();
    let writeAccountId = auth.accountId;

    if (!session) {
      const writeAccess = authorizeProjectActionBySessionId(reply, auth.accountId, sessionId, "project.write");
      if (!writeAccess.ok) return;
      session = db
        .select({ id: sessions.id, accountId: sessions.accountId })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1)
        .get();
      writeAccountId = writeAccess.accountId;
    }

    if (!session) {
      return sendError(reply, 404, "not_found", "Session not found");
    }


    const preview = await buildBranchMergePreview({
      sessionId,
      sourceBranchId,
      targetBranchId,
      lineageService,
      floorRunService,
    });

    if (preview.target_head_floor_id !== parsedBody.data.expected_target_head_floor_id) {
      return sendError(reply, 409, "branch_head_conflict", "Target branch head has changed");
    }

    if (!preview.can_merge) {
      return sendError(reply, 409, "branch_merge_conflict", "Branch merge has conflicts", { preview });
    }

    const now = Date.now();
    let operationId = "";
    let mergedFloorIds: string[] = [];

    db.transaction((tx) => {
      const beforeRef = toMergeBranchOperationRef(preview, []);
      const cloneResult = preview.strategy === "fast_forward"
        ? cloneSourceFloorsIntoTarget(tx, preview, now)
        : { newFloorIds: [], floorIdMap: new Map<string, string>() };
      mergedFloorIds = cloneResult.newFloorIds;

      new SessionBranchRegistryService(tx).ensure({
        accountId: writeAccountId,
        sessionId,
        branchId: targetBranchId,
        updatedAt: now,
      });

      const afterRef = toMergeBranchOperationRef(preview, mergedFloorIds);
      const operation = new OperationLogService(tx).append({
        ...operationActorFromRequest(request),
        accountId: writeAccountId,
        requestId: operationRequestIdFromRequest(request),
        sourceType: "http",
        action: "merge_branch",
        status: "succeeded",
        sessionId,
        branchId: targetBranchId,
        floorId: mergedFloorIds.at(-1) ?? preview.target_head_floor_id,
        targetType: "session_branch",
        targetId: `${sessionId}:${targetBranchId}`,
        beforeRef,
        afterRef,
        diff: new VcDiffService().diff(beforeRef, afterRef),
        metadata: {
          route: "POST /sessions/:id/branches/:branch_id/merge",
          source_branch_id: sourceBranchId,
          target_branch_id: targetBranchId,
          expected_target_head_floor_id: parsedBody.data.expected_target_head_floor_id,
          strategy: preview.strategy,
          merged_floor_count: mergedFloorIds.length,
        },
        createdAt: now,
      });
      operationId = operation.id;
    });

    return reply.send({
      data: {
        session_id: sessionId,
        source_branch_id: sourceBranchId,
        target_branch_id: targetBranchId,
        strategy: preview.strategy,
        merged_floor_ids: mergedFloorIds,
        merged_count: mergedFloorIds.length,
        operation_id: operationId,
        preview,
      },
    });
  });

  app.post("/sessions/:id/branches/:branch_id/reset", {
    schema: {
      tags: ["sessions"],
      summary: "Reset a materialized session branch to an earlier committed floor",
      operationId: "resetSessionBranch",
      params: branchResetParamsJsonSchema,
      body: branchResetBodyJsonSchema,
      response: {
        200: branchResetResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(branchResetParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(branchResetBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const sessionId = parsedParams.data.id;
    const branchId = parsedParams.data.branch_id;

    let session = db
      .select({id: sessions.id, accountId: sessions.accountId })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, auth.accountId)))
      .limit(1)
      .get();
    let writeAccountId = auth.accountId;

    if (!session) {
      const writeAccess = authorizeProjectActionBySessionId(reply, auth.accountId, sessionId, "project.write");
      if (!writeAccess.ok) return;
      session = db
        .select({ id: sessions.id, accountId: sessions.accountId })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1)
        .get();
      writeAccountId = writeAccess.accountId;
    }

    if (!session) {
      return sendError(reply, 404, "not_found", "Session not found");
    }


    const activeRun = await floorRunService.getActiveRunSummary(sessionId, branchId);
    if (activeRun) {
      return sendError(reply, 409, "session_busy", "Branch has an active run");
    }

    const headFloor = db
      .select()
      .from(floors)
      .where(and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
        isNull(floors.supersededAt),
      ))
      .orderBy(desc(floors.floorNo), desc(floors.createdAt))
      .limit(1)
      .get();

    if (!headFloor) {
      return sendError(reply, 409, "invalid_state", "Cannot reset an unmaterialized branch");
    }

    if (headFloor.id !== parsedBody.data.expected_head_floor_id) {
      return sendError(reply, 409, "branch_head_conflict", "Branch head has changed");
    }

    const targetFloor = db
      .select()
      .from(floors)
      .where(and(
        eq(floors.id, parsedBody.data.target_floor_id),
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
      ))
      .limit(1)
      .get();

    if (!targetFloor) {
      return sendError(reply, 404, "floor_not_found", "Target floor not found");
    }

    if (targetFloor.state !== "committed") {
      return sendError(reply, 409, "invalid_state", "Target floor must be committed");
    }

    if (targetFloor.supersededAt !== null) {
      return sendError(reply, 409, "invalid_state", "Cannot reset to a superseded floor");
    }

    if (targetFloor.floorNo > headFloor.floorNo) {
      return sendError(reply, 409, "invalid_reset_target", "Target floor is not reachable from the current branch head");
    }

    const supersededRows = db
      .select({ id: floors.id })
      .from(floors)
      .where(and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
        isNull(floors.supersededAt),
        gt(floors.floorNo, targetFloor.floorNo),
      ))
      .orderBy(desc(floors.floorNo))
      .all();

    const supersededFloorIds = supersededRows.map((row) => row.id);
    const now = Date.now();
    const beforeRef = toResetBranchOperationRef({
      sessionId,
      branchId,
      headFloor,
      targetFloor,
      supersededCount: supersededFloorIds.length,
    });
    const afterRef = {
      ...beforeRef,
      head_floor_id: targetFloor.id,
      head_floor_no: targetFloor.floorNo,
      superseded_floor_count: supersededFloorIds.length,
    };

    db.transaction((tx) => {
      if (supersededFloorIds.length > 0) {
        tx
          .update(floors)
          .set({
            supersededAt: now,
            supersededByFloorId: targetFloor.id,
            updatedAt: now,
          })
          .where(inArray(floors.id, supersededFloorIds))
          .run();
      }

      new SessionBranchRegistryService(tx).ensure({
        accountId: writeAccountId,
        sessionId,
        branchId,
        updatedAt: now,
      });

      new OperationLogService(tx).append({
        ...operationActorFromRequest(request),
        accountId: writeAccountId,
        requestId: operationRequestIdFromRequest(request),
        sourceType: "http",
        action: "reset_branch",
        status: "succeeded",
        sessionId,
        branchId,
        floorId: targetFloor.id,
        targetType: "session_branch",
        targetId: `${sessionId}:${branchId}`,
        beforeRef,
        afterRef,
        diff: new VcDiffService().diff(beforeRef, afterRef),
        metadata: {
          route: "POST /sessions/:id/branches/:branch_id/reset",
          expected_head_floor_id: parsedBody.data.expected_head_floor_id,
          superseded_floor_count: supersededFloorIds.length,
        },
        createdAt: now,
      });
    });

    return reply.send({
      data: {
        session_id: sessionId,
        branch_id: branchId,
        target_floor_id: targetFloor.id,
        expected_head_floor_id: parsedBody.data.expected_head_floor_id,
        superseded_floor_ids: supersededFloorIds,
        superseded_count: supersededFloorIds.length,
      },
    });
  });
}

async function buildBranchMergePreview(input: {
  sessionId: string;
  sourceBranchId: string;
  targetBranchId: string;
  lineageService: FloorLineageService;
  floorRunService: FloorRunService;
}): Promise<BranchMergePreviewData> {
  const [nodes, supersedeIndex, sourceActiveRun, targetActiveRun] = await Promise.all([
    input.lineageService.loadSessionNodes(input.sessionId, { states: [] }),
    input.lineageService.loadSupersedeIndex(input.sessionId),
    input.floorRunService.getActiveRunSummary(input.sessionId, input.sourceBranchId),
    input.floorRunService.getActiveRunSummary(input.sessionId, input.targetBranchId),
  ]);

  const diff = input.lineageService.computeBranchDiff(
    nodes,
    input.targetBranchId,
    input.sourceBranchId,
    supersedeIndex,
  );

  return resolveBranchMergePreview({
    sessionId: input.sessionId,
    sourceBranchId: input.sourceBranchId,
    targetBranchId: input.targetBranchId,
    diff,
    sourceActiveRun: Boolean(sourceActiveRun),
    targetActiveRun: Boolean(targetActiveRun),
  });
}

function resolveBranchMergePreview(input: BranchMergePreviewInput): BranchMergePreviewData {
  const sourceOnlyFloors = input.diff.targetOnlyFloors;
  const targetOnlyFloors = input.diff.baseOnlyFloors;
  const conflicts = resolveBranchMergeConflicts(input);
  const strategy: BranchMergeStrategy = conflicts.length > 0
    ? "blocked"
    : sourceOnlyFloors.length === 0
      ? "no_op"
      : "fast_forward";

  return {
    session_id: input.sessionId,
    source_branch_id: input.sourceBranchId,
    target_branch_id: input.targetBranchId,
    strategy,
    can_merge: conflicts.length === 0,
    source_head_floor_id: input.diff.targetTip?.id ?? null,
    target_head_floor_id: input.diff.baseTip?.id ?? null,
    fork_floor_id: input.diff.forkFloor?.id ?? null,
    source_only_floors: sourceOnlyFloors.map(toBranchMergeFloorSummary),
    target_only_floors: targetOnlyFloors.map(toBranchMergeFloorSummary),
    shared_floor_ids: input.diff.sharedFloors.map((node) => node.id),
    conflicts,
  };
}

function resolveBranchMergeConflicts(input: BranchMergePreviewInput): BranchMergeConflict[] {
  const conflicts: BranchMergeConflict[] = [];

  if (input.sourceBranchId === input.targetBranchId) {
    conflicts.push({
      code: "same_branch",
      message: "Source branch and target branch must be different",
      scope: "branch",
    });
  }

  if (!input.diff.targetTip) {
    conflicts.push({
      code: "source_branch_not_found",
      message: "Source branch not found",
      scope: "branch",
    });
  }

  if (!input.diff.baseTip) {
    conflicts.push({
      code: "target_branch_not_found",
      message: "Target branch not found",
      scope: "branch",
    });
  }

  if (input.diff.baseTip && input.diff.targetTip && !input.diff.forkFloor) {
    conflicts.push({
      code: "no_common_ancestor",
      message: "Branches do not share a common ancestor",
      scope: "branch",
    });
  }

  if (input.diff.baseOnlyFloors.length > 0 && input.diff.targetOnlyFloors.length > 0) {
    conflicts.push({
      code: "target_diverged",
      message: "Target branch has committed floors after the fork point",
      scope: "branch",
      target_floor_id: input.diff.baseOnlyFloors[0]?.id,
    });
  }

  for (const node of input.diff.targetOnlyFloors) {
    if (node.state !== "committed") {
      conflicts.push({
        code: "source_floor_not_committed",
        message: "Source branch contains a non-committed floor",
        scope: "floor",
        source_floor_id: node.id,
      });
    }
  }

  if (input.sourceActiveRun) {
    conflicts.push({
      code: "source_branch_busy",
      message: "Source branch has an active run",
      scope: "run",
    });
  }

  if (input.targetActiveRun) {
    conflicts.push({
      code: "target_branch_busy",
      message: "Target branch has an active run",
      scope: "run",
    });
  }

  return conflicts;
}

function toBranchMergeFloorSummary(node: FloorLineageNode): BranchMergeFloorSummary {
  return {
    id: node.id,
    branch_id: node.branchId,
    floor_no: node.floorNo,
    state: node.state,
    parent_floor_id: node.parentFloorId,
  };
}

function cloneSourceFloorsIntoTarget(
  tx: DbExecutor,
  preview: BranchMergePreviewData,
  now: number,
): CloneFloorResult {
  const sourceFloorIds = [...preview.source_only_floors]
    .sort((a, b) => a.floor_no - b.floor_no)
    .map((item) => item.id);
  const floorIdMap = new Map<string, string>();
  const newFloorIds: string[] = [];

  for (const sourceFloorId of sourceFloorIds) {
    const sourceFloor = tx.select().from(floors).where(eq(floors.id, sourceFloorId)).limit(1).get();
    if (!sourceFloor) continue;

    const newFloorId = nanoid();
    floorIdMap.set(sourceFloor.id, newFloorId);
    newFloorIds.push(newFloorId);

    const parentFloorId = sourceFloor.parentFloorId
      ? floorIdMap.get(sourceFloor.parentFloorId) ?? preview.target_head_floor_id
      : null;

    const floorRow: FloorInsertRow = {
      id: newFloorId,
      sessionId: sourceFloor.sessionId,
      floorNo: sourceFloor.floorNo,
      branchId: preview.target_branch_id,
      parentFloorId,
      supersededAt: null,
      supersededByFloorId: null,
      state: sourceFloor.state,
      metadataJson: sourceFloor.metadataJson,
      tokenIn: sourceFloor.tokenIn,
      tokenOut: sourceFloor.tokenOut,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(floors).values(floorRow).run();

    const { pageIdMap, messageIdMap } = cloneFloorMessageContent(tx, sourceFloor.id, newFloorId, now);
    cloneFloorSnapshots(tx, sourceFloor.id, newFloorId, preview.target_branch_id, pageIdMap, messageIdMap, floorIdMap, now);
  }

  return { newFloorIds, floorIdMap };
}

function cloneFloorMessageContent(
  tx: DbExecutor,
  sourceFloorId: string,
  targetFloorId: string,
  now: number,
): { pageIdMap: Map<string, string>; messageIdMap: Map<string, string> } {
  const pageIdMap = new Map<string, string>();
  const messageIdMap = new Map<string, string>();
  const sourcePages = tx
    .select()
    .from(messagePages)
    .where(eq(messagePages.floorId, sourceFloorId))
    .orderBy(asc(messagePages.pageNo), asc(messagePages.version))
    .all();

  for (const page of sourcePages) {
    const newPageId = nanoid();
    pageIdMap.set(page.id, newPageId);
    const pageRow: PageInsertRow = {
      id: newPageId,
      floorId: targetFloorId,
      pageNo: page.pageNo,
      pageKind: page.pageKind,
      isActive: page.isActive,
      version: page.version,
      checksum: page.checksum,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(messagePages).values(pageRow).run();

    const sourceMessages = tx
      .select()
      .from(messages)
      .where(eq(messages.pageId, page.id))
      .orderBy(asc(messages.seq))
      .all();

    for (const message of sourceMessages) {
      const newMessageId = nanoid();
      messageIdMap.set(message.id, newMessageId);
      const messageRow: MessageInsertRow = {
        id: newMessageId,
        pageId: newPageId,
        seq: message.seq,
        role: message.role,
        content: message.content,
        contentFormat: message.contentFormat,
        tokenCount: message.tokenCount,
        isHidden: message.isHidden,
        source: message.source,
        createdAt: now,
      };
      tx.insert(messages).values(messageRow).run();
    }
  }

  return { pageIdMap, messageIdMap };
}

function cloneFloorSnapshots(
  tx: DbExecutor,
  sourceFloorId: string,
  targetFloorId: string,
  targetBranchId: string,
  pageIdMap: Map<string, string>,
  messageIdMap: Map<string, string>,
  floorIdMap: Map<string, string>,
  now: number,
): void {
  const promptSnapshot = tx.select().from(promptSnapshots).where(eq(promptSnapshots.floorId, sourceFloorId)).limit(1).get();
  if (promptSnapshot) {
    const row: PromptSnapshotInsertRow = {
      ...promptSnapshot,
      floorId: targetFloorId,
      createdAt: now,
    };
    tx.insert(promptSnapshots).values(row).run();
  }

  const resultSnapshot = tx.select().from(floorResultSnapshots).where(eq(floorResultSnapshots.floorId, sourceFloorId)).limit(1).get();
  if (resultSnapshot) {
    const outputPageId = pageIdMap.get(resultSnapshot.outputPageId);
    const assistantMessageId = messageIdMap.get(resultSnapshot.assistantMessageId);
    if (outputPageId && assistantMessageId) {
      const row: FloorResultSnapshotInsertRow = {
        ...resultSnapshot,
        floorId: targetFloorId,
        outputPageId,
        assistantMessageId,
        committedAt: now,
        updatedAt: now,
      };
      tx.insert(floorResultSnapshots).values(row).run();
    }
  }

  const explainSnapshots = tx
    .select()
    .from(promptRuntimeExplainSnapshots)
    .where(eq(promptRuntimeExplainSnapshots.floorId, sourceFloorId))
    .all();
  for (const explainSnapshot of explainSnapshots) {
    const row: PromptRuntimeExplainSnapshotInsertRow = {
      ...explainSnapshot,
      id: nanoid(),
      floorId: targetFloorId,
      targetBranchId,
      sourceFloorId: explainSnapshot.sourceFloorId
        ? floorIdMap.get(explainSnapshot.sourceFloorId) ?? explainSnapshot.sourceFloorId
        : null,
      createdAt: now,
    };
    tx.insert(promptRuntimeExplainSnapshots).values(row).run();
  }

  const variableSnapshot = tx
    .select()
    .from(branchLocalVariableSnapshots)
    .where(eq(branchLocalVariableSnapshots.floorId, sourceFloorId))
    .limit(1)
    .get();
  if (variableSnapshot) {
    const row: BranchLocalVariableSnapshotInsertRow = {
      ...variableSnapshot,
      floorId: targetFloorId,
      branchId: targetBranchId,
      createdAt: now,
    };
    tx.insert(branchLocalVariableSnapshots).values(row).run();
  }
}

function toMergeBranchOperationRef(preview: BranchMergePreviewData, mergedFloorIds: string[]): Record<string, unknown> {
  return {
    session_id: preview.session_id,
    source_branch_id: preview.source_branch_id,
    target_branch_id: preview.target_branch_id,
    source_head_floor_id: preview.source_head_floor_id,
    target_head_floor_id: preview.target_head_floor_id,
    fork_floor_id: preview.fork_floor_id,
    strategy: preview.strategy,
    source_only_floor_ids: preview.source_only_floors.map((item) => item.id),
    target_only_floor_ids: preview.target_only_floors.map((item) => item.id),
    merged_floor_ids: mergedFloorIds,
    merged_floor_count: mergedFloorIds.length,
  };
}

function toResetBranchOperationRef(input: BranchResetOperationRefInput): Record<string, unknown> {
  return {
    session_id: input.sessionId,
    branch_id: input.branchId,
    head_floor_id: input.headFloor.id,
    head_floor_no: input.headFloor.floorNo,
    target_floor_id: input.targetFloor.id,
    target_floor_no: input.targetFloor.floorNo,
    target_floor_state: input.targetFloor.state,
    superseded_floor_count: input.supersededCount,
  };
}
