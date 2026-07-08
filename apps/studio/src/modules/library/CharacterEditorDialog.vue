<script setup lang="ts">
/**
 * 角色卡编辑器对话框（SC2-8 / 方向 4）。
 *
 * `UiDialog`（xl）承载：头部角色名（必填）+ 修订徽标 + 脏态点；单列分区表单
 * （基础 / 人设 / 开场白 / 指令 / 元信息）；底部保存 / 冲突条幅 / 错误提示。
 * 保存走整快照 `createVersion` + `expectedRevision` 乐观锁（`useCharacterEditorStore`）；
 * 脏态关闭二次确认丢弃；409 冲突展示条幅 + 「重新加载」（手动，避免静默丢弃长文本编辑）。
 * 头像 / 内嵌世界书 / 扩展等未暴露字段作为 passthrough 原样保留。业务态全在 store。
 */
import { Loader2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { CharacterDraft } from "../../lib/assets/character-editor-model";
import { useCharacterEditorStore } from "../../stores/character-editor";
import UiBadge from "../../ui/UiBadge.vue";
import UiButton from "../../ui/UiButton.vue";
import UiConfirmDialog from "../../ui/UiConfirmDialog.vue";
import UiDialog from "../../ui/UiDialog.vue";
import UiTextInput from "../../ui/UiTextInput.vue";

const props = defineProps<{ open: boolean; characterId: string | null; characterName?: string }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const store = useCharacterEditorStore();

const confirmDiscard = ref(false);

// --- 生命周期：跟随 open / characterId 打开或关闭编辑会话 ---
watch(
  () => (props.open ? props.characterId : null),
  (id) => {
    if (id) {
      void store.openEditor(id);
    } else {
      store.close();
    }
  },
  { immediate: true },
);

const dialogTitle = computed(() =>
  props.characterName ? `${t("library.ce_title")} · ${props.characterName}` : t("library.ce_title"),
);

const fieldClass =
  "w-full rounded-md border border-line-subtle bg-float px-2.5 py-1.5 text-sm text-text-primary transition-colors duration-150 placeholder:text-text-muted hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent";

/** 单字段双向绑定工厂：读 `store.draft[key]`、写经 `store.updateField`。 */
function textModel(key: keyof CharacterDraft) {
  return computed<string>({
    get: () => store.draft?.[key] ?? "",
    set: (value) => store.updateField({ [key]: value } as Partial<CharacterDraft>),
  });
}

const name = textModel("name");
const nickname = textModel("nickname");
const creator = textModel("creator");
const characterVersion = textModel("characterVersion");
const description = textModel("description");
const personality = textModel("personality");
const scenario = textModel("scenario");
const exampleDialogue = textModel("exampleDialogue");
const primaryGreeting = textModel("primaryGreeting");
const alternateGreetings = textModel("alternateGreetings");
const systemPrompt = textModel("systemPrompt");
const postHistoryInstructions = textModel("postHistoryInstructions");
const creatorNotes = textModel("creatorNotes");
const tags = textModel("tags");

/** 非冲突错误的展示文案（conflict 走条幅；unknown 显原始 message）。 */
const errorText = computed(() => {
  const err = store.lastError;
  if (!err || err.kind === "conflict") {
    return "";
  }
  if (err.kind === "busy") {
    return t("library.ce_err_busy");
  }
  if (err.kind === "forbidden") {
    return t("library.ce_err_forbidden");
  }
  return err.message;
});

async function onSave(): Promise<void> {
  const ok = await store.save();
  if (ok) {
    emit("close");
  }
}

function onReload(): void {
  void store.reload();
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
</script>

<template>
  <UiDialog :open="open" :title="dialogTitle" size="xl" :busy="store.saving" @close="requestClose">
    <div class="flex h-[70vh] min-h-0 flex-col">
      <!-- 冲突条幅 / 错误提示 -->
      <div
        v-if="store.lastError?.kind === 'conflict'"
        class="mb-3 flex items-center justify-between gap-3 rounded-md border border-signal-warn/40 bg-signal-warn/10 px-3 py-2 text-xs text-signal-warn"
      >
        <span>{{ t("library.ce_err_conflict") }}</span>
        <UiButton variant="ghost" @click="onReload">{{ t("library.ce_reload") }}</UiButton>
      </div>
      <p
        v-else-if="errorText"
        class="mb-3 rounded-md border border-signal-error/40 bg-signal-error/10 px-3 py-2 text-xs text-signal-error"
      >
        {{ errorText }}
      </p>

      <p v-if="store.loading" class="py-10 text-center text-xs text-text-muted">…</p>

      <template v-else-if="store.draft">
        <!-- 头部：角色名 + 修订徽标 + 脏态 -->
        <div class="flex items-center gap-2 pb-1">
          <div class="flex-1">
            <UiTextInput
              v-model="name"
              :placeholder="t('library.ce_namePlaceholder')"
              :aria-label="t('library.ce_name')"
              :invalid="store.nameInvalid"
              :disabled="store.saving"
            />
          </div>
          <UiBadge>{{ t("library.ce_revision") }} {{ store.expectedRevision }}</UiBadge>
          <span v-if="store.dirty" class="inline-flex items-center gap-1 text-xs text-signal-warn">
            <span class="h-1.5 w-1.5 rounded-full bg-signal-warn"></span>{{ t("library.ce_dirty") }}
          </span>
        </div>
        <p v-if="store.nameInvalid" class="pb-2 text-xs text-signal-error">{{ t("library.ce_nameRequired") }}</p>

        <!-- 表单主体（单列分区，可滚） -->
        <div class="min-h-0 flex-1 space-y-5 overflow-auto border-t border-line-subtle pt-3 pr-1">
          <!-- 基础 -->
          <section class="space-y-3">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("library.ce_section_basic") }}</h4>
            <div class="grid grid-cols-3 gap-3">
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.ce_nickname") }}</span>
                <UiTextInput v-model="nickname" :aria-label="t('library.ce_nickname')" :disabled="store.saving" />
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.ce_creator") }}</span>
                <UiTextInput v-model="creator" :aria-label="t('library.ce_creator')" :disabled="store.saving" />
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.ce_characterVersion") }}</span>
                <UiTextInput
                  v-model="characterVersion"
                  :aria-label="t('library.ce_characterVersion')"
                  :disabled="store.saving"
                />
              </label>
            </div>
          </section>

          <!-- 人设 -->
          <section class="space-y-3">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("library.ce_section_persona") }}</h4>
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.ce_description") }}</span>
              <textarea v-model="description" rows="5" :class="fieldClass" :disabled="store.saving"></textarea>
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.ce_personality") }}</span>
                <textarea v-model="personality" rows="3" :class="fieldClass" :disabled="store.saving"></textarea>
              </label>
              <label class="block space-y-1">
                <span class="text-xs text-text-muted">{{ t("library.ce_scenario") }}</span>
                <textarea v-model="scenario" rows="3" :class="fieldClass" :disabled="store.saving"></textarea>
              </label>
            </div>
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.ce_exampleDialogue") }}</span>
              <textarea v-model="exampleDialogue" rows="4" :class="fieldClass" :disabled="store.saving"></textarea>
            </label>
          </section>

          <!-- 开场白 -->
          <section class="space-y-3">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("library.ce_section_greeting") }}</h4>
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.ce_primaryGreeting") }}</span>
              <textarea v-model="primaryGreeting" rows="3" :class="fieldClass" :disabled="store.saving"></textarea>
            </label>
            <label class="block space-y-1">
              <span class="flex items-center justify-between text-xs text-text-muted">
                {{ t("library.ce_alternateGreetings") }}
                <span class="text-[11px] text-text-muted">{{ t("library.ce_alternateGreetingsHint") }}</span>
              </span>
              <textarea v-model="alternateGreetings" rows="4" :class="fieldClass" :disabled="store.saving"></textarea>
            </label>
          </section>

          <!-- 指令 -->
          <section class="space-y-3">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("library.ce_section_instructions") }}</h4>
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.ce_systemPrompt") }}</span>
              <textarea v-model="systemPrompt" rows="3" :class="fieldClass" :disabled="store.saving"></textarea>
            </label>
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.ce_postHistoryInstructions") }}</span>
              <textarea
                v-model="postHistoryInstructions"
                rows="3"
                :class="fieldClass"
                :disabled="store.saving"
              ></textarea>
            </label>
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">{{ t("library.ce_creatorNotes") }}</span>
              <textarea v-model="creatorNotes" rows="2" :class="fieldClass" :disabled="store.saving"></textarea>
            </label>
          </section>

          <!-- 元信息 -->
          <section class="space-y-3">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("library.ce_section_meta") }}</h4>
            <label class="block space-y-1">
              <span class="flex items-center justify-between text-xs text-text-muted">
                {{ t("library.ce_tags") }}
                <span class="text-[11px] text-text-muted">{{ t("library.ce_tagsHint") }}</span>
              </span>
              <UiTextInput v-model="tags" :aria-label="t('library.ce_tags')" :disabled="store.saving" />
            </label>
          </section>

          <p class="rounded-md bg-float px-2.5 py-1.5 text-[11px] leading-relaxed text-text-muted">
            {{ t("library.ce_passthroughHint") }}
          </p>
        </div>
      </template>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="store.saving" @click="requestClose">{{ t("library.ce_cancel") }}</UiButton>
      <UiButton :disabled="store.saving || !store.dirty || store.nameInvalid" @click="onSave">
        <Loader2 v-if="store.saving" :size="14" :stroke-width="1.5" class="animate-spin" />
        {{ store.saving ? t("library.ce_saving") : t("library.ce_save") }}
      </UiButton>
    </template>
  </UiDialog>

  <UiConfirmDialog
    :open="confirmDiscard"
    :title="t('library.ce_discardTitle')"
    :message="t('library.ce_discardMessage')"
    :confirm-label="t('library.ce_discardTitle')"
    :cancel-label="t('library.ce_cancel')"
    tone="danger"
    @confirm="confirmDiscardClose"
    @cancel="confirmDiscard = false"
  />
</template>
