import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import type { LlmGenerationParams, LlmInstanceScope, LlmInstanceSlot } from "./llm-shared.js";
import { buildQueryString, compactObject, readArray, readBoolean, readNullableString, readRecord, readString } from "./utils.js";

export type LlmInstanceConfig = {
  id: string;
  scope: LlmInstanceScope;
  scopeId: string;
  instanceSlot: LlmInstanceSlot;
  presetId: string | null;
  enabled: boolean;
  params: LlmGenerationParams | null;
  createdAt: number;
  updatedAt: number;
};

export type LlmResolvedInstanceSlot = {
  slot: LlmInstanceSlot;
  source: "session_config" | "global_config" | "default";
  scope: LlmInstanceScope | null;
  configId: string | null;
  presetId: string | null;
  enabled: boolean;
  params: LlmGenerationParams | null;
};

export type LlmInstancesResource = {
  list(options?: { accountId?: string; scope?: LlmInstanceScope; sessionId?: string }): Promise<LlmInstanceConfig[]>;
  listBySlot(options: { accountId?: string; scope?: LlmInstanceScope; sessionId?: string; slot: LlmInstanceSlot }): Promise<LlmInstanceConfig[]>;
  listResolved(options?: { accountId?: string; sessionId?: string }): Promise<LlmResolvedInstanceSlot[]>;
  remove(options: { accountId?: string; scope?: LlmInstanceScope; sessionId?: string; slot: LlmInstanceSlot }): Promise<boolean>;
  upsert(options: {
    accountId?: string;
    enabled?: boolean;
    params?: LlmGenerationParams | null;
    presetId?: string | null;
    scope?: LlmInstanceScope;
    sessionId?: string;
    slot: LlmInstanceSlot;
  }): Promise<LlmInstanceConfig>;
};

export function createLlmInstancesResource(client: TransportClient): LlmInstancesResource {
  return {
    async list(options = {}): Promise<LlmInstanceConfig[]> {
      const query = buildQueryString({
        scope: options.scope,
        session_id: options.sessionId,
      });
      const pathname = query ? `/llm-instances?${query}` : "/llm-instances";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map((item) => mapLlmInstanceConfig(item, null))
        .filter((item): item is LlmInstanceConfig => item !== null);
    },
    async listBySlot(options): Promise<LlmInstanceConfig[]> {
      const query = buildQueryString({
        scope: options.scope,
        session_id: options.sessionId,
      });
      const base = `/llm-instances/${encodeURIComponent(options.slot)}`;
      const pathname = query ? `${base}?${query}` : base;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map((item) => mapLlmInstanceConfig(item, null))
        .filter((item): item is LlmInstanceConfig => item !== null);
    },
    async listResolved(options = {}): Promise<LlmResolvedInstanceSlot[]> {
      const query = buildQueryString({
        session_id: options.sessionId,
      });
      const pathname = query ? `/llm-instances/resolved?${query}` : "/llm-instances/resolved";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(readRecord(response.body)?.data)?.slots)
        .map((item) => mapResolvedSlot(item, null))
        .filter((item): item is LlmResolvedInstanceSlot => item !== null);
    },
    async remove(options): Promise<boolean> {
      const query = buildQueryString({
        scope: options.scope,
        session_id: options.sessionId,
      });
      const base = `/llm-instances/${encodeURIComponent(options.slot)}`;
      const pathname = query ? `${base}?${query}` : base;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted);
    },
    async upsert(options): Promise<LlmInstanceConfig> {
      const response = await client.fetchJson<Record<string, unknown>>(`/llm-instances/${encodeURIComponent(options.slot)}`, {
        body: compactObject({
          enabled: options.enabled,
          params: options.params,
          preset_id: options.presetId,
          scope: options.scope,
          session_id: options.sessionId,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "PUT",
      });

      const payload = mapLlmInstanceConfig(readRecord(response.body)?.data, "Failed to upsert instance config");
      if (!payload) {
        throw new Error("Failed to upsert instance config");
      }

      return payload;
    },
  };
}

function mapLlmInstanceConfig(value: unknown, errorMessage: string | null): LlmInstanceConfig | null {
  const record = readRecord(value);
  if (!record) {
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return null;
  }

  return {
    createdAt: typeof record.created_at === "number" ? record.created_at : 0,
    enabled: readBoolean(record.enabled),
    id: readString(record.id),
    instanceSlot: readString(record.instance_slot, "*") as LlmInstanceSlot,
    params: (readRecord(record.params) as LlmGenerationParams | null) ?? null,
    presetId: readNullableString(record.preset_id),
    scope: readString(record.scope, "global") as LlmInstanceScope,
    scopeId: readString(record.scope_id),
    updatedAt: typeof record.updated_at === "number" ? record.updated_at : 0,
  };
}

function mapResolvedSlot(value: unknown, errorMessage: string | null): LlmResolvedInstanceSlot | null {
  const record = readRecord(value);
  if (!record) {
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return null;
  }

  return {
    configId: readNullableString(record.config_id),
    enabled: readBoolean(record.enabled),
    params: (readRecord(record.params) as LlmGenerationParams | null) ?? null,
    presetId: readNullableString(record.preset_id),
    scope: (readNullableString(record.scope) as LlmInstanceScope | null) ?? null,
    slot: readString(record.slot, "*") as LlmInstanceSlot,
    source: readString(record.source, "default") as LlmResolvedInstanceSlot["source"],
  };
}
