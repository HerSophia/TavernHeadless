/**
 * 预设编辑器 store（SC2-7 / 方向 3）。
 *
 * 单一职责：一个预设的加载 / 草稿 / 脏态 / 保存 / 冲突态。
 * 业务映射与条目操作委托给纯模型 `lib/assets/preset-editor-model`；
 * 读写走薄 API `lib/assets/preset-editor`；保存成功后对账 `assets` store 的 preset 列表。
 *
 * 保存策略：整体 PUT（`presets.update`）+ `expectedVersion` 乐观锁；
 * 409 冲突置 `conflict`，引导「重新加载」；其余错误置 `error` 保留草稿允许重试。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { presetEditorApi } from "../lib/assets/preset-editor";
import {
  blankEntry,
  moveEntry as moveEntryInList,
  serializeForBaseline,
  toDraft,
  toUpdatePayload,
  validateIdentifier,
  type PresetDraft,
  type PresetEntryDraft,
  type PresetIdentifierIssue,
} from "../lib/assets/preset-editor-model";
import { useAssetsStore } from "./assets";

function describeError(cause: unknown): string {
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return cause instanceof Error ? cause.message : String(cause);
}

/** 乐观锁冲突启发式（薄封装无结构化 code）：message 含 409 / conflict / version。 */
function isConflict(cause: unknown): boolean {
  const message = describeError(cause).toLowerCase();
  return message.includes("409") || message.includes("conflict") || message.includes("version");
}

export const usePresetEditorStore = defineStore("preset-editor", () => {
  const presetId = ref<string | null>(null);
  const draft = ref<PresetDraft | null>(null);
  const expectedVersion = ref(0);
  const baseline = ref("");
  const selectedIdentifier = ref<string | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);
  const conflict = ref(false);

  /** 编辑器是否已打开（有草稿）。 */
  const open = computed(() => draft.value !== null);
  /** 脏态：草稿序列化 ≠ 基线。 */
  const dirty = computed(() => draft.value !== null && serializeForBaseline(draft.value) !== baseline.value);
  /** 现有条目 identifier 列表（校验新增用）。 */
  const identifiers = computed(() => draft.value?.entries.map((entry) => entry.identifier) ?? []);
  /** 当前选中条目。 */
  const selectedEntry = computed<PresetEntryDraft | null>(() => {
    if (!draft.value || selectedIdentifier.value === null) {
      return null;
    }
    return draft.value.entries.find((entry) => entry.identifier === selectedIdentifier.value) ?? null;
  });

  function findEntry(identifier: string): PresetEntryDraft | undefined {
    return draft.value?.entries.find((entry) => entry.identifier === identifier);
  }

  /** 打开编辑器：拉结构化模型 → 建草稿 / 基线 / 版本 / 默认选中首条。 */
  async function openEditor(id: string): Promise<void> {
    presetId.value = id;
    loading.value = true;
    error.value = null;
    conflict.value = false;
    try {
      const detail = await presetEditorApi.getEditor(id);
      const next = toDraft(detail);
      draft.value = next;
      expectedVersion.value = detail.version;
      baseline.value = serializeForBaseline(next);
      selectedIdentifier.value = next.entries[0]?.identifier ?? null;
    } catch (cause) {
      error.value = describeError(cause);
      draft.value = null;
    } finally {
      loading.value = false;
    }
  }

  /** 关闭编辑器并清空所有态。 */
  function close(): void {
    presetId.value = null;
    draft.value = null;
    expectedVersion.value = 0;
    baseline.value = "";
    selectedIdentifier.value = null;
    error.value = null;
    conflict.value = false;
    saving.value = false;
    loading.value = false;
  }

  function setName(value: string): void {
    if (draft.value) {
      draft.value.name = value;
    }
  }

  function selectEntry(identifier: string): void {
    selectedIdentifier.value = identifier;
  }

  function updateEntryField(identifier: string, patch: Partial<PresetEntryDraft>): void {
    const entry = findEntry(identifier);
    if (entry) {
      Object.assign(entry, patch);
    }
  }

  function toggleEntry(identifier: string): void {
    const entry = findEntry(identifier);
    if (entry) {
      entry.enabled = !entry.enabled;
    }
  }

  /** 新增条目：identifier 校验通过则追加并选中；否则返回问题枚举。 */
  function addEntry(identifier: string): PresetIdentifierIssue | null {
    if (!draft.value) {
      return "empty";
    }
    const issue = validateIdentifier(identifier, identifiers.value);
    if (issue) {
      return issue;
    }
    const entry = blankEntry(identifier.trim());
    draft.value.entries.push(entry);
    selectedIdentifier.value = entry.identifier;
    return null;
  }

  /** 删除条目：若删的是选中项则改选相邻。 */
  function removeEntry(identifier: string): void {
    if (!draft.value) {
      return;
    }
    const index = draft.value.entries.findIndex((entry) => entry.identifier === identifier);
    if (index === -1) {
      return;
    }
    draft.value.entries.splice(index, 1);
    if (selectedIdentifier.value === identifier) {
      const fallback = draft.value.entries[index] ?? draft.value.entries[index - 1] ?? null;
      selectedIdentifier.value = fallback ? fallback.identifier : null;
    }
  }

  /** 重排条目（-1 上移 / 1 下移）。 */
  function moveEntry(identifier: string, dir: -1 | 1): void {
    if (!draft.value) {
      return;
    }
    const index = draft.value.entries.findIndex((entry) => entry.identifier === identifier);
    if (index === -1) {
      return;
    }
    draft.value.entries = moveEntryInList(draft.value.entries, index, dir);
  }

  /**
   * 整体保存：`toUpdatePayload` → `presetEditorApi.save`（带 `expectedVersion`）。
   * 成功 → 刷新版本 / 基线 + 对账 preset 列表，返回 true；
   * 409 → `conflict=true`；其余置 `error`，均返回 false。
   */
  async function save(): Promise<boolean> {
    if (!draft.value || !presetId.value) {
      return false;
    }
    saving.value = true;
    error.value = null;
    conflict.value = false;
    try {
      const payload = toUpdatePayload(draft.value);
      const result = await presetEditorApi.save(presetId.value, payload, expectedVersion.value);
      expectedVersion.value = result.version;
      baseline.value = serializeForBaseline(draft.value);
      await useAssetsStore().loadAssets("preset");
      return true;
    } catch (cause) {
      if (isConflict(cause)) {
        conflict.value = true;
      } else {
        error.value = describeError(cause);
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  /** 冲突 / 需要放弃本地改动时重取最新版（丢弃当前草稿）。 */
  async function reload(): Promise<void> {
    if (presetId.value) {
      await openEditor(presetId.value);
    }
  }

  return {
    presetId,
    draft,
    expectedVersion,
    selectedIdentifier,
    loading,
    saving,
    error,
    conflict,
    open,
    dirty,
    identifiers,
    selectedEntry,
    openEditor,
    close,
    setName,
    selectEntry,
    updateEntryField,
    toggleEntry,
    addEntry,
    removeEntry,
    moveEntry,
    save,
    reload,
  };
});
