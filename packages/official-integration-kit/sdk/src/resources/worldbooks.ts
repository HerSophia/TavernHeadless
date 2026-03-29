import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { compactObject, readArray, readNumber, readRecord, readString } from "./utils.js";

export type WorldbookListItem = {
  createdAt: number;
  id: string;
  name: string;
  source: string;
  updatedAt: number;
  version: number;
};

export type WorldbookDetail = WorldbookListItem & {
  data: Record<string, unknown>;
};

export type WorldbooksResource = {
  getDetail(options: { accountId?: AccountIdHint; worldbookId: string }): Promise<WorldbookDetail>;
  list(options?: { accountId?: AccountIdHint }): Promise<WorldbookListItem[]>;
  remove(options: { accountId?: AccountIdHint; worldbookId: string }): Promise<void>;
  update(options: {
    accountId?: AccountIdHint;
    data: Record<string, unknown>;
    expectedVersion?: number;
    expectedUpdatedAt?: number;
    name: string;
    worldbookId: string;
  }): Promise<WorldbookListItem>;
};

export function createWorldbooksResource(client: TransportClient): WorldbooksResource {
  return {
    async getDetail(options): Promise<WorldbookDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/worldbooks/${encodeURIComponent(options.worldbookId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const detail = readRecord(readRecord(response.body)?.data);
      if (!detail) {
        throw new Error("Worldbook detail payload is missing");
      }

      return {
        createdAt: readNumber(detail.created_at),
        data: readRecord(detail.data) ?? {},
        id: readString(detail.id),
        name: readString(detail.name),
        source: readString(detail.source),
        updatedAt: readNumber(detail.updated_at),
        version: readNumber(detail.version),
      };
    },
    async list(options = {}): Promise<WorldbookListItem[]> {
      const response = await client.fetchJson<Record<string, unknown>>("/worldbooks", {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapWorldbookListItem)
        .filter((item): item is WorldbookListItem => item !== null);
    },
    async remove(options): Promise<void> {
      await client.fetchJson(`/worldbooks/${encodeURIComponent(options.worldbookId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });
    },
    async update(options): Promise<WorldbookListItem> {
      const response = await client.fetchJson<Record<string, unknown>>(`/worldbooks/${encodeURIComponent(options.worldbookId)}`, {
        body: compactObject({
          data: options.data,
          expected_version: options.expectedVersion,
          expected_updated_at: options.expectedUpdatedAt,
          name: options.name,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "PUT",
      });

      const payload = mapWorldbookListItem(readRecord(readRecord(response.body)?.data));
      if (!payload) {
        throw new Error("Worldbook update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapWorldbookListItem(value: unknown): WorldbookListItem | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    createdAt: readNumber(record.created_at),
    id: readString(record.id),
    name: readString(record.name),
    source: readString(record.source),
    updatedAt: readNumber(record.updated_at),
    version: readNumber(record.version),
  };
}
