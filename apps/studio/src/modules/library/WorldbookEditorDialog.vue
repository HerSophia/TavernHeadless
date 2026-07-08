<script setup lang="ts">
/**
 * 世界书编辑器对话框（SC2-6 / 方向 2）。
 *
 * `UiDialog`（xl）承载：顶部书名改名，主体左侧条目列表（新建 / 选中 / 启禁 / 上下移 / 删除）+
 * 右侧富字段表单（create/edit）。写操作走 `useWorldbookEditorStore`（乐观锁 + 写后对账），
 * 错误按 kind 映射提示。受限递归 / outlet 字段本期不暴露。
 */
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { WorldbookEntryRecord } from "@tavern/sdk";

import {
  emptyEntryDraft,
  entryToDraft,
  validateEntryDraft,
  WORLDBOOK_POSITION_AT_DEPTH,
  WORLDBOOK_POSITION_VALUES,
  WORLDBOOK_ROLE_VALUES,
  WORLDBOOK_SELECTIVE_LOGIC_VALUES,
  type WorldbookEntryDraft,
  type WorldbookTriState,
} from "../../lib/assets/worldbook-editor";
import { useWorldbookEditorStore } from "../../stores/worldbook-editor";
import UiButton from "../../ui/UiButton.vue";
import UiConfirmDialog from "../../ui/UiConfirmDialog.vue";
import UiDialog from "../../ui/UiDialog.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import UiSelect from "../../ui/UiSelect.vue";
import UiTextInput from "../../ui/UiTextInput.vue";

const props = defineProps<{ open: boolean; worldbookId: string | null; worldbookName?: string }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const store = useWorldbookEditorStore();

type FormMode = "idle" | "create" | "edit";
const mode = ref<FormMode>("idle");
const selectedId = ref<string | null>(null);
const triedSave = ref(false);
const draft = reactive<WorldbookEntryDraft>(emptyEntryDraft());

const bookName = ref("");
const deleteTarget = ref<string | null>(null);

const fieldClass =
  "w-full rounded-md border border-line-subtle bg-float px-2.5 py-1.5 text-sm text-text-primary transition-colors duration-150 placeholder:text-text-muted hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent";

// --- 生命周期：跟随 open / worldbookId 打开或关闭会话 ---
watch(
  () => (props.open ? props.worldbookId : null),
  (id) => {
    if (id) {
      void store.open(id);
    } else {
      store.close();
    }
    resetForm();
  },
  { immediate: true },
);

watch(
  () => store.detail,
  (detail) => {
    bookName.value = detail?.name ?? "";
  },
);

// --- 派生 ---
const dialogTitle = computed(() =>
  props.worldbookName ? `${t("library.wb_title")} · ${props.worldbookName}` : t("library.wb_title"),
);

const errorText = computed(() => {
  const err = store.lastError;
  if (!err) {
    return "";
  }
  return err.kind === "unknown" ? err.message : t(`library.wb_err_${err.kind}`);
});

const validation = computed(() => validateEntryDraft(draft));
const contentError = computed(() =>
  triedSave.value && validation.value.errors.content ? t(`library.wb_err_${validation.value.errors.content}`) : "",
);
const keysError = computed(() =>
  triedSave.value && validation.value.errors.keys ? t(`library.wb_err_${validation.value.errors.keys}`) : "",
);

const positionOptions = computed(() =>
  WORLDBOOK_POSITION_VALUES.map((value) => ({ value: String(value), label: t(`library.wb_pos_${value}`) })),
);
const roleOptions = computed(() =>
  WORLDBOOK_ROLE_VALUES.map((value) => ({ value: String(value), label: t(`library.wb_role_${value}`) })),
);
const logicOptions = computed(() =>
  WORLDBOOK_SELECTIVE_LOGIC_VALUES.map((value) => ({ value: String(value), label: t(`library.wb_logic_${value}`) })),
);
const triStateOptions = computed<Array<{ value: WorldbookTriState; label: string }>>(() => [
  { value: "inherit", label: t("library.wb_inherit") },
  { value: "on", label: t("library.wb_on") },
  { value: "off", label: t("library.wb_off") },
]);

const positionModel = computed<string>({
  get: () => String(draft.position),
  set: (value) => {
    draft.position = Number(value);
  },
});
const roleModel = computed<string>({
  get: () => String(draft.role),
  set: (value) => {
    draft.role = Number(value);
  },
});
const logicModel = computed<string>({
  get: () => String(draft.selectiveLogic),
  set: (value) => {
    draft.selectiveLogic = Number(value);
  },
});

const canRenameBook = computed(
  () => !store.saving && bookName.value.trim().length > 0 && bookName.value.trim() !== store.detail?.name,
);

// --- 工具 ---
function toInt(value: string, fallback: number, min?: number): number {
  if (value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const truncated = Math.trunc(parsed);
  return min === undefined ? truncated : Math.max(min, truncated);
}

function entryTitle(entry: WorldbookEntryRecord): string {
  return entry.comment.trim() || entry.keys[0] || t("library.wb_untitledEntry");
}

function resetForm(): void {
  mode.value = "idle";
  selectedId.value = null;
  triedSave.value = false;
}

// --- 表单事件 ---
function startCreate(): void {
  Object.assign(draft, emptyEntryDraft());
  mode.value = "create";
  selectedId.value = null;
  triedSave.value = false;
}

function selectEntry(entry: WorldbookEntryRecord): void {
  Object.assign(draft, entryToDraft(entry));
  mode.value = "edit";
  selectedId.value = entry.id;
  triedSave.value = false;
}

function cancelForm(): void {
  resetForm();
}

async function saveForm(): Promise<void> {
  triedSave.value = true;
  if (!validation.value.ok) {
    return;
  }
  const ok =
    mode.value === "create"
      ? await store.createEntry(draft)
      : selectedId.value
        ? await store.updateEntry(selectedId.value, draft)
        : false;
  if (ok) {
    resetForm();
  }
}

function onDepthInput(event: Event): void {
  draft.depth = toInt((event.target as HTMLInputElement).value, draft.depth, 0);
}
function onOrderInput(event: Event): void {
  draft.order = toInt((event.target as HTMLInputElement).value, draft.order);
}
function onScanDepthInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim();
  draft.scanDepth = raw === "" ? null : toInt(raw, draft.scanDepth ?? 0, 0);
}

// --- 列表行事件 ---
function toggleDisable(entry: WorldbookEntryRecord): void {
  void store.setEntryDisabled(entry.id, !entry.disable);
}
function moveUp(id: string): void {
  void store.moveEntry(id, "up");
}
function moveDown(id: string): void {
  void store.moveEntry(id, "down");
}
function requestDelete(id: string): void {
  deleteTarget.value = id;
}
async function confirmDelete(): Promise<void> {
  const id = deleteTarget.value;
  deleteTarget.value = null;
  if (!id) {
    return;
  }
  const ok = await store.removeEntry(id);
  if (ok && selectedId.value === id) {
    resetForm();
  }
}

function onRenameBook(): void {
  const name = bookName.value.trim();
  if (name && name !== store.detail?.name) {
    void store.renameBook(name);
  }
}
</script>

<template>
  <UiDialog :open="open" :title="dialogTitle" size="xl" :busy="store.saving" @close="emit('close')">
    <div class="flex h-[70vh] min-h-0 flex-col">
      <p
        v-if="errorText"
        class="mb-3 rounded-md border border-signal-error/40 bg-signal-error/10 px-3 py-2 text-xs text-signal-error"
      >
        {{ errorText }}
      </p>

      <!-- 书名 -->
      <div class="flex items-center gap-2 pb-3">
        <span class="shrink-0 text-xs text-text-muted">{{ t("library.wb_bookName") }}</span>
        <div class="flex-1">
          <UiTextInput v-model="bookName" :disabled="store.saving" :aria-label="t('library.wb_bookName')" />
        </div>
        <UiButton :disabled="!canRenameBook" @click="onRenameBook">{{ t("library.wb_saveName") }}</UiButton>
      </div>

      <!-- 两栏 -->
      <div class="flex min-h-0 flex-1 gap-3 border-t border-line-subtle pt-3">
        <!-- 左：条目列表 -->
        <div class="flex w-56 shrink-0 flex-col">
          <UiButton class="mb-2 justify-center" @click="startCreate">
            <Plus :size="14" :stroke-width="1.5" />
            {{ t("library.wb_newEntry") }}
          </UiButton>
          <div class="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
            <p v-if="store.loading" class="py-6 text-center text-xs text-text-muted">…</p>
            <p v-else-if="store.entries.length === 0" class="py-6 text-center text-xs text-text-muted">
              {{ t("library.wb_noEntries") }}
            </p>
            <div
              v-for="(entry, index) in store.entries"
              :key="entry.id"
              class="group flex items-center gap-1 rounded-md border px-2 py-1.5"
              :class="
                selectedId === entry.id ? 'border-signal-accent bg-panel' : 'border-line-subtle hover:border-line-active'
              "
            >
              <button
                type="button"
                class="min-w-0 flex-1 truncate text-left text-xs"
                :class="entry.disable ? 'text-text-muted line-through' : 'text-text-primary'"
                :title="entryTitle(entry)"
                @click="selectEntry(entry)"
              >
                {{ entryTitle(entry) }}
              </button>
              <span
                v-if="entry.disable"
                class="shrink-0 rounded bg-float px-1 text-[10px] text-text-muted"
                :title="t('library.wb_disabledBadge')"
              >
                {{ t("library.wb_disabledBadge") }}
              </span>
              <div class="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                <UiIconButton :label="t('library.wb_moveUp')" :disabled="store.saving || index === 0" @click="moveUp(entry.id)">
                  <ChevronUp :size="13" :stroke-width="1.5" />
                </UiIconButton>
                <UiIconButton
                  :label="t('library.wb_moveDown')"
                  :disabled="store.saving || index === store.entries.length - 1"
                  @click="moveDown(entry.id)"
                >
                  <ChevronDown :size="13" :stroke-width="1.5" />
                </UiIconButton>
                <UiIconButton :label="t('library.wb_deleteEntry')" :disabled="store.saving" @click="requestDelete(entry.id)">
                  <Trash2 :size="13" :stroke-width="1.5" />
                </UiIconButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 右：条目表单 -->
        <div class="min-h-0 flex-1 overflow-auto border-l border-line-subtle pl-3">
          <p v-if="mode === 'idle'" class="py-10 text-center text-xs text-text-muted">
            {{ t("library.wb_selectHint") }}
          </p>

          <div v-else class="space-y-3">
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.wb_field_comment") }}</span>
              <UiTextInput v-model="draft.comment" :aria-label="t('library.wb_field_comment')" />
            </label>

            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.wb_field_keys") }}</span>
              <textarea v-model="draft.keys" rows="2" :class="fieldClass" :placeholder="t('library.wb_keysHint')"></textarea>
              <span v-if="keysError" class="text-xs text-signal-error">{{ keysError }}</span>
            </label>

            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.wb_field_keysSecondary") }}</span>
              <textarea
                v-model="draft.keysSecondary"
                rows="2"
                :class="fieldClass"
                :placeholder="t('library.wb_keysHint')"
              ></textarea>
            </label>

            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.wb_field_content") }}</span>
              <textarea v-model="draft.content" rows="6" :class="fieldClass"></textarea>
              <span v-if="contentError" class="text-xs text-signal-error">{{ contentError }}</span>
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.wb_field_position") }}</span>
                <UiSelect v-model="positionModel" :options="positionOptions" />
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.wb_field_role") }}</span>
                <UiSelect v-model="roleModel" :options="roleOptions" />
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.wb_field_depth") }}</span>
                <input
                  type="number"
                  min="0"
                  :value="draft.depth"
                  :class="fieldClass"
                  :disabled="draft.position !== WORLDBOOK_POSITION_AT_DEPTH"
                  @input="onDepthInput"
                />
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.wb_field_order") }}</span>
                <input type="number" :value="draft.order" :class="fieldClass" @input="onOrderInput" />
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.wb_field_scanDepth") }}</span>
                <input
                  type="number"
                  min="0"
                  :value="draft.scanDepth ?? ''"
                  :class="fieldClass"
                  :placeholder="t('library.wb_scanDepthHint')"
                  @input="onScanDepthInput"
                />
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.wb_field_selectiveLogic") }}</span>
                <UiSelect v-model="logicModel" :options="logicOptions" :disabled="!draft.selective" />
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.wb_field_caseSensitive") }}</span>
                <UiSelect v-model="draft.caseSensitive" :options="triStateOptions" />
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.wb_field_matchWholeWords") }}</span>
                <UiSelect v-model="draft.matchWholeWords" :options="triStateOptions" />
              </label>
            </div>

            <div class="flex flex-wrap gap-4 pt-1">
              <label class="flex items-center gap-1.5 text-xs text-text-secondary">
                <input v-model="draft.selective" type="checkbox" class="accent-signal-accent" />
                {{ t("library.wb_field_selective") }}
              </label>
              <label class="flex items-center gap-1.5 text-xs text-text-secondary">
                <input v-model="draft.constant" type="checkbox" class="accent-signal-accent" />
                {{ t("library.wb_field_constant") }}
              </label>
              <label class="flex items-center gap-1.5 text-xs text-text-secondary">
                <input v-model="draft.disable" type="checkbox" class="accent-signal-accent" />
                {{ t("library.wb_field_disable") }}
              </label>
            </div>

            <p class="rounded-md bg-float px-2.5 py-1.5 text-[11px] leading-relaxed text-text-muted">
              {{ t("library.wb_restrictedNote") }}
            </p>

            <div class="flex items-center justify-end gap-2 pt-1">
              <UiButton variant="ghost" :disabled="store.saving" @click="cancelForm">
                {{ t("library.wb_cancel") }}
              </UiButton>
              <UiButton :disabled="store.saving" @click="saveForm">
                {{ store.saving ? t("library.wb_saving") : t("library.wb_save") }}
              </UiButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </UiDialog>

  <UiConfirmDialog
    :open="deleteTarget !== null"
    :title="t('library.wb_deleteEntry')"
    :message="t('library.wb_confirmDeleteEntry')"
    :confirm-label="t('library.delete')"
    :cancel-label="t('library.cancel')"
    :busy="store.saving"
    tone="danger"
    @confirm="confirmDelete"
    @cancel="deleteTarget = null"
  />
</template>
