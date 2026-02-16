<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  disabled?: boolean;
  type?: "button" | "reset" | "submit";
  variant?: "danger" | "default" | "primary";
}>(), {
  disabled: false,
  type: "button",
  variant: "default"
});

const variantClass = computed(() => {
  if (props.variant === "danger") {
    return "dialog-btn-danger";
  }

  if (props.variant === "primary") {
    return "dialog-btn-primary";
  }

  return "";
});
</script>

<template>
  <button :class="['dialog-btn', variantClass]" :disabled="props.disabled" :type="props.type">
    <slot />
  </button>
</template>
