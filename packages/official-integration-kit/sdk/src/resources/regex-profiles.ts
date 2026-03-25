import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import { compactObject, readArray, readNumber, readRecord, readString } from "./utils.js";

export type RegexProfileListItem = {
  createdAt: number;
  id: string;
  name: string;
  source: string;
  updatedAt: number;
};

export type RegexProfileDetail = RegexProfileListItem & {
  data: unknown;
};

export type RegexProfilesResource = {
  getDetail(options: { accountId?: string; profileId: string }): Promise<RegexProfileDetail>;
  list(options?: { accountId?: string }): Promise<RegexProfileListItem[]>;
  remove(options: { accountId?: string; profileId: string }): Promise<boolean>;
  update(options: {
    accountId?: string;
    data: string;
    expectedUpdatedAt?: number;
    name: string;
    profileId: string;
  }): Promise<RegexProfileListItem>;
};

export function createRegexProfilesResource(client: TransportClient): RegexProfilesResource {
  return {
    async getDetail(options): Promise<RegexProfileDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/regex-profiles/${encodeURIComponent(options.profileId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const detail = readRecord(readRecord(response.body)?.data);
      if (!detail) {
        throw new Error("Regex profile detail payload is missing");
      }

      return {
        createdAt: readNumber(detail.created_at),
        data: detail.data,
        id: readString(detail.id),
        name: readString(detail.name),
        source: readString(detail.source),
        updatedAt: readNumber(detail.updated_at),
      };
    },
    async list(options = {}): Promise<RegexProfileListItem[]> {
      const response = await client.fetchJson<Record<string, unknown>>("/regex-profiles", {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapRegexProfileListItem)
        .filter((item): item is RegexProfileListItem => item !== null);
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<unknown>(`/regex-profiles/${encodeURIComponent(options.profileId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return response.status === 204;
    },
    async update(options): Promise<RegexProfileListItem> {
      const response = await client.fetchJson<Record<string, unknown>>(`/regex-profiles/${encodeURIComponent(options.profileId)}`, {
        body: compactObject({
          data: options.data,
          expected_updated_at: options.expectedUpdatedAt,
          name: options.name,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "PUT",
      });

      const payload = mapRegexProfileListItem(readRecord(readRecord(response.body)?.data));
      if (!payload) {
        throw new Error("Regex profile update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapRegexProfileListItem(value: unknown): RegexProfileListItem | null {
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
  };
}
