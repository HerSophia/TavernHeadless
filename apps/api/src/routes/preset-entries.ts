/**
 * Preset Entry Routes
 *
 * 预设提示词条目管理路由：CRUD + 批量操作。
 * 存储层不变（preset.data_json），通过 read-modify-write 模式操作。
 *
 * GET    /presets/:preset_id/entries                    — 列出条目
 * POST   /presets/:preset_id/entries                    — 创建条目
 * GET    /presets/:preset_id/entries/:identifier         — 获取条目
 * PATCH  /presets/:preset_id/entries/:identifier         — 更新条目
 * DELETE /presets/:preset_id/entries/:identifier         — 删除条目
 * PUT    /presets/:preset_id/entries/reorder             — 重排序
 * PATCH  /presets/:preset_id/entries/batch/update        — 批量更新
 * POST   /presets/:preset_id/entries/batch/delete        — 批量删除
 */

import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { parsePreset } from "@tavern/adapters-sillytavern";

import type { AppDb, DatabaseConnection, DbExecutor } from "../db/client.js";
import { presets } from "../db/schema.js";
import { errorResponseJsonSchema } from "./schemas/common.js";
import { parseWithSchema, sendError, parseJsonField } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  type JsonRecord,
  type PresetEditorEntry,
  findPromptInRaw,
  addPromptToRaw,
  removePromptFromRaw,
  removePromptsFromRaw,
  updatePromptFieldsInRaw,
  reorderPromptsInRaw,
  getEditorEntryFromRaw,
  getAllEditorEntriesFromRaw,
  normalizeStoredPreset,
} from "../lib/preset-utils.js";

// ── Zod Schemas ───────────────────────────────────────

const presetIdParamsSchema = z.object({
  preset_id: z.string().min(1),
});

const entryParamsSchema = z.object({
  preset_id: z.string().min(1),
  identifier: z.string().min(1),
});

const listEntriesQuerySchema = z.object({
  enabled: z.enum(["true", "false"]).optional(),
  marker: z.enum(["true", "false"]).optional(),
});

const createEntrySchema = z.object({
  identifier: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().default(""),
  role: z.enum(["assistant", "system", "user"]).default("system"),
  content: z.string().default(""),
  system_prompt: z.boolean().default(false),
  marker: z.boolean().default(false),
  injection_position: z.number().int().default(0),
  injection_depth: z.number().int().optional(),
  injection_order: z.number().int().optional(),
  forbid_overrides: z.boolean().optional(),
  injection_trigger: z.array(z.unknown()).optional(),
  enabled: z.boolean().default(true),
  extra: z.record(z.unknown()).default({}),
});

const updateEntryFieldsShape = {
  name: z.string().optional(),
  role: z.enum(["assistant", "system", "user"]).optional(),
  content: z.string().optional(),
  system_prompt: z.boolean().optional(),
  marker: z.boolean().optional(),
  injection_position: z.number().int().optional(),
  injection_depth: z.number().int().optional(),
  injection_order: z.number().int().optional(),
  forbid_overrides: z.boolean().optional(),
  injection_trigger: z.array(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  extra: z.record(z.unknown()).optional(),
};

const updateEntrySchema = z
  .object(updateEntryFieldsShape)
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const reorderEntriesSchema = z.object({
  identifiers: z.array(z.string().min(1)).min(1),
});

const batchUpdateSchema = z.object({
  identifiers: z.array(z.string().min(1)).min(1),
  fields: z.object(updateEntryFieldsShape)
    .refine((value) => Object.keys(value).length > 0, "At least one field is required"),
});

const batchDeleteSchema = z.object({
  identifiers: z.array(z.string().min(1)).min(1),
});

// ── JSON Schemas (OpenAPI) ────────────────────────────

const presetIdParamsJsonSchema = {
  type: "object" as const,
  required: ["preset_id"],
  properties: {
    preset_id: { type: "string" as const },
  },
  additionalProperties: false,
};

const entryParamsJsonSchema = {
  type: "object" as const,
  required: ["preset_id", "identifier"],
  properties: {
    preset_id: { type: "string" as const },
    identifier: { type: "string" as const },
  },
  additionalProperties: false,
};

const entryObjectJsonSchema = {
  type: "object" as const,
  properties: {
    identifier: { type: "string" as const },
    name: { type: "string" as const },
    role: { type: "string" as const, enum: ["assistant", "system", "user"] },
    content: { type: "string" as const },
    system_prompt: { type: "boolean" as const },
    marker: { type: "boolean" as const },
    injection_position: { type: "integer" as const },
    injection_depth: { type: "integer" as const },
    injection_order: { type: "integer" as const },
    forbid_overrides: { type: "boolean" as const },
    injection_trigger: { type: "array" as const, items: {} },
    enabled: { type: "boolean" as const },
    extra: { type: "object" as const, additionalProperties: true },
  },
  additionalProperties: false,
};

const entryListResponseJsonSchema = {
  type: "object" as const,
  required: ["data"],
  properties: {
    data: {
      type: "object" as const,
      properties: {
        preset_id: { type: "string" as const },
        default_character_id: { type: "integer" as const },
        entries: { type: "array" as const, items: entryObjectJsonSchema },
      },
    },
  },
  additionalProperties: false,
};

const singleEntryResponseJsonSchema = {
  type: "object" as const,
  required: ["data"],
  properties: {
    data: entryObjectJsonSchema,
  },
  additionalProperties: false,
};

const deleteEntryResponseJsonSchema = {
  type: "object" as const,
  required: ["data"],
  properties: {
    data: {
      type: "object" as const,
      properties: {
        identifier: { type: "string" as const },
        deleted: { type: "boolean" as const },
      },
    },
  },
  additionalProperties: false,
};

const createEntryBodyJsonSchema = {
  type: "object" as const,
  required: ["identifier"],
  properties: {
    identifier: { type: "string" as const, minLength: 1, maxLength: 64, pattern: "^[a-zA-Z0-9_-]+$" },
    name: { type: "string" as const },
    role: { type: "string" as const, enum: ["assistant", "system", "user"] },
    content: { type: "string" as const },
    system_prompt: { type: "boolean" as const },
    marker: { type: "boolean" as const },
    injection_position: { type: "integer" as const },
    injection_depth: { type: "integer" as const },
    injection_order: { type: "integer" as const },
    forbid_overrides: { type: "boolean" as const },
    injection_trigger: { type: "array" as const, items: {} },
    enabled: { type: "boolean" as const },
    extra: { type: "object" as const, additionalProperties: true },
  },
  additionalProperties: false,
};

const updateEntryBodyJsonSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const },
    role: { type: "string" as const, enum: ["assistant", "system", "user"] },
    content: { type: "string" as const },
    system_prompt: { type: "boolean" as const },
    marker: { type: "boolean" as const },
    injection_position: { type: "integer" as const },
    injection_depth: { type: "integer" as const },
    injection_order: { type: "integer" as const },
    forbid_overrides: { type: "boolean" as const },
    injection_trigger: { type: "array" as const, items: {} },
    enabled: { type: "boolean" as const },
    extra: { type: "object" as const, additionalProperties: true },
  },
  additionalProperties: false,
};

const reorderBodyJsonSchema = {
  type: "object" as const,
  required: ["identifiers"],
  properties: {
    identifiers: { type: "array" as const, items: { type: "string" as const }, minItems: 1 },
  },
  additionalProperties: false,
};

const batchUpdateBodyJsonSchema = {
  type: "object" as const,
  required: ["identifiers", "fields"],
  properties: {
    identifiers: { type: "array" as const, items: { type: "string" as const }, minItems: 1 },
    fields: { type: "object" as const, additionalProperties: true },
  },
  additionalProperties: false,
};

const batchDeleteBodyJsonSchema = {
  type: "object" as const,
  required: ["identifiers"],
  properties: {
    identifiers: { type: "array" as const, items: { type: "string" as const }, minItems: 1 },
  },
  additionalProperties: false,
};

const batchResultJsonSchema = {
  type: "object" as const,
  required: ["data"],
  properties: {
    data: {
      type: "object" as const,
      properties: {
        results: { type: "array" as const, items: { type: "object" as const, additionalProperties: true } },
        meta: { type: "object" as const, additionalProperties: true },
      },
    },
  },
  additionalProperties: false,
};

// ── Helpers ───────────────────────────────────────────

type PresetMutationResult<T> =
  | { kind: "ok"; data: T; changed?: boolean }
  | { kind: "error"; statusCode: number; code: string; message: string };

class PresetVersionConflictError extends Error {
  constructor() {
    super("preset_version_conflict");
  }
}

function loadPresetRaw(
  db: AppDb | DbExecutor,
  presetId: string,
  accountId: string
): { row: typeof presets.$inferSelect; raw: JsonRecord } | null {
  const [row] = db
    .select()
    .from(presets)
    .where(and(eq(presets.id, presetId), eq(presets.accountId, accountId)))
    .all();

  if (!row) return null;

  const normalized = normalizeStoredPreset(parseJsonField(row.dataJson));
  return { row, raw: normalized.raw };
}

function savePresetRaw(
  db: AppDb | DbExecutor,
  presetId: string,
  accountId: string,
  raw: JsonRecord,
  now: number,
  expectedVersion: number
): boolean {
  const updateResult = db.update(presets)
    .set({ dataJson: JSON.stringify(raw), updatedAt: now, version: expectedVersion + 1 })
    .where(and(eq(presets.id, presetId), eq(presets.accountId, accountId), eq(presets.version, expectedVersion)))
    .run();

  return updateResult.changes > 0;
}

function validateRawPreset(raw: JsonRecord): string | null {
  try {
    parsePreset(raw);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function buildEntryResponseFromRaw(raw: JsonRecord, identifier: string): PresetEditorEntry | null {
  return getEditorEntryFromRaw(raw, identifier);
}

function withPresetWriteCas<T>(
  db: AppDb,
  presetId: string,
  accountId: string,
  mutate: (state: { row: typeof presets.$inferSelect; raw: JsonRecord }) => PresetMutationResult<T>
): PresetMutationResult<T> {
  try {
    return db.transaction((tx) => {
      const loaded = loadPresetRaw(tx, presetId, accountId);
      if (!loaded) {
        return { kind: "error", statusCode: 404, code: "not_found", message: "Preset not found" };
      }

      const result = mutate(loaded);
      if (result.kind !== "ok") {
        return result;
      }

      if (result.changed === false) {
        return result;
      }

      const persisted = savePresetRaw(tx, loaded.row.id, accountId, loaded.raw, Date.now(), loaded.row.version);
      if (!persisted) {
        throw new PresetVersionConflictError();
      }

      return result;
    });
  } catch (error) {
    if (error instanceof PresetVersionConflictError) {
      return { kind: "error", statusCode: 409, code: "preset_conflict", message: "Preset has been modified by another operation" };
    }
    throw error;
  }
}

// ── Route Registration ────────────────────────────────

export async function registerPresetEntryRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;

  // ── List entries ──────────────────────────────────

  app.get("/presets/:preset_id/entries", {
    schema: {
      tags: ["preset-entries"],
      summary: "List preset prompt entries",
      operationId: "listPresetEntries",
      params: presetIdParamsJsonSchema,
      response: {
        200: entryListResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(presetIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(listEntriesQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    const loaded = loadPresetRaw(db, parsedParams.data.preset_id, auth.accountId);
    if (!loaded) {
      return sendError(reply, 404, "not_found", "Preset not found");
    }

    const { entries, defaultCharacterId } = getAllEditorEntriesFromRaw(loaded.raw);

    let filtered = entries;
    if (parsedQuery.data.enabled !== undefined) {
      const wantEnabled = parsedQuery.data.enabled === "true";
      filtered = filtered.filter((e) => e.enabled === wantEnabled);
    }
    if (parsedQuery.data.marker !== undefined) {
      const wantMarker = parsedQuery.data.marker === "true";
      filtered = filtered.filter((e) => e.marker === wantMarker);
    }

    return reply.send({
      data: {
        preset_id: loaded.row.id,
        default_character_id: defaultCharacterId,
        entries: filtered,
      },
    });
  });

  // ── Create entry ─────────────────────────────────

  app.post("/presets/:preset_id/entries", {
    schema: {
      tags: ["preset-entries"],
      summary: "Create preset prompt entry",
      operationId: "createPresetEntry",
      params: presetIdParamsJsonSchema,
      body: createEntryBodyJsonSchema,
      response: {
        201: singleEntryResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(presetIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(createEntrySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const mutation = withPresetWriteCas(db, parsedParams.data.preset_id, auth.accountId, (loaded) => {
      const { raw } = loaded;
      const identifier = parsedBody.data.identifier;

      if (findPromptInRaw(raw, identifier)) {
        return {
          kind: "error",
          statusCode: 409,
          code: "identifier_conflict",
          message: `Prompt with identifier '${identifier}' already exists`,
        };
      }

      const promptData: JsonRecord = {
        ...parsedBody.data.extra,
        identifier,
        name: parsedBody.data.name,
        role: parsedBody.data.role,
        content: parsedBody.data.content,
        system_prompt: parsedBody.data.system_prompt,
        marker: parsedBody.data.marker,
        injection_position: parsedBody.data.injection_position,
        enabled: parsedBody.data.enabled,
      };
      if (parsedBody.data.injection_depth !== undefined) {
        promptData.injection_depth = parsedBody.data.injection_depth;
      }
      if (parsedBody.data.injection_order !== undefined) {
        promptData.injection_order = parsedBody.data.injection_order;
      }
      if (parsedBody.data.forbid_overrides !== undefined) {
        promptData.forbid_overrides = parsedBody.data.forbid_overrides;
      }
      if (parsedBody.data.injection_trigger !== undefined) {
        promptData.injection_trigger = parsedBody.data.injection_trigger;
      }

      addPromptToRaw(raw, promptData, parsedBody.data.enabled);

      const validationError = validateRawPreset(raw);
      if (validationError) {
        return { kind: "error", statusCode: 400, code: "preset_validation_error", message: validationError };
      }

      const entry = buildEntryResponseFromRaw(raw, identifier);
      if (!entry) {
        return { kind: "error", statusCode: 500, code: "internal_error", message: "Failed to build preset entry response" };
      }

      return { kind: "ok", data: entry };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.code(201).send({ data: mutation.data });
  });

  // ── Get entry ────────────────────────────────────

  app.get("/presets/:preset_id/entries/:identifier", {
    schema: {
      tags: ["preset-entries"],
      summary: "Get preset prompt entry",
      operationId: "getPresetEntry",
      params: entryParamsJsonSchema,
      response: {
        200: singleEntryResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(entryParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const loaded = loadPresetRaw(db, parsedParams.data.preset_id, auth.accountId);
    if (!loaded) {
      return sendError(reply, 404, "not_found", "Preset not found");
    }

    const entry = getEditorEntryFromRaw(loaded.raw, parsedParams.data.identifier);
    if (!entry) {
      return sendError(reply, 404, "entry_not_found", `Entry '${parsedParams.data.identifier}' not found`);
    }

    return reply.send({ data: entry });
  });

  // ── Update entry ─────────────────────────────────

  app.patch("/presets/:preset_id/entries/:identifier", {
    schema: {
      tags: ["preset-entries"],
      summary: "Update preset prompt entry",
      operationId: "updatePresetEntry",
      params: entryParamsJsonSchema,
      body: updateEntryBodyJsonSchema,
      response: {
        200: singleEntryResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(entryParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(updateEntrySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const identifier = parsedParams.data.identifier;
    const body = parsedBody.data;

    const mutation = withPresetWriteCas(db, parsedParams.data.preset_id, auth.accountId, ({ raw }) => {
      const fields: JsonRecord = {};
      if (body.name !== undefined) fields.name = body.name;
      if (body.role !== undefined) fields.role = body.role;
      if (body.content !== undefined) fields.content = body.content;
      if (body.system_prompt !== undefined) fields.system_prompt = body.system_prompt;
      if (body.marker !== undefined) fields.marker = body.marker;
      if (body.injection_position !== undefined) fields.injection_position = body.injection_position;
      if (body.injection_depth !== undefined) fields.injection_depth = body.injection_depth;
      if (body.injection_order !== undefined) fields.injection_order = body.injection_order;
      if (body.forbid_overrides !== undefined) fields.forbid_overrides = body.forbid_overrides;
      if (body.injection_trigger !== undefined) fields.injection_trigger = body.injection_trigger;
      if (body.enabled !== undefined) fields.enabled = body.enabled;
      if (body.extra !== undefined) {
        Object.assign(fields, body.extra);
      }

      const updated = updatePromptFieldsInRaw(raw, identifier, fields);
      if (!updated) {
        return { kind: "error", statusCode: 404, code: "entry_not_found", message: `Entry '${identifier}' not found` };
      }

      const validationError = validateRawPreset(raw);
      if (validationError) {
        return { kind: "error", statusCode: 400, code: "preset_validation_error", message: validationError };
      }

      const entry = buildEntryResponseFromRaw(raw, identifier);
      if (!entry) {
        return { kind: "error", statusCode: 500, code: "internal_error", message: "Failed to build preset entry response" };
      }

      return { kind: "ok", data: entry };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({ data: mutation.data });
  });

  // ── Delete entry ─────────────────────────────────

  app.delete("/presets/:preset_id/entries/:identifier", {
    schema: {
      tags: ["preset-entries"],
      summary: "Delete preset prompt entry",
      operationId: "deletePresetEntry",
      params: entryParamsJsonSchema,
      response: {
        200: deleteEntryResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(entryParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const identifier = parsedParams.data.identifier;

    const mutation = withPresetWriteCas(db, parsedParams.data.preset_id, auth.accountId, ({ raw }) => {
      const removed = removePromptFromRaw(raw, identifier);
      if (!removed) {
        return { kind: "error", statusCode: 404, code: "entry_not_found", message: `Entry '${identifier}' not found` };
      }

      return { kind: "ok", data: { identifier, deleted: true } };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({ data: mutation.data });
  });

  // ── Reorder entries ──────────────────────────────

  app.put("/presets/:preset_id/entries/reorder", {
    schema: {
      tags: ["preset-entries"],
      summary: "Reorder preset prompt entries",
      operationId: "reorderPresetEntries",
      params: presetIdParamsJsonSchema,
      body: reorderBodyJsonSchema,
      response: {
        200: entryListResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(presetIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(reorderEntriesSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);

    const mutation = withPresetWriteCas(db, parsedParams.data.preset_id, auth.accountId, ({ row, raw }) => {
      reorderPromptsInRaw(raw, parsedBody.data.identifiers);

      const validationError = validateRawPreset(raw);
      if (validationError) {
        return { kind: "error", statusCode: 400, code: "preset_validation_error", message: validationError };
      }

      const { entries, defaultCharacterId } = getAllEditorEntriesFromRaw(raw);
      return {
        kind: "ok",
        data: {
          preset_id: row.id,
          default_character_id: defaultCharacterId,
          entries,
        },
      };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({ data: mutation.data });
  });

  // ── Batch update ─────────────────────────────────

  app.patch("/presets/:preset_id/entries/batch/update", {
    schema: {
      tags: ["preset-entries"],
      summary: "Batch update preset prompt entries",
      operationId: "batchUpdatePresetEntries",
      params: presetIdParamsJsonSchema,
      body: batchUpdateBodyJsonSchema,
      response: {
        200: batchResultJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(presetIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(batchUpdateSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const bodyFields = parsedBody.data.fields;
    const mutation = withPresetWriteCas(db, parsedParams.data.preset_id, auth.accountId, ({ raw }) => {
      const fields: JsonRecord = {};
      if (bodyFields.name !== undefined) fields.name = bodyFields.name;
      if (bodyFields.role !== undefined) fields.role = bodyFields.role;
      if (bodyFields.content !== undefined) fields.content = bodyFields.content;
      if (bodyFields.system_prompt !== undefined) fields.system_prompt = bodyFields.system_prompt;
      if (bodyFields.marker !== undefined) fields.marker = bodyFields.marker;
      if (bodyFields.injection_position !== undefined) fields.injection_position = bodyFields.injection_position;
      if (bodyFields.injection_depth !== undefined) fields.injection_depth = bodyFields.injection_depth;
      if (bodyFields.injection_order !== undefined) fields.injection_order = bodyFields.injection_order;
      if (bodyFields.forbid_overrides !== undefined) fields.forbid_overrides = bodyFields.forbid_overrides;
      if (bodyFields.injection_trigger !== undefined) fields.injection_trigger = bodyFields.injection_trigger;
      if (bodyFields.enabled !== undefined) fields.enabled = bodyFields.enabled;
      if (bodyFields.extra !== undefined) Object.assign(fields, bodyFields.extra);

      let updated = 0;
      const results = parsedBody.data.identifiers.map((identifier, index) => {
        const result = updatePromptFieldsInRaw(raw, identifier, { ...fields });
        if (result) {
          updated++;
          const entry = buildEntryResponseFromRaw(raw, identifier);
          return { index, identifier, action: "updated" as const, data: entry };
        }
        return { index, identifier, action: "not_found" as const };
      });

      const validationError = validateRawPreset(raw);
      if (validationError) {
        return { kind: "error", statusCode: 400, code: "preset_validation_error", message: validationError };
      }

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

  // ── Batch delete ─────────────────────────────────

  app.post("/presets/:preset_id/entries/batch/delete", {
    schema: {
      tags: ["preset-entries"],
      summary: "Batch delete preset prompt entries",
      operationId: "batchDeletePresetEntries",
      params: presetIdParamsJsonSchema,
      body: batchDeleteBodyJsonSchema,
      response: {
        200: batchResultJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(presetIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(batchDeleteSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);

    const mutation = withPresetWriteCas(db, parsedParams.data.preset_id, auth.accountId, ({ raw }) => {
      const removedSet = new Set(removePromptsFromRaw(raw, parsedBody.data.identifiers));

      const results = parsedBody.data.identifiers.map((identifier, index) => {
        if (removedSet.has(identifier)) {
          return { index, identifier, action: "deleted" as const };
        }
        return { index, identifier, action: "not_found" as const };
      });

      return {
        kind: "ok",
        changed: removedSet.size > 0,
        data: {
          results,
          meta: {
            total: results.length,
            deleted: removedSet.size,
            not_found: results.length - removedSet.size,
          },
        },
      };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({ data: mutation.data });
  });
}
