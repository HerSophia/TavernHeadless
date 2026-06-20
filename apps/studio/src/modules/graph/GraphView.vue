<script setup lang="ts">
import { AlertCircle, PanelRightClose, PanelRightOpen, RotateCcw, Save, Workflow } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { nodeGraphApi, type NodeGraphDefinitionResponse } from "../../lib/nodegraph-api";
import { useContextStore } from "../../stores/context";
import { useGraphEditorStore } from "../../stores/graph-editor";
import UiButton from "../../ui/UiButton.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import GraphCanvas from "./canvas/GraphCanvas.vue";
import DiagnosticsPanel from "./panels/DiagnosticsPanel.vue";
import NodeInspector from "./panels/NodeInspector.vue";
import type { DiagnosticTarget } from "./validate/local-validation";

const { t, te } = useI18n();
const ctx = useContextStore();
const store = useGraphEditorStore();

const SAMPLE_SOURCE = "__sample__";

const graphs = ref<NodeGraphDefinitionResponse[]>([]);
const laidOut = ref(false);
const highlight = ref<DiagnosticTarget | null>(null);
const panelOpen = ref(true);
const addNodeType = ref("");

const sourceValue = computed(() =>
  store.isSample ? SAMPLE_SOURCE : store.graphId ?? SAMPLE_SOURCE,
);

const counts = computed(() =>
  store.document ? { nodes: store.nodeCount, edges: store.edgeCount, groups: store.groupCount } : null,
);

/** 文档存在缺省坐标节点且尚未自动布局：当前为占位列布局。 */
const usesPlaceholderLayout = computed(
  () => Boolean(!laidOut.value && store.document?.nodes.some((node) => !node.ui?.position)),
);

const projectSelected = computed(() => Boolean(ctx.currentProjectId));

const errorMessage = computed(() => {
  if (store.error === "blocked_by_diagnostics") {
    return t("graph.blockedSave", { count: store.errorCount });
  }
  return store.error;
});

function typeLabel(type: string): string {
  const key = `graphNode.type.${type.replaceAll(".", "_")}`;
  return te(key) ? t(key) : type;
}

async function loadGraphList(projectId: string): Promise<void> {
  try {
    graphs.value = (await nodeGraphApi.list(projectId)).items;
  } catch {
    graphs.value = [];
  }
}

function onSourceChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  laidOut.value = false;
  if (value === SAMPLE_SOURCE) {
    store.loadSample();
    return;
  }
  const projectId = ctx.currentProjectId;
  if (projectId) {
    void store.loadGraph(projectId, value);
  }
}

function onAddNode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value) {
    store.addNode(value);
    panelOpen.value = true;
  }
  addNodeType.value = "";
}

function onVersionChange(event: Event): void {
  laidOut.value = false;
  store.loadVersion((event.target as HTMLSelectElement).value);
}

async function onSetCurrent(): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (projectId && store.baseVersionId) {
    await store.setAsCurrentVersion(projectId, store.baseVersionId);
  }
}

async function onSave(): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (!projectId) {
    return;
  }
  const created = store.graphId === null;
  const ok = await store.saveAsNewVersion(projectId);
  if (ok && created) {
    await loadGraphList(projectId);
  }
}

function onLocate(target: DiagnosticTarget): void {
  highlight.value = { ...target };
  if (target.nodeId) {
    store.selectNode(target.nodeId);
  } else if (target.edgeId) {
    store.selectEdge(target.edgeId);
  }
  panelOpen.value = true;
}

function onConnect(payload: { source: string; target: string; sourceHandle: string; targetHandle: string }): void {
  store.addEdge(
    { nodeId: payload.source, port: payload.sourceHandle },
    { nodeId: payload.target, port: payload.targetHandle },
  );
}

const activeTarget = computed<DiagnosticTarget | null>(() => {
  if (store.selectedNodeId) {
    return { nodeId: store.selectedNodeId };
  }
  if (store.selectedEdgeId) {
    return { edgeId: store.selectedEdgeId };
  }
  return null;
});

watch(
  () => ctx.currentProjectId,
  (projectId) => {
    if (projectId) {
      void loadGraphList(projectId);
    } else {
      graphs.value = [];
    }
  },
);

onMounted(() => {
  store.loadSample();
  if (ctx.currentProjectId) {
    void loadGraphList(ctx.currentProjectId);
  }
});
</script>

<template>
  <section class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle bg-panel px-3">
      <label class="flex items-center gap-1.5 font-mono text-xs text-text-muted">
        <span>{{ t("graph.source") }}</span>
        <select
          class="max-w-48 rounded-md border border-line-subtle bg-float px-2 py-1 text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="sourceValue"
          @change="onSourceChange"
        >
          <option :value="SAMPLE_SOURCE">{{ t("graph.sample") }}</option>
          <option v-for="graph in graphs" :key="graph.id" :value="graph.id">{{ graph.name }}</option>
        </select>
      </label>

      <select
        class="rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :value="addNodeType"
        :disabled="!store.document"
        :aria-label="t('graph.addNode')"
        @change="onAddNode"
      >
        <option value="">+ {{ t("graph.addNode") }}</option>
        <option v-for="entry in store.availableNodeTypes" :key="`${entry.type}@${entry.typeVersion}`" :value="entry.type">
          {{ typeLabel(entry.type) }}
        </option>
      </select>

      <label
        v-if="store.versions.length > 0"
        class="flex items-center gap-1.5 font-mono text-xs text-text-muted"
      >
        <span>{{ t("graph.version") }}</span>
        <select
          class="rounded-md border border-line-subtle bg-float px-2 py-1 text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="store.baseVersionId ?? ''"
          @change="onVersionChange"
        >
          <option
            v-for="version in store.versions"
            :key="version.id"
            :value="version.id"
          >
            v{{ version.version_no }}{{ version.id === store.serverCurrentVersionId ? ` · ${t("graph.versionCurrent")}` : "" }}
          </option>
        </select>
      </label>

      <UiButton
        v-if="store.graphId && store.baseVersionId && store.baseVersionId !== store.serverCurrentVersionId"
        variant="ghost"
        class="!h-7 !px-2 text-xs"
        @click="onSetCurrent"
      >
        {{ t("graph.setCurrent") }}
      </UiButton>

      <span v-if="counts" class="font-mono text-xs text-text-muted">
        {{ counts.nodes }} {{ t("graph.nodes") }} · {{ counts.edges }} {{ t("graph.edges") }} ·
        {{ counts.groups }} {{ t("graph.groups") }}
      </span>

      <span
        v-if="usesPlaceholderLayout"
        class="rounded border border-line-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
        :title="t('graph.placeholderHint')"
      >
        {{ t("graph.placeholder") }}
      </span>

      <!-- Right cluster -->
      <div class="ml-auto flex items-center gap-2">
        <span
          v-if="errorMessage"
          class="flex items-center gap-1.5 text-xs text-signal-error"
          :title="errorMessage"
        >
          <AlertCircle :size="13" :stroke-width="1.5" />
          <span class="max-w-56 truncate">{{ errorMessage }}</span>
        </span>

        <span
          v-if="store.dirty"
          class="font-mono text-[10px] text-signal-warn"
          :title="t('graph.dirty')"
        >●</span>

        <UiButton
          v-if="store.draftRestored"
          variant="ghost"
          class="!h-7 !px-2 text-xs"
          :title="t('graph.draftRestored')"
          @click="store.discardDraft()"
        >
          <RotateCcw :size="12" :stroke-width="1.5" />
          {{ t("graph.discardDraft") }}
        </UiButton>

        <UiButton
          class="!h-7 !px-2 text-xs"
          :disabled="!store.canSaveVersion || !projectSelected"
          :title="!projectSelected ? t('graph.selectProjectFirst') : t('graph.save')"
          @click="onSave"
        >
          <Save :size="12" :stroke-width="1.5" />
          {{ store.saving ? t("graph.saving") : t("graph.save") }}
        </UiButton>

        <UiIconButton
          :label="t('graph.panelToggle')"
          :active="panelOpen"
          @click="panelOpen = !panelOpen"
        >
          <PanelRightClose v-if="panelOpen" :size="16" :stroke-width="1.5" />
          <PanelRightOpen v-else :size="16" :stroke-width="1.5" />
        </UiIconButton>
      </div>
    </div>

    <!-- Body -->
    <div class="flex min-h-0 flex-1">
      <div class="relative min-w-0 flex-1">
        <GraphCanvas
          v-if="store.document"
          :document="store.document"
          editable
          :reset-key="store.loadToken"
          :highlight="highlight"
          @update:laid-out="(value: boolean) => (laidOut = value)"
          @update:positions="(positions) => store.applyNodePositions(positions)"
          @select-node="(id) => store.selectNode(id)"
          @select-edge="(id) => store.selectEdge(id)"
          @connect="onConnect"
        />

        <div v-else-if="store.loading" class="flex h-full flex-col gap-2 p-4">
          <div class="h-6 w-40 animate-pulse rounded bg-float" />
          <div class="h-full w-full animate-pulse rounded bg-float" />
        </div>

        <div v-else class="flex h-full items-center justify-center p-8">
          <div class="flex max-w-md flex-col items-center text-center">
            <Workflow :size="32" :stroke-width="1.25" class="text-text-muted" />
            <h1 class="mt-4 text-base font-medium text-text-primary">{{ t("graph.emptyTitle") }}</h1>
            <p class="mt-2 text-sm leading-relaxed text-text-secondary">{{ t("graph.noVersion") }}</p>
          </div>
        </div>
      </div>

      <!-- Right panel: diagnostics + inspector -->
      <aside
        v-if="panelOpen"
        class="flex w-80 shrink-0 flex-col border-l border-line-subtle bg-panel"
      >
        <div class="flex min-h-0 flex-[2] flex-col border-b border-line-subtle">
          <DiagnosticsPanel
            :diagnostics="store.diagnostics"
            :active-target="activeTarget"
            @locate="onLocate"
          />
        </div>
        <div class="flex min-h-0 flex-[3] flex-col">
          <NodeInspector />
        </div>
      </aside>
    </div>
  </section>
</template>
