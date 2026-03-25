import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import { buildQueryString, compactObject, readArray, readBoolean, readNumber, readRecord, readString } from "./utils.js";

export type PresetEntryRole = "assistant" | "system" | "user";

export type PresetEntryRecord = {
  content: string;
  enabled: boolean;
  extra: Record<string, unknown>;
  forbidOverrides?: boolean;
  identifier: string;
  injectionDepth?: number;
  injectionOrder?: number;
  injectionPosition: number;
  injectionTrigger?: unknown[];
  marker: boolean;
  name: string;
  role: PresetEntryRole;
  systemPrompt: boolean;
};

export type PresetEntriesListResult = {
  defaultCharacterId: number;
  entries: PresetEntryRecord[];
  presetId: string;
};

export type PresetEntryDeleteResult = {
  deleted: boolean;
  identifier: string;
};

export type PresetEntriesBatchUpdateResult = {
  meta: {
    notFound: number;
    total: number;
    updated: number;
  };
  results: Array<{
    action: "not_found" | "updated" | string;
    data?: PresetEntryRecord;
    identifier: string;
    index: number;
  }>;
};

export type PresetEntriesBatchDeleteResult = {
  meta: {
    deleted: number;
    notFound: number;
    total: number;
  };
  results: Array<{
    action: "deleted" | "not_found" | string;
    identifier: string;
    index: number;
  }>;
};

export type PresetEntriesResource = {
  batchDelete(options: { accountId?: string; identifiers: string[]; presetId: string }): Promise<PresetEntriesBatchDeleteResult>;
  batchUpdate(options: {
    accountId?: string;
    fields: Partial<{
      content: string;
      enabled: boolean;
      extra: Record<string, unknown>;
      forbid_overrides: boolean;
      injection_depth: number;
      injection_order: number;
      injection_position: number;
      injection_trigger: unknown[];
      marker: boolean;
      name: string;
      role: PresetEntryRole;
      system_prompt: boolean;
    }>;
    identifiers: string[];
    presetId: string;
  }): Promise<PresetEntriesBatchUpdateResult>;
  create(options: {
    accountId?: string;
    content?: string;
    enabled?: boolean;
    extra?: Record<string, unknown>;
    forbidOverrides?: boolean;
    identifier: string;
    injectionDepth?: number;
    injectionOrder?: number;
    injectionPosition?: number;
    injectionTrigger?: unknown[];
    marker?: boolean;
    name?: string;
    presetId: string;
    role?: PresetEntryRole;
    systemPrompt?: boolean;
  }): Promise<PresetEntryRecord>;
  getDetail(options: { accountId?: string; identifier: string; presetId: string }): Promise<PresetEntryRecord>;
  list(options: { accountId?: string; enabled?: boolean; marker?: boolean; presetId: string }): Promise<PresetEntriesListResult>;
  remove(options: { accountId?: string; identifier: string; presetId: string }): Promise<PresetEntryDeleteResult>;
  reorder(options: { accountId?: string; identifiers: string[]; presetId: string }): Promise<PresetEntriesListResult>;
  update(options: {
    accountId?: string;
    content?: string;
    enabled?: boolean;
    extra?: Record<string, unknown>;
    forbidOverrides?: boolean;
    identifier: string;
    injectionDepth?: number;
    injectionOrder?: number;
    injectionPosition?: number;
    injectionTrigger?: unknown[];
    marker?: boolean;
    name?: string;
    presetId: string;
    role?: PresetEntryRole;
    systemPrompt?: boolean;
  }): Promise<PresetEntryRecord>;
};

export function createPresetEntriesResource(client: TransportClient): PresetEntriesResource {
  return {
    async batchDelete(options): Promise<PresetEntriesBatchDeleteResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/presets/${encodeURIComponent(options.presetId)}/entries/batch/delete`,
        {
          body: {
            identifiers: options.identifiers,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      return mapBatchDeleteResult(response.body);
    },
    async batchUpdate(options): Promise<PresetEntriesBatchUpdateResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/presets/${encodeURIComponent(options.presetId)}/entries/batch/update`,
        {
          body: {
            fields: compactObject(options.fields),
            identifiers: options.identifiers,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );

      return mapBatchUpdateResult(response.body);
    },
    async create(options): Promise<PresetEntryRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/presets/${encodeURIComponent(options.presetId)}/entries`, {
        body: compactObject({
          content: options.content,
          enabled: options.enabled,
          extra: options.extra,
          forbid_overrides: options.forbidOverrides,
          identifier: options.identifier,
          injection_depth: options.injectionDepth,
          injection_order: options.injectionOrder,
          injection_position: options.injectionPosition,
          injection_trigger: options.injectionTrigger,
          marker: options.marker,
          name: options.name,
          role: options.role,
          system_prompt: options.systemPrompt,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapPresetEntry(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Preset entry create returned an invalid payload");
      }

      return payload;
    },
    async getDetail(options): Promise<PresetEntryRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/presets/${encodeURIComponent(options.presetId)}/entries/${encodeURIComponent(options.identifier)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapPresetEntry(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Preset entry detail returned an invalid payload");
      }

      return payload;
    },
    async list(options): Promise<PresetEntriesListResult> {
      const query = buildQueryString(
        compactObject({
          enabled: options.enabled,
          marker: options.marker,
        }),
      );
      const pathname = query
        ? `/presets/${encodeURIComponent(options.presetId)}/entries?${query}`
        : `/presets/${encodeURIComponent(options.presetId)}/entries`;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const data = readRecord(readRecord(response.body)?.data);
      return {
        defaultCharacterId: readNumber(data?.default_character_id),
        entries: readArray(data?.entries)
          .map(mapPresetEntry)
          .filter((item): item is PresetEntryRecord => item !== null),
        presetId: readString(data?.preset_id),
      };
    },
    async remove(options): Promise<PresetEntryDeleteResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/presets/${encodeURIComponent(options.presetId)}/entries/${encodeURIComponent(options.identifier)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "DELETE",
        },
      );

      const data = readRecord(readRecord(response.body)?.data);
      return {
        deleted: readBoolean(data?.deleted),
        identifier: readString(data?.identifier),
      };
    },
    async reorder(options): Promise<PresetEntriesListResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/presets/${encodeURIComponent(options.presetId)}/entries/reorder`,
        {
          body: {
            identifiers: options.identifiers,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "PUT",
        },
      );

      const data = readRecord(readRecord(response.body)?.data);
      return {
        defaultCharacterId: readNumber(data?.default_character_id),
        entries: readArray(data?.entries)
          .map(mapPresetEntry)
          .filter((item): item is PresetEntryRecord => item !== null),
        presetId: readString(data?.preset_id),
      };
    },
    async update(options): Promise<PresetEntryRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/presets/${encodeURIComponent(options.presetId)}/entries/${encodeURIComponent(options.identifier)}`,
        {
          body: compactObject({
            content: options.content,
            enabled: options.enabled,
            extra: options.extra,
            forbid_overrides: options.forbidOverrides,
            injection_depth: options.injectionDepth,
            injection_order: options.injectionOrder,
            injection_position: options.injectionPosition,
            injection_trigger: options.injectionTrigger,
            marker: options.marker,
            name: options.name,
            role: options.role,
            system_prompt: options.systemPrompt,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );

      const payload = mapPresetEntry(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Preset entry update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapPresetEntry(value: unknown): PresetEntryRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    content: readString(record.content),
    enabled: readBoolean(record.enabled),
    extra: readRecord(record.extra) ?? {},
    forbidOverrides: typeof record.forbid_overrides === "boolean" ? record.forbid_overrides : undefined,
    identifier: readString(record.identifier),
    injectionDepth: typeof record.injection_depth === "number" ? record.injection_depth : undefined,
    injectionOrder: typeof record.injection_order === "number" ? record.injection_order : undefined,
    injectionPosition: readNumber(record.injection_position),
    injectionTrigger: Array.isArray(record.injection_trigger) ? record.injection_trigger : undefined,
    marker: readBoolean(record.marker),
    name: readString(record.name),
    role: readString(record.role, "system") as PresetEntryRole,
    systemPrompt: readBoolean(record.system_prompt),
  };
}

function mapBatchUpdateResult(payload: Record<string, unknown> | null): PresetEntriesBatchUpdateResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      notFound: readNumber(meta?.not_found),
      total: readNumber(meta?.total),
      updated: readNumber(meta?.updated),
    },
    results: readArray(data?.results).reduce<PresetEntriesBatchUpdateResult["results"]>((items, value) => {
      const record = readRecord(value);
      if (!record) {
        return items;
      }

      const entry = mapPresetEntry(record.data);
      items.push({
        ...((entry ? { data: entry } : {}) as Partial<PresetEntriesBatchUpdateResult["results"][number]>),
        action: readString(record.action),
        identifier: readString(record.identifier),
        index: readNumber(record.index),
      });

      return items;
    }, []),
  };
}

function mapBatchDeleteResult(payload: Record<string, unknown> | null): PresetEntriesBatchDeleteResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      deleted: readNumber(meta?.deleted),
      notFound: readNumber(meta?.not_found),
      total: readNumber(meta?.total),
    },
    results: readArray(data?.results)
      .map((value) => {
        const record = readRecord(value);
        if (!record) {
          return null;
        }

        return {
          action: readString(record.action),
          identifier: readString(record.identifier),
          index: readNumber(record.index),
        };
      })
      .filter((item): item is PresetEntriesBatchDeleteResult["results"][number] => item !== null),
  };
}
