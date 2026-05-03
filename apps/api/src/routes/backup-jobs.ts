import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RUNTIME_JOB_STATUSES } from "../services/runtime-job-types.js";
import type { CoreEventBus } from "@tavern/core";

import type { DatabaseConnection } from "../db/client.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { buildListMeta, listQuerySchemaBase } from "../lib/pagination.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { LocalBackupArtifactStore } from "../services/backup-artifacts.js";
import {
  BACKUP_JOB_PHASES,
  BACKUP_JOB_KINDS,
  BACKUP_RUNTIME_SCOPE_TYPE,
  BACKUP_RUNTIME_JOB_TYPES,
  createBackupRuntimeJobCatalog,
  exportCoreAssetsJobRequestSchema,
  exportCoreAssetsJobResultSchema,
  type BackupCountSummary,
  fromBackupRuntimeJobType,
  readBackupJobState,
  restoreCoreAssetsJobRequestSchema,
  restoreCoreAssetsJobResultSchema,
} from "../services/backup-runtime-job-definitions.js";
import {
  RuntimeJobInvalidStateError,
  RuntimeJobNotFoundError,
  RuntimeJobQueryService,
  type RuntimeJobView,
} from "../services/runtime-job-query-service.js";
import { thBackupFileSchema } from "@tavern/shared";

const BACKUP_JOBS_DESCRIPTION = "高级开发特性。该组路由用于观察和管理 Background Job Runtime 中的核心资产备份作业，主要面向开发、调试、运维和自动化工具。";

const backupJobKindSchema = z.enum(BACKUP_JOB_KINDS);
const backupJobStatusSchema = z.enum(RUNTIME_JOB_STATUSES);
const backupJobParamsSchema = z.object({
  id: z.string().min(1),
});

const listBackupJobsQuerySchema = listQuerySchemaBase.extend({
  job_kind: backupJobKindSchema.optional(),
  status: backupJobStatusSchema.optional(),
  sort_by: z.enum(["created_at", "updated_at", "available_at"]).default("created_at"),
});

function createBackupCountSummaryExample(): BackupCountSummary {
  return {
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
  };
}

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

const backupRestoreCreatedSummaryJsonSchema = {
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
    "runtime_scope_states",
  ],
  properties: {
    ...backupCountSummaryJsonSchema.properties,
    runtime_scope_states: { type: "integer", minimum: 0 },
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

const backupExportJobRequestSummaryJsonSchema = {
  type: "object",
  required: ["domains", "session_ids", "character_ids", "worldbook_ids", "include_linked_assets", "include_secrets"],
  properties: {
    domains: {
      anyOf: [
        { type: "array", items: { type: "string", enum: ["characters", "worldbooks", "sessions"] } },
        { type: "null" },
      ],
    },
    session_ids: { type: "array", items: { type: "string" } },
    character_ids: { type: "array", items: { type: "string" } },
    worldbook_ids: { type: "array", items: { type: "string" } },
    include_linked_assets: { type: "boolean" },
    include_secrets: { type: "boolean", enum: [false] },
  },
  additionalProperties: false,
} as const;

const backupRestoreJobRequestSummaryJsonSchema = {
  type: "object",
  required: ["mode", "backup_kind", "included_domains", "created_at", "source"],
  properties: {
    mode: { type: "string", enum: ["create_copy"] },
    backup_kind: { anyOf: [{ type: "string" }, { type: "null" }] },
    included_domains: {
      anyOf: [
        { type: "array", items: { type: "string", enum: ["characters", "worldbooks", "sessions"] } },
        { type: "null" },
      ],
    },
    created_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
    source: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

const backupExportJobResultJsonSchema = {
  type: "object",
  required: ["file_name", "content_type", "byte_length", "included_domains", "counts"],
  properties: {
    file_name: { type: "string" },
    content_type: { type: "string" },
    byte_length: { type: "integer", minimum: 0 },
    included_domains: { type: "array", items: { type: "string", enum: ["characters", "worldbooks", "sessions"] } },
    counts: backupCountSummaryJsonSchema,
  },
  additionalProperties: false,
} as const;

const backupRestoreJobResultJsonSchema = {
  type: "object",
  required: ["mode", "created", "renamed_resources", "dropped_bindings", "warnings"],
  properties: {
    mode: { type: "string", enum: ["create_copy"] },
    created: backupRestoreCreatedSummaryJsonSchema,
    renamed_resources: { type: "array", items: backupRenamedResourceJsonSchema },
    dropped_bindings: backupDroppedBindingSummaryJsonSchema,
    warnings: { type: "array", items: backupWarningJsonSchema },
  },
  additionalProperties: false,
} as const;

const backupJobExample = {
  id: "backup-job-export-1",
  job_kind: "export_core_assets",
  status: "succeeded",
  phase: "completed",
  request: {
    domains: null,
    session_ids: ["sess_demo"],
    character_ids: [],
    worldbook_ids: [],
    include_linked_assets: true,
    include_secrets: false,
  },
  result: {
    file_name: "core-assets-20250101-120000.thbackup",
    content_type: "application/json; charset=utf-8",
    byte_length: 2048,
    included_domains: ["characters", "worldbooks", "sessions"],
    counts: createBackupCountSummaryExample(),
  },
  output_artifact_path: "backup-job-export-1/output.thbackup",
  output_expires_at: 1735689700000,
  progress_current: 4,
  progress_total: 4,
  progress_message: "completed",
  attempt_count: 1,
  max_attempts: 5,
  available_at: 1735689600000,
  lease_owner: null,
  lease_until: null,
  last_error: null,
  created_at: 1735689600000,
  updated_at: 1735689650000,
  finished_at: 1735689650000,
} as const;

const backupJobDetailResponseExample = { data: backupJobExample } as const;

const backupJobListResponseExample = {
  data: [backupJobExample],
  meta: { total: 1, limit: 20, offset: 0, has_more: false, sort_by: "created_at", sort_order: "desc" },
} as const;

const backupJobMutationResponseExample = {
  data: { job_id: "backup-job-export-1", status: "cancelled" },
} as const;

const backupJobJsonSchema = {
  type: "object",
  required: [
    "id",
    "job_kind",
    "status",
    "phase",
    "attempt_count",
    "max_attempts",
    "available_at",
    "created_at",
    "updated_at",
    "progress_current",
  ],
  properties: {
    id: { type: "string" },
    job_kind: { type: "string", enum: [...BACKUP_JOB_KINDS] },
    status: { type: "string", enum: [...RUNTIME_JOB_STATUSES] },
    phase: { type: "string", enum: [...BACKUP_JOB_PHASES] },
    request: {
      anyOf: [
        backupExportJobRequestSummaryJsonSchema,
        backupRestoreJobRequestSummaryJsonSchema,
        { type: "null" },
      ],
    },
    result: {
      anyOf: [
        backupExportJobResultJsonSchema,
        backupRestoreJobResultJsonSchema,
        { type: "null" },
      ],
    },
    output_artifact_path: { anyOf: [{ type: "string" }, { type: "null" }] },
    output_expires_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
    progress_current: { type: "integer", minimum: 0 },
    progress_total: { anyOf: [{ type: "integer" }, { type: "null" }] },
    progress_message: { anyOf: [{ type: "string" }, { type: "null" }] },
    attempt_count: { type: "integer", minimum: 0 },
    max_attempts: { type: "integer", minimum: 1 },
    available_at: { type: "integer", minimum: 0 },
    lease_owner: { anyOf: [{ type: "string" }, { type: "null" }] },
    lease_until: { anyOf: [{ type: "integer" }, { type: "null" }] },
    last_error: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
    finished_at: { anyOf: [{ type: "integer" }, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

const backupJobListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: backupJobJsonSchema },
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
  examples: [backupJobListResponseExample],
  additionalProperties: false,
} as const;

const backupJobDetailResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: backupJobJsonSchema,
  },
  examples: [backupJobDetailResponseExample],
  additionalProperties: false,
} as const;

const backupJobMutationResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["job_id", "status"],
      properties: {
        job_id: { type: "string" },
        status: { type: "string", enum: [...RUNTIME_JOB_STATUSES] },
      },
      additionalProperties: false,
    },
  },
  examples: [backupJobMutationResponseExample],
  additionalProperties: false,
} as const;

export interface BackupJobRoutesOptions {
  artifactDir?: string;
  eventBus?: CoreEventBus;
}

function summarizeBackupJobRequest(job: RuntimeJobView) {
  const jobKind = fromBackupRuntimeJobType(job.jobType);

  if (jobKind === "export_core_assets") {
    const parsed = exportCoreAssetsJobRequestSchema.safeParse(job.payload);
    if (!parsed.success) {
      return null;
    }

    return {
      domains: parsed.data.domains ?? null,
      session_ids: parsed.data.sessionIds ?? [],
      character_ids: parsed.data.characterIds ?? [],
      worldbook_ids: parsed.data.worldbookIds ?? [],
      include_linked_assets: parsed.data.includeLinkedAssets,
      include_secrets: parsed.data.includeSecrets,
    };
  }

  const parsed = restoreCoreAssetsJobRequestSchema.safeParse(job.payload);
  if (!parsed.success) {
    return null;
  }

  const file = thBackupFileSchema.safeParse(parsed.data.data);
  return {
    mode: parsed.data.mode,
    backup_kind: file.success ? file.data.backup_kind : null,
    included_domains: file.success ? file.data.included_domains : null,
    created_at: file.success ? file.data.created_at : null,
    source: file.success ? file.data.source : null,
  };
}

function summarizeBackupJobResult(job: RuntimeJobView) {
  const jobKind = fromBackupRuntimeJobType(job.jobType);
  if (jobKind === "export_core_assets") {
    const parsed = exportCoreAssetsJobResultSchema.safeParse(job.result);
    if (!parsed.success) {
      return job.result;
    }

    return {
      file_name: parsed.data.fileName,
      content_type: parsed.data.contentType,
      byte_length: parsed.data.byteLength,
      included_domains: parsed.data.includedDomains,
      counts: parsed.data.counts,
    };
  }

  const parsed = restoreCoreAssetsJobResultSchema.safeParse(job.result);
  return parsed.success ? parsed.data : job.result;
}

function toBackupJobResponse(job: RuntimeJobView) {
  const state = readBackupJobState(job.state);
  return {
    id: job.id,
    job_kind: fromBackupRuntimeJobType(job.jobType),
    status: job.status,
    phase: job.phase ?? "queued",
    request: summarizeBackupJobRequest(job),
    result: summarizeBackupJobResult(job),
    output_artifact_path: state.outputArtifactPath ?? null,
    output_expires_at: state.outputExpiresAt ?? null,
    progress_current: job.progressCurrent,
    progress_total: job.progressTotal,
    progress_message: job.progressMessage,
    attempt_count: job.attemptCount,
    max_attempts: job.maxAttempts,
    available_at: job.availableAt,
    lease_owner: job.leaseOwner,
    lease_until: job.leaseUntil,
    last_error: job.lastError,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    finished_at: job.finishedAt,
  };
}

export async function registerBackupJobRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: BackupJobRoutesOptions = {},
): Promise<void> {
  const runtimeQueryService = new RuntimeJobQueryService(connection.db, {
    catalog: createBackupRuntimeJobCatalog(),
    eventBus: options.eventBus,
  });
  const artifactStore = new LocalBackupArtifactStore(options.artifactDir ?? "data/backup-artifacts");

  app.get("/backup-jobs", {
    schema: {
      tags: ["backup-jobs"],
      description: BACKUP_JOBS_DESCRIPTION,
      summary: "List backup jobs",
      operationId: "listBackupJobs",
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 },
          sort_order: { type: "string", enum: ["asc", "desc"] },
          sort_by: { type: "string", enum: ["created_at", "updated_at", "available_at"] },
          job_kind: { type: "string", enum: [...BACKUP_JOB_KINDS] },
          status: { type: "string", enum: [...RUNTIME_JOB_STATUSES] },
        },
        additionalProperties: false,
      },
      response: {
        200: backupJobListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listBackupJobsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const result = await runtimeQueryService.list({
      accountId: auth.accountId,
      scopeType: BACKUP_RUNTIME_SCOPE_TYPE,
      jobType: parsedQuery.data.job_kind
        ? BACKUP_RUNTIME_JOB_TYPES[parsedQuery.data.job_kind]
        : undefined,
      status: parsedQuery.data.status,
      limit: parsedQuery.data.limit,
      offset: parsedQuery.data.offset,
      sortBy: parsedQuery.data.sort_by,
      sortOrder: parsedQuery.data.sort_order,
    });

    return reply.send({
      data: result.jobs.map(toBackupJobResponse),
      meta: buildListMeta({
        total: result.total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  app.get("/backup-jobs/:id", {
    schema: {
      tags: ["backup-jobs"],
      description: BACKUP_JOBS_DESCRIPTION,
      summary: "Get backup job detail",
      operationId: "getBackupJob",
      params: idParamsJsonSchema,
      response: {
        200: backupJobDetailResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(backupJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const job = await runtimeQueryService.get({
      accountId: auth.accountId,
      jobId: parsedParams.data.id,
      scopeType: BACKUP_RUNTIME_SCOPE_TYPE,
    });

    if (!job) {
      return sendError(reply, 404, "not_found", "Backup job not found");
    }

    return reply.send({ data: toBackupJobResponse(job) });
  });

  app.post("/backup-jobs/:id/cancel", {
    schema: {
      tags: ["backup-jobs"],
      description: BACKUP_JOBS_DESCRIPTION,
      summary: "Cancel a backup job",
      operationId: "cancelBackupJob",
      params: idParamsJsonSchema,
      response: {
        200: backupJobMutationResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(backupJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    try {
      const result = await runtimeQueryService.cancel({
        accountId: auth.accountId,
        jobId: parsedParams.data.id,
        scopeType: BACKUP_RUNTIME_SCOPE_TYPE,
      });
      return reply.send({ data: { job_id: result.job.id, status: result.job.status } });
    } catch (error) {
      if (error instanceof RuntimeJobNotFoundError) {
        return sendError(reply, 404, "not_found", "Backup job not found");
      }
      if (error instanceof RuntimeJobInvalidStateError) {
        return sendError(reply, 409, "invalid_state", error.message);
      }
      throw error;
    }
  });

  app.post("/backup-jobs/:id/retry", {
    schema: {
      tags: ["backup-jobs"],
      description: BACKUP_JOBS_DESCRIPTION,
      summary: "Retry a backup job",
      operationId: "retryBackupJob",
      params: idParamsJsonSchema,
      response: {
        200: backupJobMutationResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(backupJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    try {
      const result = await runtimeQueryService.retry({
        accountId: auth.accountId,
        jobId: parsedParams.data.id,
        scopeType: BACKUP_RUNTIME_SCOPE_TYPE,
      });
      return reply.send({ data: { job_id: result.job.id, status: result.job.status } });
    } catch (error) {
      if (error instanceof RuntimeJobNotFoundError) {
        return sendError(reply, 404, "not_found", "Backup job not found");
      }
      if (error instanceof RuntimeJobInvalidStateError) {
        return sendError(reply, 409, "invalid_state", error.message);
      }
      throw error;
    }
  });

  app.get("/backup-jobs/:id/file", {
    schema: {
      tags: ["backup-jobs"],
      description: `${BACKUP_JOBS_DESCRIPTION} 只有 export_core_assets 且 succeeded 的作业可以下载文件。`,
      summary: "Download backup export artifact",
      operationId: "downloadBackupJobFile",
      params: idParamsJsonSchema,
      response: {
        200: { type: "string", format: "binary" },
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        410: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(backupJobParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const job = await runtimeQueryService.get({
      accountId: auth.accountId,
      jobId: parsedParams.data.id,
      scopeType: BACKUP_RUNTIME_SCOPE_TYPE,
    });

    if (!job) {
      return sendError(reply, 404, "not_found", "Backup job not found");
    }

    if (job.jobType !== BACKUP_RUNTIME_JOB_TYPES.export_core_assets || job.status !== "succeeded") {
      return sendError(reply, 409, "backup_artifact_unavailable", "Backup artifact is not available for this job");
    }

    const state = readBackupJobState(job.state);
    if (!state.outputArtifactPath) {
      return sendError(reply, 409, "backup_artifact_unavailable", "Backup artifact is not available for this job");
    }

    if (state.outputExpiresAt !== null && state.outputExpiresAt !== undefined && Date.now() > state.outputExpiresAt) {
      return sendError(reply, 410, "artifact_expired", "The backup artifact has expired");
    }

    const exists = await artifactStore.exists(state.outputArtifactPath);
    if (!exists) {
      return sendError(reply, 409, "backup_artifact_unavailable", "Backup artifact is not available for this job");
    }

    const buffer = await artifactStore.readBuffer(state.outputArtifactPath);
    const result = exportCoreAssetsJobResultSchema.safeParse(job.result);
    const fileName = result.success ? result.data.fileName : state.fileName ?? "core-assets.thbackup";
    const contentType = result.success ? result.data.contentType : "application/json; charset=utf-8";

    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", `attachment; filename="${fileName}"`)
      .send(buffer);
  });
}
