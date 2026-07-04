<script setup lang="ts">
import {
  describeNodeTypeKnowledge,
  NODE_GRAPH_NODE_CATEGORIES,
  type NodeGraphNodeCategory,
  type NodeGraphNodeTypeKnowledgeListItem,
  type NodeGraphPhase,
  type NodeGraphPortDefinition,
} from "@tavern/core/node-graph";
import { Eye, EyeOff, Hand, Plus, Search, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import UiButton from "../../../ui/UiButton.vue";
import { NODE_HEADER_HEIGHT, NODE_PORT_ROW_HEIGHT } from "../canvas/map-document";
import { phaseStyle, portStyle, sideEffectStyle } from "../canvas/port-styles";
import {
  buildNodeTypeViewItems,
  filterNodeTypeViewItems,
  groupNodeTypeViewItemsByCategory,
  nodeTypeCategoryLabel,
  type NodeTypeViewItem,
} from "./node-type-view";
import NodeTypeDetail from "./NodeTypeDetail.vue";

const props = withDefaults(defineProps<{
  entries: NodeGraphNodeTypeKnowledgeListItem[];
  selectedType?: string | null;
  canAdd?: boolean;
}>(), {
  selectedType: null,
  canAdd: true,
});

const emit = defineEmits<{
  (event: "close"): void;
  (event: "add", payload: { type: string; typeVersion: string }): void;
}>();

const { t, te } = useI18n();
const query = ref("");
const category = ref<NodeGraphNodeCategory | "all">("all");
const sideEffect = ref<string | "all">("all");
const selectedKey = ref("");

const viewItems = computed(() => buildNodeTypeViewItems(props.entries, { t, te }));
const filteredItems = computed(() => filterNodeTypeViewItems(viewItems.value, {
  query: query.value,
  category: category.value,
  sideEffect: sideEffect.value,
}));
const groups = computed(() => groupNodeTypeViewItemsByCategory(filteredItems.value));
const selectedItem = computed(() =>
  viewItems.value.find((item) => `${item.type}@${item.typeVersion}` === selectedKey.value)
  ?? filteredItems.value[0]
  ?? null,
);
const detail = computed(() =>
  selectedItem.value
    ? describeNodeTypeKnowledge(selectedItem.value.type, selectedItem.value.typeVersion)
    : undefined,
);

const categoryOptions = computed(() =>
  NODE_GRAPH_NODE_CATEGORIES.map((value) => ({ value, label: nodeTypeCategoryLabel(value, { t, te }) })),
);
const sideEffectOptions = ["none", "llm", "tool", "write"] as const;
const previewPhase = computed<NodeGraphPhase>(() => selectedItem.value?.supportedPhases[0] ?? "pre_response");
const previewPhaseStyle = computed(() => phaseStyle(previewPhase.value));
const previewSideEffect = computed(() => sideEffectStyle(selectedItem.value?.sideEffects));
const previewPortsHeight = computed(() => {
  const item = selectedItem.value;
  const rows = item ? Math.max(item.inputPorts.length, item.outputPorts.length) : 0;
  return `${rows * NODE_PORT_ROW_HEIGHT}px`;
});
const previewPhaseLabel = computed(() => {
  const key = `graphNode.phase.${previewPhase.value}`;
  return te(key) ? t(key) : previewPhaseStyle.value.label;
});
const previewPolicyLabel = computed(() => {
  const policy = selectedItem.value?.previewPolicy ?? "auto";
  const key = `graphNode.previewPolicy.${policy}`;
  return te(key) ? t(key) : policy;
});
const previewIcon = computed(() => {
  switch (selectedItem.value?.previewPolicy) {
    case "manual":
      return Hand;
    case "disabled":
      return EyeOff;
    default:
      return Eye;
  }
});

watch(
  () => props.selectedType,
  (type) => {
    if (!type) {
      return;
    }
    const found = viewItems.value.find((item) => item.type === type);
    if (found) {
      selectedKey.value = `${found.type}@${found.typeVersion}`;
    }
  },
  { immediate: true },
);

watch(
  filteredItems,
  (items) => {
    if (items.length === 0) {
      selectedKey.value = "";
      return;
    }
    if (!items.some((item) => `${item.type}@${item.typeVersion}` === selectedKey.value)) {
      const [first] = items;
      if (first) {
        selectedKey.value = `${first.type}@${first.typeVersion}`;
      }
    }
  },
  { immediate: true },
);

function selectItem(item: NodeTypeViewItem): void {
  selectedKey.value = `${item.type}@${item.typeVersion}`;
}

function addSelected(): void {
  const item = selectedItem.value;
  if (!item || !props.canAdd) {
    return;
  }
  emit("add", { type: item.type, typeVersion: item.typeVersion });
}

function portLabel(name: string): string{
  const key = `graphNode.port.${name}`;
  return te(key) ? t(key) : name;
}

function sideEffectLabel(value: string): string {
  const key = `graph.nodeType.sideEffect.${value}`;
  return te(key) ? t(key) : value;
}

function previewPortDotStyle(port: NodeGraphPortDefinition): Record<string, string> {
  const style = portStyle(port.type);
  return {
    background: style.color,
    borderRadius: style.shape === "circle" ? "9999px" : style.shape === "square" ? "2px" : "1px",
    transform: style.shape === "diamond" ? "rotate(45deg)" : "none",
  };
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex bg-app/70 p-3" @click.self="emit('close')">
    <div class="pointer-events-none hidden min-w-0 flex-1 items-center justify-center px-6 lg:flex" aria-hidden="true">
      <article v-if="selectedItem" class="nt-preview-node">
        <span class="nt-preview-node__accent" :style="{ background: previewPhaseStyle.accent }" />

        <header class="nt-preview-node__header">
          <div class="nt-preview-node__title-row">
            <span class="nt-preview-node__title" :title="selectedItem.titleLabel">{{ selectedItem.titleLabel }}</span>
            <span
              v-if="previewSideEffect.emphasis > 0"
              class="nt-preview-node__badge"
              :style="{ color: previewSideEffect.color, borderColor: previewSideEffect.color }"
            >{{ previewSideEffect.label }}</span>
          </div>
          <div class="nt-preview-node__type" :title="`${selectedItem.type}@${selectedItem.typeVersion}`">
            {{ selectedItem.type }}
          </div>
        </header>

        <div class="nt-preview-node__ports" :style="{ height: previewPortsHeight }">
          <div class="nt-preview-node__col nt-preview-node__col--in">
            <div
              v-for="port in selectedItem.inputPorts"
              :key="`in-${port.name}`"
              class="nt-preview-node__port-row"
            >
              <span class="nt-preview-node__dot nt-preview-node__dot--in" :style="previewPortDotStyle(port)" />
              <span class="nt-preview-node__port-label" :title="port.name">{{ portLabel(port.name) }}</span>
            </div>
          </div>

          <div class="nt-preview-node__col nt-preview-node__col--out">
            <div
              v-for="port in selectedItem.outputPorts"
              :key="`out-${port.name}`"
              class="nt-preview-node__port-row nt-preview-node__port-row--out"
            >
              <span class="nt-preview-node__port-label nt-preview-node__port-label--out" :title="port.name">{{ portLabel(port.name) }}</span>
              <span class="nt-preview-node__dot nt-preview-node__dot--out" :style="previewPortDotStyle(port)" />
            </div>
          </div>
        </div>

        <footer class="nt-preview-node__footer">
          <span class="nt-preview-node__phase" :style="{ color: previewPhaseStyle.accent }">{{ previewPhaseLabel }}</span>
          <span class="nt-preview-node__preview" :title="previewPolicyLabel">
            <component :is="previewIcon" class="nt-preview-node__preview-icon" :size="12" :stroke-width="1.5" />
            <span>{{ previewPolicyLabel }}</span>
          </span>
        </footer>
      </article>
    </div>

    <section class="flex h-full w-full max-w-5xl overflow-hidden rounded-lg border border-line-active bg-panel shadow-xl">
      <aside class="flex w-96 shrink-0 flex-col border-r border-line-subtle">
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
          <div class="min-w-0 flex-1">
            <h2 class="text-sm font-medium text-text-primary">{{ t("graph.nodeType.browserTitle") }}</h2>
            <p class="truncate text-[10px] text-text-muted">{{ t("graph.nodeType.browserHint") }}</p>
          </div>
          <button
            type="button"
            class="inline-flex size-7 items-center justify-center rounded text-text-muted transition-colors duration-150 hover:bg-float hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :aria-label="t('graph.nodeType.close')"
            @click="emit('close')"
          >
            <X :size="15" :stroke-width="1.5" />
          </button>
        </header>

        <div class="space-y-2 border-b border-line-subtle px-3 py-3">
          <label class="flex items-center gap-1.5 rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-muted focus-within:ring-1 focus-within:ring-signal-accent">
            <Search :size="13" :stroke-width="1.5" />
            <input
              v-model="query"
              class="min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
              :placeholder="t('graph.nodeType.searchPlaceholder')"
            />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <select
              v-model="category"
              class="rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            >
              <option value="all">{{ t("graph.nodeType.categoryAll") }}</option>
              <option v-for="option in categoryOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <select
              v-model="sideEffect"
              class="rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            >
              <option value="all">{{ t("graph.nodeType.sideEffectAll") }}</option>
              <option v-for="option in sideEffectOptions" :key="option" :value="option">{{ sideEffectLabel(option) }}</option>
            </select>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-2 py-2">
          <p v-if="filteredItems.length === 0" class="px-2 py-6 text-center text-xs text-text-muted">
            {{ t("graph.nodeType.noResults") }}
          </p>
          <section v-for="group in groups" :key="group.category" class="mb-3">
            <h3 class="px-1.5 pb-1 font-mono text-[10px] uppercase tracking-wide text-text-muted">
              {{ group.label }} · {{ group.items.length }}
            </h3>
            <button
              v-for="item in group.items"
              :key="`${item.type}@${item.typeVersion}`"
              type="button"
              class="mb-1 block w-full rounded-md border px-2 py-2 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              :class="selectedItem?.type === item.type && selectedItem?.typeVersion === item.typeVersion
                ? 'border-signal-accent/60 bg-signal-accent/10'
                : 'border-line-subtle bg-float/40 hover:border-line-active hover:bg-float'"
              @click="selectItem(item)"
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
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-text-primary">
              {{ selectedItem?.titleLabel ?? t("graph.nodeType.noResults") }}
            </div>
            <div v-if="selectedItem" class="font-mono text-[10px] text-text-muted">
              {{ selectedItem.type }}@{{ selectedItem.typeVersion }}
            </div>
          </div>
          <UiButton class="!h-7 !px-2 text-xs" :disabled="!selectedItem || !props.canAdd" @click="addSelected">
            <Plus :size="12" :stroke-width="1.5" />
            {{ t("graph.nodeType.add") }}
          </UiButton>
        </header>
        <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
          <NodeTypeDetail :detail="detail" />
        </div>
      </main>
    </section>
  </div>
</template>


<style scoped>
.nt-preview-node {
  position: relative;
  width: 220px;
  overflow: hidden;
  border: 1px solid var(--color-line-subtle);
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-panel) 88%, transparent);
  color: var(--color-text-primary);
  box-shadow: 0 14px 36px rgb(0 0 0 / 0.18);
  backdrop-filter: blur(8px);
  font-family: var(--font-sans);
}

.nt-preview-node__accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}

.nt-preview-node__header {
  box-sizing: border-box;
  height: 66px;
  padding: 7px 10px 0 13px;
  overflow: hidden;
}

.nt-preview-node__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nt-preview-node__title {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
}

.nt-preview-node__badge {
  flex: none;
  border: 1px solid;
  border-radius: 3px;
  padding: 2px 4px;
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
}

.nt-preview-node__type {
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.nt-preview-node__ports {
  display: flex;
  position: static;
}

.nt-preview-node__col {
  min-width: 0;
  flex: 1 1 0;
}

.nt-preview-node__port-row {
  position: relative;
  display: flex;
  height: 22px;
  align-items: center;
}

.nt-preview-node__port-row--out {
  justify-content: flex-end;
}

.nt-preview-node__dot {
  position: absolute;
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--color-app);
  box-sizing: border-box;
}

.nt-preview-node__dot--in {
  left: 0;
  translate: -50% 0;
}

.nt-preview-node__dot--out {
  right: 0;
  translate: 50% 0;
}

.nt-preview-node__port-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 12px;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
}

.nt-preview-node__port-label--out {
  padding-left: 0;
  padding-right: 12px;
  text-align: right;
}

.nt-preview-node__footer {
  display: flex;
  height: 22px;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--color-line-subtle);
  padding: 0 10px 0 13px;
}

.nt-preview-node__phase {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
}

.nt-preview-node__preview {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.nt-preview-node__preview-icon {
  display: block;
}
</style>
