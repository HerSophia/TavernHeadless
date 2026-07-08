<script setup lang="ts">
/**
 * 分步重跑步号输入对话框（SC1-6）。
 *
 * 提供最小可用的 1-based 起始步输入：起始步及其之后被重新生成，之前的成功工具往返保留。
 * 明确提示“起始步之前的写类副作用不会回滚”。步号合法性以服务端校验兜底，本地仅做整数 / ≥1 约束。
 * 风格对齐 ConfirmDialog（1px 细线浮层 + 半透明遮罩）。
 */
import { nextTick, ref, watch } from "vue";

import UiButton from "../../ui/UiButton.vue";

const props = defineProps<{
  open: boolean;
  title: string;
  label: string;
  hint: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
}>();

const emit = defineEmits<{ confirm: [fromStepIndex: number]; cancel: [] }>();

const step = ref(1);
const inputEl = ref<HTMLInputElement | null>(null);

// 每次打开重置为 1 并聚焦，避免残留上次输入。
watch(
  () => props.open,
  async (open) => {
    if (open) {
      step.value = 1;
      await nextTick();
      inputEl.value?.focus();
      inputEl.value?.select();
    }
  },
);

function onConfirm(): void {
  const value = Math.floor(Number(step.value));
  emit("confirm", Number.isFinite(value) ? value : 0);
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-app/70 p-4"
    @click.self="emit('cancel')"
  >
    <div class="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line-active bg-panel p-4">
      <h2 class="text-sm font-medium text-text-primary">{{ title }}</h2>
      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-text-secondary">{{ label }}</span>
        <input
          ref="inputEl"
          v-model.number="step"
          type="number"
          min="1"
          step="1"
          class="w-full rounded border border-line-active bg-float px-2 py-1 text-sm text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :disabled="busy"
          @keydown.enter.prevent="onConfirm"
        />
      </label>
      <p class="text-[11px] leading-relaxed text-signal-warn">{{ hint }}</p>
      <div class="mt-1 flex justify-end gap-2">
        <UiButton variant="ghost" class="!h-7 !px-2.5 !text-xs" :disabled="busy" @click="emit('cancel')">
          {{ cancelLabel }}
        </UiButton>
        <UiButton class="!h-7 !px-2.5 !text-xs" :disabled="busy" @click="onConfirm">
          {{ confirmLabel }}
        </UiButton>
      </div>
    </div>
  </div>
</template>
