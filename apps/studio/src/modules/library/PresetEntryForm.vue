<script setup lang="ts">
/**
 * 预设条目表单（SC2-7 / 方向 3）。
 *
 * 受控表单：编辑选中条目的已知字段；每次变更以 patch 上抛，由父组件写入
 * `preset-editor` store（`updateEntryField`）。identifier 只读；
 * `injectionTrigger` / `extra` 为 passthrough，不在此暴露（原样保留）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import type { PresetEntryDraft, PresetEntryRole } from "../../lib/assets/preset-editor-model";
import UiSelect from "../../ui/UiSelect.vue";
import UiTextInput from "../../ui/UiTextInput.vue";

const props = defineProps<{ entry: PresetEntryDraft }>();
const emit = defineEmits<{ update: [patch: Partial<PresetEntryDraft>] }>();

const { t } = useI18n();

const fieldClass =
  "w-full rounded-md border border-line-subtle bg-float px-2.5 py-1.5 text-sm text-text-primary transition-colors duration-150 placeholder:text-text-muted hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent";

const roleOptions = computed<Array<{ value: PresetEntryRole; label: string }>>(() => [
  { value: "system", label: t("library.pe_role_system") },
  { value: "user", label: t("library.pe_role_user") },
  { value: "assistant", label: t("library.pe_role_assistant") },
]);

const nameModel = computed<string>({
  get: () => props.entry.name,
  set: (value) => emit("update", { name: value }),
});
const roleModel = computed<PresetEntryRole>({
  get: () => props.entry.role,
  set: (value) => emit("update", { role: value }),
});
const contentModel = computed<string>({
  get: () => props.entry.content,
  set: (value) => emit("update", { content: value }),
});
const systemPromptModel = computed<boolean>({
  get: () => props.entry.systemPrompt,
  set: (value) => emit("update", { systemPrompt: value }),
});
const markerModel = computed<boolean>({
  get: () => props.entry.marker,
  set: (value) => emit("update", { marker: value }),
});
const forbidOverridesModel = computed<boolean>({
  get: () => Boolean(props.entry.forbidOverrides),
  set: (value) => emit("update", { forbidOverrides: value }),
});

/** 空 → undefined；非法 → 忽略（保留旧值）。 */
function toOptionalInt(raw: string): number | undefined | "invalid" {
  const value = raw.trim();
  if (value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : "invalid";
}

function onPositionInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (raw === "") {
    return; // 必填数值：留空时保留旧值
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) {
    emit("update", { injectionPosition: Math.trunc(parsed) });
  }
}
function onDepthInput(event: Event): void {
  const next = toOptionalInt((event.target as HTMLInputElement).value);
  if (next !== "invalid") {
    emit("update", { injectionDepth: next });
  }
}
function onOrderInput(event: Event): void {
  const next = toOptionalInt((event.target as HTMLInputElement).value);
  if (next !== "invalid") {
    emit("update", { injectionOrder: next });
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <span class="text-xs text-text-muted">{{ t("library.pe_identifier") }}</span>
      <span class="truncate font-mono text-xs text-text-secondary" :title="entry.identifier">{{ entry.identifier }}</span>
    </div>

    <label class="block space-y-1">
      <span class="text-xs text-text-muted">{{ t("library.pe_name") }}</span>
      <UiTextInput v-model="nameModel" :aria-label="t('library.pe_name')" />
    </label>

    <div class="grid grid-cols-2 gap-3">
      <label class="block space-y-1">
        <span class="text-xs text-text-muted">{{ t("library.pe_role") }}</span>
        <UiSelect v-model="roleModel" :options="roleOptions" />
      </label>
      <label class="block space-y-1">
        <span class="text-xs text-text-muted">{{ t("library.pe_injectionPosition") }}</span>
        <input type="number" :value="entry.injectionPosition" :class="fieldClass" @input="onPositionInput" />
      </label>
      <label class="block space-y-1">
        <span class="text-xs text-text-muted">{{ t("library.pe_injectionDepth") }}</span>
        <input type="number" :value="entry.injectionDepth ?? ''" :class="fieldClass" @input="onDepthInput" />
      </label>
      <label class="block space-y-1">
        <span class="text-xs text-text-muted">{{ t("library.pe_injectionOrder") }}</span>
        <input type="number" :value="entry.injectionOrder ?? ''" :class="fieldClass" @input="onOrderInput" />
      </label>
    </div>

    <label class="block space-y-1">
      <span class="text-xs text-text-muted">{{ t("library.pe_content") }}</span>
      <textarea v-model="contentModel" rows="8" :class="fieldClass"></textarea>
    </label>

    <div class="flex flex-wrap gap-4 pt-1">
      <label class="flex items-center gap-1.5 text-xs text-text-secondary">
        <input v-model="systemPromptModel" type="checkbox" class="accent-signal-accent" />
        {{ t("library.pe_systemPrompt") }}
      </label>
      <label class="flex items-center gap-1.5 text-xs text-text-secondary">
        <input v-model="markerModel" type="checkbox" class="accent-signal-accent" />
        {{ t("library.pe_marker") }}
      </label>
      <label class="flex items-center gap-1.5 text-xs text-text-secondary">
        <input v-model="forbidOverridesModel" type="checkbox" class="accent-signal-accent" />
        {{ t("library.pe_forbidOverrides") }}
      </label>
    </div>

    <p class="rounded-md bg-float px-2.5 py-1.5 text-[11px] leading-relaxed text-text-muted">
      {{ t("library.pe_passthroughHint") }}
    </p>
  </div>
</template>
