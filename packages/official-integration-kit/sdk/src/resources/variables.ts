import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import { buildQueryString, readArray, readBoolean, readNumber, readRecord, readString } from "./utils.js";

export type VariableScope = "global" | "chat" | "floor" | "page";

export type VariableRecord = {
  id: string;
  key: string;
  scope: VariableScope;
  scopeId: string;
  updatedAt: number;
  value: unknown;
};

export type VariablesUpsertManyResult = {
  meta: {
    created: number;
    total: number;
    updated: number;
  };
  results: Array<{
    action: "created" | "updated" | string;
    data: VariableRecord;
    index: number;
  }>;
};

export type VariablesResource = {
  getDetail(options: { accountId?: string; variableId: string }): Promise<VariableRecord>;
  list(options?: {
    accountId?: string;
    key?: string;
    limit?: number;
    offset?: number;
    scope?: VariableScope;
    scopeId?: string;
    sortBy?: "key" | "updated_at";
    sortOrder?: "asc" | "desc";
  }): Promise<VariableRecord[]>;
  remove(options: { accountId?: string; variableId: string }): Promise<boolean>;
  upsert(options: {
    accountId?: string;
    key: string;
    scope: VariableScope;
    scopeId: string;
    value: unknown;
  }): Promise<VariableRecord>;
  upsertMany(options: {
    accountId?: string;
    items: Array<{
      key: string;
      scope: VariableScope;
      scopeId: string;
      value: unknown;
    }>;
  }): Promise<VariablesUpsertManyResult>;
};

export function createVariablesResource(client: TransportClient): VariablesResource {
  return {
    async getDetail(options): Promise<VariableRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/variables/${encodeURIComponent(options.variableId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapVariableRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Variable detail returned an invalid payload");
      }

      return payload;
    },
    async list(options = {}): Promise<VariableRecord[]> {
      const query = buildQueryString({
        key: options.key,
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
        scope: options.scope,
        scope_id: options.scopeId,
        sort_by: options.sortBy ?? "updated_at",
        sort_order: options.sortOrder ?? "desc",
      });
      const pathname = query ? `/variables?${query}` : "/variables";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapVariableRecord)
        .filter((item): item is VariableRecord => item !== null);
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/variables/${encodeURIComponent(options.variableId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async upsert(options): Promise<VariableRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/variables", {
        body: {
          key: options.key,
          scope: options.scope,
          scope_id: options.scopeId,
          value: options.value,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PUT",
      });

      const payload = mapVariableRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Variable upsert returned an invalid payload");
      }

      return payload;
    },
    async upsertMany(options): Promise<VariablesUpsertManyResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/variables/batch", {
        body: {
          items: options.items.map((item) => ({
            key: item.key,
            scope: item.scope,
            scope_id: item.scopeId,
            value: item.value,
          })),
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PUT",
      });

      return mapUpsertManyResult(response.body);
    },
  };
}

function mapVariableRecord(value: unknown): VariableRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: readString(record.id),
    key: readString(record.key),
    scope: readString(record.scope, "global") as VariableScope,
    scopeId: readString(record.scope_id),
    updatedAt: readNumber(record.updated_at),
    value: record.value,
  };
}

function mapUpsertManyResult(payload: Record<string, unknown> | null): VariablesUpsertManyResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      created: readNumber(meta?.created),
      total: readNumber(meta?.total),
      updated: readNumber(meta?.updated),
    },
    results: readArray(data?.results).reduce<VariablesUpsertManyResult["results"]>((items, value) => {
      const record = readRecord(value);
      const variable = mapVariableRecord(record?.data);
      if (!record || !variable) {
        return items;
      }

      items.push({
        action: readString(record.action),
        data: variable,
        index: readNumber(record.index),
      });
      return items;
    }, []),
  };
}
