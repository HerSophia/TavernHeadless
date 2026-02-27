import {
  asRecordPayload,
  deriveAssetName,
  normalizeUserSnapshot
} from "./mappers";
import {
  fetchJson,
  postJson
} from "./transport";
import type {
  CharacterListResponse,
  ResourceListResponse,
  UserListResponse,
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
    const response = await postJson("/import/preset", {
      data: asRecordPayload(input.payload, input.kind),
      name
    }, accountId);
    const item = (response as { data?: { id?: string; name?: string; source?: string } }).data;
    if (!item?.id) {
      throw new Error("Preset import returned an invalid payload");
    }
    return {
      id: item.id,
      kind: "preset",
      name: item.name ?? name,
      source: item.source ?? "sillytavern"
    };
  }

  if (input.kind === "worldbook") {
    const response = await postJson("/import/worldbook", {
      data: asRecordPayload(input.payload, input.kind),
      name
    }, accountId);
    const item = (response as { data?: { id?: string; name?: string; source?: string } }).data;
    if (!item?.id) {
      throw new Error("Worldbook import returned an invalid payload");
    }
    return {
      id: item.id,
      kind: "worldbook",
      name: item.name ?? name,
      source: item.source ?? "sillytavern"
    };
  }

  if (input.kind === "character") {
    const response = await postJson("/import/character", {
      create_session: false,
      payload: asRecordPayload(input.payload, input.kind),
      title: name
    }, accountId);
    const item = response as { data?: { character?: { name?: string }; character_id?: string } };
    if (!item.data?.character_id) {
      throw new Error("Character import returned an invalid payload");
    }
    return {
      id: item.data.character_id,
      kind: "character",
      name: item.data.character?.name ?? name,
      source: "sillytavern"
    };
  }

  const response = await postJson("/users", {
    snapshot: normalizeUserSnapshot(input.payload, name)
  }, accountId);
  const item = (response as { data?: { id?: string; name?: string } }).data;
  if (!item?.id) {
    throw new Error("User import returned an invalid payload");
  }
  return { id: item.id, kind: "user", name: item.name ?? name, source: "account" };
}

async function fetchCharacterAssets(accountId?: string): Promise<WorkspaceLibraryAsset[]> {
  const query = new URLSearchParams({
    limit: "100",
    offset: "0",
    sort_by: "updated_at",
    sort_order: "desc",
    status: "active"
  });
  const response = await fetchJson<CharacterListResponse>(`/characters?${query.toString()}`, accountId);
  return (response.data ?? []).map((item) => ({
    createdAt: item.created_at,
    id: item.id,
    kind: "character",
    name: item.name,
    source: item.source,
    status: item.status,
    updatedAt: item.updated_at
  }));
}

export async function fetchPresetAssets(accountId?: string): Promise<WorkspaceLibraryAsset[]> {
  const response = await fetchJson<ResourceListResponse>("/presets", accountId);
  return (response.data ?? []).map((item) => ({
    createdAt: item.created_at,
    id: item.id,
    kind: "preset",
    name: item.name,
    source: item.source,
    updatedAt: item.updated_at
  }));
}

async function fetchWorldbookAssets(accountId?: string): Promise<WorkspaceLibraryAsset[]> {
  const response = await fetchJson<ResourceListResponse>("/worldbooks", accountId);
  return (response.data ?? []).map((item) => ({
    createdAt: item.created_at,
    id: item.id,
    kind: "worldbook",
    name: item.name,
    source: item.source,
    updatedAt: item.updated_at
  }));
}

async function fetchUserAssets(accountId?: string): Promise<WorkspaceLibraryAsset[]> {
  const query = new URLSearchParams({
    limit: "100",
    offset: "0",
    sort_by: "updated_at",
    sort_order: "desc"
  });
  const response = await fetchJson<UserListResponse>(`/users?${query.toString()}`, accountId);
  return (response.data ?? []).map((item) => ({
    createdAt: item.created_at,
    id: item.id,
    kind: "user",
    name: item.name,
    source: "account",
    status: item.status,
    updatedAt: item.updated_at
  }));
}
