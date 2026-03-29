import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  buildQueryString,
  compactObject,
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";
import type { MemoryScope } from "./memories.js";

export type MemoryJobType = "ingest_turn" | "compact_macro" | "maintenance" | "rebuild_scope";
export type MemoryJobStatus =
  | "pending"
  | "leased"
  | "running"
  | "retry_waiting"
  | "succeeded"
  | "dead_letter"
  | "cancelled";

export type MemoryMaintenancePolicy = {
  deprecatedPurgeAgeMs?: number;
  openLoopMaxAgeMs?: number;
  summaryMaxAgeMs?: number;
};

export type MemoryIngestTurnJobPayload = {
  accountId: string;
  assistantMessageId: string;
  committedAt: number;
  enableConsolidation: boolean;
  floorId: string;
  floorNo: number;
  sessionId: string;
  summaries: string[];
  userInputDigest: string;
};

export type MemoryCompactMacroJobPayload = {
  accountId: string;
  committedAt: number;
  coverageEndFloorNo: number | null;
  coverageStartFloorNo: number | null;
  force: boolean;
  scope: MemoryScope;
  scopeId: string;
  sessionId?: string;
  sourceMicroIds: string[];
  triggerFloorId: string | null;
};

export type MemoryMaintenanceJobPayload = {
  accountId: string;
  batchSize: number | null;
  dryRun: boolean;
  policy: MemoryMaintenancePolicy | null;
  scheduleBucket: number;
  scheduledAt: number;
  scope: MemoryScope;
  scopeId: string;
};

export type MemoryRebuildScopeJobPayload = {
  accountId: string;
  committedAt: number;
  forceCompaction: boolean;
  scope: MemoryScope;
  scopeId: string;
  triggerFloorId: string | null;
};

export type MemoryJobPayload =
  | MemoryCompactMacroJobPayload
  | MemoryIngestTurnJobPayload
  | MemoryMaintenanceJobPayload
  | MemoryRebuildScopeJobPayload
  | Record<string, unknown>
  | null;

export type MemoryJobRecord = {
  attemptCount: number;
  availableAt: number;
  basedOnRevision: number | null;
  createdAt: number;
  finishedAt: number | null;
  floorId: string | null;
  id: string;
  jobType: MemoryJobType;
  lastError: string | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  maxAttempts: number;
  payload: MemoryJobPayload;
  scope: MemoryScope;
  scopeId: string;
  status: MemoryJobStatus;
  updatedAt: number;
};

export type MemoryJobsListMeta = {
  hasMore: boolean;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  total: number;
};

export type MemoryJobsListResult = {
  jobs: MemoryJobRecord[];
  meta: MemoryJobsListMeta;
};

export type MemoryJobsListOptions = {
  accountId?: AccountIdHint;
  availableFrom?: number;
  availableTo?: number;
  createdFrom?: number;
  createdTo?: number;
  floorId?: string;
  jobType?: MemoryJobType;
  limit?: number;
  offset?: number;
  scope?: MemoryScope;
  scopeId?: string;
  sortBy?: "available_at" | "created_at" | "updated_at";
  sortOrder?: "asc" | "desc";
  status?: MemoryJobStatus;
};

export type MemoryJobMutationResult = {
  created: boolean;
  jobId: string;
  scope: MemoryScope;
  scopeId: string;
};

export type MemoryJobsResource = {
  cancel(options: { accountId?: AccountIdHint; jobId: string }): Promise<MemoryJobMutationResult>;
  list(options?: MemoryJobsListOptions): Promise<MemoryJobsListResult>;
  retry(options: { accountId?: AccountIdHint; jobId: string }): Promise<MemoryJobMutationResult>;
};

export function createMemoryJobsResource(client: TransportClient): MemoryJobsResource {
  return {
    async cancel(options): Promise<MemoryJobMutationResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/memory/jobs/${encodeURIComponent(options.jobId)}/cancel`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapMemoryJobMutationResult(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory job cancel returned an invalid payload");
      }

      return payload;
    },
    async list(options: MemoryJobsListOptions = {}): Promise<MemoryJobsListResult> {
      const query = buildQueryString(
        compactObject({
          available_from: options.availableFrom,
          available_to: options.availableTo,
          created_from: options.createdFrom,
          created_to: options.createdTo,
          floor_id: options.floorId,
          job_type: options.jobType,
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
          scope: options.scope,
          scope_id: options.scopeId,
          sort_by: options.sortBy ?? "created_at",
          sort_order: options.sortOrder ?? "desc",
          status: options.status,
        }),
      );
      const pathname = query ? `/memory/jobs?${query}` : "/memory/jobs";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return {
        jobs: readArray(readRecord(response.body)?.data)
          .map(mapMemoryJobRecord)
          .filter((item): item is MemoryJobRecord => item !== null),
        meta: mapMemoryJobsListMeta(readRecord(response.body)?.meta),
      };
    },
    async retry(options): Promise<MemoryJobMutationResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/memory/jobs/${encodeURIComponent(options.jobId)}/retry`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapMemoryJobMutationResult(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory job retry returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapMemoryJobRecord(value: unknown): MemoryJobRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const jobType = readString(record.job_type, "ingest_turn") as MemoryJobType;

  return {
    attemptCount: readNumber(record.attempt_count),
    availableAt: readNumber(record.available_at),
    basedOnRevision: readNullableNumber(record.based_on_revision),
    createdAt: readNumber(record.created_at),
    finishedAt: readNullableNumber(record.finished_at),
    floorId: readNullableString(record.floor_id),
    id: readString(record.id),
    jobType,
    lastError: readNullableString(record.last_error),
    leaseOwner: readNullableString(record.lease_owner),
    leaseUntil: readNullableNumber(record.lease_until),
    maxAttempts: readNumber(record.max_attempts),
    payload: mapMemoryJobPayload(jobType, record.payload),
    scope: readString(record.scope, "chat") as MemoryScope,
    scopeId: readString(record.scope_id),
    status: readString(record.status, "pending") as MemoryJobStatus,
    updatedAt: readNumber(record.updated_at),
  };
}

function mapMemoryJobPayload(jobType: MemoryJobType, value: unknown): MemoryJobPayload {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  switch (jobType) {
    case "compact_macro":
      return {
        accountId: readString(record.accountId),
        committedAt: readNumber(record.committedAt),
        coverageEndFloorNo: readNullableNumber(record.coverageEndFloorNo),
        coverageStartFloorNo: readNullableNumber(record.coverageStartFloorNo),
        force: readBoolean(record.force, false),
        scope: readString(record.scope, "chat") as MemoryScope,
        scopeId: readString(record.scopeId),
        sessionId: readNullableString(record.sessionId) ?? undefined,
        sourceMicroIds: readStringArray(record.sourceMicroIds),
        triggerFloorId: readNullableString(record.triggerFloorId),
      };
    case "ingest_turn":
      return {
        accountId: readString(record.accountId),
        assistantMessageId: readString(record.assistantMessageId),
        committedAt: readNumber(record.committedAt),
        enableConsolidation: readBoolean(record.enableConsolidation, false),
        floorId: readString(record.floorId),
        floorNo: readNumber(record.floorNo),
        sessionId: readString(record.sessionId),
        summaries: readStringArray(record.summaries),
        userInputDigest: readString(record.userInputDigest),
      };
    case "maintenance":
      return {
        accountId: readString(record.accountId),
        batchSize: readNullableNumber(record.batchSize),
        dryRun: readBoolean(record.dryRun, false),
        policy: mapMemoryMaintenancePolicy(record.policy),
        scheduleBucket: readNumber(record.scheduleBucket),
        scheduledAt: readNumber(record.scheduledAt),
        scope: readString(record.scope, "chat") as MemoryScope,
        scopeId: readString(record.scopeId),
      };
    case "rebuild_scope":
      return {
        accountId: readString(record.accountId),
        committedAt: readNumber(record.committedAt),
        forceCompaction: readBoolean(record.forceCompaction, true),
        scope: readString(record.scope, "chat") as MemoryScope,
        scopeId: readString(record.scopeId),
        triggerFloorId: readNullableString(record.triggerFloorId),
      };
    default:
      return record;
  }
}

function mapMemoryMaintenancePolicy(value: unknown): MemoryMaintenancePolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const policy: MemoryMaintenancePolicy = {};

  if (typeof record.summaryMaxAgeMs === "number") {
    policy.summaryMaxAgeMs = record.summaryMaxAgeMs;
  }
  if (typeof record.openLoopMaxAgeMs === "number") {
    policy.openLoopMaxAgeMs = record.openLoopMaxAgeMs;
  }
  if (typeof record.deprecatedPurgeAgeMs === "number") {
    policy.deprecatedPurgeAgeMs = record.deprecatedPurgeAgeMs;
  }

  return policy;
}

function mapMemoryJobsListMeta(value: unknown): MemoryJobsListMeta {
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

function mapMemoryJobMutationResult(value: unknown): MemoryJobMutationResult | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    created: readBoolean(record.created),
    jobId: readString(record.job_id),
    scope: readString(record.scope, "chat") as MemoryScope,
    scopeId: readString(record.scope_id),
  };
}

function readStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readString(item))
    .filter((item) => item.length > 0);
}
