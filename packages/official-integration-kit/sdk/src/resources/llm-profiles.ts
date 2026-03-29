import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import type { LlmGenerationParams, LlmInstanceScope, LlmInstanceSlot, LlmProvider, LlmProfileStatus } from "./llm-shared.js";
import { buildQueryString, compactObject, readArray, readBoolean, readNullableNumber, readNullableString, readRecord, readString } from "./utils.js";

export type LlmProfile = {
  apiKeyMasked: string;
  apiKeyName: string | null;
  baseUrl: string | null;
  createdAt: number;
  id: string;
  lastUsedAt: number | null;
  modelId: string;
  presetName: string;
  provider: LlmProvider;
  status: LlmProfileStatus;
  updatedAt: number;
};

export type LlmRuntimeSlot = {
  modelId: string;
  params: LlmGenerationParams | null;
  presetName: string | null;
  profileId: string | null;
  provider: string;
  scope: LlmInstanceScope | "global" | null;
  slot: LlmInstanceSlot;
  source: "env" | "global_profile" | "session_profile";
};

export type LlmDiscoveredModel = {
  id: string;
  label: string;
};

export type LlmModelTestResult = {
  requestText: string;
  responseText: string;
};

export type LlmProfilesResource = {
  activate(options: {
    accountId?: AccountIdHint;
    params?: LlmGenerationParams | null;
    profileId: string;
    scope: "global" | "session";
    sessionId?: string;
    slot: LlmInstanceSlot;
  }): Promise<boolean>;
  unbind(options: {
    accountId?: AccountIdHint;
    scope: "global" | "session";
    sessionId?: string;
    slot: LlmInstanceSlot;
  }): Promise<boolean>;
  create(options: {
    accountId?: AccountIdHint;
    apiKey: string;
    apiKeyName?: string;
    baseUrl?: string;
    modelId: string;
    presetName: string;
    provider: LlmProvider;
  }): Promise<LlmProfile>;
  delete(options: { accountId?: AccountIdHint; profileId: string }): Promise<boolean>;
  discoverModels(options: {
    accountId?: AccountIdHint;
    apiKey: string;
    baseUrl?: string;
    provider: LlmProvider;
  }): Promise<LlmDiscoveredModel[]>;
  getDetail(options: { accountId?: AccountIdHint; profileId: string }): Promise<LlmProfile>;
  list(options?: { accountId?: AccountIdHint }): Promise<LlmProfile[]>;
  runtime(options?: { accountId?: AccountIdHint; sessionId?: string }): Promise<LlmRuntimeSlot[]>;
  testModel(options: {
    accountId?: AccountIdHint;
    apiKey: string;
    baseUrl?: string;
    modelId: string;
    provider: LlmProvider;
  }): Promise<LlmModelTestResult>;
  update(options: {
    accountId?: AccountIdHint;
    apiKey?: string;
    apiKeyName?: string | null;
    baseUrl?: string | null;
    modelId?: string;
    presetName?: string;
    profileId: string;
    provider?: LlmProvider;
    status?: "active" | "disabled";
  }): Promise<LlmProfile>;
};

export function createLlmProfilesResource(client: TransportClient): LlmProfilesResource {
  return {
    async activate(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/llm-profiles/${encodeURIComponent(options.profileId)}/activate`, {
        body: compactObject({
          instance_slot: options.slot,
          params: options.params,
          scope: options.scope,
          session_id: options.sessionId,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.activated);
    },
    async unbind(options): Promise<boolean> {
      const query = buildQueryString({
        scope: options.scope,
        session_id: options.sessionId,
      });
      const base = `/llm-profiles/bindings/${encodeURIComponent(options.slot)}`;
      const pathname = query ? `${base}?${query}` : base;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.unbound);
    },
    async create(options): Promise<LlmProfile> {
      const response = await client.fetchJson<Record<string, unknown>>("/llm-profiles", {
        body: compactObject({
          api_key: options.apiKey,
          api_key_name: options.apiKeyName,
          base_url: options.baseUrl,
          model_id: options.modelId,
          preset_name: options.presetName,
          provider: options.provider,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapLlmProfile(readRecord(response.body)?.data, "Failed to create profile");
      if (!payload) {
        throw new Error("Failed to create profile");
      }

      return payload;
    },
    async delete(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/llm-profiles/${encodeURIComponent(options.profileId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted);
    },
    async discoverModels(options): Promise<LlmDiscoveredModel[]> {
      const response = await client.fetchJson<Record<string, unknown>>("/llm-profiles/models/discover", {
        body: compactObject({
          api_key: options.apiKey,
          base_url: options.baseUrl,
          provider: options.provider,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return readArray(readRecord(response.body)?.data)
        .map((item) => {
          const record = readRecord(item);
          const id = readString(record?.id);
          const label = readString(record?.label);
          return id && label ? { id, label } : null;
        })
        .filter((item): item is LlmDiscoveredModel => item !== null);
    },
    async getDetail(options): Promise<LlmProfile> {
      const response = await client.fetchJson<Record<string, unknown>>(`/llm-profiles/${encodeURIComponent(options.profileId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapLlmProfile(readRecord(response.body)?.data, "Failed to get profile");
      if (!payload) {
        throw new Error("Failed to get profile");
      }

      return payload;
    },
    async list(options = {}): Promise<LlmProfile[]> {
      const response = await client.fetchJson<Record<string, unknown>>("/llm-profiles", {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map((item) => mapLlmProfile(item, null))
        .filter((item): item is LlmProfile => item !== null);
    },
    async runtime(options = {}): Promise<LlmRuntimeSlot[]> {
      const query = buildQueryString({
        session_id: options.sessionId,
      });
      const pathname = query ? `/llm-profiles/runtime?${query}` : "/llm-profiles/runtime";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(readRecord(response.body)?.data)?.slots)
        .map(mapLlmRuntimeSlot)
        .filter((item): item is LlmRuntimeSlot => item !== null);
    },
    async testModel(options): Promise<LlmModelTestResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/llm-profiles/models/test", {
        body: compactObject({
          api_key: options.apiKey,
          base_url: options.baseUrl,
          model_id: options.modelId,
          provider: options.provider,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const data = readRecord(readRecord(response.body)?.data);
      const requestText = readString(data?.request_text).trim();
      const responseText = readString(data?.response_text).trim();
      if (!requestText || !responseText) {
        throw new Error("Failed to test model");
      }

      return {
        requestText,
        responseText,
      };
    },
    async update(options): Promise<LlmProfile> {
      const response = await client.fetchJson<Record<string, unknown>>(`/llm-profiles/${encodeURIComponent(options.profileId)}`, {
        body: compactObject({
          api_key: options.apiKey,
          api_key_name: options.apiKeyName,
          base_url: options.baseUrl,
          model_id: options.modelId,
          preset_name: options.presetName,
          provider: options.provider,
          status: options.status,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      const payload = mapLlmProfile(readRecord(response.body)?.data, "Failed to update profile");
      if (!payload) {
        throw new Error("Failed to update profile");
      }

      return payload;
    },
  };
}

function mapLlmProfile(value: unknown, errorMessage: string | null): LlmProfile | null {
  const record = readRecord(value);
  if (!record) {
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return null;
  }

  return {
    apiKeyMasked: readString(record.api_key_masked),
    apiKeyName: readNullableString(record.api_key_name),
    baseUrl: readNullableString(record.base_url),
    createdAt: typeof record.created_at === "number" ? record.created_at : 0,
    id: readString(record.id),
    lastUsedAt: readNullableNumber(record.last_used_at),
    modelId: readString(record.model_id),
    presetName: readString(record.preset_name),
    provider: readString(record.provider) as LlmProvider,
    status: readString(record.status) as LlmProfileStatus,
    updatedAt: typeof record.updated_at === "number" ? record.updated_at : 0,
  };
}

function mapLlmRuntimeSlot(value: unknown): LlmRuntimeSlot | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    modelId: readString(record.model_id),
    params: (readRecord(record.params) as LlmGenerationParams | null) ?? null,
    presetName: readNullableString(record.preset_name),
    profileId: readNullableString(record.profile_id),
    provider: readString(record.provider),
    scope: (readNullableString(record.scope) as LlmRuntimeSlot["scope"]) ?? null,
    slot: readString(record.slot, "*") as LlmInstanceSlot,
    source: readString(record.source, "env") as LlmRuntimeSlot["source"],
  };
}
