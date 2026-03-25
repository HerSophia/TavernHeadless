import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import {
  buildQueryString,
  compactObject,
  readArray,
  readNullableNumber,
  readRecord,
  readString,
} from "./utils.js";

export type CharacterListItem = {
  createdAt: number;
  id: string;
  name: string;
  source: string;
  status: string;
  updatedAt: number;
};

export type CharacterVersion = {
  characterId: string;
  contentHash: string;
  createdAt: number;
  id: string;
  snapshot: Record<string, unknown> | null;
  versionNo: number;
};

export type CharacterRollbackVersion = CharacterVersion & {
  rolledBackFromVersionId: string;
};

export type CharacterDetail = {
  createdAt: number;
  deletedAt: number | null;
  id: string;
  latestVersion: CharacterVersion | null;
  latestVersionNo: number | null;
  name: string;
  source: string;
  status: string;
  updatedAt: number;
};

export type CharactersListOptions = {
  accountId?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  sortBy?: "created_at" | "name" | "updated_at";
  sortOrder?: "asc" | "desc";
  status?: string;
};

export type CharactersListVersionsOptions = {
  accountId?: string;
  characterId: string;
  limit?: number;
  offset?: number;
  sortBy?: "created_at" | "version_no";
  sortOrder?: "asc" | "desc";
};

export type CharactersRollbackVersionOptions = {
  accountId?: string;
  characterId: string;
  versionId: string;
};

export type CharactersResource = {
  createVersion(options: {
    accountId?: string;
    characterId: string;
    snapshot: Record<string, unknown>;
  }): Promise<CharacterVersion>;
  getDetail(options: { accountId?: string; characterId: string }): Promise<CharacterDetail>;
  list(options?: CharactersListOptions): Promise<CharacterListItem[]>;
  listVersions(options: CharactersListVersionsOptions): Promise<CharacterVersion[]>;
  remove(options: { accountId?: string; characterId: string }): Promise<void>;
  restore(options: { accountId?: string; characterId: string }): Promise<void>;
  rollbackVersion(options: CharactersRollbackVersionOptions): Promise<CharacterRollbackVersion>;
};

export function createCharactersResource(client: TransportClient): CharactersResource {
  return {
    async createVersion(options): Promise<CharacterVersion> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/characters/${encodeURIComponent(options.characterId)}/versions`,
        {
          body: {
            snapshot: options.snapshot,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapCharacterVersion(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Character update returned an invalid payload");
      }

      return payload;
    },
    async getDetail(options): Promise<CharacterDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/characters/${encodeURIComponent(options.characterId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const detail = readRecord(readRecord(response.body)?.data);
      if (!detail) {
        throw new Error("Character detail payload is missing");
      }

      return {
        createdAt: typeof detail.created_at === "number" ? detail.created_at : 0,
        deletedAt: readNullableNumber(detail.deleted_at),
        id: readString(detail.id),
        latestVersion: mapCharacterVersion(detail.latest_version),
        latestVersionNo: readNullableNumber(detail.latest_version_no),
        name: readString(detail.name),
        source: readString(detail.source),
        status: readString(detail.status),
        updatedAt: typeof detail.updated_at === "number" ? detail.updated_at : 0,
      };
    },
    async list(options: CharactersListOptions = {}): Promise<CharacterListItem[]> {
      const query = buildQueryString({
        keyword: options.keyword,
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
        sort_by: options.sortBy ?? "updated_at",
        sort_order: options.sortOrder ?? "desc",
        status: options.status ?? "active",
      });
      const pathname = query ? `/characters?${query}` : "/characters";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapCharacterListItem)
        .filter((item): item is CharacterListItem => item !== null);
    },
    async listVersions(options): Promise<CharacterVersion[]> {
      const query = buildQueryString({
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
        sort_by: options.sortBy ?? "version_no",
        sort_order: options.sortOrder ?? "desc",
      });
      const pathname = `/characters/${encodeURIComponent(options.characterId)}/versions?${query}`;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapCharacterVersion)
        .filter((item): item is CharacterVersion => item !== null);
    },
    async remove(options): Promise<void> {
      await client.fetchJson(`/characters/${encodeURIComponent(options.characterId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });
    },
    async restore(options): Promise<void> {
      await client.fetchJson(`/characters/${encodeURIComponent(options.characterId)}/restore`, {
        body: {},
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });
    },
    async rollbackVersion(options): Promise<CharacterRollbackVersion> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/characters/${encodeURIComponent(options.characterId)}/versions/${encodeURIComponent(options.versionId)}/rollback`,
        {
          body: compactObject({}),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapRollbackVersion(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Character rollback returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapCharacterListItem(value: unknown): CharacterListItem | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    createdAt: typeof record.created_at === "number" ? record.created_at : 0,
    id: readString(record.id),
    name: readString(record.name),
    source: readString(record.source),
    status: readString(record.status),
    updatedAt: typeof record.updated_at === "number" ? record.updated_at : 0,
  };
}

function mapCharacterVersion(value: unknown): CharacterVersion | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    characterId: readString(record.character_id),
    contentHash: readString(record.content_hash),
    createdAt: typeof record.created_at === "number" ? record.created_at : 0,
    id: readString(record.id),
    snapshot: readRecord(record.snapshot),
    versionNo: typeof record.version_no === "number" ? record.version_no : 0,
  };
}

function mapRollbackVersion(value: unknown): CharacterRollbackVersion | null {
  const version = mapCharacterVersion(value);
  const record = readRecord(value);
  if (!version || !record) {
    return null;
  }

  return {
    ...version,
    rolledBackFromVersionId: readString(record.rolled_back_from_version_id),
  };
}
