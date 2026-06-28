<script setup lang="ts">
import { listBuiltinAdvisorSubgraphs, type NodeGraphDocument } from "@tavern/core/node-graph";
import { AlertCircle, Bot, CornerUpLeft, Download, FileUp, PackagePlus, PanelRightClose, PanelRightOpen, RotateCcw, Save, Trash2, Upload, Workflow } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { nodeGraphApi, type NodeGraphDefinitionResponse } from "../../lib/nodegraph-api";
import { useContextStore } from "../../stores/context";
import { useGraphAssistantStore } from "../../stores/graph-assistant";
import { useGraphEditorStore } from "../../stores/graph-editor";
import UiButton from "../../ui/UiButton.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import GraphAssistantDrawer from "./assistant/GraphAssistantDrawer.vue";
import GraphCanvas from "./canvas/GraphCanvas.vue";
import PresetImportDialog from "./import/PresetImportDialog.vue";
import PackageExportDialog from "./package/PackageExportDialog.vue";
import PackageImportDialog from "./package/PackageImportDialog.vue";
import DiagnosticsPanel from "./panels/DiagnosticsPanel.vue";
import NodeInspector from "./panels/NodeInspector.vue";
import type { DiagnosticTarget } from "./validate/local-validation";

const { t, te } = useI18n();
const ctx = useContextStore();
const store = useGraphEditorStore();
const assistant = useGraphAssistantStore();

const SAMPLE_SOURCE = "__sample__";
/** DG11：内置 native「默认楼层模板」源标识（可 fork 的系统图同结构副本）。 */
const TEMPLATE_SOURCE = "__template__";
/** CG11-2：内置 compat「默认楼层模板」源标识（compat 系统图同结构副本，零 Agentic）。 */
const TEMPLATE_COMPAT_SOURCE = "__template_compat__";

/** SG11-2：内置顾问子图清单（director / verifier / memory），供「插入顾问子图」下拉。 */
const advisorSubgraphs = listBuiltinAdvisorSubgraphs();
const insertSubgraphRef = ref("");

const graphs = ref<NodeGraphDefinitionResponse[]>([]);
const laidOut = ref(false);
const highlight = ref<DiagnosticTarget | null>(null);
const panelOpen = ref(true);
const addNodeType = ref("");
/** AI 助手抽屉开合（图编辑器内的临时对话容器）。 */
const assistantOpen = ref(false);

const sourceValue = computed(() => {
  if (store.templateKind === "native") {
    return TEMPLATE_SOURCE;
  }
  if (store.templateKind === "compat") {
    return TEMPLATE_COMPAT_SOURCE;
  }
  return store.isSample ? SAMPLE_SOURCE : store.graphId ?? SAMPLE_SOURCE;
});

const counts = computed(() =>
  store.document ? { nodes: store.nodeCount, edges: store.edgeCount, groups: store.groupCount } : null,
);

/** 文档存在缺省坐标节点且尚未自动布局：当前为占位列布局。 */
const usesPlaceholderLayout = computed(
  () => Boolean(!laidOut.value && store.document?.nodes.some((node) => !node.ui?.position)),
);

const projectSelected = computed(() => Boolean(ctx.currentProjectId));

const showExport = ref(false);
const showImport = ref(false);
const showPresetImport = ref(false);
const canExport = computed(() =>
  Boolean(projectSelected.value && store.graphId && store.baseVersionId && !store.isSample),
);
const exportGraphName = computed(() => graphs.value.find((graph) => graph.id === store.graphId)?.name ?? "nodegraph");

async function onImported(graphId: string): Promise<void> {
  showImport.value = false;
  const projectId = ctx.currentProjectId;
  if (projectId) {
    await loadGraphList(projectId);
    laidOut.value = false;
    await store.loadGraph(projectId, graphId);
  }
}

/** 重复导入决策态：命中已有同名 / 同哈希图时弹窗，让用户选择覆盖该图还是作为新图。 */
const pendingPreset = ref<{
  document: NodeGraphDocument;
  name: string;
  matchGraphId: string;
  matchVersionId: string | null;
  matchName: string;
} | null>(null);

/**
 * 在当前项目已有图中查找与待导入预设重复的图：同名（定义名）或同内容哈希
 * （metadata.presetHash）。返回首个命中图及其当前版本 id（供覆盖时作为 parent）。
 */
async function findDuplicateGraph(
  projectId: string,
  name: string,
  presetHash: string,
): Promise<{ id: string; name: string; versionId: string | null } | null> {
  const target = name.trim().toLowerCase();
  for (const candidate of graphs.value) {
    const nameMatch = candidate.name.trim().toLowerCase() === target;
    let hashMatch = false;
    let versionId: string | null = null;
    try {
      const detail = await nodeGraphApi.get(projectId, candidate.id);
      versionId = detail.current_version?.id ?? null;
      const meta = detail.current_version?.document?.metadata;
      const existingHash = meta && typeof meta.presetHash === "string" ? meta.presetHash : "";
      hashMatch = presetHash.length > 0 && existingHash === presetHash;
    } catch {
      // 详情拉取失败不影响其余候选判定。
    }
    if (nameMatch || hashMatch) {
      return { id: candidate.id, name: candidate.name, versionId };
    }
  }
  return null;
}

async function onPresetLoaded(document: NodeGraphDocument, name: string): Promise<void> {
  showPresetImport.value = false;
  const projectId = ctx.currentProjectId;
  const presetHash =
    typeof document.metadata?.presetHash === "string" ? document.metadata.presetHash : "";
  const match =
   projectId && graphs.value.length > 0
      ? await findDuplicateGraph(projectId, name, presetHash)
     : null;
  if (match) {
    pendingPreset.value = {
      document,
      name,
      matchGraphId: match.id,
      matchVersionId: match.versionId,
      matchName: match.name,
    };
    return;
  }
  laidOut.value = false;
  store.importPreset(document, name);
}

/** 覆盖：把草稿绑定到命中图，保存时在该图上追加新版本。 */
function onPresetOverwrite(): void {
  const pending = pendingPreset.value;
  if (!pending) {
    return;
  }
  laidOut.value = false;
  store.importPreset(pending.document, pending.name, {
    graphId: pending.matchGraphId,
    baseVersionId: pending.matchVersionId,
  });
  pendingPreset.value = null;
}

/** 作为新图导入：保持未保存草稿（保存时新建定义）。 */
function onPresetImportNew(): void {
  const pending = pendingPreset.value;
  if (!pending) {
    return;
  }
  laidOut.value = false;
  store.importPreset(pending.document, pending.name);
  pendingPreset.value = null;
}

function onPresetCancel(): void {
  pendingPreset.value = null;
}

/** 删除当前已保存的图定义本身（非清空节点）；需二次确认。 */
async function onDeleteGraph(): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (!projectId || !store.graphId || store.isSample) {
    return;
  }
  if (!window.confirm(t("graph.deleteConfirm", { name: exportGraphName.value }))) {
    return;
  }
  const ok = await store.deleteGraph(projectId);
  if (ok) {
    await loadGraphList(projectId);
  }
}

function onEnterGroup(groupId: string): void {
  laidOut.value = false;
  store.enterGroup(groupId);
}

function onToggleGroup(payload: { groupId: string; enabled: boolean }): void {
  store.setGroupEnabled(payload.groupId, payload.enabled);
}

function onSetGroupCollapsed(payload: { groupId: string; collapsed: boolean }): void {
  laidOut.value = false;
  store.setGroupCollapsed(payload.groupId, payload.collapsed);
}

function onExitGroup(): void {
  laidOut.value = false;
  store.exitGroup();
}

function onGroupSelect(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value) {
    onEnterGroup(value);
  }
}

async function onExtractGroup(): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (projectId && store.activeGroupId) {
    await store.extractGroupToNodeGroup(projectId, store.activeGroupId);
  }
}

const errorMessage = computed(() => {
  if (store.error === "blocked_by_diagnostics") {
    return t("graph.blockedSave", { count: store.errorCount });
  }
  if (store.error?.startsWith("extract_failed:")) {
    return t("graph.group.extractFailed");
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
  if (value === TEMPLATE_SOURCE) {
    store.loadTemplate("native", t("graph.template"));
    return;
  }
  if (value === TEMPLATE_COMPAT_SOURCE) {
    store.loadTemplate("compat", t("graph.templateCompat"));
    return;
  }
  const projectId = ctx.currentProjectId;
  if (projectId) {
    void store.loadGraph(projectId, value);
  }
}

/** SG11-2：插入选中的内置顾问子图（fork 进项目 + 放置 group.node）。 */
async function onInsertSubgraph(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  insertSubgraphRef.value = "";
  const projectId = ctx.currentProjectId;
  const builtin = advisorSubgraphs.find((graph) => graph.graphId === value);
  if (!projectId || !builtin || !store.document) {
    return;
  }
  const ok = await store.insertBuiltinAdvisorSubgraph(projectId, builtin);
  if (ok) {
    panelOpen.value = true;
  }
}

/** 内置顾问子图的本地化显示名（缺省回退到 core 英文名）。 */
function advisorSubgraphLabel(graph: NodeGraphDocument): string {
  const builtin = typeof graph.metadata?.builtin === "string" ? graph.metadata.builtin : "";
  const key = `graph.advisorSubgraph.${builtin.replace("advisor.", "")}`;
  return te(key) ? t(key) : graph.name;
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

function onSelectGroup(groupId: string | null): void {
  store.selectGroup(groupId);
  if (groupId) {
    panelOpen.value = true;
  }
}

function onMoveGroup(payload: { groupId: string; position: { x: number; y: number } }): void {
  store.moveCollapsedGroup(payload.groupId, payload.position);
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
    // 切项目只清助手本地态（不替用户决定 finalize / discard）。
    assistant.reset();
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

onUnmounted(() => {
  // 卸载图编辑器：仅清助手本地态。
  assistant.reset();
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
          <option :value="TEMPLATE_SOURCE">{{ t("graph.template") }}</option>
          <option :value="TEMPLATE_COMPAT_SOURCE">{{ t("graph.templateCompat") }}</option>
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

      <!-- SG11-2：插入内置顾问子图（fork 进项目 + 放置 group.node）。需项目上下文。 -->
      <select
        v-if="projectSelected"
        class="rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :value="insertSubgraphRef"
        :disabled="!store.document || store.saving"
        :aria-label="t('graph.insertSubgraph')"
        @change="onInsertSubgraph"
      >
        <option value="">+ {{ t("graph.insertSubgraph") }}</option>
        <option v-for="g in advisorSubgraphs" :key="g.graphId" :value="g.graphId">
          {{ advisorSubgraphLabel(g) }}
        </option>
      </select>

      <!-- Drill-in 分组导航：钻入时显示面包屑，否则提供「进入分组」选择器 -->
      <template v-if="store.activeGroup">
        <UiButton variant="ghost" class="!h-7 !px-2 text-xs" @click="onExitGroup">
          <CornerUpLeft :size="12" :stroke-width="1.5" />
          {{ t("graph.group.root") }}
        </UiButton>
        <span class="font-mono text-xs text-text-secondary">/ {{ store.activeGroup.name }}</span>
        <UiButton
          v-if="projectSelected"
          variant="ghost"
          class="!h-7 !px-2 text-xs"
          :disabled="store.saving"
          :title="t('graph.group.extractHint')"
          @click="onExtractGroup"
        >
          <PackagePlus :size="12" :stroke-width="1.5" />
          {{ t("graph.group.extract") }}
        </UiButton>
      </template>
      <select
        v-else-if="store.groupCount > 0"
        class="rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        value=""
        :aria-label="t('graph.group.enter')"
        @change="onGroupSelect"
      >
        <option value="">⊞ {{ t("graph.group.enter") }}</option>
        <option v-for="g in store.document?.groups ?? []" :key="g.id" :value="g.id">{{ g.name }}</option>
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
          :label="t('graph.preset.import')"
          @click="showPresetImport = true"
        >
          <FileUp :size="16" :stroke-width="1.5" />
        </UiIconButton>

        <UiIconButton
          v-if="projectSelected && store.graphId && !store.isSample"
          :label="t('graph.delete')"
          :disabled="store.saving"
          @click="onDeleteGraph"
        >
          <Trash2 :size="16" :stroke-width="1.5" />
        </UiIconButton>

        <UiIconButton
          v-if="projectSelected"
          :label="t('graph.package.import')"
          @click="showImport = true"
        >
          <Upload :size="16" :stroke-width="1.5" />
        </UiIconButton>

        <UiIconButton
          v-if="canExport"
          :label="t('graph.package.export')"
          @click="showExport = true"
        >
          <Download :size="16" :stroke-width="1.5" />
        </UiIconButton>

             <UiIconButton
          :label="projectSelected ? t('graphAssistant.toggle') : t('graphAssistant.selectProjectFirst')"
          :active="assistantOpen"
          :disabled="!projectSelected"
          @click="assistantOpen = !assistantOpen"
        >
          <Bot :size="16" :stroke-width="1.5" />
        </UiIconButton>

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
          :focus-group-id="store.activeGroupId"
          @update:laid-out="(value: boolean) => (laidOut = value)"
          @update:positions="(positions) => store.applyNodePositions(positions)"
          @select-node="(id) => store.selectNode(id)"
          @select-edge="(id) => store.selectEdge(id)"
          @connect="onConnect"
          @enter-group="onEnterGroup"
          @toggle-group="onToggleGroup"
          @set-group-collapsed="onSetGroupCollapsed"
          @select-group="onSelectGroup"
          @move-group="onMoveGroup"
        />

        <!-- AI 助手抽屉：右侧浮层，浮于画布之上，不占用诊断/检视器右栏 -->
        <GraphAssistantDrawer
          v-if="assistantOpen && projectSelected"
          :project-id="ctx.currentProjectId"
          :session-id="ctx.currentSessionId"
          @close="assistantOpen = false"
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

    <PresetImportDialog
      v-if="showPresetImport"
      @loaded="onPresetLoaded"
      @close="showPresetImport = false"
    />
    <PackageImportDialog
      v-if="showImport && ctx.currentProjectId"
      :project-id="ctx.currentProjectId"
      @imported="onImported"
      @close="showImport = false"
    />
    <PackageExportDialog
      v-if="showExport && ctx.currentProjectId && store.graphId"
      :project-id="ctx.currentProjectId"
      :graph-id="store.graphId"
      :version-id="store.baseVersionId"
      :graph-name="exportGraphName"
      @close="showExport = false"
    />

    <!-- 重复导入决策：覆盖已有图 / 作为新图 / 取消 -->
    <div
      v-if="pendingPreset"
      class="fixed inset-0 z-50 flex items-center justify-center bg-app/70 p-4"
      @click.self="onPresetCancel"
    >
      <div class="w-full max-w-md rounded-lg border border-line-active bg-panel p-4">
        <h2 class="text-sm font-medium text-text-primary">{{ t("graph.preset.duplicateTitle") }}</h2>
        <p class="mt-2 text-xs leading-relaxed text-text-secondary">
          {{ t("graph.preset.duplicateHint", { name: pendingPreset.matchName }) }}
        </p>
        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <UiButton variant="ghost" @click="onPresetCancel">{{ t("graph.preset.cancel") }}</UiButton>
          <UiButton variant="ghost" @click="onPresetImportNew">{{ t("graph.preset.importAsNew") }}</UiButton>
          <UiButton @click="onPresetOverwrite">{{ t("graph.preset.overwrite") }}</UiButton>
        </div>
      </div>
    </div>
  </section>
</template>
