<script setup lang="ts">
import { NODE_GRAPH_PHASES, type NodeGraphPhase } from "@tavern/core/node-graph";
import { Eye, Play, Trash2, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import UiButton from "../../../ui/UiButton.vue";
import { useContextStore } from "../../../stores/context";
import { useGraphEditorStore } from "../../../stores/graph-editor";
import { previewPolicyOf, useNodePreview } from "../preview/use-node-preview";

const { t, te } = useI18n();
const store = useGraphEditorStore();
const ctx = useContextStore();
const { previewing, error: previewError, result: previewResult, runPreview, reset: resetPreview } =
  useNodePreview();

const node = computed(() => store.selectedNode);
const entry = computed(() => store.selectedNodeEntry);
const edge = computed(() => store.selectedEdge);

const phaseOptions = computed<NodeGraphPhase[]>(() =>
  entry.value ? entry.value.supportedPhases : [...NODE_GRAPH_PHASES],
);

const policy = computed(() => previewPolicyOf(node.value, entry.value));
const previewSupported = computed(() => !store.isSample && Boolean(store.graphId) && policy.value !== "disabled");

const configText = ref("");
const configError = ref<string | null>(null);
const userInput = ref("");
const confirmDeleteNode = ref(false);
const confirmDeleteEdge = ref(false);

function phaseLabel(phase: string): string {
  const key = `graphNode.phase.${phase}`;
  return te(key) ? t(key) : phase;
}

function nodeTitle(): string {
  if (!node.value) {
    return "";
  }
  const key = `graphNode.type.${node.value.type.replaceAll(".", "_")}`;
  return te(key) ? t(key) : entry.value?.title ?? node.value.name ?? node.value.type;
}

watch(
  () => store.selectedNodeId,
  () => {
    configError.value = null;
    confirmDeleteNode.value = false;
    resetPreview();
    const current = node.value;
    configText.value = current?.config === undefined ? "" : JSON.stringify(current.config, null, 2);
  },
  { immediate: true },
);

watch(
  () => store.selectedEdgeId,
  () => {
    confirmDeleteEdge.value = false;
  },
);

function applyConfig(): void {
  if (!node.value) {
    return;
  }
  const text = configText.value.trim();
  if (text.length === 0) {
    store.updateNodeConfig(node.value.id, undefined);
    configError.value = null;
    return;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    store.updateNodeConfig(node.value.id, parsed);
    configError.value = null;
  } catch {
    configError.value = t("graph.inspector.configInvalid");
  }
}

function onNameInput(event: Event): void {
  if (node.value) {
    store.updateNode(node.value.id, { name: (event.target as HTMLInputElement).value || undefined });
  }
}

function onPhaseChange(event: Event): void {
  if (node.value) {
    store.updateNode(node.value.id, { phase: (event.target as HTMLSelectElement).value as NodeGraphPhase });
  }
}

function onEnabledChange(event: Event): void {
  if (node.value) {
    store.updateNode(node.value.id, { enabled: (event.target as HTMLInputElement).checked });
  }
}

function deleteSelectedNode(): void {
  if (!node.value) {
    return;
  }
  if (!confirmDeleteNode.value) {
    confirmDeleteNode.value = true;
    return;
  }
  store.removeNode(node.value.id);
  confirmDeleteNode.value = false;
}

function deleteSelectedEdge(): void {
  if (!edge.value) {
    return;
  }
  if (!confirmDeleteEdge.value) {
    confirmDeleteEdge.value = true;
    return;
  }
  store.removeEdge(edge.value.id);
  confirmDeleteEdge.value = false;
}

function doPreview(): void {
  const current = node.value;
  const projectId = ctx.currentProjectId;
  if (!current || !projectId || !store.graphId) {
    return;
  }
  void runPreview({
    projectId,
    graphId: store.graphId,
    versionId: store.serverCurrentVersionId,
    node: current,
    userInput: userInput.value || undefined,
  });
}

const previewValueText = computed(() => {
  const result = previewResult.value;
  if (!result) {
    return "";
  }
  if (result.preview?.value !== undefined) {
    return typeof result.preview.value === "string"
      ? result.preview.value
      : JSON.stringify(result.preview.value, null, 2);
  }
  if (result.value !== undefined) {
    return typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2);
  }
  return "";
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle px-3 text-xs">
      <span class="font-medium text-text-secondary">{{ t("graph.inspector.title") }}</span>
      <button
        v-if="node || edge"
        type="button"
        class="ml-auto inline-flex size-6 items-center justify-center rounded text-text-muted transition-colors duration-150 hover:bg-float hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :aria-label="t('graph.inspector.deselect')"
        :title="t('graph.inspector.deselect')"
        @click="store.clearSelection()"
      >
        <X :size="13" :stroke-width="1.5" />
      </button>
    </header>

    <!-- Node inspector -->
    <div v-if="node" class="min-h-0 flex-1 overflow-auto">
      <div class="border-b border-line-subtle px-3 py-2.5">
        <div class="text-sm font-medium text-text-primary">{{ nodeTitle() }}</div>
        <div class="mt-0.5 font-mono text-[10px] text-text-muted">
          {{ node.type }}@{{ node.typeVersion }} · {{ node.id }}
        </div>
      </div>

      <div class="space-y-3 px-3 py-3">
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.inspector.name") }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="node.name ?? ''"
            :placeholder="nodeTitle()"
            @change="onNameInput"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.inspector.phase") }}</span>
          <select
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="node.phase"
            @change="onPhaseChange"
          >
            <option v-for="phase in phaseOptions" :key="phase" :value="phase">
              {{ phaseLabel(phase) }}
            </option>
          </select>
        </label>

        <label class="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            class="size-3.5 accent-signal-accent"
            :checked="node.enabled !== false"
            @change="onEnabledChange"
          />
          {{ t("graph.inspector.enabled") }}
        </label>

        <div>
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.inspector.config") }}</span>
          <textarea
            v-model="configText"
            rows="6"
            spellcheck="false"
            class="w-full resize-y rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-[11px] leading-relaxed text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :placeholder="'{ }'"
            @blur="applyConfig"
          />
          <div class="mt-1 flex items-center gap-2">
            <UiButton variant="ghost" class="!h-7 !px-2 text-xs" @click="applyConfig">
              {{ t("graph.inspector.applyConfig") }}
            </UiButton>
            <span v-if="configError" class="text-[11px] text-signal-error">{{ configError }}</span>
          </div>
        </div>
      </div>

      <!-- Preview -->
      <div class="border-t border-line-subtle px-3 py-3">
        <div class="mb-2 flex items-center gap-2">
          <Eye :size="13" :stroke-width="1.5" class="text-text-muted" />
          <span class="text-[11px] text-text-muted">{{ t("graph.inspector.preview") }}</span>
          <span class="ml-auto rounded border border-line-subtle px-1 font-mono text-[10px] text-text-secondary">
            {{ policy }}
          </span>
        </div>

        <p v-if="store.isSample || !store.graphId" class="text-[11px] leading-relaxed text-text-muted">
          {{ t("graph.inspector.previewUnavailable") }}
        </p>
        <template v-else-if="policy === 'disabled'">
          <p class="text-[11px] leading-relaxed text-text-muted">{{ t("graph.inspector.previewDisabled") }}</p>
        </template>
        <template v-else>
          <input
            v-model="userInput"
            class="mb-2 w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :placeholder="t('graph.inspector.previewInput')"
          />
          <UiButton class="!h-7 !px-2 text-xs" :disabled="previewing" @click="doPreview">
            <Play :size="12" :stroke-width="1.5" />
            {{ previewing ? t("graph.inspector.previewing") : t("graph.inspector.runPreview") }}
          </UiButton>
          <p v-if="store.dirty" class="mt-2 text-[11px] leading-relaxed text-signal-warn">
            {{ t("graph.inspector.previewStale") }}
          </p>

          <p v-if="previewError" class="mt-2 text-[11px] leading-relaxed text-signal-error">{{ previewError }}</p>

          <div v-if="previewResult" class="mt-2 space-y-1.5">
            <div class="flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-muted">
              <span v-if="previewResult.preview?.kind" class="rounded border border-line-subtle px-1">{{ previewResult.preview.kind }}</span>
              <span v-if="previewResult.preview?.source" class="rounded border border-line-subtle px-1">{{ previewResult.preview.source }}</span>
              <span v-if="previewResult.preview?.tokenEstimate !== undefined">~{{ previewResult.preview.tokenEstimate }} tok</span>
              <span v-if="previewResult.preview?.stale" class="text-signal-warn">stale</span>
            </div>
            <p v-if="previewResult.preview?.summary" class="text-[11px] leading-relaxed text-text-secondary">
              {{ previewResult.preview.summary }}
            </p>
            <pre
              v-if="previewValueText"
              class="max-h-48 overflow-auto rounded-md border border-line-subtle bg-app px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text-secondary"
            >{{ previewValueText }}</pre>
          </div>
        </template>
      </div>

      <!-- Delete -->
      <div class="border-t border-line-subtle px-3 py-3">
        <UiButton
          variant="ghost"
          class="!h-7 !px-2 text-xs"
          :class="confirmDeleteNode ? 'text-signal-error' : 'text-text-secondary'"
          @click="deleteSelectedNode"
        >
          <Trash2 :size="12" :stroke-width="1.5" />
          {{ confirmDeleteNode ? t("graph.inspector.confirmDelete") : t("graph.inspector.deleteNode") }}
        </UiButton>
      </div>
    </div>

    <!-- Edge inspector -->
    <div v-else-if="edge" class="min-h-0 flex-1 overflow-auto">
      <div class="border-b border-line-subtle px-3 py-2.5">
        <div class="text-sm font-medium text-text-primary">{{ t("graph.inspector.edge") }}</div>
        <div class="mt-0.5 font-mono text-[10px] text-text-muted">{{ edge.id }}</div>
      </div>
      <div class="space-y-2 px-3 py-3 font-mono text-[11px] text-text-secondary">
        <div class="flex items-center gap-1">
          <span class="text-text-muted">kind</span>
          <span class="ml-auto rounded border border-line-subtle px-1">{{ edge.kind ?? "data" }}</span>
        </div>
        <div><span class="text-text-muted">from</span> {{ edge.from.nodeId }}:{{ edge.from.port }}</div>
        <div><span class="text-text-muted">to</span> {{ edge.to.nodeId }}:{{ edge.to.port }}</div>
      </div>
      <div class="border-t border-line-subtle px-3 py-3">
        <UiButton
          variant="ghost"
          class="!h-7 !px-2 text-xs"
          :class="confirmDeleteEdge ? 'text-signal-error' : 'text-text-secondary'"
          @click="deleteSelectedEdge"
        >
          <Trash2 :size="12" :stroke-width="1.5" />
          {{ confirmDeleteEdge ? t("graph.inspector.confirmDelete") : t("graph.inspector.deleteEdge") }}
        </UiButton>
      </div>
    </div>

    <!-- Empty -->
    <div v-else class="flex flex-1 items-center justify-center p-6 text-center">
      <p class="text-xs leading-relaxed text-text-muted">{{ t("graph.inspector.empty") }}</p>
    </div>
  </div>
</template>
