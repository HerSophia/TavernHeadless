/**
 * 模型档案（LLM Profile）SDK 薄封装（LLM10 / 阶段 B）。
 *
 * 「模型档案」= 一个可用大模型的配置容器：供应商(provider) + 端点(baseUrl) + 密钥(apiKey) + 模型(modelId) + 名称。
 * 走公共 `@tavern/sdk` `llmProfiles`，account 作用域；鉴权与 baseUrl 随当前后端连接（ENG10）由全局 getHeaders 注入。
 */
import type {
  LlmDiscoveredModel,
  LlmInstanceScope,
  LlmInstanceSlot,
  LlmModelTestResult,
  LlmProfile,
  LlmProvider,
  LlmRuntimeSlot,
} from "@tavern/sdk";

import { apiClient } from "../sdk";

export type { LlmDiscoveredModel, LlmModelTestResult, LlmProfile, LlmProvider, LlmRuntimeSlot } from "@tavern/sdk";

/** 受支持的供应商类型（模型档案内的 `provider` 字段值）。 */
export const LLM_PROVIDERS: readonly LlmProvider[] = [
  "openai",
  "openai-compatible",
  "anthropic",
  "google",
  "deepseek",
  "xai",
];

export interface ModelProfileCreateInput {
  provider: LlmProvider;
  presetName: string;
  modelId: string;
  apiKey: string;
  apiKeyName?: string;
  baseUrl?: string;
}

export interface ModelProfileUpdateInput {
  profileId: string;
  provider?: LlmProvider;
  presetName?: string;
  modelId?: string;
  apiKey?: string;
  apiKeyName?: string | null;
  baseUrl?: string | null;
  status?: "active" | "disabled";
}

export const modelProfilesApi = {
  list(): Promise<LlmProfile[]> {
    return apiClient.llmProfiles.list({});
  },
  create(input: ModelProfileCreateInput): Promise<LlmProfile> {
    return apiClient.llmProfiles.create(input);
  },
  update(input: ModelProfileUpdateInput): Promise<LlmProfile> {
    return apiClient.llmProfiles.update(input);
  },
  remove(profileId: string): Promise<boolean> {
    return apiClient.llmProfiles.delete({ profileId });
  },
  // 传 apiKey 走明文凭证；只传 profileId 则复用已保存档案的密钥（编辑已有档案时无需重输 key）。
  discoverModels(input: { provider?: LlmProvider; apiKey?: string; baseUrl?: string; profileId?: string }): Promise<LlmDiscoveredModel[]> {
    return apiClient.llmProfiles.discoverModels(input);
  },
  testModel(input: { provider?: LlmProvider; apiKey?: string; baseUrl?: string; modelId?: string; profileId?: string }): Promise<LlmModelTestResult> {
    return apiClient.llmProfiles.testModel(input);
  },
  /**
   * 选用某档案为全局默认模型：绑定到通配槽位 `"*"`（global 作用域）。
   * 未被各角色槽位单独覆盖时，都会回落到这个默认档案。
   */
  activate(profileId: string): Promise<boolean> {
    return apiClient.llmProfiles.activate({ profileId, scope: "global", slot: "*" });
  },
  /**
   * LI11：把某模型档案绑定到指定角色槽位（profile binding）——这是 studio 选 Profile 的**唯一正路**，
   * 取代旧的「把 Profile id 写进实例 preset_id」误用。`scope=session` 时需传 `sessionId`。
   */
  bindSlot(input: {
    profileId: string;
    slot: LlmInstanceSlot;
    scope: LlmInstanceScope;
    sessionId?: string;
  }): Promise<boolean> {
    return apiClient.llmProfiles.activate({
      profileId: input.profileId,
      slot: input.slot,
      scope: input.scope,
      sessionId: input.scope === "session" ? input.sessionId : undefined,
    });
  },
  /** LI11：解除某角色槽位在指定作用域的 Profile 绑定（编辑器选「无档案」时使用）。 */
  unbindSlot(input: { slot: LlmInstanceSlot; scope: LlmInstanceScope; sessionId?: string }): Promise<boolean> {
    return apiClient.llmProfiles.unbind({
      slot: input.slot,
      scope: input.scope,
      sessionId: input.scope === "session" ? input.sessionId : undefined,
    });
  },
  /** 读取各角色槽位当前实际生效的运行时绑定（含来源：env / global_profile / session_profile）。 */
  runtime(sessionId?: string): Promise<LlmRuntimeSlot[]> {
    return apiClient.llmProfiles.runtime({ sessionId });
  },
};
