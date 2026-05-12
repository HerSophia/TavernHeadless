import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { compactObject, readRecord } from "./utils.js";
import {
  mapBackupJobHandle,
  mapBackupRestorePreview,
  type BackupDomain,
  type BackupFile,
  type BackupJobHandle,
  type BackupRestoreMode,
  type BackupRestorePreview,
} from "./backup-shared.js";

export type {
  BackupCountSummary,
  BackupDomain,
  BackupDroppedBindingSummary,
  BackupFile,
  BackupFileSource,
  BackupJobHandle,
  BackupJobKind,
  BackupJobPhase,
  BackupJobRequest,
  BackupJobResult,
  BackupJobStatus,
  BackupRenamedResource,
  BackupRestoreCreatedSummary,
  BackupRestoreJobRequest,
  BackupRestoreJobResult,
  BackupRestoreMode,
  BackupRestorePreview,
  BackupTopLevelCreateSummary,
  BackupWarning,
  BackupExportJobRequest,
  BackupExportJobResult,
} from "./backup-shared.js";

export type BackupResource = {
  createExportJob(options: {
    accountId?: AccountIdHint;
    characterIds?: string[];
    domains?: BackupDomain[];
    includeLinkedAssets?: boolean;
    includeSecrets?: false;
    presetIds?: string[];
    regexProfileIds?: string[];
    sessionIds?: string[];
    signal?: AbortSignal;
    worldbookIds?: string[];
  }): Promise<BackupJobHandle>;
  createRestoreJob(options: {
    accountId?: AccountIdHint;
    data: BackupFile | Record<string, unknown>;
    mode?: BackupRestoreMode;
    signal?: AbortSignal;
  }): Promise<BackupJobHandle>;
  previewRestore(options: {
    accountId?: AccountIdHint;
    data: BackupFile | Record<string, unknown>;
    mode?: BackupRestoreMode;
    signal?: AbortSignal;
  }): Promise<BackupRestorePreview>;
};

export function createBackupResource(client: TransportClient): BackupResource {
  return {
    async createExportJob(options): Promise<BackupJobHandle> {
      const response = await client.fetchJson<Record<string, unknown>>("/backup/jobs/export", {
        body: compactObject({
          character_ids: options.characterIds,
          domains: options.domains,
          include_linked_assets: options.includeLinkedAssets,
          include_secrets: options.includeSecrets,
          preset_ids: options.presetIds,
          regex_profile_ids: options.regexProfileIds,
          session_ids: options.sessionIds,
          worldbook_ids: options.worldbookIds,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
        signal: options.signal,
      });

      const payload = mapBackupJobHandle(readRecord(response.body)?.data);
      if (!payload || payload.jobKind !== "export_core_assets") {
        throw new Error("Backup export job creation returned an invalid payload");
      }

      return payload;
    },
    async createRestoreJob(options): Promise<BackupJobHandle> {
      const response = await client.fetchJson<Record<string, unknown>>("/backup/jobs/restore", {
        body: compactObject({
          data: options.data,
          mode: options.mode,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
        signal: options.signal,
      });

      const payload = mapBackupJobHandle(readRecord(response.body)?.data);
      if (!payload || payload.jobKind !== "restore_core_assets") {
        throw new Error("Backup restore job creation returned an invalid payload");
      }

      return payload;
    },
    async previewRestore(options): Promise<BackupRestorePreview> {
      const response = await client.fetchJson<Record<string, unknown>>("/backup/restore/preview", {
        body: compactObject({
          data: options.data,
          mode: options.mode,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
        signal: options.signal,
      });

      const payload = mapBackupRestorePreview(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Backup restore preview returned an invalid payload");
      }

      return payload;
    },
  };
}
