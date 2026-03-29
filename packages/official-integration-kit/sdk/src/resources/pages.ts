import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  compactObject,
  readArray,
  readBoolean,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type PageKind = "input" | "output" | "mixed";

export type PageRecord = {
  checksum: string | null;
  createdAt: number;
  floorId: string;
  id: string;
  isActive: boolean;
  pageKind: PageKind;
  pageNo: number;
  updatedAt: number;
  version: number;
};

export type PagesListOptions = {
  accountId?: AccountIdHint;
  floorId?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
  pageKind?: PageKind;
  sortBy?: "created_at" | "page_no" | "updated_at" | "version";
  sortOrder?: "asc" | "desc";
};

export type PagesCreateOptions = {
  accountId?: AccountIdHint;
  checksum?: string;
  floorId: string;
  isActive?: boolean;
  pageKind: PageKind;
  pageNo: number;
  version?: number;
};

export type PagesGetDetailOptions = {
  accountId?: AccountIdHint;
  pageId: string;
};

export type PagesUpdateOptions = {
  accountId?: AccountIdHint;
  checksum?: string;
  isActive?: boolean;
  pageId: string;
  pageKind?: PageKind;
  pageNo?: number;
  version?: number;
};

export type PagesRemoveOptions = {
  accountId?: AccountIdHint;
  pageId: string;
};

export type PagesActivateOptions = {
  accountId?: AccountIdHint;
  pageId: string;
};

export type PagesBatchDeleteOptions = {
  accountId?: AccountIdHint;
  ids: string[];
};

export type PagesBatchDeleteResult = {
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

export type PagesResource = {
  activate(options: PagesActivateOptions): Promise<PageRecord>;
  batchDelete(options: PagesBatchDeleteOptions): Promise<PagesBatchDeleteResult>;
  create(options: PagesCreateOptions): Promise<PageRecord>;
  getDetail(options: PagesGetDetailOptions): Promise<PageRecord>;
  list(options?: PagesListOptions): Promise<PageRecord[]>;
  remove(options: PagesRemoveOptions): Promise<boolean>;
  update(options: PagesUpdateOptions): Promise<PageRecord>;
};

export function createPagesResource(client: TransportClient): PagesResource {
  return {
    async activate(options): Promise<PageRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/pages/${encodeURIComponent(options.pageId)}/activate`, {
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      const payload = mapPageRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Page activate returned an invalid payload");
      }

      return payload;
    },
    async batchDelete(options): Promise<PagesBatchDeleteResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/pages/batch/delete", {
        body: {
          ids: options.ids,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapBatchDeletePayload(response.body);
    },
    async create(options): Promise<PageRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/pages", {
        body: compactObject({
          checksum: options.checksum,
          floor_id: options.floorId,
          is_active: options.isActive,
          page_kind: options.pageKind,
          page_no: options.pageNo,
          version: options.version,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapPageRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Page create returned an invalid payload");
      }

      return payload;
    },
    async getDetail(options): Promise<PageRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/pages/${encodeURIComponent(options.pageId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapPageRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Page detail returned an invalid payload");
      }

      return payload;
    },
    async list(options: PagesListOptions = {}): Promise<PageRecord[]> {
      const response = await client.get("/pages", {
        headers: buildAccountHeaders(options.accountId),
        query: compactObject({
          floor_id: options.floorId,
          is_active: options.isActive,
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
          page_kind: options.pageKind,
          sort_by: options.sortBy ?? "created_at",
          sort_order: options.sortOrder ?? "desc",
        }),
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapPageRecord)
        .filter((item): item is PageRecord => item !== null);
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/pages/${encodeURIComponent(options.pageId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async update(options): Promise<PageRecord> {
      const response = await client.patch("/pages/{id}", {
        body: compactObject({
          checksum: options.checksum,
          is_active: options.isActive,
          page_kind: options.pageKind,
          page_no: options.pageNo,
          version: options.version,
        }),
        headers: buildAccountHeaders(options.accountId),
        path: {
          id: options.pageId,
        },
      });

      const payload = mapPageRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Page update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapPageRecord(value: unknown): PageRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    checksum: readNullableString(record.checksum),
    createdAt: readNumber(record.created_at),
    floorId: readString(record.floor_id),
    id: readString(record.id),
    isActive: readBoolean(record.is_active),
    pageKind: readString(record.page_kind) as PageKind,
    pageNo: readNumber(record.page_no),
    updatedAt: readNumber(record.updated_at),
    version: readNumber(record.version),
  };
}

function mapBatchDeletePayload(payload: Record<string, unknown> | null): PagesBatchDeleteResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      deleted: readNumber(meta?.deleted),
      notFound: readNumber(meta?.not_found),
      total: readNumber(meta?.total),
    },
    results: readArray(data?.results)
      .map(mapBatchItem)
      .filter((item): item is PagesBatchDeleteResult["results"][number] => item !== null),
  };
}

function mapBatchItem(value: unknown): { action: string; id: string; index: number } | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    action: readString(record.action),
    id: readString(record.id),
    index: readNumber(record.index),
  };
}
