import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  buildQueryString,
  compactObject,
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readOptionalString,
  readRecord,
  readString,
} from "./utils.js";

export type ChatTransferJobKind = "import_chat" | "export_chat";
export type ChatTransferJobStatus =
  | "pending"
  | "leased"
  | "running"
  | "retry_waiting"
  | "succeeded"
  | "dead_letter"
  | "cancelled";
export type ChatTransferJobPhase =
  | "queued"
  | "parsing"
  | "normalizing"
  | "publishing"
  | "snapshotting"
  | "rendering"
  | "writing_artifact"
  | "finalizing"
  | "completed";
export type ChatTransferFormat = "thchat" | "sillytavern_jsonl" | "st_jsonl";

export type ChatTransferJobRecord = {
  attemptCount: number;
  availableAt: number;
  createdAt: number;
  finishedAt: number | null;
  format: ChatTransferFormat | null;
  id: string;
  inputArtifactPath: string | null;
  jobKind: ChatTransferJobKind;
  lastError: string | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  maxAttempts: number;
  normalizedArtifactPath: string | null;
  outputArtifactPath: string | null;
  outputExpiresAt: number | null;
  phase: ChatTransferJobPhase;
  progressCurrent: number;
  progressMessage: string | null;
  progressTotal: number | null;
  request: unknown;
  requestedSessionId: string | null;
  result: unknown;
  resultSessionId: string | null;
  status: ChatTransferJobStatus;
  updatedAt: number;
};

export type ChatTransferJobsListMeta = {
  hasMore: boolean;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  total: number;
};

export type ChatTransferJobsListOptions = {
  accountId?: AccountIdHint;
  availableFrom?: number;
  availableTo?: number;
  createdFrom?: number;
  createdTo?: number;
  format?: ChatTransferFormat;
  jobKind?: ChatTransferJobKind;
  limit?: number;
  offset?: number;
  requestedSessionId?: string;
  resultSessionId?: string;
  sortBy?: "available_at" | "created_at" | "updated_at";
  sortOrder?: "asc" | "desc";
  status?: ChatTransferJobStatus;
};

export type ChatTransferJobsListResult = {
  jobs: ChatTransferJobRecord[];
  meta: ChatTransferJobsListMeta;
};

export type ChatTransferJobMutationResult = {
  jobId: string;
  status: ChatTransferJobStatus;
};

export type ChatTransferJobsResource = {
  cancel(options: { accountId?: AccountIdHint; jobId: string }): Promise<ChatTransferJobMutationResult>;
  downloadFile(options: { accountId?: AccountIdHint; jobId: string; signal?: AbortSignal }): Promise<Response>;
  getDetail(options: { accountId?: AccountIdHint; jobId: string }): Promise<ChatTransferJobRecord>;
  list(options?: ChatTransferJobsListOptions): Promise<ChatTransferJobsListResult>;
  retry(options: { accountId?: AccountIdHint; jobId: string }): Promise<ChatTransferJobMutationResult>;
};

export function createChatTransferJobsResource(client: TransportClient): ChatTransferJobsResource {
  return {
    async cancel(options): Promise<ChatTransferJobMutationResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/chat-transfer-jobs/${encodeURIComponent(options.jobId)}/cancel`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapChatTransferJobMutationResult(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Chat transfer job cancel returned an invalid payload");
      }

      return payload;
    },
    async downloadFile(options): Promise<Response> {
      return client.fetchRaw(`/chat-transfer-jobs/${encodeURIComponent(options.jobId)}/file`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
        signal: options.signal,
      });
    },
    async getDetail(options): Promise<ChatTransferJobRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/chat-transfer-jobs/${encodeURIComponent(options.jobId)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapChatTransferJobRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Chat transfer job detail returned an invalid payload");
      }

      return payload;
    },
    async list(options: ChatTransferJobsListOptions = {}): Promise<ChatTransferJobsListResult> {
      const query = buildQueryString(
        compactObject({
          available_from: options.availableFrom,
          available_to: options.availableTo,
          created_from: options.createdFrom,
          created_to: options.createdTo,
          format: options.format,
          job_kind: options.jobKind,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
          requested_session_id: options.requestedSessionId,
          result_session_id: options.resultSessionId,
          sort_by: options.sortBy ?? "created_at",
          sort_order: options.sortOrder ?? "desc",
          status: options.status,
        }),
      );
      const pathname = query ? `/chat-transfer-jobs?${query}` : "/chat-transfer-jobs";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return {
        jobs: readArray(readRecord(response.body)?.data)
          .map(mapChatTransferJobRecord)
          .filter((item): item is ChatTransferJobRecord => item !== null),
        meta: mapChatTransferJobsListMeta(readRecord(response.body)?.meta),
      };
    },
    async retry(options): Promise<ChatTransferJobMutationResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/chat-transfer-jobs/${encodeURIComponent(options.jobId)}/retry`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapChatTransferJobMutationResult(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Chat transfer job retry returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapChatTransferJobRecord(value: unknown): ChatTransferJobRecord | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  if (!record || !id) {
    return null;
  }

  return {
    attemptCount: readNumber(record.attempt_count),
    availableAt: readNumber(record.available_at),
    createdAt: readNumber(record.created_at),
    finishedAt: readNullableNumber(record.finished_at),
    format: mapChatTransferFormat(record.format),
    id,
    inputArtifactPath: readNullableString(record.input_artifact_path),
    jobKind: readString(record.job_kind, "import_chat") as ChatTransferJobKind,
    lastError: readNullableString(record.last_error),
    leaseOwner: readNullableString(record.lease_owner),
    leaseUntil: readNullableNumber(record.lease_until),
    maxAttempts: readNumber(record.max_attempts),
    normalizedArtifactPath: readNullableString(record.normalized_artifact_path),
    outputArtifactPath: readNullableString(record.output_artifact_path),
    outputExpiresAt: readNullableNumber(record.output_expires_at),
    phase: readString(record.phase, "queued") as ChatTransferJobPhase,
    progressCurrent: readNumber(record.progress_current),
    progressMessage: readNullableString(record.progress_message),
    progressTotal: readNullableNumber(record.progress_total),
    request: Object.prototype.hasOwnProperty.call(record, "request") ? record.request : null,
    requestedSessionId: readNullableString(record.requested_session_id),
    result: Object.prototype.hasOwnProperty.call(record, "result") ? record.result : null,
    resultSessionId: readNullableString(record.result_session_id),
    status: readString(record.status, "pending") as ChatTransferJobStatus,
    updatedAt: readNumber(record.updated_at),
  };
}

function mapChatTransferJobsListMeta(value: unknown): ChatTransferJobsListMeta {
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

function mapChatTransferJobMutationResult(value: unknown): ChatTransferJobMutationResult | null {
  const record = readRecord(value);
  const jobId = readOptionalString(record?.job_id);
  if (!record || !jobId) {
    return null;
  }

  return {
    jobId,
    status: readString(record.status, "pending") as ChatTransferJobStatus,
  };
}

function mapChatTransferFormat(value: unknown): ChatTransferFormat | null {
  return value === "thchat" || value === "sillytavern_jsonl" || value === "st_jsonl" ? value : null;
}
