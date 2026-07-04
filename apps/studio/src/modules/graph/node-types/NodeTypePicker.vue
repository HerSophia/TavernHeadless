<script setup lang="ts">
import type { NodeGraphDocument, NodeGraphNodeTypeKnowledgeListItem } from "@tavern/core/node-graph";
import { Plus, Search, Workflow } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import UiButton from "../../../ui/UiButton.vue";
import {
  buildNodeTypeViewItems,
  filterNodeTypeViewItems,
  groupNodeTypeViewItemsByCategory,
  type NodeTypeViewItem,
} from "./node-type-view";

const props = withDefaults(
  defineProps<{
    entries: NodeGraphNodeTypeKnowledgeListItem[];
    disabled?: boolean;
    /** SG11-2：内置顾问子图清单（合并进「添加」菜单顶部作为一个分区）。 */
    advisorSubgraphs?: NodeGraphDocument[];
    /** 顾问子图分区是否可用（需项目上下文 + 有文档 + 非保存中）。 */
    canInsertSubgraph?: boolean;
    /** 顾问子图显示名解析（缺省回退 core 英文名）。 */
    advisorLabel?: (graph: NodeGraphDocument) => string;
  }>(),
  { disabled: false, advisorSubgraphs: () => [], canInsertSubgraph: false, advisorLabel: undefined },
);

const emit = defineEmits<{
  (event: "add", payload: { type: string; typeVersion: string }): void;
  (event: "insert-subgraph", graphId: string): void;
}>();

const { t, te } = useI18n();
const open = ref(false);
const query = ref("");

const viewItems = computed(() => buildNodeTypeViewItems(props.entries, { t, te }));
const filteredItems = computed(() => filterNodeTypeViewItems(viewItems.value, { query: query.value }));
const groups = computed(() => groupNodeTypeViewItemsByCategory(filteredItems.value));

/** 顾问子图按查询词过滤（与节点类型共用同一个搜索框）。 */
const filteredSubgraphs = computed(() => {
  const list = props.advisorSubgraphs;
  if (!props.canInsertSubgraph || list.length === 0) {
    return [];
  }
  const q = query.value.trim().toLowerCase();
  if (q.length === 0) {
    return list;
  }
  return list.filter((graph) => subgraphLabel(graph).toLowerCase().includes(q) || graph.name.toLowerCase().includes(q));
});

function subgraphLabel(graph: NodeGraphDocument): string {
  return props.advisorLabel ? props.advisorLabel(graph) : graph.name;
}

function toggle(): void {
  if (props.disabled) {
    return;
  }
  open.value = !open.value;
}

function add(item: NodeTypeViewItem): void {
  emit("add", { type: item.type, typeVersion: item.typeVersion });
  open.value = false;
  query.value = "";
}

function insertSubgraph(graph: NodeGraphDocument): void {
  const graphId = typeof graph.graphId === "string" ? graph.graphId : "";
  if (!graphId) {
 return;
  }
  emit("insert-subgraph", graphId);
  open.value = false;
query.value = "";
}
</script>

<template>
  <div class="relative">
    <UiButton variant="ghost" class="!h-7 !px-2 text-xs" :disabled="disabled" @click="toggle">
      <Plus :size="12" :stroke-width="1.5" />
      {{ t("graph.add") }}
    </UiButton>

    <div
      v-if="open"
      class="absolute left-0 top-9 z-30 flex max-h-[32rem] w-[28rem] flex-col overflow-hidden rounded-lg border border-line-active bg-panel shadow-xl"
    >
      <div class="border-b border-line-subtle p-2">
        <label class="flex items-center gap-1.5 rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-muted focus-within:ring-1 focus-within:ring-signal-accent">
          <Search :size="13" :stroke-width="1.5" />
          <input
            v-model="query"
            class="min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
            :placeholder="t('graph.nodeType.searchPlaceholder')"
          />
        </label>
      </div>
      <div class="min-h-0 overflow-auto p-2">
        <!-- SG11-2：顾问子图分区（置顶，与节点类型同一搜索框过滤） -->
        <section v-if="filteredSubgraphs.length > 0" class="mb-3">
          <h3 class="px-1 pb-1 font-mono text-[10px] uppercase tracking-wide text-text-muted">
            {{ t("graph.insertSubgraph") }} · {{ filteredSubgraphs.length }}
          </h3>
          <button
     v-for="graph in filteredSubgraphs"
            :key="graph.graphId"
            type="button"
            class="mb-1 flex w-full items-center gap-2 rounded-md border border-line-subtle bg-float/40 px-2 py-2 text-left transition-colors duration-150 hover:border-line-active hover:bg-float focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            @click="insertSubgraph(graph)"
          >
            <Workflow :size="14" :stroke-width="1.5" class="shrink-0 text-text-muted" />
            <span class="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">{{ subgraphLabel(graph) }}</span>
          </button>
        </section>

        <p v-if="filteredItems.length === 0 && filteredSubgraphs.length === 0" class="px-2 py-6 text-center text-xs text-text-muted">
          {{ t("graph.nodeType.noResults") }}
        </p>
        <section v-for="group in groups" :key="group.category" class="mb-3 last:mb-0">
          <h3 class="px-1 pb-1 font-mono text-[10px] uppercase tracking-wide text-text-muted">
            {{ group.label }} · {{ group.items.length }}
          </h3>
          <button
            v-for="item in group.items"
            :key="`${item.type}@${item.typeVersion}`"
            type="button"
            class="mb-1 block w-full rounded-md border border-line-subtle bg-float/40 px-2 py-2 text-left transition-colors duration-150 hover:border-line-active hover:bg-float focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            @click="add(item)"
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
            <p class="mt-1 line-clamp-2 text-[10px] leading-relaxed text-text-muted">{{ item.summaryLabel }}</p>
            <div class="mt-1 flex flex-wrap gap-1 font-mono text-[9px] text-text-muted">
              <span class="rounded border border-line-subtle px-1">{{ t("graph.nodeType.inCount", { count: item.inputCount }) }}</span>
              <span class="rounded border border-line-subtle px-1">{{ t("graph.nodeType.outCount", { count: item.outputCount }) }}</span>
              <span v-if="item.permissionCount > 0" class="rounded border border-line-subtle px-1">{{ item.permissionCount }} {{ t("graph.nodeType.keyShort") }}</span>
            </div>
          </button>
        </section>
      </div>
    </div>
  </div>
</template>
