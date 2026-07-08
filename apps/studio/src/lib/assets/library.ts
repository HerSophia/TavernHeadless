/**
 * 资产库读取薄封装（AST10 / 阶段 C）。
 *
 * 把 character / preset / worldbook / regex 四类资产归一为 `LibraryAsset`，
 * 走公共 `@tavern/sdk` 各资产资源（account 作用域）。详情/版本只读、删除。
 */
import { apiClient } from "../sdk";
import type { AssetKind, AssetVersionItem, CharacterListQuery, LibraryAsset } from "./types";

async function listCharacters(query?: CharacterListQuery): Promise<LibraryAsset[]> {
  const items = await apiClient.characters.list({
    limit: query?.limit ?? 100,
    offset: query?.offset ?? 0,
    sortBy: query?.sortBy ?? "updated_at",
    sortOrder: query?.sortOrder ?? "desc",
    status: query?.status ?? "active",
    ...(query?.keyword ? { keyword: query.keyword } : {}),
  });
  return items.map((item) => ({
    kind: "character",
    id: item.id,
    name: item.name,
    source: item.source,
    version: item.latestVersionNo,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

async function listPresets(): Promise<LibraryAsset[]> {
  const items = await apiClient.presets.list({});
  return items.map((item) => ({
    kind: "preset",
    id: item.id,
    name: item.name,
    source: item.source,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

async function listWorldbooks(): Promise<LibraryAsset[]> {
  const items = await apiClient.worldbooks.list({});
  return items.map((item) => ({
    kind: "worldbook",
    id: item.id,
    name: item.name,
    source: item.source,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

async function listRegex(): Promise<LibraryAsset[]> {
  const items = await apiClient.regexProfiles.list({});
  return items.map((item) => ({
    kind: "regex",
    id: item.id,
    name: item.name,
    source: item.source,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export const libraryApi = {
  /**
   * 列出某类资产。
   *
   * - character：把 `query` 透传给服务端（keyword / sortBy / sortOrder / status / limit / offset）。
   * - preset / worldbook / regex：SDK 无查询参数，忽略 `query`，取全量（前端过滤/排序）。
   */
  list(kind: AssetKind, query?: CharacterListQuery): Promise<LibraryAsset[]> {
    switch (kind) {
      case "character":
        return listCharacters(query);
      case "preset":
        return listPresets();
      case "worldbook":
        return listWorldbooks();
      case "regex":
        return listRegex();
      default:
        return Promise.resolve([]);
    }
  },

  async listVersions(kind: AssetKind, id: string): Promise<AssetVersionItem[]> {
    if (kind === "character") {
      const versions = await apiClient.characters.listVersions({ characterId: id });
      return versions.map((version) => ({ id: version.id, versionNo: version.versionNo, createdAt: version.createdAt }));
    }
    if (kind === "preset") {
      const versions = await apiClient.presets.listVersions({ presetId: id });
      return versions.map((version) => ({ id: version.id, versionNo: version.versionNo, createdAt: version.createdAt }));
    }
    if (kind === "worldbook") {
      const versions = await apiClient.worldbooks.listVersions({ worldbookId: id });
      return versions.map((version) => ({ id: version.id, versionNo: version.versionNo, createdAt: version.createdAt }));
    }
    const versions = await apiClient.regexProfiles.listVersions({ profileId: id });
    return versions.map((version) => ({ id: version.id, versionNo: version.versionNo, createdAt: version.createdAt }));
  },

  async remove(kind: AssetKind, id: string): Promise<void> {
    if (kind === "character") {
      await apiClient.characters.remove({ characterId: id });
      return;
    }
    if (kind === "preset") {
      await apiClient.presets.remove({ presetId: id });
      return;
    }
    if (kind === "worldbook") {
      await apiClient.worldbooks.remove({ worldbookId: id });
      return;
    }
    await apiClient.regexProfiles.remove({ profileId: id });
  },
};
