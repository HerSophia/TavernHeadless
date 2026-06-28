/**
 * LLM 实例（角色槽位绑定）SDK 薄封装（LLM10 / 阶段 B）。
 *
 * 「LLM 实例」= 把模型档案绑定到 narrator/director/verifier/memory 槽位 + 生成参数 + 能力声明，
 * 区分 global / session 作用域。走公共 `@tavern/sdk` `llmInstances`。
 */
import type {
  LlmGenerationParams,
  LlmInstanceCapabilities,
  LlmInstanceConfig,
  LlmInstanceScope,
  LlmInstanceSlot,
  LlmResolvedInstanceSlot,
} from "@tavern/sdk";

import { apiClient } from "../sdk";

export type {
  LlmGenerationParams,
  LlmInstanceCapabilities,
  LlmInstanceConfig,
  LlmInstanceScope,
  LlmInstanceSlot,
  LlmResolvedInstanceSlot,
} from "@tavern/sdk";

/** 角色槽位顺序（通配 `*` 不在 UI 直接编辑）。 */
export const LLM_INSTANCE_SLOTS: readonly Exclude<LlmInstanceSlot, "*">[] = [
  "narrator",
  "director",
  "verifier",
  "memory",
];

export interface LlmInstanceUpsertInput {
  slot: LlmInstanceSlot;
  scope: LlmInstanceScope;
  sessionId?: string;
  /**
   * LI11：提示词预设覆盖（非 Profile id；过渡字段）。studio **不再**从实例编辑器写它来选 Profile——
   * 选 Profile 走 profile binding（见 `modelProfilesApi.bindSlot` / `runtime`）。保留仅为后端兼容。
   */
  presetId?: string | null;
  modelIdOverride?: string | null;
  enabled?: boolean;
  params?: LlmGenerationParams | null;
  capabilities?: LlmInstanceCapabilities | null;
}

export const llmInstancesApi = {
  list(scope: LlmInstanceScope, sessionId?: string): Promise<LlmInstanceConfig[]> {
    return apiClient.llmInstances.list({ scope, sessionId });
  },
  listResolved(sessionId?: string): Promise<LlmResolvedInstanceSlot[]> {
    return apiClient.llmInstances.listResolved({ sessionId });
  },
  upsert(input: LlmInstanceUpsertInput): Promise<LlmInstanceConfig> {
    return apiClient.llmInstances.upsert(input);
  },
  remove(input: { slot: LlmInstanceSlot; scope: LlmInstanceScope; sessionId?: string }): Promise<boolean> {
    return apiClient.llmInstances.remove(input);
  },
};
