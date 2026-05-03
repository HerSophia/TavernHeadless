import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { CoreEventBus } from "@tavern/core";
import { TH_BACKUP_KIND, TH_BACKUP_SPEC, TH_BACKUP_SPEC_VERSION } from "@tavern/shared";

import type { DatabaseConnection } from "../db/client.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { errorResponseJsonSchema } from "./schemas/common.js";
import { BackupJobScheduler } from "../services/backup-job-scheduler.js";
import { executeResourceWrite, ResourceWriteRouteError } from "../services/resource-write.js";
import { CoreAssetBackupError, assertCoreAssetBackupRestoreMode } from "../services/core-asset-backup-parser.js";
import { previewCoreAssetBackup } from "../services/core-asset-backup-preview.js";

const BACKUP_DESCRIPTION = "高级开发特性。该组路由用于导出 TavernHeadless 核心资产备份、执行 restore preview，以及把恢复任务写入 Background Job Runtime。请求体固定为 JSON，不提供 multipart 上传。";

const backupDomainSchema = z.enum(["characters", "worldbooks", "sessions"]);

const createBackupExportJobBodySchema = z.object({
  domains: z.array(backupDomainSchema).min(1).optional(),
  session_ids: z.array(z.string().min(1)).optional(),
  character_ids: z.array(z.string().min(1)).optional(),
  worldbook_ids: z.array(z.string().min(1)).optional(),
  include_linked_assets: z.boolean().default(true),
  include_secrets: z.literal(false).default(false),
});

const backupPreviewBodySchema = z.object({
  data: z.unknown(),
  mode: z.string().optional(),
});

const createBackupRestoreJobBodySchema = z.object({
  data: z.unknown(),
  mode: z.string().optional().default("create_copy"),
});

const backupFileExample = {
  spec: TH_BACKUP_SPEC,
  spec_version: TH_BACKUP_SPEC_VERSION,
  backup_kind: TH_BACKUP_KIND,
  created_at: 1735689600000,
  source: {
    account_id: "acc_demo",
    app_version: "0.2.0-beta.3",
  },
  included_domains: ["characters", "worldbooks", "sessions"],
  options: {
    include_secrets: false,
  },
  resources: {
    characters: [],
    worldbooks: [],
  },
  sessions: [],
  extensions: {
    secrets: {
      mode: "excluded",
    },
  },
} as const;

const createBackupExportJobBodyExample = {
  session_ids: ["sess_001"],
  include_linked_assets: true,
} as const;

const createBackupRestoreBodyExample = {
  data: backupFileExample,
  mode: "create_copy",
} as const;

const backupCountSummaryJsonSchema = {
  type: "object",
  required: [
    "characters",
    "character_versions",
    "worldbooks",
    "worldbook_entries",
    "sessions",
    "session_branches",
    "floors",
    "pages",
    "messages",
    "variables",
    "branch_local_variable_snapshots",
    "memory_items",
    "memory_edges",
  ],
  properties: {
    characters: { type: "integer", minimum: 0 },
    character_versions: { type: "integer", minimum: 0 },
    worldbooks: { type: "integer", minimum: 0 },
    worldbook_entries: { type: "integer", minimum: 0 },
    sessions: { type: "integer", minimum: 0 },
    session_branches: { type: "integer", minimum: 0 },
    floors: { type: "integer", minimum: 0 },
    pages: { type: "integer", minimum: 0 },
    messages: { type: "integer", minimum: 0 },
    variables: { type: "integer", minimum: 0 },
    branch_local_variable_snapshots: { type: "integer", minimum: 0 },
    memory_items: { type: "integer", minimum: 0 },
    memory_edges: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const backupTopLevelCreateSummaryJsonSchema = {
  type: "object",
  required: ["characters", "worldbooks", "sessions"],
  properties: {
    characters: { type: "integer", minimum: 0 },
    worldbooks: { type: "integer", minimum: 0 },
    sessions: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const backupWarningJsonSchema = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    session_id: { type: "string" },
  },
  additionalProperties: false,
} as const;

const backupRenamedResourceJsonSchema = {
  type: "object",
  required: ["type", "old_name", "new_name"],
  properties: {
    type: { type: "string", enum: ["character", "worldbook", "session"] },
    old_name: { type: "string" },
    new_name: { type: "string" },
  },
  additionalProperties: false,
} as const;

const backupDroppedBindingSummaryJsonSchema = {
  type: "object",
  required: ["users", "presets", "regex_profiles"],
  properties: {
    users: { type: "integer", minimum: 0 },
    presets: { type: "integer", minimum: 0 },
    regex_profiles: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const createBackupExportJobBodyJsonSchema = {
  type: "object",
  properties: {
    domains: {
      type: "array",
      items: { type: "string", enum: ["characters", "worldbooks", "sessions"] },
      minItems: 1,
    },
    session_ids: { type: "array", items: { type: "string", minLength: 1 } },
    character_ids: { type: "array", items: { type: "string", minLength: 1 } },
    worldbook_ids: { type: "array", items: { type: "string", minLength: 1 } },
    include_linked_assets: { type: "boolean", default: true },
    include_secrets: { type: "boolean", enum: [false], default: false },
  },
  additionalProperties: false,
  examples: [createBackupExportJobBodyExample],
} as const;

const backupPreviewBodyJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      additionalProperties: true,
      description: "已解析的 .thbackup JSON 文档对象。",
    },
    mode: { type: "string", enum: ["create_copy"], default: "create_copy" },
  },
  additionalProperties: false,
  examples: [createBackupRestoreBodyExample],
} as const;

const backupPreviewResponseExample = {
  data: {
    backup_kind: "account_core_assets",
    restore_mode: "create_copy",
    included_domains: ["characters", "worldbooks", "sessions"],
    counts: {
      characters: 1,
      character_versions: 1,
      worldbooks: 1,
      worldbook_entries: 3,
      sessions: 1,
      session_branches: 2,
      floors: 4,
      pages: 4,
      messages: 8,
      variables: 6,
      branch_local_variable_snapshots: 1,
      memory_items: 3,
      memory_edges: 2,
    },
    will_create: {
      characters: 1,
      worldbooks: 1,
      sessions: 1,
    },
    renamed_resources: [
      {
        type: "session",
        old_name: "Story A",
        new_name: "Story A (restored)",
      },
    ],
    dropped_bindings: {
      users: 1,
      presets: 1,
      regex_profiles: 1,
    },
    warnings: [
      {
        code: "restore_drops_user_binding",
        message: "1 个 session 的 user 绑定将在 restore 时清空",
      },
    ],
  },
} as const;

const backupJobCreateResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["job_id", "job_kind", "status", "phase"],
      properties: {
        job_id: { type: "string" },
        job_kind: { type: "string", enum: ["export_core_assets", "restore_core_assets"] },
        status: { type: "string", enum: ["pending"] },
        phase: { type: "string", enum: ["queued"] },
      },
      additionalProperties: false,
    },
  },
  examples: [{
    data: {
      job_id: "backup-job:export_core_assets:abc123",
      job_kind: "export_core_assets",
      status: "pending",
      phase: "queued",
    },
  }],
  additionalProperties: false,
} as const;

const backupRestoreJobCreateResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["job_id", "job_kind", "status", "phase"],
      properties: {
        job_id: { type: "string" },
        job_kind: { type: "string", enum: ["export_core_assets", "restore_core_assets"] },
        status: { type: "string", enum: ["pending"] },
        phase: { type: "string", enum: ["queued"] },
      },
      additionalProperties: false,
    },
  },
  examples: [{
    data: {
      job_id: "backup-job:restore_core_assets:def456",
      job_kind: "restore_core_assets",
      status: "pending",
      phase: "queued",
    },
  }],
  additionalProperties: false,
} as const;

const backupPreviewResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "backup_kind",
        "restore_mode",
        "included_domains",
        "counts",
        "will_create",
        "renamed_resources",
        "dropped_bindings",
        "warnings",
      ],
      properties: {
        backup_kind: { type: "string", enum: [TH_BACKUP_KIND] },
        restore_mode: { type: "string", enum: ["create_copy"] },
        included_domains: { type: "array", items: { type: "string", enum: ["characters", "worldbooks", "sessions"] } },
        counts: backupCountSummaryJsonSchema,
        will_create: backupTopLevelCreateSummaryJsonSchema,
        renamed_resources: { type: "array", items: backupRenamedResourceJsonSchema },
        dropped_bindings: backupDroppedBindingSummaryJsonSchema,
        warnings: { type: "array", items: backupWarningJsonSchema },
      },
      additionalProperties: false,
    },
  },
  examples: [backupPreviewResponseExample],
  additionalProperties: false,
} as const;

export interface BackupRoutesOptions {
  eventBus?: CoreEventBus;
  importMaxBytes?: number;
}

function sendBackupRouteError(reply: Parameters<typeof sendError>[0], error: CoreAssetBackupError) {
  return sendError(reply, error.statusCode, error.code, error.message, error.details);
}

function sendBackupWriteError(reply: Parameters<typeof sendError>[0], error: ResourceWriteRouteError) {
  return sendError(reply, error.statusCode, error.code, error.message, error.details);
}

export async function registerBackupRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: BackupRoutesOptions = {},
): Promise<void> {
  const { db } = connection;
  const scheduler = new BackupJobScheduler({
    eventBus: options.eventBus,
  });
  const bodyLimit = options.importMaxBytes ?? 50_000_000;

  app.post("/backup/jobs/export", {
    schema: {
      tags: ["backup"],
      description: `${BACKUP_DESCRIPTION} 该接口只负责入队。导出完成后需要通过 /backup-jobs/:id/file 下载 .thbackup 文件。`,
      summary: "Create core asset backup export job",
      operationId: "createBackupExportJob",
      body: createBackupExportJobBodyJsonSchema,
      response: {
        202: backupJobCreateResponseJsonSchema,
        400: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createBackupExportJobBodySchema, request.body ?? {}, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const createdAt = Date.now();
      const created = await executeResourceWrite(() => db.transaction((tx) => {
        return scheduler.enqueueExportCoreAssets(tx, {
          accountId: auth.accountId,
          domains: parsedBody.data.domains,
          sessionIds: parsedBody.data.session_ids,
          characterIds: parsedBody.data.character_ids,
          worldbookIds: parsedBody.data.worldbook_ids,
          includeLinkedAssets: parsedBody.data.include_linked_assets,
          includeSecrets: parsedBody.data.include_secrets,
          createdAt,
        });
      }));

      return reply.code(202).send({
        data: {
          job_id: created.jobId,
          job_kind: "export_core_assets",
          status: "pending",
          phase: "queued",
        },
      });
    } catch (error) {
      if (error instanceof ResourceWriteRouteError) {
        return sendBackupWriteError(reply, error);
      }
      throw error;
    }
  });

  app.post("/backup/restore/preview", {
    bodyLimit,
    schema: {
      tags: ["backup"],
      description: `${BACKUP_DESCRIPTION} 该接口只做同步校验和恢复规划，不会写数据库。`,
      summary: "Preview core asset backup restore",
      operationId: "previewBackupRestore",
      body: backupPreviewBodyJsonSchema,
      response: {
        200: backupPreviewResponseJsonSchema,
        400: errorResponseJsonSchema,
        413: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(backupPreviewBodySchema, request.body ?? {}, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const preview = previewCoreAssetBackup(db, {
        accountId: auth.accountId,
        data: parsedBody.data.data,
        mode: parsedBody.data.mode,
      });
      return reply.send({ data: preview });
    } catch (error) {
      if (error instanceof CoreAssetBackupError) {
        return sendBackupRouteError(reply, error);
      }
      throw error;
    }
  });

  app.post("/backup/jobs/restore", {
    bodyLimit,
    schema: {
      tags: ["backup"],
      description: `${BACKUP_DESCRIPTION} v1 只支持 create_copy。真正的写库、ID 重映射和 runtime state 重建会在后台 worker 中完成。`,
      summary: "Create core asset backup restore job",
      operationId: "createBackupRestoreJob",
      body: backupPreviewBodyJsonSchema,
      response: {
        202: backupRestoreJobCreateResponseJsonSchema,
        400: errorResponseJsonSchema,
        413: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createBackupRestoreJobBodySchema, request.body ?? {}, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);

    try {
      const mode = assertCoreAssetBackupRestoreMode(parsedBody.data.mode);
      const createdAt = Date.now();
      const created = await executeResourceWrite(() => db.transaction((tx) => {
        return scheduler.enqueueRestoreCoreAssets(tx, {
          accountId: auth.accountId,
          data: parsedBody.data.data,
          mode,
          createdAt,
        });
      }));

      return reply.code(202).send({
        data: {
          job_id: created.jobId,
          job_kind: "restore_core_assets",
          status: "pending",
          phase: "queued",
        },
      });
    } catch (error) {
      if (error instanceof CoreAssetBackupError) {
        return sendBackupRouteError(reply, error);
      }
      if (error instanceof ResourceWriteRouteError) {
        return sendBackupWriteError(reply, error);
      }
      throw error;
    }
  });
}
