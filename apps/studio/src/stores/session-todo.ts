/**
 * 会话待办事项清单（Session TODO list）store（SC2-12 / #b4-9）。
 *
 * 主聊天顶部待办摘要卡的数据源。待办由「待办事项工具」在生成回合中写入，故本 store
 * 在进入 / 切换会话时加载，并在每个回合结束后按需刷新。仅经第一方薄客户端读取。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  sessionTodoApi,
  type SessionTodoListSnapshot,
} from "../lib/session-todo-api";

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const useSessionTodoStore = defineStore("session-todo", () => {
  const sessionId = ref<string | null>(null);
  const snapshot = ref<SessionTodoListSnapshot | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** 是否有可展示的待办（总数 > 0）。空清单不渲染卡片。 */
  const hasItems = computed(() => (snapshot.value?.counts.total ?? 0) > 0);

  /** 加载指定会话的待办快照。切会话时会覆盖 sessionId，避免旧响应回填串扰。 */
  async function load(targetSessionId: string): Promise<void> {
    if (!targetSessionId) {
      return;
    }
    sessionId.value = targetSessionId;
    loading.value = true;
    error.value = null;
    try {
      const next = await sessionTodoApi.get(targetSessionId);
      // 仅当仍停留在同一会话时回填，防止快速切换会话时旧请求覆盖新会话数据。
      if (sessionId.value === targetSessionId) {
        snapshot.value = next;
      }
    } catch (cause) {
      if (sessionId.value === targetSessionId) {
        error.value = toMessage(cause);
      }
    } finally {
      if (sessionId.value === targetSessionId) {
        loading.value = false;
      }
    }
  }

  /** 轻量刷新当前会话待办（回合结束后调用；无当前会话则忽略）。 */
  async function refresh(): Promise<void> {
    const id = sessionId.value;
    if (id) {
      await load(id);
    }
  }

  /** 清空状态（离开会话时调用）。 */
  function reset(): void {
    sessionId.value = null;
    snapshot.value = null;
    loading.value = false;
    error.value = null;
  }

  return {
    sessionId,
    snapshot,
    loading,
    error,
    hasItems,
    load,
    refresh,
    reset,
  };
});
