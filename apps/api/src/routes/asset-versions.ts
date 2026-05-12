import { parseRegexScripts, parseWorldBook } from "@tavern/adapters-sillytavern";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { presets, regexProfiles, worldbookEntries, worldbooks } from "../db/schema.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { buildPersistedWorldbookGlobalSettings, buildWorldbookEntryInsertValues } from "../lib/worldbook-utils.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  AssetVersionService,
  parseAssetVersionDataJson,
  toPresetVersionRef,
  toRegexProfileVersionRef,
  toWorldbookVersionRef,
  type PromptAssetVersionKind,
  type PromptAssetVersionRef,
} from "../services/asset-version-service.js";
import {
  appendPromptAssetOperationLog,
  toPromptAssetOperationRef,
  type PromptAssetOperationKind,
} from "../services/prompt-asset-operation-log.js";
import {
  assertRevisionWriteApplied,
  executeResourceWrite,
  ResourceWriteRouteError,
} from "../services/resource-write.js";
import { VcDiffService, type VcDiffMode } from "../services/vc-diff-service.js";
import { errorResponseJsonSchema } from "./schemas/common.js";

const assetIdParamsSchema = z.object({ id: z.string().min(1) });
const assetVersionParamsSchema = z.object({ id: z.string().min(1), version_id: z.string().min(1) });

const assetVersionCompareBodySchema = z.object({
  left_version_id: z.string().min(1),
  right_version_id: z.string().min(1),
  mode: z.enum(["summary", "full"]).default("summary"),
});

const assetVersionRollbackBodySchema = z.object({
  expected_version: z.number().int().nonnegative().optional(),
  expected_updated_at: z.number().int().nonnegative().optional(),
}).default({});

const assetIdParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const assetVersionParamsJsonSchema = {
  type: "object",
  required: ["id", "version_id"],
  properties: {
    id: { type: "string", minLength: 1 },
    version_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const assetVersionCompareBodyJsonSchema = {
  type: "object",
  required: ["left_version_id", "right_version_id"],
  properties: {
    left_version_id: { type: "string", minLength: 1 },
    right_version_id: { type: "string", minLength: 1 },
    mode: { type: "string", enum: ["summary", "full"], default: "summary" },
  },
  additionalProperties: false,
} as const;

const assetVersionRollbackBodyJsonSchema = {
  type: "object",
  properties: {
    expected_version: { type: "integer", minimum: 0 },
    expected_updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const assetVersionJsonSchema = {
  type: "object",
  required: ["id", "asset_id", "kind", "version_no", "parent_version_id", "content_hash", "snapshot", "created_by_operation_id", "created_at"],
  properties: {
    id: { type: "string" },
    asset_id: { type: "string" },
    kind: { type: "string", enum: ["preset", "worldbook", "regex_profile"] },
    version_no: { type: "integer", minimum: 1 },
    parent_version_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    content_hash: { type: "string" },
    snapshot: {},
    created_by_operation_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const assetVersionResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: assetVersionJsonSchema },
  additionalProperties: false,
} as const;

const assetVersionListResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: { type: "array", items: assetVersionJsonSchema } },
  additionalProperties: false,
} as const;

const assetVersionCompareResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["asset_id", "kind", "left_version_id", "right_version_id", "diff"],
      properties: {
        asset_id: { type: "string" },
        kind: { type: "string", enum: ["preset", "worldbook", "regex_profile"] },
        left_version_id: { type: "string" },
        right_version_id: { type: "string" },
        diff: {},
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const assetVersionRollbackResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["id", "name", "source", "created_at", "updated_at", "version", "version_id", "content_hash", "rolled_back_from_version_id"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        source: { type: "string" },
        created_at: { type: "integer", minimum: 0 },
        updated_at: { type: "integer", minimum: 0 },
        version: { type: "integer", minimum: 1 },
        version_id: { type: "string" },
        content_hash: { type: "string" },
        rolled_back_from_version_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

type AssetVersionRouteKind = PromptAssetVersionKind;
type VersionedPromptAssetRow = {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  version: number;
};
type AssetVersionRollbackBody = z.infer<typeof assetVersionRollbackBodySchema>;

export async function registerAssetVersionRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const service = new AssetVersionService(connection.db);

  app.get("/presets/:id/versions", {
    schema: {
      tags: ["asset-versions"],
      summary: "List preset versions",
      operationId: "listPresetVersions",
      params: assetIdParamsJsonSchema,
      response: { 200: assetVersionListResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(assetIdParamsSchema, request.params, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    const rows = service.listPresetVersions(auth.accountId, parsed.data.id);
    if (!rows) return sendError(reply, 404, "preset_not_found", "Preset not found");
    return reply.send({ data: rows.map((row) => mapAssetVersionRef(toPresetVersionRef(row))) });
  });

  app.post("/presets/:id/versions/compare", {
    schema: {
      tags: ["asset-versions"],
      summary: "Compare preset versions",
      operationId: "comparePresetVersions",
      params: assetIdParamsJsonSchema,
      body: assetVersionCompareBodyJsonSchema,
      response: { 200: assetVersionCompareResponseJsonSchema, 400: errorResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    return compareAssetVersions(request, reply, service, "preset");
  });

  app.get("/presets/:id/versions/:version_id", {
    schema: {
      tags: ["asset-versions"],
      summary: "Get preset version",
      operationId: "getPresetVersion",
      params: assetVersionParamsJsonSchema,
      response: { 200: assetVersionResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(assetVersionParamsSchema, request.params, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    const row = service.loadPresetVersion(auth.accountId, parsed.data.id, parsed.data.version_id);
    if (!row) return sendError(reply, 404, "asset_version_not_found", "Asset version not found");
    return reply.send({ data: mapAssetVersionRef(toPresetVersionRef(row)) });
  });

  app.post("/presets/:id/versions/:version_id/rollback", {
    schema: {
      tags: ["asset-versions"],
      summary: "Rollback preset to a version",
      operationId: "rollbackPresetVersion",
      params: assetVersionParamsJsonSchema,
      body: assetVersionRollbackBodyJsonSchema,
      response: { 200: assetVersionRollbackResponseJsonSchema, 400: errorResponseJsonSchema, 404: errorResponseJsonSchema, 409: errorResponseJsonSchema, 503: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(assetVersionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(assetVersionRollbackBodySchema, request.body ?? {}, reply);
    if (!parsedBody.ok) return;
    const auth = getRequestAuthContext(request);

    try {
      const result = await executeResourceWrite(() => connection.db.transaction((tx) => {
        const row = tx
          .select()
          .from(presets)
          .where(and(eq(presets.id, parsedParams.data.id), eq(presets.accountId, auth.accountId)))
          .limit(1)
          .get();
        if (!row) throw promptAssetNotFoundError("preset");
        const assetVersionService = new AssetVersionService(tx);
        const targetVersion = assetVersionService.loadPresetVersion(auth.accountId, row.id, parsedParams.data.version_id);
        if (!targetVersion) throw assetVersionNotFoundError();
        const expectedVersion = resolveExpectedAssetWriteVersion(parsedBody.data, row, "preset_conflict", "Preset");
        const beforeVersion = assetVersionService.getLatestPresetVersion(auth.accountId, row.id);
        const beforeRef = toPromptAssetOperationRef("preset", row, beforeVersion);
        const now = Date.now();
        const nextVersion = row.version + 1;
        const operationId = nanoid();
        const updateResult = tx.update(presets).set({
          dataJson: targetVersion.dataJson,
          updatedAt: now,
          version: nextVersion,
        }).where(and(eq(presets.id, row.id), eq(presets.accountId, auth.accountId), eq(presets.version, expectedVersion))).run();
        assertRevisionWriteApplied(updateResult.changes, () => promptAssetConflictError("preset"));
        const afterRow = { ...row, dataJson: targetVersion.dataJson, updatedAt: now, version: nextVersion };
        const afterVersion = assetVersionService.createPresetVersion(row.id, {
          versionNo: nextVersion,
          data: parseAssetVersionDataJson(targetVersion.dataJson),
          createdByOperationId: operationId,
          createdAt: now,
        });
        appendPromptAssetOperationLog(tx, request, {
          operationId,
          accountId: auth.accountId,
          action: "rollback_preset",
          assetKind: "preset",
          assetId: row.id,
          beforeRef,
          afterRef: toPromptAssetOperationRef("preset", afterRow, afterVersion),
          metadata: rollbackOperationMetadata("POST /presets/:id/versions/:version_id/rollback", targetVersion.id, parsedBody.data),
          createdAt: now,
        });
        return toRollbackResponse(afterRow, toPresetVersionRef(afterVersion), targetVersion.id);
      }));

      return reply.send({ data: result });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendError(reply, error.statusCode, error.code, error.message, error.details);
      }
      throw error;
    }
  });

  app.get("/worldbooks/:id/versions", {
    schema: {
      tags: ["asset-versions"],
      summary: "List worldbook versions",
      operationId: "listWorldbookVersions",
      params: assetIdParamsJsonSchema,
      response: { 200: assetVersionListResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(assetIdParamsSchema, request.params, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    const rows = service.listWorldbookVersions(auth.accountId, parsed.data.id);
    if (!rows) return sendError(reply, 404, "worldbook_not_found", "Worldbook not found");
    return reply.send({ data: rows.map((row) => mapAssetVersionRef(toWorldbookVersionRef(row))) });
  });

  app.post("/worldbooks/:id/versions/compare", {
    schema: {
      tags: ["asset-versions"],
      summary: "Compare worldbook versions",
      operationId: "compareWorldbookVersions",
      params: assetIdParamsJsonSchema,
      body: assetVersionCompareBodyJsonSchema,
      response: { 200: assetVersionCompareResponseJsonSchema, 400: errorResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    return compareAssetVersions(request, reply, service, "worldbook");
  });

  app.get("/worldbooks/:id/versions/:version_id", {
    schema: {
      tags: ["asset-versions"],
      summary: "Get worldbook version",
      operationId: "getWorldbookVersion",
      params: assetVersionParamsJsonSchema,
      response: { 200: assetVersionResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(assetVersionParamsSchema, request.params, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    const row = service.loadWorldbookVersion(auth.accountId, parsed.data.id, parsed.data.version_id);
    if (!row) return sendError(reply, 404, "asset_version_not_found", "Asset version not found");
    return reply.send({ data: mapAssetVersionRef(toWorldbookVersionRef(row)) });
  });

  app.post("/worldbooks/:id/versions/:version_id/rollback", {
    schema: {
      tags: ["asset-versions"],
      summary: "Rollback worldbook to a version",
      operationId: "rollbackWorldbookVersion",
      params: assetVersionParamsJsonSchema,
      body: assetVersionRollbackBodyJsonSchema,
      response: { 200: assetVersionRollbackResponseJsonSchema, 400: errorResponseJsonSchema, 404: errorResponseJsonSchema, 409: errorResponseJsonSchema, 503: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(assetVersionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(assetVersionRollbackBodySchema, request.body ?? {}, reply);
    if (!parsedBody.ok) return;
    const auth = getRequestAuthContext(request);

    try {
      const result = await executeResourceWrite(() => connection.db.transaction((tx) => {
        const row = tx
          .select()
          .from(worldbooks)
          .where(and(eq(worldbooks.id, parsedParams.data.id), eq(worldbooks.accountId, auth.accountId)))
          .limit(1)
          .get();
        if (!row) throw promptAssetNotFoundError("worldbook");
        const assetVersionService = new AssetVersionService(tx);
        const targetVersion = assetVersionService.loadWorldbookVersion(auth.accountId, row.id, parsedParams.data.version_id);
        if (!targetVersion) throw assetVersionNotFoundError();
        const expectedVersion = resolveExpectedAssetWriteVersion(parsedBody.data, row, "worldbook_conflict", "Worldbook");
        const targetSnapshot = parseAssetVersionDataJson(targetVersion.dataJson);
        const parsedWorldbook = parseWorldBook(targetSnapshot);
        const beforeVersion = assetVersionService.getLatestWorldbookVersion(auth.accountId, row.id);
        const beforeRef = toPromptAssetOperationRef("worldbook", row, beforeVersion);
        const now = Date.now();
        const nextVersion = row.version + 1;
        const operationId = nanoid();
        const updateResult = tx.update(worldbooks).set({
          name: parsedWorldbook.name,
          dataJson: JSON.stringify(buildPersistedWorldbookGlobalSettings(parsedWorldbook)),
          updatedAt: now,
          version: nextVersion,
        }).where(and(eq(worldbooks.id, row.id), eq(worldbooks.accountId, auth.accountId), eq(worldbooks.version, expectedVersion))).run();
        assertRevisionWriteApplied(updateResult.changes, () => promptAssetConflictError("worldbook"));
        tx.delete(worldbookEntries).where(eq(worldbookEntries.worldbookId, row.id)).run();
        if (parsedWorldbook.entries.length > 0) {
          tx.insert(worldbookEntries).values(parsedWorldbook.entries.map((entry, index) => buildWorldbookEntryInsertValues(entry, {
            id: nanoid(),
            worldbookId: row.id,
            uid: entry.uid ?? index,
            createdAt: now,
            updatedAt: now,
          }))).run();
        }
        const afterRow = { ...row, name: parsedWorldbook.name, updatedAt: now, version: nextVersion };
        const afterVersion = assetVersionService.createWorldbookVersion(row.id, {
          versionNo: nextVersion,
          data: targetSnapshot,
          createdByOperationId: operationId,
          createdAt: now,
        });
        appendPromptAssetOperationLog(tx, request, {
          operationId,
          accountId: auth.accountId,
          action: "rollback_worldbook",
          assetKind: "worldbook",
          assetId: row.id,
          beforeRef,
          afterRef: toPromptAssetOperationRef("worldbook", afterRow, afterVersion),
          metadata: rollbackOperationMetadata("POST /worldbooks/:id/versions/:version_id/rollback", targetVersion.id, parsedBody.data),
          createdAt: now,
        });
        return toRollbackResponse(afterRow, toWorldbookVersionRef(afterVersion), targetVersion.id);
      }));

      return reply.send({ data: result });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendError(reply, error.statusCode, error.code, error.message, error.details);
      }
      throw error;
    }
  });

  app.get("/regex-profiles/:id/versions", {
    schema: {
      tags: ["asset-versions"],
      summary: "List regex profile versions",
      operationId: "listRegexProfileVersions",
      params: assetIdParamsJsonSchema,
      response: { 200: assetVersionListResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(assetIdParamsSchema, request.params, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    const rows = service.listRegexProfileVersions(auth.accountId, parsed.data.id);
    if (!rows) return sendError(reply, 404, "regex_profile_not_found", "Regex profile not found");
    return reply.send({ data: rows.map((row) => mapAssetVersionRef(toRegexProfileVersionRef(row))) });
  });

  app.post("/regex-profiles/:id/versions/compare", {
    schema: {
      tags: ["asset-versions"],
      summary: "Compare regex profile versions",
      operationId: "compareRegexProfileVersions",
      params: assetIdParamsJsonSchema,
      body: assetVersionCompareBodyJsonSchema,
      response: { 200: assetVersionCompareResponseJsonSchema, 400: errorResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    return compareAssetVersions(request, reply, service, "regex_profile");
  });

  app.get("/regex-profiles/:id/versions/:version_id", {
    schema: {
      tags: ["asset-versions"],
      summary: "Get regex profile version",
      operationId: "getRegexProfileVersion",
      params: assetVersionParamsJsonSchema,
      response: { 200: assetVersionResponseJsonSchema, 404: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(assetVersionParamsSchema, request.params, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    const row = service.loadRegexProfileVersion(auth.accountId, parsed.data.id, parsed.data.version_id);
    if (!row) return sendError(reply, 404, "asset_version_not_found", "Asset version not found");
    return reply.send({ data: mapAssetVersionRef(toRegexProfileVersionRef(row)) });
  });

  app.post("/regex-profiles/:id/versions/:version_id/rollback", {
    schema: {
      tags: ["asset-versions"],
      summary: "Rollback regex profile to a version",
      operationId: "rollbackRegexProfileVersion",
      params: assetVersionParamsJsonSchema,
      body: assetVersionRollbackBodyJsonSchema,
      response: { 200: assetVersionRollbackResponseJsonSchema, 400: errorResponseJsonSchema, 404: errorResponseJsonSchema, 409: errorResponseJsonSchema, 503: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(assetVersionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedBody = parseWithSchema(assetVersionRollbackBodySchema, request.body ?? {}, reply);
    if (!parsedBody.ok) return;
    const auth = getRequestAuthContext(request);

    try {
      const result = await executeResourceWrite(() => connection.db.transaction((tx) => {
        const row = tx
          .select()
          .from(regexProfiles)
          .where(and(eq(regexProfiles.id, parsedParams.data.id), eq(regexProfiles.accountId, auth.accountId)))
          .limit(1)
          .get();
        if (!row) throw promptAssetNotFoundError("regex_profile");
        const assetVersionService = new AssetVersionService(tx);
        const targetVersion = assetVersionService.loadRegexProfileVersion(auth.accountId, row.id, parsedParams.data.version_id);
        if (!targetVersion) throw assetVersionNotFoundError();
        const expectedVersion = resolveExpectedAssetWriteVersion(parsedBody.data, row, "regex_profile_conflict", "Regex profile");
        const targetSnapshot = parseAssetVersionDataJson(targetVersion.dataJson);
        const stScripts = parseRegexScripts(targetSnapshot);
        const beforeVersion = assetVersionService.getLatestRegexProfileVersion(auth.accountId, row.id);
        const beforeRef = toPromptAssetOperationRef("regex_profile", row, beforeVersion);
        const now = Date.now();
        const nextVersion = row.version + 1;
        const operationId = nanoid();
        const updateResult = tx.update(regexProfiles).set({
          dataJson: JSON.stringify(stScripts),
          updatedAt: now,
          version: nextVersion,
        }).where(and(eq(regexProfiles.id, row.id), eq(regexProfiles.accountId, auth.accountId), eq(regexProfiles.version, expectedVersion))).run();
        assertRevisionWriteApplied(updateResult.changes, () => promptAssetConflictError("regex_profile"));
        const afterRow = { ...row, dataJson: JSON.stringify(stScripts), updatedAt: now, version: nextVersion };
        const afterVersion = assetVersionService.createRegexProfileVersion(row.id, {
          versionNo: nextVersion,
          data: stScripts,
          createdByOperationId: operationId,
          createdAt: now,
        });
        appendPromptAssetOperationLog(tx, request, {
          operationId,
          accountId: auth.accountId,
          action: "rollback_regex_profile",
          assetKind: "regex_profile",
          assetId: row.id,
          beforeRef,
          afterRef: toPromptAssetOperationRef("regex_profile", afterRow, afterVersion),
          metadata: rollbackOperationMetadata("POST /regex-profiles/:id/versions/:version_id/rollback", targetVersion.id, parsedBody.data),
          createdAt: now,
        });
        return toRollbackResponse(afterRow, toRegexProfileVersionRef(afterVersion), targetVersion.id);
      }));

      return reply.send({ data: result });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendError(reply, error.statusCode, error.code, error.message, error.details);
      }
      throw error;
    }
  });
}

async function compareAssetVersions(
  request: FastifyRequest,
  reply: FastifyReply,
  service: AssetVersionService,
  kind: AssetVersionRouteKind,
) {
  const parsedParams = parseWithSchema(assetIdParamsSchema, request.params, reply);
  if (!parsedParams.ok) return;
  const parsedBody = parseWithSchema(assetVersionCompareBodySchema, request.body, reply);
  if (!parsedBody.ok) return;
  const auth = getRequestAuthContext(request);

  const left = loadAssetVersionRef(service, kind, auth.accountId, parsedParams.data.id, parsedBody.data.left_version_id);
  const right = loadAssetVersionRef(service, kind, auth.accountId, parsedParams.data.id, parsedBody.data.right_version_id);
  if (!left || !right) {
    return sendError(reply, 404, "asset_version_not_found", "Asset version not found");
  }

  return reply.send({
    data: {
      asset_id: parsedParams.data.id,
      kind,
      left_version_id: left.id,
      right_version_id: right.id,
      diff: new VcDiffService().diff(
        parseAssetVersionDataJson(left.dataJson),
        parseAssetVersionDataJson(right.dataJson),
        { mode: parsedBody.data.mode as VcDiffMode },
      ),
    },
  });
}

function loadAssetVersionRef(
  service: AssetVersionService,
  kind: AssetVersionRouteKind,
  accountId: string,
  assetId: string,
  versionId: string,
): PromptAssetVersionRef | null {
  if (kind === "preset") {
    const row = service.loadPresetVersion(accountId, assetId, versionId);
    return row ? toPresetVersionRef(row) : null;
  }
  if (kind === "worldbook") {
    const row = service.loadWorldbookVersion(accountId, assetId, versionId);
    return row ? toWorldbookVersionRef(row) : null;
  }
  const row = service.loadRegexProfileVersion(accountId, assetId, versionId);
  return row ? toRegexProfileVersionRef(row) : null;
}

function mapAssetVersionRef(ref: PromptAssetVersionRef): Record<string, unknown> {
  return {
    id: ref.id,
    asset_id: ref.assetId,
    kind: ref.kind,
    version_no: ref.versionNo,
    parent_version_id: ref.parentVersionId,
    content_hash: ref.contentHash,
    snapshot: parseAssetVersionDataJson(ref.dataJson),
    created_by_operation_id: ref.createdByOperationId,
    created_at: ref.createdAt,
  };
}

function toRollbackResponse(
  row: VersionedPromptAssetRow,
  version: PromptAssetVersionRef,
  rolledBackFromVersionId: string,
): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    version: row.version,
    version_id: version.id,
    content_hash: version.contentHash,
    rolled_back_from_version_id: rolledBackFromVersionId,
  };
}

function resolveExpectedAssetWriteVersion(
  body: AssetVersionRollbackBody,
  row: Pick<VersionedPromptAssetRow, "updatedAt" | "version">,
  conflictCode: string,
  resourceName: string,
): number {
  if (body.expected_version !== undefined) {
    return body.expected_version;
  }

  if (body.expected_updated_at !== undefined) {
    if (body.expected_updated_at !== row.updatedAt) {
      throw new ResourceWriteRouteError(409, conflictCode, `${resourceName} has been modified by another operation`);
    }
    return row.version;
  }

  throw new ResourceWriteRouteError(400, "validation_error", "expected_version or expected_updated_at is required");
}

function promptAssetNotFoundError(kind: PromptAssetOperationKind): ResourceWriteRouteError {
  if (kind === "preset") {
    return new ResourceWriteRouteError(404, "preset_not_found", "Preset not found");
  }
  if (kind === "worldbook") {
    return new ResourceWriteRouteError(404, "worldbook_not_found", "Worldbook not found");
  }
  return new ResourceWriteRouteError(404, "regex_profile_not_found", "Regex profile not found");
}

function promptAssetConflictError(kind: PromptAssetOperationKind): ResourceWriteRouteError {
  if (kind === "preset") {
    return new ResourceWriteRouteError(409, "preset_conflict", "Preset has been modified by another operation");
  }
  if (kind === "worldbook") {
    return new ResourceWriteRouteError(409, "worldbook_conflict", "Worldbook has been modified by another operation");
  }
  return new ResourceWriteRouteError(409, "regex_profile_conflict", "Regex profile has been modified by another operation");
}

function assetVersionNotFoundError(): ResourceWriteRouteError {
  return new ResourceWriteRouteError(404, "asset_version_not_found", "Asset version not found");
}

function rollbackOperationMetadata(
  route: string,
  rolledBackFromVersionId: string,
  body: AssetVersionRollbackBody,
): Record<string, unknown> {
  return {
    route,
    rolled_back_from_version_id: rolledBackFromVersionId,
    expected_version_present: body.expected_version !== undefined,
    expected_updated_at_present: body.expected_updated_at !== undefined,
  };
}
