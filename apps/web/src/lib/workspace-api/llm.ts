import { deleteJson, fetchJson, patchJson, postJson, putJson } from "./transport";

export type WorkspaceLlmInstanceSlot = "*" | "narrator" | "director" | "verifier" | "memory";

export type WorkspaceLlmProvider = "anthropic" | "deepseek" | "google" | "openai" | "openai-compatible" | "xai";

export type WorkspaceLlmProfileStatus = "active" | "deleted" | "disabled";

export type WorkspaceLlmProfile = {
  apiKeyMasked: string;
  apiKeyName: string | null;
  baseUrl: string | null;
  createdAt: number;
  id: string;
  lastUsedAt: number | null;
  modelId: string;
  presetName: string;
  provider: WorkspaceLlmProvider;
  status: WorkspaceLlmProfileStatus;
  updatedAt: number;
};

export type WorkspaceLlmGenerationParams = {
  frequency_penalty?: number;
  max_context_tokens?: number;
  max_output_tokens?: number;
  max_retries?: number;
  presence_penalty?: number;
  stream?: boolean;
  temperature?: number;
  timeout_ms?: number;
  top_k?: number;
  top_p?: number;
};

export type WorkspaceLlmRuntimeSlot = {
  modelId: string;
  params: WorkspaceLlmGenerationParams | null;
  presetName: string | null;
  profileId: string | null;
  provider: string;
  scope: "global" | "session" | null;
  slot: WorkspaceLlmInstanceSlot;
  source: "env" | "global_profile" | "session_profile";
};

export type WorkspaceLlmDiscoveredModel = {
  id: string;
  label: string;
};

export type WorkspaceLlmModelTestResult = {
  requestText: string;
  responseText: string;
};

type LlmProfileResponseRow = {
  api_key_masked: string;
  api_key_name: string | null;
  base_url: string | null;
  created_at: number;
  id: string;
  last_used_at: number | null;
  model_id: string;
  preset_name: string;
  provider: WorkspaceLlmProvider;
  status: WorkspaceLlmProfileStatus;
  updated_at: number;
};

type LlmProfileMutationResponse = {
  data?: LlmProfileResponseRow;
};

type LlmProfileDeleteResponse = {
  data?: {
    deleted?: boolean;
    id?: string;
  };
};

type LlmProfileListResponse = {
  data?: LlmProfileResponseRow[];
};

type LlmRuntimeResponse = {
  data?: {
    slots?: Array<{
      params: WorkspaceLlmGenerationParams | null;
      model_id: string;
      preset_name: string | null;
      profile_id: string | null;
      provider: string;
      scope: "global" | "session" | null;
      slot: WorkspaceLlmInstanceSlot;
      source: "env" | "global_profile" | "session_profile";
    }>;
  };
};

type LlmDiscoveredModelResponse = {
  id: string;
  label: string;
};

type LlmDiscoverModelsResponse = {
  data?: LlmDiscoveredModelResponse[];
};

type LlmTestModelResponse = {
  data?: {
    request_text?: string;
    response_text?: string;
  };
};

type LlmActivateResponse = {
  data?: {
    activated?: boolean;
  };
};

function toWorkspaceLlmProfile(row: LlmProfileResponseRow): WorkspaceLlmProfile {
  return {
    apiKeyMasked: row.api_key_masked,
    apiKeyName: row.api_key_name,
    baseUrl: row.base_url,
    createdAt: row.created_at,
    id: row.id,
    lastUsedAt: row.last_used_at,
    modelId: row.model_id,
    presetName: row.preset_name,
    provider: row.provider,
    status: row.status,
    updatedAt: row.updated_at
  };
}

export async function fetchLlmProfiles(accountId?: string): Promise<WorkspaceLlmProfile[]> {
  const response = await fetchJson<LlmProfileListResponse>("/llm-profiles", accountId);
  const rows = response.data ?? [];
  return rows.map(toWorkspaceLlmProfile);
}

export async function createLlmProfile(
  payload: {
    apiKey: string;
    apiKeyName?: string;
    baseUrl?: string;
    modelId: string;
    presetName: string;
    provider: WorkspaceLlmProvider;
  },
  accountId?: string
): Promise<WorkspaceLlmProfile> {
  const response = await postJson<LlmProfileMutationResponse>(
    "/llm-profiles",
    {
      api_key: payload.apiKey,
      api_key_name: payload.apiKeyName,
      base_url: payload.baseUrl,
      model_id: payload.modelId,
      preset_name: payload.presetName,
      provider: payload.provider
    },
    accountId
  );

  if (!response.data) {
    throw new Error("Failed to create profile");
  }

  return toWorkspaceLlmProfile(response.data);
}

export async function updateLlmProfile(
  profileId: string,
  payload: {
    apiKey?: string;
    apiKeyName?: string | null;
    baseUrl?: string | null;
    modelId?: string;
    presetName?: string;
    provider?: WorkspaceLlmProvider;
    status?: "active" | "disabled";
  },
  accountId?: string
): Promise<WorkspaceLlmProfile> {
  const response = await patchJson<LlmProfileMutationResponse>(
    `/llm-profiles/${encodeURIComponent(profileId)}`,
    {
      api_key: payload.apiKey,
      api_key_name: payload.apiKeyName,
      base_url: payload.baseUrl,
      model_id: payload.modelId,
      preset_name: payload.presetName,
      provider: payload.provider,
      status: payload.status
    },
    accountId
  );

  if (!response.data) {
    throw new Error("Failed to update profile");
  }

  return toWorkspaceLlmProfile(response.data);
}

export async function deleteLlmProfile(profileId: string, accountId?: string): Promise<boolean> {
  const response = await deleteJson<LlmProfileDeleteResponse>(`/llm-profiles/${encodeURIComponent(profileId)}`, accountId);
  return response.data?.deleted === true;
}

export async function discoverLlmModels(
  payload: {
    apiKey: string;
    baseUrl?: string;
    provider: WorkspaceLlmProvider;
  },
  accountId?: string
): Promise<WorkspaceLlmDiscoveredModel[]> {
  const response = await postJson<LlmDiscoverModelsResponse>(
    "/llm-profiles/models/discover",
    {
      api_key: payload.apiKey,
      base_url: payload.baseUrl,
      provider: payload.provider
    },
    accountId
  );

  const rows = response.data ?? [];
  return rows
    .filter((row): row is LlmDiscoveredModelResponse => Boolean(row?.id) && Boolean(row?.label))
    .map((row) => ({
      id: row.id,
      label: row.label
    }));
}

export async function testLlmModel(
  payload: {
    apiKey: string;
    baseUrl?: string;
    modelId: string;
    provider: WorkspaceLlmProvider;
  },
  accountId?: string
): Promise<WorkspaceLlmModelTestResult> {
  const response = await postJson<LlmTestModelResponse>(
    "/llm-profiles/models/test",
    {
      api_key: payload.apiKey,
      base_url: payload.baseUrl,
      model_id: payload.modelId,
      provider: payload.provider
    },
    accountId
  );

  const requestText = response.data?.request_text?.trim() ?? "";
  const responseText = response.data?.response_text?.trim() ?? "";
  if (!requestText || !responseText) {
    throw new Error("Failed to test model");
  }

  return {
    requestText,
    responseText
  };
}

export async function fetchLlmRuntime(sessionId: string | undefined, accountId?: string): Promise<WorkspaceLlmRuntimeSlot[]> {
  const query = new URLSearchParams();
  if (sessionId) {
    query.set("session_id", sessionId);
  }

  const pathname = query.size > 0 ? `/llm-profiles/runtime?${query.toString()}` : "/llm-profiles/runtime";
  const response = await fetchJson<LlmRuntimeResponse>(pathname, accountId);
  const rows = response.data?.slots ?? [];

  return rows.map((row) => ({
    modelId: row.model_id,
    params: row.params ?? null,
    presetName: row.preset_name,
    profileId: row.profile_id,
    provider: row.provider,
    scope: row.scope,
    slot: row.slot,
    source: row.source
  }));
}

export async function activateLlmProfileBinding(
  profileId: string,
  payload: {
    instanceSlot: WorkspaceLlmInstanceSlot;
    params?: WorkspaceLlmGenerationParams | null;
    scope: "global" | "session";
    sessionId?: string;
  },
  accountId?: string
): Promise<boolean> {
  const response = await postJson<LlmActivateResponse>(
    `/llm-profiles/${encodeURIComponent(profileId)}/activate`,
    {
      instance_slot: payload.instanceSlot,
      params: payload.params,
      scope: payload.scope,
      session_id: payload.sessionId
    },
    accountId
  );

  return response.data?.activated === true;
}


// ── LLM Instance Config types ──

export type WorkspaceLlmInstanceScope = "global" | "session";

export type WorkspaceLlmInstanceConfig = {
  id: string;
  scope: WorkspaceLlmInstanceScope;
  scopeId: string;
  instanceSlot: WorkspaceLlmInstanceSlot;
  presetId: string | null;
  enabled: boolean;
  params: WorkspaceLlmGenerationParams | null;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceLlmResolvedInstanceSlot = {
  slot: WorkspaceLlmInstanceSlot;
  source: "session_config" | "global_config" | "default";
  scope: WorkspaceLlmInstanceScope | null;
  configId: string | null;
  presetId: string | null;
  enabled: boolean;
  params: WorkspaceLlmGenerationParams | null;
};

// ── LLM Instance Config API response types ──

type LlmInstanceConfigResponseRow = {
  id: string;
  scope: WorkspaceLlmInstanceScope;
  scope_id: string;
  instance_slot: WorkspaceLlmInstanceSlot;
  preset_id: string | null;
  enabled: boolean;
  params: WorkspaceLlmGenerationParams | null;
  created_at: number;
  updated_at: number;
};

type LlmInstanceConfigListResponse = {
  data?: LlmInstanceConfigResponseRow[];
};

type LlmInstanceConfigMutationResponse = {
  data?: LlmInstanceConfigResponseRow;
};

type LlmResolvedSlotResponseRow = {
  slot: WorkspaceLlmInstanceSlot;
  source: "session_config" | "global_config" | "default";
  scope: WorkspaceLlmInstanceScope | null;
  config_id: string | null;
  preset_id: string | null;
  enabled: boolean;
  params: WorkspaceLlmGenerationParams | null;
};

type LlmResolvedResponse = {
  data?: {
    session_id: string | null;
    slots: LlmResolvedSlotResponseRow[];
  };
};

type LlmInstanceDeleteResponse = {
  data?: {
    instance_slot: string;
    scope: string;
    deleted: boolean;
  };
};

// ── LLM Instance Config conversion helpers ──

function toWorkspaceLlmInstanceConfig(row: LlmInstanceConfigResponseRow): WorkspaceLlmInstanceConfig {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scope_id,
    instanceSlot: row.instance_slot,
    presetId: row.preset_id,
    enabled: row.enabled,
    params: row.params,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWorkspaceLlmResolvedSlot(row: LlmResolvedSlotResponseRow): WorkspaceLlmResolvedInstanceSlot {
  return {
    slot: row.slot,
    source: row.source,
    scope: row.scope,
    configId: row.config_id,
    presetId: row.preset_id,
    enabled: row.enabled,
    params: row.params,
  };
}

// ── LLM Instance Config API functions ──

export async function fetchLlmInstanceConfigs(
  scope?: WorkspaceLlmInstanceScope,
  sessionId?: string,
  accountId?: string
): Promise<WorkspaceLlmInstanceConfig[]> {
  const query = new URLSearchParams();
  if (scope) query.set("scope", scope);
  if (sessionId) query.set("session_id", sessionId);

  const pathname = query.size > 0 ? `/llm-instances?${query.toString()}` : "/llm-instances";
  const response = await fetchJson<LlmInstanceConfigListResponse>(pathname, accountId);
  return (response.data ?? []).map(toWorkspaceLlmInstanceConfig);
}

export async function fetchLlmInstanceConfigsBySlot(
  slot: WorkspaceLlmInstanceSlot,
  scope?: WorkspaceLlmInstanceScope,
  sessionId?: string,
  accountId?: string
): Promise<WorkspaceLlmInstanceConfig[]> {
  const query = new URLSearchParams();
  if (scope) query.set("scope", scope);
  if (sessionId) query.set("session_id", sessionId);

  const base = `/llm-instances/${encodeURIComponent(slot)}`;
  const pathname = query.size > 0 ? `${base}?${query.toString()}` : base;
  const response = await fetchJson<LlmInstanceConfigListResponse>(pathname, accountId);
  return (response.data ?? []).map(toWorkspaceLlmInstanceConfig);
}

export async function fetchResolvedLlmInstanceConfigs(
  sessionId?: string,
  accountId?: string
): Promise<WorkspaceLlmResolvedInstanceSlot[]> {
  const query = new URLSearchParams();
  if (sessionId) query.set("session_id", sessionId);

  const pathname = query.size > 0 ? `/llm-instances/resolved?${query.toString()}` : "/llm-instances/resolved";
  const response = await fetchJson<LlmResolvedResponse>(pathname, accountId);
  return (response.data?.slots ?? []).map(toWorkspaceLlmResolvedSlot);
}

export async function upsertLlmInstanceConfig(
  slot: WorkspaceLlmInstanceSlot,
  payload: {
    scope?: WorkspaceLlmInstanceScope;
    sessionId?: string;
    presetId?: string | null;
    enabled?: boolean;
    params?: WorkspaceLlmGenerationParams | null;
  },
  accountId?: string
): Promise<WorkspaceLlmInstanceConfig> {
  const response = await putJson<LlmInstanceConfigMutationResponse>(
    `/llm-instances/${encodeURIComponent(slot)}`,
    {
      scope: payload.scope,
      session_id: payload.sessionId,
      preset_id: payload.presetId,
      enabled: payload.enabled,
      params: payload.params,
    },
    accountId
  );

  if (!response.data) {
    throw new Error("Failed to upsert instance config");
  }

  return toWorkspaceLlmInstanceConfig(response.data);
}

export async function deleteLlmInstanceConfig(
  slot: WorkspaceLlmInstanceSlot,
  scope?: WorkspaceLlmInstanceScope,
  sessionId?: string,
  accountId?: string
): Promise<boolean> {
  const query = new URLSearchParams();
  if (scope) query.set("scope", scope);
  if (sessionId) query.set("session_id", sessionId);

  const base = `/llm-instances/${encodeURIComponent(slot)}`;
  const pathname = query.size > 0 ? `${base}?${query.toString()}` : base;
  const response = await deleteJson<LlmInstanceDeleteResponse>(pathname, accountId);
  return response.data?.deleted === true;
}
