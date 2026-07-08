/**
 * 角色卡编辑器 store（SC2-8 / 方向 4）。
 *
 * 单一职责：一张角色卡的加载 / 草稿 / 脏态 / 保存 / 错误态。业务映射与校验委托纯模型
 * `lib/assets/character-editor-model`；读写走薄 API `lib/assets/character-editor`；
 * 保存成功后对账 `assets` store 的 character 列表。
 *
 * 保存策略：整快照 `createVersion`（编辑 = 新版本）+ `expectedRevision` 乐观锁。
 * 与世界书条目编辑不同：角色卡是单张大表单（多段长文本），409 冲突**不自动重载**，
 * 而是置 `lastError.kind=conflict` 由用户点「重新加载」决定（避免静默丢弃编辑）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { characterEditorApi } from "../lib/assets/character-editor";
import {
  buildSnapshot,
  classifyCharacterWriteError,
  extractPassthrough,
  serializeForBaseline,
  snapshotToDraft,
  validateDraft,
  type CharacterDraft,
  type CharacterWriteErrorKind,
} from "../lib/assets/character-editor-model";
import { useAssetsStore } from "./assets";

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface CharacterEditorError {
  kind: CharacterWriteErrorKind;
  message: string;
}

export const useCharacterEditorStore = defineStore("character-editor", () => {
  const characterId = ref<string | null>(null);
  const draft = ref<CharacterDraft | null>(null);
  const passthrough = ref<Record<string, unknown>>({});
  const expectedRevision = ref(0);
  const baseline = ref("");
  const loading = ref(false);
  const saving = ref(false);
  const lastError = ref<CharacterEditorError | null>(null);

  /** 编辑器是否已打开（有草稿）。 */
  const open = computed(() => draft.value !== null);
  /** 脏态：草稿序列化 ≠ 基线。 */
  const dirty = computed(
    () => draft.value !== null && serializeForBaseline(draft.value, passthrough.value) !== baseline.value,
  );
  /** name 校验是否不通过（驱动保存禁用 + 内联提示）。 */
  const nameInvalid = computed(() => draft.value !== null && !validateDraft(draft.value).ok);

  function applyDetailSnapshot(snapshot: Record<string, unknown>): void {
    const next = snapshotToDraft(snapshot);
    draft.value = next;
    passthrough.value = extractPassthrough(snapshot);
    baseline.value = serializeForBaseline(next, passthrough.value);
  }

  /** 打开编辑器：拉详情 → 建草稿 / passthrough / 基线 / 乐观锁 revision。 */
  async function openEditor(id: string): Promise<void> {
    characterId.value = id;
    loading.value = true;
    lastError.value = null;
    try {
      const detail = await characterEditorApi.getDetail(id);
      applyDetailSnapshot(detail.latestVersion?.snapshot ?? {});
      expectedRevision.value = detail.revision;
    } catch (cause) {
      lastError.value = { kind: classifyCharacterWriteError(cause), message: toMessage(cause) };
      draft.value = null;
    } finally {
      loading.value = false;
    }
  }

  /** 关闭编辑器并清空全部态。 */
  function close(): void {
    characterId.value = null;
    draft.value = null;
    passthrough.value = {};
    expectedRevision.value = 0;
    baseline.value = "";
    lastError.value = null;
    loading.value = false;
    saving.value = false;
  }

  function updateField(patch: Partial<CharacterDraft>): void {
    if (draft.value) {
      Object.assign(draft.value, patch);
    }
  }

  /**
   * 整快照保存：`buildSnapshot` → `createVersion`（带 `expectedRevision`）。
   * name 非法直接返回 false（不发请求）。成功 → 刷 revision + 用返回的归一化 snapshot 重建
   * 草稿 / passthrough / 基线 + 对账 preset 列表；失败 → 分类落 `lastError`（冲突不自动重载）。
   */
  async function save(): Promise<boolean> {
    if (!draft.value || !characterId.value) {
      return false;
    }
    if (!validateDraft(draft.value).ok) {
      return false;
    }
    saving.value = true;
    lastError.value = null;
    try {
      const snapshot = buildSnapshot(draft.value, passthrough.value);
      const result = await characterEditorApi.saveVersion(characterId.value, snapshot, expectedRevision.value);
      expectedRevision.value = result.revision;
      if (result.snapshot) {
        applyDetailSnapshot(result.snapshot);
      } else {
        baseline.value = serializeForBaseline(draft.value, passthrough.value);
      }
      await useAssetsStore().loadAssets("character");
      return true;
    } catch (cause) {
      lastError.value = { kind: classifyCharacterWriteError(cause), message: toMessage(cause) };
      return false;
    } finally {
      saving.value = false;
    }
  }

  /** 冲突 / 需放弃本地改动时重取最新版（丢弃当前草稿）。 */
  async function reload(): Promise<void> {
    if (characterId.value) {
      await openEditor(characterId.value);
    }
  }

  return {
    characterId,
    draft,
    passthrough,
    expectedRevision,
    loading,
    saving,
    lastError,
    open,
    dirty,
    nameInvalid,
    openEditor,
    close,
    updateField,
    save,
    reload,
  };
});
