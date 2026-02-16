<script setup lang="ts">
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle
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
  <AlertDialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <AlertDialogPortal>
      <AlertDialogOverlay class="dialog-overlay" />
      <AlertDialogContent :class="contentClasses">
        <AlertDialogTitle class="dialog-title">{{ props.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="props.description" class="dialog-description">
          {{ props.description }}
        </AlertDialogDescription>
        <slot />
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
