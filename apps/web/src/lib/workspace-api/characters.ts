import { apiClient } from "../api";
import { asRecordPayload } from "./mappers";
import type {
  WorkspaceCharacterAssetDetail,
  WorkspaceCharacterAssetSnapshot,
  WorkspaceCharacterVersionResult
} from "./types";

export async function fetchCharacterAssetDetail(
  characterId: string,
  accountId?: string
): Promise<WorkspaceCharacterAssetDetail> {
  const detail = await apiClient.characters.getDetail({
    accountId,
    characterId
  });

  const snapshotRecord = detail.latestVersion?.snapshot ?? null;

  return {
    createdAt: detail.createdAt,
    deletedAt: detail.deletedAt,
    id: detail.id,
    latestVersionId: detail.latestVersion?.id ?? null,
    latestVersionNo: detail.latestVersionNo,
    name: detail.name,
    revision: detail.revision,
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
    updatedAt: detail.updatedAt
  };
}

export async function createCharacterAssetVersion(
  characterId: string,
  snapshot: WorkspaceCharacterAssetSnapshot,
  accountId?: string
): Promise<WorkspaceCharacterVersionResult> {
  const payload = await apiClient.characters.createVersion({
    accountId,
    characterId,
    snapshot
  });

  return {
    createdAt: payload.createdAt,
    id: payload.id,
    revision: payload.revision,
    snapshot: asRecordPayload(payload.snapshot, "character") as WorkspaceCharacterAssetSnapshot,
    versionNo: payload.versionNo
  };
}

export async function deleteCharacterAsset(characterId: string, accountId?: string): Promise<void> {
  await apiClient.characters.remove({
    accountId,
    characterId
  });
}

export async function restoreCharacterAsset(characterId: string, accountId?: string): Promise<void> {
  await apiClient.characters.restore({
    accountId,
    characterId
  });
}
