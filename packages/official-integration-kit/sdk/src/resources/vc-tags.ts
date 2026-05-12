import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { buildQueryString, compactObject, readArray, readBoolean, readNullableString, readNumber, readRecord, readString } from "./utils.js";

export type VcTagTargetType = "floor" | "asset_version";

export type VcTagRecord = {
  accountId: string;
  createdAt: number;
  createdByOperationId: string | null;
  id: string;
  metadata: unknown | null;
  name: string;
  sessionId: string | null;
  targetId: string;
  targetType: VcTagTargetType;
};

export type VcTagsListMeta = {
  hasMore: boolean;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  total: number;
};

export type VcTagsListResult = {
  data: VcTagRecord[];
  meta: VcTagsListMeta;
};

export type VcTagsCreateOptions = {
  accountId?: AccountIdHint;
  metadata?: unknown;
  name: string;
  sessionId?: string | null;
  targetId: string;
  targetType: VcTagTargetType;
};

export type VcTagsListOptions = {
  accountId?: AccountIdHint;
  limit?: number;
  offset?: number;
  sessionId?: string;
  sortOrder?: "asc" | "desc";
  targetId?: string;
  targetType?: VcTagTargetType;
};

export type VcTagsGetDetailOptions = {
  accountId?: AccountIdHint;
  tagId: string;
};

export type VcTagsRemoveOptions = VcTagsGetDetailOptions;

export type VcTagsResource = {
  create(options: VcTagsCreateOptions): Promise<VcTagRecord>;
  getDetail(options: VcTagsGetDetailOptions): Promise<VcTagRecord>;
  list(options?: VcTagsListOptions): Promise<VcTagsListResult>;
  remove(options: VcTagsRemoveOptions): Promise<boolean>;
};

export function createVcTagsResource(client: TransportClient): VcTagsResource {
  return {
    async create(options): Promise<VcTagRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/vc-tags", {
        body: compactObject({
          metadata: options.metadata,
          name: options.name,
          session_id: options.sessionId,
          target_id: options.targetId,
          target_type: options.targetType,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });
      const tag = mapVcTag(readRecord(response.body)?.data);
      if (!tag) {
        throw new Error("VC tag create returned an invalid payload");
      }
      return tag;
    },
    async getDetail(options): Promise<VcTagRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/vc-tags/${encodeURIComponent(options.tagId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });
      const tag = mapVcTag(readRecord(response.body)?.data);
      if (!tag) {
        throw new Error("VC tag payload is missing");
      }
      return tag;
    },
    async list(options: VcTagsListOptions = {}): Promise<VcTagsListResult> {
      const query = buildQueryString({
        limit: options.limit ?? 50,
        offset: options.offset ?? 0,
        session_id: options.sessionId,
        sort_order: options.sortOrder ?? "desc",
        target_id: options.targetId,
        target_type: options.targetType,
      });
      const response = await client.fetchJson<Record<string, unknown>>(`/vc-tags?${query}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });
      const body = readRecord(response.body);
      const meta = readRecord(body?.meta);
      return {
        data: readArray(body?.data).map(mapVcTag).filter((tag): tag is VcTagRecord => tag !== null),
        meta: {
          hasMore: readBoolean(meta?.has_more),
          limit: readNumber(meta?.limit, options.limit ?? 50),
          offset: readNumber(meta?.offset, options.offset ?? 0),
          sortBy: readString(meta?.sort_by, "created_at"),
          sortOrder: readString(meta?.sort_order, "desc") as "asc" | "desc",
          total: readNumber(meta?.total),
        },
      };
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/vc-tags/${encodeURIComponent(options.tagId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });
      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
  };
}

function mapVcTag(value: unknown): VcTagRecord | null {
  const record = readRecord(value);
  if (!record) return null;
  return {
    accountId: readString(record.account_id),
    createdAt: readNumber(record.created_at),
    createdByOperationId: readNullableString(record.created_by_operation_id),
    id: readString(record.id),
    metadata: record.metadata ?? null,
    name: readString(record.name),
    sessionId: readNullableString(record.session_id),
    targetId: readString(record.target_id),
    targetType: readString(record.target_type) as VcTagTargetType,
  };
}
