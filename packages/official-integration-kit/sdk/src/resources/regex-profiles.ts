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

export type RegexProfileListItem = {
  createdAt: number;
  id: string;
  name: string;
  source: string;
  updatedAt: number;
  version: number;
};

export type RegexProfileDetail = RegexProfileListItem & {
  data: unknown;
};

export type RegexProfileRuleInput = {
  id?: string;
  scriptName?: string;
  findRegex: string;
  replaceString?: string;
  trimStrings?: string[];
  placement?: number[];
  disabled?: boolean;
  markdownOnly?: boolean;
  promptOnly?: boolean;
  runOnEdit?: boolean;
  substituteRegex?: number;
  minDepth?: number;
  maxDepth?: number;
  [key: string]: unknown;
};

export type RegexProfilesResource = {
  compareVersions(options: {
    accountId?: AccountIdHint;
    leftVersionId: string;
    mode?: "summary" | "full";
    profileId: string;
    rightVersionId: string;
  }): Promise<PromptAssetVersionCompareResult>;
  getVersion(options: { accountId?: AccountIdHint; profileId: string; versionId: string }): Promise<PromptAssetVersionRecord>;
  listVersions(options: { accountId?: AccountIdHint; profileId: string }): Promise<PromptAssetVersionRecord[]>;
  getDetail(options: { accountId?: AccountIdHint; profileId: string }): Promise<RegexProfileDetail>;
  list(options?: { accountId?: AccountIdHint }): Promise<RegexProfileListItem[]>;
  remove(options: { accountId?: AccountIdHint; expectedVersion?: number; profileId: string }): Promise<boolean>;
  rollbackVersion(options: {
    accountId?: AccountIdHint;
    expectedUpdatedAt?: number;
    expectedVersion?: number;
    profileId: string;
    versionId: string;
  }): Promise<PromptAssetRollbackResult>;
  update(options: {
    accountId?: AccountIdHint;
    data: RegexProfileRuleInput[];
    expectedVersion?: number;
    expectedUpdatedAt?: number;
    name: string;
    profileId: string;
  }): Promise<RegexProfileListItem>;
};

export function createRegexProfilesResource(client: TransportClient): RegexProfilesResource {
  return {
    async compareVersions(options): Promise<PromptAssetVersionCompareResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/regex-profiles/${encodeURIComponent(options.profileId)}/versions/compare`,
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
        throw new Error("Regex profile version compare payload is missing");
      }
      return result;
    },

    async getVersion(options): Promise<PromptAssetVersionRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/regex-profiles/${encodeURIComponent(options.profileId)}/versions/${encodeURIComponent(options.versionId)}`,
        { headers: buildAccountHeaders(options.accountId), method: "GET" },
      );
      const version = mapPromptAssetVersion(readRecord(response.body)?.data);
      if (!version) {
        throw new Error("Regex profile version payload is missing");
      }
      return version;
    },

    async listVersions(options): Promise<PromptAssetVersionRecord[]> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/regex-profiles/${encodeURIComponent(options.profileId)}/versions`,
        { headers: buildAccountHeaders(options.accountId), method: "GET" },
      );
      return readArray(readRecord(response.body)?.data)
        .map(mapPromptAssetVersion)
        .filter((version): version is PromptAssetVersionRecord => version !== null);
    },

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
        version: readNumber(detail.version),
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
      const query = buildQueryString({
        expected_version: options.expectedVersion,
      });
      const pathname = query ? `/regex-profiles/${encodeURIComponent(options.profileId)}?${query}` : `/regex-profiles/${encodeURIComponent(options.profileId)}`;
      const response = await client.fetchJson<unknown>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return response.status === 204;
    },
    async rollbackVersion(options): Promise<PromptAssetRollbackResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/regex-profiles/${encodeURIComponent(options.profileId)}/versions/${encodeURIComponent(options.versionId)}/rollback`,
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
        throw new Error("Regex profile version rollback payload is missing");
      }

      return result;
    },
    async update(options): Promise<RegexProfileListItem> {
      const response = await client.fetchJson<Record<string, unknown>>(`/regex-profiles/${encodeURIComponent(options.profileId)}`, {
        body: compactObject({
          data: options.data,
          expected_version: options.expectedVersion,
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
    version: readNumber(record.version),
  };
}
