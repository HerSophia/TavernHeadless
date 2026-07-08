import { defineStore } from "pinia";
import { ref } from "vue";

import {
  chatApi,
  type SessionsBatchDeleteResult,
  type SessionsBatchUpdateStatusResult,
  type SessionStatus,
} from "../lib/chat";
import { apiClient } from "../lib/sdk";

/** 从 SDK 方法返回值派生条目类型，避免依赖 SDK 具名类型导出。 */
type ProjectItem = Awaited<ReturnType<typeof apiClient.projects.list>>["items"][number];
type SessionItem = Awaited<ReturnType<typeof apiClient.projects.listSessions>>["items"][number];

/** 会话列表的状态过滤：active / archived 直传后端，all 表示不传 status。 */
export type SessionStatusFilter = "active" | "archived" | "all";

/** 批量生命周期操作的结果，供 UI 轻量提示（更新 N / 删除 N / 未找到 M）。 */
export type SessionBatchResult =
  | { kind: "status"; meta: SessionsBatchUpdateStatusResult["meta"] }
  | { kind: "delete"; meta: SessionsBatchDeleteResult["meta"] };

/**
 * 跨模块共享的 project / session 上下文（Graph 与 Chat 共用）。
 * v0：projects 经 `@tavern/sdk` 加载；NodeGraph / 聊天均在选定 project（及 session）作用域内操作。
 *
 * SC1-1：会话列表接入状态过滤 + 游标分页；选择模型收口为“显式空选优先”，
 * 不再在加载会话后自动选中第一个，也不因刷新/分页误清空当前选择。
 */
export const useContextStore = defineStore("context", () => {
  const projects = ref<ProjectItem[]>([]);
  const sessions = ref<SessionItem[]>([]);
  const currentProjectId = ref<string | null>(null);
  const currentSessionId = ref<string | null>(null);
  const loadingProjects = ref(false);
  const loadingSessions = ref(false);
  const error = ref<string | null>(null);

  // —— SC1-1：会话列表过滤 / 游标分页状态 ——
  const sessionStatusFilter = ref<SessionStatusFilter>("active");
  /** 下一页游标（= 上次 listSessions 返回的 nextCursor）。 */
  const sessionCursor = ref<string | null>(null);
  /** 是否还有下一页（nextCursor 非空）。 */
  const sessionsHasMore = ref(false);
  /** “加载更多”进行中标志（与首屏 loadingSessions 区分）。 */
  const loadingMoreSessions = ref(false);

  // —— SC1-2：会话生命周期写操作状态 ——
  /** 改名 / 删除 / 归档 / 批量等写操作进行中。 */
  const mutating = ref(false);
  /** 最近一次批量操作结果（供 UI 轻量提示；由 UI 消费后可清空）。 */
  const lastBatchResult = ref<SessionBatchResult | null>(null);

  /** 依据当前过滤把 all 归一为 undefined（不传 status），其余原样传后端。 */
  function currentStatusParam(): "active" | "archived" | undefined {
    return sessionStatusFilter.value === "all" ? undefined : sessionStatusFilter.value;
  }

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

  /**
   * 加载会话列表首页。
   * - 按 `sessionStatusFilter` 传 status（all 时不传）；
   * - 写入 sessions 与游标状态；
   * - 不自动选中、也不因“当前选中项不在新列表”而清空（选择与列表解耦）。
   */
  async function loadSessions(projectId: string): Promise<void> {
    loadingSessions.value = true;
    error.value = null;
    try {
      const result = await apiClient.projects.listSessions({
        projectId,
        status: currentStatusParam(),
      });
      sessions.value = result.items;
      sessionCursor.value = result.nextCursor;
      sessionsHasMore.value = result.nextCursor != null;
    } catch (cause) {
      sessions.value = [];
      sessionCursor.value = null;
      sessionsHasMore.value = false;
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loadingSessions.value = false;
    }
  }

  /** 追加加载下一页会话（游标分页）。无更多或加载中时不发起请求。 */
  async function loadMoreSessions(): Promise<void> {
    const projectId = currentProjectId.value;
    const cursor = sessionCursor.value;
    if (!projectId || !sessionsHasMore.value || !cursor || loadingMoreSessions.value) {
      return;
    }
    loadingMoreSessions.value = true;
    error.value = null;
    try {
      const result = await apiClient.projects.listSessions({
        projectId,
        status: currentStatusParam(),
        cursor,
      });
      sessions.value = [...sessions.value, ...result.items];
      sessionCursor.value = result.nextCursor;
      sessionsHasMore.value = result.nextCursor != null;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loadingMoreSessions.value = false;
    }
  }

  /** 切换会话状态过滤：重置游标后重新加载首页。不改动当前选择。 */
  async function setSessionStatusFilter(next: SessionStatusFilter): Promise<void> {
    if (sessionStatusFilter.value === next) {
      return;
    }
    sessionStatusFilter.value = next;
    sessionCursor.value = null;
    sessionsHasMore.value = false;
    if (currentProjectId.value) {
      await loadSessions(currentProjectId.value);
    }
  }

  async function selectProject(projectId: string): Promise<void> {
    if (!projectId) {
      return;
    }
    currentProjectId.value = projectId;
    // 切项目：显式清空当前会话选择，回到空态，由用户显式选择或新建。
    currentSessionId.value = null;
    await loadSessions(projectId);
  }

  function selectSession(sessionId: string): void {
    currentSessionId.value = sessionId || null;
  }

  function toMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }

  /** 统一读取本次失败前的列表快照（供乐观回滚）。 */
  function findSessionIndex(sessionId: string): number {
    return sessions.value.findIndex((session) => session.id === sessionId);
  }

  /**
   * 根据当前过滤将某会话的新状态反映到可见列表：
   * - 新状态仍在当前过滤范围内（或 all）：就地更新徒标；
   * - 否则：从可见列表移除；若命中当前选中则清空选择。
   */
  function applyStatusChange(sessionId: string, status: SessionStatus): void {
    const idx = findSessionIndex(sessionId);
    if (idx < 0) {
      return;
    }
    const stillVisible = sessionStatusFilter.value === "all" || sessionStatusFilter.value === status;
    if (stillVisible) {
      sessions.value[idx] = { ...sessions.value[idx]!, status };
    } else {
      sessions.value = sessions.value.filter((session) => session.id !== sessionId);
      if (currentSessionId.value === sessionId) {
        currentSessionId.value = null;
      }
    }
  }

  /** 改名：乐观就地更新，成功以返回 title 为准回填，失败回滚并回显错误。 */
  async function renameSession(sessionId: string, title: string): Promise<void> {
    const idx = findSessionIndex(sessionId);
    const previousTitle = idx >= 0 ? sessions.value[idx]!.title : null;
    if (idx >= 0) {
      sessions.value[idx] = { ...sessions.value[idx]!, title };
    }
    mutating.value = true;
    error.value = null;
    try {
      const record = await chatApi.renameSession(sessionId, title);
      const current = findSessionIndex(sessionId);
      if (current >= 0) {
        sessions.value[current] = { ...sessions.value[current]!, title: record.title };
      }
    } catch (cause) {
      const current = findSessionIndex(sessionId);
      if (current >= 0) {
        sessions.value[current] = { ...sessions.value[current]!, title: previousTitle };
      }
      error.value = toMessage(cause);
    } finally {
      mutating.value = false;
    }
  }

  async function setSessionStatusOne(sessionId: string, status: SessionStatus): Promise<void> {
    mutating.value = true;
    error.value = null;
    try {
      await chatApi.setSessionStatus(sessionId, status);
      applyStatusChange(sessionId, status);
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      mutating.value = false;
    }
  }

  /** 归档单个会话。 */
  function archiveSession(sessionId: string): Promise<void> {
    return setSessionStatusOne(sessionId, "archived");
  }

  /** 取消归档单个会话。 */
  function unarchiveSession(sessionId: string): Promise<void> {
    return setSessionStatusOne(sessionId, "active");
  }

  /** 删除单个会话：成功后从列表移除；若命中当前选中则清空选择。 */
  async function deleteSession(sessionId: string): Promise<void> {
    mutating.value = true;
    error.value = null;
    try {
      await chatApi.deleteSession(sessionId);
      sessions.value = sessions.value.filter((session) => session.id !== sessionId);
      if (currentSessionId.value === sessionId) {
        currentSessionId.value = null;
      }
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      mutating.value = false;
    }
  }

  async function batchSetStatus(ids: string[], status: SessionStatus): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    mutating.value = true;
    error.value = null;
    try {
      const result = await chatApi.batchSetSessionStatus(ids, status);
      lastBatchResult.value = { kind: "status", meta: result.meta };
      // 成功后刷新列表对齐后端；选择回退不依赖分页可见性，而按过滤语义判定。
      if (currentProjectId.value) {
        await loadSessions(currentProjectId.value);
      }
      const current = currentSessionId.value;
      const stillVisible =
        sessionStatusFilter.value === "all" || sessionStatusFilter.value === status;
      if (current && ids.includes(current) && !stillVisible) {
        currentSessionId.value = null;
      }
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      mutating.value = false;
    }
  }

  /** 批量归档。 */
  function batchArchive(ids: string[]): Promise<void> {
    return batchSetStatus(ids, "archived");
  }

  /** 批量取消归档。 */
  function batchUnarchive(ids: string[]): Promise<void> {
    return batchSetStatus(ids, "active");
  }

  /** 批量删除：刷新列表并清理被删中的当前选择。 */
  async function batchDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    mutating.value = true;
    error.value = null;
    try {
      const result = await chatApi.batchDeleteSessions(ids);
      lastBatchResult.value = { kind: "delete", meta: result.meta };
      if (currentProjectId.value) {
        await loadSessions(currentProjectId.value);
      }
      const current = currentSessionId.value;
      if (current && ids.includes(current)) {
        currentSessionId.value = null;
      }
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      mutating.value = false;
    }
  }

  /** 清空最近一次批量结果提示。 */
  function clearLastBatchResult(): void {
    lastBatchResult.value = null;
  }

  /** 清空上下文（切换后端连接后调用，丢弃旧后端的 project/session 选择与列表分页状态）。 */
  function reset(): void {
    projects.value = [];
    sessions.value = [];
    currentProjectId.value = null;
    currentSessionId.value = null;
    error.value = null;
    sessionStatusFilter.value = "active";
    sessionCursor.value = null;
    sessionsHasMore.value = false;
    loadingMoreSessions.value = false;
    mutating.value = false;
    lastBatchResult.value = null;
  }

  return {
    projects,
    sessions,
    currentProjectId,
    currentSessionId,
    loadingProjects,
    loadingSessions,
    error,
    sessionStatusFilter,
    sessionCursor,
    sessionsHasMore,
    loadingMoreSessions,
    mutating,
    lastBatchResult,
    loadProjects,
    loadSessions,
    loadMoreSessions,
    setSessionStatusFilter,
    selectProject,
    selectSession,
    renameSession,
    archiveSession,
    unarchiveSession,
    deleteSession,
    batchArchive,
    batchUnarchive,
    batchDelete,
    clearLastBatchResult,
    reset,
  };
});
