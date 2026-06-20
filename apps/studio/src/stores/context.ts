import { defineStore } from "pinia";
import { ref } from "vue";

import { apiClient } from "../lib/sdk";

/** 从 SDK 方法返回值派生条目类型，避免依赖 SDK 具名类型导出。 */
type ProjectItem = Awaited<ReturnType<typeof apiClient.projects.list>>["items"][number];
type SessionItem = Awaited<ReturnType<typeof apiClient.projects.listSessions>>["items"][number];

/**
 * 跨模块共享的 project / session 上下文（Graph 与 Chat 共用）。
 * v0：projects 经 `@tavern/sdk` 加载；NodeGraph / 聊天均在选定 project（及 session）作用域内操作。
 */
export const useContextStore = defineStore("context", () => {
  const projects = ref<ProjectItem[]>([]);
  const sessions = ref<SessionItem[]>([]);
  const currentProjectId = ref<string | null>(null);
  const currentSessionId = ref<string | null>(null);
  const loadingProjects = ref(false);
  const loadingSessions = ref(false);
  const error = ref<string | null>(null);

  async function loadProjects(): Promise<void> {
    loadingProjects.value = true;
    error.value = null;
    try {
      const result = await apiClient.projects.list();
      projects.value = result.items;
      if (!currentProjectId.value && result.items.length > 0) {
        await selectProject(result.items[0]!.id);
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loadingProjects.value = false;
    }
  }

  async function loadSessions(projectId: string): Promise<void> {
    loadingSessions.value = true;
    try {
      const result = await apiClient.projects.listSessions({ projectId });
      sessions.value = result.items;
      currentSessionId.value = result.items.length > 0 ? result.items[0]!.id : null;
    } catch {
      sessions.value = [];
      currentSessionId.value = null;
    } finally {
      loadingSessions.value = false;
    }
  }

  async function selectProject(projectId: string): Promise<void> {
    if (!projectId) {
      return;
    }
    currentProjectId.value = projectId;
    currentSessionId.value = null;
    await loadSessions(projectId);
  }

  function selectSession(sessionId: string): void {
    currentSessionId.value = sessionId || null;
  }

  return {
    projects,
    sessions,
    currentProjectId,
    currentSessionId,
    loadingProjects,
    loadingSessions,
    error,
    loadProjects,
    loadSessions,
    selectProject,
    selectSession,
  };
});
