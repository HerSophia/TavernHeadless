import { asRecordPayload } from "./mappers";
import { postJson, fetchJson, resolvePath, extractErrorMessage, buildAccountHeaders } from "./transport";
import type {
  CharacterDetailResponse,
  CharacterVersionMutationResponse,
  WorkspaceCharacterAssetDetail,
  WorkspaceCharacterAssetSnapshot,
  WorkspaceCharacterVersionResult
} from "./types";

export async function fetchCharacterAssetDetail(
  characterId: string,
  accountId?: string
): Promise<WorkspaceCharacterAssetDetail> {
  const response = await fetchJson<CharacterDetailResponse>(`/characters/${encodeURIComponent(characterId)}`, accountId);
  const detail = response.data;
  if (!detail) {
    throw new Error("Character detail payload is missing");
  }

  const snapshot = detail.latest_version?.snapshot;
  const snapshotRecord =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : null;

  return {
    createdAt: detail.created_at,
    deletedAt: detail.deleted_at,
    id: detail.id,
    latestVersionId: detail.latest_version?.id ?? null,
    latestVersionNo: detail.latest_version_no,
    name: detail.name,
    snapshot: snapshotRecord
      ? {
          ...snapshotRecord,
          name:
            typeof snapshotRecord.name === "string" && snapshotRecord.name.trim().length > 0
              ? snapshotRecord.name.trim()
              : detail.name
        }
      : null,
    source: detail.source,
    status: detail.status,
    updatedAt: detail.updated_at
  };
}

export async function createCharacterAssetVersion(
  characterId: string,
  snapshot: WorkspaceCharacterAssetSnapshot,
  accountId?: string
): Promise<WorkspaceCharacterVersionResult> {
  const response = await postJson<CharacterVersionMutationResponse>(
    `/characters/${encodeURIComponent(characterId)}/versions`,
    {
      snapshot
    },
    accountId
  );
  const payload = response.data;
  if (!payload) {
    throw new Error("Character update returned an invalid payload");
  }

  return {
    createdAt: payload.created_at,
    id: payload.id,
    snapshot: asRecordPayload(payload.snapshot, "character") as WorkspaceCharacterAssetSnapshot,
    versionNo: payload.version_no
  };
}

export async function deleteCharacterAsset(characterId: string, accountId?: string): Promise<void> {
  const response = await fetch(resolvePath(`/characters/${encodeURIComponent(characterId)}`), {
    headers: {
      ...buildAccountHeaders(accountId)
    },
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
}

export async function restoreCharacterAsset(characterId: string, accountId?: string): Promise<void> {
  await postJson(`/characters/${encodeURIComponent(characterId)}/restore`, {}, accountId);
}
