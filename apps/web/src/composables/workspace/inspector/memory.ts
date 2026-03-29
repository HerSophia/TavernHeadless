import type {
  MemoryJobRecord,
  MemoryJobsResource,
  MemoryRecord,
  MemoriesResource,
  MemoryScopeStateRecord,
  MemoryScopesResource,
  MemoryStats,
} from "@tavern/sdk";
import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from "vue";

import { apiBaseUrl, apiClient } from "../../../lib/api";

type MemoriesResourceLike = Pick<MemoriesResource, "getStats" | "list">;
type MemoryJobsResourceLike = Pick<MemoryJobsResource, "list">;
type MemoryScopesResourceLike = Pick<MemoryScopesResource, "list">;

type WorkspaceInspectorWebSocketLike = {
  close: (code?: number, reason?: string) => void;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onopen: ((event: unknown) => void) | null;
  readyState: number;
};

type WorkspaceInspectorWebSocketFactory = (url: string) => WorkspaceInspectorWebSocketLike;

type WorkspaceInspectorWsMessage = {
  data?: unknown;
  event?: string;
  timestamp?: number;
  type?: string;
};

type UseWorkspaceInspectorMemoryOptions = {
  accountId: MaybeRefOrGetter<string>;
  memoriesResource?: MemoriesResourceLike;
  memoryJobsResource?: MemoryJobsResourceLike;
  memoryScopesResource?: MemoryScopesResourceLike;
  sessionId: MaybeRefOrGetter<string | null | undefined>;
  webSocketFactory?: WorkspaceInspectorWebSocketFactory | null;
  webSocketUrlResolver?: (sessionId: string) => string | null;
};

type ResolvedTarget = {
  accountId: string;
  sessionId: string;
};

type MemoryInspectorSnapshot = {
  items: MemoryRecord[];
  jobs: MemoryJobRecord[];
  scopeState: MemoryScopeStateRecord | null;
  stats: MemoryStats;
};

type UseWorkspaceInspectorMemoryResult = {
  error: Ref<string | null>;
  items: Ref<MemoryRecord[]>;
  jobs: Ref<MemoryJobRecord[]>;
  loading: Ref<boolean>;
  refresh: (force?: boolean) => Promise<void>;
  scopeState: Ref<MemoryScopeStateRecord | null>;
  stats: Ref<MemoryStats | null>;
};

const DEFAULT_MEMORY_LIMIT = 12;
const DEFAULT_JOB_LIMIT = 6;
const LIVE_REFRESH_DEBOUNCE_MS = 120;
const LIVE_RECONNECT_DELAY_MS = 1_500;
const LIVE_REFRESH_EVENTS = new Set([
  "floor.committed",
  "memory.created",
  "memory.updated",
  "memory.deprecated",
  "memory.consolidated",
  "memory.persist_failed",
]);

export function useWorkspaceInspectorMemory(
  options: UseWorkspaceInspectorMemoryOptions,
): UseWorkspaceInspectorMemoryResult {
  const memoriesResource = options.memoriesResource ?? apiClient.memories;
  const memoryJobsResource = options.memoryJobsResource ?? apiClient.memoryJobs;
  const memoryScopesResource = options.memoryScopesResource ?? apiClient.memoryScopes;
  const webSocketFactory = options.webSocketFactory === undefined
    ? createDefaultWebSocketFactory()
    : options.webSocketFactory;
  const webSocketUrlResolver = options.webSocketUrlResolver ?? buildDefaultWebSocketUrl;
  const cache = new Map<string, MemoryInspectorSnapshot>();
  const error = ref<string | null>(null);
  const items = ref<MemoryRecord[]>([]);
  const jobs = ref<MemoryJobRecord[]>([]);
  const loading = ref(false);
  const scopeState = ref<MemoryScopeStateRecord | null>(null);
  const stats = ref<MemoryStats | null>(null);
  let requestVersion = 0;
  let disposed = false;
  let liveConnectionToken = 0;
  let liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let liveReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let liveSocket: WorkspaceInspectorWebSocketLike | null = null;

  const target = computed<ResolvedTarget | null>(() => {
    const accountId = toValue(options.accountId)?.trim();
    const sessionId = toValue(options.sessionId)?.trim();

    if (!accountId || !sessionId) {
      return null;
    }

    return {
      accountId,
      sessionId,
    };
  });

  const targetKey = computed(() => {
    const currentTarget = target.value;
    return currentTarget ? buildTargetKey(currentTarget) : "";
  });

  watch(
    targetKey,
    () => {
      teardownLiveUpdates();
      const currentTarget = target.value;
      if (currentTarget) {
        startLiveUpdates(currentTarget);
      }
      void refresh();
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    disposed = true;
    teardownLiveUpdates();
  });

  async function refresh(force = false): Promise<void> {
    const currentTarget = target.value;
    if (!currentTarget) {
      requestVersion += 1;
      applySnapshot(null);
      error.value = null;
      loading.value = false;
      return;
    }

    const cacheKey = buildTargetKey(currentTarget);
    if (!force) {
      const cachedSnapshot = cache.get(cacheKey);
      if (cachedSnapshot) {
        applySnapshot(cachedSnapshot);
        error.value = null;
        loading.value = false;
        return;
      }
    }

    const currentRequestVersion = ++requestVersion;
    loading.value = true;
    error.value = null;

    try {
      const [memoryItems, memoryStats, scopeResult, jobResult] = await Promise.all([
        memoriesResource.list({
          accountId: currentTarget.accountId,
          limit: DEFAULT_MEMORY_LIMIT,
          offset: 0,
          scope: "chat",
          scopeId: currentTarget.sessionId,
          sortBy: "updated_at",
          sortOrder: "desc",
        }),
        memoriesResource.getStats({
          accountId: currentTarget.accountId,
          scope: "chat",
          scopeId: currentTarget.sessionId,
        }),
        memoryScopesResource.list({
          accountId: currentTarget.accountId,
          limit: 1,
          offset: 0,
          scope: "chat",
          scopeId: currentTarget.sessionId,
          sortBy: "updated_at",
          sortOrder: "desc",
        }),
        memoryJobsResource.list({
          accountId: currentTarget.accountId,
          limit: DEFAULT_JOB_LIMIT,
          offset: 0,
          scope: "chat",
          scopeId: currentTarget.sessionId,
          sortBy: "created_at",
          sortOrder: "desc",
        }),
      ]);

      if (currentRequestVersion !== requestVersion) {
        return;
      }

      const nextSnapshot: MemoryInspectorSnapshot = {
        items: memoryItems,
        jobs: jobResult.jobs,
        scopeState: scopeResult.scopes.find((entry) => entry.scope === "chat" && entry.scopeId === currentTarget.sessionId) ?? null,
        stats: memoryStats,
      };

      cache.set(cacheKey, nextSnapshot);
      applySnapshot(nextSnapshot);
    } catch (cause) {
      if (currentRequestVersion !== requestVersion) {
        return;
      }

      error.value = cause instanceof Error ? cause.message : "Unknown error";
    } finally {
      if (currentRequestVersion === requestVersion) {
        loading.value = false;
      }
    }
  }

  function applySnapshot(snapshot: MemoryInspectorSnapshot | null): void {
    items.value = snapshot?.items ?? [];
    jobs.value = snapshot?.jobs ?? [];
    scopeState.value = snapshot?.scopeState ?? null;
    stats.value = snapshot?.stats ?? null;
  }

  function startLiveUpdates(currentTarget: ResolvedTarget): void {
    if (!webSocketFactory) {
      return;
    }

    const url = webSocketUrlResolver(currentTarget.sessionId);
    if (!url) {
      return;
    }

    const token = ++liveConnectionToken;
    connectLiveUpdates(currentTarget, token, url);
  }

  function connectLiveUpdates(currentTarget: ResolvedTarget, token: number, url?: string | null): void {
    if (disposed || token !== liveConnectionToken || !webSocketFactory) {
      return;
    }

    const resolvedUrl = url ?? webSocketUrlResolver(currentTarget.sessionId);
    if (!resolvedUrl) {
      return;
    }

    let socket: WorkspaceInspectorWebSocketLike;
    try {
      socket = webSocketFactory(resolvedUrl);
    } catch {
      return;
    }

    liveSocket = socket;
    socket.onmessage = (event) => {
      if (disposed || token !== liveConnectionToken) {
        return;
      }

      const message = parseWsMessage(event.data);
      if (!shouldRefreshForWsMessage(message, currentTarget.sessionId)) {
        return;
      }

      scheduleLiveRefresh(currentTarget, token);
    };
    socket.onclose = () => {
      if (liveSocket === socket) {
        liveSocket = null;
      }

      if (disposed || token !== liveConnectionToken) {
        return;
      }

      clearLiveReconnectTimer();
      liveReconnectTimer = setTimeout(() => {
        if (disposed || token !== liveConnectionToken) {
          return;
        }
        connectLiveUpdates(currentTarget, token);
      }, LIVE_RECONNECT_DELAY_MS);
    };
    socket.onerror = () => {
      // 保持静默，由 close 回调负责重连。
    };
  }

  function scheduleLiveRefresh(currentTarget: ResolvedTarget, token: number): void {
    if (disposed || token !== liveConnectionToken) {
      return;
    }

    clearLiveRefreshTimer();
    liveRefreshTimer = setTimeout(() => {
      if (disposed || token !== liveConnectionToken) {
        return;
      }

      cache.delete(buildTargetKey(currentTarget));
      void refresh(true);
    }, LIVE_REFRESH_DEBOUNCE_MS);
  }

  function teardownLiveUpdates(): void {
    liveConnectionToken += 1;
    clearLiveRefreshTimer();
    clearLiveReconnectTimer();

    if (!liveSocket) {
      return;
    }

    const socket = liveSocket;
    liveSocket = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.onopen = null;

    try {
      socket.close();
    } catch {
      // 关闭失败不影响检查器使用。
    }
  }

  function clearLiveRefreshTimer(): void {
    if (liveRefreshTimer) {
      clearTimeout(liveRefreshTimer);
      liveRefreshTimer = null;
    }
  }

  function clearLiveReconnectTimer(): void {
    if (liveReconnectTimer) {
      clearTimeout(liveReconnectTimer);
      liveReconnectTimer = null;
    }
  }

  return {
    error,
    items,
    jobs,
    loading,
    refresh,
    scopeState,
    stats,
  };
}

function buildTargetKey(target: ResolvedTarget): string {
  return [target.accountId, target.sessionId].join("\u0000");
}

function createDefaultWebSocketFactory(): WorkspaceInspectorWebSocketFactory | null {
  if (typeof WebSocket !== "function") {
    return null;
  }

  return (url) => new WebSocket(url) as unknown as WorkspaceInspectorWebSocketLike;
}

function buildDefaultWebSocketUrl(sessionId: string): string | null {
  try {
    const baseUrl = typeof window !== "undefined"
      ? new URL(apiBaseUrl, window.location.origin)
      : new URL(apiBaseUrl);
    baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    baseUrl.pathname = "/ws";
    baseUrl.search = "";
    baseUrl.searchParams.set("session_id", sessionId);
    return baseUrl.toString();
  } catch {
    return null;
  }
}

function parseWsMessage(raw: string): WorkspaceInspectorWsMessage | null {
  try {
    const parsed = JSON.parse(raw) as WorkspaceInspectorWsMessage;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function shouldRefreshForWsMessage(message: WorkspaceInspectorWsMessage | null, sessionId: string): boolean {
  if (!message || message.type !== "event" || !message.event || !LIVE_REFRESH_EVENTS.has(message.event)) {
    return false;
  }

  const messageSessionId = resolveWsMessageSessionId(message.data);
  return messageSessionId === undefined || messageSessionId === sessionId;
}

function resolveWsMessageSessionId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  if (record.floor && typeof record.floor === "object") {
    const floor = record.floor as Record<string, unknown>;
    return typeof floor.sessionId === "string" ? floor.sessionId : undefined;
  }

  if (typeof record.sessionId === "string") {
    return record.sessionId;
  }

  if (record.item && typeof record.item === "object") {
    const item = record.item as Record<string, unknown>;
    if (item.scope === "chat" && typeof item.scopeId === "string") {
      return item.scopeId;
    }
  }

  if (record.scope === "chat" && typeof record.scopeId === "string") {
    return record.scopeId;
  }

  return undefined;
}
