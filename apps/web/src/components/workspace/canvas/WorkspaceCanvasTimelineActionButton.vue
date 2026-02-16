<script setup lang="ts">
import { computed } from "vue";

import UiIconActionButton from "../../ui/UiIconActionButton.vue";

type ActionTone = "danger" | "neutral" | "sky" | "teal";

const props = withDefaults(defineProps<{
  disabled?: boolean;
  tone?: ActionTone;
}>(), {
  disabled: false,
  tone: "neutral"
});

const toneClassMap: Record<ActionTone, string> = {
  danger: "hover:border-signal-error/60 hover:text-signal-error",
  neutral: "hover:border-zinc-500 hover:text-zinc-200",
  sky: "hover:border-sky-400/60 hover:text-sky-300",
  teal: "hover:border-teal-400/60 hover:text-teal-300"
};

const buttonClass = computed(() => {
  return `rounded border border-zinc-700/60 px-1 py-0.5 text-zinc-500 opacity-0 transition group-hover:opacity-100 ${toneClassMap[props.tone]}`;
});

defineEmits<{ click: [] }>();
</script>

<template>
  <UiIconActionButton :class="buttonClass" :disabled="props.disabled" @click="$emit('click')">
    <slot />
  </UiIconActionButton>
</template>
