import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { buildQueryString, compactObject, readArray, readRecord } from "./utils.js";
import {
  mapBackupJobRecord,
  mapBackupJobsListMeta,
  type BackupJobKind,
  type BackupJobRecord,
  type BackupJobsListMeta,
  type BackupJobStatus,
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
  BackupJobRecord,
  BackupJobRequest,
  BackupJobResult,
  BackupJobsListMeta,
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

export type BackupJobsListOptions = {
  accountId?: AccountIdHint;
  jobKind?: BackupJobKind;
  limit?: number;
  offset?: number;
  sortBy?: "available_at" | "created_at" | "updated_at";
  sortOrder?: "asc" | "desc";
  status?: BackupJobStatus;
};

export type BackupJobsListResult = {
  jobs: BackupJobRecord[];
  meta: BackupJobsListMeta;
};

export type BackupJobMutationResult = {
  jobId: string;
  status: BackupJobStatus;
};

export type BackupJobsResource = {
  cancel(options: { accountId?: AccountIdHint; jobId: string; signal?: AbortSignal }): Promise<BackupJobMutationResult>;
  downloadFile(options: { accountId?: AccountIdHint; jobId: string; signal?: AbortSignal }): Promise<Response>;
  getDetail(options: { accountId?: AccountIdHint; jobId: string; signal?: AbortSignal }): Promise<BackupJobRecord>;
  list(options?: BackupJobsListOptions): Promise<BackupJobsListResult>;
  retry(options: { accountId?: AccountIdHint; jobId: string; signal?: AbortSignal }): Promise<BackupJobMutationResult>;
};

export function createBackupJobsResource(client: TransportClient): BackupJobsResource {
  return {
    async cancel(options): Promise<BackupJobMutationResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/backup-jobs/${encodeURIComponent(options.jobId)}/cancel`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
          signal: options.signal,
        },
      );

      const payload = mapBackupJobMutationResult(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Backup job cancel returned an invalid payload");
      }

      return payload;
    },
    async downloadFile(options): Promise<Response> {
      return client.fetchRaw(`/backup-jobs/${encodeURIComponent(options.jobId)}/file`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
        signal: options.signal,
      });
    },
    async getDetail(options): Promise<BackupJobRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/backup-jobs/${encodeURIComponent(options.jobId)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
          signal: options.signal,
        },
      );

      const payload = mapBackupJobRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Backup job detail returned an invalid payload");
      }

      return payload;
    },
    async list(options: BackupJobsListOptions = {}): Promise<BackupJobsListResult> {
      const query = buildQueryString(
        compactObject({
          job_kind: options.jobKind,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
          sort_by: options.sortBy ?? "created_at",
          sort_order: options.sortOrder ?? "desc",
          status: options.status,
        }),
      );
      const pathname = query ? `/backup-jobs?${query}` : "/backup-jobs";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return {
        jobs: readArray(readRecord(response.body)?.data)
          .map(mapBackupJobRecord)
          .filter((item): item is BackupJobRecord => item !== null),
        meta: mapBackupJobsListMeta(readRecord(response.body)?.meta),
      };
    },
    async retry(options): Promise<BackupJobMutationResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/backup-jobs/${encodeURIComponent(options.jobId)}/retry`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
          signal: options.signal,
        },
      );

      const payload = mapBackupJobMutationResult(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Backup job retry returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapBackupJobMutationResult(value: unknown): BackupJobMutationResult | null {
  const record = readRecord(value);
  const jobId = record && typeof record.job_id === "string" && record.job_id.length > 0
    ? record.job_id
    : null;
  const status = typeof record?.status === "string" ? record.status : null;
  if (!jobId || !status) {
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

  return {
    jobId,
    status,
  };
}
