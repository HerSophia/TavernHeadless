import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import { buildQueryString, readArray, readBoolean, readNumber, readRecord, readString } from "./utils.js";

export type MemoryRelation = "supports" | "contradicts" | "updates";

export type MemoryEdgeRecord = {
  createdAt: number;
  fromId: string;
  id: string;
  relation: MemoryRelation;
  toId: string;
};

export type MemoryEdgesResource = {
  create(options: { accountId?: string; fromId: string; relation: MemoryRelation; toId: string }): Promise<MemoryEdgeRecord>;
  getDetail(options: { accountId?: string; edgeId: string }): Promise<MemoryEdgeRecord>;
  list(options?: {
    accountId?: string;
    fromId?: string;
    limit?: number;
    offset?: number;
    relation?: MemoryRelation;
    sortBy?: "created_at";
    sortOrder?: "asc" | "desc";
    toId?: string;
  }): Promise<MemoryEdgeRecord[]>;
  remove(options: { accountId?: string; edgeId: string }): Promise<boolean>;
  update(options: { accountId?: string; edgeId: string; relation: MemoryRelation }): Promise<MemoryEdgeRecord>;
};

export function createMemoryEdgesResource(client: TransportClient): MemoryEdgesResource {
  return {
    async create(options): Promise<MemoryEdgeRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/memory-edges", {
        body: {
          from_id: options.fromId,
          relation: options.relation,
          to_id: options.toId,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapMemoryEdgeRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory edge create returned an invalid payload");
      }

      return payload;
    },
    async getDetail(options): Promise<MemoryEdgeRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/memory-edges/${encodeURIComponent(options.edgeId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapMemoryEdgeRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory edge detail returned an invalid payload");
      }

      return payload;
    },
    async list(options = {}): Promise<MemoryEdgeRecord[]> {
      const query = buildQueryString({
        from_id: options.fromId,
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
        relation: options.relation,
        sort_by: options.sortBy ?? "created_at",
        sort_order: options.sortOrder ?? "desc",
        to_id: options.toId,
      });
      const pathname = query ? `/memory-edges?${query}` : "/memory-edges";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapMemoryEdgeRecord)
        .filter((item): item is MemoryEdgeRecord => item !== null);
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/memory-edges/${encodeURIComponent(options.edgeId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async update(options): Promise<MemoryEdgeRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/memory-edges/${encodeURIComponent(options.edgeId)}`, {
        body: {
          relation: options.relation,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      const payload = mapMemoryEdgeRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Memory edge update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapMemoryEdgeRecord(value: unknown): MemoryEdgeRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    createdAt: readNumber(record.created_at),
    fromId: readString(record.from_id),
    id: readString(record.id),
    relation: readString(record.relation, "supports") as MemoryRelation,
    toId: readString(record.to_id),
  };
}
