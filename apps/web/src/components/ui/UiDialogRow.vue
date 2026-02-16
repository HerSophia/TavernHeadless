<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string;
  rowClass?: string;
}>(), {
  rowClass: ""
});
</script>

<template>
  <div :class="['dialog-row', props.rowClass]">
    <span class="dialog-label">{{ props.label }}</span>
    <slot />
  </div>
</template>
