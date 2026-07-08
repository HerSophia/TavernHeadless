/**
 * 世界书编辑器 store（SC2-6 / 方向 2）。
 *
 * 承载单本世界书的编辑会话：详情 + 条目快照 + 条目 CRUD / 启禁 / 重排 / 书级改名，
 * 与资产库 `useAssetsStore`（列表 / 选择器缓存）解耦。乐观锁以 `detail.version` 作为
 * `expected_version`，每次写成功后双读对账（`getDetail` + `list`）；写错误按状态码分类，
 * 409 冲突刷新对账后提示重试。仅依赖 `lib/assets/worldbook` 薄封装，可 mock 纯单测。
 */
import { defineStore } from "pinia";
import { ref } from "vue";

import type { WorldbookDetail, WorldbookEntryRecord } from "@tavern/sdk";

import { worldbookApi } from "../lib/assets/worldbook";
import {
  classifyWorldbookWriteError,
  computeMoveReorder,
  draftToCreateInput,
  draftToUpdateInput,
  entryToDraft,
  type WorldbookEntryDraft,
  type WorldbookWriteErrorKind,
} from "../lib/assets/worldbook-editor";

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface WorldbookEditorError {
  kind: WorldbookWriteErrorKind;
  message: string;
}

export const useWorldbookEditorStore = defineStore("worldbook-editor", () => {
  const worldbookId = ref<string | null>(null);
  const detail = ref<WorldbookDetail | null>(null);
  const entries = ref<WorldbookEntryRecord[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const lastError = ref<WorldbookEditorError | null>(null);

  /** 读取详情 + 条目（抛错交由调用方处理）。 */
  async function refresh(): Promise<void> {
    const id = worldbookId.value;
    if (!id) {
      return;
    }
    const [nextDetail, nextEntries] = await Promise.all([
      worldbookApi.getDetail(id),
      worldbookApi.listEntries(id),
    ]);
    detail.value = nextDetail;
    entries.value = nextEntries;
  }

  /** 打开某本世界书：清态并加载。 */
  async function open(id: string): Promise<void> {
    worldbookId.value = id;
    detail.value = null;
    entries.value = [];
    lastError.value = null;
    loading.value = true;
    try {
      await refresh();
    } catch (cause) {
      lastError.value = { kind: classifyWorldbookWriteError(cause), message: toMessage(cause) };
    } finally {
      loading.value = false;
    }
  }

  /** 关闭编辑会话，清空全部状态。 */
  function close(): void {
    worldbookId.value = null;
    detail.value = null;
    entries.value = [];
    lastError.value = null;
    loading.value = false;
    saving.value = false;
  }

  /**
   * 写操作乐观锁封装：以当前 `detail.version` 为 `expected_version` 执行 `fn`，
   * 成功后对账刷新；失败分类落 `lastError`，冲突再刷新一次，返回是否成功。
   */
  async function runMutation(fn: (ctx: { id: string; version: number }) => Promise<void>): Promise<boolean> {
    const id = worldbookId.value;
    const version = detail.value?.version;
    if (!id || version == null) {
      return false;
    }
    saving.value = true;
    lastError.value = null;
    try {
      await fn({ id, version });
      await refresh();
      return true;
    } catch (cause) {
      const kind = classifyWorldbookWriteError(cause);
      lastError.value = { kind, message: toMessage(cause) };
      if (kind === "conflict") {
        try {
          await refresh();
        } catch {
          // 对账失败保留原冲突提示。
        }
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  function createEntry(draft: WorldbookEntryDraft): Promise<boolean> {
    return runMutation(async ({ id, version }) => {
      await worldbookApi.createEntry(draftToCreateInput(draft, id), version);
    });
  }

  function updateEntry(entryId: string, draft: WorldbookEntryDraft): Promise<boolean> {
    return runMutation(async ({ id, version }) => {
      await worldbookApi.updateEntry(draftToUpdateInput(draft, id, entryId), version);
    });
  }

  function removeEntry(entryId: string): Promise<boolean> {
    return runMutation(({ id, version }) => worldbookApi.removeEntry(id, entryId, version));
  }

  /** 行内启禁：复用 update（翻转 disable 后整体写入）。 */
  function setEntryDisabled(entryId: string, disable: boolean): Promise<boolean> {
    const entry = entries.value.find((item) => item.id === entryId);
    if (!entry) {
      return Promise.resolve(false);
    }
    return updateEntry(entryId, { ...entryToDraft(entry), disable });
  }

  /** 上/下移一位：无有效变更（越界）直接返回 false。 */
  function moveEntry(entryId: string, direction: "up" | "down"): Promise<boolean> {
    const items = computeMoveReorder(entries.value, entryId, direction);
    if (items.length === 0) {
      return Promise.resolve(false);
    }
    return runMutation(async ({ id, version }) => {
      await worldbookApi.reorderEntries(id, items, version);
    });
  }

  /** 书级改名（保留全局 data）。 */
  function renameBook(name: string): Promise<boolean> {
    const data = detail.value?.data ?? {};
    return runMutation(async ({ id, version }) => {
      await worldbookApi.updateBook(id, name, data, version);
    });
  }

  return {
    worldbookId,
    detail,
    entries,
    loading,
    saving,
    lastError,
    open,
    refresh,
    close,
    createEntry,
    updateEntry,
    removeEntry,
    setEntryDisabled,
    moveEntry,
    renameBook,
  };
});
