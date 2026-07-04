<script setup lang="ts">
/**
 * 通用下拉容器：触发器 + 悬浮面板。
 *
 * 触发器通过 `#trigger` 插槽自定义（暴露 `toggle` 与 `open`），面板内容走默认插槽
 * （暴露 `close`，供菜单项点击后收起）。点击组件外部或按 Esc 自动关闭。
 * 仅负责开合与定位，视觉层次由调用方与令牌化样式表达（1px 细线 + 背景层差，无阴影堆叠）。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";

withDefaults(
  defineProps<{
    /** 面板对齐方向（相对触发器）。 */
    align?: "left" | "right";
    /**面板宽度（如 "16rem"）；不传则由内容撑开。 */
    panelWidth?: string;
  }>(),
  { align: "left", panelWidth: undefined },
);

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function toggle(): void {
  open.value = !open.value;
}

function close(): void {
  open.value = false;
}

function onDocumentPointerDown(event: MouseEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) {
    close();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    close();
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onDocumentPointerDown);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointerDown);
  document.removeEventListener("keydown", onKeydown);
});

defineExpose({ close });
</script>

<template>
  <div ref="root" class="relative">
    <slot name="trigger" :toggle="toggle" :open="open"/>

    <div
      v-if="open"
      class="absolute top-9 z-30 flex flex-col overflow-hidden rounded-lg border border-line-active bg-panel py-1"
      :class="align === 'right' ? 'right-0' : 'left-0'"
      :style="panelWidth ? { width: panelWidth } : undefined"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
