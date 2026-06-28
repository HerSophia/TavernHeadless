/**
 * 后端引擎实例（连接）store（ENG10 / 阶段 0 地基）。
 *
 * 持有连接列表与当前连接，并把当前连接写入 `lib/backend/active`，驱动 `lib/sdk` 与
 * `lib/nodegraph-api` 的 baseUrl 与鉴权头。凭证按设计 §9 双档存储：`persistCredential`
 * 为 true 才把 credential 落 localStorage，否则仅会话内存（刷新即失）。
 *
 * 真正的连接编辑/测试/掩码 UI 在阶段 A（ENG10）承接；本阶段只建地基与运行时注入。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { DEFAULT_BACKEND_CONNECTION, setActiveConnection } from "../lib/backend/active";
import { normalizeBaseUrl, type BackendConnection } from "../lib/backend/connection";

const STORAGE_KEY = "studio-backend-connections";

interface PersistShape {
  connections: BackendConnection[];
  currentId: string | null;
}

/** 仅在浏览器环境拿到 localStorage；node 测试环境返回 null（持久化降级为 no-op）。 */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function loadPersisted(): PersistShape | null {
  const storage = safeStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistShape;
    if (!parsed || !Array.isArray(parsed.connections)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

let idSeq = 0;
function generateConnectionId(): string {
  idSeq += 1;
  return `conn_${Date.now().toString(36)}_${idSeq}`;
}

export type BackendConnectionInput = Omit<BackendConnection, "id"> & { id?: string };

export const useBackendConnectionStore = defineStore("backend-connection", () => {
  const connections = ref<BackendConnection[]>([]);
  const currentId = ref<string | null>(null);

  const current = computed<BackendConnection | null>(
    () => connections.value.find((conn) => conn.id === currentId.value) ?? null,
  );

  function persist(): void {
    const storage = safeStorage();
    if (!storage) {
      return;
    }
    // 仅持久化允许保存凭证的连接的 credential；其余清空（仅会话内存）。
    const serializable: BackendConnection[] = connections.value.map((conn) =>
      conn.persistCredential ? conn : { ...conn, credential: null },
    );
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ connections: serializable, currentId: currentId.value } satisfies PersistShape),
      );
    } catch {
      // 忽略持久化失败（隐私模式 / 配额）。
    }
  }

  function applyActive(): void {
    setActiveConnection(current.value ?? DEFAULT_BACKEND_CONNECTION);
  }

  function init(): void {
    const persisted = loadPersisted();
    if (persisted && persisted.connections.length > 0) {
      connections.value = persisted.connections;
      currentId.value =
        persisted.currentId && persisted.connections.some((conn) => conn.id === persisted.currentId)
          ? persisted.currentId
          : persisted.connections[0]!.id;
    } else {
      connections.value = [{ ...DEFAULT_BACKEND_CONNECTION }];
      currentId.value = DEFAULT_BACKEND_CONNECTION.id;
    }
    applyActive();
  }

  function setCurrent(id: string): void {
    if (!connections.value.some((conn) => conn.id === id)) {
      return;
    }
    currentId.value = id;
    applyActive();
    persist();
  }

  function upsert(input: BackendConnectionInput): BackendConnection {
    const normalized = { ...input, baseUrl: normalizeBaseUrl(input.baseUrl) };
    if (normalized.id) {
      const index = connections.value.findIndex((conn) => conn.id === normalized.id);
      if (index >= 0) {
        const merged: BackendConnection = { ...connections.value[index]!, ...normalized, id: normalized.id };
        connections.value.splice(index, 1, merged);
        if (currentId.value === merged.id) {
          applyActive();
        }
        persist();
        return merged;
      }
    }
    const created: BackendConnection = { ...normalized, id: normalized.id ?? generateConnectionId() };
    connections.value.push(created);
    if (!currentId.value) {
      currentId.value = created.id;
      applyActive();
    }
    persist();
    return created;
  }

  function remove(id: string): void {
    const index = connections.value.findIndex((conn) => conn.id === id);
    if (index < 0) {
      return;
    }
    connections.value.splice(index, 1);
    if (currentId.value === id) {
      currentId.value = connections.value[0]?.id ?? null;
      applyActive();
    }
    persist();
  }

  init();

  return {
    connections,
    currentId,
    current,
    init,
    setCurrent,
    upsert,
    remove,
  };
});
