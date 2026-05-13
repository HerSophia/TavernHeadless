import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import {
  characterVersions,
  characters,
  floors,
  presetVersions,
  presets,
  regexProfileVersions,
  regexProfiles,
  sessions,
  vcTags,
  worldbookVersions,
  worldbooks,
} from "../db/schema.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  OperationLogService,
  operationActorFromRequest,
  operationRequestIdFromRequest,
} from "../services/operation-log-service.js";
import { ProjectAccessService, ProjectAccessServiceError } from "../services/project-access-service.js";
import { VcDiffService } from "../services/vc-diff-service.js";
import { errorResponseJsonSchema } from "./schemas/common.js";

const vcTagTargetTypeSchema = z.enum(["floor", "asset_version"]);

const createVcTagBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  target_type: vcTagTargetTypeSchema,
  target_id: z.string().min(1),
  session_id: z.string().min(1).nullable().optional(),
  metadata: z.unknown().optional(),
});

const vcTagListQuerySchema = z.object({
  target_type: vcTagTargetTypeSchema.optional(),
  target_id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

const vcTagParamsSchema = z.object({ id: z.string().min(1) });

const createVcTagBodyJsonSchema = {
  type: "object",
  required: ["name", "target_type", "target_id"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    target_type: { type: "string", enum: ["floor", "asset_version"] },
    target_id: { type: "string", minLength: 1 },
    session_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    metadata: {},
  },
  additionalProperties: false,
} as const;

const vcTagListQueryJsonSchema = {
  type: "object",
  properties: {
    target_type: { type: "string", enum: ["floor", "asset_version"] },
    target_id: { type: "string", minLength: 1 },
    session_id: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    offset: { type: "integer", minimum: 0, default: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"], default: "desc" },
  },
  additionalProperties: false,
} as const;

const vcTagParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
  additionalProperties: false,
} as const;

const vcTagJsonSchema = {
  type: "object",
  required: [
    "id",
    "account_id",
    "name",
    "target_type",
    "target_id",
    "session_id",
    "metadata",
    "created_by_operation_id",
    "created_at",
  ],
  properties: {
    id: { type: "string" },
    account_id: { type: "string" },
    name: { type: "string" },
    target_type: { type: "string", enum: ["floor", "asset_version"] },
    target_id: { type: "string" },
    session_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    metadata: {},
    created_by_operation_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const vcTagResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: vcTagJsonSchema },
  additionalProperties: false,
} as const;

const vcTagListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: vcTagJsonSchema },
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

const deleteVcTagResponseJsonSchema = {
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
  additionalProperties: false,
} as const;

type VcTagTargetType = "floor" | "asset_version";
type VcTagRow = typeof vcTags.$inferSelect;

type ResolvedTagTarget = {
  sessionId: string | null;
  branchId: string | null;
  floorId: string | null;
  ref: Record<string, unknown>;
};

type TagTargetResolution =
  | { ok: true; target: ResolvedTagTarget }
  | { ok: false; statusCode: number; code: string; message: string };

export async function registerVcTagRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;
  const projectAccessService = new ProjectAccessService(db);

  app.post("/vc-tags", {
    schema: {
      tags: ["vc-tags"],
      summary: "Create a version-control tag",
      operationId: "createVcTag",
      body: createVcTagBodyJsonSchema,
      response: {
        201: vcTagResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createVcTagBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const target = resolveTagTarget(db, auth.accountId, parsedBody.data.target_type, parsedBody.data.target_id);
    if (!target.ok) {
      return sendError(reply, target.statusCode, target.code, target.message);
    }

    const requestedSessionId = parsedBody.data.session_id ?? null;
    const sessionId = target.target.sessionId ?? requestedSessionId;
    if (requestedSessionId && target.target.sessionId && requestedSessionId !== target.target.sessionId) {
      return sendError(reply, 400, "invalid_tag_session", "Tag session_id does not match target session");
    }
    if (requestedSessionId && !target.target.sessionId && !sessionOwnedByAccount(db, auth.accountId, requestedSessionId)) {
      return sendError(reply, 404, "session_not_found", "Session not found");
    }

    const existing = db
      .select({ id: vcTags.id })
      .from(vcTags)
      .where(and(eq(vcTags.accountId, auth.accountId), eq(vcTags.name, parsedBody.data.name)))
      .limit(1)
      .get();
    if (existing) {
      return sendError(reply, 409, "tag_exists", "Tag name already exists");
    }

    const now = Date.now();
    const tagId = nanoid();
    const operationId = nanoid();
    const metadataJson = parsedBody.data.metadata === undefined ? null : JSON.stringify(parsedBody.data.metadata);

    const created = db.transaction((tx) => {
      const tagValues = {
        id: tagId,
        accountId: auth.accountId,
        name: parsedBody.data.name,
        targetType: parsedBody.data.target_type,
        targetId: parsedBody.data.target_id,
        sessionId,
        metadataJson,
        createdByOperationId: operationId,
        createdAt: now,
      } satisfies typeof vcTags.$inferInsert;
      const afterRef = toVcTagOperationRef(tagValues as VcTagRow, target.target.ref);

      new OperationLogService(tx).append({
        id: operationId,
        ...operationActorFromRequest(request),
        accountId: auth.accountId,
        requestId: operationRequestIdFromRequest(request),
        sourceType: "http",
        action: "create_tag",
        status: "succeeded",
        sessionId,
        branchId: target.target.branchId,
        floorId: target.target.floorId,
        targetType: "vc_tag",
        targetId: tagId,
        beforeRef: null,
        afterRef,
        diff: new VcDiffService().diff(null, afterRef),
        metadata: {
          route: "POST /vc-tags",
          target_type: parsedBody.data.target_type,
          metadata_present: parsedBody.data.metadata !== undefined,
        },
        createdAt: now,
      });

      const inserted = tx
        .insert(vcTags)
        .values(tagValues)
        .returning()
        .get();

      return inserted;
    });

    return reply.code(201).send({ data: toVcTagResponse(created) });
  });

  app.get("/vc-tags", {
    schema: {
      tags: ["vc-tags"],
      summary: "List version-control tags",
      operationId: "listVcTags",
      querystring: vcTagListQueryJsonSchema,
      response: { 200: vcTagListResponseJsonSchema, 400: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(vcTagListQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;
    const auth = getRequestAuthContext(request);
    const conditions = [eq(vcTags.accountId, auth.accountId)];
    pushOptionalFilter(conditions, vcTags.targetType, parsedQuery.data.target_type);
    pushOptionalFilter(conditions, vcTags.targetId, parsedQuery.data.target_id);
    pushOptionalFilter(conditions, vcTags.sessionId, parsedQuery.data.session_id);
    const whereClause = and(...conditions);
    const orderBy = parsedQuery.data.sort_order === "asc" ? asc(vcTags.createdAt) : desc(vcTags.createdAt);
    const rows = db
      .select()
      .from(vcTags)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(parsedQuery.data.limit)
      .offset(parsedQuery.data.offset)
      .all();
    const total = db
      .select({ value: count() })
      .from(vcTags)
      .where(whereClause)
      .get()?.value ?? 0;

    return reply.send({
      data: rows.map(toVcTagResponse),
      meta: {
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        has_more: parsedQuery.data.offset + rows.length < total,
        sort_by: "created_at",
        sort_order: parsedQuery.data.sort_order,
      },
    });
  });

  app.get("/vc-tags/:id", {
    schema: {
      tags: ["vc-tags"],
      summary: "Get a version-control tag",
      operationId: "getVcTag",
      params: vcTagParamsJsonSchema,
      response: { 200: vcTagResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(vcTagParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const auth = getRequestAuthContext(request);
    const row = db
      .select()
      .from(vcTags)
      .where(and(eq(vcTags.id, parsedParams.data.id), eq(vcTags.accountId, auth.accountId)))
      .limit(1)
      .get();
    if (!row) {
      return sendError(reply, 404, "tag_not_found", "Tag not found");
    }

    return reply.send({ data: toVcTagResponse(row) });
  });

  app.delete("/vc-tags/:id", {
    schema: {
      tags: ["vc-tags"],
      summary: "Delete a version-control tag",
      operationId: "deleteVcTag",
      params: vcTagParamsJsonSchema,
      response: {
        200: deleteVcTagResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(vcTagParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const auth = getRequestAuthContext(request);
    const row = db
      .select()
      .from(vcTags)
      .where(and(eq(vcTags.id, parsedParams.data.id), eq(vcTags.accountId, auth.accountId)))
      .limit(1)
      .get();
    if (!row) {
      return sendError(reply, 404, "tag_not_found", "Tag not found");
    }

    const beforeRef = toVcTagOperationRef(row);
    db.transaction((tx) => {
      tx.delete(vcTags).where(eq(vcTags.id, row.id)).run();
      new OperationLogService(tx).append({
        ...operationActorFromRequest(request),
        accountId: auth.accountId,
        requestId: operationRequestIdFromRequest(request),
        sourceType: "http",
        action: "delete_tag",
        status: "succeeded",
        sessionId: row.sessionId,
        targetType: "vc_tag",
        targetId: row.id,
        beforeRef,
        afterRef: null,
        diff: new VcDiffService().diff(beforeRef, null),
        metadata: {
          route: "DELETE /vc-tags/:id",
          target_type: row.targetType,
        },
      });
    });

    return reply.send({ data: { id: row.id, deleted: true } });
  });
}

function resolveTagTarget(
  db: DatabaseConnection["db"],
  accountId: string,
  targetType: VcTagTargetType,
  targetId: string,
): TagTargetResolution {
  if (targetType === "floor") {
    const row = db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        branchId: floors.branchId,
        floorNo: floors.floorNo,
        state: floors.state,
      })
      .from(floors)
      .innerJoin(sessions, eq(sessions.id, floors.sessionId))
      .where(and(eq(floors.id, targetId), eq(sessions.accountId, accountId)))
      .limit(1)
      .get();
    if (!row) {
      return { ok: false, statusCode: 404, code: "floor_not_found", message: "Floor not found" };
    }

    return {
      ok: true,
      target: {
        sessionId: row.sessionId,
        branchId: row.branchId,
        floorId: row.id,
        ref: {
          target_type: "floor",
          floor_id: row.id,
          session_id: row.sessionId,
          branch_id: row.branchId,
          floor_no: row.floorNo,
          state: row.state,
        },
      },
    };
  }

  const assetVersion = resolveAssetVersionTagTarget(db, accountId, targetId);
  if (!assetVersion) {
    return { ok: false, statusCode: 404, code: "asset_version_not_found", message: "Asset version not found" };
  }
  return { ok: true, target: assetVersion };
}

function resolveAssetVersionTagTarget(
  db: DatabaseConnection["db"],
  accountId: string,
  versionId: string,
): ResolvedTagTarget | null {
  const preset = db
    .select({
      versionId: presetVersions.id,
      assetId: presetVersions.presetId,
      versionNo: presetVersions.versionNo,
      contentHash: presetVersions.contentHash,
    })
    .from(presetVersions)
    .innerJoin(presets, eq(presets.id, presetVersions.presetId))
    .where(and(eq(presetVersions.id, versionId), eq(presets.accountId, accountId)))
    .limit(1)
    .get();
  if (preset) return toAssetVersionTagTarget("preset", preset);

  const worldbook = db
    .select({
      versionId: worldbookVersions.id,
      assetId: worldbookVersions.worldbookId,
      versionNo: worldbookVersions.versionNo,
      contentHash: worldbookVersions.contentHash,
    })
    .from(worldbookVersions)
    .innerJoin(worldbooks, eq(worldbooks.id, worldbookVersions.worldbookId))
    .where(and(eq(worldbookVersions.id, versionId), eq(worldbooks.accountId, accountId)))
    .limit(1)
    .get();
  if (worldbook) return toAssetVersionTagTarget("worldbook", worldbook);

  const regexProfile = db
    .select({
      versionId: regexProfileVersions.id,
      assetId: regexProfileVersions.regexProfileId,
      versionNo: regexProfileVersions.versionNo,
      contentHash: regexProfileVersions.contentHash,
    })
    .from(regexProfileVersions)
    .innerJoin(regexProfiles, eq(regexProfiles.id, regexProfileVersions.regexProfileId))
    .where(and(eq(regexProfileVersions.id, versionId), eq(regexProfiles.accountId, accountId)))
    .limit(1)
    .get();
  if (regexProfile) return toAssetVersionTagTarget("regex_profile", regexProfile);

  const character = db
    .select({
      versionId: characterVersions.id,
      assetId: characterVersions.characterId,
      versionNo: characterVersions.versionNo,
      contentHash: characterVersions.contentHash,
    })
    .from(characterVersions)
    .innerJoin(characters, eq(characters.id, characterVersions.characterId))
    .where(and(eq(characterVersions.id, versionId), eq(characters.accountId, accountId)))
    .limit(1)
    .get();
  if (character) return toAssetVersionTagTarget("character", character);

  return null;
}

function toAssetVersionTagTarget(
  assetKind: "character" | "preset" | "worldbook" | "regex_profile",
  row: { versionId: string; assetId: string; versionNo: number; contentHash: string },
): ResolvedTagTarget {
  return {
    sessionId: null,
    branchId: null,
    floorId: null,
    ref: {
      target_type: "asset_version",
      asset_kind: assetKind,
      asset_id: row.assetId,
      version_id: row.versionId,
      version_no: row.versionNo,
      content_hash: row.contentHash,
    },
  };
}

function sessionOwnedByAccount(db: DatabaseConnection["db"], accountId: string, sessionId: string): boolean {
  return Boolean(db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
    .limit(1)
    .get());
}

function toVcTagResponse(row: VcTagRow): Record<string, unknown> {
  return {
    id: row.id,
    account_id: row.accountId,
    name: row.name,
    target_type: row.targetType,
    target_id: row.targetId,
    session_id: row.sessionId,
    metadata: parseNullableJson(row.metadataJson),
    created_by_operation_id: row.createdByOperationId,
    created_at: row.createdAt,
  };
}

function toVcTagOperationRef(row: VcTagRow, targetRef?: Record<string, unknown>): Record<string, unknown> {
  return {
    tag_id: row.id,
    name: row.name,
    target_type: row.targetType,
    target_id: row.targetId,
    session_id: row.sessionId,
    created_by_operation_id: row.createdByOperationId,
    created_at: row.createdAt,
    metadata_present: row.metadataJson !== null,
    ...(targetRef ? { target_ref: targetRef } : {}),
  };
}

function parseNullableJson(raw: string | null): unknown | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function pushOptionalFilter(filters: SQL[], column: AnySQLiteColumn, value: string | null | undefined): void {
  if (!value) return;
  filters.push(eq(column, value));
}
