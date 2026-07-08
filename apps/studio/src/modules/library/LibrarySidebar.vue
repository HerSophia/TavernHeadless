<script setup lang="ts" generic="T extends string">
/**
 * 资产库类目侧栏（SC2-9）。
 *
 * 竖向类目导航（图标 + 标签 + mono 计数），取代顶部 Tabs。当前项弱背景 + 左 2px accent 竖条。
 * `role=tablist`，上下方向键在类目间移动焦点并激活（roving tabindex）。文案 / 计数由消费方注入。
 */
import { ref, type Component } from "vue";

const props = defineProps<{
  modelValue: T;
  heading: string;
  items: Array<{ id: T; label: string; icon: Component; count: number }>;
}>();

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const listEl = ref<HTMLElement | null>(null);

function select(id: T): void {
  if (id !== props.modelValue) {
    emit("update:modelValue", id);
  }
}

function focusItem(index: number): void {
  const buttons = listEl.value?.querySelectorAll<HTMLButtonElement>("[role='tab']");
  buttons?.[index]?.focus();
}

/** 上下方向键在类目间循环移动焦点并激活。 */
function onKeydown(event: KeyboardEvent, index: number): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  event.preventDefault();
  const dir = event.key === "ArrowDown" ? 1 : -1;
  const count = props.items.length;
  if (count === 0) {
    return;
  }
  const next = (index + dir + count) % count;
  const item = props.items[next];
  if (item) {
    select(item.id);
    focusItem(next);
  }
}
</script>

<template>
  <aside class="flex w-56 shrink-0 flex-col border-r border-line-subtle bg-panel">
    <div class="flex h-11 shrink-0 items-center border-b border-line-subtle px-4">
      <span class="text-xs font-medium tracking-wide text-text-secondary">{{ heading }}</span>
    </div>

    <nav ref="listEl" role="tablist" class="flex flex-col gap-0.5 p-2">
      <button
        v-for="(item, index) in items"
        :key="item.id"
        type="button"
        role="tab"
        :aria-selected="modelValue === item.id"
        :tabindex="modelValue === item.id ? 0 : -1"
        class="group relative flex items-center gap-2.5 rounded-md py-2 pl-3 pr-2 text-sm transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :class="
          modelValue === item.id
            ? 'bg-float text-text-primary'
            : 'text-text-muted hover:bg-float/60 hover:text-text-secondary'
        "
        @click="select(item.id)"
        @keydown="onKeydown($event, index)"
      >
        <span
          v-if="modelValue === item.id"
          class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-signal-accent"
          aria-hidden="true"
        />
        <component
          :is="item.icon"
          :size="16"
          :stroke-width="1.5"
          class="shrink-0"
          :class="modelValue === item.id ? 'text-signal-accent' : ''"
        />
        <span class="min-w-0 flex-1 truncate text-left">{{ item.label }}</span>
        <span class="shrink-0 font-mono text-[11px] tabular-nums text-text-muted">{{ item.count }}</span>
      </button>
    </nav>
  </aside>
</template>
