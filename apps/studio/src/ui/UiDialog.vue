<script setup lang="ts">
/**
 * 通用模态基座（SC2-1）。
 *
 * 提供可复用的模态壳：Teleport 到 body、遮罩、居中、尺寸、关闭手势（Esc / 点击遮罩）、
 * 忙态防误关、body 滚动锁（引用计数）、初始聚焦与关闭后焦点恢复、基础 aria。内容全部由插槽注入，
 * 不承载任何业务文案（标题 / 正文 / 底部由消费方传入）。
 *
 * 焦点陷阱（Tab 循环）作为后续增强，本版只做「初始聚焦 + 关闭恢复」。
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

import { acquireScrollLock, releaseScrollLock } from "./dialog-stack";

const props = withDefaults(
  defineProps<{
    /** 是否打开（受控）。 */
    open: boolean;
    /** 标题文案（可选；也可用 #title 插槽完全自定义）。 */
    title?: string;
    /** 面板尺寸（宽度预设；wide 为动态 80vw 多列布局并固定 80vh 高度）。 */
    size?: "sm" | "md" | "lg" | "xl" | "wide";
    /** 覆盖正文区容器类（默认 `overflow-auto px-4 py-3`）。用于需要自管理滚动 / 贴边布局的对话框。 */
    bodyClass?: string;
    /** 点击遮罩是否关闭。 */
    closeOnOverlay?: boolean;
    /** 按 Esc 是否关闭。 */
    closeOnEsc?: boolean;
    /** 忙态：为真时不响应遮罩 / Esc 关闭，防止误关正在提交的表单。 */
    busy?: boolean;
  }>(),
  { title: undefined, size: "md", bodyClass: undefined, closeOnOverlay: true, closeOnEsc: true, busy: false },
);

const emit = defineEmits<{ close: [] }>();

const SIZE_CLASS: Record<NonNullable<typeof props.size>, string> = {
  sm: "w-full max-w-sm",
  md: "w-full max-w-lg",
  lg: "w-full max-w-2xl",
  xl: "w-full max-w-4xl",
  // wide：动态 80% 视口宽（带上限）+ 固定 80vh 高，供多列浏览类对话框（如新建会话）用。
  wide: "w-[80vw] max-w-[1280px] h-[80vh]",
};

/** 标题元素 id，用于 aria-labelledby 关联；每个实例唯一。 */
const titleId = `ui-dialog-title-${Math.random().toString(36).slice(2, 9)}`;

const panel = ref<HTMLElement | null>(null);
/** 打开前的焦点元素，关闭后恢复。 */
let previouslyFocused: HTMLElement | null = null;
/** 本实例是否持有滚动锁，避免重复释放。 */
let locked = false;

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && props.closeOnEsc && !props.busy) {
    event.preventDefault();
    emit("close");
  }
}

function onOverlayClick(): void {
  if (props.closeOnOverlay && !props.busy) {
    emit("close");
  }
}

function activate(): void {
  if (typeof document !== "undefined") {
    previouslyFocused = document.activeElement as HTMLElement | null;
  }
  acquireScrollLock();
  locked = true;
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", onKeydown);
  }
  void nextTick(() => {
    panel.value?.focus();
  });
}

function deactivate(): void {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", onKeydown);
  }
  if (locked) {
    releaseScrollLock();
    locked = false;
  }
  const target = previouslyFocused;
  previouslyFocused = null;
  if (target && typeof target.focus === "function") {
    void nextTick(() => target.focus());
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      activate();
    } else {
      deactivate();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", onKeydown);
  }
  if (locked) {
    releaseScrollLock();
    locked = false;
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-app/70 p-4"
      @click.self="onOverlayClick"
    >
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title || $slots.title ? titleId : undefined"
        tabindex="-1"
        class="flex max-h-[85vh] flex-col rounded-lg border border-line-active bg-panel shadow-[0_4px_16px_-8px_rgba(0,0,0,0.5)] focus:outline-none"
        :class="SIZE_CLASS[size]"
      >
        <header
          v-if="title || $slots.title"
          class="flex shrink-0 items-center border-b border-line-subtle px-4 py-3"
        >
          <h2 :id="titleId" class="text-sm font-medium text-text-primary">
            <slot name="title">{{ title }}</slot>
          </h2>
        </header>

        <div class="min-h-0 flex-1 text-sm text-text-secondary" :class="bodyClass ?? 'overflow-auto px-4 py-3'">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="flex shrink-0 items-center justify-end gap-2 border-t border-line-subtle px-4 py-3"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
