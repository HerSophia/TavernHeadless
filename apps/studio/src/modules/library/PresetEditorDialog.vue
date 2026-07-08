<script setup lang="ts">
/**
 * 预设编辑器对话框（SC2-7 / 方向 3）。
 *
 * `UiDialog`（xl）承载：头部预设改名 + 版本徽标 + 脏态点；主体两栏——左侧条目列表
 * （新增 / 选中 / 启禁 / 上下移 / 删除）+ 右侧 `PresetEntryForm`；底部保存 / 冲突 / 错误。
 * 保存走整体 PUT + 乐观锁（`usePresetEditorStore`）；脏态关闭二次确认丢弃；
 * 409 冲突展示条幅 + 「重新加载」。业务态全在 store。
 */
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { PresetEntryDraft } from "../../lib/assets/preset-editor-model";
import { usePresetEditorStore } from "../../stores/preset-editor";
import UiBadge from "../../ui/UiBadge.vue";
import UiButton from "../../ui/UiButton.vue";
import UiConfirmDialog from "../../ui/UiConfirmDialog.vue";
import UiDialog from "../../ui/UiDialog.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import UiTextInput from "../../ui/UiTextInput.vue";
import PresetEntryForm from "./PresetEntryForm.vue";

const props = defineProps<{ open: boolean; presetId: string | null; presetName?: string }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const store = usePresetEditorStore();

const showAddEntry = ref(false);
const newIdentifier = ref("");
const deleteTarget = ref<string | null>(null);
const confirmDiscard = ref(false);
// 新增条目的 identifier 校验问题（需在 immediate watch 调 resetAddEntry 前声明，否则命中 TDZ）。
const addIssue = ref<ReturnType<typeof store.addEntry>>(null);
const addIssueText = computed(() => (addIssue.value ? t(`library.pe_identifier_${addIssue.value}`) : ""));

// --- 生命周期：跟随 open / presetId 打开或关闭编辑会话 ---
watch(
  () => (props.open ? props.presetId : null),
  (id) => {
    if (id) {
      void store.openEditor(id);
    } else {
      store.close();
    }
    resetAddEntry();
  },
  { immediate: true },
);

const dialogTitle = computed(() =>
  props.presetName ? `${t("library.pe_title")} · ${props.presetName}` : t("library.pe_title"),
);

const nameModel = computed<string>({
  get: () => store.draft?.name ?? "",
  set: (value) => store.setName(value),
});

function resetAddEntry(): void {
  showAddEntry.value = false;
  newIdentifier.value = "";
  addIssue.value = null;
}

function submitAddEntry(): void {
  const issue = store.addEntry(newIdentifier.value);
  if (issue) {
    addIssue.value = issue;
    return;
  }
  resetAddEntry();
}

function onEntryUpdate(patch: Partial<PresetEntryDraft>): void {
  if (store.selectedIdentifier) {
    store.updateEntryField(store.selectedIdentifier, patch);
  }
}

function requestDelete(identifier: string): void {
  deleteTarget.value = identifier;
}
function confirmDeleteEntry(): void {
  if (deleteTarget.value) {
    store.removeEntry(deleteTarget.value);
  }
  deleteTarget.value = null;
}

async function onSave(): Promise<void> {
  const ok = await store.save();
  if (ok) {
    emit("close");
  }
}

/** 关闭手势（Esc / 遮罩 / 取消）：脏态先确认丢弃；忙态忽略。 */
function requestClose(): void {
  if (store.saving) {
    return;
  }
  if (store.dirty) {
    confirmDiscard.value = true;
    return;
  }
  emit("close");
}
function confirmDiscardClose(): void {
  confirmDiscard.value = false;
  emit("close");
}

function onReload(): void {
  void store.reload();
}
</script>

<template>
  <UiDialog :open="open" :title="dialogTitle" size="xl" :busy="store.saving" @close="requestClose">
    <div class="flex h-[70vh] min-h-0 flex-col">
      <!-- 冲突条幅 / 错误提示 -->
      <div
        v-if="store.conflict"
        class="mb-3 flex items-center justify-between gap-3 rounded-md border border-signal-warn/40 bg-signal-warn/10 px-3 py-2 text-xs text-signal-warn"
      >
        <span>{{ t("library.pe_conflict") }}</span>
        <UiButton variant="ghost" @click="onReload">{{ t("library.pe_reload") }}</UiButton>
      </div>
      <p
        v-else-if="store.error"
        class="mb-3 rounded-md border border-signal-error/40 bg-signal-error/10 px-3 py-2 text-xs text-signal-error"
      >
        {{ store.error }}
      </p>

      <p v-if="store.loading" class="py-10 text-center text-xs text-text-muted">…</p>

      <template v-else-if="store.draft">
        <!-- 头部：预设名 + 版本徽标 + 脏态 -->
        <div class="flex items-center gap-2 pb-3">
          <div class="flex-1">
            <UiTextInput
              v-model="nameModel"
              :placeholder="t('library.pe_namePlaceholder')"
              :aria-label="t('library.pe_name')"
              :disabled="store.saving"
            />
          </div>
          <UiBadge>{{ t("library.pe_version") }} {{ store.expectedVersion }}</UiBadge>
          <span v-if="store.dirty" class="inline-flex items-center gap-1 text-xs text-signal-warn">
            <span class="h-1.5 w-1.5 rounded-full bg-signal-warn"></span>{{ t("library.pe_dirty") }}
          </span>
        </div>

        <!-- 两栏 -->
        <div class="flex min-h-0 flex-1 gap-3 border-t border-line-subtle pt-3">
          <!-- 左：条目列表 -->
          <div class="flex w-56 shrink-0 flex-col">
            <UiButton class="mb-2 justify-center" :disabled="store.saving" @click="showAddEntry = true">
              <Plus :size="14" :stroke-width="1.5" />
              {{ t("library.pe_addEntry") }}
            </UiButton>

            <div v-if="showAddEntry" class="mb-2 space-y-1.5 rounded-md border border-line-subtle p-2">
              <UiTextInput
                v-model="newIdentifier"
                :placeholder="t('library.pe_identifierPlaceholder')"
                :aria-label="t('library.pe_identifier')"
                :invalid="addIssue !== null"
                @enter="submitAddEntry"
              />
              <p v-if="addIssueText" class="text-xs text-signal-error">{{ addIssueText }}</p>
              <div class="flex justify-end gap-1.5">
                <UiButton variant="ghost" @click="resetAddEntry">{{ t("library.pe_cancel") }}</UiButton>
                <UiButton @click="submitAddEntry">{{ t("library.pe_add") }}</UiButton>
              </div>
            </div>

            <div class="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
              <p v-if="store.draft.entries.length === 0" class="py-6 text-center text-xs text-text-muted">
                {{ t("library.pe_noEntries") }}
              </p>
              <div
                v-for="(entry, index) in store.draft.entries"
                :key="entry.identifier"
                class="group flex items-center gap-1 rounded-md border px-2 py-1.5"
                :class="
                  store.selectedIdentifier === entry.identifier
                    ? 'border-signal-accent bg-panel'
                    : 'border-line-subtle hover:border-line-active'
                "
              >
                <input
                  type="checkbox"
                  class="shrink-0 accent-signal-accent"
                  :checked="entry.enabled"
                  :title="t('library.pe_enabled')"
                  @change="store.toggleEntry(entry.identifier)"
                />
                <button
                  type="button"
                  class="min-w-0 flex-1 truncate text-left text-xs"
                  :class="entry.enabled ? 'text-text-primary' : 'text-text-muted line-through'"
                  :title="entry.name || entry.identifier"
                  @click="store.selectEntry(entry.identifier)"
                >
                  {{ entry.name || entry.identifier }}
                </button>
                <div class="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <UiIconButton
                    :label="t('library.pe_moveUp')"
                    :disabled="store.saving || index === 0"
                    @click="store.moveEntry(entry.identifier, -1)"
                  >
                    <ChevronUp :size="13" :stroke-width="1.5" />
                  </UiIconButton>
                  <UiIconButton
                    :label="t('library.pe_moveDown')"
                    :disabled="store.saving || index === store.draft.entries.length - 1"
                    @click="store.moveEntry(entry.identifier, 1)"
                  >
                    <ChevronDown :size="13" :stroke-width="1.5" />
                  </UiIconButton>
                  <UiIconButton :label="t('library.pe_removeEntry')" :disabled="store.saving" @click="requestDelete(entry.identifier)">
                    <Trash2 :size="13" :stroke-width="1.5" />
                  </UiIconButton>
                </div>
              </div>
            </div>
          </div>

          <!-- 右：条目表单 -->
          <div class="min-h-0 flex-1 overflow-auto border-l border-line-subtle pl-3">
            <p v-if="!store.selectedEntry" class="py-10 text-center text-xs text-text-muted">
              {{ t("library.pe_selectEntryHint") }}
            </p>
            <PresetEntryForm v-else :entry="store.selectedEntry" @update="onEntryUpdate" />
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="store.saving" @click="requestClose">{{ t("library.pe_cancel") }}</UiButton>
      <UiButton :disabled="store.saving || !store.dirty" @click="onSave">
        <Loader2 v-if="store.saving" :size="14" :stroke-width="1.5" class="animate-spin" />
        {{ store.saving ? t("library.pe_saving") : t("library.pe_save") }}
      </UiButton>
    </template>
  </UiDialog>

  <UiConfirmDialog
    :open="deleteTarget !== null"
    :title="t('library.pe_removeEntry')"
    :message="t('library.pe_confirmRemoveEntry')"
    :confirm-label="t('library.delete')"
    :cancel-label="t('library.cancel')"
    tone="danger"
    @confirm="confirmDeleteEntry"
    @cancel="deleteTarget = null"
  />

  <UiConfirmDialog
    :open="confirmDiscard"
    :title="t('library.pe_discardTitle')"
    :message="t('library.pe_discardMessage')"
    :confirm-label="t('library.pe_discardTitle')"
    :cancel-label="t('library.pe_cancel')"
    tone="danger"
    @confirm="confirmDiscardClose"
    @cancel="confirmDiscard = false"
  />
</template>
