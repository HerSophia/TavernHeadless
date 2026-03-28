import { apiClient } from "../api";
import {
  asRecordPayload,
  deriveAssetName,
  normalizeUserSnapshot
} from "./mappers";
import type {
  WorkspaceAssetImportInput,
  WorkspaceAssetImportResult,
  WorkspaceLibraryAsset
} from "./types";

export async function fetchLibraryAssets(accountId?: string): Promise<WorkspaceLibraryAsset[]> {
  const [characters, presets, users, worldbooks] = await Promise.all([
    fetchCharacterAssets(accountId),
    fetchPresetAssets(accountId),
    fetchUserAssets(accountId),
    fetchWorldbookAssets(accountId)
  ]);

  return [...characters, ...presets, ...users, ...worldbooks].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.name.localeCompare(right.name);
  });
}

export async function importLibraryAsset(
  input: WorkspaceAssetImportInput,
  accountId?: string
): Promise<WorkspaceAssetImportResult> {
  const name = deriveAssetName(input.fileName);

  if (input.kind === "preset") {
    const item = await apiClient.imports.preset({
      accountId,
      data: asRecordPayload(input.payload, input.kind),
      name
    });

    return {
      id: item.id,
      kind: "preset",
      name: item.name,
      source: item.source
    };
  }

  if (input.kind === "worldbook") {
    const item = await apiClient.imports.worldbook({
      accountId,
      data: asRecordPayload(input.payload, input.kind),
      name
    });

    return {
      id: item.id,
      kind: "worldbook",
      name: item.name,
      source: item.source
    };
  }

  if (input.kind === "character") {
    const item = await apiClient.imports.character({
      accountId,
      payload: asRecordPayload(input.payload, input.kind),
      title: name
    });

    return {
      id: item.characterId,
      kind: "character",
      name: item.name,
      source: item.source
    };
  }

  const item = await apiClient.users.create({
    accountId,
    snapshot: normalizeUserSnapshot(input.payload, name)
  });

  return {
    id: item.id,
    kind: "user",
    name: item.name,
    source: "account"
  };
}

async function fetchCharacterAssets(accountId?: string): Promise<WorkspaceLibraryAsset[]> {
  const response = await apiClient.characters.list({
    accountId,
    limit: 100,
    offset: 0,
    sortBy: "updated_at",
    sortOrder: "desc",
    status: "active"
  });

  return response.map((item) => ({
    createdAt: item.createdAt,
    id: item.id,
    kind: "character",
    name: item.name,
    source: item.source,
    status: item.status,
    updatedAt: item.updatedAt
  }));
}

export async function fetchPresetAssets(accountId?: string): Promise<WorkspaceLibraryAsset[]> {
  const response = await apiClient.presets.list({ accountId });
  return response.map((item) => ({
    createdAt: item.createdAt,
    id: item.id,
    kind: "preset",
    name: item.name,
    source: item.source,
    updatedAt: item.updatedAt,
    version: item.version
  }));
}

async function fetchWorldbookAssets(accountId?: string): Promise<WorkspaceLibraryAsset[]> {
  const response = await apiClient.worldbooks.list({ accountId });
  return response.map((item) => ({
    createdAt: item.createdAt,
    id: item.id,
    kind: "worldbook",
    name: item.name,
    source: item.source,
    updatedAt: item.updatedAt,
    version: item.version
  }));
}

async function fetchUserAssets(accountId?: string): Promise<WorkspaceLibraryAsset[]> {
  const response = await apiClient.users.list({
    accountId,
    limit: 100,
    offset: 0,
    sortBy: "updated_at",
    sortOrder: "desc"
  });

  return response.map((item) => ({
    createdAt: item.createdAt,
    id: item.id,
    kind: "user",
    name: item.name,
    source: "account",
    status: item.status,
    updatedAt: item.updatedAt
  }));
}
