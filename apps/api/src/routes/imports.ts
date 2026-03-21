/**
 * Import Routes
 *
 * SillyTavern 资源导入路由 + 导入资源的 CRUD。
 *
 * POST /import/preset     — 导入酒馆预设
 * POST /import/worldbook  — 导入酒馆世界书
 * POST /import/regex      — 导入酒馆正则脚本
 * POST /import/character  — 导入酒馆角色卡
 *
 * GET    /presets          — 列出所有预设
 * GET    /presets/:id      — 获取预设详情（原始）
 * GET    /presets/:id/editor — 获取预设编辑模型
 * PUT    /presets/:id      — 同 ID 更新预设
 * DELETE /presets/:id      — 删除预设
 *
 * GET    /worldbooks       — 列出所有世界书
 * GET    /worldbooks/:id   — 获取世界书详情
 * PUT    /worldbooks/:id   — 同 ID 更新世界书
 * DELETE /worldbooks/:id   — 删除世界书
 *
 * GET    /regex-profiles       — 列出所有正则配置
 * GET    /regex-profiles/:id   — 获取正则配置详情
 * DELETE /regex-profiles/:id   — 删除正则配置
 */

import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { SimpleTokenCounter } from "@tavern/core";
import { z } from "zod";

import {
  parsePreset,
  parseWorldBook,
  parseRegexScripts,
  parseCharacterCard,
  type STCharacterCard,
} from "@tavern/adapters-sillytavern";

import type { DatabaseConnection } from "../db/client.js";
import {
  presets,
  worldbooks,
  regexProfiles,
  sessions,
  floors,
  messagePages,
  messages,
  characters,
  characterVersions,
} from "../db/schema.js";
import { parseWithSchema, sendError, parseJsonField, stringifyJsonField } from "../lib/http.js";

// ── Zod Schemas ───────────────────────────────────────

const importPresetSchema = z.object({
  /** 自定义名称（可选） */
  name: z.string().optional(),
  /** 原始酒馆预设 JSON */
  data: z.record(z.unknown()),
});

const importWorldbookSchema = z.object({
  /** 自定义名称（可选） */
  name: z.string().optional(),
  /** 原始酒馆世界书 JSON */
  data: z.record(z.unknown()),
});

const importRegexSchema = z.object({
  /** 名称（正则脚本无自带名称，必须提供） */
  name: z.string().min(1, "Name is required for regex profile"),
  /** 原始酒馆正则脚本 JSON 数组 */
  data: z.array(z.record(z.unknown())),
});

const importCharacterSchema = z.object({
  payload: z.record(z.unknown()),
  create_session: z.boolean().default(true),
  title: z.string().trim().min(1).max(200).optional(),
});

const idParamsSchema = z.object({
  id: z.string().min(1),
});

const presetEditorEntrySchema = z.object({
  identifier: z.string().trim().min(1),
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
  extra: z.record(z.unknown()).default({})
});

const presetEditorOrderItemSchema = z.object({
  identifier: z.string().trim().min(1),
  enabled: z.boolean().default(true)
});

const presetEditorOrderContextSchema = z.object({
  character_id: z.number().int(),
  order: z.array(presetEditorOrderItemSchema).default([]),
  extra: z.record(z.unknown()).default({})
});

const presetEditorDocumentSchema = z.object({
  default_character_id: z.number().int().default(100000),
  entries: z.array(presetEditorEntrySchema),
  order_contexts: z.array(presetEditorOrderContextSchema).default([]),
  top_level: z.record(z.unknown()).default({})
});

const updatePresetSchema = z.object({
  name: z.string().trim().min(1),
  editor: presetEditorDocumentSchema,
  expected_updated_at: z.number().int().nonnegative().optional()
});

const updateWorldbookSchema = z.object({
  name: z.string().trim().min(1),
  data: z.record(z.unknown()),
  expected_updated_at: z.number().int().nonnegative().optional()
});

type PresetEditorDocumentInput = z.infer<typeof presetEditorDocumentSchema>;

const MAX_CHARACTER_IMPORT_BYTES = 200_000;

const resourceListItemExample = {
  id: "preset_story",
  name: "Story Preset",
  source: "sillytavern",
  created_at: 1735689600000,
  updated_at: 1735689660000,
} as const;

const importPresetBodyExample = {
  name: "Story Preset",
  data: {
    prompts: [],
    prompt_order: [],
  },
} as const;

const importWorldbookBodyExample = {
  name: "Kingdom Lore",
  data: {
    entries: [
      {
        keys: ["kingdom"],
        content: "The kingdom is recovering from a long war.",
      },
    ],
  },
} as const;

const importRegexBodyExample = {
  name: "Safety Filters",
  data: [
    {
      scriptName: "trim_whitespace",
      find: "\\s+$",
      replace: "",
    },
  ],
} as const;

const importResourceResponseExample = {
  data: {
    id: "preset_story",
    name: "Story Preset",
    source: "sillytavern",
  },
} as const;

const importRegexResponseExample = {
  data: {
    id: "regex_safe",
    name: "Safety Filters",
    source: "sillytavern",
    script_count: 1,
  },
} as const;

const importedSessionExample = {
  id: "sess_luna",
  title: "Luna Demo Session",
  status: "active",
  character_binding: {
    character_id: "char_luna",
    character_version_id: "charver_luna_1",
    sync_policy: "pin",
    snapshot_summary: {
      name: "Luna",
      has_greeting: true,
    },
  },
  created_at: 1735689600000,
  updated_at: 1735689660000,
} as const;

const importCharacterBodyExample = {
  payload: {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Luna",
      description: "A moon priestess who keeps watch at night.",
      personality: "Calm and precise",
      scenario: "Night watch at the city wall",
      first_mes: "The moon is bright tonight.",
      mes_example: "<START>\n{{char}}: The tide is turning.",
    },
  },
  create_session: true,
  title: "Luna Demo Session",
} as const;

const importCharacterResponseExample = {
  data: {
    create_session: true,
    character: {
      name: "Luna",
      description: "A moon priestess who keeps watch at night.",
      personality: "Calm and precise",
      scenario: "Night watch at the city wall",
      first_mes: "The moon is bright tonight.",
      mes_example: "<START>\n{{char}}: The tide is turning.",
    },
    session: importedSessionExample,
  },
} as const;

const resourceListResponseExample = {
  data: [resourceListItemExample],
} as const;

const resourceDetailResponseExample = {
  data: {
    ...resourceListItemExample,
    data: {
      prompts: [],
      prompt_order: [],
    },
  },
} as const;

const presetEditorBodyExample = {
  name: "Story Preset",
  expected_updated_at: 1735689660000,
  editor: {
    default_character_id: 100000,
    entries: [
      {
        identifier: "main",
        name: "System Guidance",
        role: "system",
        content: "Stay in character and keep the tone warm.",
        system_prompt: true,
        marker: false,
        injection_position: 0,
        enabled: true,
        extra: {},
      },
    ],
    order_contexts: [
      {
        character_id: 100000,
        order: [{ identifier: "main", enabled: true }],
        extra: {},
      },
    ],
    top_level: {
      temperature: 0.7,
    },
  },
} as const;

const presetEditorDetailResponseExample = {
  data: {
    ...resourceListItemExample,
    editor: presetEditorBodyExample.editor,
  },
} as const;

const presetUpdateResponseExample = {
  data: resourceListItemExample,
} as const;

const worldbookUpdateBodyExample = {
  name: "Kingdom Lore",
  data: {
    entries: [
      {
        keys: ["kingdom"],
        content: "The kingdom is recovering from a long war.",
      },
    ],
  },
  expected_updated_at: 1735689660000,
} as const;

const worldbookUpdateResponseExample = {
  data: {
    id: "wb_kingdom",
    name: "Kingdom Lore",
    source: "sillytavern",
    created_at: 1735689600000,
    updated_at: 1735689720000,
  },
} as const;

const idParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const;

const importPresetBodyJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    name: { type: "string" },
    data: { type: "object", additionalProperties: true }
  },
  examples: [importPresetBodyExample],
  additionalProperties: false
} as const;

const importWorldbookBodyJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    name: { type: "string" },
    data: { type: "object", additionalProperties: true }
  },
  examples: [importWorldbookBodyExample],
  additionalProperties: false
} as const;

const importRegexBodyJsonSchema = {
  type: "object",
  required: ["name", "data"],
  properties: {
    name: { type: "string", minLength: 1 },
    data: { type: "array", items: { type: "object", additionalProperties: true } }
  },
  examples: [importRegexBodyExample],
  additionalProperties: false
} as const;

const importCharacterBodyJsonSchema = {
  type: "object",
  required: ["payload"],
  properties: {
    payload: { type: "object", additionalProperties: true },
    create_session: { type: "boolean" },
    title: { type: "string", minLength: 1, maxLength: 200 }
  },
  examples: [importCharacterBodyExample],
  additionalProperties: false
} as const;

const resourceListItemJsonSchema = {
  type: "object",
  required: ["id", "name", "source", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    source: { type: "string" },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 }
  },
  examples: [resourceListItemExample],
  additionalProperties: false
} as const;

const resourceListResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: { type: "array", items: resourceListItemJsonSchema }
  },
  examples: [resourceListResponseExample],
  additionalProperties: false
} as const;

const resourceDetailResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      ...resourceListItemJsonSchema,
      required: [...resourceListItemJsonSchema.required, "data"],
      properties: {
        ...resourceListItemJsonSchema.properties,
        data: {}
      }
    }
  },
  examples: [resourceDetailResponseExample],
  additionalProperties: false
} as const;

const importResourceResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["id", "name", "source"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        source: { type: "string" }
      },
      additionalProperties: false
    }
  },
  examples: [importResourceResponseExample],
  additionalProperties: false
} as const;

const importRegexResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["id", "name", "source", "script_count"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        source: { type: "string" },
        script_count: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    }
  },
  examples: [importRegexResponseExample],
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

const importCharacterResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["create_session", "character"],
      properties: {
        create_session: { type: "boolean" },
        character: { type: "object", additionalProperties: true },
        character_id: { type: "string" },
        character_version_id: { type: "string" },
        session: { type: "object", additionalProperties: true }
      },
      additionalProperties: true
    }
  },
  examples: [importCharacterResponseExample],
  additionalProperties: false
} as const;

const presetEditorBodyJsonSchema = {
  type: "object",
  required: ["name", "editor"],
  properties: {
    name: { type: "string", minLength: 1 },
    expected_updated_at: { type: "integer", minimum: 0 },
    editor: {
      type: "object",
      required: ["entries", "order_contexts", "top_level", "default_character_id"],
      properties: {
        default_character_id: { type: "integer" },
        entries: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        },
        order_contexts: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        },
        top_level: { type: "object", additionalProperties: true }
      },
      additionalProperties: false
    }
  },
  examples: [presetEditorBodyExample],
  additionalProperties: false
} as const;

const presetEditorDetailResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      ...resourceListItemJsonSchema,
      required: [...resourceListItemJsonSchema.required, "editor"],
      properties: {
        ...resourceListItemJsonSchema.properties,
        editor: { type: "object", additionalProperties: true }
      }
    }
  },
  examples: [presetEditorDetailResponseExample],
  additionalProperties: false
} as const;

const presetUpdateResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: resourceListItemJsonSchema
  },
  examples: [presetUpdateResponseExample],
  additionalProperties: false
} as const;

const worldbookUpdateBodyJsonSchema = {
  type: "object",
  required: ["name", "data"],
  properties: {
    name: { type: "string", minLength: 1 },
    data: { type: "object", additionalProperties: true },
    expected_updated_at: { type: "integer", minimum: 0 }
  },
  examples: [worldbookUpdateBodyExample],
  additionalProperties: false
} as const;

const worldbookUpdateResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: resourceListItemJsonSchema },
  examples: [worldbookUpdateResponseExample],
  additionalProperties: false
} as const;

// ── Route Registration ────────────────────────────────

export async function registerImportRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const db = connection.db;

  // ══════════════════════════════════════════════════════
  // 导入路由
  // ══════════════════════════════════════════════════════

  /**
   * POST /import/preset
   *
   * 导入酒馆预设。接收原始 JSON，解析后存入数据库。
   */
  app.post("/import/preset", {
    schema: {
      tags: ["imports"],
      summary: "Import SillyTavern preset",
      operationId: "importPreset",
      body: importPresetBodyJsonSchema,
      response: {
        201: importResourceResponseJsonSchema,
        400: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(importPresetSchema, request.body, reply);
    if (!parsed.ok) return;

    try {
      parsePreset(parsed.data.data);
    } catch (error) {
      return sendError(
        reply,
        400,
        "import_parse_error",
        `Failed to parse preset: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const id = nanoid();
    const name = parsed.data.name || "Unnamed Preset";
    const now = Date.now();

    await db.insert(presets).values({
      id,
      name,
      source: "sillytavern",
      dataJson: JSON.stringify(parsed.data.data),
      createdAt: now,
      updatedAt: now,
    });

    return reply.code(201).send({
      data: { id, name, source: "sillytavern" },
    });
  });

  /**
   * POST /import/worldbook
   *
   * 导入酒馆世界书。接收原始 JSON，解析后存入数据库。
   */
  app.post("/import/worldbook", {
    schema: {
      tags: ["imports"],
      summary: "Import SillyTavern worldbook",
      operationId: "importWorldbook",
      body: importWorldbookBodyJsonSchema,
      response: {
        201: importResourceResponseJsonSchema,
        400: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(importWorldbookSchema, request.body, reply);
    if (!parsed.ok) return;

    let stWorldBook;
    try {
      stWorldBook = parseWorldBook(parsed.data.data);
    } catch (error) {
      return sendError(
        reply,
        400,
        "import_parse_error",
        `Failed to parse worldbook: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const id = nanoid();
    const name = parsed.data.name || stWorldBook.name || "Unnamed Worldbook";
    const now = Date.now();

    await db.insert(worldbooks).values({
      id,
      name,
      source: "sillytavern",
      dataJson: JSON.stringify(stWorldBook),
      createdAt: now,
      updatedAt: now,
    });

    return reply.code(201).send({
      data: { id, name, source: "sillytavern" },
    });
  });

  /**
   * POST /import/regex
   *
   * 导入酒馆正则脚本。接收原始 JSON 数组，解析后存入数据库。
   */
  app.post("/import/regex", {
    schema: {
      tags: ["imports"],
      summary: "Import SillyTavern regex scripts",
      operationId: "importRegexProfile",
      body: importRegexBodyJsonSchema,
      response: {
        201: importRegexResponseJsonSchema,
        400: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(importRegexSchema, request.body, reply);
    if (!parsed.ok) return;

    let stScripts;
    try {
      stScripts = parseRegexScripts(parsed.data.data);
    } catch (error) {
      return sendError(
        reply,
        400,
        "import_parse_error",
        `Failed to parse regex scripts: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const id = nanoid();
    const name = parsed.data.name;
    const now = Date.now();

    await db.insert(regexProfiles).values({
      id,
      name,
      source: "sillytavern",
      dataJson: JSON.stringify(stScripts),
      createdAt: now,
      updatedAt: now,
    });

    return reply.code(201).send({
      data: { id, name, source: "sillytavern", script_count: stScripts.length },
    });
  });

  /**
   * POST /import/character
   *
   * 导入 SillyTavern 角色卡（优先支持 TavernCard v2）。
   * 可选择仅返回标准化角色数据，或直接创建会话并写入 metadata。
   */
  app.post("/import/character", {
    schema: {
      tags: ["imports"],
      summary: "Import SillyTavern character card",
      operationId: "importCharacter",
      body: importCharacterBodyJsonSchema,
      response: {
        201: importCharacterResponseJsonSchema,
        400: errorResponseJsonSchema,
        413: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(importCharacterSchema, request.body, reply);
    if (!parsed.ok) return;

    const payloadSize = Buffer.byteLength(JSON.stringify(parsed.data.payload), "utf-8");
    if (payloadSize > MAX_CHARACTER_IMPORT_BYTES) {
      return sendError(
        reply,
        413,
        "import_payload_too_large",
        `Character payload exceeds ${MAX_CHARACTER_IMPORT_BYTES} bytes`
      );
    }

    let characterCard: STCharacterCard;
    try {
      characterCard = parseCharacterCard(parsed.data.payload);
    } catch (error) {
      return sendError(
        reply,
        400,
        "import_parse_error",
        `Failed to parse character card: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const snapshot = toCharacterSnapshot(characterCard);

    if (!parsed.data.create_session) {
      const characterBinding = createCharacterFromImport(db, {
        name: characterCard.name,
        snapshot,
        source: "sillytavern",
        now: Date.now()
      });

      return reply.code(201).send({
        data: {
          create_session: false,
          character: toCharacterResponse(characterCard),
          character_id: characterBinding.characterId,
          character_version_id: characterBinding.characterVersionId,
        }
      });
    }

    const imported = createCharacterWithSessionFromImport(db, {
      name: characterCard.name,
      snapshot,
      source: "sillytavern",
      title: parsed.data.title ?? characterCard.name,
      now: Date.now()
    });

    return reply.code(201).send({
      data: {
        create_session: true,
        character: toCharacterResponse(characterCard),
        session: imported.session
      }
    });
  });

  // ══════════════════════════════════════════════════════
  // Preset CRUD
  // ══════════════════════════════════════════════════════

  /** GET /presets — 列出所有预设 */
  app.get("/presets", {
    schema: {
      tags: ["imports"],
      summary: "List imported presets",
      operationId: "listImportedPresets",
      response: {
        200: resourceListResponseJsonSchema
      }
    }
  }, async (_request, reply) => {
    const rows = await db
      .select({
        id: presets.id,
        name: presets.name,
        source: presets.source,
        createdAt: presets.createdAt,
        updatedAt: presets.updatedAt,
      })
      .from(presets);

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        source: r.source,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
    });
  });

  /** GET /presets/:id — 获取预设详情 */
  app.get("/presets/:id", {
    schema: {
      tags: ["imports"],
      summary: "Get imported preset",
      operationId: "getImportedPreset",
      params: idParamsJsonSchema,
      response: {
        200: resourceDetailResponseJsonSchema,
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    const [row] = await db
      .select()
      .from(presets)
      .where(eq(presets.id, parsed.data.id));

    if (!row) {
      return sendError(reply, 404, "not_found", "Preset not found");
    }

    return reply.send({
      data: {
        id: row.id,
        name: row.name,
        source: row.source,
        data: parseJsonField(row.dataJson),
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      },
    });
  });

  /** GET /presets/:id/editor — 获取预设编辑模型 */
  app.get("/presets/:id/editor", {
    schema: {
      tags: ["imports"],
      summary: "Get imported preset editor document",
      operationId: "getImportedPresetEditor",
      params: idParamsJsonSchema,
      response: {
        200: presetEditorDetailResponseJsonSchema,
        404: errorResponseJsonSchema,
        422: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    const [row] = await db
      .select()
      .from(presets)
      .where(eq(presets.id, parsed.data.id));

    if (!row) {
      return sendError(reply, 404, "preset_not_found", "Preset not found");
    }

    try {
      const editor = toPresetEditorDocument(parseJsonField(row.dataJson));
      return reply.send({
        data: {
          id: row.id,
          name: row.name,
          source: row.source,
          editor,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
        }
      });
    } catch (error) {
      return sendError(
        reply,
        422,
        "preset_unsupported_shape",
        error instanceof Error ? error.message : "Preset shape is not supported"
      );
    }
  });

  /** PUT /presets/:id — 同 ID 更新预设 */
  app.put("/presets/:id", {
    schema: {
      tags: ["imports"],
      summary: "Update imported preset by id",
      operationId: "updateImportedPreset",
      params: idParamsJsonSchema,
      body: presetEditorBodyJsonSchema,
      response: {
        200: presetUpdateResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const paramsParsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!paramsParsed.ok) return;
    const bodyParsed = parseWithSchema(updatePresetSchema, request.body, reply);
    if (!bodyParsed.ok) return;

    const [row] = await db
      .select()
      .from(presets)
      .where(eq(presets.id, paramsParsed.data.id));

    if (!row) {
      return sendError(reply, 404, "preset_not_found", "Preset not found");
    }

    if (bodyParsed.data.expected_updated_at !== undefined && bodyParsed.data.expected_updated_at !== row.updatedAt) {
      return sendError(reply, 409, "preset_conflict", "Preset has been modified by another operation");
    }

    const now = Date.now();
    let nextPreset: JsonRecord;
    try {
      nextPreset = toRawPresetFromEditor(bodyParsed.data.editor);
    } catch (error) {
      return sendError(
        reply,
        400,
        "preset_validation_error",
        error instanceof Error ? error.message : "Preset validation failed"
      );
    }

    await db.update(presets).set({
      name: bodyParsed.data.name,
      dataJson: JSON.stringify(nextPreset),
      updatedAt: now
    }).where(eq(presets.id, row.id));

    return reply.send({
      data: {
        id: row.id,
        name: bodyParsed.data.name,
        source: row.source,
        created_at: row.createdAt,
        updated_at: now
      }
    });
  });

  /** DELETE /presets/:id — 删除预设 */
  app.delete("/presets/:id", {
    schema: {
      tags: ["imports"],
      summary: "Delete imported preset",
      operationId: "deleteImportedPreset",
      params: idParamsJsonSchema,
      response: {
        204: { type: "null" },
        400: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    await db
      .delete(presets)
      .where(eq(presets.id, parsed.data.id));

    return reply.code(204).send();
  });

  // ══════════════════════════════════════════════════════
  // Worldbook CRUD
  // ══════════════════════════════════════════════════════

  /** GET /worldbooks — 列出所有世界书 */
  app.get("/worldbooks", {
    schema: {
      tags: ["imports"],
      summary: "List imported worldbooks",
      operationId: "listImportedWorldbooks",
      response: {
        200: resourceListResponseJsonSchema
      }
    }
  }, async (_request, reply) => {
    const rows = await db
      .select({
        id: worldbooks.id,
        name: worldbooks.name,
        source: worldbooks.source,
        createdAt: worldbooks.createdAt,
        updatedAt: worldbooks.updatedAt,
      })
      .from(worldbooks);

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        source: r.source,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
    });
  });

  /** GET /worldbooks/:id — 获取世界书详情 */
  app.get("/worldbooks/:id", {
    schema: {
      tags: ["imports"],
      summary: "Get imported worldbook",
      operationId: "getImportedWorldbook",
      params: idParamsJsonSchema,
      response: {
        200: resourceDetailResponseJsonSchema,
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    const [row] = await db
      .select()
      .from(worldbooks)
      .where(eq(worldbooks.id, parsed.data.id));

    if (!row) {
      return sendError(reply, 404, "not_found", "Worldbook not found");
    }

    return reply.send({
      data: {
        id: row.id,
        name: row.name,
        source: row.source,
        data: parseJsonField(row.dataJson),
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      },
    });
  });

  /** PUT /worldbooks/:id — 同 ID 更新世界书 */
  app.put("/worldbooks/:id", {
    schema: {
      tags: ["imports"],
      summary: "Update imported worldbook by id",
      operationId: "updateImportedWorldbook",
      params: idParamsJsonSchema,
      body: worldbookUpdateBodyJsonSchema,
      response: {
        200: worldbookUpdateResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const paramsParsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!paramsParsed.ok) return;
    const bodyParsed = parseWithSchema(updateWorldbookSchema, request.body, reply);
    if (!bodyParsed.ok) return;

    const [row] = await db
      .select()
      .from(worldbooks)
      .where(eq(worldbooks.id, paramsParsed.data.id));

    if (!row) {
      return sendError(reply, 404, "worldbook_not_found", "Worldbook not found");
    }

    if (bodyParsed.data.expected_updated_at !== undefined && bodyParsed.data.expected_updated_at !== row.updatedAt) {
      return sendError(reply, 409, "worldbook_conflict", "Worldbook has been modified by another operation");
    }

    let nextWorldbook;
    try {
      nextWorldbook = parseWorldBook(bodyParsed.data.data);
    } catch (error) {
      return sendError(
        reply,
        400,
        "worldbook_validation_error",
        error instanceof Error ? error.message : "Worldbook validation failed"
      );
    }

    const now = Date.now();
    await db
      .update(worldbooks)
      .set({
        name: bodyParsed.data.name,
        dataJson: JSON.stringify(nextWorldbook),
        updatedAt: now
      })
      .where(eq(worldbooks.id, row.id));

    return reply.send({
      data: {
        id: row.id,
        name: bodyParsed.data.name,
        source: row.source,
        created_at: row.createdAt,
        updated_at: now
      }
    });
  });

  /** DELETE /worldbooks/:id — 删除世界书 */
  app.delete("/worldbooks/:id", {
    schema: {
      tags: ["imports"],
      summary: "Delete imported worldbook",
      operationId: "deleteImportedWorldbook",
      params: idParamsJsonSchema,
      response: {
        204: { type: "null" },
        400: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    await db
      .delete(worldbooks)
      .where(eq(worldbooks.id, parsed.data.id));

    return reply.code(204).send();
  });

  // ══════════════════════════════════════════════════════
  // Regex Profile CRUD
  // ══════════════════════════════════════════════════════

  /** GET /regex-profiles — 列出所有正则配置 */
  app.get("/regex-profiles", {
    schema: {
      tags: ["imports"],
      summary: "List imported regex profiles",
      operationId: "listImportedRegexProfiles",
      response: {
        200: resourceListResponseJsonSchema
      }
    }
  }, async (_request, reply) => {
    const rows = await db
      .select({
        id: regexProfiles.id,
        name: regexProfiles.name,
        source: regexProfiles.source,
        createdAt: regexProfiles.createdAt,
        updatedAt: regexProfiles.updatedAt,
      })
      .from(regexProfiles);

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        source: r.source,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })),
    });
  });

  /** GET /regex-profiles/:id — 获取正则配置详情 */
  app.get("/regex-profiles/:id", {
    schema: {
      tags: ["imports"],
      summary: "Get imported regex profile",
      operationId: "getImportedRegexProfile",
      params: idParamsJsonSchema,
      response: {
        200: resourceDetailResponseJsonSchema,
        404: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    const [row] = await db
      .select()
      .from(regexProfiles)
      .where(eq(regexProfiles.id, parsed.data.id));

    if (!row) {
      return sendError(reply, 404, "not_found", "Regex profile not found");
    }

    return reply.send({
      data: {
        id: row.id,
        name: row.name,
        source: row.source,
        data: parseJsonField(row.dataJson),
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      },
    });
  });

  /** DELETE /regex-profiles/:id — 删除正则配置 */
  app.delete("/regex-profiles/:id", {
    schema: {
      tags: ["imports"],
      summary: "Delete imported regex profile",
      operationId: "deleteImportedRegexProfile",
      params: idParamsJsonSchema,
      response: {
        204: { type: "null" },
        400: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    await db
      .delete(regexProfiles)
      .where(eq(regexProfiles.id, parsed.data.id));

    return reply.code(204).send();
  });
}

type JsonRecord = Record<string, unknown>;

interface PresetEditorOrderItem {
  identifier: string;
  enabled: boolean;
}

interface PresetEditorOrderContext {
  character_id: number;
  order: PresetEditorOrderItem[];
  extra: JsonRecord;
}

interface PresetEditorEntry {
  identifier: string;
  name: string;
  role: "assistant" | "system" | "user";
  content: string;
  system_prompt: boolean;
  marker: boolean;
  injection_position: number;
  injection_depth?: number;
  injection_order?: number;
  forbid_overrides?: boolean;
  injection_trigger?: unknown[];
  enabled: boolean;
  extra: JsonRecord;
}

interface PresetEditorDocument {
  format: "legacy-compact" | "st-raw";
  default_character_id: number;
  entries: PresetEditorEntry[];
  order_contexts: PresetEditorOrderContext[];
  top_level: JsonRecord;
}

const PRESET_RESERVED_TOP_LEVEL_KEYS = new Set(["prompts", "prompt_order"]);

const PRESET_PROMPT_KNOWN_KEYS = new Set([
  "identifier",
  "name",
  "role",
  "content",
  "system_prompt",
  "marker",
  "injection_position",
  "injection_depth",
  "injection_order",
  "forbid_overrides",
  "injection_trigger",
  "enabled"
]);

const PRESET_ORDER_CONTEXT_KNOWN_KEYS = new Set(["character_id", "order"]);

const LEGACY_PRESET_FIELD_MAP: Record<string, string> = {
  assistantPrefill: "assistant_prefill",
  continueNudgePrompt: "continue_nudge_prompt",
  frequencyPenalty: "frequency_penalty",
  maxContext: "openai_max_context",
  maxTokens: "openai_max_tokens",
  minP: "min_p",
  namesBehavior: "names_behavior",
  newChatPrompt: "new_chat_prompt",
  newExampleChatPrompt: "new_example_chat_prompt",
  presencePenalty: "presence_penalty",
  repetitionPenalty: "repetition_penalty",
  stream: "stream_openai",
  topK: "top_k",
  topP: "top_p",
  wiFormat: "wi_format"
};

function toPresetEditorDocument(value: unknown): PresetEditorDocument {
  const normalized = normalizeStoredPreset(value);

  try {
    parsePreset(normalized.raw);
  } catch (error) {
    throw new Error(`Preset validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const promptList = readRawPromptList(normalized.raw);
  const orderContexts = readRawOrderContexts(normalized.raw, promptList.map((prompt) => prompt.identifier));
  const defaultCharacterId = resolveDefaultCharacterId(orderContexts);
  const defaultContext = orderContexts.find((context) => context.character_id === defaultCharacterId) ?? orderContexts[0];
  const enabledMap = new Map(defaultContext?.order.map((item) => [item.identifier, item.enabled]) ?? []);
  const orderedIdentifiers = new Map<string, number>();
  defaultContext?.order.forEach((item, index) => {
    if (!orderedIdentifiers.has(item.identifier)) {
      orderedIdentifiers.set(item.identifier, index);
    }
  });

  const entries = promptList
    .slice()
    .sort((left, right) => {
      const leftIndex = orderedIdentifiers.get(left.identifier);
      const rightIndex = orderedIdentifiers.get(right.identifier);
      if (leftIndex === undefined && rightIndex === undefined) {
        return 0;
      }
      if (leftIndex === undefined) {
        return 1;
      }
      if (rightIndex === undefined) {
        return -1;
      }
      return leftIndex - rightIndex;
    })
    .map((prompt) => toEditorEntry(prompt.payload, enabledMap.get(prompt.identifier)));

  return {
    format: normalized.format,
    default_character_id: defaultCharacterId,
    entries,
    order_contexts: orderContexts,
    top_level: omitRecordKeys(normalized.raw, PRESET_RESERVED_TOP_LEVEL_KEYS)
  };
}

function toRawPresetFromEditor(editor: PresetEditorDocumentInput): JsonRecord {
  const seenIdentifiers = new Set<string>();
  const prompts = editor.entries.map((entry) => {
    if (seenIdentifiers.has(entry.identifier)) {
      throw new Error(`Duplicate prompt identifier: ${entry.identifier}`);
    }
    seenIdentifiers.add(entry.identifier);

    const nextPrompt: JsonRecord = {
      ...entry.extra,
      identifier: entry.identifier,
      name: entry.name,
      role: entry.role,
      content: entry.content,
      system_prompt: entry.system_prompt,
      marker: entry.marker,
      injection_position: entry.injection_position,
      enabled: entry.enabled
    };

    if (entry.injection_depth !== undefined) {
      nextPrompt.injection_depth = entry.injection_depth;
    }
    if (entry.injection_order !== undefined) {
      nextPrompt.injection_order = entry.injection_order;
    }
    if (entry.forbid_overrides !== undefined) {
      nextPrompt.forbid_overrides = entry.forbid_overrides;
    }
    if (entry.injection_trigger !== undefined) {
      nextPrompt.injection_trigger = entry.injection_trigger;
    }
    return nextPrompt;
  });

  const promptIdentifiers = prompts.map((prompt) => String(prompt.identifier));
  const orderContexts = normalizeEditorOrderContexts(editor.order_contexts, promptIdentifiers);
  let defaultContext = orderContexts.find((context) => context.character_id === editor.default_character_id);
  if (!defaultContext) {
    defaultContext = {
      character_id: editor.default_character_id,
      order: [],
      extra: {}
    };
    orderContexts.push(defaultContext);
  }

  defaultContext.order = editor.entries.map((entry) => ({
    identifier: entry.identifier,
    enabled: entry.enabled
  }));


  const topLevel = omitRecordKeys(editor.top_level, PRESET_RESERVED_TOP_LEVEL_KEYS);
  const rawPreset: JsonRecord = {
    ...topLevel,
    prompts,
    prompt_order: orderContexts.map((context) => ({
      ...context.extra,
      character_id: context.character_id,
      order: context.order
    }))
  };

  try {
    parsePreset(rawPreset);
  } catch (error) {
    throw new Error(`Preset validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return rawPreset;
}

function normalizeStoredPreset(value: unknown): { format: "legacy-compact" | "st-raw"; raw: JsonRecord } {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Preset payload must be an object");
  }

  const hasRawOrder = Array.isArray(record.prompt_order);
  const hasLegacyOrder = Array.isArray(record.promptOrder);

  if (hasRawOrder) {
    return {
      format: "st-raw",
      raw: { ...record }
    };
  }

  if (hasLegacyOrder) {
    return {
      format: "legacy-compact",
      raw: toRawPresetFromLegacy(record)
    };
  }

  if (Array.isArray(record.prompts)) {
    return {
      format: "st-raw",
      raw: {
        ...record,
        prompt_order: []
      }
    };
  }

  throw new Error("Preset payload missing prompts/prompt_order fields");
}

function toRawPresetFromLegacy(record: JsonRecord): JsonRecord {
  const mapped: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "promptOrder" || key === "prompts") {
      continue;
    }
    mapped[LEGACY_PRESET_FIELD_MAP[key] ?? key] = value;
  }

  const promptEntries = Array.isArray(record.prompts) ? record.prompts : [];
  const prompts: JsonRecord[] = [];
  for (const item of promptEntries) {
    const prompt = asRecord(item);
    const identifier = prompt?.identifier;
    if (!prompt || typeof identifier !== "string" || !identifier.trim()) {
      continue;
    }
    prompts.push({ ...prompt, identifier: identifier.trim() });
  }

  const legacyOrder = Array.isArray(record.promptOrder) ? record.promptOrder : [];
  const orderItems: PresetEditorOrderItem[] = [];
  const seen = new Set<string>();

  for (const item of legacyOrder) {
    if (typeof item !== "string" || !item.trim() || seen.has(item)) {
      continue;
    }
    seen.add(item);
    orderItems.push({ identifier: item, enabled: true });
  }

  for (const prompt of prompts) {
    const identifier = String(prompt.identifier);
    if (seen.has(identifier)) {
      continue;
    }
    seen.add(identifier);
    orderItems.push({
      identifier,
      enabled: typeof prompt.enabled === "boolean" ? prompt.enabled : true
    });
  }

  return {
    ...mapped,
    prompts,
    prompt_order: [
      {
        character_id: 100000,
        order: orderItems
      }
    ]
  };
}

function readRawPromptList(rawPreset: JsonRecord): Array<{ identifier: string; payload: JsonRecord }> {
  const items = Array.isArray(rawPreset.prompts) ? rawPreset.prompts : [];
  const prompts: Array<{ identifier: string; payload: JsonRecord }> = [];
  for (const item of items) {
    const prompt = asRecord(item);
    const identifier = prompt?.identifier;
    if (!prompt || typeof identifier !== "string" || !identifier.trim()) {
      continue;
    }
    prompts.push({ identifier: identifier.trim(), payload: { ...prompt, identifier: identifier.trim() } });
  }
  return prompts;
}

function readRawOrderContexts(rawPreset: JsonRecord, promptIdentifiers: string[]): PresetEditorOrderContext[] {
  const contexts = Array.isArray(rawPreset.prompt_order) ? rawPreset.prompt_order : [];
  const normalized: PresetEditorOrderContext[] = [];
  for (const contextItem of contexts) {
    const context = asRecord(contextItem);
    if (!context) {
      continue;
    }
    const characterId = typeof context.character_id === "number" ? Math.trunc(context.character_id) : null;
    if (characterId === null || Number.isNaN(characterId)) {
      continue;
    }
    const order = normalizeOrderItems(context.order, promptIdentifiers);
    normalized.push({
      character_id: characterId,
      order,
      extra: omitRecordKeys(context, PRESET_ORDER_CONTEXT_KNOWN_KEYS)
    });
  }

  if (normalized.length === 0) {
    normalized.push({
      character_id: 100000,
      order: promptIdentifiers.map((identifier) => ({ identifier, enabled: true })),
      extra: {}
    });
  }

  return normalized;
}

function toEditorEntry(prompt: JsonRecord, enabledFromOrder: boolean | undefined): PresetEditorEntry {
  const role = prompt.role === "assistant" || prompt.role === "user" || prompt.role === "system"
    ? prompt.role
    : "system";

  return {
    identifier: String(prompt.identifier),
    name: typeof prompt.name === "string" ? prompt.name : "",
    role,
    content: typeof prompt.content === "string" ? prompt.content : "",
    system_prompt: Boolean(prompt.system_prompt),
    marker: Boolean(prompt.marker),
    injection_position: toInteger(prompt.injection_position, 0),
    injection_depth: toOptionalInteger(prompt.injection_depth),
    injection_order: toOptionalInteger(prompt.injection_order),
    forbid_overrides: typeof prompt.forbid_overrides === "boolean" ? prompt.forbid_overrides : undefined,
    injection_trigger: Array.isArray(prompt.injection_trigger) ? prompt.injection_trigger : undefined,
    enabled: typeof enabledFromOrder === "boolean"
      ? enabledFromOrder
      : (typeof prompt.enabled === "boolean" ? prompt.enabled : true),
    extra: omitRecordKeys(prompt, PRESET_PROMPT_KNOWN_KEYS)
  };
}

function normalizeEditorOrderContexts(contexts: PresetEditorDocumentInput["order_contexts"], promptIdentifiers: string[]): PresetEditorOrderContext[] {
  const normalized: PresetEditorOrderContext[] = [];
  for (const context of contexts) {
    normalized.push({
      character_id: context.character_id,
      order: normalizeOrderItems(context.order, promptIdentifiers),
      extra: context.extra
    });
  }

  if (normalized.length === 0) {
    normalized.push({
      character_id: 100000,
      order: promptIdentifiers.map((identifier) => ({ identifier, enabled: true })),
      extra: {}
    });
  }

  return normalized;
}

function normalizeOrderItems(value: unknown, promptIdentifiers: string[]): PresetEditorOrderItem[] {
  const promptIdentifierSet = new Set(promptIdentifiers);
  const items = Array.isArray(value) ? value : [];
  const order: PresetEditorOrderItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const orderItem = asRecord(item);
    if (!orderItem) {
      continue;
    }
    const identifier = orderItem?.identifier;
    if (typeof identifier !== "string" || !identifier.trim()) {
      continue;
    }
    const normalizedIdentifier = identifier.trim();
    if (seen.has(normalizedIdentifier) || !promptIdentifierSet.has(normalizedIdentifier)) {
      continue;
    }
    seen.add(normalizedIdentifier);
    order.push({
      identifier: normalizedIdentifier,
      enabled: typeof orderItem.enabled === "boolean" ? orderItem.enabled : true
    });
  }

  for (const identifier of promptIdentifiers) {
    if (seen.has(identifier)) {
      continue;
    }
    seen.add(identifier);
    order.push({ identifier, enabled: true });
  }

  return order;
}

function resolveDefaultCharacterId(contexts: PresetEditorOrderContext[]): number {
  if (contexts.length === 0) {
    return 100000;
  }

  const sorted = contexts.slice().sort((left, right) => {
    if (left.order.length !== right.order.length) {
      return right.order.length - left.order.length;
    }
    if (left.character_id === 100000 && right.character_id !== 100000) {
      return 1;
    }
    if (right.character_id === 100000 && left.character_id !== 100000) {
      return -1;
    }
    return left.character_id - right.character_id;
  });

  return sorted[0]?.character_id ?? 100000;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function omitRecordKeys(record: JsonRecord, keys: Set<string>): JsonRecord {
  const next: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key)) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function toInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.trunc(value);
}

function toOptionalInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.trunc(value);
}

interface CharacterSnapshot {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  exampleDialogue?: string;
  greeting?: string;
}

interface CharacterBindingPayload {
  characterId: string;
  characterVersionId: string;
  characterSnapshotJson: string;
  now: number;
}

interface ImportedSessionResponse {
  id: string;
  title: string | null;
  status: "active";
  character_binding: {
    character_id: string;
    character_version_id: string;
    sync_policy: "pin";
    snapshot_summary: {
      name: string;
      has_greeting: boolean;
    };
  };
  created_at: number;
  updated_at: number;
}

function toCharacterSnapshot(card: STCharacterCard): CharacterSnapshot {
  return {
    name: card.name,
    description: card.description || undefined,
    personality: card.personality || undefined,
    scenario: card.scenario || undefined,
    exampleDialogue: card.mesExample || undefined,
    greeting: card.firstMes || undefined,
  };
}

function toCharacterResponse(card: STCharacterCard) {
  return {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.firstMes,
    mes_example: card.mesExample,
  };
}

function createCharacterFromImport(
  db: DatabaseConnection["db"],
  input: {
    name: string;
    source: string;
    snapshot: CharacterSnapshot;
    now: number;
  }
): CharacterBindingPayload {
  return db.transaction((tx) => createCharacterFromImportInternal(tx, input));
}

function createCharacterWithSessionFromImport(
  db: DatabaseConnection["db"],
  input: {
    name: string;
    source: string;
    snapshot: CharacterSnapshot;
    title: string;
    now: number;
  }
): { characterBinding: CharacterBindingPayload; session: ImportedSessionResponse } {
  return db.transaction((tx) => {
    const characterBinding = createCharacterFromImportInternal(tx, {
      name: input.name,
      source: input.source,
      snapshot: input.snapshot,
      now: input.now
    });

    const session = createSessionFromCharacterImportInternal(tx, {
      title: input.title,
      characterBinding,
      now: input.now
    });

    return { characterBinding, session };
  });
}

function createCharacterFromImportInternal(
  db: any,
  input: {
    name: string;
    source: string;
    snapshot: CharacterSnapshot;
    now: number;
  }
): CharacterBindingPayload {
  const characterId = nanoid();
  const characterVersionId = nanoid();
  const snapshotJson = stringifyJsonField(input.snapshot) ?? "{}";
  const contentHash = createHash("sha256").update(snapshotJson).digest("hex");

  db.insert(characters).values({
    id: characterId,
    name: input.name,
    source: input.source,
    status: "active",
    deletedAt: null,
    createdAt: input.now,
    updatedAt: input.now
  }).run();

  db.insert(characterVersions).values({
    id: characterVersionId,
    characterId,
    versionNo: 1,
    dataJson: snapshotJson,
    contentHash,
    createdAt: input.now
  }).run();

  return {
    characterId,
    characterVersionId,
    characterSnapshotJson: snapshotJson,
    now: input.now
  };
}

function createSessionFromCharacterImportInternal(
  db: any,
  input: { title: string; characterBinding: CharacterBindingPayload; now: number }
): ImportedSessionResponse {
  const sessionId = nanoid();

  db.insert(sessions).values({
    id: sessionId,
    title: input.title,
    status: "active",
    characterId: input.characterBinding.characterId,
    characterVersionId: input.characterBinding.characterVersionId,
    characterSnapshotJson: input.characterBinding.characterSnapshotJson,
    characterSyncPolicy: "pin",
    presetId: null,
    regexProfileId: null,
    worldbookProfileId: null,
    modelProvider: null,
    modelName: null,
    modelParamsJson: null,
    metadataJson: stringifyJsonField({}),
    createdAt: input.now,
    updatedAt: input.now
  }).run();

  const snapshot = parseJsonField(input.characterBinding.characterSnapshotJson) as CharacterSnapshot | null;
  const greeting = snapshot?.greeting;

  if (greeting) {
    const tokenCounter = new SimpleTokenCounter();
    const floorId = nanoid();
    const pageId = nanoid();
    const greetingTokens = tokenCounter.count(greeting);

    db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 0,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: greetingTokens,
      createdAt: input.now,
      updatedAt: input.now
    }).run();

    db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 0,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: input.now,
      updatedAt: input.now
    }).run();

    db.insert(messages).values({
      id: nanoid(),
      pageId,
      seq: 0,
      role: "assistant",
      content: greeting,
      contentFormat: "text",
      tokenCount: greetingTokens,
      isHidden: false,
      source: "greeting",
      createdAt: input.now
    }).run();
  }

  return {
    id: sessionId,
    title: input.title,
    status: "active",
    character_binding: {
      character_id: input.characterBinding.characterId,
      character_version_id: input.characterBinding.characterVersionId,
      sync_policy: "pin",
      snapshot_summary: {
        name: snapshot?.name ?? input.title,
        has_greeting: Boolean(greeting)
      }
    },
    created_at: input.now,
    updated_at: input.now
  };
}
