<script setup lang="ts">
import { Send, Square } from "lucide-vue-next";
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import UiButton from "../../../ui/UiButton.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";

const props = defineProps<{
  disabled?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (event: "send", text: string): void;
  (event: "stop"): void;
}>();

const { t } = useI18n();

const text = ref("");
const textarea = ref<HTMLTextAreaElement | null>(null);

function autoGrow(): void {
  const el = textarea.value;
  if (!el) {
    return;
  }
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

watch(text, () => {
  void nextTick(autoGrow);
});

function submit(): void {
  if (props.disabled || props.busy) {
    return;
  }
  const value = text.value.trim();
  if (!value) {
    return;
  }
  emit("send", value);
  text.value = "";
  void nextTick(autoGrow);
}
</script>

<template>
  <div class="flex items-end gap-2 border-t border-line-subtle bg-panel px-3 py-2.5">
    <textarea
      ref="textarea"
      v-model="text"
      rows="1"
      spellcheck="false"
      :disabled="disabled"
      :placeholder="disabled ? t('graphAssistant.composerDisabled') : t('graphAssistant.composerPlaceholder')"
      class="max-h-[120px] min-h-9 flex-1 resize-none rounded-md border border-line-subtle bg-float px-3 py-2 text-sm leading-relaxed text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:cursor-not-allowed disabled:opacity-50"
      @keydown.enter.exact.prevent="submit"
    />
    <UiIconButton
      v-if="busy"
      :label="t('graphAssistant.stop')"
      @click="emit('stop')"
    >
      <Square :size="15" :stroke-width="1.5" />
    </UiIconButton>
    <UiButton
      v-else
      :disabled="disabled || text.trim().length === 0"
      @click="submit"
    >
      <Send :size="14" :stroke-width="1.5" />
      {{ t("graphAssistant.send") }}
    </UiButton>
  </div>
</template>
