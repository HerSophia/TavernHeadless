import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { buildQueryString, compactObject, readArray, readNumber, readRecord, readString } from "./utils.js";
import {
  mapPromptAssetRollbackResult,
  mapPromptAssetVersion,
  mapPromptAssetVersionCompareResult,
  type PromptAssetRollbackResult,
  type PromptAssetVersionCompareResult,
  type PromptAssetVersionRecord,
} from "./asset-versions.js";

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
  compareVersions(options: {
    accountId?: AccountIdHint;
    leftVersionId: string;
    mode?: "summary" | "full";
    rightVersionId: string;
    worldbookId: string;
  }): Promise<PromptAssetVersionCompareResult>;
  getVersion(options: { accountId?: AccountIdHint; versionId: string; worldbookId: string }): Promise<PromptAssetVersionRecord>;
  listVersions(options: { accountId?: AccountIdHint; worldbookId: string }): Promise<PromptAssetVersionRecord[]>;
  getDetail(options: { accountId?: AccountIdHint; worldbookId: string }): Promise<WorldbookDetail>;
  list(options?: { accountId?: AccountIdHint }): Promise<WorldbookListItem[]>;
  remove(options: { accountId?: AccountIdHint; expectedVersion?: number; worldbookId: string }): Promise<void>;
  rollbackVersion(options: {
    accountId?: AccountIdHint;
    expectedUpdatedAt?: number;
    expectedVersion?: number;
    versionId: string;
    worldbookId: string;
  }): Promise<PromptAssetRollbackResult>;
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
    async compareVersions(options): Promise<PromptAssetVersionCompareResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/versions/compare`,
        {
          body: compactObject({
            left_version_id: options.leftVersionId,
            mode: options.mode,
            right_version_id: options.rightVersionId,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      const result = mapPromptAssetVersionCompareResult(readRecord(response.body)?.data);
      if (!result) {
        throw new Error("Worldbook version compare payload is missing");
      }
      return result;
    },

    async getVersion(options): Promise<PromptAssetVersionRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/versions/${encodeURIComponent(options.versionId)}`,
        { headers: buildAccountHeaders(options.accountId), method: "GET" },
      );
      const version = mapPromptAssetVersion(readRecord(response.body)?.data);
      if (!version) {
        throw new Error("Worldbook version payload is missing");
      }
      return version;
    },

    async listVersions(options): Promise<PromptAssetVersionRecord[]> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/versions`,
        { headers: buildAccountHeaders(options.accountId), method: "GET" },
      );
      return readArray(readRecord(response.body)?.data)
        .map(mapPromptAssetVersion)
        .filter((version): version is PromptAssetVersionRecord => version !== null);
    },

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
      const query = buildQueryString({
        expected_version: options.expectedVersion,
      });
      const pathname = query ? `/worldbooks/${encodeURIComponent(options.worldbookId)}?${query}` : `/worldbooks/${encodeURIComponent(options.worldbookId)}`;
      await client.fetchJson(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });
    },
    async rollbackVersion(options): Promise<PromptAssetRollbackResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/worldbooks/${encodeURIComponent(options.worldbookId)}/versions/${encodeURIComponent(options.versionId)}/rollback`,
        {
          body: compactObject({
            expected_updated_at: options.expectedUpdatedAt,
            expected_version: options.expectedVersion,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      const result = mapPromptAssetRollbackResult(readRecord(response.body)?.data);
      if (!result) {
        throw new Error("Worldbook version rollback payload is missing");
      }

      return result;
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
