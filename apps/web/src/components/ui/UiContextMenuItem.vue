<script setup lang="ts">
const props = withDefaults(defineProps<{
  danger?: boolean;
  disabled?: boolean;
}>(), {
  danger: false,
  disabled: false
});
</script>

<template>
  <button class="context-menu-item" :class="props.danger ? 'danger' : ''" :disabled="props.disabled" type="button">
    <slot />
  </button>
</template>
