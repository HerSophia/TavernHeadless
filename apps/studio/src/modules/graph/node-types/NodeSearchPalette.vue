<script setup lang="ts">
/**
 * 节点搜索面板（NG2-6，`Shift+A` 唤起）。
 *
 * Blender 式的 fuzzy palette：一个搜索框 + 结果列表，回车 / 点击即在画布落点添加节点。
 * 复用现有 node-type-view 的构建 / 过滤逻辑，保持与「添加」菜单同源。
 */
import type { NodeGraphNodeTypeKnowledgeListItem } from "@tavern/core/node-graph";
import { Search } from "lucide-vue-next";
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { buildNodeTypeViewItems, filterNodeTypeViewItems, type NodeTypeViewItem } from "./node-type-view";

const props = defineProps<{
  entries: NodeGraphNodeTypeKnowledgeListItem[];
}>();

const emit = defineEmits<{
  (event: "add", payload: { type: string; typeVersion: string }): void;
  (event: "close"): void;
}>();

const { t, te } = useI18n();
const query = ref("");
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

const viewItems = computed(() => buildNodeTypeViewItems(props.entries, { t, te }));
const results = computed(() => filterNodeTypeViewItems(viewItems.value, { query: query.value }));

onMounted(async () => {
  await nextTick();
  inputRef.value?.focus();
});

function choose(item: NodeTypeViewItem): void {
  emit("add", { type: item.type, typeVersion: item.typeVersion });
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    emit("close");
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const item = results.value[activeIndex.value];
    if (item) {
      choose(item);
    }
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-app/60 p-4 pt-24" @click.self="$emit('close')">
    <div class="flex max-h-[28rem] w-full max-w-md flex-col overflow-hidden rounded-lg border border-line-active bg-panel shadow-xl">
  <div class="border-b border-line-subtle p-2">
        <label class="flex items-center gap-1.5 rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-muted focus-within:ring-1 focus-within:ring-signal-accent">
          <Search :size="13" :stroke-width="1.5" />
          <input
         ref="inputRef"
  v-model="query"
            class="min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
            :placeholder="t('graph.searchPanel.placeholder')"
            @keydown="onKeydown"
          />
        </label>
      </div>
      <div class="min-h-0 overflow-auto p-2">
        <p v-if="results.length === 0" class="px-2 py-6 text-center text-xs text-text-muted">
          {{ t("graph.searchPanel.noResults") }}
        </p>
        <button
          v-for="(item, index) in results"
     :key="`${item.type}@${item.typeVersion}`"
          type="button"
          class="mb-1 block w-full rounded-md border px-2 py-2 text-left transition-colors duration-150"
          :class="index === activeIndex
            ? 'border-signal-accent/60 bg-float'
            : 'border-line-subtle bg-float/40 hover:border-line-active hover:bg-float'"
          @click="choose(item)"
          @mouseenter="activeIndex = index"
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium text-text-secondary">{{ item.titleLabel }}</div>
              <div class="mt-0.5 truncate font-mono text-[10px] text-text-muted">{{ item.type }}</div>
            </div>
            <span v-if="item.sideEffects && item.sideEffects !== 'none'" class="shrink-0 rounded border border-line-subtle px-1 font-mono text-[9px] text-text-muted">
              {{ item.sideEffects }}
            </span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
