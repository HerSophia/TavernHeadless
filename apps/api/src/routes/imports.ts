/**
 * Import Routes
 *
 * SillyTavern 资源导入路由 + 导入资源的 CRUD。
 *
 * POST /import/preset     — 导入酒馆预设
 * POST /import/worldbook  — 导入酒馆世界书
 * POST /import/regex      — 导入酒馆正则脚本
 * POST /import/character  — 导入酒馆角色卡
 * POST /import/chat       — 导入酒馆聊天记录 (.jsonl)
 *
 * GET    /presets          — 列出所有预设
 * GET    /presets/:id      — 获取预设详情（原始）
 * GET    /presets/:id/editor — 获取预设编辑模型
 * PUT    /presets/:id      — 同 ID 更新预设
 * DELETE /presets/:id      — 删除预设
 *
 * 预设提示词条目级操作见 preset-entries.ts。
 *
 * GET    /worldbooks       — 列出所有世界书
 * GET    /worldbooks/:id   — 获取世界书详情
 * PUT    /worldbooks/:id   — 同 ID 更新世界书
 * DELETE /worldbooks/:id   — 删除世界书
 *
 * GET    /regex-profiles       — 列出所有正则配置
 * GET    /regex-profiles/:id   — 获取正则配置详情
 * PUT    /regex-profiles/:id   — 同 ID 更新正则配置
 * DELETE /regex-profiles/:id   — 删除正则配置
 */

import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { CoreEventBus } from "@tavern/core";
import { createHash } from "node:crypto";
import { SimpleTokenCounter } from "@tavern/core";
import { z } from "zod";

import {
  TH_CHAT_SPEC,
  thChatFileSchema,
  type ThChatFile,
} from "@tavern/shared";

import {
  parsePreset,
  parseWorldBook,
  parseRegexScripts,
  parseCharacterCard,
  type STCharacterCard,
  parseChatFile,
  groupMessagesIntoFloors,
  parseSendDate,
  type FloorGroup,
} from "@tavern/adapters-sillytavern";

import type { DatabaseConnection } from "../db/client.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import {
  presets,
  worldbooks,
  worldbookEntries,
  regexProfiles,
  sessions,
  floors,
  messagePages,
  messages,
  characters,
  characterVersions,
} from "../db/schema.js";
import { memoryItems, memoryEdges, runtimeScopeStates } from "../db/schema.js";
import { parseWithSchema, sendError, parseJsonField, stringifyJsonField } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { type JsonRecord, toPresetEditorDocument, toRawPresetFromEditor } from "../lib/preset-utils.js";
import { executeWithSqliteBusyRetry, ResourceBusyError } from "../lib/retry.js";
import { VariableService } from "../services/variable-service.js";
import { VariableServiceError } from "../services/variable-service-errors.js";
import { LocalChatTransferArtifactStore } from "../services/chat-transfer-artifacts.js";
import { ChatTransferJobScheduler } from "../services/chat-transfer-job-scheduler.js";
import { MEMORY_RUNTIME_SCOPE_TYPE, buildMemoryRuntimeScopeKey } from "../services/memory-runtime-job-definitions.js";
import {
  executeResourceWrite as executeResourceWriteOrThrow,
  ResourceWriteRouteError,
  withResourceWriteCas,
  assertRevisionWriteApplied,
} from "../services/resource-write.js";

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

const importChatSchema = z.object({
  /** jsonl 文件内容字符串 */
  data: z.string().min(1, "JSONL content is required"),
  /** 绑定到已有角色（可选） */
  character_id: z.string().min(1).optional(),
  /** 会话标题（可选） */
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
  expected_version: z.number().int().positive().optional(),
  expected_updated_at: z.number().int().nonnegative().optional()
});

const updateWorldbookSchema = z.object({
  name: z.string().trim().min(1),
  data: z.record(z.unknown()),
  expected_version: z.number().int().positive().optional(),
  expected_updated_at: z.number().int().nonnegative().optional()
});

const updateRegexProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  data: z.array(z.record(z.unknown())),
  expected_version: z.number().int().positive().optional(),
  expected_updated_at: z.number().int().nonnegative().optional(),
});

const resourceDeleteQuerySchema = z.object({
  expected_version: z.coerce.number().int().positive().optional(),
});


const MAX_CHARACTER_IMPORT_BYTES = 200_000;
const DEFAULT_CHAT_IMPORT_MAX_BYTES = 5_000_000;

const resourceListItemExample = {
  id: "preset_story",
  name: "Story Preset",
  source: "sillytavern",
  created_at: 1735689600000,
  version: 3,
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
  expected_version: 3,
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
  expected_version: 3,
  expected_updated_at: 1735689660000,
} as const;

const worldbookUpdateResponseExample = {
  data: {
    id: "wb_kingdom",
    name: "Kingdom Lore",
    source: "sillytavern",
    created_at: 1735689600000,
    updated_at: 1735689720000,
    version: 4,
  },
} as const;

const regexProfileUpdateBodyExample = {
  name: "Safety Filters",
  data: [
    {
      scriptName: "trim_whitespace",
      find: "\\s+$",
      replace: "",
    },
  ],
  expected_version: 2,
  expected_updated_at: 1735689660000,
} as const;

const regexProfileUpdateResponseExample = {
  data: {
    id: "regex_safe",
    name: "Safety Filters",
    source: "sillytavern",
    created_at: 1735689600000,
    updated_at: 1735689720000,
    version: 3,
  },
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
  required: ["id", "name", "source", "created_at", "updated_at", "version"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    source: { type: "string" },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
    version: { type: "integer", minimum: 1 }
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

const importChatBodyExample = {
  data: '{"chat_metadata":{},"user_name":"unused","character_name":"unused"}\n{"name":"User","is_user":true,"mes":"Hello"}\n{"name":"Alice","is_user":false,"mes":"Hi there!","swipes":["Hi there!","Hey!"]}',
  character_id: "char_abc123",
  title: "Imported Chat",
};

const createChatImportJobResponseExample = {
  data: {
    job_id: "ctj_import_demo",
    status: "pending",
    job_kind: "import_chat",
    format: "sillytavern_jsonl",
  },
};

const importChatResponseExample = {
  data: {
    session_id: "sess_abc123",
    title: "Imported Chat",
    floor_count: 1,
    message_count: 2,
    swipe_count: 2,
    skipped_lines: 0,
    import_source: "sillytavern_jsonl",
  },
};

const importChatBodyJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: { type: "string", minLength: 1 },
    character_id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1, maxLength: 200 },
  },
  examples: [importChatBodyExample],
  additionalProperties: false,
} as const;

const importChatResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["session_id", "title", "floor_count", "message_count", "format"],
      properties: {
        session_id: { type: "string" },
        title: { type: "string" },
        floor_count: { type: "integer", minimum: 0 },
        message_count: { type: "integer", minimum: 0 },
        swipe_count: { type: "integer", minimum: 0 },
        skipped_lines: { type: "integer", minimum: 0 },
        import_source: { type: "string" },
        format: { type: "string", enum: ["thchat", "sillytavern_jsonl"] },
      },
      additionalProperties: true,
    },
  },
  examples: [importChatResponseExample],
  additionalProperties: false,
} as const;

const createChatImportJobResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["job_id", "status", "job_kind"],
      properties: {
        job_id: { type: "string" },
        status: { type: "string", enum: ["pending"] },
        job_kind: { type: "string", enum: ["import_chat"] },
        format: {
          anyOf: [
            { type: "string", enum: ["thchat", "sillytavern_jsonl"] },
            { type: "null" },
          ],
        },
      },
      additionalProperties: false,
    },
  },
  examples: [createChatImportJobResponseExample],
  additionalProperties: false,
} as const;

const presetEditorBodyJsonSchema = {
  type: "object",
  required: ["name", "editor"],
  properties: {
    name: { type: "string", minLength: 1 },
    expected_version: { type: "integer", minimum: 1 },
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
    expected_version: { type: "integer", minimum: 1 },
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

const regexProfileUpdateBodyJsonSchema = {
  type: "object",
  required: ["name", "data"],
  properties: {
    name: { type: "string", minLength: 1 },
    data: { type: "array", items: { type: "object", additionalProperties: true } },
    expected_version: { type: "integer", minimum: 1 },
    expected_updated_at: { type: "integer", minimum: 0 },
  },
  examples: [regexProfileUpdateBodyExample],
  additionalProperties: false,
} as const;

const regexProfileUpdateResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: resourceListItemJsonSchema },
  examples: [regexProfileUpdateResponseExample],
  additionalProperties: false,
} as const;

const resourceDeleteQueryJsonSchema = {
  type: "object",
  properties: {
    expected_version: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
} as const;

type ResourceConcurrencyBody = {
  expected_version?: number;
  expected_updated_at?: number;
};

type VersionedResourceRow = {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  version: number;
};

type ResourceRouteMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "error"; statusCode: number; code: string; message: string };

const RESOURCE_BUSY_MESSAGE = "Resource is temporarily busy, please retry";

function toResourceListItem(row: VersionedResourceRow) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    version: row.version,
  };
}

function resolveExpectedResourceVersion(
  body: ResourceConcurrencyBody,
  row: Pick<VersionedResourceRow, "updatedAt" | "version">,
  conflictCode: string,
  resourceName: string
): { ok: true; expectedVersion: number } | { ok: false; statusCode: number; code: string; message: string } {
  if (body.expected_version !== undefined) {
    return { ok: true, expectedVersion: body.expected_version };
  }

  if (body.expected_updated_at !== undefined) {
    if (body.expected_updated_at !== row.updatedAt) {
      return { ok: false, statusCode: 409, code: conflictCode, message: `${resourceName} has been modified by another operation` };
    }
    return { ok: true, expectedVersion: row.version };
  }

  return { ok: false, statusCode: 400, code: "validation_error", message: "expected_version or expected_updated_at is required" };
}

async function executeResourceWrite<T>(
  task: () => ResourceRouteMutationResult<T> | Promise<ResourceRouteMutationResult<T>>
): Promise<ResourceRouteMutationResult<T>> {
  try {
    return await executeWithSqliteBusyRetry(async () => await task());
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      return { kind: "error", statusCode: 503, code: "resource_busy", message: RESOURCE_BUSY_MESSAGE };
    }

    throw error;
  }
}

export interface ImportRoutesOptions {
  artifactDir?: string;
  importMaxBytes?: number;
  eventBus?: CoreEventBus;
}

function sendImportWriteError(reply: Parameters<typeof sendError>[0], error: ResourceWriteRouteError) {
  return sendError(reply, error.statusCode, error.code, error.message, error.details);
}

function createRegexProfileConflictError() {
  return new ResourceWriteRouteError(409, "regex_profile_conflict", "Regex profile has been modified by another operation");
}

function createRegexProfileNotFoundError() {
  return new ResourceWriteRouteError(404, "regex_profile_not_found", "Regex profile not found");
}

function detectQueuedChatImportFormat(data: string): "thchat" | "sillytavern_jsonl" | undefined {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && (parsed as { spec?: unknown }).spec === TH_CHAT_SPEC) {
      return "thchat";
    }
  } catch {
    // ignore
  }

  return undefined;
}

async function resolveImportCharacterBinding(
  db: DatabaseConnection["db"],
  accountId: string,
  requestedCharacterId?: string,
): Promise<{ characterId: string | null; characterVersionId: string | null; characterSnapshotJson: string | null }> {
  if (!requestedCharacterId) {
    return {
      characterId: null,
      characterVersionId: null,
      characterSnapshotJson: null,
    };
  }

  const charRow = await db.select({
    id: characters.id,
  }).from(characters).where(
    and(eq(characters.id, requestedCharacterId), eq(characters.accountId, accountId))
  ).get();

  if (!charRow) {
    throw new Error(`Character ${requestedCharacterId} not found`);
  }

  const versionRow = await db.select({
    id: characterVersions.id,
    dataJson: characterVersions.dataJson,
  }).from(characterVersions).where(
    eq(characterVersions.characterId, charRow.id)
  ).orderBy(asc(characterVersions.createdAt)).limit(1).get();

  return {
    characterId: charRow.id,
    characterVersionId: versionRow?.id ?? null,
    characterSnapshotJson: versionRow?.dataJson ?? null,
  };
}

// ── Route Registration ────────────────────────────────

export async function registerImportRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: ImportRoutesOptions = {},
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
        400: errorResponseJsonSchema,
        503: errorResponseJsonSchema
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

    const auth = getRequestAuthContext(request);
    const id = nanoid();
    const name = parsed.data.name || "Unnamed Preset";
    const now = Date.now();

    const mutation = await executeResourceWrite(async () => {
      await db.insert(presets).values({
        id,
        name,
        source: "sillytavern",
        accountId: auth.accountId,
        dataJson: JSON.stringify(parsed.data.data),
        createdAt: now,
        updatedAt: now,
      });

      return {
        kind: "ok",
        data: { id, name, source: "sillytavern" },
      };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.code(201).send({
      data: mutation.data,
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
        400: errorResponseJsonSchema,
        503: errorResponseJsonSchema
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

    const auth = getRequestAuthContext(request);
    const id = nanoid();
    const name = parsed.data.name || stWorldBook.name || "Unnamed Worldbook";
    const now = Date.now();

    const { entries, name: _wbName, ...globalSettings } = stWorldBook;

    const mutation = await executeResourceWrite(async () => {
      db.transaction((tx) => {
        tx.insert(worldbooks).values({
          id,
          name,
          source: "sillytavern",
          accountId: auth.accountId,
          dataJson: JSON.stringify(globalSettings),
          createdAt: now,
          updatedAt: now,
        }).run();

        if (entries.length > 0) {
          tx.insert(worldbookEntries).values(
            entries.map((entry, index) => ({
              id: nanoid(),
              worldbookId: id,
              uid: entry.uid ?? index,
              comment: entry.comment ?? "",
              content: entry.content ?? "",
              keysJson: JSON.stringify(entry.key ?? []),
              keysSecondaryJson: JSON.stringify(entry.keysecondary ?? []),
              selective: entry.selective ?? true,
              selectiveLogic: entry.selectiveLogic ?? 0,
              constant: entry.constant ?? false,
              position: entry.position ?? 0,
              order: entry.order ?? 100,
              depth: entry.depth ?? 4,
              role: entry.role ?? 0,
              disable: entry.disable ?? false,
              scanDepth: entry.scanDepth ?? null,
              caseSensitive: entry.caseSensitive ?? null,
              matchWholeWords: entry.matchWholeWords ?? null,
              createdAt: now,
              updatedAt: now,
            }))
          ).run();
        }
      });

      return {
        kind: "ok",
        data: { id, name, source: "sillytavern" },
      };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.code(201).send({
      data: mutation.data,
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
        400: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
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

    const auth = getRequestAuthContext(request);
    const id = nanoid();
    const name = parsed.data.name;

    try {
      const created = await executeResourceWriteOrThrow(() => {
        const now = Date.now();
        db.insert(regexProfiles).values({
          id,
          name,
          source: "sillytavern",
          accountId: auth.accountId,
          dataJson: JSON.stringify(stScripts),
          createdAt: now,
          updatedAt: now,
        }).run();

        return { id, name, source: "sillytavern", script_count: stScripts.length };
      });

      return reply.code(201).send({
        data: created,
      });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendImportWriteError(reply, error);
      }

      throw error;
    }
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
        413: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      }
    }
  }, async (request, reply) => {
    const parsed = parseWithSchema(importCharacterSchema, request.body, reply);
    if (!parsed.ok) return;

    const auth = getRequestAuthContext(request);
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
      try {
        const characterBinding = await executeResourceWriteOrThrow(() => createCharacterFromImport(db, {
          name: characterCard.name,
          accountId: auth.accountId,
          snapshot,
          source: "sillytavern",
          now: Date.now(),
        }));

        return reply.code(201).send({
          data: {
            create_session: false,
            character: toCharacterResponse(characterCard),
            character_id: characterBinding.characterId,
            character_version_id: characterBinding.characterVersionId,
          }
        });
      } catch (error) {
        if (error instanceof ResourceWriteRouteError) {
          return sendImportWriteError(reply, error);
        }

        throw error;
      }
    }

    try {
      const imported = await executeResourceWriteOrThrow(() => createCharacterWithSessionFromImport(db, {
        name: characterCard.name,
        accountId: auth.accountId,
        snapshot,
        source: "sillytavern",
        title: parsed.data.title ?? characterCard.name,
        now: Date.now(),
      }));

      return reply.code(201).send({
        data: {
          create_session: true,
          character: toCharacterResponse(characterCard),
          session: imported.session
        }
      });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendImportWriteError(reply, error);
      }

      throw error;
    }
  });

  // ──────────────────────────────────────────────────────
  // POST /import/chat — 导入聊天记录（自动识别 .thchat / .jsonl）
  // ──────────────────────────────────────────────────────

  app.post("/import/chat/jobs", {
    schema: {
      tags: ["imports"],
      summary: "Create async chat import job",
      description: "高级开发特性。该接口会把聊天导入写入 Background Job Runtime，主要用于开发、调试、运维和自动化工具。普通交互式导入优先使用同步 `POST /import/chat`。",
      operationId: "createImportChatJob",
      body: importChatBodyJsonSchema,
      response: {
        202: createChatImportJobResponseJsonSchema,
        400: errorResponseJsonSchema,
        413: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(importChatSchema, request.body, reply);
    if (!parsed.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const inputBytes = Buffer.byteLength(parsed.data.data, "utf-8");
    const maxBytes = options.importMaxBytes ?? DEFAULT_CHAT_IMPORT_MAX_BYTES;
    if (inputBytes > maxBytes) {
      return sendError(
        reply,
        413,
        "import_payload_too_large",
        `Chat import payload exceeds ${maxBytes} bytes`,
      );
    }

    let characterBinding;
    try {
      characterBinding = await resolveImportCharacterBinding(db, auth.accountId, parsed.data.character_id);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Character ")) {
        return sendError(reply, 400, "character_not_found", error.message);
      }
      throw error;
    }

    const scheduler = new ChatTransferJobScheduler({
      eventBus: options.eventBus,
    });
    const artifactStore = new LocalChatTransferArtifactStore(options.artifactDir ?? "data/chat-transfer-artifacts");
    const createdAt = Date.now();
    const jobId = scheduler.createJobId("import_chat");
    const inputArtifactPath = artifactStore.buildJobArtifactPath(jobId, "input.txt");
    const detectedFormat = detectQueuedChatImportFormat(parsed.data.data);

    await artifactStore.writeText(inputArtifactPath, parsed.data.data);

    try {
      await executeResourceWriteOrThrow(() => db.transaction((tx) => scheduler.enqueueImportChat(tx, {
        accountId: auth.accountId,
        title: parsed.data.title,
        characterId: characterBinding.characterId,
        characterVersionId: characterBinding.characterVersionId,
        characterSnapshotJson: characterBinding.characterSnapshotJson,
        inputArtifactPath,
        inputBytes,
        detectedFormat,
        createdAt,
        jobId,
      })));

      return reply.code(202).send({
        data: {
          job_id: jobId,
          status: "pending",
          job_kind: "import_chat",
          format: detectedFormat ?? null,
        },
      });
    } catch (error) {
      await artifactStore.delete(inputArtifactPath);
      if (error instanceof ResourceWriteRouteError) {
        return sendImportWriteError(reply, error);
      }
      throw error;
    }
  });

  /**
   * POST /import/chat
   *
   * 支持两种格式：
   * - .thchat（原生格式，JSON）：自动识别 spec === "tavern_headless_chat"
   * - .jsonl（SillyTavern 格式）：其他情况走 ST 解析
   */
  app.post("/import/chat", {
    schema: {
      tags: ["imports"],
      summary: "Import chat file (.thchat or .jsonl)",
      operationId: "importChat",
      body: importChatBodyJsonSchema,
      response: {
        201: importChatResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(importChatSchema, request.body, reply);
    if (!parsed.ok) return;

    const auth = getRequestAuthContext(request);
    const now = Date.now();

    // ── 自动格式识别 ──
    let detectedThChat: ThChatFile | null = null;
    try {
      const jsonObj = JSON.parse(parsed.data.data);
      if (jsonObj && typeof jsonObj === "object" && jsonObj.spec === TH_CHAT_SPEC) {
        // 验证 schema
        const validation = thChatFileSchema.safeParse(jsonObj);
        if (!validation.success) {
          return sendError(reply, 400, "import_parse_error",
            `Invalid .thchat file: ${validation.error.issues.map(i => i.message).join("; ")}`);
        }
        // 检查 spec_version 主版本号
        const majorVersion = parseInt(validation.data.spec_version.split(".")[0] ?? "0", 10);
        if (majorVersion !== 1) {
 return sendError(reply, 400, "import_unsupported_version",
            `Unsupported spec_version "${validation.data.spec_version}". Only major version 1 is supported.`);
        }
        detectedThChat = validation.data;
      }
    } catch {
      // JSON.parse 失败 → 不是 JSON → 走 ST jsonl 路径
    }

    // ── 原生格式导入路径 ──
    if (detectedThChat) {
      return handleThChatImport(db, detectedThChat, parsed.data, auth.accountId, now, reply);
    }

    // ── ST jsonl 导入路径（原有逻辑） ──
    let chatData: ReturnType<typeof parseChatFile>;
    try {
      chatData = parseChatFile(parsed.data.data);
    } catch (error) {
      return sendError(reply, 400, "import_parse_error",
        `Failed to parse chat file: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (chatData.messages.length === 0) {
      return sendError(reply, 400, "import_empty", "Chat file contains no messages");
    }

    let characterBinding;
    try {
      characterBinding = await resolveImportCharacterBinding(db, auth.accountId, parsed.data.character_id);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Character ")) {
        return sendError(reply, 400, "character_not_found", error.message);
      }
      throw error;
    }

    // 3. 消息分组
    const floorGroups = groupMessagesIntoFloors(chatData.messages);

    // 4. 推断标题
    const title = parsed.data.title
      ?? chatData.header.character_name
      ?? chatData.header.name
      ?? "Imported Chat";

    // 5. 事务写入
    const result = createSessionFromChatImport(db, {
      header: chatData.header,
      floorGroups,
      accountId: auth.accountId,
      characterId: characterBinding.characterId,
      characterVersionId: characterBinding.characterVersionId,
      characterSnapshotJson: characterBinding.characterSnapshotJson,
      title,
      now,
    });

    return reply.code(201).send({
      data: {
        session_id: result.sessionId,
        title,
        floor_count: result.floorCount,
        message_count: result.messageCount,
        swipe_count: result.swipeCount,
        skipped_lines: chatData.skippedLines,
        import_source: "sillytavern_jsonl",
        format: "sillytavern_jsonl",
      },
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
  }, async (request, reply) => {
    const auth = getRequestAuthContext(request);
    const rows = await db
      .select({
        id: presets.id,
        name: presets.name,
        source: presets.source,
        createdAt: presets.createdAt,
        updatedAt: presets.updatedAt,
        version: presets.version,
      })
      .from(presets)
      .where(eq(presets.accountId, auth.accountId));

    return reply.send({
      data: rows.map(toResourceListItem),
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

    const auth = getRequestAuthContext(request);
    const [row] = await db
      .select()
      .from(presets)
      .where(and(eq(presets.id, parsed.data.id), eq(presets.accountId, auth.accountId)));

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
        version: row.version,
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

    const auth = getRequestAuthContext(request);
    const [row] = await db
      .select()
      .from(presets)
      .where(and(eq(presets.id, parsed.data.id), eq(presets.accountId, auth.accountId)));

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
          version: row.version,
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
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const paramsParsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!paramsParsed.ok) return;
    const bodyParsed = parseWithSchema(updatePresetSchema, request.body, reply);
    if (!bodyParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const mutation = await executeResourceWrite(async () => {
      const [row] = await db
        .select()
        .from(presets)
        .where(and(eq(presets.id, paramsParsed.data.id), eq(presets.accountId, auth.accountId)));

      if (!row) {
        return { kind: "error", statusCode: 404, code: "preset_not_found", message: "Preset not found" };
      }

      let nextPreset: JsonRecord;
      try {
        nextPreset = toRawPresetFromEditor(bodyParsed.data.editor);
      } catch (error) {
        return {
          kind: "error",
          statusCode: 400,
          code: "preset_validation_error",
          message: error instanceof Error ? error.message : "Preset validation failed",
        };
      }

      const expectedVersionResult = resolveExpectedResourceVersion(bodyParsed.data, row, "preset_conflict", "Preset");
      if (!expectedVersionResult.ok) {
        return { kind: "error", statusCode: expectedVersionResult.statusCode, code: expectedVersionResult.code, message: expectedVersionResult.message };
      }

      const now = Date.now();
      const nextVersion = row.version + 1;
      const updateResult = db.update(presets).set({
        name: bodyParsed.data.name,
        dataJson: JSON.stringify(nextPreset),
        updatedAt: now,
        version: nextVersion,
      }).where(and(
        eq(presets.id, row.id),
        eq(presets.accountId, auth.accountId),
        eq(presets.version, expectedVersionResult.expectedVersion)
      )).run();

      if (updateResult.changes === 0) {
        return { kind: "error", statusCode: 409, code: "preset_conflict", message: "Preset has been modified by another operation" };
      }

      return {
        kind: "ok",
        data: toResourceListItem({ ...row, name: bodyParsed.data.name, updatedAt: now, version: nextVersion })
      };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({
      data: mutation.data
    });
  });

  /** DELETE /presets/:id — 删除预设 */
  app.delete("/presets/:id", {
    schema: {
      tags: ["imports"],
      summary: "Delete imported preset",
      operationId: "deleteImportedPreset",
      params: idParamsJsonSchema,
      querystring: resourceDeleteQueryJsonSchema,
      response: {
        204: { type: "null" },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const paramsParsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!paramsParsed.ok) return;
    const queryParsed = parseWithSchema(resourceDeleteQuerySchema, request.query, reply);
    if (!queryParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const mutation = await executeResourceWrite(async () => {
      if (queryParsed.data.expected_version === undefined) {
        await db
          .delete(presets)
          .where(and(eq(presets.id, paramsParsed.data.id), eq(presets.accountId, auth.accountId)));

        return { kind: "ok", data: undefined };
      }

      const [row] = await db
        .select()
        .from(presets)
        .where(and(eq(presets.id, paramsParsed.data.id), eq(presets.accountId, auth.accountId)));

      if (!row) {
        return { kind: "error", statusCode: 404, code: "preset_not_found", message: "Preset not found" };
      }

      if (row.version !== queryParsed.data.expected_version) {
        return { kind: "error", statusCode: 409, code: "preset_conflict", message: "Preset has been modified by another operation" };
      }

      const deleteResult = db
        .delete(presets)
        .where(and(
          eq(presets.id, paramsParsed.data.id),
          eq(presets.accountId, auth.accountId),
          eq(presets.version, queryParsed.data.expected_version)
        ))
        .run();

      if (deleteResult.changes === 0) {
        return { kind: "error", statusCode: 409, code: "preset_conflict", message: "Preset has been modified by another operation" };
      }

      return { kind: "ok", data: undefined };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

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
  }, async (request, reply) => {
    const auth = getRequestAuthContext(request);
    const rows = await db
      .select({
        id: worldbooks.id,
        name: worldbooks.name,
        source: worldbooks.source,
        createdAt: worldbooks.createdAt,
        updatedAt: worldbooks.updatedAt,
        version: worldbooks.version,
      })
      .from(worldbooks)
      .where(eq(worldbooks.accountId, auth.accountId));

    return reply.send({
      data: rows.map(toResourceListItem),
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

    const auth = getRequestAuthContext(request);
    const [row] = await db
      .select()
      .from(worldbooks)
      .where(and(eq(worldbooks.id, parsed.data.id), eq(worldbooks.accountId, auth.accountId)));

    if (!row) {
      return sendError(reply, 404, "not_found", "Worldbook not found");
    }

    const entryRows = await db
      .select()
      .from(worldbookEntries)
      .where(eq(worldbookEntries.worldbookId, row.id))
      .orderBy(asc(worldbookEntries.order));

    const globalSettings = parseJsonField(row.dataJson) as Record<string, unknown> | null;
    const assembledData = {
      name: row.name,
      entries: entryRows.map((e) => ({
        uid: e.uid,
        key: parseJsonField(e.keysJson),
        keysecondary: parseJsonField(e.keysSecondaryJson),
        selective: e.selective,
        selectiveLogic: e.selectiveLogic,
        constant: e.constant,
        content: e.content,
        comment: e.comment,
        position: e.position,
        order: e.order,
        depth: e.depth,
        role: e.role,
        disable: e.disable,
        scanDepth: e.scanDepth ?? null,
        caseSensitive: e.caseSensitive ?? null,
        matchWholeWords: e.matchWholeWords ?? null,
      })),
      ...(globalSettings && typeof globalSettings === "object" ? globalSettings : {}),
    };

    return reply.send({
      data: {
        id: row.id,
        name: row.name,
        source: row.source,
        data: assembledData,
        created_at: row.createdAt,
        version: row.version,
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
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const paramsParsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!paramsParsed.ok) return;
    const bodyParsed = parseWithSchema(updateWorldbookSchema, request.body, reply);
    if (!bodyParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const mutation = await executeResourceWrite(async () => {
      const [row] = await db
        .select()
        .from(worldbooks)
        .where(and(eq(worldbooks.id, paramsParsed.data.id), eq(worldbooks.accountId, auth.accountId)));

      if (!row) {
        return { kind: "error", statusCode: 404, code: "worldbook_not_found", message: "Worldbook not found" };
      }

      let nextWorldbook;
      try {
        nextWorldbook = parseWorldBook(bodyParsed.data.data);
      } catch (error) {
        return {
          kind: "error",
          statusCode: 400,
          code: "worldbook_validation_error",
          message: error instanceof Error ? error.message : "Worldbook validation failed",
        };
      }

      const expectedVersionResult = resolveExpectedResourceVersion(bodyParsed.data, row, "worldbook_conflict", "Worldbook");
      if (!expectedVersionResult.ok) {
        return { kind: "error", statusCode: expectedVersionResult.statusCode, code: expectedVersionResult.code, message: expectedVersionResult.message };
      }

      const now = Date.now();
      const nextVersion = row.version + 1;
      const { entries, name: _wbName, ...globalSettings } = nextWorldbook;
      let updateApplied = false;

      db.transaction((tx) => {
        const updateResult = tx
          .update(worldbooks)
          .set({
            name: bodyParsed.data.name,
            dataJson: JSON.stringify(globalSettings),
            updatedAt: now,
            version: nextVersion,
          })
          .where(and(eq(worldbooks.id, row.id), eq(worldbooks.accountId, auth.accountId), eq(worldbooks.version, expectedVersionResult.expectedVersion)))
          .run();

        if (updateResult.changes === 0) {
          return;
        }
        updateApplied = true;

        tx
          .delete(worldbookEntries)
          .where(eq(worldbookEntries.worldbookId, row.id))
          .run();

        if (entries.length > 0) {
          tx.insert(worldbookEntries).values(
            entries.map((entry, index) => ({
              id: nanoid(),
              worldbookId: row.id,
              uid: entry.uid ?? index,
              comment: entry.comment ?? "",
              content: entry.content ?? "",
              keysJson: JSON.stringify(entry.key ?? []),
              keysSecondaryJson: JSON.stringify(entry.keysecondary ?? []),
              selective: entry.selective ?? true,
              selectiveLogic: entry.selectiveLogic ?? 0,
              constant: entry.constant ?? false,
              position: entry.position ?? 0,
              order: entry.order ?? 100,
              depth: entry.depth ?? 4,
              role: entry.role ?? 0,
              disable: entry.disable ?? false,
              scanDepth: entry.scanDepth ?? null,
              caseSensitive: entry.caseSensitive ?? null,
              matchWholeWords: entry.matchWholeWords ?? null,
              createdAt: now,
              updatedAt: now,
            }))
          ).run();
        }
      });

      if (!updateApplied) {
        return { kind: "error", statusCode: 409, code: "worldbook_conflict", message: "Worldbook has been modified by another operation" };
      }

      return {
        kind: "ok",
        data: toResourceListItem({ ...row, name: bodyParsed.data.name, updatedAt: now, version: nextVersion })
      };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

    return reply.send({
      data: mutation.data
    });
  });

  /** DELETE /worldbooks/:id — 删除世界书 */
  app.delete("/worldbooks/:id", {
    schema: {
      tags: ["imports"],
      summary: "Delete imported worldbook",
      operationId: "deleteImportedWorldbook",
      params: idParamsJsonSchema,
      querystring: resourceDeleteQueryJsonSchema,
      response: {
        204: { type: "null" },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema
      }
    }
  }, async (request, reply) => {
    const paramsParsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!paramsParsed.ok) return;
    const queryParsed = parseWithSchema(resourceDeleteQuerySchema, request.query, reply);
    if (!queryParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const mutation = await executeResourceWrite(async () => {
      if (queryParsed.data.expected_version === undefined) {
        await db
          .delete(worldbooks)
          .where(and(eq(worldbooks.id, paramsParsed.data.id), eq(worldbooks.accountId, auth.accountId)));

        return { kind: "ok", data: undefined };
      }

      const [row] = await db
        .select()
        .from(worldbooks)
        .where(and(eq(worldbooks.id, paramsParsed.data.id), eq(worldbooks.accountId, auth.accountId)));

      if (!row) {
        return { kind: "error", statusCode: 404, code: "worldbook_not_found", message: "Worldbook not found" };
      }

      if (row.version !== queryParsed.data.expected_version) {
        return { kind: "error", statusCode: 409, code: "worldbook_conflict", message: "Worldbook has been modified by another operation" };
      }

      const deleteResult = db
        .delete(worldbooks)
        .where(and(
          eq(worldbooks.id, paramsParsed.data.id),
          eq(worldbooks.accountId, auth.accountId),
          eq(worldbooks.version, queryParsed.data.expected_version)
        ))
        .run();

      if (deleteResult.changes === 0) {
        return { kind: "error", statusCode: 409, code: "worldbook_conflict", message: "Worldbook has been modified by another operation" };
      }

      return { kind: "ok", data: undefined };
    });

    if (mutation.kind === "error") {
      return sendError(reply, mutation.statusCode, mutation.code, mutation.message);
    }

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
  }, async (request, reply) => {
    const auth = getRequestAuthContext(request);
    const rows = await db
      .select({
        id: regexProfiles.id,
        name: regexProfiles.name,
        source: regexProfiles.source,
        createdAt: regexProfiles.createdAt,
        updatedAt: regexProfiles.updatedAt,
        version: regexProfiles.version,
      })
      .from(regexProfiles)
      .where(eq(regexProfiles.accountId, auth.accountId));

    return reply.send({
      data: rows.map(toResourceListItem),
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

    const auth = getRequestAuthContext(request);
    const [row] = await db
      .select()
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, parsed.data.id), eq(regexProfiles.accountId, auth.accountId)));

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
        version: row.version,
        updated_at: row.updatedAt,
      },
    });
  });

  /** PUT /regex-profiles/:id — 同 ID 更新正则配置 */
  app.put("/regex-profiles/:id", {
    schema: {
      tags: ["imports"],
      summary: "Update imported regex profile by id",
      operationId: "updateImportedRegexProfile",
      params: idParamsJsonSchema,
      body: regexProfileUpdateBodyJsonSchema,
      response: {
        200: regexProfileUpdateResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      }
    }
  }, async (request, reply) => {
    const paramsParsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!paramsParsed.ok) return;
    const bodyParsed = parseWithSchema(updateRegexProfileSchema, request.body, reply);
    if (!bodyParsed.ok) return;

    const auth = getRequestAuthContext(request);
    let stScripts;
    try {
      stScripts = parseRegexScripts(bodyParsed.data.data);
    } catch (error) {
      return sendError(
        reply,
        400,
        "regex_validation_error",
        `Failed to parse regex scripts: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    try {
      const updated = await withResourceWriteCas({
        db,
        expectedRevision: bodyParsed.data.expected_version,
        load: (tx) => tx
          .select()
          .from(regexProfiles)
          .where(and(eq(regexProfiles.id, paramsParsed.data.id), eq(regexProfiles.accountId, auth.accountId)))
          .get(),
        getRevision: (row) => row.version,
        onMissing: createRegexProfileNotFoundError,
        onRevisionConflict: createRegexProfileConflictError,
        validateLoaded: (row) => {
          if (
            bodyParsed.data.expected_updated_at !== undefined
            && bodyParsed.data.expected_updated_at !== row.updatedAt
          ) {
            throw createRegexProfileConflictError();
          }
        },
        mutate: ({ tx, row }) => {
          const now = Date.now();
          const nextVersion = row.version + 1;
          const updateResult = tx.update(regexProfiles).set({
            name: bodyParsed.data.name,
            dataJson: JSON.stringify(stScripts),
            updatedAt: now,
            version: nextVersion,
          }).where(and(
            eq(regexProfiles.id, row.id),
            eq(regexProfiles.accountId, auth.accountId),
            eq(regexProfiles.version, row.version)
          )).run();

          assertRevisionWriteApplied(updateResult.changes, createRegexProfileConflictError);
          return toResourceListItem({ ...row, name: bodyParsed.data.name, updatedAt: now, version: nextVersion });
        }
      });

      return reply.send({ data: updated });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendImportWriteError(reply, error);
      }

      throw error;
    }
  });

  /** DELETE /regex-profiles/:id — 删除正则配置 */
  app.delete("/regex-profiles/:id", {
    schema: {
      tags: ["imports"],
      summary: "Delete imported regex profile",
      operationId: "deleteImportedRegexProfile",
      params: idParamsJsonSchema,
      querystring: resourceDeleteQueryJsonSchema,
      response: {
        204: { type: "null" },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      }
    }
  }, async (request, reply) => {
    const paramsParsed = parseWithSchema(idParamsSchema, request.params, reply);
    if (!paramsParsed.ok) return;
    const queryParsed = parseWithSchema(resourceDeleteQuerySchema, request.query, reply);
    if (!queryParsed.ok) return;

    const auth = getRequestAuthContext(request);
    try {
      if (queryParsed.data.expected_version === undefined) {
        await executeResourceWriteOrThrow(() => db
          .delete(regexProfiles)
          .where(and(eq(regexProfiles.id, paramsParsed.data.id), eq(regexProfiles.accountId, auth.accountId))));
      } else {
        await withResourceWriteCas({
          db,
          expectedRevision: queryParsed.data.expected_version,
          load: (tx) => tx
            .select()
            .from(regexProfiles)
            .where(and(eq(regexProfiles.id, paramsParsed.data.id), eq(regexProfiles.accountId, auth.accountId)))
            .get(),
          getRevision: (row) => row.version,
          onMissing: createRegexProfileNotFoundError,
          onRevisionConflict: createRegexProfileConflictError,
          mutate: ({ tx, row }) => {
            const deleteResult = tx.delete(regexProfiles).where(and(eq(regexProfiles.id, row.id), eq(regexProfiles.accountId, auth.accountId), eq(regexProfiles.version, row.version))).run();
            assertRevisionWriteApplied(deleteResult.changes, createRegexProfileConflictError);
          }
        });
      }
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendImportWriteError(reply, error);
      }

      throw error;
    }

    return reply.code(204).send();
  });
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
    accountId: string;
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
    accountId: string;
    source: string;
    snapshot: CharacterSnapshot;
    title: string;
    now: number;
  }
): { characterBinding: CharacterBindingPayload; session: ImportedSessionResponse } {
  return db.transaction((tx) => {
    const characterBinding = createCharacterFromImportInternal(tx, {
      name: input.name,
      accountId: input.accountId,
      source: input.source,
      snapshot: input.snapshot,
      now: input.now
    });

    const session = createSessionFromCharacterImportInternal(tx, {
      title: input.title,
      accountId: input.accountId,
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
    accountId: string;
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
    accountId: input.accountId,
    source: input.source,
    status: "active",
    deletedAt: null,
    revision: 0,
    latestVersionNo: 1,
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
  input: { title: string; accountId: string; characterBinding: CharacterBindingPayload; now: number }
): ImportedSessionResponse {
  const sessionId = nanoid();

  db.insert(sessions).values({
    id: sessionId,
    title: input.title,
    status: "active",
    accountId: input.accountId,
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

// ── Chat Import Helpers ─────────────────────────────────

function createSessionFromChatImport(
  db: DatabaseConnection["db"],
  input: {
    header: { chat_metadata?: Record<string, unknown> };
    floorGroups: FloorGroup[];
    accountId: string;
    characterId: string | null;
    characterVersionId: string | null;
    characterSnapshotJson: string | null;
    title: string;
    now: number;
  }
): { sessionId: string; floorCount: number; messageCount: number; swipeCount: number } {
  return db.transaction((tx) => {
    const sessionId = nanoid();
    const tokenCounter = new SimpleTokenCounter();

    // 1. 创建 session
    tx.insert(sessions).values({
      id: sessionId,
      title: input.title,
      status: "active",
      accountId: input.accountId,
      characterId: input.characterId,
      characterVersionId: input.characterVersionId,
      characterSnapshotJson: input.characterSnapshotJson,
      characterSyncPolicy: "pin",
      presetId: null,
      regexProfileId: null,
      worldbookProfileId: null,
      modelProvider: null,
      modelName: null,
      modelParamsJson: null,
      metadataJson: stringifyJsonField({
        st_chat_metadata: input.header.chat_metadata ?? {},
        import_source: "sillytavern_jsonl",
        imported_at: input.now,
      }),
      createdAt: input.now,
      updatedAt: input.now,
    }).run();

    let totalMessageCount = 0;
    let totalSwipeCount = 0;

    // 2. 遍历楼层组
    for (const group of input.floorGroups) {
      const floorId = nanoid();
      let floorTokenIn = 0;
      let floorTokenOut = 0;

      tx.insert(floors).values({
        id: floorId,
        sessionId,
        floorNo: group.floorNo,
        branchId: "main",
        parentFloorId: null,
        state: "committed",
        metadataJson: null,
        tokenIn: 0, // 先占位，后面更新
        tokenOut: 0,
        createdAt: input.now,
        updatedAt: input.now,
      }).run();

      // 3. 遍历每条消息
      for (const msg of group.messages) {
        const hasSwipes = msg.swipes && msg.swipes.length > 1;

        if (hasSwipes) {
          // 多个 swipe → 多个 message_page
          const swipes = msg.swipes!;
          const activeIndex = msg.swipeId ?? 0;
          totalSwipeCount += swipes.length;

          for (let i = 0; i < swipes.length; i++) {
            const pageId = nanoid();
            const isActive = i === activeIndex;
            const content = swipes[i]!;
            const tokens = tokenCounter.count(content);

            tx.insert(messagePages).values({
              id: pageId,
              floorId,
              pageNo: msg.pageNo,
              pageKind: msg.pageKind,
              isActive,
              version: i + 1,
              checksum: null,
              createdAt: input.now,
              updatedAt: input.now,
            }).run();

            tx.insert(messages).values({
              id: nanoid(),
              pageId,
              seq: 0,
              role: msg.role === 'system' ? 'system' : msg.role,
              content,
              contentFormat: "text",
              tokenCount: tokens,
              isHidden: msg.isHidden,
              source: `st_import:${msg.name}`,
              createdAt: msg.sendDate,
            }).run();

            // 只统计 active 页的 token
            if (isActive) {
              if (msg.role === 'user') floorTokenIn += tokens;
              else floorTokenOut += tokens;
            }
            totalMessageCount++;
          }
        } else {
          // 单条消息 → 单个 page
          const pageId = nanoid();
          const content = msg.content;
          const tokens = tokenCounter.count(content);

          tx.insert(messagePages).values({
            id: pageId,
            floorId,
            pageNo: msg.pageNo,
            pageKind: msg.pageKind,
            isActive: true,
            version: 1,
            checksum: null,
            createdAt: input.now,
            updatedAt: input.now,
          }).run();

          tx.insert(messages).values({
            id: nanoid(),
            pageId,
            seq: 0,
            role: msg.role === 'system' ? 'system' : msg.role,
            content,
            contentFormat: "text",
            tokenCount: tokens,
            isHidden: msg.isHidden,
            source: `st_import:${msg.name}`,
            createdAt: msg.sendDate,
          }).run();

          if (msg.role === 'user') floorTokenIn += tokens;
          else floorTokenOut += tokens;
          totalMessageCount++;
        }
      }

      // 更新楼层 token 统计
      tx.update(floors).set({
        tokenIn: floorTokenIn,
        tokenOut: floorTokenOut,
      }).where(eq(floors.id, floorId)).run();
    }

    return {
      sessionId,
      floorCount: input.floorGroups.length,
      messageCount: totalMessageCount,
      swipeCount: totalSwipeCount,
    };
  });
}

// ── ThChat Import Helpers ────────────────────────────────

/**
 * 处理 .thchat 原生格式导入路由逻辑。
 * 从主 handler 中提取以保持可读性。
 */
async function handleThChatImport(
  db: DatabaseConnection["db"],
  file: ThChatFile,
  params: { character_id?: string; title?: string },
  accountId: string,
  now: number,
  reply: import("fastify").FastifyReply,
) {
  // 构建 _original_id → new nanoid 映射表
  const idMap = new Map<string, string>();
  for (const floor of file.data.floors) {
    idMap.set(floor._original_id, nanoid());
    for (const page of floor.pages) {
      idMap.set(page._original_id, nanoid());
      for (const msg of page.messages) {
        idMap.set(msg._original_id, nanoid());
      }
    }
  }
  if (file.data.memories) {
    for (const item of file.data.memories.items) {
      idMap.set(item._original_id, nanoid());
    }
  }

  // 查询角色快照（如果外部传入 character_id）
  let characterId: string | null = null;
  let characterVersionId: string | null = null;

  if (params.character_id) {
    const charRow = await db.select({
      id: characters.id,
    }).from(characters).where(
      and(eq(characters.id, params.character_id), eq(characters.accountId, accountId))
    ).get();

    if (!charRow) {
      return sendError(reply, 400, "character_not_found", `Character ${params.character_id} not found`);
    }
    characterId = charRow.id;

    const versionRow = await db.select({
      id: characterVersions.id,
    }).from(characterVersions).where(
      eq(characterVersions.characterId, charRow.id)
    ).orderBy(asc(characterVersions.createdAt)).limit(1).get();

    if (versionRow) {
      characterVersionId = versionRow.id;
    }
  }

  let result: ReturnType<typeof createSessionFromThChatImport>;
  try {
    result = createSessionFromThChatImport(db, {
      file,
      idMap,
      accountId,
      characterId,
      characterVersionId,
      titleOverride: params.title ?? null,
      now,
    });
  } catch (error) {
    if (error instanceof VariableServiceError) {
      return sendError(reply, 400, "import_parse_error", `Invalid .thchat variable data: ${error.message}`);
    }

    throw error;
  }

  return reply.code(201).send({
    data: {
      session_id: result.sessionId,
      title: result.title,
      floor_count: result.floorCount,
      message_count: result.messageCount,
      page_count: result.pageCount,
      variable_count: result.variableCount,
      memory_item_count: result.memoryItemCount,
      memory_edge_count: result.memoryEdgeCount,
      skipped_lines: 0,
      import_source: "thchat",
      format: "thchat",
    },
  });
}

function resolveThChatImportScopeId(input: {
  scope: "chat" | "floor" | "page";
  scopeIdRef: string | null;
  sessionId: string;
  idMap: Map<string, string>;
}): string {
  if (input.scope === "chat") {
    return input.sessionId;
  }

  if (!input.scopeIdRef) {
    return input.sessionId;
  }

  return input.idMap.get(input.scopeIdRef) ?? input.scopeIdRef;
}

function buildImportedMemoryScopeStateRows(input: {
  accountId: string;
  data: ThChatFile["data"];
  idMap: Map<string, string>;
  now: number;
  sessionId: string;
}): Array<typeof runtimeScopeStates.$inferInsert> {
  const makeScopeKey = (scope: "global" | "chat" | "floor", scopeId: string): string => JSON.stringify([scope, scopeId]);

  const scopeMeta = new Map<string, { revision: number; hasMacroSummary: boolean }>();
  const scopeRows = new Map<string, typeof runtimeScopeStates.$inferInsert>();
  const chatLastProcessedFloorNo = input.data.floors.reduce<number | null>(
    (maxFloorNo, floor) => (maxFloorNo === null ? floor.floor_no : Math.max(maxFloorNo, floor.floor_no)),
    null,
  );

  if (input.data.memories) {
    for (const item of input.data.memories.items) {
      const scopeId = resolveThChatImportScopeId({
        scope: item.scope,
        scopeIdRef: item.scope_id_ref,
        sessionId: input.sessionId,
        idMap: input.idMap,
      });
      const scopeKey = makeScopeKey(item.scope, scopeId);
      const currentMeta = scopeMeta.get(scopeKey) ?? { revision: 0, hasMacroSummary: false };

      currentMeta.revision = 1;
      if (item.type === "summary" && item.summary_tier === "macro" && item.status === "active") {
        currentMeta.hasMacroSummary = true;
      }

      scopeMeta.set(scopeKey, currentMeta);
    }
  }

  const chatScopeKey = makeScopeKey("chat", input.sessionId);
  if (chatLastProcessedFloorNo !== null || scopeMeta.has(chatScopeKey)) {
    const chatMeta = scopeMeta.get(chatScopeKey);
    scopeRows.set(chatScopeKey, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("chat", input.sessionId),
      revision: chatMeta?.revision ?? 0,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: chatLastProcessedFloorNo,
        lastCompactionAt: chatMeta?.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  for (const floor of input.data.floors) {
    const scopeId = input.idMap.get(floor._original_id)!;
    const scopeKey = makeScopeKey("floor", scopeId);
    const floorMeta = scopeMeta.get(scopeKey);

    scopeRows.set(scopeKey, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("floor", scopeId),
      revision: floorMeta?.revision ?? 0,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: floor.floor_no,
        lastCompactionAt: floorMeta?.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  for (const [scopeKey, meta] of scopeMeta.entries()) {
    if (scopeRows.has(scopeKey)) {
      continue;
    }

    const [scope, scopeId] = JSON.parse(scopeKey) as ["global" | "chat" | "floor", string];
    scopeRows.set(scopeKey, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey(scope, scopeId),
      revision: meta.revision,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: scope === "chat" ? chatLastProcessedFloorNo : null,
        lastCompactionAt: meta.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  return Array.from(scopeRows.values());
}

function createSessionFromThChatImport(
  db: DatabaseConnection["db"],
  input: {
    file: ThChatFile;
    idMap: Map<string, string>;
    accountId: string;
    characterId: string | null;
    characterVersionId: string | null;
    titleOverride: string | null;
    now: number;
  },
): {
  sessionId: string;
  title: string;
  floorCount: number;
  pageCount: number;
  messageCount: number;
  variableCount: number;
  memoryItemCount: number;
  memoryEdgeCount: number;
} {
  return db.transaction((tx) => {
    const sessionId = nanoid();
    const data = input.file.data;

    const title = input.titleOverride ?? data.title ?? "Imported Chat";

    // 合并 metadata：保留文件原始 metadata，追加导入来源信息
    const existingMeta = (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata))
      ? data.metadata as Record<string, unknown>
      : {};
    const metadataJson = stringifyJsonField({
      ...existingMeta,
      import_source: "thchat",
      imported_at: input.now,
    });

    // 1. 创建 session
    tx.insert(sessions).values({
      id: sessionId,
      title,
      status: "active",
      accountId: input.accountId,
      characterId: input.characterId,
      characterVersionId: input.characterVersionId,
      characterSnapshotJson: data.character_snapshot
        ? stringifyJsonField(data.character_snapshot)
        : null,
      userSnapshotJson: data.user_snapshot
        ? stringifyJsonField(data.user_snapshot)
        : null,
      characterSyncPolicy: data.character_sync_policy,
      presetId: null,
      regexProfileId: null,
      worldbookProfileId: null,
      promptMode: data.prompt_mode ?? null,
      modelProvider: data.model_provider ?? null,
      modelName: data.model_name ?? null,
      modelParamsJson: null,
      metadataJson,
      createdAt: input.now,
      updatedAt: input.now,
    }).run();

    let totalPageCount = 0;
    let totalMessageCount = 0;

    // 2. 遍历 floors
    for (const floor of data.floors) {
      const floorId = input.idMap.get(floor._original_id)!;
      const parentFloorId = floor.parent_floor_id_ref
        ? (input.idMap.get(floor.parent_floor_id_ref) ?? null)
        : null;

      tx.insert(floors).values({
        id: floorId,
        sessionId,
        floorNo: floor.floor_no,
        branchId: floor.branch_id,
        parentFloorId,
        state: floor.state,
        metadataJson: floor.metadata != null
          ? stringifyJsonField(floor.metadata)
          : null,
        tokenIn: floor.token_in,
        tokenOut: floor.token_out,
        createdAt: floor.created_at,
        updatedAt: floor.updated_at,
      }).run();

      // 3. 遍历 pages
      for (const page of floor.pages) {
        const pageId = input.idMap.get(page._original_id)!;
        totalPageCount++;

        tx.insert(messagePages).values({
          id: pageId,
          floorId,
          pageNo: page.page_no,
          pageKind: page.page_kind,
          isActive: page.is_active,
          version: page.version,
          checksum: page.checksum,
          createdAt: page.created_at,
          updatedAt: page.updated_at,
        }).run();

        // 4. 遍历 messages
        for (const msg of page.messages) {
          const msgId = input.idMap.get(msg._original_id)!;
          totalMessageCount++;

          tx.insert(messages).values({
            id: msgId,
            pageId,
            seq: msg.seq,
            role: msg.role,
            content: msg.content,
            contentFormat: msg.content_format,
            tokenCount: msg.token_count,
            isHidden: msg.is_hidden,
            source: msg.source,
            createdAt: msg.created_at,
          }).run();
        }
      }
    }

    // 5. 导入变量
    let variableCount = 0;
    if (data.variables && data.variables.length > 0) {
      const variableService = new VariableService(tx);
      variableService.restoreMany({
        accountId: input.accountId,
        items: data.variables.map((v) => ({
          scope: v.scope,
          scopeId: resolveThChatImportScopeId({
            scope: v.scope,
            scopeIdRef: v.scope_id_ref,
            sessionId,
            idMap: input.idMap,
          }),
          key: v.key,
          value: v.value,
          updatedAt: v.updated_at,
        })),
      });
      variableCount = data.variables.length;
    }

    // 6. 导入记忆
    let memoryItemCount = 0;
    let memoryEdgeCount = 0;
    if (data.memories) {
      for (const item of data.memories.items) {
        const itemId = input.idMap.get(item._original_id)!;
        const scopeId = resolveThChatImportScopeId({
          scope: item.scope,
          scopeIdRef: item.scope_id_ref,
          sessionId,
          idMap: input.idMap,
        });

        tx.insert(memoryItems).values({
          id: itemId,
          scope: item.scope,
          scopeId,
          type: item.type,
          summaryTier: item.type === "summary"
            ? (item.summary_tier ?? null)
            : null,
          contentJson: JSON.stringify(item.content),
          importance: item.importance,
          confidence: item.confidence,
          sourceFloorId: item.source_floor_id_ref
            ? (input.idMap.get(item.source_floor_id_ref) ?? null)
            : null,
          sourceMessageId: item.source_message_id_ref
            ? (input.idMap.get(item.source_message_id_ref) ?? null)
            : null,
          accountId: input.accountId,
          status: item.status,
          lifecycleStatus: item.lifecycle_status ?? (item.status === "deprecated" ? "deprecated" : "active"),
          sourceJobId: item.source_job_id ?? null,
          tokenCountEstimate: item.token_count_estimate ?? null,
          lastUsedAt: item.last_used_at ?? null,
          coverageStartFloorNo: item.type === "summary"
            ? (item.coverage_start_floor_no ?? null)
            : null,
          coverageEndFloorNo: item.type === "summary"
            ? (item.coverage_end_floor_no ?? null)
            : null,
          derivedFromCount: item.type === "summary"
            ? (item.derived_from_count ?? null)
            : null,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        }).run();
        memoryItemCount++;
      }

      for (const edge of data.memories.edges) {
        const fromId = input.idMap.get(edge.from_id_ref);
        const toId = input.idMap.get(edge.to_id_ref);
        if (!fromId || !toId) continue; // 跳过悬空引用

        tx.insert(memoryEdges).values({
          id: nanoid(),
          fromId,
          toId,
          relation: edge.relation,
          accountId: input.accountId,
          createdAt: edge.created_at,
        }).run();
        memoryEdgeCount++;
      }
    }

    // 7. 为导入的聊天与楼层 scope 合成记忆状态，便于后续维护、重建与手动 compact
    const scopeStateRows = buildImportedMemoryScopeStateRows({
      accountId: input.accountId,
      data,
      idMap: input.idMap,
      now: input.now,
      sessionId,
    });
    if (scopeStateRows.length > 0) {
      tx.insert(runtimeScopeStates).values(scopeStateRows).run();
    }

    return {
      sessionId,
      title,
      floorCount: data.floors.length,
      pageCount: totalPageCount,
      messageCount: totalMessageCount,
      variableCount,
      memoryItemCount,
      memoryEdgeCount,
    };
  });
}

