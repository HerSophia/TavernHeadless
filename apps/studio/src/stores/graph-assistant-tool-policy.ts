/**
 * 图助手逐工具「自动执行 / 需要确认」策略 store（阶段 2）。
 *
 * 策略为项目级、后端持久。本 store 仅经第一方薄客户端读写，不旁路其他前端。
 * 注意：阶段 3 执行前确认闸落地前，`confirm` 工具会被后端完全 withheld（不暴露给 LLM）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  graphAssistantToolPolicyApi,
  type GraphAssistantToolDecision,
  type GraphAssistantToolPolicyItem,
} from "../lib/graph-assistant-tool-policy-api";

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const useGraphAssistantToolPolicyStore = defineStore("graph-assistant-tool-policy", () => {
  const items = ref<GraphAssistantToolPolicyItem[]>([]);
  const projectId = ref<string | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  /** effective 决策为`auto`（即会暴露给 LLM）的工具数量。 */
  const autoCount = computed(() => items.value.filter((item) => item.decision === "auto").length);
  /** effective 决策为 `confirm`（当前阶段被 withheld）的工具数量。 */
  const confirmCount = computed(() => items.value.filter((item) => item.decision === "confirm").length);

  async function load(targetProjectId: string): Promise<void> {
    if (!targetProjectId) {
      return;
    }
    projectId.value = targetProjectId;
    loading.value = true;
    error.value = null;
    try {
      const response = await graphAssistantToolPolicyApi.get(targetProjectId);
      items.value = response.items;
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  /** 批量更新逐工具策略；成功后用返回的 effective 列表刷新本地状态。 */
  async function update(
    updates: Array<{ toolName: string; decision: GraphAssistantToolDecision }>,
  ): Promise<void> {
    if (!projectId.value || updates.length === 0) {
      return;
    }
    saving.value = true;
    error.value = null;
    try {
      const response = await graphAssistantToolPolicyApi.update(
        projectId.value,
        updates.map((entry) => ({ tool_name:entry.toolName, decision: entry.decision })),
      );
      items.value = response.items;
    } catch (cause) {
      error.value = toMessage(cause);
      throw cause;
    } finally {
      saving.value = false;
    }
  }

  /** 设置单个工具的决策。 */
  async function setDecision(toolName: string, decision: GraphAssistantToolDecision): Promise<void> {
    await update([{ toolName, decision }]);
  }

  /** 把当前目录中所有工具设为同一决策。 */
  async function setAll(decision: GraphAssistantToolDecision): Promise<void> {
    await update(items.value.map((item) => ({ toolName: item.tool_name, decision })));
  }

  /** 重置为默认：把所有工具显式写回其 default_decision。 */
  async function resetToDefault(): Promise<void> {
    await update(items.value.map((item) => ({ toolName: item.tool_name, decision: item.default_decision })));
  }

  return {
    items,
    projectId,
    loading,
    saving,
    error,
    autoCount,
    confirmCount,
    load,
    update,
    setDecision,
    setAll,
    resetToDefault,
  };
});
