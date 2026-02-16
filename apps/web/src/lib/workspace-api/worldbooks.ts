import { asRecordPayload } from "./mappers";
import {
  fetchJson,
  putJson,
  resolvePath,
  extractErrorMessage,
  buildAccountHeaders
} from "./transport";
import type {
  PresetUpdateResponse,
  ResourceDetailResponse,
  WorkspaceLibraryAsset,
  WorkspaceWorldbookAssetDetail
} from "./types";

export async function fetchWorldbookAssetDetail(
  worldbookId: string,
  accountId?: string
): Promise<WorkspaceWorldbookAssetDetail> {
  const response = await fetchJson<ResourceDetailResponse>(`/worldbooks/${encodeURIComponent(worldbookId)}`, accountId);
  const detail = response.data;
  if (!detail) {
    throw new Error("Worldbook detail payload is missing");
  }

  return {
    createdAt: detail.created_at,
    data: asRecordPayload(detail.data, "worldbook"),
    id: detail.id,
    name: detail.name,
    source: detail.source,
    updatedAt: detail.updated_at
  };
}

export async function updateWorldbookAsset(
  worldbookId: string,
  name: string,
  data: Record<string, unknown>,
  expectedUpdatedAt: number | undefined,
  accountId?: string
): Promise<WorkspaceLibraryAsset> {
  const response = await putJson<PresetUpdateResponse>(`/worldbooks/${encodeURIComponent(worldbookId)}`, {
    data,
    expected_updated_at: expectedUpdatedAt,
    name
  }, accountId);
  const payload = response.data;
  if (!payload) {
    throw new Error("Worldbook update returned an invalid payload");
  }
  return {
    createdAt: payload.created_at,
    id: payload.id,
    kind: "worldbook",
    name: payload.name,
    source: payload.source,
    updatedAt: payload.updated_at
  };
}

export async function deleteWorldbookAsset(worldbookId: string, accountId?: string): Promise<void> {
  const response = await fetch(resolvePath(`/worldbooks/${encodeURIComponent(worldbookId)}`), {
    headers: {
      ...buildAccountHeaders(accountId)
    },
    method: "DELETE"
  });

  if (response.status === 204) {
    return;
  }

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
}
