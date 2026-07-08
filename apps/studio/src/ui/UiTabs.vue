<script setup lang="ts" generic="T extends string">
/**
 * 受控 tab 头（SC2-1）。
 *
 * 只渲染 tab 头（下划线态，风格对齐 LibraryView 的 nav），面板正文由消费方自渲染。
 * 支持图标与计数徽标；`role=tablist / tab` + `aria-selected`，方向键在 tab 间移动焦点（roving tabindex）。
 * 不承载业务文案，label 由消费方传入。
 */
import { ref, type Component } from "vue";

import { formatBadgeCount } from "./badge-format";
import UiBadge from "./UiBadge.vue";

const props = withDefaults(
  defineProps<{
    modelValue: T;
    /** tab 定义；count 为计数徽标（null / 省略则不显示徽标）。 */
    tabs: Array<{ id: T; label: string; icon?: Component; count?: number | null }>;
    size?: "sm" | "md";
  }>(),
  { size: "md" },
);

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const listEl = ref<HTMLElement | null>(null);

const SIZE_CLASS: Record<NonNullable<typeof props.size>, string> = {
  sm: "gap-1.5 px-2.5 py-2 text-[11px]",
  md: "gap-1.5 px-3 py-2.5 text-xs",
};

function select(id: T): void {
  if (id !== props.modelValue) {
    emit("update:modelValue", id);
  }
}

function focusTab(index: number): void {
  const buttons = listEl.value?.querySelectorAll<HTMLButtonElement>("[role='tab']");
  buttons?.[index]?.focus();
}

/** 方向键在 tab 间循环移动焦点并激活（automatic activation）。 */
function onKeydown(event: KeyboardEvent, index: number): void {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
    return;
  }
  event.preventDefault();
  const dir = event.key === "ArrowRight" ? 1 : -1;
  const count = props.tabs.length;
  if (count === 0) {
    return;
  }
  const next = (index + dir + count) % count;
  const nextTab = props.tabs[next];
  if (nextTab) {
    select(nextTab.id);
    focusTab(next);
  }
}
</script>

<template>
  <div
    ref="listEl"
    role="tablist"
    class="flex items-center gap-1 border-b border-line-subtle bg-panel px-1"
  >
    <button
      v-for="(item, index) in tabs"
      :key="item.id"
      type="button"
      role="tab"
      :aria-selected="modelValue === item.id"
      :tabindex="modelValue === item.id ? 0 : -1"
      class="inline-flex items-center border-b-2 transition-colors duration-150 focus:outline-none"
      :class="[
        SIZE_CLASS[size],
        modelValue === item.id
          ? 'border-b-signal-accent text-text-primary'
          : 'border-b-transparent text-text-muted hover:text-text-secondary',
      ]"
      @click="select(item.id)"
      @keydown="onKeydown($event, index)"
    >
      <component :is="item.icon" v-if="item.icon" :size="14" :stroke-width="1.5" />
      <span>{{ item.label }}</span>
      <UiBadge v-if="item.count != null" :tone="modelValue === item.id ? 'accent' : 'neutral'">
        {{ formatBadgeCount(item.count ?? 0) }}
      </UiBadge>
    </button>
  </div>
</template>
