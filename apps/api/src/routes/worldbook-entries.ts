/**
 * Worldbook Entry Routes
 *
 * 世界书条目管理路由：CRUD + 批量操作。
 *
 * GET    /worldbooks/:worldbook_id/entries              — 列出条目
 * POST   /worldbooks/:worldbook_id/entries              — 创建条目
 * GET    /worldbooks/:worldbook_id/entries/:id           — 获取条目
 * PATCH  /worldbooks/:worldbook_id/entries/:id           — 更新条目
 * DELETE /worldbooks/:worldbook_id/entries/:id           — 删除条目
 * PATCH  /worldbooks/:worldbook_id/entries/batch/update  — 批量更新
 * POST   /worldbooks/:worldbook_id/entries/batch/delete  — 批量删除
 * PUT    /worldbooks/:worldbook_id/entries/batch/reorder — 批量重排序
 */

import { and, count, eq, inArray, like, max, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { AppDb, DatabaseConnection, DbExecutor } from "../db/client";
import { errorResponseJsonSchema } from "./schemas/common.js";
import { worldbookEntries, worldbooks } from "../db/schema";
import { parseJsonField, parseWithSchema, sendError } from "../lib/http";
import { buildListMeta, toOrderBy } from "../lib/pagination";
import { executeWithSqliteBusyRetry, ResourceBusyError } from "../lib/retry";
import { getRequestAuthContext } from "../plugins/auth.js";
import { AssetVersionService } from "../services/asset-version-service.js";
import {
  appendPromptAssetOperationLog,
  toPromptAssetOperationRef,
} from "../services/prompt-asset-operation-log.js";

// ── Zod Schemas ───────────────────────────────────────

const worldbookIdParamsSchema = z.object({
  worldbook_id: z.string().min(1),
});

const entryParamsSchema = z.object({
  worldbook_id: z.string().min(1),
  id: z.string().min(1),
});

const deleteEntryQuerySchema = z.object({
  expected_version: z.coerce.number().int().positive().optional(),
});

const createEntrySchema = z.object({
  expected_version: z.number().int().positive().optional(),
  keys: z.array(z.string()),
  content: z.string(),
  comment: z.string().optional(),
  keys_secondary: z.array(z.string()).optional(),
  selective: z.boolean().optional(),
  selective_logic: z.number().int().min(0).max(3).optional(),
  constant: z.boolean().optional(),
  position: z.number().int().min(0).max(7).optional(),
  order: z.number().int().optional(),
  depth: z.number().int().min(0).optional(),
  role: z.number().int().min(0).max(2).optional(),
  disable: z.boolean().optional(),
  scan_depth: z.number().int().min(0).nullable().optional(),
  case_sensitive: z.boolean().nullable().optional(),
  match_whole_words: z.boolean().nullable().optional(),
  exclude_recursion: z.boolean().optional(),
  prevent_recursion: z.boolean().optional(),
  delay_until_recursion: z.number().int().min(1).nullable().optional(),
  outlet_name: z.string().optional(),
});

const updateEntryFieldsShape = {
  keys: z.array(z.string()).optional(),
  content: z.string().optional(),
  comment: z.string().optional(),
  keys_secondary: z.array(z.string()).optional(),
  selective: z.boolean().optional(),
  selective_logic: z.number().int().min(0).max(3).optional(),
  constant: z.boolean().optional(),
  position: z.number().int().min(0).max(7).optional(),
  order: z.number().int().optional(),
  depth: z.number().int().min(0).optional(),
  role: z.number().int().min(0).max(2).optional(),
  disable: z.boolean().optional(),
  scan_depth: z.number().int().min(0).nullable().optional(),
  case_sensitive: z.boolean().nullable().optional(),
  match_whole_words: z.boolean().nullable().optional(),
  exclude_recursion: z.boolean().optional(),
  prevent_recursion: z.boolean().optional(),
  delay_until_recursion: z.number().int().min(1).nullable().optional(),
  outlet_name: z.string().optional(),
};

const updateEntrySchema = z
  .object({ expected_version: z.number().int().positive().optional(), ...updateEntryFieldsShape })
  .refine((value) => Object.keys(value).some((key) => key !== "expected_version"), "At least one field is required");

const listEntriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort_order: z.enum(["asc", "desc"]).default("asc"),
  sort_by: z.enum(["order", "updated_at", "uid"]).default("order"),
  disable: z.coerce.boolean().optional(),
  constant: z.coerce.boolean().optional(),
  position: z.coerce.number().int().optional(),
  q: z.string().trim().min(1).optional(),
});

const entryIdArraySchema = z
  .array(z.string().min(1))
  .min(1)
  .max(100)
  .superRefine((ids, ctx) => {
    const seen = new Map<string, number>();
    ids.forEach((id, index) => {
      const firstIndex = seen.get(id);
      if (firstIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate entry id also appears at ids.${firstIndex}`,
        });
        return;
      }
      seen.set(id, index);
    });
  });

const batchUpdateEntriesSchema = z.object({
  expected_version: z.number().int().positive().optional(),
  ids: entryIdArraySchema,
  fields: z
    .object(updateEntryFieldsShape)
    .refine((value) => Object.keys(value).length > 0, "At least one field is required"),
});

const batchDeleteEntriesSchema = z.object({
  expected_version: z.number().int().positive().optional(),
  ids: entryIdArraySchema,
});

const batchReorderEntriesSchema = z.object({
  expected_version: z.number().int().positive().optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        order: z.number().int(),
      })
    )
    .min(1)
    .max(100)
    .superRefine((items, ctx) => {
      const seen = new Map<string, number>();
      items.forEach((item, index) => {
        const firstIndex = seen.get(item.id);
        if (firstIndex !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "id"],
            message: `Duplicate entry id also appears at items.${firstIndex}`,
          });
          return;
        }
        seen.set(item.id, index);
      });
    }),
});

// ── Examples ──────────────────────────────────────────

const entryExample = {
  id: "ent_abc123",
  worldbook_id: "wb_kingdom",
  uid: 0,
  comment: "Kingdom basics",
  content: "The kingdom is vast and ancient.",
  keys: ["kingdom", "realm"],
  keys_secondary: ["history"],
  selective: true,
  selective_logic: 0,
  constant: false,
  position: 0,
  order: 100,
  depth: 4,
  role: 0,
  disable: false,
  scan_depth: null,
  case_sensitive: null,
  match_whole_words: null,
  exclude_recursion: false,
  prevent_recursion: false,
  delay_until_recursion: null,
  outlet_name: "",
  created_at: 1735689600000,
  updated_at: 1735689660000,
} as const;

const entryResponseExample = { data: entryExample } as const;

const entryListResponseExample = {
  data: [entryExample],
  meta: {
    total: 1,
    limit: 50,
    offset: 0,
    has_more: false,
    sort_by: "order",
    sort_order: "asc",
  },
} as const;

const deleteEntryResponseExample = {
  data: { id: "ent_abc123", deleted: true },
} as const;

const batchUpdateEntriesBodyExample = {
  ids: ["ent_abc123", "ent_missing"],
  fields: { disable: true },
} as const;

const batchUpdateEntriesResponseExample = {
  data: {
    results: [
      {
        index: 0,
        id: "ent_abc123",
        action: "updated",
        data: { ...entryExample, disable: true, updated_at: 1735689720000 },
      },
      { index: 1, id: "ent_missing", action: "not_found" },
    ],
    meta: { total: 2, updated: 1, not_found: 1 },
  },
} as const;

const batchDeleteEntriesBodyExample = {
  ids: ["ent_abc123", "ent_missing"],
} as const;

const batchDeleteEntriesResponseExample = {
  data: {
    results: [
      { index: 0, id: "ent_abc123", action: "deleted" },
      { index: 1, id: "ent_missing", action: "not_found" },
    ],
    meta: { total: 2, deleted: 1, not_found: 1 },
  },
} as const;

const batchReorderEntriesBodyExample = {
  items: [
    { id: "ent_abc123", order: 10 },
    { id: "ent_def456", order: 20 },
  ],
} as const;

const batchReorderEntriesResponseExample = {
  data: {
    results: [
      {
        index: 0,
        id: "ent_abc123",
        action: "updated",
        data: { ...entryExample, order: 10, updated_at: 1735689720000 },
      },
      { index: 1, id: "ent_def456", action: "not_found" },
    ],
    meta: { total: 2, updated: 1, not_found: 1 },
  },
} as const;

// ── JSON Schemas (OpenAPI) ────────────────────────────

const worldbookIdParamsJsonSchema = {
  type: "object",
  required: ["worldbook_id"],
  properties: {
    worldbook_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const entryParamsJsonSchema = {
  type: "object",
  required: ["worldbook_id", "id"],
  properties: {
    worldbook_id: { type: "string", minLength: 1 },
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const deleteEntryQueryJsonSchema = {
  type: "object",
  properties: {
    expected_version: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
} as const;

const entryFieldsJsonSchemaProperties = {
  keys: { type: "array", items: { type: "string" } },
  content: { type: "string" },
  comment: { type: "string" },
  keys_secondary: { type: "array", items: { type: "string" } },
  selective: { type: "boolean" },
  selective_logic: { type: "integer", minimum: 0, maximum: 3 },
  constant: { type: "boolean" },
  position: { type: "integer", minimum: 0, maximum: 7 },
  order: { type: "integer" },
  depth: { type: "integer", minimum: 0 },
  role: { type: "integer", minimum: 0, maximum: 2 },
  disable: { type: "boolean" },
  scan_depth: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
  case_sensitive: { anyOf: [{ type: "boolean" }, { type: "null" }] },
  match_whole_words: { anyOf: [{ type: "boolean" }, { type: "null" }] },
  exclude_recursion: { type: "boolean" },
  prevent_recursion: { type: "boolean" },
  delay_until_recursion: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
  outlet_name: { type: "string" },
} as const;

const entryJsonSchema = {
  type: "object",
  required: [
    "id", "worldbook_id", "uid", "comment", "content",
    "keys", "keys_secondary",
    "selective", "selective_logic", "constant",
    "position", "order", "depth", "role", "disable",
    "scan_depth", "case_sensitive", "match_whole_words", "exclude_recursion",
    "prevent_recursion", "delay_until_recursion", "outlet_name",
    "created_at", "updated_at",
  ],
  properties: {
    id: { type: "string" },
    worldbook_id: { type: "string" },
    uid: { type: "integer", minimum: 0 },
    ...entryFieldsJsonSchemaProperties,
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  examples: [entryExample],
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

const listEntriesQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string", enum: ["order", "updated_at", "uid"] },
    disable: { type: "boolean" },
    constant: { type: "boolean" },
    position: { type: "integer" },
    q: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const createEntryBodyJsonSchema = {
  type: "object",
  required: ["keys", "content"],
  properties: { expected_version: { type: "integer", minimum: 1 }, ...entryFieldsJsonSchemaProperties },
  additionalProperties: false,
} as const;

const updateEntryBodyJsonSchema = {
  type: "object",
  properties: { expected_version: { type: "integer", minimum: 1 }, ...entryFieldsJsonSchemaProperties },
  additionalProperties: false,
} as const;

const entryResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: entryJsonSchema },
  examples: [entryResponseExample],
  additionalProperties: false,
} as const;

const entryListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: entryJsonSchema },
    meta: listMetaJsonSchema,
  },
  examples: [entryListResponseExample],
  additionalProperties: false,
} as const;

const deleteResponseJsonSchema = {
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
  examples: [deleteEntryResponseExample],
  additionalProperties: false,
} as const;

const batchEntryIdsJsonSchema = {
  type: "array",
  minItems: 1,
  maxItems: 100,
  items: { type: "string", minLength: 1 },
} as const;

const batchUpdateEntryResultJsonSchema = {
  type: "object",
  required: ["index", "id", "action"],
  properties: {
    index: { type: "integer", minimum: 0 },
    id: { type: "string" },
    action: { type: "string", enum: ["updated", "not_found"] },
    data: entryJsonSchema,
  },
  additionalProperties: false,
} as const;

const batchUpdateEntriesMetaJsonSchema = {
  type: "object",
  required: ["total", "updated", "not_found"],
  properties: {
    total: { type: "integer", minimum: 1 },
    updated: { type: "integer", minimum: 0 },
    not_found: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const batchUpdateEntriesBodyJsonSchema = {
  type: "object",
  required: ["ids", "fields"],
  properties: {
    expected_version: { type: "integer", minimum: 1 },
    ids: batchEntryIdsJsonSchema,
    fields: {
      type: "object",
      properties: entryFieldsJsonSchemaProperties,
      additionalProperties: false,
      minProperties: 1,
    },
  },
  examples: [batchUpdateEntriesBodyExample],
  additionalProperties: false,
} as const;

const batchUpdateEntriesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results", "meta"],
      properties: {
        results: { type: "array", items: batchUpdateEntryResultJsonSchema },
        meta: batchUpdateEntriesMetaJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [batchUpdateEntriesResponseExample],
  additionalProperties: false,
} as const;

const batchDeleteEntryResultJsonSchema = {
  type: "object",
  required: ["index", "id", "action"],
  properties: {
    index: { type: "integer", minimum: 0 },
    id: { type: "string" },
    action: { type: "string", enum: ["deleted", "not_found"] },
  },
  additionalProperties: false,
} as const;

const batchDeleteEntriesMetaJsonSchema = {
  type: "object",
  required: ["total", "deleted", "not_found"],
  properties: {
    total: { type: "integer", minimum: 1 },
    deleted: { type: "integer", minimum: 0 },
    not_found: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const batchDeleteEntriesBodyJsonSchema = {
  type: "object",
  required: ["ids"],
  properties: {
    expected_version: { type: "integer", minimum: 1 },
    ids: batchEntryIdsJsonSchema,
  },
  examples: [batchDeleteEntriesBodyExample],
  additionalProperties: false,
} as const;

const batchDeleteEntriesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results", "meta"],
      properties: {
        results: { type: "array", items: batchDeleteEntryResultJsonSchema },
        meta: batchDeleteEntriesMetaJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [batchDeleteEntriesResponseExample],
  additionalProperties: false,
} as const;

const batchReorderItemJsonSchema = {
  type: "object",
  required: ["id", "order"],
  properties: {
    id: { type: "string", minLength: 1 },
    order: { type: "integer" },
  },
  additionalProperties: false,
} as const;

const batchReorderEntriesBodyJsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    expected_version: { type: "integer", minimum: 1 },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: batchReorderItemJsonSchema,
    },
  },
  examples: [batchReorderEntriesBodyExample],
  additionalProperties: false,
} as const;

const batchReorderEntriesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["results", "meta"],
      properties: {
        results: { type: "array", items: batchUpdateEntryResultJsonSchema },
        meta: batchUpdateEntriesMetaJsonSchema,
      },
      additionalProperties: false,
    },
  },
  examples: [batchReorderEntriesResponseExample],
  additionalProperties: false,
} as const;

// ── Helpers ───────────────────────────────────────────

type WorldbookMutationResult<T> =
  | { kind: "ok"; data: T; changed?: boolean }
  | { kind: "error"; statusCode: number; code: string; message: string };

class WorldbookVersionConflictError extends Error {
  constructor() {
    super("worldbook_version_conflict");
  }
}

const RESOURCE_BUSY_MESSAGE = "Resource is temporarily busy, please retry";

function loadOwnedWorldbook(db: AppDb | DbExecutor, worldbookId: string, accountId: string) {
  return db.select().from(worldbooks).where(and(eq(worldbooks.id, worldbookId), eq(worldbooks.accountId, accountId))).get();
}

function toEntryResponse(row: typeof worldbookEntries.$inferSelect) {
  return {
    id: row.id,
    worldbook_id: row.worldbookId,
    uid: row.uid,
    comment: row.comment,
    content: row.content,
    keys: parseJsonField(row.keysJson) as string[],
    keys_secondary: parseJsonField(row.keysSecondaryJson) as string[],
    selective: row.selective,
    selective_logic: row.selectiveLogic,
    constant: row.constant,
    position: row.position,
    order: row.order,
    depth: row.depth,
    role: row.role,
    disable: row.disable,
    scan_depth: row.scanDepth ?? null,
    case_sensitive: row.caseSensitive ?? null,
    match_whole_words: row.matchWholeWords ?? null,
    exclude_recursion: row.excludeRecursion,
    prevent_recursion: row.preventRecursion,
    delay_until_recursion: row.delayUntilRecursion ?? null,
    outlet_name: row.outletName,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

type EntryUpdateFields = z.infer<typeof updateEntrySchema>;

function buildEntryUpdates(
  fields: EntryUpdateFields,
  now: number
): Partial<typeof worldbookEntries.$inferInsert> {
  const updates: Partial<typeof worldbookEntries.$inferInsert> = {
    updatedAt: now,
  };

  if (fields.keys !== undefined) updates.keysJson = JSON.stringify(fields.keys);
  if (fields.content !== undefined) updates.content = fields.content;
  if (fields.comment !== undefined) updates.comment = fields.comment;
  if (fields.keys_secondary !== undefined) updates.keysSecondaryJson = JSON.stringify(fields.keys_secondary);
  if (fields.selective !== undefined) updates.selective = fields.selective;
  if (fields.selective_logic !== undefined) updates.selectiveLogic = fields.selective_logic;
  if (fields.constant !== undefined) updates.constant = fields.constant;
  if (fields.position !== undefined) updates.position = fields.position;
  if (fields.order !== undefined) updates.order = fields.order;
  if (fields.depth !== undefined) updates.depth = fields.depth;
  if (fields.role !== undefined) updates.role = fields.role;
  if (fields.disable !== undefined) updates.disable = fields.disable;
  if (fields.scan_depth !== undefined) updates.scanDepth = fields.scan_depth;
  if (fields.case_sensitive !== undefined) updates.caseSensitive = fields.case_sensitive;
  if (fields.match_whole_words !== undefined) updates.matchWholeWords = fields.match_whole_words;
  if (fields.exclude_recursion !== undefined) updates.excludeRecursion = fields.exclude_recursion;
  if (fields.prevent_recursion !== undefined) updates.preventRecursion = fields.prevent_recursion;
  if (fields.delay_until_recursion !== undefined) updates.delayUntilRecursion = fields.delay_until_recursion;
  if (fields.outlet_name !== undefined) updates.outletName = fields.outlet_name;

  return updates;
}

function bumpWorldbookVersion(
  db: AppDb | DbExecutor,
  worldbookId: string,
  accountId: string,
  expectedVersion: number,
  now: number
): boolean {
  const updateResult = db
    .update(worldbooks)
    .set({ updatedAt: now, version: expectedVersion + 1 })
    .where(and(eq(worldbooks.id, worldbookId), eq(worldbooks.accountId, accountId), eq(worldbooks.version, expectedVersion)))
    .run();

  return updateResult.changes > 0;
}

type WorldbookWriteOperationLogOptions = {
  request: FastifyRequest;
  action: string;
  metadata?: Record<string, unknown>;
  operationId?: string;
};

async function withWorldbookWriteCas<T>(
  db: AppDb,
  worldbookId: string,
  accountId: string,
  options: { expectedVersion?: number; operationLog?: WorldbookWriteOperationLogOptions },
  mutate: (tx: DbExecutor, worldbook: typeof worldbooks.$inferSelect, now: number) => WorldbookMutationResult<T>
): Promise<WorldbookMutationResult<T>> {
  try {
    return await executeWithSqliteBusyRetry(() => db.transaction((tx) => {
      const worldbook = loadOwnedWorldbook(tx, worldbookId, accountId);
      if (!worldbook) {
        return { kind: "error", statusCode: 404, code: "not_found", message: "Worldbook not found" };
      }

      if (options.expectedVersion !== undefined && worldbook.version !== options.expectedVersion) {
        return { kind: "error", statusCode: 409, code: "worldbook_conflict", message: "Worldbook has been modified by another operation" };
      }

      const now = Date.now();
      const assetVersionService = new AssetVersionService(tx);
      const beforeVersion = options.operationLog
        ? assetVersionService.getLatestWorldbookVersion(accountId, worldbook.id)
        : null;
      const beforeRef = options.operationLog
        ? toPromptAssetOperationRef("worldbook", worldbook, beforeVersion)
        : null;
      const result = mutate(tx, worldbook, now);
      if (result.kind !== "ok") {
        return result;
      }
      if (result.changed === false) {
        return result;
      }
      const nextVersion = worldbook.version + 1;
      if (!bumpWorldbookVersion(tx, worldbook.id, accountId, worldbook.version, now)) {
        throw new WorldbookVersionConflictError();
      }
      const operationId = options.operationLog ? options.operationLog.operationId ?? nanoid() : undefined;
      const afterVersion = assetVersionService.createWorldbookVersion(worldbook.id, {
        versionNo: nextVersion,
        createdByOperationId: operationId,
        createdAt: now,
      });
      if (options.operationLog) {
        const afterRow = { ...worldbook, updatedAt: now, version: nextVersion };
        appendPromptAssetOperationLog(tx, options.operationLog.request, {
          operationId,
          accountId,
          action: options.operationLog.action,
          assetKind: "worldbook",
          assetId: worldbook.id,
          beforeRef,
          afterRef: toPromptAssetOperationRef("worldbook", afterRow, afterVersion),
          metadata: options.operationLog.metadata,
          createdAt: now,
        });
      }
      return result;
    }));
  } catch (error) {
    if (error instanceof WorldbookVersionConflictError) {
      return { kind: "error", statusCode: 409, code: "worldbook_conflict", message: "Worldbook has been modified by another operation" };
    }
    if (error instanceof ResourceBusyError) {
      return { kind: "error", statusCode: 503, code: "resource_busy", message: RESOURCE_BUSY_MESSAGE };
    }
    throw error;
  }
}

// ── Route Registration ────────────────────────────────

export async function registerWorldbookEntryRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;

  // ── List entries ──────────────────────────────────

  app.get("/worldbooks/:worldbook_id/entries", {
    schema: {
      tags: ["worldbook-entries"],
      summary: "List worldbook entries",
      operationId: "listWorldbookEntries",
      params: worldbookIdParamsJsonSchema,
      querystring: listEntriesQueryJsonSchema,
      response: {
        200: entryListResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(worldbookIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const [wb] = await db
      .select({ id: worldbooks.id })
      .from(worldbooks)
      .where(and(eq(worldbooks.id, parsedParams.data.worldbook_id), eq(worldbooks.accountId, auth.accountId)));

    if (!wb) {
      return sendError(reply, 404, "not_found", "Worldbook not found");
    }

    const parsedQuery = parseWithSchema(listEntriesQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const filters = [eq(worldbookEntries.worldbookId, parsedParams.data.worldbook_id)];

    if (parsedQuery.data.disable !== undefined) {
      filters.push(eq(worldbookEntries.disable, parsedQuery.data.disable));
    }

    if (parsedQuery.data.constant !== undefined) {
      filters.push(eq(worldbookEntries.constant, parsedQuery.data.constant));
    }

    if (parsedQuery.data.position !== undefined) {
      filters.push(eq(worldbookEntries.position, parsedQuery.data.position));
    }

    if (parsedQuery.data.q !== undefined) {
      const pattern = `%${parsedQuery.data.q}%`;
      const searchCondition = or(
        like(worldbookEntries.keysJson, pattern),
        like(worldbookEntries.keysSecondaryJson, pattern),
        like(worldbookEntries.comment, pattern),
        like(worldbookEntries.content, pattern)
      );
      if (searchCondition) {
        filters.push(searchCondition);
      }
    }

    const whereClause = and(...filters);

    const sortByColumn =
      parsedQuery.data.sort_by === "updated_at"
        ? worldbookEntries.updatedAt
        : parsedQuery.data.sort_by === "uid"
          ? worldbookEntries.uid
          : worldbookEntries.order;

    const rows = await db
      .select()
      .from(worldbookEntries)
      .where(whereClause)
      .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
      .limit(parsedQuery.data.limit)
      .offset(parsedQuery.data.offset);

    const totalRows = await db
      .select({ total: count() })
      .from(worldbookEntries)
      .where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toEntryResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  // ── Create entry ─────────────────────────────────

  app.post("/worldbooks/:worldbook_id/entries", {
    schema: {
      tags: ["worldbook-entries"],
      summary: "Create worldbook entry",
      operationId: "createWorldbookEntry",
      params: worldbookIdParamsJsonSchema,
      body: createEntryBodyJsonSchema,
      response: {
        201: entryResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(worldbookIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const parsedBody = parseWithSchema(createEntrySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const mutation = await withWorldbookWriteCas(
      db,
      parsedParams.data.worldbook_id,
      auth.accountId,
      {
        expectedVersion: parsedBody.data.expected_version,
        operationLog: {
          request,
          action: "create_worldbook_entry",
          metadata: {
            route: "POST /worldbooks/:worldbook_id/entries",
            request_fields: Object.keys(parsedBody.data).sort(),
          },
        },
      },
      (tx, worldbook, now) => {
        const maxUidRow = tx
          .select({ maxUid: max(worldbookEntries.uid) })
          .from(worldbookEntries)
          .where(eq(worldbookEntries.worldbookId, worldbook.id))
          .get();

        const nextUid = (maxUidRow?.maxUid ?? -1) + 1;
        const [created] = tx
          .insert(worldbookEntries)
          .values({
            id: nanoid(),
            worldbookId: worldbook.id,
            uid: nextUid,
            comment: parsedBody.data.comment ?? "",
            content: parsedBody.data.content,
            keysJson: JSON.stringify(parsedBody.data.keys),
            keysSecondaryJson: JSON.stringify(parsedBody.data.keys_secondary ?? []),
            selective: parsedBody.data.selective ?? true,
            selectiveLogic: parsedBody.data.selective_logic ?? 0,
            constant: parsedBody.data.constant ?? false,
            position: parsedBody.data.position ?? 0,
            order: parsedBody.data.order ?? 100,
            depth: parsedBody.data.depth ?? 4,
            role: parsedBody.data.role ?? 0,
            disable: parsedBody.data.disable ?? false,
            scanDepth: parsedBody.data.scan_depth ?? null,
            caseSensitive: parsedBody.data.case_sensitive ?? null,
            matchWholeWords: parsedBody.data.match_whole_words ?? null,
            excludeRecursion: parsedBody.data.exclude_recursion ?? false,
            preventRecursion: parsedBody.data.prevent_recursion ?? false,
            delayUntilRecursion: parsedBody.data.delay_until_recursion ?? null,
            outletName: parsedBody.data.outlet_name ?? "",
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .all();

        if (!created) {
          return { kind: "error", statusCode: 500, code: "internal_error", message: "Failed to create entry" };
        }

        return { kind: "ok", data: toEntryResponse(created) };
      }
    );

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.code(201).send({ data: mutation.data });
  });

  // ── Batch update ─────────────────────────────────

  app.patch("/worldbooks/:worldbook_id/entries/batch/update", {
    schema: {
      tags: ["worldbook-entries"],
      summary: "Batch update worldbook entries",
      operationId: "batchUpdateWorldbookEntries",
      params: worldbookIdParamsJsonSchema,
      body: batchUpdateEntriesBodyJsonSchema,
      response: {
        200: batchUpdateEntriesResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(worldbookIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const parsedBody = parseWithSchema(batchUpdateEntriesSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const bodyFields = parsedBody.data.fields;
    const mutation = await withWorldbookWriteCas(db, parsedParams.data.worldbook_id, auth.accountId, {
      expectedVersion: parsedBody.data.expected_version,
      operationLog: {
        request,
        action: "batch_update_worldbook_entries",
        metadata: {
          route: "PATCH /worldbooks/:worldbook_id/entries/batch/update",
          request_fields: Object.keys(parsedBody.data).sort(),
          field_names: Object.keys(bodyFields).sort(),
          entry_count: parsedBody.data.ids.length,
        },
      },
    }, (tx, worldbook, now) => {
      const updates = buildEntryUpdates(bodyFields, now);
      const updatedRows = tx
        .update(worldbookEntries)
        .set(updates)
        .where(and(inArray(worldbookEntries.id, parsedBody.data.ids), eq(worldbookEntries.worldbookId, worldbook.id)))
        .returning()
        .all();

      const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
      const results = parsedBody.data.ids.map((id, index) => {
        const row = updatedById.get(id);
        if (!row) {
          return { index, id, action: "not_found" as const };
        }
        return { index, id, action: "updated" as const, data: toEntryResponse(row) };
      });

      return {
        kind: "ok",
        changed: updatedRows.length > 0,
        data: {
          results,
          meta: {
            total: results.length,
            updated: updatedRows.length,
            not_found: results.length - updatedRows.length,
          },
        },
      };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({ data: mutation.data });
  });

  // ── Batch delete ─────────────────────────────────

  app.post("/worldbooks/:worldbook_id/entries/batch/delete", {
    schema: {
      tags: ["worldbook-entries"],
      summary: "Batch delete worldbook entries",
      operationId: "batchDeleteWorldbookEntries",
      params: worldbookIdParamsJsonSchema,
      body: batchDeleteEntriesBodyJsonSchema,
      response: {
        200: batchDeleteEntriesResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(worldbookIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const parsedBody = parseWithSchema(batchDeleteEntriesSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const mutation = await withWorldbookWriteCas(db, parsedParams.data.worldbook_id, auth.accountId, {
      expectedVersion: parsedBody.data.expected_version,
      operationLog: {
        request,
        action: "batch_delete_worldbook_entries",
        metadata: {
          route: "POST /worldbooks/:worldbook_id/entries/batch/delete",
          request_fields: Object.keys(parsedBody.data).sort(),
          entry_count: parsedBody.data.ids.length,
        },
      },
    }, (tx, worldbook) => {
      const deletedRows = tx
        .delete(worldbookEntries)
        .where(and(inArray(worldbookEntries.id, parsedBody.data.ids), eq(worldbookEntries.worldbookId, worldbook.id)))
        .returning()
        .all();

      const deletedIds = new Set(deletedRows.map((row) => row.id));
      const results = parsedBody.data.ids.map((id, index) => ({
        index,
        id,
        action: deletedIds.has(id) ? ("deleted" as const) : ("not_found" as const),
      }));

      return {
        kind: "ok",
        changed: deletedRows.length > 0,
        data: {
          results,
          meta: {
            total: results.length,
            deleted: deletedRows.length,
            not_found: results.length - deletedRows.length,
          },
        },
      };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({ data: mutation.data });
  });

  // ── Batch reorder ────────────────────────────────

  app.put("/worldbooks/:worldbook_id/entries/batch/reorder", {
    schema: {
      tags: ["worldbook-entries"],
      summary: "Batch reorder worldbook entries",
      operationId: "batchReorderWorldbookEntries",
      params: worldbookIdParamsJsonSchema,
      body: batchReorderEntriesBodyJsonSchema,
      response: {
        200: batchReorderEntriesResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(worldbookIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const parsedBody = parseWithSchema(batchReorderEntriesSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const mutation = await withWorldbookWriteCas(db, parsedParams.data.worldbook_id, auth.accountId, {
      expectedVersion: parsedBody.data.expected_version,
      operationLog: {
        request,
        action: "reorder_worldbook_entries",
        metadata: {
          route: "PUT /worldbooks/:worldbook_id/entries/batch/reorder",
          request_fields: Object.keys(parsedBody.data).sort(),
          entry_count: parsedBody.data.items.length,
        },
      },
    }, (tx, worldbook, now) => {
      let updated = 0;
      const results = parsedBody.data.items.map((item, index) => {
        const existing = tx
          .select()
          .from(worldbookEntries)
          .where(and(eq(worldbookEntries.id, item.id), eq(worldbookEntries.worldbookId, worldbook.id)))
          .get();

        if (!existing) {
          return { index, id: item.id, action: "not_found" as const };
        }

        tx.update(worldbookEntries)
          .set({ order: item.order, updatedAt: now })
          .where(eq(worldbookEntries.id, item.id))
          .run();

        updated += 1;
        return {
          index,
          id: item.id,
          action: "updated" as const,
          data: toEntryResponse({ ...existing, order: item.order, updatedAt: now }),
        };
      });

      return {
        kind: "ok",
        changed: updated > 0,
        data: {
          results,
          meta: {
            total: results.length,
            updated,
            not_found: results.length - updated,
          },
        },
      };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({ data: mutation.data });
  });

  // ── Get entry ────────────────────────────────────

  app.get("/worldbooks/:worldbook_id/entries/:id", {
    schema: {
      tags: ["worldbook-entries"],
      summary: "Get worldbook entry",
      operationId: "getWorldbookEntry",
      params: entryParamsJsonSchema,
      response: {
        200: entryResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(entryParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const [wb] = await db
      .select({ id: worldbooks.id })
      .from(worldbooks)
      .where(and(eq(worldbooks.id, parsedParams.data.worldbook_id), eq(worldbooks.accountId, auth.accountId)));

    if (!wb) {
      return sendError(reply, 404, "not_found", "Worldbook not found");
    }

    const [row] = await db
      .select()
      .from(worldbookEntries)
      .where(
        and(
          eq(worldbookEntries.id, parsedParams.data.id),
          eq(worldbookEntries.worldbookId, parsedParams.data.worldbook_id)
        )
      );

    if (!row) {
      return sendError(reply, 404, "not_found", "Worldbook entry not found");
    }

    return reply.send({ data: toEntryResponse(row) });
  });

  // ── Update entry ─────────────────────────────────

  app.patch("/worldbooks/:worldbook_id/entries/:id", {
    schema: {
      tags: ["worldbook-entries"],
      summary: "Update worldbook entry",
      operationId: "updateWorldbookEntry",
      params: entryParamsJsonSchema,
      body: updateEntryBodyJsonSchema,
      response: {
        200: entryResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(entryParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const parsedBody = parseWithSchema(updateEntrySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const mutation = await withWorldbookWriteCas(db, parsedParams.data.worldbook_id, auth.accountId, {
      expectedVersion: parsedBody.data.expected_version,
      operationLog: {
        request,
        action: "update_worldbook_entry",
        metadata: {
          route: "PATCH /worldbooks/:worldbook_id/entries/:id",
          request_fields: Object.keys(parsedBody.data).sort(),
          entry_id: parsedParams.data.id,
        },
      },
    }, (tx, worldbook, now) => {
      const updates = buildEntryUpdates(parsedBody.data, now);
      const [updated] = tx
        .update(worldbookEntries)
        .set(updates)
        .where(and(eq(worldbookEntries.id, parsedParams.data.id), eq(worldbookEntries.worldbookId, worldbook.id)))
        .returning()
        .all();

      if (!updated) {
        return { kind: "error", statusCode: 404, code: "not_found", message: "Worldbook entry not found" };
      }

      return { kind: "ok", data: toEntryResponse(updated) };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({ data: mutation.data });
  });

  // ── Delete entry ─────────────────────────────────

  app.delete("/worldbooks/:worldbook_id/entries/:id", {
    schema: {
      tags: ["worldbook-entries"],
      summary: "Delete worldbook entry",
      operationId: "deleteWorldbookEntry",
      params: entryParamsJsonSchema,
      querystring: deleteEntryQueryJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(entryParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    const parsedQuery = parseWithSchema(deleteEntryQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    const mutation = await withWorldbookWriteCas(db, parsedParams.data.worldbook_id, auth.accountId, {
      expectedVersion: parsedQuery.data.expected_version,
      operationLog: {
        request,
        action: "delete_worldbook_entry",
        metadata: {
          route: "DELETE /worldbooks/:worldbook_id/entries/:id",
          query_fields: Object.keys(parsedQuery.data).sort(),
          entry_id: parsedParams.data.id,
        },
      },
    }, (tx, worldbook) => {
      const deleted = tx
        .delete(worldbookEntries)
        .where(and(eq(worldbookEntries.id, parsedParams.data.id), eq(worldbookEntries.worldbookId, worldbook.id)))
        .returning()
        .all();

      if (deleted.length === 0) {
        return { kind: "error", statusCode: 404, code: "not_found", message: "Worldbook entry not found" };
      }

      return { kind: "ok", data: { id: parsedParams.data.id, deleted: true } };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({ data: mutation.data });
  });
}
