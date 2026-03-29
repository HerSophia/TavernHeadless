import { apiClient } from "../api";

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

export async function fetchLlmProfiles(accountId?: string): Promise<WorkspaceLlmProfile[]> {
  return apiClient.llmProfiles.list({ accountId });
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
  return apiClient.llmProfiles.create({
    accountId,
    apiKey: payload.apiKey,
    apiKeyName: payload.apiKeyName,
    baseUrl: payload.baseUrl,
    modelId: payload.modelId,
    presetName: payload.presetName,
    provider: payload.provider
  });
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
  return apiClient.llmProfiles.update({
    accountId,
    apiKey: payload.apiKey,
    apiKeyName: payload.apiKeyName,
    baseUrl: payload.baseUrl,
    modelId: payload.modelId,
    presetName: payload.presetName,
    profileId,
    provider: payload.provider,
    status: payload.status
  });
}

export async function deleteLlmProfile(profileId: string, accountId?: string): Promise<boolean> {
  return apiClient.llmProfiles.delete({
    accountId,
    profileId
  });
}

export async function discoverLlmModels(
  payload: {
    apiKey: string;
    baseUrl?: string;
    provider: WorkspaceLlmProvider;
  },
  accountId?: string
): Promise<WorkspaceLlmDiscoveredModel[]> {
  return apiClient.llmProfiles.discoverModels({
    accountId,
    apiKey: payload.apiKey,
    baseUrl: payload.baseUrl,
    provider: payload.provider
  });
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
  return apiClient.llmProfiles.testModel({
    accountId,
    apiKey: payload.apiKey,
    baseUrl: payload.baseUrl,
    modelId: payload.modelId,
    provider: payload.provider
  });
}

export async function fetchLlmRuntime(sessionId: string | undefined, accountId?: string): Promise<WorkspaceLlmRuntimeSlot[]> {
  return apiClient.llmProfiles.runtime({
    accountId,
    sessionId
  });
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
  return apiClient.llmProfiles.activate({
    accountId,
    params: payload.params,
    profileId,
    scope: payload.scope,
    sessionId: payload.sessionId,
    slot: payload.instanceSlot
  });
}

export async function unbindLlmProfileBinding(
  slot: WorkspaceLlmInstanceSlot,
  payload: {
    scope: "global" | "session";
    sessionId?: string;
  },
  accountId?: string
): Promise<boolean> {
  return apiClient.llmProfiles.unbind({
    accountId,
    scope: payload.scope,
    sessionId: payload.sessionId,
    slot,
  });
}

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

export async function fetchLlmInstanceConfigs(
  scope?: WorkspaceLlmInstanceScope,
  sessionId?: string,
  accountId?: string
): Promise<WorkspaceLlmInstanceConfig[]> {
  return apiClient.llmInstances.list({
    accountId,
    scope,
    sessionId
  });
}

export async function fetchLlmInstanceConfigsBySlot(
  slot: WorkspaceLlmInstanceSlot,
  scope?: WorkspaceLlmInstanceScope,
  sessionId?: string,
  accountId?: string
): Promise<WorkspaceLlmInstanceConfig[]> {
  return apiClient.llmInstances.listBySlot({
    accountId,
    scope,
    sessionId,
    slot
  });
}

export async function fetchResolvedLlmInstanceConfigs(
  sessionId?: string,
  accountId?: string
): Promise<WorkspaceLlmResolvedInstanceSlot[]> {
  return apiClient.llmInstances.listResolved({
    accountId,
    sessionId
  });
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
  return apiClient.llmInstances.upsert({
    accountId,
    enabled: payload.enabled,
    params: payload.params,
    presetId: payload.presetId,
    scope: payload.scope,
    sessionId: payload.sessionId,
    slot
  });
}

export async function deleteLlmInstanceConfig(
  slot: WorkspaceLlmInstanceSlot,
  scope?: WorkspaceLlmInstanceScope,
  sessionId?: string,
  accountId?: string
): Promise<boolean> {
  return apiClient.llmInstances.remove({
    accountId,
    scope,
    sessionId,
    slot
  });
}
