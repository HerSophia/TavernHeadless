<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from "radix-vue";
import { computed } from "vue";

const props = withDefaults(defineProps<{
  contentClass?: string;
  description?: string;
  open: boolean;
  title: string;
  width?: "default" | "sm";
}>(), {
  contentClass: "",
  description: "",
  width: "default"
});

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const contentClasses = computed(() => {
  return [
    "dialog-content",
    props.width === "sm" ? "dialog-content-sm" : "",
    props.contentClass
  ];
});
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent :class="contentClasses">
        <DialogTitle class="dialog-title">{{ props.title }}</DialogTitle>
        <DialogDescription v-if="props.description" class="dialog-description">
          {{ props.description }}
        </DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
