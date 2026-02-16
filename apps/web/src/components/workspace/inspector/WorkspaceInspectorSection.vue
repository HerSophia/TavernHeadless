<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string;
}>(), {});
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-400">{{ props.title }}</h3>
      <slot name="header-end" />
    </div>
    <slot />
  </div>
</template>
