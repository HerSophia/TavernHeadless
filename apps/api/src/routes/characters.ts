import { and, count, eq, like } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection, DbExecutor } from "../db/client";
import { characters, characterVersions } from "../db/schema";
import { ensureOptionalObjectBody, parseJsonField, parseWithSchema, sendError, stringifyJsonField } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  CHARACTER_VERSION_CONSTRAINT_MAPPING,
  ResourceWriteRouteError,
  assertRevisionWriteApplied,
  withResourceWriteCas,
} from "../services/resource-write.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";

const characterStatusSchema = z.enum(["active", "deleted"]);
const expectedRevisionSchema = z.number().int().nonnegative().optional();

const idParamsSchema = z.object({
  id: z.string().trim().min(1)
});

const versionParamsSchema = idParamsSchema.extend({
  versionId: z.string().trim().min(1)
});

const listCharactersQuerySchema = listQuerySchemaBase.extend({
  status: characterStatusSchema.optional(),
  keyword: z.string().trim().min(1).max(200).optional(),
  sort_by: z.enum(["created_at", "updated_at", "name"]).default("updated_at")
});

const listVersionsQuerySchema = listQuerySchemaBase.extend({
  sort_by: z.enum(["version_no", "created_at"]).default("version_no")
});

const characterSnapshotSchema = z
  .object({
    name: z.string().trim().min(1).max(200)
  })
  .passthrough();

const createCharacterVersionBodySchema = z.object({
  snapshot: characterSnapshotSchema,
  expected_revision: expectedRevisionSchema
});

const expectedRevisionBodySchema = z.object({
  expected_revision: expectedRevisionSchema
}).default({});

const versionParamsJsonSchema = {
  type: "object",
  required: ["id", "versionId"],
  properties: {
    id: { type: "string", minLength: 1 },
    versionId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const;

const listCharactersQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["created_at", "updated_at", "name"] },
    status: { type: "string", enum: ["active", "deleted"] },
    keyword: { type: "string", minLength: 1, maxLength: 200 }
  },
  additionalProperties: false
} as const;

const listVersionsQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["version_no", "created_at"] }
  },
  additionalProperties: false
} as const;

const createCharacterVersionBodyJsonSchema = {
  type: "object",
  required: ["snapshot"],
  properties: {
    snapshot: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 }
      },
      additionalProperties: true
    },
    expected_revision: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;

const expectedRevisionBodyJsonSchema = {
  type: "object",
  properties: {
    expected_revision: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;

const characterVersionJsonSchema = {
  type: "object",
  required: ["id", "character_id", "version_no", "content_hash", "snapshot", "created_at"],
  properties: {
    id: { type: "string" },
    character_id: { type: "string" },
    version_no: { type: "integer", minimum: 1 },
    content_hash: { type: "string" },
    snapshot: {},
    created_at: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
} as const;

const characterWriteVersionJsonSchema = {
  ...characterVersionJsonSchema,
  required: [...characterVersionJsonSchema.required, "revision"],
  properties: {
    ...characterVersionJsonSchema.properties,
    revision: { type: "integer", minimum: 0 }
  }
} as const;

const rollbackCharacterVersionJsonSchema = {
  ...characterWriteVersionJsonSchema,
  required: [...characterWriteVersionJsonSchema.required, "rolled_back_from_version_id"],
  properties: {
    ...characterWriteVersionJsonSchema.properties,
    rolled_back_from_version_id: { type: "string" }
  }
} as const;

const characterListItemJsonSchema = {
  type: "object",
  required: ["id", "name", "source", "status", "revision", "latest_version_no", "deleted_at", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    source: { type: "string" },
    status: { type: "string", enum: ["active", "deleted"] },
    revision: { type: "integer", minimum: 0 },
    latest_version_no: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    deleted_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
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
    sort_order: { type: "string", enum: ["asc", "desc"] }
  },
  additionalProperties: false
} as const;

const characterResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      ...characterListItemJsonSchema,
      required: [...characterListItemJsonSchema.required, "latest_version"],
      properties: {
        ...characterListItemJsonSchema.properties,
        latest_version: { anyOf: [characterVersionJsonSchema, { type: "null" }] }
      }
    }
  },
  additionalProperties: false
} as const;

const characterListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: characterListItemJsonSchema },
    meta: listMetaJsonSchema
  },
  additionalProperties: false
} as const;

const deleteCharacterResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["id", "status", "deleted_at", "updated_at", "revision"],
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["deleted"] },
        deleted_at: { type: "integer", minimum: 0 },
        updated_at: { type: "integer", minimum: 0 },
        revision: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;

const restoreCharacterResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["id", "status", "deleted_at", "updated_at", "revision"],
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["active"] },
        deleted_at: { type: "null" },
        updated_at: { type: "integer", minimum: 0 },
        revision: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;

function loadOwnedCharacter(tx: DbExecutor, characterId: string, accountId: string) {
  return tx
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
    .limit(1)
    .get();
}

function loadCharacterVersionByNo(tx: DbExecutor, characterId: string, versionNo: number) {
  return tx
    .select()
    .from(characterVersions)
    .where(and(eq(characterVersions.characterId, characterId), eq(characterVersions.versionNo, versionNo)))
    .limit(1)
    .get();
}

function loadCharacterVersionById(tx: DbExecutor, characterId: string, versionId: string) {
  return tx
    .select()
    .from(characterVersions)
    .where(and(eq(characterVersions.id, versionId), eq(characterVersions.characterId, characterId)))
    .limit(1)
    .get();
}

function toCharacterVersionResponse(row: typeof characterVersions.$inferSelect) {
  return {
    id: row.id,
    character_id: row.characterId,
    version_no: row.versionNo,
    content_hash: row.contentHash,
    snapshot: parseJsonField(row.dataJson),
    created_at: row.createdAt
  };
}

function toApiLatestVersionNo(value: number): number | null {
  return value > 0 ? value : null;
}

function createCharacterRevisionConflictError() {
  return new ResourceWriteRouteError(409, "character_revision_conflict", "Character has been modified by another operation");
}

function createCharacterDeletedError(message: string) {
  return new ResourceWriteRouteError(409, "character_deleted", message);
}

function sendCharacterWriteError(reply: Parameters<typeof sendError>[0], error: ResourceWriteRouteError) {
  return sendError(reply, error.statusCode, error.code, error.message, error.details);
}

export async function registerCharacterRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const db = connection.db;

  app.get("/characters", {
    schema: {
      tags: ["characters"],
      summary: "List characters",
      operationId: "listCharacters",
      querystring: listCharactersQueryJsonSchema,
      response: {
        200: characterListResponseJsonSchema,
        400: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(listCharactersQuerySchema, request.query, reply);
    if (!parsed.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const conditions = [eq(characters.accountId, auth.accountId)];
    if (parsed.data.status) {
      conditions.push(eq(characters.status, parsed.data.status));
    }
    if (parsed.data.keyword) {
      conditions.push(like(characters.name, `%${parsed.data.keyword}%`));
    }
    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    const sortByColumn =
      parsed.data.sort_by === "name"
        ? characters.name
        : parsed.data.sort_by === "created_at"
          ? characters.createdAt
          : characters.updatedAt;

    const [totalRow] = await db
      .select({ value: count() })
      .from(characters)
      .where(whereClause);

    const rows = await db
      .select({
        id: characters.id,
        name: characters.name,
        source: characters.source,
        status: characters.status,
        revision: characters.revision,
        latestVersionNo: characters.latestVersionNo,
        deletedAt: characters.deletedAt,
        createdAt: characters.createdAt,
        updatedAt: characters.updatedAt
      })
      .from(characters)
      .where(whereClause)
      .orderBy(toOrderBy(sortByColumn, parsed.data.sort_order))
      .limit(parsed.data.limit)
      .offset(parsed.data.offset);

    return reply.send({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        source: row.source,
        status: row.status,
        revision: row.revision,
        latest_version_no: toApiLatestVersionNo(row.latestVersionNo),
        deleted_at: row.deletedAt,
        created_at: row.createdAt,
        updated_at: row.updatedAt
      })),
      meta: buildListMeta({
        total: totalRow?.value ?? 0,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        sortBy: parsed.data.sort_by,
        sortOrder: parsed.data.sort_order
      })
    });
  });

  app.get("/characters/:id", {
    schema: {
      tags: ["characters"],
      summary: "Get character",
      operationId: "getCharacter",
      params: idParamsJsonSchema,
      response: {
        200: characterResponseJsonSchema,
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [character] = await db
      .select()
      .from(characters)
      .where(and(eq(characters.id, parsed.data.id), eq(characters.accountId, auth.accountId)))
      .limit(1);

    if (!character) {
      return sendError(reply, 404, "not_found", "Character not found");
    }

    const [latestVersion] =
      character.latestVersionNo > 0
        ? await db
            .select()
            .from(characterVersions)
            .where(and(eq(characterVersions.characterId, character.id), eq(characterVersions.versionNo, character.latestVersionNo)))
            .limit(1)
        : [];

    return reply.send({
      data: {
        id: character.id,
        name: character.name,
        source: character.source,
        status: character.status,
        revision: character.revision,
        deleted_at: character.deletedAt,
        created_at: character.createdAt,
        updated_at: character.updatedAt,
        latest_version_no: toApiLatestVersionNo(character.latestVersionNo),
        latest_version: latestVersion ? toCharacterVersionResponse(latestVersion) : null
      }
    });
  });

  app.get("/characters/:id/versions", {
    schema: {
      tags: ["characters"],
      summary: "List character versions",
      operationId: "listCharacterVersions",
      params: idParamsJsonSchema,
      querystring: listVersionsQueryJsonSchema,
      response: {
        200: {
          type: "object",
          required: ["data", "meta"],
          properties: {
            data: { type: "array", items: characterVersionJsonSchema },
            meta: listMetaJsonSchema
          },
          additionalProperties: false
        },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const parsedQuery = parseWithSchema(listVersionsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) {
      return;
    }

    const [character] = await db
      .select({ id: characters.id })
      .from(characters)
      .where(and(eq(characters.id, parsedParams.data.id), eq(characters.accountId, auth.accountId)))
      .limit(1);

    if (!character) {
      return sendError(reply, 404, "not_found", "Character not found");
    }

    const [totalRow] = await db
      .select({ value: count() })
      .from(characterVersions)
      .where(eq(characterVersions.characterId, parsedParams.data.id));

    const sortByColumn =
      parsedQuery.data.sort_by === "created_at" ? characterVersions.createdAt : characterVersions.versionNo;

    const rows = await db
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.characterId, parsedParams.data.id))
      .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
      .limit(parsedQuery.data.limit)
      .offset(parsedQuery.data.offset);

    return reply.send({
      data: rows.map(toCharacterVersionResponse),
      meta: buildListMeta({
        total: totalRow?.value ?? 0,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.post("/characters/:id/versions", {
    schema: {
      tags: ["characters"],
      summary: "Create character version",
      operationId: "createCharacterVersion",
      params: idParamsJsonSchema,
      body: createCharacterVersionBodyJsonSchema,
      response: {
        201: {
          type: "object",
          required: ["data"],
          properties: { data: characterWriteVersionJsonSchema },
          additionalProperties: false
        },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(createCharacterVersionBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const created = await withResourceWriteCas({
        db,
        expectedRevision: parsedBody.data.expected_revision,
        load: (tx) => loadOwnedCharacter(tx, parsedParams.data.id, auth.accountId),
        getRevision: (row) => row.revision,
        onMissing: () => new ResourceWriteRouteError(404, "not_found", "Character not found"),
        onRevisionConflict: createCharacterRevisionConflictError,
        validateLoaded: (row) => {
          if (row.status === "deleted") {
            throw createCharacterDeletedError("Cannot create version for deleted character");
          }
        },
        constraintMappings: [CHARACTER_VERSION_CONSTRAINT_MAPPING],
        mutate: ({ tx, row }) => {
          const now = Date.now();
          const versionId = nanoid();
          const versionNo = row.latestVersionNo + 1;
          const snapshotJson = stringifyJsonField(parsedBody.data.snapshot) ?? "{}";
          const contentHash = createHash("sha256").update(snapshotJson).digest("hex");

          const updateResult = tx
            .update(characters)
            .set({
              name: parsedBody.data.snapshot.name,
              latestVersionNo: versionNo,
              revision: row.revision + 1,
              updatedAt: now
            })
            .where(and(eq(characters.id, row.id), eq(characters.accountId, auth.accountId), eq(characters.revision, row.revision)))
            .run();

          assertRevisionWriteApplied(updateResult.changes, createCharacterRevisionConflictError);

          tx.insert(characterVersions).values({
            id: versionId,
            characterId: row.id,
            versionNo,
            dataJson: snapshotJson,
            contentHash,
            createdAt: now
          }).run();

          return {
            id: versionId,
            characterId: row.id,
            versionNo,
            contentHash,
            snapshot: parsedBody.data.snapshot,
            createdAt: now,
            revision: row.revision + 1
          };
        }
      });

      return reply.code(201).send({
        data: {
          id: created.id,
          character_id: created.characterId,
          version_no: created.versionNo,
          content_hash: created.contentHash,
          snapshot: created.snapshot,
          created_at: created.createdAt,
          revision: created.revision
        }
      });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendCharacterWriteError(reply, error);
      }

      throw error;
    }
  });

  app.post("/characters/:id/versions/:versionId/rollback", {
    preValidation: (request, _reply, done) => {
      ensureOptionalObjectBody(request);
      done();
    },
    schema: {
      tags: ["characters"],
      summary: "Rollback character to target version",
      operationId: "rollbackCharacterVersion",
      params: versionParamsJsonSchema,
      body: expectedRevisionBodyJsonSchema,
      response: {
        201: {
          type: "object",
          required: ["data"],
          properties: { data: rollbackCharacterVersionJsonSchema },
          additionalProperties: false
        },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(versionParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(expectedRevisionBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const rolledBack = await withResourceWriteCas({
        db,
        expectedRevision: parsedBody.data.expected_revision,
        load: (tx) => loadOwnedCharacter(tx, parsedParams.data.id, auth.accountId),
        getRevision: (row) => row.revision,
        onMissing: () => new ResourceWriteRouteError(404, "not_found", "Character not found"),
        onRevisionConflict: createCharacterRevisionConflictError,
        validateLoaded: (row) => {
          if (row.status === "deleted") {
            throw createCharacterDeletedError("Cannot rollback deleted character");
          }
        },
        constraintMappings: [CHARACTER_VERSION_CONSTRAINT_MAPPING],
        mutate: ({ tx, row }) => {
          const targetVersion = loadCharacterVersionById(tx, row.id, parsedParams.data.versionId);
          if (!targetVersion) {
            throw new ResourceWriteRouteError(404, "not_found", "Target character version not found");
          }

          const snapshot = parseJsonField(targetVersion.dataJson) as { name?: unknown } | null;
          const snapshotName = typeof snapshot?.name === "string" && snapshot.name.trim().length > 0
            ? snapshot.name.trim()
            : row.name;

          const now = Date.now();
          const versionNo = row.latestVersionNo + 1;
          const rolledBackVersionId = nanoid();

          const updateResult = tx
            .update(characters)
            .set({
              name: snapshotName,
              latestVersionNo: versionNo,
              revision: row.revision + 1,
              updatedAt: now
            })
            .where(and(eq(characters.id, row.id), eq(characters.accountId, auth.accountId), eq(characters.revision, row.revision)))
            .run();

          assertRevisionWriteApplied(updateResult.changes, createCharacterRevisionConflictError);

          tx.insert(characterVersions).values({
            id: rolledBackVersionId,
            characterId: row.id,
            versionNo,
            dataJson: targetVersion.dataJson,
            contentHash: targetVersion.contentHash,
            createdAt: now
          }).run();

          return {
            id: rolledBackVersionId,
            characterId: row.id,
            versionNo,
            contentHash: targetVersion.contentHash,
            snapshot,
            createdAt: now,
            rolledBackFrom: targetVersion.id,
            revision: row.revision + 1
          };
        }
      });

      return reply.code(201).send({
        data: {
          id: rolledBack.id,
          character_id: rolledBack.characterId,
          version_no: rolledBack.versionNo,
          content_hash: rolledBack.contentHash,
          snapshot: rolledBack.snapshot,
          created_at: rolledBack.createdAt,
          rolled_back_from_version_id: rolledBack.rolledBackFrom,
          revision: rolledBack.revision
        }
      });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendCharacterWriteError(reply, error);
      }

      throw error;
    }
  });

  app.delete("/characters/:id", {
    preValidation: (request, _reply, done) => {
      ensureOptionalObjectBody(request);
      done();
    },
    schema: {
      tags: ["characters"],
      summary: "Soft-delete character",
      operationId: "deleteCharacter",
      params: idParamsJsonSchema,
      body: expectedRevisionBodyJsonSchema,
      response: {
        200: deleteCharacterResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(expectedRevisionBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const deleted = await withResourceWriteCas({
        db,
        expectedRevision: parsedBody.data.expected_revision,
        load: (tx) => loadOwnedCharacter(tx, parsedParams.data.id, auth.accountId),
        getRevision: (row) => row.revision,
        onMissing: () => new ResourceWriteRouteError(404, "not_found", "Character not found"),
        onRevisionConflict: createCharacterRevisionConflictError,
        mutate: ({ tx, row }) => {
          if (row.status === "deleted") {
            return {
              id: row.id,
              deletedAt: row.deletedAt ?? row.updatedAt,
              updatedAt: row.updatedAt,
              revision: row.revision
            };
          }

          const now = Date.now();
          const updateResult = tx
            .update(characters)
            .set({
              status: "deleted",
              deletedAt: now,
              updatedAt: now,
              revision: row.revision + 1
            })
            .where(and(eq(characters.id, row.id), eq(characters.accountId, auth.accountId), eq(characters.revision, row.revision)))
            .run();

          assertRevisionWriteApplied(updateResult.changes, createCharacterRevisionConflictError);

          return {
            id: row.id,
            deletedAt: now,
            updatedAt: now,
            revision: row.revision + 1
          };
        }
      });

      return reply.send({
        data: {
          id: deleted.id,
          status: "deleted",
          deleted_at: deleted.deletedAt,
          updated_at: deleted.updatedAt,
          revision: deleted.revision
        }
      });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendCharacterWriteError(reply, error);
      }

      throw error;
    }
  });

  app.post("/characters/:id/restore", {
    preValidation: (request, _reply, done) => {
      ensureOptionalObjectBody(request);
      done();
    },
    schema: {
      tags: ["characters"],
      summary: "Restore deleted character",
      operationId: "restoreCharacter",
      params: idParamsJsonSchema,
      body: expectedRevisionBodyJsonSchema,
      response: {
        200: restoreCharacterResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(expectedRevisionBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const restored = await withResourceWriteCas({
        db,
        expectedRevision: parsedBody.data.expected_revision,
        load: (tx) => loadOwnedCharacter(tx, parsedParams.data.id, auth.accountId),
        getRevision: (row) => row.revision,
        onMissing: () => new ResourceWriteRouteError(404, "not_found", "Character not found"),
        onRevisionConflict: createCharacterRevisionConflictError,
        mutate: ({ tx, row }) => {
          if (row.status === "active") {
            return {
              id: row.id,
              updatedAt: row.updatedAt,
              revision: row.revision
            };
          }

          const now = Date.now();
          const updateResult = tx
            .update(characters)
            .set({
              status: "active",
              deletedAt: null,
              updatedAt: now,
              revision: row.revision + 1
            })
            .where(and(eq(characters.id, row.id), eq(characters.accountId, auth.accountId), eq(characters.revision, row.revision)))
            .run();

          assertRevisionWriteApplied(updateResult.changes, createCharacterRevisionConflictError);

          return {
            id: row.id,
            updatedAt: now,
            revision: row.revision + 1
          };
        }
      });

      return reply.send({
        data: {
          id: restored.id,
          status: "active",
          deleted_at: null,
          updated_at: restored.updatedAt,
          revision: restored.revision
        }
      });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendCharacterWriteError(reply, error);
      }

      throw error;
    }
  });
}
