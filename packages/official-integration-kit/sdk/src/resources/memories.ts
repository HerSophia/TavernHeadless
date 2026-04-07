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

export type MemoryScope = "global" | "chat" | "floor";
export type MemoryType = "fact" | "summary" | "open_loop";
export type MemoryStatus = "active" | "deprecated";
export type MemorySummaryTier = "micro" | "macro";
export type MemoryLifecycleStatus = "active" | "compacted" | "deprecated";

export type MemoryContent =
  | string
  | {
      text: string;
    };

function isMemoryContentObject(value: unknown): value is { text: string } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { text?: unknown }).text === "string";
}

export type MemoryRecord = {
  confidence: number;
  content: MemoryContent;
  coverageEndFloorNo: number | null;
  coverageStartFloorNo: number | null;
  createdAt: number;
  derivedFromCount: number | null;
  factKey?: string | null;
  id: string;
  importance: number;
  lastUsedAt: number | null;
  lifecycleStatus: MemoryLifecycleStatus;
  scope: MemoryScope;
  scopeId: string;
  sourceFloorId: string | null;
  sourceJobId: string | null;
  sourceMessageId: string | null;
  status: MemoryStatus;
  summaryTier: MemorySummaryTier | null;
  tokenCountEstimate: number | null;
  type: MemoryType;
  updatedAt: number;
};

export type MemoryStats = {
  active: number;
  avgConfidence: number;
  avgImportance: number;
  byType: {
    fact: number;
    openLoop: number;
    summary: number;
  };
  deprecated: number;
  estimatedTokens: number;
  total: number;
};

export type MemoriesBatchUpdateStatusResult = {
  meta: {
    notFound: number;
    status: MemoryStatus;
    total: number;
    updated: number;
  };
  results: Array<{
    action: "not_found" | "updated" | string;
    data?: MemoryRecord;
    id: string;
    index: number;
  }>;
};

export type MemoriesBatchDeleteResult = {
  meta: {
    deleted: number;
    notFound: number;
    total: number;
  };
  results: Array<{
    action: "deleted" | "not_found" | string;
    id: string;
    index: number;
  }>;
};

export type MemoriesListOptions = {
  accountId?: AccountIdHint;
  confidenceMax?: number;
  confidenceMin?: number;
  createdFrom?: number;
  createdTo?: number;
  factKey?: string;
  importanceMax?: number;
  importanceMin?: number;
  lifecycleStatus?: MemoryLifecycleStatus;
  limit?: number;
  offset?: number;
  q?: string;
  scope?: MemoryScope;
  scopeId?: string;
  sortBy?: "confidence" | "created_at" | "importance" | "updated_at";
  sortOrder?: "asc" | "desc";
  sourceFloorId?: string;
  sourceMessageId?: string;
  status?: MemoryStatus;
  summaryTier?: MemorySummaryTier;
  type?: MemoryType;
  updatedFrom?: number;
  updatedTo?: number;
};

export type MemoriesResource = {
  batchDelete(options: { accountId?: AccountIdHint; ids: string[] }): Promise<MemoriesBatchDeleteResult>;
  batchUpdateStatus(options: { accountId?: AccountIdHint; ids: string[]; status: MemoryStatus }): Promise<MemoriesBatchUpdateStatusResult>;
  create(options: {
    accountId?: AccountIdHint;
    confidence?: number;
    content: MemoryContent;
    factKey?: string | null;
    importance?: number;
    lifecycleStatus?: MemoryLifecycleStatus;
    scope: MemoryScope;
    scopeId: string;
    sourceFloorId?: string;
    sourceMessageId?: string;
    status?: MemoryStatus;
    summaryTier?: MemorySummaryTier;
    type: MemoryType;
  }): Promise<MemoryRecord>;
  getDetail(options: { accountId?: AccountIdHint; memoryId: string }): Promise<MemoryRecord>;
  getStats(options?: MemoriesListOptions): Promise<MemoryStats>;
  list(options?: MemoriesListOptions): Promise<MemoryRecord[]>;
  remove(options: { accountId?: AccountIdHint; memoryId: string }): Promise<boolean>;
  update(options: {
    accountId?: AccountIdHint;
    confidence?: number;
    content?: MemoryContent;
    factKey?: string | null;
    importance?: number;
    lifecycleStatus?: MemoryLifecycleStatus;
    memoryId: string;
    scope?: MemoryScope;
    scopeId?: string;
    sourceFloorId?: string;
    sourceMessageId?: string;
    status?: MemoryStatus;
    summaryTier?: MemorySummaryTier;
    type?: MemoryType;
  }): Promise<MemoryRecord>;
};

export function createMemoriesResource(client: TransportClient): MemoriesResource {
  return {
    async batchDelete(options): Promise<MemoriesBatchDeleteResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/memories/batch/delete", {
        body: {
          ids: options.ids,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapBatchDeleteResult(response.body);
    },
    async batchUpdateStatus(options): Promise<MemoriesBatchUpdateStatusResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/memories/batch/status", {
        body: {
          ids: options.ids,
          status: options.status,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      return mapBatchUpdateStatusResult(response.body, options.status);
    },
    async create(options): Promise<MemoryRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/memories", {
        body: compactObject({
          confidence: options.confidence,
          content: options.content,
          fact_key: options.factKey,
          importance: options.importance,
          lifecycle_status: options.lifecycleStatus,
          scope: options.scope,
          scope_id: options.scopeId,
          source_floor_id: options.sourceFloorId,
          source_message_id: options.sourceMessageId,
          status: options.status,
          summary_tier: options.summaryTier,
          type: options.type,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapMemoryRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory create returned an invalid payload");
      }

      return payload;
    },
    async getDetail(options): Promise<MemoryRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/memories/${encodeURIComponent(options.memoryId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapMemoryRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory detail returned an invalid payload");
      }

      return payload;
    },
    async getStats(options: MemoriesListOptions = {}): Promise<MemoryStats> {
      const query = buildQueryString(buildMemoryQuery(options));
      const pathname = query ? `/memories/stats?${query}` : "/memories/stats";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const data = readRecord(readRecord(response.body)?.data);
      const byType = readRecord(data?.by_type);
      return {
        active: readNumber(data?.active),
        avgConfidence: readNumber(data?.avg_confidence),
        avgImportance: readNumber(data?.avg_importance),
        byType: {
          fact: readNumber(byType?.fact),
          openLoop: readNumber(byType?.open_loop),
          summary: readNumber(byType?.summary),
        },
        deprecated: readNumber(data?.deprecated),
        estimatedTokens: readNumber(data?.estimated_tokens),
        total: readNumber(data?.total),
      };
    },
    async list(options: MemoriesListOptions = {}): Promise<MemoryRecord[]> {
      const query = buildQueryString({
        ...buildMemoryQuery(options),
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
        sort_by: options.sortBy ?? "updated_at",
        sort_order: options.sortOrder ?? "desc",
      });
      const pathname = query ? `/memories?${query}` : "/memories";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapMemoryRecord)
        .filter((item): item is MemoryRecord => item !== null);
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/memories/${encodeURIComponent(options.memoryId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async update(options): Promise<MemoryRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/memories/${encodeURIComponent(options.memoryId)}`, {
        body: compactObject({
          confidence: options.confidence,
          content: options.content,
          fact_key: options.factKey,
          importance: options.importance,
          lifecycle_status: options.lifecycleStatus,
          scope: options.scope,
          scope_id: options.scopeId,
          source_floor_id: options.sourceFloorId,
          source_message_id: options.sourceMessageId,
          status: options.status,
          summary_tier: options.summaryTier,
          type: options.type,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      const payload = mapMemoryRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory update returned an invalid payload");
      }

      return payload;
    },
  };
}

function buildMemoryQuery(options: MemoriesListOptions): Record<string, unknown> {
  return compactObject({
    confidence_max: options.confidenceMax,
    confidence_min: options.confidenceMin,
    created_from: options.createdFrom,
    created_to: options.createdTo,
    fact_key: options.factKey,
    importance_max: options.importanceMax,
    importance_min: options.importanceMin,
    lifecycle_status: options.lifecycleStatus,
    q: options.q,
    scope: options.scope,
    scope_id: options.scopeId,
    source_floor_id: options.sourceFloorId,
    source_message_id: options.sourceMessageId,
    status: options.status,
    summary_tier: options.summaryTier,
    type: options.type,
    updated_from: options.updatedFrom,
    updated_to: options.updatedTo,
  });
}

function mapMemoryRecord(value: unknown): MemoryRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const status = readString(record.status, "active") as MemoryStatus;

  return {
    confidence: readNumber(record.confidence),
    content: normalizeMemoryContent(record.content),
    coverageEndFloorNo: readNullableNumber(record.coverage_end_floor_no),
    coverageStartFloorNo: readNullableNumber(record.coverage_start_floor_no),
    createdAt: readNumber(record.created_at),
    derivedFromCount: readNullableNumber(record.derived_from_count),
    factKey: readNullableString(record.fact_key),
    id: readString(record.id),
    importance: readNumber(record.importance),
    lastUsedAt: readNullableNumber(record.last_used_at),
    lifecycleStatus: readString(
      record.lifecycle_status,
      status === "deprecated" ? "deprecated" : "active",
    ) as MemoryLifecycleStatus,
    scope: readString(record.scope, "global") as MemoryScope,
    scopeId: readString(record.scope_id),
    sourceFloorId: readNullableString(record.source_floor_id),
    sourceJobId: readNullableString(record.source_job_id),
    sourceMessageId: readNullableString(record.source_message_id),
    status,
    summaryTier: readNullableString(record.summary_tier) as MemorySummaryTier | null,
    tokenCountEstimate: readNullableNumber(record.token_count_estimate),
    type: readString(record.type, "fact") as MemoryType,
    updatedAt: readNumber(record.updated_at),
  };
}

function normalizeMemoryContent(value: unknown): MemoryContent {
  if (typeof value === "string") {
    return value;
  }

  if (isMemoryContentObject(value)) {
    return { text: value.text };
  }

  return JSON.stringify(value);
}

function mapBatchUpdateStatusResult(
  payload: Record<string, unknown> | null,
  fallbackStatus: MemoryStatus,
): MemoriesBatchUpdateStatusResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      notFound: readNumber(meta?.not_found),
      status: readString(meta?.status, fallbackStatus) as MemoryStatus,
      total: readNumber(meta?.total),
      updated: readNumber(meta?.updated),
    },
    results: readArray(data?.results).reduce<MemoriesBatchUpdateStatusResult["results"]>((items, value) => {
      const record = readRecord(value);
      if (!record) {
        return items;
      }

      const memory = mapMemoryRecord(record.data);
      items.push({
        ...((memory ? { data: memory } : {}) as Partial<MemoriesBatchUpdateStatusResult["results"][number]>),
        action: readString(record.action),
        id: readString(record.id),
        index: readNumber(record.index),
      });
      return items;
    }, []),
  };
}

function mapBatchDeleteResult(payload: Record<string, unknown> | null): MemoriesBatchDeleteResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      deleted: readNumber(meta?.deleted),
      notFound: readNumber(meta?.not_found),
      total: readNumber(meta?.total),
    },
    results: readArray(data?.results).reduce<MemoriesBatchDeleteResult["results"]>((items, value) => {
      const record = readRecord(value);
      if (!record) {
        return items;
      }

      items.push({
        action: readString(record.action),
        id: readString(record.id),
        index: readNumber(record.index),
      });
      return items;
    }, []),
  };
}
