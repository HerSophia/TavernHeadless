/**
 * Export Routes
 *
 * GET /export/chat/:id       — 导出会话（支持 thchat 原生格式和 st_jsonl 降级格式）
 * POST /export/chat/:id/jobs — 创建异步会话导出作业
 * GET /export/preset/:id     — 导出预设（ST 格式 JSON）
 * GET /export/worldbook/:id  — 导出世界书（ST 格式 JSON）
 * GET /export/regex/:id      — 导出正则脚本（ST 格式 JSON 数组）
 * GET /export/character/:id  — 导出角色卡（ST Character Card V2 JSON）
 */

import type { FastifyInstance } from "fastify";
import type { CoreEventBus } from "@tavern/core";
import { z } from "zod";
import { and, eq, asc, desc } from "drizzle-orm";

import type { DatabaseConnection } from "../db/client.js";
import {
  presets,
  worldbooks,
  worldbookEntries,
  regexProfiles,
  characters,
  characterVersions,
  sessions,
} from "../db/schema.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { parseWithSchema, parseJsonField, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { buildRawWorldbookEntryPayload } from "../lib/worldbook-utils.js";
import {
  serializeSessionToThChat,
  serializeSessionToStJsonl,
} from "../services/chat-export.js";
import { countSessionExportMessages } from "../services/chat-export-snapshot.js";
import { ChatTransferJobScheduler } from "../services/chat-transfer-job-scheduler.js";
import {
  executeResourceWrite,
  ResourceWriteRouteError,
} from "../services/resource-write.js";
import {
  snapshotToStCharacterCard,
  scriptsToStRegexArray,
} from "@tavern/adapters-sillytavern";

export interface ExportRoutesOptions {
  artifactDir?: string;
  exportSyncMaxMessages?: number;
  exportArtifactTtlMs?: number;
  eventBus?: CoreEventBus;
}

// ── Zod schemas ───────────────────────────────────────

const exportChatParamsSchema = z.object({
  id: z.string().min(1),
});

const exportChatQuerySchema = z.object({
  format: z.enum(["thchat", "st_jsonl"]).default("thchat"),
  include_variables: z
    .string()
    .transform((value) => value !== "false")
    .default("true"),
  include_memories: z
    .string()
    .transform((value) => value !== "false")
    .default("true"),
});

const createExportChatJobBodySchema = z.object({
  format: z.enum(["thchat", "st_jsonl"]).default("thchat"),
  include_variables: z.boolean().optional().default(true),
  include_memories: z.boolean().optional().default(true),
}).default({});

const exportIdParamsSchema = z.object({
  id: z.string().min(1),
});

const exportCharacterQuerySchema = z.object({
  version_id: z.string().min(1).optional(),
});

const createExportChatJobBodyExample = {
  format: "thchat",
  include_variables: true,
  include_memories: true,
};

const createExportChatJobResponseExample = {
  data: {
    job_id: "ctj_export_demo",
    status: "pending",
    job_kind: "export_chat",
    format: "thchat",
    requested_session_id: "sess_demo",
  },
};

// ── JSON Schema (Swagger) ────────────────────────────

const exportChatQueryJsonSchema = {
  type: "object" as const,
  properties: {
    format: { type: "string" as const, enum: ["thchat", "st_jsonl"], default: "thchat" },
    include_variables: { type: "string" as const, enum: ["true", "false"], default: "true" },
    include_memories: { type: "string" as const, enum: ["true", "false"], default: "true" },
  },
  additionalProperties: false,
};

const createExportChatJobBodyJsonSchema = {
  type: "object" as const,
  properties: {
    format: { type: "string" as const, enum: ["thchat", "st_jsonl"], default: "thchat" },
    include_variables: { type: "boolean" as const, default: true },
    include_memories: { type: "boolean" as const, default: true },
  },
  additionalProperties: false,
  examples: [createExportChatJobBodyExample],
};

const createExportChatJobResponseJsonSchema = {
  type: "object" as const,
  required: ["data"],
  properties: {
    data: {
      type: "object" as const,
      required: ["job_id", "status", "job_kind", "format", "requested_session_id"],
      properties: {
        job_id: { type: "string" as const },
        status: { type: "string" as const, enum: ["pending"] },
        job_kind: { type: "string" as const, enum: ["export_chat"] },
        format: { type: "string" as const, enum: ["thchat", "st_jsonl"] },
        requested_session_id: { type: "string" as const },
      },
      additionalProperties: false,
    },
  },
  examples: [createExportChatJobResponseExample],
  additionalProperties: false,
};

const exportCharacterQueryJsonSchema = {
  type: "object" as const,
  properties: {
    version_id: { type: "string" as const, minLength: 1 },
  },
  additionalProperties: false,
};

// ── 文件名安全处理 ───────────────────────────────────

function sanitizeFilename(name: string, maxLen = 100): string {
  const cleaned = name
    .replace(/[/\\?*<>|":]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLen) || "export";
}

// ── 公共响应辅助 ─────────────────────────────────────

function sendJsonFile(
  reply: any,
  filename: string,
  data: unknown,
) {
  return reply
    .header("Content-Type", "application/json; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(data);
}

function sendExportWriteError(reply: Parameters<typeof sendError>[0], error: ResourceWriteRouteError) {
  return sendError(reply, error.statusCode, error.code, error.message, error.details);
}

// ── 路由注册 ─────────────────────────────────────────

export async function registerExportRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: ExportRoutesOptions = {},
): Promise<void> {
  const { db } = connection;
  const scheduler = new ChatTransferJobScheduler({
    eventBus: options.eventBus,
  });

  // ────────────────────────────────────────────────────
  // GET /export/chat/:id
  // ────────────────────────────────────────────────────

  app.get("/export/chat/:id", {
    schema: {
      tags: ["exports"],
      summary: "Export chat session",
      description: "Export a session as .thchat (native, lossless) or .jsonl (ST-compatible, lossy).",
      operationId: "exportChat",
      params: idParamsJsonSchema,
      querystring: exportChatQueryJsonSchema,
      response: {
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(exportChatParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(exportChatQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const { id: sessionId } = parsedParams.data;
    const { format, include_variables, include_memories } = parsedQuery.data;
    const auth = getRequestAuthContext(request);

    try {
      if (options.exportSyncMaxMessages !== undefined) {
        const messageCount = countSessionExportMessages(db, sessionId, { accountId: auth.accountId });
        if (messageCount > options.exportSyncMaxMessages) {
          return sendError(
            reply,
            409,
            "export_requires_async",
            `Synchronous export is limited to ${options.exportSyncMaxMessages} messages for this deployment`,
          );
        }
      }

      if (format === "thchat") {
        const result = serializeSessionToThChat(db, sessionId, {
          accountId: auth.accountId,
          includeVariables: include_variables,
          includeMemories: include_memories,
        });

        const filename = sanitizeFilename(result.data.title ?? "export");
        return reply
          .header("Content-Type", "application/json; charset=utf-8")
          .header("Content-Disposition", `attachment; filename="${filename}.thchat"`)
          .send(result);
      }

      const jsonl = serializeSessionToStJsonl(db, sessionId, { accountId: auth.accountId });

      let filename = "export";
      try {
        const headerLine = jsonl.split("\n")[0];
        if (headerLine) {
          const headerObj = JSON.parse(headerLine);
          filename = sanitizeFilename(
            headerObj.character_name ?? headerObj.th_session_title ?? "export",
          );
        }
      } catch {
        // ignore
      }

      return reply
        .header("Content-Type", "application/x-ndjson; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}.jsonl"`)
        .send(jsonl);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Session not found")) {
        return sendError(reply, 404, "session_not_found", error.message);
      }
      throw error;
    }
  });

  app.post("/export/chat/:id/jobs", {
    schema: {
      tags: ["exports"],
      summary: "Create async chat export job",
      description: "高级开发特性。该接口会把聊天导出写入 Background Job Runtime，主要用于开发、调试、运维和自动化工具。普通小规模导出优先使用同步 `GET /export/chat/:id`。",
      operationId: "createExportChatJob",
      params: idParamsJsonSchema,
      body: createExportChatJobBodyJsonSchema,
      response: {
        202: createExportChatJobResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(exportChatParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(createExportChatJobBodySchema, request.body ?? {}, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const session = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, parsedParams.data.id), eq(sessions.accountId, auth.accountId)))
      .get();

    if (!session) {
      return sendError(reply, 404, "session_not_found", `Session not found: ${parsedParams.data.id}`);
    }

    try {
      const createdAt = Date.now();
      const created = await executeResourceWrite(() => db.transaction((tx) => {
        const result = scheduler.enqueueExportChat(tx, {
          accountId: auth.accountId,
          sessionId: parsedParams.data.id,
          format: parsedBody.data.format,
          includeVariables: parsedBody.data.include_variables,
          includeMemories: parsedBody.data.include_memories,
          createdAt,
        });

        return {
          jobId: result.jobId,
          format: parsedBody.data.format,
        };
      }));

      return reply.code(202).send({
        data: {
          job_id: created.jobId,
          status: "pending",
          job_kind: "export_chat",
          format: created.format,
          requested_session_id: parsedParams.data.id,
        },
      });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendExportWriteError(reply, error);
      }
      throw error;
    }
  });

  // ────────────────────────────────────────────────────
  // GET /export/preset/:id
  // ────────────────────────────────────────────────────

  app.get("/export/preset/:id", {
    schema: {
      tags: ["exports"],
      summary: "Export preset as ST-compatible JSON file",
      operationId: "exportPreset",
      params: idParamsJsonSchema,
      response: {
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(exportIdParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    const auth = getRequestAuthContext(request);
    const [row] = await db
      .select()
      .from(presets)
      .where(and(eq(presets.id, parsed.data.id), eq(presets.accountId, auth.accountId)));

    if (!row) {
      return sendError(reply, 404, "preset_not_found", "Preset not found");
    }

    const data = parseJsonField(row.dataJson);
    const filename = `${sanitizeFilename(row.name)}.json`;
    return sendJsonFile(reply, filename, data);
  });

  // ────────────────────────────────────────────────────
  // GET /export/worldbook/:id
  // ────────────────────────────────────────────────────

  app.get("/export/worldbook/:id", {
    schema: {
      tags: ["exports"],
      summary: "Export worldbook as ST-compatible JSON file",
      operationId: "exportWorldbook",
      params: idParamsJsonSchema,
      response: {
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(exportIdParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    const auth = getRequestAuthContext(request);
    const [row] = await db
      .select()
      .from(worldbooks)
      .where(and(eq(worldbooks.id, parsed.data.id), eq(worldbooks.accountId, auth.accountId)));

    if (!row) {
      return sendError(reply, 404, "worldbook_not_found", "Worldbook not found");
    }

    const entryRows = await db
      .select()
      .from(worldbookEntries)
      .where(eq(worldbookEntries.worldbookId, row.id))
      .orderBy(asc(worldbookEntries.order));

    const globalSettings = parseJsonField(row.dataJson) as Record<string, unknown> | null;

    const entriesObj: Record<string, unknown> = {};
    entryRows.forEach((entry, index) => {
      const key = String(entry.uid ?? index);
      entriesObj[key] = buildRawWorldbookEntryPayload(entry);
    });

    const stWorldbook = {
      name: row.name,
      entries: entriesObj,
      ...(globalSettings && typeof globalSettings === "object" ? globalSettings : {}),
    };

    const filename = `${sanitizeFilename(row.name)}.json`;
    return sendJsonFile(reply, filename, stWorldbook);
  });

  // ────────────────────────────────────────────────────
  // GET /export/regex/:id
  // ────────────────────────────────────────────────────

  app.get("/export/regex/:id", {
    schema: {
      tags: ["exports"],
      summary: "Export regex profile as ST-compatible JSON file",
      operationId: "exportRegex",
      params: idParamsJsonSchema,
      response: {
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(exportIdParamsSchema, request.params, reply);
    if (!parsed.ok) return;

    const auth = getRequestAuthContext(request);
    const [row] = await db
      .select()
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, parsed.data.id), eq(regexProfiles.accountId, auth.accountId)));

    if (!row) {
      return sendError(reply, 404, "regex_profile_not_found", "Regex profile not found");
    }

    const scripts = parseJsonField(row.dataJson) as unknown[];
    const stScripts = scriptsToStRegexArray(scripts as any);

    const filename = `${sanitizeFilename(row.name)}.json`;
    return sendJsonFile(reply, filename, stScripts);
  });

  // ────────────────────────────────────────────────────
  // GET /export/character/:id
  // ────────────────────────────────────────────────────

  app.get("/export/character/:id", {
    schema: {
      tags: ["exports"],
      summary: "Export character as ST Character Card V2 JSON file",
      operationId: "exportCharacter",
      params: idParamsJsonSchema,
      querystring: exportCharacterQueryJsonSchema,
      response: {
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(exportIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(exportCharacterQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    const [character] = await db
      .select()
      .from(characters)
      .where(and(
        eq(characters.id, parsedParams.data.id),
        eq(characters.accountId, auth.accountId),
      ));

    if (!character) {
      return sendError(reply, 404, "character_not_found", "Character not found");
    }

    let version;
    if (parsedQuery.data.version_id) {
      const [row] = await db
        .select()
        .from(characterVersions)
        .where(and(
          eq(characterVersions.id, parsedQuery.data.version_id),
          eq(characterVersions.characterId, character.id),
        ));
      version = row;
    } else {
      const [row] = await db
        .select()
        .from(characterVersions)
        .where(eq(characterVersions.characterId, character.id))
        .orderBy(desc(characterVersions.versionNo))
        .limit(1);
      version = row;
    }

    if (!version) {
      return sendError(reply, 404, "character_version_not_found", "Character version not found");
    }

    const snapshot = parseJsonField(version.dataJson) as {
      name: string;
      description?: string;
      personality?: string;
      scenario?: string;
      exampleDialogue?: string;
      greeting?: string;
    };

    const stCard = snapshotToStCharacterCard(snapshot);
    const filename = `${sanitizeFilename(character.name)}.json`;
    return sendJsonFile(reply, filename, stCard);
  });
}
