import { createHash } from "node:crypto";

import { nanoid } from "nanoid";
import { z } from "zod";
import { TH_BACKUP_DOMAINS } from "@tavern/shared";

import type { RuntimeJobDefinition } from "./runtime-job-types.js";
import { RuntimeJobCatalog } from "./runtime-job-catalog.js";

export const BACKUP_RUNTIME_SCOPE_TYPE = "backup";

export const BACKUP_JOB_KINDS = ["export_core_assets", "restore_core_assets"] as const;
export const BACKUP_JOB_PHASES = [
  "queued",
  "collecting",
  "serializing",
  "writing_artifact",
  "validating",
  "normalizing",
  "remapping",
  "publishing",
  "rebuilding_runtime_state",
  "finalizing",
  "completed",
] as const;
export const BACKUP_OPERATION_LOG_INCLUDE_MODES = ["none", "referenced", "selected_scope"] as const;

export const BACKUP_RUNTIME_JOB_TYPES = {
  export_core_assets: "backup.export_core_assets",
  restore_core_assets: "backup.restore_core_assets",
} as const;

export type BackupJobKind = (typeof BACKUP_JOB_KINDS)[number];
export type BackupJobPhase = (typeof BACKUP_JOB_PHASES)[number];
export type BackupOperationLogIncludeMode = (typeof BACKUP_OPERATION_LOG_INCLUDE_MODES)[number];
export type BackupRuntimeJobType = (typeof BACKUP_RUNTIME_JOB_TYPES)[BackupJobKind];

export const backupDomainSchema = z.enum(TH_BACKUP_DOMAINS);
export const backupOperationLogIncludeModeSchema = z.enum(BACKUP_OPERATION_LOG_INCLUDE_MODES);

export const backupCountSummarySchema = z.object({
  characters: z.number().int().nonnegative(),
  character_versions: z.number().int().nonnegative(),
  presets: z.number().int().nonnegative(),
  preset_versions: z.number().int().nonnegative(),
  worldbooks: z.number().int().nonnegative(),
  worldbook_versions: z.number().int().nonnegative(),
  worldbook_entries: z.number().int().nonnegative(),
  regex_profiles: z.number().int().nonnegative(),
  regex_profile_versions: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  session_branches: z.number().int().nonnegative(),
  floors: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  variables: z.number().int().nonnegative(),
  branch_local_variable_snapshots: z.number().int().nonnegative(),
  memory_items: z.number().int().nonnegative(),
  memory_edges: z.number().int().nonnegative(),
  vc_tags: z.number().int().nonnegative().default(0),
  operation_logs: z.number().int().nonnegative().default(0),
});

export const backupTopLevelCreateSummarySchema = z.object({
  characters: z.number().int().nonnegative(),
  presets: z.number().int().nonnegative(),
  worldbooks: z.number().int().nonnegative(),
  regex_profiles: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
});

export const backupRestoreCreatedSummarySchema = backupCountSummarySchema.extend({
  runtime_scope_states: z.number().int().nonnegative(),
});

export const backupWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  session_id: z.string().min(1).optional(),
});

export const backupRenamedResourceSchema = z.object({
  type: z.enum(["character", "preset", "worldbook", "regex_profile", "session", "vc_tag"]),
  old_name: z.string().min(1),
  new_name: z.string().min(1),
});

export const backupDroppedBindingSummarySchema = z.object({
  users: z.number().int().nonnegative(),
  presets: z.number().int().nonnegative(),
  regex_profiles: z.number().int().nonnegative(),
});

export const exportCoreAssetsJobRequestSchema = z.object({
  domains: z.array(backupDomainSchema).min(1).optional(),
  sessionIds: z.array(z.string().min(1)).optional(),
  characterIds: z.array(z.string().min(1)).optional(),
  presetIds: z.array(z.string().min(1)).optional(),
  worldbookIds: z.array(z.string().min(1)).optional(),
  regexProfileIds: z.array(z.string().min(1)).optional(),
  includeLinkedAssets: z.boolean().default(true),
  includeVcTags: z.boolean().default(true),
  includeOperationLogs: backupOperationLogIncludeModeSchema.default("none"),
  includeSecrets: z.literal(false).default(false),
});

export const restoreCoreAssetsJobRequestSchema = z.object({
  data: z.unknown(),
  mode: z.string().optional().default("create_copy"),
});

export const exportCoreAssetsJobResultSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  includedDomains: z.array(backupDomainSchema),
  counts: backupCountSummarySchema,
});

export const restoreCoreAssetsJobResultSchema = z.object({
  mode: z.literal("create_copy"),
  created: backupRestoreCreatedSummarySchema,
  renamed_resources: z.array(backupRenamedResourceSchema),
  dropped_bindings: backupDroppedBindingSummarySchema,
  warnings: z.array(backupWarningSchema),
});

export type BackupCountSummary = z.infer<typeof backupCountSummarySchema>;
export type BackupTopLevelCreateSummary = z.infer<typeof backupTopLevelCreateSummarySchema>;
export type BackupRestoreCreatedSummary = z.infer<typeof backupRestoreCreatedSummarySchema>;
export type BackupWarning = z.infer<typeof backupWarningSchema>;
export type BackupRenamedResource = z.infer<typeof backupRenamedResourceSchema>;
export type BackupDroppedBindingSummary = z.infer<typeof backupDroppedBindingSummarySchema>;
export type ExportCoreAssetsJobRequest = z.infer<typeof exportCoreAssetsJobRequestSchema>;
export type RestoreCoreAssetsJobRequest = z.infer<typeof restoreCoreAssetsJobRequestSchema>;
export type ExportCoreAssetsJobResult = z.infer<typeof exportCoreAssetsJobResultSchema>;
export type RestoreCoreAssetsJobResult = z.infer<typeof restoreCoreAssetsJobResultSchema>;

export interface BackupRuntimeJobState {
  outputArtifactPath?: string | null;
  outputExpiresAt?: number | null;
  fileName?: string | null;
  includedDomains?: string[] | null;
  restoreMode?: string | null;
}

export function emptyBackupCountSummary(): BackupCountSummary {
  return {
    characters: 0,
    character_versions: 0,
    presets: 0,
    preset_versions: 0,
    worldbooks: 0,
    worldbook_versions: 0,
    worldbook_entries: 0,
    regex_profiles: 0,
    regex_profile_versions: 0,
    sessions: 0,
    session_branches: 0,
    floors: 0,
    pages: 0,
    messages: 0,
    variables: 0,
    branch_local_variable_snapshots: 0,
    memory_items: 0,
    memory_edges: 0,
    vc_tags: 0,
    operation_logs: 0,
  };
}

export function emptyBackupRestoreCreatedSummary(): BackupRestoreCreatedSummary {
  return {
    ...emptyBackupCountSummary(),
    runtime_scope_states: 0,
  };
}

export function toBackupRuntimeJobType(jobKind: BackupJobKind): BackupRuntimeJobType {
  return BACKUP_RUNTIME_JOB_TYPES[jobKind];
}

export function fromBackupRuntimeJobType(jobType: string): BackupJobKind {
  switch (jobType) {
    case BACKUP_RUNTIME_JOB_TYPES.export_core_assets:
      return "export_core_assets";
    case BACKUP_RUNTIME_JOB_TYPES.restore_core_assets:
      return "restore_core_assets";
    default:
      throw new Error(`Unknown backup runtime job type: ${jobType}`);
  }
}

export function createBackupJobId(jobKind: BackupJobKind): string {
  return `backup-job:${jobKind}:${nanoid(12)}`;
}

function normalizeSelectionDigestPayload(payload: ExportCoreAssetsJobRequest) {
  const domains = [...(payload.domains ?? [])].sort();
  const sessionIds = [...(payload.sessionIds ?? [])].sort();
  const characterIds = [...(payload.characterIds ?? [])].sort();
  const presetIds = [...(payload.presetIds ?? [])].sort();
  const worldbookIds = [...(payload.worldbookIds ?? [])].sort();
  const regexProfileIds = [...(payload.regexProfileIds ?? [])].sort();
  return {
    domains,
    sessionIds,
    characterIds,
    presetIds,
    worldbookIds,
    regexProfileIds,
    includeLinkedAssets: payload.includeLinkedAssets,
    includeVcTags: payload.includeVcTags,
    includeOperationLogs: payload.includeOperationLogs,
    includeSecrets: payload.includeSecrets,
  };
}

export function isFullBackupExportSelection(payload: ExportCoreAssetsJobRequest): boolean {
  const hasExplicitSelection = (payload.sessionIds?.length ?? 0) > 0
    || (payload.characterIds?.length ?? 0) > 0
    || (payload.presetIds?.length ?? 0) > 0
    || (payload.worldbookIds?.length ?? 0) > 0
    || (payload.regexProfileIds?.length ?? 0) > 0;
  const domains = payload.domains ?? [...TH_BACKUP_DOMAINS];
  return !hasExplicitSelection && domains.length === TH_BACKUP_DOMAINS.length;
}

export function buildBackupExportScopeKey(accountId: string, payload: ExportCoreAssetsJobRequest): string {
  if (isFullBackupExportSelection(payload)) {
    return `account:${accountId}:core-assets`;
  }

  const digest = createHash("sha256")
    .update(JSON.stringify(normalizeSelectionDigestPayload(payload)))
    .digest("hex")
    .slice(0, 16);
  return `account:${accountId}:selection:${digest}`;
}

export function buildBackupRestoreScopeKey(accountId: string): string {
  return `account:${accountId}:restore`;
}

export function readBackupJobState(value: unknown): BackupRuntimeJobState {
  const parsed = typeof value === "string"
    ? safeParseStateJson(value)
    : value;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const state = parsed as Record<string, unknown>;
  return {
    outputArtifactPath: typeof state.outputArtifactPath === "string" ? state.outputArtifactPath : null,
    outputExpiresAt: typeof state.outputExpiresAt === "number" ? state.outputExpiresAt : null,
    fileName: typeof state.fileName === "string" ? state.fileName : null,
    includedDomains: Array.isArray(state.includedDomains)
      ? state.includedDomains.filter((item): item is string => typeof item === "string")
      : null,
    restoreMode: typeof state.restoreMode === "string" ? state.restoreMode : null,
  };
}

function safeParseStateJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function createDefinition<TPayload>(definition: RuntimeJobDefinition<TPayload>): RuntimeJobDefinition<TPayload> {
  return definition;
}

export function createBackupRuntimeJobCatalog(): RuntimeJobCatalog {
  const catalog = new RuntimeJobCatalog();

  catalog.register(createDefinition<ExportCoreAssetsJobRequest>({
    jobType: BACKUP_RUNTIME_JOB_TYPES.export_core_assets,
    payloadSchema: exportCoreAssetsJobRequestSchema,
    defaultMaxAttempts: 5,
    initialPhase: "queued",
    createJobId({ requestedId }) {
      return requestedId && requestedId.trim().length > 0
        ? requestedId
        : createBackupJobId("export_core_assets");
    },
  }));

  catalog.register(createDefinition<RestoreCoreAssetsJobRequest>({
    jobType: BACKUP_RUNTIME_JOB_TYPES.restore_core_assets,
    payloadSchema: restoreCoreAssetsJobRequestSchema,
    defaultMaxAttempts: 3,
    initialPhase: "queued",
    createJobId({ requestedId }) {
      return requestedId && requestedId.trim().length > 0
        ? requestedId
        : createBackupJobId("restore_core_assets");
    },
  }));

  return catalog;
}
