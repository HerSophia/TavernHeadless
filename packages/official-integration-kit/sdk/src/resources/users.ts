import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  buildQueryString,
  readArray,
  readBoolean,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type UserRecord = {
  createdAt: number;
  id: string;
  name: string;
  status: string;
  updatedAt: number;
};

export type UserDetail = UserRecord & {
  snapshot: Record<string, unknown> | null;
};

export type UsersListOptions = {
  accountId?: AccountIdHint;
  includeDeleted?: boolean;
  keyword?: string;
  limit?: number;
  offset?: number;
  sortBy?: "created_at" | "name" | "updated_at";
  sortOrder?: "asc" | "desc";
  status?: "active" | "deleted" | "disabled";
};

export type UsersCreateOptions = {
  accountId?: AccountIdHint;
  snapshot: Record<string, unknown>;
};

export type UsersGetDetailOptions = {
  accountId?: AccountIdHint;
  userId: string;
};

export type UsersUpdateOptions = {
  accountId?: AccountIdHint;
  snapshot?: Record<string, unknown>;
  status?: "active" | "disabled";
  userId: string;
};

export type UsersRemoveOptions = {
  accountId?: AccountIdHint;
  userId: string;
};

export type UsersBatchUpdateStatusOptions = {
  accountId?: AccountIdHint;
  ids: string[];
  status: "active" | "disabled";
};

export type UsersBatchUpdateStatusResult = {
  meta: {
    notFound: number;
    status: "active" | "disabled";
    total: number;
    updated: number;
  };
  results: Array<{
    action: "not_found" | "updated" | string;
    id: string;
    index: number;
  }>;
};

export type UsersBatchDeleteOptions = {
  accountId?: AccountIdHint;
  ids: string[];
};

export type UsersBatchDeleteResult = {
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

export type UsersResource = {
  batchDelete(options: UsersBatchDeleteOptions): Promise<UsersBatchDeleteResult>;
  batchUpdateStatus(options: UsersBatchUpdateStatusOptions): Promise<UsersBatchUpdateStatusResult>;
  create(options: UsersCreateOptions): Promise<UserRecord>;
  getDetail(options: UsersGetDetailOptions): Promise<UserDetail>;
  list(options?: UsersListOptions): Promise<UserRecord[]>;
  remove(options: UsersRemoveOptions): Promise<boolean>;
  update(options: UsersUpdateOptions): Promise<UserDetail>;
};

export function createUsersResource(client: TransportClient): UsersResource {
  return {
    async batchDelete(options): Promise<UsersBatchDeleteResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/users/batch/delete", {
        body: {
          ids: options.ids,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapBatchDeletePayload(response.body);
    },
    async batchUpdateStatus(options): Promise<UsersBatchUpdateStatusResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/users/batch/status", {
        body: {
          ids: options.ids,
          status: options.status,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      return mapBatchStatusPayload(response.body, options.status);
    },
    async create(options): Promise<UserRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/users", {
        body: {
          snapshot: options.snapshot,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapUserRecord(readRecord(response.body)?.data, "User create returned an invalid payload");
      if (!payload) {
        throw new Error("User create returned an invalid payload");
      }

      return payload;
    },
    async getDetail(options): Promise<UserDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/users/${encodeURIComponent(options.userId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapUserDetail(readRecord(response.body)?.data, "User detail returned an invalid payload");
      if (!payload) {
        throw new Error("User detail returned an invalid payload");
      }

      return payload;
    },
    async list(options: UsersListOptions = {}): Promise<UserRecord[]> {
      const query = buildQueryString({
        include_deleted: options.includeDeleted,
        keyword: options.keyword,
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
        sort_by: options.sortBy ?? "updated_at",
        sort_order: options.sortOrder ?? "desc",
        status: options.status,
      });
      const pathname = query ? `/users?${query}` : "/users";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map((item) => mapUserRecord(item, null))
        .filter((item): item is UserRecord => item !== null);
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/users/${encodeURIComponent(options.userId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async update(options): Promise<UserDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/users/${encodeURIComponent(options.userId)}`, {
        body: {
          snapshot: options.snapshot,
          status: options.status,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      const payload = mapUserDetail(readRecord(response.body)?.data, "User update returned an invalid payload");
      if (!payload) {
        throw new Error("User update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapUserRecord(value: unknown, errorMessage: string | null): UserRecord | null {
  const detail = mapUserDetail(value, errorMessage);
  if (!detail) {
    return null;
  }

  return {
    createdAt: detail.createdAt,
    id: detail.id,
    name: detail.name,
    status: detail.status,
    updatedAt: detail.updatedAt,
  };
}

function mapUserDetail(value: unknown, errorMessage: string | null): UserDetail | null {
  const record = readRecord(value);
  if (!record) {
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return null;
  }

  return {
    createdAt: readNumber(record.created_at),
    id: readString(record.id),
    name: readString(record.name),
    snapshot: readRecord(record.snapshot),
    status: readString(record.status),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapBatchStatusPayload(
  payload: Record<string, unknown> | null,
  fallbackStatus: UsersBatchUpdateStatusResult["meta"]["status"],
): UsersBatchUpdateStatusResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      notFound: readNumber(meta?.not_found),
      status: readString(meta?.status, fallbackStatus) as UsersBatchUpdateStatusResult["meta"]["status"],
      total: readNumber(meta?.total),
      updated: readNumber(meta?.updated),
    },
    results: readArray(data?.results)
      .map(mapBatchItem)
      .filter((item): item is UsersBatchUpdateStatusResult["results"][number] => item !== null),
  };
}

function mapBatchDeletePayload(payload: Record<string, unknown> | null): UsersBatchDeleteResult {
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
      .filter((item): item is UsersBatchDeleteResult["results"][number] => item !== null),
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
