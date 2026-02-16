<script setup lang="ts">
withDefaults(
  defineProps<{
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  {
    disabled: false,
    type: "button"
  }
);
</script>

<template>
  <button
    :disabled="disabled"
    :type="type"
  >
    <slot />
  </button>
</template>
