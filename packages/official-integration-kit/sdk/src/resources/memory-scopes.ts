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

export type MemoryCompactionTriggerReason =
  | "micro_count_threshold"
  | "micro_token_threshold"
  | "floor_gap_threshold"
  | "forced";

export type MemoryScopeStateRecord = {
  lastCompactionAt: number | null;
  lastProcessedFloorNo: number | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  revision: number;
  scope: MemoryScope;
  scopeId: string;
  updatedAt: number;
};

export type MemoryScopesListMeta = {
  hasMore: boolean;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  total: number;
};

export type MemoryScopesListResult = {
  meta: MemoryScopesListMeta;
  scopes: MemoryScopeStateRecord[];
};

export type MemoryScopesListOptions = {
  accountId?: AccountIdHint;
  limit?: number;
  offset?: number;
  scope?: MemoryScope;
  scopeId?: string;
  sortBy?: "last_compaction_at" | "last_processed_floor_no" | "revision" | "updated_at";
  sortOrder?: "asc" | "desc";
};

export type MemoryScopeJobResult = {
  created: boolean;
  jobId: string;
  scope: MemoryScope;
  scopeId: string;
};

export type MemoryScopeCompactResult = MemoryScopeJobResult & {
  coverageEndFloorNo: number | null;
  coverageStartFloorNo: number | null;
  reason: MemoryCompactionTriggerReason;
  sourceMicroIds: string[];
};

export type MemoryScopesResource = {
  compact(options: {
    accountId?: AccountIdHint;
    force?: boolean;
    scope: MemoryScope;
    scopeId: string;
    triggerFloorId?: string;
  }): Promise<MemoryScopeCompactResult>;
  list(options?: MemoryScopesListOptions): Promise<MemoryScopesListResult>;
  rebuild(options: {
    accountId?: AccountIdHint;
    forceCompaction?: boolean;
    scope: MemoryScope;
    scopeId: string;
    triggerFloorId?: string;
  }): Promise<MemoryScopeJobResult>;
};

export function createMemoryScopesResource(client: TransportClient): MemoryScopesResource {
  return {
    async compact(options): Promise<MemoryScopeCompactResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/memory/scopes/${encodeURIComponent(options.scope)}/${encodeURIComponent(options.scopeId)}/compact`,
        {
          body: compactObject({
            force: options.force,
            trigger_floor_id: options.triggerFloorId,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapMemoryScopeCompactResult(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory scope compact returned an invalid payload");
      }

      return payload;
    },
    async list(options: MemoryScopesListOptions = {}): Promise<MemoryScopesListResult> {
      const query = buildQueryString(
        compactObject({
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
          scope: options.scope,
          scope_id: options.scopeId,
          sort_by: options.sortBy ?? "updated_at",
          sort_order: options.sortOrder ?? "desc",
        }),
      );
      const pathname = query ? `/memory/scopes?${query}` : "/memory/scopes";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return {
        meta: mapMemoryScopesListMeta(readRecord(response.body)?.meta),
        scopes: readArray(readRecord(response.body)?.data)
          .map(mapMemoryScopeStateRecord)
          .filter((item): item is MemoryScopeStateRecord => item !== null),
      };
    },
    async rebuild(options): Promise<MemoryScopeJobResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/memory/scopes/${encodeURIComponent(options.scope)}/${encodeURIComponent(options.scopeId)}/rebuild`,
        {
          body: compactObject({
            force_compaction: options.forceCompaction,
            trigger_floor_id: options.triggerFloorId,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapMemoryScopeJobResult(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory scope rebuild returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapMemoryScopeStateRecord(value: unknown): MemoryScopeStateRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    lastCompactionAt: readNullableNumber(record.last_compaction_at),
    lastProcessedFloorNo: readNullableNumber(record.last_processed_floor_no),
    leaseOwner: readNullableString(record.lease_owner),
    leaseUntil: readNullableNumber(record.lease_until),
    revision: readNumber(record.revision),
    scope: readString(record.scope, "chat") as MemoryScope,
    scopeId: readString(record.scope_id),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapMemoryScopesListMeta(value: unknown): MemoryScopesListMeta {
  const record = readRecord(value);

  return {
    hasMore: readBoolean(record?.has_more),
    limit: readNumber(record?.limit),
    offset: readNumber(record?.offset),
    sortBy: readString(record?.sort_by, "updated_at"),
    sortOrder: readString(record?.sort_order, "desc") as "asc" | "desc",
    total: readNumber(record?.total),
  };
}

function mapMemoryScopeJobResult(value: unknown): MemoryScopeJobResult | null {
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

function mapMemoryScopeCompactResult(value: unknown): MemoryScopeCompactResult | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const base = mapMemoryScopeJobResult(record);
  if (!base) {
    return null;
  }

  return {
    ...base,
    coverageEndFloorNo: readNullableNumber(record.coverage_end_floor_no),
    coverageStartFloorNo: readNullableNumber(record.coverage_start_floor_no),
    reason: readString(record.reason, "forced") as MemoryCompactionTriggerReason,
    sourceMicroIds: readArray(record.source_micro_ids)
      .map((item) => readString(item))
      .filter((item) => item.length > 0),
  };
}
