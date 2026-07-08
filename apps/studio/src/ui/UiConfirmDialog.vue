<script setup lang="ts">
/**
 * 二次确认对话框（SC2-1）。
 *
 * 基于 `UiDialog` 的标准破坏性操作确认（默认 danger 红色确认按钮）。文案由消费方注入，
 * 不内嵌 i18n。用于删除资产 / 删除条目等场景。
 */
import UiButton from "./UiButton.vue";
import UiDialog from "./UiDialog.vue";

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    busy?: boolean;
    /** 确认按钮基调：danger 用红色（默认），default 用中性色。 */
    tone?: "default" | "danger";
  }>(),
  { busy: false, tone: "danger" },
);

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <UiDialog :open="open" :title="title" size="sm" :busy="busy" @close="emit('cancel')">
    <p class="text-xs leading-relaxed text-text-secondary">{{ message }}</p>

    <template #footer>
      <UiButton variant="ghost" class="!h-7 !px-2.5 !text-xs" :disabled="busy" @click="emit('cancel')">
        {{ cancelLabel }}
      </UiButton>
      <UiButton
        class="!h-7 !px-2.5 !text-xs"
        :class="tone === 'danger' ? '!border-signal-error !text-signal-error hover:!bg-signal-error/10' : ''"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </UiButton>
    </template>
  </UiDialog>
</template>
