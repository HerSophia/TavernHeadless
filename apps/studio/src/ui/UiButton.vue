<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "default" | "ghost";
    type?: "button" | "submit";
  }>(),
  { variant: "default", type: "button" }
);
</script>

<template>
  <button
    :type="type"
    class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:cursor-not-allowed disabled:opacity-40"
    :class="
      variant === 'default'
        ? 'border-line-subtle bg-float text-text-primary hover:border-line-active'
        : 'border-transparent text-text-secondary hover:bg-float hover:text-text-primary'
    "
  >
    <slot />
  </button>
</template>
