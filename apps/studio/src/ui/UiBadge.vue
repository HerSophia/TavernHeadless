<script setup lang="ts">
/**
 * 小徽标（SC2-1）：计数 / 状态标记。用于 tab 计数、卡片来源 / 状态等。
 * 内容由默认插槽注入（数字或短文本），不承载业务文案。
 */
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    tone?: "neutral" | "accent" | "success" | "error" | "muted";
    size?: "xs" | "sm";
  }>(),
  { tone: "neutral", size: "xs" },
);

const TONE_CLASS: Record<NonNullable<typeof props.tone>, string> = {
  neutral: "border-line-subtle text-text-secondary",
  accent: "border-signal-accent/40 text-signal-accent",
  success: "border-signal-success/40 text-signal-success",
  error: "border-signal-error/40 text-signal-error",
  muted: "border-transparent text-text-muted",
};

const SIZE_CLASS: Record<NonNullable<typeof props.size>, string> = {
  xs: "h-4 min-w-4 px-1 text-[10px]",
  sm: "h-5 min-w-5 px-1.5 text-[11px]",
};

const toneClass = computed(() => TONE_CLASS[props.tone]);
const sizeClass = computed(() => SIZE_CLASS[props.size]);
</script>

<template>
  <span
    class="inline-flex items-center justify-center rounded border font-mono leading-none"
    :class="[toneClass, sizeClass]"
  >
    <slot />
  </span>
</template>
