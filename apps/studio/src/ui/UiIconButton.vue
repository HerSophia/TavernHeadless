<script setup lang="ts">
defineProps<{
  label: string;
  active?: boolean;
}>();
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :title="label"
    class="inline-flex size-8 items-center justify-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-float hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
    :class="active ? 'bg-float text-text-primary' : ''"
  >
    <slot />
  </button>
</template>
