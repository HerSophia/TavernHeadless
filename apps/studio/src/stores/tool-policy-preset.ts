/**
 * 工具策略预设（Tool Policy Preset）store（SC2-10 / #b4-7）。
 *
 * 预设为项目级、后端持久：一组「哪些工具暴露给 LLM + 每个工具 auto/confirm」的命名集合。
 * 本 store 仅经第一方薄客户端读写，不旁路其他前端。
 *
 * 注意：与图助手策略一致，`confirm` 工具在执行前确认闸落地前会被后端 withheld（不暴露给 LLM）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  toolPolicyPresetApi,
  type ToolCatalogEntry,
  type ToolPolicyDecision,
  type ToolPolicyPresetConfigInput,
  type ToolPolicyPresetDetail,
  type ToolPolicyPresetSummary,
} from "../lib/tool-policy-preset-api";

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const useToolPolicyPresetStore = defineStore("tool-policy-preset", () => {
  const projectId = ref<string | null>(null);
  const toolCatalog = ref<ToolCatalogEntry[]>([]);
  const presets = ref<ToolPolicyPresetSummary[]>([]);
  const selectedKey = ref<string | null>(null);
  const detail = ref<ToolPolicyPresetDetail | null>(null);

  const loadingList = ref(false);
  const loadingDetail = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  const selectedSummary = computed(() =>
    presets.value.find((preset) => preset.preset_key === selectedKey.value) ?? null,
  );

  /** 从当前明细派生一份完整配置输入，作为局部修改的基线（保留 max_calls / allow_irreversible）。 */
  function currentConfigInput(): ToolPolicyPresetConfigInput {
    const config = detail.value?.config;
    return {
      enabled_tools: [...(config?.enabled_tools ?? [])],
      decisions: { ...(config?.decisions ?? {}) },
      ...(config?.max_calls_per_turn !== undefined
        ? { max_calls_per_turn: config.max_calls_per_turn }
        : {}),
      ...(config?.allow_irreversible !== undefined
        ? { allow_irreversible: config.allow_irreversible }
        : {}),
    };
  }

  /** 加载项目下预设列表 + 工具目录；若当前选中项缺失则回退选第一个。 */
  async function load(targetProjectId: string): Promise<void> {
    if (!targetProjectId) {
      return;
    }
    projectId.value = targetProjectId;
    loadingList.value = true;
    error.value = null;
    try {
      const response = await toolPolicyPresetApi.list(targetProjectId);
      toolCatalog.value = response.tool_catalog;
      presets.value = response.presets;
      const stillSelected =
        selectedKey.value && response.presets.some((p) => p.preset_key === selectedKey.value);
      const nextKey = stillSelected ? selectedKey.value : (response.presets[0]?.preset_key ?? null);
      if (nextKey) {
        await selectPreset(nextKey);
      } else {
        selectedKey.value = null;
        detail.value = null;
      }
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      loadingList.value = false;
    }
  }

  /** 选中并加载某个预设的明细。 */
  async function selectPreset(presetKey: string): Promise<void> {
    if (!projectId.value || !presetKey) {
      return;
    }
    selectedKey.value = presetKey;
    loadingDetail.value = true;
    error.value = null;
    try {
      detail.value = await toolPolicyPresetApi.getDetail(projectId.value, presetKey);
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      loadingDetail.value = false;
    }
  }

  /** 以给定配置更新当前选中预设；成功后用返回明细刷新，并回填列表摘要。 */
  async function updateConfig(config: ToolPolicyPresetConfigInput): Promise<void> {
    if (!projectId.value || !selectedKey.value) {
      return;
    }
    saving.value = true;
    error.value = null;
    try {
      const updated = await toolPolicyPresetApi.update(projectId.value, selectedKey.value, config);
      applyDetail(updated);
    } catch (cause) {
      error.value = toMessage(cause);
      throw cause;
    } finally {
      saving.value = false;
    }
  }

  /** 启用/停用单个工具。 */
  async function setToolEnabled(toolName: string, enabled: boolean): Promise<void> {
    const config = currentConfigInput();
    const set = new Set(config.enabled_tools ?? []);
    if (enabled) {
      set.add(toolName);
    } else {
      set.delete(toolName);
    }
    config.enabled_tools = [...set];
    await updateConfig(config);
  }

  /** 设置单个工具的决策（auto/confirm）。 */
  async function setToolDecision(toolName: string, decision: ToolPolicyDecision): Promise<void> {
    const config = currentConfigInput();
    config.decisions = { ...(config.decisions ?? {}), [toolName]: decision };
    await updateConfig(config);
  }

  /** 批量把所有「已启用」工具设为同一决策。 */
  async function setAllDecisions(decision: ToolPolicyDecision): Promise<void> {
    const config = currentConfigInput();
    const decisions: Record<string, ToolPolicyDecision> = { ...(config.decisions ?? {}) };
    for (const tool of detail.value?.tools ?? []) {
      if (tool.enabled) {
        decisions[tool.tool_name] = decision;
      }
    }
    config.decisions = decisions;
    await updateConfig(config);
  }

  /** 启用/停用某个分类下的全部工具。 */
  async function setCategoryEnabled(toolNames: string[], enabled: boolean): Promise<void> {
    const config = currentConfigInput();
    const set = new Set(config.enabled_tools ?? []);
    for (const name of toolNames) {
      if (enabled) {
        set.add(name);
      } else {
        set.delete(name);
      }
    }
    config.enabled_tools = [...set];
    await updateConfig(config);
  }

  /** 重置当前选中预设（内置 → 回 baseline；自定义 → 后端拒绝）。 */
  async function resetPreset(): Promise<void> {
    if (!projectId.value || !selectedKey.value) {
      return;
    }
    saving.value = true;
    error.value = null;
    try {
      const updated = await toolPolicyPresetApi.reset(projectId.value, selectedKey.value);
      applyDetail(updated);
    } catch (cause) {
      error.value = toMessage(cause);
      throw cause;
    } finally {
      saving.value = false;
    }
  }

  /** 新建自定义预设，成功后刷新列表并选中它。 */
  async function createCustomPreset(input: {
    presetKey: string;
    displayName: string;
    config?: ToolPolicyPresetConfigInput;
  }): Promise<void> {
    if (!projectId.value) {
      return;
    }
    saving.value = true;
    error.value = null;
    try {
      const created = await toolPolicyPresetApi.create(projectId.value, {
        preset_key: input.presetKey,
        display_name: input.displayName,
        ...(input.config ? { config: input.config } : {}),
      });
      selectedKey.value = created.preset_key;
      await load(projectId.value);
    } catch (cause) {
      error.value = toMessage(cause);
      throw cause;
    } finally {
      saving.value = false;
    }
  }

  /** 删除自定义预设，成功后刷新列表（内置 → 后端拒绝）。 */
  async function deleteCustomPreset(presetKey: string): Promise<void> {
    if (!projectId.value) {
      return;
    }
    saving.value = true;
    error.value = null;
    try {
      await toolPolicyPresetApi.remove(projectId.value, presetKey);
      if (selectedKey.value === presetKey) {
        selectedKey.value = null;
      }
      await load(projectId.value);
    } catch (cause) {
      error.value = toMessage(cause);
      throw cause;
    } finally {
      saving.value = false;
    }
  }

  /** 用一份明细刷新本地明细，并回填列表中对应摘要。 */
  function applyDetail(updated: ToolPolicyPresetDetail): void {
    detail.value = updated;
    const idx = presets.value.findIndex((p) => p.preset_key === updated.preset_key);
    const summary: ToolPolicyPresetSummary = {
      preset_key: updated.preset_key,
      kind: updated.kind,
      display_name: updated.display_name,
      customized: updated.customized,
      enabled_count: updated.enabled_count,
      auto_count: updated.auto_count,
      confirm_count: updated.confirm_count,
    };
    if (idx >= 0) {
      presets.value[idx] = summary;
    }
  }

  /** 切换后端连接 / 项目时清空状态。 */
  function reset(): void {
    projectId.value = null;
    toolCatalog.value = [];
    presets.value = [];
    selectedKey.value = null;
    detail.value = null;
    error.value = null;
  }

  return {
    projectId,
    toolCatalog,
    presets,
    selectedKey,
    detail,
    loadingList,
    loadingDetail,
    saving,
    error,
    selectedSummary,
    load,
    selectPreset,
    updateConfig,
    setToolEnabled,
    setToolDecision,
    setAllDecisions,
    setCategoryEnabled,
    resetPreset,
    createCustomPreset,
    deleteCustomPreset,
    reset,
  };
});
