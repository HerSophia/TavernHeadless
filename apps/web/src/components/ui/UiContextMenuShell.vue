<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  dataAttribute?: "data-asset-context-menu" | "data-context-menu";
  visible: boolean;
  x: number;
  y: number;
}>(), {
  dataAttribute: "data-context-menu"
});

const rootAttributes = computed<Record<string, string>>(() => {
  return {
    [props.dataAttribute]: ""
  };
});

const rootStyle = computed(() => {
  return {
    left: `${props.x}px`,
    top: `${props.y}px`
  };
});
</script>

<template>
  <div v-if="props.visible" class="context-menu" :style="rootStyle" v-bind="rootAttributes">
    <slot />
  </div>
</template>
