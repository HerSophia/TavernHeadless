import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import { buildQueryString, compactObject, readArray, readNumber, readRecord, readString } from "./utils.js";

export type PresetListItem = {
  createdAt: number;
  id: string;
  name: string;
  source: string;
  updatedAt: number;
};

export type PresetDetail = PresetListItem & {
  data: Record<string, unknown>;
};

export type PresetEditorEntry = {
  identifier: string;
  name: string;
  role: "assistant" | "system" | "user";
  content: string;
  systemPrompt: boolean;
  marker: boolean;
  injectionPosition: number;
  injectionDepth?: number;
  injectionOrder?: number;
  forbidOverrides?: boolean;
  injectionTrigger?: unknown[];
  enabled: boolean;
  extra: Record<string, unknown>;
};

export type PresetEditorOrderContext = {
  characterId: number;
  order: Array<{ identifier: string; enabled: boolean }>;
  extra: Record<string, unknown>;
};

export type PresetEditorDocument = {
  format: "legacy-compact" | "st-raw";
  defaultCharacterId: number;
  entries: PresetEditorEntry[];
  orderContexts: PresetEditorOrderContext[];
  topLevel: Record<string, unknown>;
};

export type PresetEditorDetail = PresetListItem & {
  editor: PresetEditorDocument;
};

export type PresetsResource = {
  getDetail(options: { accountId?: string; presetId: string }): Promise<PresetDetail>;
  getEditor(options: { accountId?: string; presetId: string }): Promise<PresetEditorDetail>;
  list(options?: { accountId?: string }): Promise<PresetListItem[]>;
  remove(options: { accountId?: string; presetId: string }): Promise<void>;
  update(options: {
    accountId?: string;
    editor: {
      default_character_id: number;
      entries: Array<Record<string, unknown>>;
      order_contexts: Array<Record<string, unknown>>;
      top_level: Record<string, unknown>;
    };
    expectedUpdatedAt?: number;
    name: string;
    presetId: string;
  }): Promise<PresetListItem>;
};

export function createPresetsResource(client: TransportClient): PresetsResource {
  return {
    async getDetail(options): Promise<PresetDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/presets/${encodeURIComponent(options.presetId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const detail = readRecord(readRecord(response.body)?.data);
      if (!detail) {
        throw new Error("Preset detail payload is missing");
      }

      return {
        createdAt: readNumber(detail.created_at),
        data: readRecord(detail.data) ?? {},
        id: readString(detail.id),
        name: readString(detail.name),
        source: readString(detail.source),
        updatedAt: readNumber(detail.updated_at),
      };
    },
    async getEditor(options): Promise<PresetEditorDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/presets/${encodeURIComponent(options.presetId)}/editor`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const detail = readRecord(readRecord(response.body)?.data);
      const editor = readRecord(detail?.editor);
      if (!detail || !editor) {
        throw new Error("Preset editor payload is missing");
      }

      return {
        createdAt: readNumber(detail.created_at),
        editor: {
          defaultCharacterId: readNumber(editor.default_character_id),
          entries: readArray(editor.entries).map(mapPresetEditorEntry),
          format: readString(editor.format, "st-raw") as PresetEditorDocument["format"],
          orderContexts: readArray(editor.order_contexts).map(mapPresetOrderContext),
          topLevel: readRecord(editor.top_level) ?? {},
        },
        id: readString(detail.id),
        name: readString(detail.name),
        source: readString(detail.source),
        updatedAt: readNumber(detail.updated_at),
      };
    },
    async list(options = {}): Promise<PresetListItem[]> {
      const response = await client.fetchJson<Record<string, unknown>>("/presets", {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapPresetListItem)
        .filter((item): item is PresetListItem => item !== null);
    },
    async remove(options): Promise<void> {
      const query = buildQueryString({});
      const pathname = query ? `/presets/${encodeURIComponent(options.presetId)}?${query}` : `/presets/${encodeURIComponent(options.presetId)}`;
      await client.fetchJson(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });
    },
    async update(options): Promise<PresetListItem> {
      const response = await client.fetchJson<Record<string, unknown>>(`/presets/${encodeURIComponent(options.presetId)}`, {
        body: compactObject({
          editor: options.editor,
          expected_updated_at: options.expectedUpdatedAt,
          name: options.name,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "PUT",
      });

      const payload = readRecord(readRecord(response.body)?.data);
      const mapped = mapPresetListItem(payload);
      if (!mapped) {
        throw new Error("Preset update returned an invalid payload");
      }

      return mapped;
    },
  };
}

function mapPresetEditorEntry(value: unknown): PresetEditorEntry {
  const record = readRecord(value) ?? {};

  return {
    content: readString(record.content),
    enabled: Boolean(record.enabled),
    extra: readRecord(record.extra) ?? {},
    forbidOverrides: typeof record.forbid_overrides === "boolean" ? record.forbid_overrides : undefined,
    identifier: readString(record.identifier),
    injectionDepth: typeof record.injection_depth === "number" ? record.injection_depth : undefined,
    injectionOrder: typeof record.injection_order === "number" ? record.injection_order : undefined,
    injectionPosition: readNumber(record.injection_position),
    injectionTrigger: Array.isArray(record.injection_trigger) ? record.injection_trigger : undefined,
    marker: Boolean(record.marker),
    name: readString(record.name),
    role: readString(record.role, "system") as PresetEditorEntry["role"],
    systemPrompt: Boolean(record.system_prompt),
  };
}

function mapPresetListItem(value: unknown): PresetListItem | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    createdAt: readNumber(record.created_at),
    id: readString(record.id),
    name: readString(record.name),
    source: readString(record.source),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapPresetOrderContext(value: unknown): PresetEditorOrderContext {
  const record = readRecord(value) ?? {};

  return {
    characterId: readNumber(record.character_id),
    extra: readRecord(record.extra) ?? {},
    order: readArray(record.order).map((item) => {
      const itemRecord = readRecord(item) ?? {};
      return {
        enabled: Boolean(itemRecord.enabled),
        identifier: readString(itemRecord.identifier),
      };
    }),
  };
}
