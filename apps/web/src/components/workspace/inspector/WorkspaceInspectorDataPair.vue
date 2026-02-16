<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string;
  labelClass?: string;
  value: string;
  valueClass?: string;
}>(), {
  labelClass: "font-mono text-xs text-zinc-500",
  valueClass: "font-mono text-xs text-zinc-300"
});
</script>

<template>
  <div class="flex items-center justify-between">
    <span :class="props.labelClass">{{ props.label }}</span>
    <span :class="props.valueClass">{{ props.value }}</span>
  </div>
</template>
