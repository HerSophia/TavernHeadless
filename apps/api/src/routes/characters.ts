import { and, count, desc, eq, inArray, like, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client";
import { characters, characterVersions } from "../db/schema";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { parseJsonField, parseWithSchema, sendError, stringifyJsonField } from "../lib/http";

const characterStatusSchema = z.enum(["active", "deleted"]);

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
  snapshot: characterSnapshotSchema
});

class CharacterRouteError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const idParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const;

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
    }
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

const characterListItemJsonSchema = {
  type: "object",
  required: ["id", "name", "source", "status", "latest_version_no", "deleted_at", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    source: { type: "string" },
    status: { type: "string", enum: ["active", "deleted"] },
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

const errorResponseJsonSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {}
      },
      additionalProperties: true
    }
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

    const whereClause =
      parsed.data.status && parsed.data.keyword
        ? and(
            eq(characters.status, parsed.data.status),
            like(characters.name, `%${parsed.data.keyword}%`)
          )
        : parsed.data.status
          ? eq(characters.status, parsed.data.status)
          : parsed.data.keyword
            ? like(characters.name, `%${parsed.data.keyword}%`)
            : undefined;

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
        deletedAt: characters.deletedAt,
        createdAt: characters.createdAt,
        updatedAt: characters.updatedAt
      })
      .from(characters)
      .where(whereClause)
      .orderBy(toOrderBy(sortByColumn, parsed.data.sort_order))
      .limit(parsed.data.limit)
      .offset(parsed.data.offset);

    const latestVersionRows =
      rows.length === 0
        ? []
        : await db
            .select({
              characterId: characterVersions.characterId,
              latestVersionNo: sql<number>`max(${characterVersions.versionNo})`
            })
            .from(characterVersions)
            .where(inArray(characterVersions.characterId, rows.map((row) => row.id)))
            .groupBy(characterVersions.characterId);

    const latestVersionMap = new Map<string, number>();
    for (const row of latestVersionRows) {
      if (row.latestVersionNo !== null) {
        latestVersionMap.set(row.characterId, row.latestVersionNo);
      }
    }

    return reply.send({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        source: row.source,
        status: row.status,
        latest_version_no: latestVersionMap.get(row.id) ?? null,
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

    const [character] = await db.select().from(characters).where(eq(characters.id, parsed.data.id)).limit(1);
    if (!character) {
      return sendError(reply, 404, "not_found", "Character not found");
    }

    const [latestVersion] = await db
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.characterId, character.id))
      .orderBy(desc(characterVersions.versionNo))
      .limit(1);

    return reply.send({
      data: {
        id: character.id,
        name: character.name,
        source: character.source,
        status: character.status,
        deleted_at: character.deletedAt,
        created_at: character.createdAt,
        updated_at: character.updatedAt,
        latest_version_no: latestVersion?.versionNo ?? null,
        latest_version: latestVersion
          ? {
              id: latestVersion.id,
              character_id: latestVersion.characterId,
              version_no: latestVersion.versionNo,
              content_hash: latestVersion.contentHash,
              snapshot: parseJsonField(latestVersion.dataJson),
              created_at: latestVersion.createdAt
            }
          : null
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
        200: { type: "object", required: ["data", "meta"], properties: { data: { type: "array", items: characterVersionJsonSchema }, meta: listMetaJsonSchema }, additionalProperties: false },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedQuery = parseWithSchema(listVersionsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) {
      return;
    }

    const [character] = await db
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, parsedParams.data.id))
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
      data: rows.map((row) => ({
        id: row.id,
        character_id: row.characterId,
        version_no: row.versionNo,
        content_hash: row.contentHash,
        snapshot: parseJsonField(row.dataJson),
        created_at: row.createdAt
      })),
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
        201: { type: "object", required: ["data"], properties: { data: characterVersionJsonSchema }, additionalProperties: false },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema
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

    try {
      const created = db.transaction((tx) => {
        const character = tx
          .select()
          .from(characters)
          .where(eq(characters.id, parsedParams.data.id))
          .limit(1)
          .get();

        if (!character) {
          throw new CharacterRouteError(404, "not_found", "Character not found");
        }

        if (character.status === "deleted") {
          throw new CharacterRouteError(409, "character_deleted", "Cannot create version for deleted character");
        }

        const latestVersion = tx
          .select({ versionNo: characterVersions.versionNo })
          .from(characterVersions)
          .where(eq(characterVersions.characterId, character.id))
          .orderBy(desc(characterVersions.versionNo))
          .limit(1)
          .get();

        const now = Date.now();
        const versionId = nanoid();
        const versionNo = (latestVersion?.versionNo ?? 0) + 1;
        const snapshotJson = stringifyJsonField(parsedBody.data.snapshot) ?? "{}";
        const contentHash = createHash("sha256").update(snapshotJson).digest("hex");

        tx.insert(characterVersions).values({
          id: versionId,
          characterId: character.id,
          versionNo,
          dataJson: snapshotJson,
          contentHash,
          createdAt: now
        }).run();

        tx
          .update(characters)
          .set({
            name: parsedBody.data.snapshot.name,
            updatedAt: now
          })
          .where(eq(characters.id, character.id))
          .run();

        return {
          id: versionId,
          characterId: character.id,
          versionNo,
          contentHash,
          snapshot: parsedBody.data.snapshot,
          createdAt: now
        };
      });

      return reply.code(201).send({
        data: {
          id: created.id,
          character_id: created.characterId,
          version_no: created.versionNo,
          content_hash: created.contentHash,
          snapshot: created.snapshot,
          created_at: created.createdAt
        }
      });
    } catch (error) {
      if (error instanceof CharacterRouteError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.post("/characters/:id/versions/:versionId/rollback", {
    schema: {
      tags: ["characters"],
      summary: "Rollback character to target version",
      operationId: "rollbackCharacterVersion",
      params: versionParamsJsonSchema,
      response: {
        201: { type: "object", required: ["data"], properties: { data: { ...characterVersionJsonSchema, required: [...characterVersionJsonSchema.required, "rolled_back_from_version_id"], properties: { ...characterVersionJsonSchema.properties, rolled_back_from_version_id: { type: "string" } } } }, additionalProperties: false },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(versionParamsSchema, request.params, reply);
    if (!parsed.ok) {
      return;
    }

    try {
      const rolledBack = db.transaction((tx) => {
        const character = tx
          .select()
          .from(characters)
          .where(eq(characters.id, parsed.data.id))
          .limit(1)
          .get();

        if (!character) {
          throw new CharacterRouteError(404, "not_found", "Character not found");
        }

        if (character.status === "deleted") {
          throw new CharacterRouteError(409, "character_deleted", "Cannot rollback deleted character");
        }

        const targetVersion = tx
          .select()
          .from(characterVersions)
          .where(
            and(
              eq(characterVersions.id, parsed.data.versionId),
              eq(characterVersions.characterId, character.id)
            )
          )
          .limit(1)
          .get();

        if (!targetVersion) {
          throw new CharacterRouteError(404, "not_found", "Target character version not found");
        }

        const latestVersion = tx
          .select({ versionNo: characterVersions.versionNo })
          .from(characterVersions)
          .where(eq(characterVersions.characterId, character.id))
          .orderBy(desc(characterVersions.versionNo))
          .limit(1)
          .get();

        const versionNo = (latestVersion?.versionNo ?? 0) + 1;
        const now = Date.now();
        const rolledBackVersionId = nanoid();

        tx.insert(characterVersions).values({
          id: rolledBackVersionId,
          characterId: character.id,
          versionNo,
          dataJson: targetVersion.dataJson,
          contentHash: targetVersion.contentHash,
          createdAt: now
        }).run();

        const snapshot = parseJsonField(targetVersion.dataJson) as { name?: unknown } | null;
        const snapshotName = typeof snapshot?.name === "string" && snapshot.name.trim().length > 0
          ? snapshot.name.trim()
          : character.name;

        tx
          .update(characters)
          .set({
            name: snapshotName,
            updatedAt: now
          })
          .where(eq(characters.id, character.id))
          .run();

        return {
          id: rolledBackVersionId,
          characterId: character.id,
          versionNo,
          contentHash: targetVersion.contentHash,
          snapshot,
          createdAt: now,
          rolledBackFrom: targetVersion.id
        };
      });

      return reply.code(201).send({
        data: {
          id: rolledBack.id,
          character_id: rolledBack.characterId,
          version_no: rolledBack.versionNo,
          content_hash: rolledBack.contentHash,
          snapshot: rolledBack.snapshot,
          created_at: rolledBack.createdAt,
          rolled_back_from_version_id: rolledBack.rolledBackFrom
        }
      });
    } catch (error) {
      if (error instanceof CharacterRouteError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.delete("/characters/:id", {
    schema: {
      tags: ["characters"],
      summary: "Soft-delete character",
      operationId: "deleteCharacter",
      params: idParamsJsonSchema,
      response: {
        200: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["id", "status", "deleted_at"], properties: { id: { type: "string" }, status: { type: "string", enum: ["deleted"] }, deleted_at: { type: "integer", minimum: 0 } }, additionalProperties: false } }, additionalProperties: false },
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) {
      return;
    }

    const now = Date.now();

    const result = await db
      .update(characters)
      .set({
        status: "deleted",
        deletedAt: now,
        updatedAt: now
      })
      .where(eq(characters.id, parsed.data.id));

    if (result.changes === 0) {
      return sendError(reply, 404, "not_found", "Character not found");
    }

    return reply.send({
      data: {
        id: parsed.data.id,
        status: "deleted",
        deleted_at: now
      }
    });
  });

  app.post("/characters/:id/restore", {
    schema: {
      tags: ["characters"],
      summary: "Restore deleted character",
      operationId: "restoreCharacter",
      params: idParamsJsonSchema,
      response: {
        200: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["id", "status", "deleted_at", "updated_at"], properties: { id: { type: "string" }, status: { type: "string", enum: ["active"] }, deleted_at: { type: "null" }, updated_at: { type: "integer", minimum: 0 } }, additionalProperties: false } }, additionalProperties: false },
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) {
      return;
    }

    const now = Date.now();

    const result = await db
      .update(characters)
      .set({
        status: "active",
        deletedAt: null,
        updatedAt: now
      })
      .where(eq(characters.id, parsed.data.id));

    if (result.changes === 0) {
      return sendError(reply, 404, "not_found", "Character not found");
    }

    return reply.send({
      data: {
        id: parsed.data.id,
        status: "active",
        deleted_at: null,
        updated_at: now
      }
    });
  });
}
