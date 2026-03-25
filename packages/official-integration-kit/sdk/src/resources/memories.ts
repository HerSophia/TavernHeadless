import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import {
  buildQueryString,
  compactObject,
  readArray,
  readBoolean,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type MemoryScope = "global" | "chat" | "floor";
export type MemoryType = "fact" | "summary" | "open_loop";
export type MemoryStatus = "active" | "deprecated";

export type MemoryRecord = {
  confidence: number;
  content: unknown;
  createdAt: number;
  id: string;
  importance: number;
  scope: MemoryScope;
  scopeId: string;
  sourceFloorId: string | null;
  sourceMessageId: string | null;
  status: MemoryStatus;
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
  accountId?: string;
  confidenceMax?: number;
  confidenceMin?: number;
  createdFrom?: number;
  createdTo?: number;
  importanceMax?: number;
  importanceMin?: number;
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
  type?: MemoryType;
  updatedFrom?: number;
  updatedTo?: number;
};

export type MemoriesResource = {
  batchDelete(options: { accountId?: string; ids: string[] }): Promise<MemoriesBatchDeleteResult>;
  batchUpdateStatus(options: { accountId?: string; ids: string[]; status: MemoryStatus }): Promise<MemoriesBatchUpdateStatusResult>;
  create(options: {
    accountId?: string;
    confidence?: number;
    content: unknown;
    importance?: number;
    scope: MemoryScope;
    scopeId: string;
    sourceFloorId?: string;
    sourceMessageId?: string;
    status?: MemoryStatus;
    type: MemoryType;
  }): Promise<MemoryRecord>;
  getDetail(options: { accountId?: string; memoryId: string }): Promise<MemoryRecord>;
  getStats(options?: MemoriesListOptions): Promise<MemoryStats>;
  list(options?: MemoriesListOptions): Promise<MemoryRecord[]>;
  remove(options: { accountId?: string; memoryId: string }): Promise<boolean>;
  update(options: {
    accountId?: string;
    confidence?: number;
    content?: unknown;
    importance?: number;
    memoryId: string;
    scope?: MemoryScope;
    scopeId?: string;
    sourceFloorId?: string;
    sourceMessageId?: string;
    status?: MemoryStatus;
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
          importance: options.importance,
          scope: options.scope,
          scope_id: options.scopeId,
          source_floor_id: options.sourceFloorId,
          source_message_id: options.sourceMessageId,
          status: options.status,
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
          importance: options.importance,
          scope: options.scope,
          scope_id: options.scopeId,
          source_floor_id: options.sourceFloorId,
          source_message_id: options.sourceMessageId,
          status: options.status,
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
    importance_max: options.importanceMax,
    importance_min: options.importanceMin,
    q: options.q,
    scope: options.scope,
    scope_id: options.scopeId,
    source_floor_id: options.sourceFloorId,
    source_message_id: options.sourceMessageId,
    status: options.status,
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

  return {
    confidence: readNumber(record.confidence),
    content: record.content,
    createdAt: readNumber(record.created_at),
    id: readString(record.id),
    importance: readNumber(record.importance),
    scope: readString(record.scope, "global") as MemoryScope,
    scopeId: readString(record.scope_id),
    sourceFloorId: readNullableString(record.source_floor_id),
    sourceMessageId: readNullableString(record.source_message_id),
    status: readString(record.status, "active") as MemoryStatus,
    type: readString(record.type, "fact") as MemoryType,
    updatedAt: readNumber(record.updated_at),
  };
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
