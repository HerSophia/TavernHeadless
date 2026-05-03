import type { ThBackupDomain, ThBackupFile } from "@tavern/shared/types/backup-file";

import {
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readOptionalString,
  readRecord,
  readString,
} from "./utils.js";

export type BackupDomain = ThBackupDomain;
export type BackupFile = ThBackupFile;
export type BackupRestoreMode = "create_copy";
export type BackupJobKind = "export_core_assets" | "restore_core_assets";
export type BackupJobStatus =
  | "pending"
  | "leased"
  | "running"
  | "retry_waiting"
  | "succeeded"
  | "dead_letter"
  | "cancelled";
export type BackupJobPhase =
  | "queued"
  | "collecting"
  | "serializing"
  | "writing_artifact"
  | "validating"
  | "normalizing"
  | "remapping"
  | "publishing"
  | "rebuilding_runtime_state"
  | "finalizing"
  | "completed";

export type BackupCountSummary = {
  branchLocalVariableSnapshots: number;
  characterVersions: number;
  characters: number;
  floors: number;
  memoryEdges: number;
  memoryItems: number;
  messages: number;
  pages: number;
  sessionBranches: number;
  sessions: number;
  variables: number;
  worldbookEntries: number;
  worldbooks: number;
};

export type BackupTopLevelCreateSummary = {
  characters: number;
  sessions: number;
  worldbooks: number;
};

export type BackupRestoreCreatedSummary = BackupCountSummary & {
  runtimeScopeStates: number;
};

export type BackupWarning = {
  code: string;
  message: string;
  sessionId?: string;
};

export type BackupRenamedResource = {
  newName: string;
  oldName: string;
  type: "character" | "worldbook" | "session";
};

export type BackupDroppedBindingSummary = {
  presets: number;
  regexProfiles: number;
  users: number;
};

export type BackupFileSource = {
  accountId: string;
  appVersion?: string;
};

export type BackupRestorePreview = {
  backupKind: string;
  counts: BackupCountSummary;
  droppedBindings: BackupDroppedBindingSummary;
  includedDomains: BackupDomain[];
  renamedResources: BackupRenamedResource[];
  restoreMode: BackupRestoreMode;
  warnings: BackupWarning[];
  willCreate: BackupTopLevelCreateSummary;
};

export type BackupExportJobRequest = {
  characterIds: string[];
  domains: BackupDomain[] | null;
  includeLinkedAssets: boolean;
  includeSecrets: boolean;
  sessionIds: string[];
  worldbookIds: string[];
};

export type BackupRestoreJobRequest = {
  backupKind: string | null;
  createdAt: number | null;
  includedDomains: BackupDomain[] | null;
  mode: BackupRestoreMode;
  source: BackupFileSource | null;
};

export type BackupJobRequest = BackupExportJobRequest | BackupRestoreJobRequest;

export type BackupExportJobResult = {
  byteLength: number;
  contentType: string;
  counts: BackupCountSummary;
  fileName: string;
  includedDomains: BackupDomain[];
};

export type BackupRestoreJobResult = {
  created: BackupRestoreCreatedSummary;
  droppedBindings: BackupDroppedBindingSummary;
  mode: BackupRestoreMode;
  renamedResources: BackupRenamedResource[];
  warnings: BackupWarning[];
};

export type BackupJobResult = BackupExportJobResult | BackupRestoreJobResult;

export type BackupJobHandle = {
  jobId: string;
  jobKind: BackupJobKind;
  phase: BackupJobPhase;
  status: BackupJobStatus;
};

export type BackupJobRecord = {
  attemptCount: number;
  availableAt: number;
  createdAt: number;
  finishedAt: number | null;
  id: string;
  jobKind: BackupJobKind;
  lastError: string | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  maxAttempts: number;
  outputArtifactPath: string | null;
  outputExpiresAt: number | null;
  phase: BackupJobPhase;
  progressCurrent: number;
  progressMessage: string | null;
  progressTotal: number | null;
  request: BackupJobRequest | null;
  result: BackupJobResult | null;
  status: BackupJobStatus;
  updatedAt: number;
};

export type BackupJobsListMeta = {
  hasMore: boolean;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  total: number;
};

function hasField(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function isBackupDomain(value: unknown): value is BackupDomain {
  return value === "characters" || value === "worldbooks" || value === "sessions";
}

function readBackupDomains(value: unknown): BackupDomain[] {
  return readArray(value).filter(isBackupDomain);
}

function readNullableBackupDomains(value: unknown): BackupDomain[] | null {
  if (value === null) {
    return null;
  }

  const domains = readBackupDomains(value);
  return Array.isArray(value) ? domains : null;
}

function readStringArray(value: unknown): string[] {
  return readArray(value).filter((item): item is string => typeof item === "string");
}

export function mapBackupCountSummary(value: unknown): BackupCountSummary {
  const record = readRecord(value);

  return {
    branchLocalVariableSnapshots: readNumber(record?.branch_local_variable_snapshots),
    characterVersions: readNumber(record?.character_versions),
    characters: readNumber(record?.characters),
    floors: readNumber(record?.floors),
    memoryEdges: readNumber(record?.memory_edges),
    memoryItems: readNumber(record?.memory_items),
    messages: readNumber(record?.messages),
    pages: readNumber(record?.pages),
    sessionBranches: readNumber(record?.session_branches),
    sessions: readNumber(record?.sessions),
    variables: readNumber(record?.variables),
    worldbookEntries: readNumber(record?.worldbook_entries),
    worldbooks: readNumber(record?.worldbooks),
  };
}

export function mapBackupTopLevelCreateSummary(value: unknown): BackupTopLevelCreateSummary {
  const record = readRecord(value);

  return {
    characters: readNumber(record?.characters),
    sessions: readNumber(record?.sessions),
    worldbooks: readNumber(record?.worldbooks),
  };
}

export function mapBackupRestoreCreatedSummary(value: unknown): BackupRestoreCreatedSummary {
  const record = readRecord(value);

  return {
    ...mapBackupCountSummary(record),
    runtimeScopeStates: readNumber(record?.runtime_scope_states),
  };
}

export function mapBackupWarning(value: unknown): BackupWarning | null {
  const record = readRecord(value);
  const code = readOptionalString(record?.code);
  const message = readOptionalString(record?.message);
  if (!record || !code || !message) {
    return null;
  }

  const sessionId = readOptionalString(record.session_id) ?? readOptionalString(record.sessionId);
  return {
    code,
    message,
    ...(sessionId ? { sessionId } : {}),
  };
}

export function mapBackupWarnings(value: unknown): BackupWarning[] {
  return readArray(value)
    .map(mapBackupWarning)
    .filter((item): item is BackupWarning => item !== null);
}

export function mapBackupRenamedResource(value: unknown): BackupRenamedResource | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const type = readString(record.type);
  const oldName = readOptionalString(record.old_name) ?? readOptionalString(record.oldName);
  const newName = readOptionalString(record.new_name) ?? readOptionalString(record.newName);
  if (!oldName || !newName) {
    return null;
  }
  if (type !== "character" && type !== "worldbook" && type !== "session") {
    return null;
  }

  return {
    newName,
    oldName,
    type,
  };
}

export function mapBackupRenamedResources(value: unknown): BackupRenamedResource[] {
  return readArray(value)
    .map(mapBackupRenamedResource)
    .filter((item): item is BackupRenamedResource => item !== null);
}

export function mapBackupDroppedBindingSummary(value: unknown): BackupDroppedBindingSummary {
  const record = readRecord(value);

  return {
    presets: readNumber(record?.presets),
    regexProfiles: readNumber(record?.regex_profiles ?? record?.regexProfiles),
    users: readNumber(record?.users),
  };
}

export function mapBackupFileSource(value: unknown): BackupFileSource | null {
  const record = readRecord(value);
  const accountId = readOptionalString(record?.account_id) ?? readOptionalString(record?.accountId);
  if (!record || !accountId) {
    return null;
  }

  const appVersion = readOptionalString(record.app_version) ?? readOptionalString(record.appVersion);
  return {
    accountId,
    ...(appVersion ? { appVersion } : {}),
  };
}

export function mapBackupRestorePreview(value: unknown): BackupRestorePreview | null {
  const record = readRecord(value);
  const backupKind = readOptionalString(record?.backup_kind) ?? readOptionalString(record?.backupKind);
  const restoreMode = readString(record?.restore_mode ?? record?.restoreMode, "create_copy");
  if (!record || !backupKind || restoreMode !== "create_copy") {
    return null;
  }

  return {
    backupKind,
    counts: mapBackupCountSummary(record.counts),
    droppedBindings: mapBackupDroppedBindingSummary(record.dropped_bindings ?? record.droppedBindings),
    includedDomains: readBackupDomains(record.included_domains ?? record.includedDomains),
    renamedResources: mapBackupRenamedResources(record.renamed_resources ?? record.renamedResources),
    restoreMode,
    warnings: mapBackupWarnings(record.warnings),
    willCreate: mapBackupTopLevelCreateSummary(record.will_create ?? record.willCreate),
  };
}

export function mapBackupJobHandle(value: unknown): BackupJobHandle | null {
  const record = readRecord(value);
  const jobId = readOptionalString(record?.job_id) ?? readOptionalString(record?.jobId);
  const jobKind = readString(record?.job_kind ?? record?.jobKind);
  const status = readString(record?.status, "pending");
  const phase = readString(record?.phase, "queued");
  if (!record || !jobId) {
    return null;
  }
  if (jobKind !== "export_core_assets" && jobKind !== "restore_core_assets") {
    return null;
  }
  if (
    status !== "pending"
    && status !== "leased"
    && status !== "running"
    && status !== "retry_waiting"
    && status !== "succeeded"
    && status !== "dead_letter"
    && status !== "cancelled"
  ) {
    return null;
  }
  if (
    phase !== "queued"
    && phase !== "collecting"
    && phase !== "serializing"
    && phase !== "writing_artifact"
    && phase !== "validating"
    && phase !== "normalizing"
    && phase !== "remapping"
    && phase !== "publishing"
    && phase !== "rebuilding_runtime_state"
    && phase !== "finalizing"
    && phase !== "completed"
  ) {
    return null;
  }

  return {
    jobId,
    jobKind,
    phase,
    status,
  };
}

export function mapBackupJobRequest(value: unknown): BackupJobRequest | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const hasRestoreShape = hasField(record, "mode")
    || hasField(record, "backup_kind")
    || hasField(record, "included_domains")
    || hasField(record, "created_at")
    || hasField(record, "source");
  const hasExportShape = hasField(record, "domains")
    || hasField(record, "session_ids")
    || hasField(record, "character_ids")
    || hasField(record, "worldbook_ids")
    || hasField(record, "include_linked_assets")
    || hasField(record, "include_secrets");

  if (hasRestoreShape) {
    const mode = readString(record.mode, "create_copy");
    if (mode !== "create_copy") {
      return null;
    }

    return {
      backupKind: readNullableString(record.backup_kind),
      createdAt: readNullableNumber(record.created_at),
      includedDomains: readNullableBackupDomains(record.included_domains),
      mode,
      source: mapBackupFileSource(record.source),
    };
  }

  if (!hasExportShape) {
    return null;
  }

  return {
    characterIds: readStringArray(record.character_ids),
    domains: readNullableBackupDomains(record.domains),
    includeLinkedAssets: readBoolean(record.include_linked_assets, true),
    includeSecrets: readBoolean(record.include_secrets, false),
    sessionIds: readStringArray(record.session_ids),
    worldbookIds: readStringArray(record.worldbook_ids),
  };
}

export function mapBackupJobResult(value: unknown): BackupJobResult | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const hasExportShape = hasField(record, "file_name")
    || hasField(record, "fileName")
    || hasField(record, "content_type")
    || hasField(record, "contentType")
    || hasField(record, "byte_length")
    || hasField(record, "byteLength");
  const hasRestoreShape = hasField(record, "mode")
    || hasField(record, "created")
    || hasField(record, "renamed_resources")
    || hasField(record, "renamedResources")
    || hasField(record, "dropped_bindings")
    || hasField(record, "droppedBindings");

  if (hasExportShape) {
    const fileName = readOptionalString(record.file_name) ?? readOptionalString(record.fileName);
    const contentType = readOptionalString(record.content_type) ?? readOptionalString(record.contentType);
    const byteLength = typeof record.byte_length === "number"
      ? record.byte_length
      : typeof record.byteLength === "number"
        ? record.byteLength
        : null;
    if (!fileName || !contentType || byteLength === null) {
      return null;
    }

    return {
      byteLength,
      contentType,
      counts: mapBackupCountSummary(record.counts),
      fileName,
      includedDomains: readBackupDomains(record.included_domains ?? record.includedDomains),
    };
  }

  if (!hasRestoreShape) {
    return null;
  }

  const mode = readString(record.mode, "create_copy");
  if (mode !== "create_copy") {
    return null;
  }

  return {
    created: mapBackupRestoreCreatedSummary(record.created),
    droppedBindings: mapBackupDroppedBindingSummary(record.dropped_bindings ?? record.droppedBindings),
    mode,
    renamedResources: mapBackupRenamedResources(record.renamed_resources ?? record.renamedResources),
    warnings: mapBackupWarnings(record.warnings),
  };
}

export function mapBackupJobRecord(value: unknown): BackupJobRecord | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  const jobKind = readString(record?.job_kind, "export_core_assets");
  if (!record || !id) {
    return null;
  }
  if (jobKind !== "export_core_assets" && jobKind !== "restore_core_assets") {
    return null;
  }

  return {
    attemptCount: readNumber(record.attempt_count),
    availableAt: readNumber(record.available_at),
    createdAt: readNumber(record.created_at),
    finishedAt: readNullableNumber(record.finished_at),
    id,
    jobKind,
    lastError: readNullableString(record.last_error),
    leaseOwner: readNullableString(record.lease_owner),
    leaseUntil: readNullableNumber(record.lease_until),
    maxAttempts: readNumber(record.max_attempts),
    outputArtifactPath: readNullableString(record.output_artifact_path),
    outputExpiresAt: readNullableNumber(record.output_expires_at),
    phase: readString(record.phase, "queued") as BackupJobPhase,
    progressCurrent: readNumber(record.progress_current),
    progressMessage: readNullableString(record.progress_message),
    progressTotal: readNullableNumber(record.progress_total),
    request: mapBackupJobRequest(record.request),
    result: mapBackupJobResult(record.result),
    status: readString(record.status, "pending") as BackupJobStatus,
    updatedAt: readNumber(record.updated_at),
  };
}

export function mapBackupJobsListMeta(value: unknown): BackupJobsListMeta {
  const record = readRecord(value);

  return {
    hasMore: readBoolean(record?.has_more),
    limit: readNumber(record?.limit),
    offset: readNumber(record?.offset),
    sortBy: readString(record?.sort_by, "created_at"),
    sortOrder: readString(record?.sort_order, "desc") as "asc" | "desc",
    total: readNumber(record?.total),
  };
}
