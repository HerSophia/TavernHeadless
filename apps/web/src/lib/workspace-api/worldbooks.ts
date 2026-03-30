import { apiClient } from "../api";
import { asRecordPayload } from "./mappers";
import type {
  WorkspaceLibraryAsset,
  WorkspaceWorldbookAssetDetail
} from "./types";

export async function fetchWorldbookAssetDetail(
  worldbookId: string,
  accountId?: string
): Promise<WorkspaceWorldbookAssetDetail> {
  const detail = await apiClient.worldbooks.getDetail({
    accountId,
    worldbookId
  });

  return {
    createdAt: detail.createdAt,
    data: asRecordPayload(detail.data, "worldbook"),
    id: detail.id,
    name: detail.name,
    source: detail.source,
    updatedAt: detail.updatedAt,
    version: detail.version
  };
}

export async function updateWorldbookAsset(
  worldbookId: string,
  name: string,
  data: Record<string, unknown>,
  expectedVersion: number | undefined,
  accountId?: string
): Promise<WorkspaceLibraryAsset> {
  const payload = await apiClient.worldbooks.update({
    accountId,
    data,
    expectedVersion,
    name,
    worldbookId
  });

  return {
    createdAt: payload.createdAt,
    id: payload.id,
    kind: "worldbook",
    name: payload.name,
    source: payload.source,
    updatedAt: payload.updatedAt,
    version: payload.version
  };
}

export async function deleteWorldbookAsset(
  worldbookId: string,
  expectedVersion: number | undefined,
  accountId?: string
): Promise<void> {
  await apiClient.worldbooks.remove({
    accountId,
    expectedVersion,
    worldbookId
  });
}
