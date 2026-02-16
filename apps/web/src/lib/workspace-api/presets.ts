import { asRecordPayload } from "./mappers";
import {
  fetchJson,
  putJson,
  resolvePath,
  extractErrorMessage,
  buildAccountHeaders
} from "./transport";
import type {
  PresetEditorResponse,
  PresetUpdateResponse,
  ResourceDetailResponse,
  WorkspaceLibraryAsset,
  WorkspacePresetAssetDetail,
  WorkspacePresetEditorDetail
} from "./types";

export async function fetchPresetAssetDetail(presetId: string, accountId?: string): Promise<WorkspacePresetAssetDetail> {
  const response = await fetchJson<ResourceDetailResponse>(`/presets/${encodeURIComponent(presetId)}`, accountId);
  const detail = response.data;
  if (!detail) {
    throw new Error("Preset detail payload is missing");
  }

  return {
    createdAt: detail.created_at,
    data: asRecordPayload(detail.data, "preset"),
    id: detail.id,
    name: detail.name,
    source: detail.source,
    updatedAt: detail.updated_at
  };
}

export async function fetchPresetAssetEditorDetail(
  presetId: string,
  accountId?: string
): Promise<WorkspacePresetEditorDetail> {
  const response = await fetchJson<PresetEditorResponse>(`/presets/${encodeURIComponent(presetId)}/editor`, accountId);
  const detail = response.data;
  if (!detail) {
    throw new Error("Preset editor payload is missing");
  }

  return {
    createdAt: detail.created_at,
    editor: {
      defaultCharacterId: detail.editor.default_character_id,
      entries: detail.editor.entries.map((entry) => ({
        identifier: entry.identifier,
        name: entry.name,
        role: entry.role,
        content: entry.content,
        systemPrompt: entry.system_prompt,
        marker: entry.marker,
        injectionPosition: entry.injection_position,
        injectionDepth: entry.injection_depth,
        injectionOrder: entry.injection_order,
        forbidOverrides: entry.forbid_overrides,
        injectionTrigger: entry.injection_trigger,
        enabled: entry.enabled,
        extra: entry.extra ?? {}
      })),
      format: detail.editor.format,
      orderContexts: detail.editor.order_contexts.map((context) => ({
        characterId: context.character_id,
        order: context.order.map((item) => ({
          identifier: item.identifier,
          enabled: item.enabled
        })),
        extra: context.extra ?? {}
      })),
      topLevel: detail.editor.top_level ?? {}
    },
    id: detail.id,
    name: detail.name,
    source: detail.source,
    updatedAt: detail.updated_at
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
  const response = await putJson<PresetUpdateResponse>(`/presets/${encodeURIComponent(presetId)}`, {
    editor,
    expected_updated_at: expectedUpdatedAt,
    name
  }, accountId);
  const payload = response.data;
  if (!payload) {
    throw new Error("Preset update returned an invalid payload");
  }
  return {
    createdAt: payload.created_at,
    id: payload.id,
    kind: "preset",
    name: payload.name,
    source: payload.source,
    updatedAt: payload.updated_at
  };
}

export async function deletePresetAsset(presetId: string, accountId?: string): Promise<void> {
  const response = await fetch(resolvePath(`/presets/${encodeURIComponent(presetId)}`), {
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
