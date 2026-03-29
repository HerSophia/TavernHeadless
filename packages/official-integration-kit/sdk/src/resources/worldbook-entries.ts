import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { buildQueryString, compactObject, readArray, readBoolean, readNullableNumber, readNumber, readRecord, readString } from "./utils.js";

export type WorldbookEntryRecord = {
  caseSensitive: boolean | null;
  comment: string;
  constant: boolean;
  content: string;
  createdAt: number;
  depth: number;
  disable: boolean;
  id: string;
  keys: string[];
  keysSecondary: string[];
  matchWholeWords: boolean | null;
  order: number;
  position: number;
  role: number;
  scanDepth: number | null;
  selective: boolean;
  selectiveLogic: number;
  uid: number;
  updatedAt: number;
  worldbookId: string;
};

export type WorldbookEntryDeleteResult = {
  deleted: boolean;
  id: string;
};

export type WorldbookEntriesBatchUpdateResult = {
  meta: {
    notFound: number;
    total: number;
    updated: number;
  };
  results: Array<{
    action: "not_found" | "updated" | string;
    data?: WorldbookEntryRecord;
    id: string;
    index: number;
  }>;
};

export type WorldbookEntriesBatchDeleteResult = {
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

export type WorldbookEntriesResource = {
  batchDelete(options: { accountId?: AccountIdHint; ids: string[]; worldbookId: string }): Promise<WorldbookEntriesBatchDeleteResult>;
  batchReorder(options: { accountId?: AccountIdHint; items: Array<{ id: string; order: number }>; worldbookId: string }): Promise<WorldbookEntriesBatchUpdateResult>;
  batchUpdate(options: {
    accountId?: AccountIdHint;
    fields: Partial<{
      case_sensitive: boolean | null;
      comment: string;
      constant: boolean;
      content: string;
      depth: number;
      disable: boolean;
      keys: string[];
      keys_secondary: string[];
      match_whole_words: boolean | null;
      order: number;
      position: number;
      role: number;
      scan_depth: number | null;
      selective: boolean;
      selective_logic: number;
    }>;
    ids: string[];
    worldbookId: string;
  }): Promise<WorldbookEntriesBatchUpdateResult>;
  create(options: {
    accountId?: AccountIdHint;
    caseSensitive?: boolean | null;
    comment?: string;
    constant?: boolean;
    content: string;
    depth?: number;
    disable?: boolean;
    keys: string[];
    keysSecondary?: string[];
    matchWholeWords?: boolean | null;
    order?: number;
    position?: number;
    role?: number;
    scanDepth?: number | null;
    selective?: boolean;
    selectiveLogic?: number;
    worldbookId: string;
  }): Promise<WorldbookEntryRecord>;
  getDetail(options: { accountId?: AccountIdHint; entryId: string; worldbookId: string }): Promise<WorldbookEntryRecord>;
  list(options: {
    accountId?: AccountIdHint;
    constant?: boolean;
    disable?: boolean;
    limit?: number;
    offset?: number;
    position?: number;
    q?: string;
    sortBy?: "order" | "uid" | "updated_at";
    sortOrder?: "asc" | "desc";
    worldbookId: string;
  }): Promise<WorldbookEntryRecord[]>;
  remove(options: { accountId?: AccountIdHint; entryId: string; worldbookId: string }): Promise<WorldbookEntryDeleteResult>;
  update(options: {
    accountId?: AccountIdHint;
    caseSensitive?: boolean | null;
    comment?: string;
    constant?: boolean;
    content?: string;
    depth?: number;
    disable?: boolean;
    entryId: string;
    keys?: string[];
    keysSecondary?: string[];
    matchWholeWords?: boolean | null;
    order?: number;
    position?: number;
    role?: number;
    scanDepth?: number | null;
    selective?: boolean;
    selectiveLogic?: number;
    worldbookId: string;
  }): Promise<WorldbookEntryRecord>;
};

export function createWorldbookEntriesResource(client: TransportClient): WorldbookEntriesResource {
  return {
    async batchDelete(options): Promise<WorldbookEntriesBatchDeleteResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/entries/batch/delete`,
        {
          body: {
            ids: options.ids,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      return mapBatchDeleteResult(response.body);
    },
    async batchReorder(options): Promise<WorldbookEntriesBatchUpdateResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/entries/batch/reorder`,
        {
          body: {
            items: options.items,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "PUT",
        },
      );

      return mapBatchUpdateResult(response.body);
    },
    async batchUpdate(options): Promise<WorldbookEntriesBatchUpdateResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/entries/batch/update`,
        {
          body: {
            fields: compactObject(options.fields),
            ids: options.ids,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );

      return mapBatchUpdateResult(response.body);
    },
    async create(options): Promise<WorldbookEntryRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/worldbooks/${encodeURIComponent(options.worldbookId)}/entries`, {
        body: compactObject({
          case_sensitive: options.caseSensitive,
          comment: options.comment,
          constant: options.constant,
          content: options.content,
          depth: options.depth,
          disable: options.disable,
          keys: options.keys,
          keys_secondary: options.keysSecondary,
          match_whole_words: options.matchWholeWords,
          order: options.order,
          position: options.position,
          role: options.role,
          scan_depth: options.scanDepth,
          selective: options.selective,
          selective_logic: options.selectiveLogic,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapWorldbookEntry(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Worldbook entry create returned an invalid payload");
      }

      return payload;
    },
    async getDetail(options): Promise<WorldbookEntryRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/entries/${encodeURIComponent(options.entryId)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapWorldbookEntry(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Worldbook entry detail returned an invalid payload");
      }

      return payload;
    },
    async list(options): Promise<WorldbookEntryRecord[]> {
      const query = buildQueryString(
        compactObject({
          constant: options.constant,
          disable: options.disable,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
          position: options.position,
          q: options.q,
          sort_by: options.sortBy ?? "order",
          sort_order: options.sortOrder ?? "asc",
        }),
      );
      const pathname = query
        ? `/worldbooks/${encodeURIComponent(options.worldbookId)}/entries?${query}`
        : `/worldbooks/${encodeURIComponent(options.worldbookId)}/entries`;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapWorldbookEntry)
        .filter((item): item is WorldbookEntryRecord => item !== null);
    },
    async remove(options): Promise<WorldbookEntryDeleteResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/entries/${encodeURIComponent(options.entryId)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "DELETE",
        },
      );

      const data = readRecord(readRecord(response.body)?.data);
      return {
        deleted: readBoolean(data?.deleted),
        id: readString(data?.id),
      };
    },
    async update(options): Promise<WorldbookEntryRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/entries/${encodeURIComponent(options.entryId)}`,
        {
          body: compactObject({
            case_sensitive: options.caseSensitive,
            comment: options.comment,
            constant: options.constant,
            content: options.content,
            depth: options.depth,
            disable: options.disable,
            keys: options.keys,
            keys_secondary: options.keysSecondary,
            match_whole_words: options.matchWholeWords,
            order: options.order,
            position: options.position,
            role: options.role,
            scan_depth: options.scanDepth,
            selective: options.selective,
            selective_logic: options.selectiveLogic,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );

      const payload = mapWorldbookEntry(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Worldbook entry update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapWorldbookEntry(value: unknown): WorldbookEntryRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    caseSensitive: typeof record.case_sensitive === "boolean" ? record.case_sensitive : null,
    comment: readString(record.comment),
    constant: readBoolean(record.constant),
    content: readString(record.content),
    createdAt: readNumber(record.created_at),
    depth: readNumber(record.depth),
    disable: readBoolean(record.disable),
    id: readString(record.id),
    keys: readArray(record.keys)
      .map((item) => readString(item))
      .filter((item) => item.length > 0),
    keysSecondary: readArray(record.keys_secondary)
      .map((item) => readString(item))
      .filter((item) => item.length > 0),
    matchWholeWords: typeof record.match_whole_words === "boolean" ? record.match_whole_words : null,
    order: readNumber(record.order),
    position: readNumber(record.position),
    role: readNumber(record.role),
    scanDepth: readNullableNumber(record.scan_depth),
    selective: readBoolean(record.selective),
    selectiveLogic: readNumber(record.selective_logic),
    uid: readNumber(record.uid),
    updatedAt: readNumber(record.updated_at),
    worldbookId: readString(record.worldbook_id),
  };
}

function mapBatchUpdateResult(payload: Record<string, unknown> | null): WorldbookEntriesBatchUpdateResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      notFound: readNumber(meta?.not_found),
      total: readNumber(meta?.total),
      updated: readNumber(meta?.updated),
    },
    results: readArray(data?.results).reduce<WorldbookEntriesBatchUpdateResult["results"]>((items, value) => {
      const record = readRecord(value);
      if (!record) {
        return items;
      }

      const entry = mapWorldbookEntry(record.data);
      items.push({
        ...((entry ? { data: entry } : {}) as Partial<WorldbookEntriesBatchUpdateResult["results"][number]>),
        action: readString(record.action),
        id: readString(record.id),
        index: readNumber(record.index),
      });

      return items;
    }, []),
  };
}

function mapBatchDeleteResult(payload: Record<string, unknown> | null): WorldbookEntriesBatchDeleteResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      deleted: readNumber(meta?.deleted),
      notFound: readNumber(meta?.not_found),
      total: readNumber(meta?.total),
    },
    results: readArray(data?.results)
      .map((value) => {
        const record = readRecord(value);
        if (!record) {
          return null;
        }

        return {
          action: readString(record.action),
          id: readString(record.id),
          index: readNumber(record.index),
        };
      })
      .filter((item): item is WorldbookEntriesBatchDeleteResult["results"][number] => item !== null),
  };
}
