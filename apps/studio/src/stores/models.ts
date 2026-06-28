/**
 * 模型档案 + LLM 实例 store（LLM10 / 阶段 B）。
 *
 * 模型档案（LlmProfile）为 account 作用域；LLM 实例（槽位绑定）分 global / session 作用域。
 * 仅依赖 `lib/models` 薄封装，便于纯单测。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  llmInstancesApi,
  type LlmInstanceConfig,
  type LlmInstanceScope,
  type LlmInstanceSlot,
  type LlmInstanceUpsertInput,
  type LlmResolvedInstanceSlot,
} from "../lib/models/instances";
import {
  modelProfilesApi,
  type LlmProfile,
  type LlmRuntimeSlot,
  type ModelProfileCreateInput,
  type ModelProfileUpdateInput,
} from "../lib/models/profiles";

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const useModelsStore = defineStore("models", () => {
  const profiles = ref<LlmProfile[]>([]);
  const instances = ref<LlmInstanceConfig[]>([]);
  const resolved = ref<LlmResolvedInstanceSlot[]>([]);
  const runtime = ref<LlmRuntimeSlot[]>([]);
  const loadingProfiles = ref(false);
  const loadingInstances = ref(false);
  const loadingRuntime = ref(false);
  const error = ref<string | null>(null);

  /**
   * 当前全局默认模型档案 id：取运行时中来源为 global_profile 的槽位。
   * 全局选用是绑定到通配槽位 `"*"`，未单独覆盖的角色槽位会解析到同一档案。
   */
  const activeProfileId = computed<string | null>(() => {
    const slot = runtime.value.find((item) => item.source === "global_profile" && item.profileId);
    return slot?.profileId ?? null;
  });

  async function loadProfiles(): Promise<void> {
    loadingProfiles.value = true;
    error.value = null;
    try {
      profiles.value = await modelProfilesApi.list();
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      loadingProfiles.value = false;
    }
  }

  async function createProfile(input: ModelProfileCreateInput): Promise<LlmProfile> {
    const profile = await modelProfilesApi.create(input);
    await loadProfiles();
    return profile;
  }

  async function updateProfile(input: ModelProfileUpdateInput): Promise<LlmProfile> {
    const profile = await modelProfilesApi.update(input);
    await loadProfiles();
    return profile;
  }

  async function deleteProfile(profileId: string): Promise<void> {
    await modelProfilesApi.remove(profileId);
    await loadProfiles();
  }

  async function loadRuntime(sessionId?: string): Promise<void> {
    loadingRuntime.value = true;
    error.value = null;
    try {
      runtime.value = await modelProfilesApi.runtime(sessionId);
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      loadingRuntime.value = false;
    }
  }

  /** 选用某档案为全局默认模型，随后刷新运行时绑定。 */
  async function activateProfile(profileId: string): Promise<void> {
    await modelProfilesApi.activate(profileId);
    await loadRuntime();
  }

  async function loadInstances(sessionId?: string): Promise<void> {
    loadingInstances.value = true;
    error.value = null;
    try {
      const globalConfigs = await llmInstancesApi.list("global");
      const sessionConfigs = sessionId ? await llmInstancesApi.list("session", sessionId) : [];
      instances.value = [...globalConfigs, ...sessionConfigs];
      resolved.value = await llmInstancesApi.listResolved(sessionId);
      // LI11：Profile（模型档案）解析走 profile binding（runtime），与实例侧 resolved 一并拉取，
      // 供面板把「实例配置」与「Profile 绑定」两侧合并展示，杜绝把 preset_id 当 Profile id 的命名坑。
      runtime.value = await modelProfilesApi.runtime(sessionId);
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      loadingInstances.value = false;
    }
  }

  /** LI11：把模型档案绑定到角色槽位（profile binding），随后刷新运行时解析。 */
  async function bindSlotProfile(
    input: { profileId: string; slot: LlmInstanceSlot; scope: LlmInstanceScope; sessionId?: string },
    refreshSessionId?: string,
  ): Promise<void> {
    await modelProfilesApi.bindSlot(input);
    runtime.value = await modelProfilesApi.runtime(refreshSessionId);
  }

  /** LI11：解除角色槽位在某作用域的 Profile 绑定，随后刷新运行时解析。 */
  async function unbindSlotProfile(
    input: { slot: LlmInstanceSlot; scope: LlmInstanceScope; sessionId?: string },
    refreshSessionId?: string,
  ): Promise<void> {
    await modelProfilesApi.unbindSlot(input);
    runtime.value = await modelProfilesApi.runtime(refreshSessionId);
  }

  function findInstance(slot: LlmInstanceSlot, scope: LlmInstanceScope): LlmInstanceConfig | null {
    return instances.value.find((item) => item.instanceSlot === slot && item.scope === scope) ?? null;
  }

  async function upsertInstance(input: LlmInstanceUpsertInput, refreshSessionId?: string): Promise<LlmInstanceConfig> {
    const result = await llmInstancesApi.upsert(input);
    await loadInstances(refreshSessionId);
    return result;
  }

  async function removeInstance(
    slot: LlmInstanceSlot,
    scope: LlmInstanceScope,
    sessionId?: string,
    refreshSessionId?: string,
  ): Promise<void> {
    await llmInstancesApi.remove({ slot, scope, sessionId });
    await loadInstances(refreshSessionId);
  }

  return {
    profiles,
    instances,
    resolved,
    runtime,
    loadingProfiles,
    loadingInstances,
    loadingRuntime,
    error,
    activeProfileId,
    loadProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    loadRuntime,
    activateProfile,
    loadInstances,
    findInstance,
    upsertInstance,
    removeInstance,
    bindSlotProfile,
    unbindSlotProfile,
  };
});
