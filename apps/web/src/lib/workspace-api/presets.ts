import { apiClient } from "../api";
import { asRecordPayload } from "./mappers";
import type {
  WorkspaceLibraryAsset,
  WorkspacePresetAssetDetail,
  WorkspacePresetEditorDetail
} from "./types";

export async function fetchPresetAssetDetail(presetId: string, accountId?: string): Promise<WorkspacePresetAssetDetail> {
  const detail = await apiClient.presets.getDetail({
    accountId,
    presetId
  });

  return {
    createdAt: detail.createdAt,
    data: asRecordPayload(detail.data, "preset"),
    id: detail.id,
    name: detail.name,
    source: detail.source,
    updatedAt: detail.updatedAt
  };
}

export async function fetchPresetAssetEditorDetail(
  presetId: string,
  accountId?: string
): Promise<WorkspacePresetEditorDetail> {
  const detail = await apiClient.presets.getEditor({
    accountId,
    presetId
  });

  return {
    createdAt: detail.createdAt,
    editor: detail.editor,
    id: detail.id,
    name: detail.name,
    source: detail.source,
    updatedAt: detail.updatedAt
  };
}

export async function updatePresetAsset(
  presetId: string,
  name: string,
  editor: {
    default_character_id: number;
    entries: Array<Record<string, unknown>>;
    order_contexts: Array<Record<string, unknown>>;
    top_level: Record<string, unknown>;
  },
  expectedUpdatedAt: number | undefined,
  accountId?: string
): Promise<WorkspaceLibraryAsset> {
  const payload = await apiClient.presets.update({
    accountId,
    editor,
    expectedUpdatedAt,
    name,
    presetId
  });

  return {
    createdAt: payload.createdAt,
    id: payload.id,
    kind: "preset",
    name: payload.name,
    source: payload.source,
    updatedAt: payload.updatedAt
  };
}

export async function deletePresetAsset(presetId: string, accountId?: string): Promise<void> {
  await apiClient.presets.remove({
    accountId,
    presetId
  });
}
