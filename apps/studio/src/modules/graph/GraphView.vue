<script setup lang="ts">
import { listBuiltinAdvisorSubgraphs, type NodeGraphDocument } from "@tavern/core/node-graph";
import { AlertCircle, BookOpen, Bot, ChevronDown, CornerUpLeft, Download, FileDown, GitCompare, GripVertical, Link2, Package, PackagePlus, PanelRightClose, PanelRightOpen, Play, RotateCcw, Save, Settings, ShieldCheck, Trash2, Unlink2, Upload, Workflow, Wrench, X } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { nodeGraphApi, type NodeGraphDefinitionResponse } from "../../lib/nodegraph-api";
import { useContextStore } from "../../stores/context";
import { useGraphAssistantStore } from "../../stores/graph-assistant";
import { useGraphEditorStore } from "../../stores/graph-editor";
import { useModelsStore } from "../../stores/models";
import UiButton from "../../ui/UiButton.vue";
import UiDropdown from "../../ui/UiDropdown.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import UiMenuItem from "../../ui/UiMenuItem.vue";
import GraphAssistantDrawer from "./assistant/GraphAssistantDrawer.vue";
import GraphCanvas from "./canvas/GraphCanvas.vue";
import GraphVersionDiffPanel from "./diff/GraphVersionDiffPanel.vue";
import PresetImportDialog from "./import/PresetImportDialog.vue";
import GraphSettingsPanel from "./settings/GraphSettingsPanel.vue";
import PackageExportDialog from "./package/PackageExportDialog.vue";
import PackageImportDialog from "./package/PackageImportDialog.vue";
import { applyInlineConfigValue } from "./inline-config/node-inline-config";
import { useGraphRun } from "./run/use-graph-run";
import { summarizeNodeRunStatuses } from "./run/graph-run-view";
import NodeTypeBrowser from "./node-types/NodeTypeBrowser.vue";
import NodeTypePicker from "./node-types/NodeTypePicker.vue";
import DiagnosticsPanel from "./panels/DiagnosticsPanel.vue";
import NodeInspector from "./panels/NodeInspector.vue";
import type { DiagnosticTarget } from "./validate/local-validation";

const { t, te } = useI18n();
const ctx = useContextStore();
const store = useGraphEditorStore();
const assistant = useGraphAssistantStore();
const models = useModelsStore();

/** Agent 节点卡片 / 图设置中的模型来源下拉选项：取 account 作用域的模型档案列表。 */
const llmProfileOptions = computed(() =>
  models.profiles.map((profile) => ({ id: profile.id, name: profile.presetName })),
);

const SAMPLE_SOURCE = "__sample__";
/** DG11：内置 native「默认楼层模板」源标识（可 fork 的系统图同结构副本）。 */
const TEMPLATE_SOURCE = "__template__";
/** CG11-2：内置 compat「默认楼层模板」源标识（compat 系统图同结构副本，零 Agentic）。 */
const TEMPLATE_COMPAT_SOURCE = "__template_compat__";

/** SG11-2：内置顾问子图清单（director / verifier / memory），合并进「添加」菜单顶部分区。 */
const advisorSubgraphs = listBuiltinAdvisorSubgraphs();

const graphs = ref<NodeGraphDefinitionResponse[]>([]);
const laidOut = ref(false);
const highlight = ref<DiagnosticTarget | null>(null);
const panelOpen = ref(true);
const rightPanelMode = ref<"inspector" | "settings">("inspector");
const showNodeTypeBrowser = ref(false);
const nodeTypeBrowserType = ref<string | null>(null);
/** AI 助手抽屉开合（图编辑器内的临时对话容器）。 */
const assistantOpen = ref(false);

/**
 * 画布底部活动栏拖拽：默认底部居中，拖拽手柄后产生相对偏移量（x 向右为正、y 向下为正）。
 * 仅记录相对位移，不接管严格边界（用户可自由拖到画布任意处）。
 */
const activityBarOffset = ref({ x: 0, y: 0 });
const activityBarDragging = ref(false);
let activityBarDragStart: { pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null = null;

function onActivityBarDragStart(event: PointerEvent): void {
  activityBarDragging.value = true;
  activityBarDragStart = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    offsetX: activityBarOffset.value.x,
    offsetY: activityBarOffset.value.y,
  };
  window.addEventListener("pointermove", onActivityBarDragMove);
  window.addEventListener("pointerup", onActivityBarDragEnd);
}

function onActivityBarDragMove(event: PointerEvent): void {
  if (!activityBarDragStart) {
    return;
  }
  activityBarOffset.value = {
    x: activityBarDragStart.offsetX + (event.clientX - activityBarDragStart.pointerX),
    y: activityBarDragStart.offsetY + (event.clientY - activityBarDragStart.pointerY),
  };
}

function onActivityBarDragEnd(): void {
  activityBarDragging.value = false;
  activityBarDragStart = null;
  window.removeEventListener("pointermove", onActivityBarDragMove);
  window.removeEventListener("pointerup", onActivityBarDragEnd);
}

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

/** SG11-2：顾问子图插入可用性（需项目上下文 + 有文档 + 非保存中）。 */
const canInsertSubgraph = computed(() =>
  Boolean(projectSelected.value && store.document && !store.saving),
);

const showExport = ref(false);
const showImport = ref(false);
const showPresetImport = ref(false);
const showDiff = ref(false);
const canExport = computed(() =>
  Boolean(projectSelected.value && store.graphId && store.baseVersionId && !store.isSample),
);
const canServerValidate = computed(() =>
  Boolean(projectSelected.value && store.graphId && store.document && !store.isSample && !store.serverValidating),
);
const canShowDiff = computed(() => Boolean(store.document && store.versions.length > 0));
const exportGraphName = computed(() => graphs.value.find((graph) => graph.id === store.graphId)?.name ?? "nodegraph");
const floorBindingKinds = ["native", "compat"] as const;

function floorBindingLabel(kind: "native" | "compat"): string {
  return t(`graph.floorBinding.kind.${kind}`);
}

function floorBindingStatusText(kind: "native" | "compat"): string {
  const binding = store.getFloorGraphBinding(kind);
  if (!binding) {
    return t("graph.floorBinding.unbound", { kind: floorBindingLabel(kind) });
  }
  if (store.isCurrentVersionBoundAs(kind)) {
    return t("graph.floorBinding.boundCurrent", {
      kind: floorBindingLabel(kind),
      version: binding.graph_version_no,
    });
  }
  if (store.hasCurrentGraphFloorBindingVersionMismatch(kind)) {
    return t("graph.floorBinding.boundOlderVersion", {
      kind: floorBindingLabel(kind),
      version: binding.graph_version_no,
    });
  }
  return t("graph.floorBinding.boundOtherGraph", {
    kind: floorBindingLabel(kind),
    graph: binding.graph_name,
    version: binding.graph_version_no,
  });
}

const compatFloorImportNotice = computed(() => {
  if (!store.isCompatFloorImportDraft) {
    return "";
  }
  if (store.isCurrentVersionBoundAs("compat")) {
    return t("graph.floorBinding.compatImportDraftBound");
  }
  if (store.hasCurrentGraphFloorBindingVersionMismatch("compat")) {
    const binding = store.getFloorGraphBinding("compat");
    return t("graph.floorBinding.compatImportDraftVersionMismatch", {
      version: binding?.graph_version_no ?? "?",
    });
  }
  if (!store.graphId || !store.baseVersionId || store.isSample) {
    return t("graph.floorBinding.compatImportDraftUnsaved");
  }
  return t("graph.floorBinding.compatImportDraftSavedUnbound");
});

function floorBindingSetTitle(kind: "native" | "compat"): string {
  if (!projectSelected.value) {
    return t("graph.selectProjectFirst");
  }
  if (!store.graphId || !store.baseVersionId || store.isSample) {
    return t("graph.floorBinding.saveFirst");
  }
  return t("graph.floorBinding.set", { kind: floorBindingLabel(kind) });
}

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
  if (store.error === "schema_upgraded_to_v2") {
    return t("graph.schemaUpgradedToV2");
  }
  if (store.error === "server_validate_unavailable") {
    return t("graph.serverValidateUnavailable");
  }
  if (store.error?.startsWith("extract_failed:")) {
    return t("graph.group.extractFailed");
  }
  return store.error;
});

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
  // NG2-4：切图时清除旧运行状态叠加，避免旧状态错位到新图。
  clearRunState();
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
async function onInsertSubgraph(graphId: string): Promise<void> {
  const projectId = ctx.currentProjectId;
  const builtin = advisorSubgraphs.find((graph) => graph.graphId === graphId);
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

function onAddNode(payload: { type: string; typeVersion?: string }): void {
  const node = store.addNode(payload.type, payload.typeVersion ?? "1");
  if (node) {
    rightPanelMode.value = "inspector";
    panelOpen.value = true;
    nodeTypeBrowserType.value = node.type;
    showNodeTypeBrowser.value = false;
  }
}

function onOpenNodeType(type: string): void {
  nodeTypeBrowserType.value = type;
  showNodeTypeBrowser.value = true;
}

function onVersionChange(event: Event): void {
  laidOut.value = false;
  // NG2-4：切版本时清除旧运行状态。
  clearRunState();
  store.loadVersion((event.target as HTMLSelectElement).value);
}

async function onSetCurrent(): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (projectId && store.baseVersionId) {
    await store.setAsCurrentVersion(projectId, store.baseVersionId);
  }
}

async function onSetFloorBinding(kind: "native" | "compat"): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (projectId) {
    await store.setCurrentGraphAsFloorBinding(projectId, kind);
  }
}

async function onClearFloorBinding(kind: "native" | "compat"): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (projectId) {
    await store.clearFloorGraphBinding(projectId, kind);
  }
}

async function onServerValidate(): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (!projectId || !store.graphId || !store.document || store.isSample) {
    store.error = "server_validate_unavailable";
    return;
  }
  await store.validateOnServer(projectId);
  panelOpen.value = true;
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
    rightPanelMode.value = "inspector";
  } else if (target.edgeId) {
    store.selectEdge(target.edgeId);
    rightPanelMode.value = "inspector";
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
    rightPanelMode.value = "inspector";
    panelOpen.value = true;
  }
}

function onMoveGroup(payload: { groupId: string; position: { x: number; y: number } }): void {
  store.moveCollapsedGroup(payload.groupId, payload.position);
}

function onCanvasSelectNode(id: string | null): void {
  store.selectNode(id);
  if (id) {
    rightPanelMode.value = "inspector";
  }
}

function onCanvasSelectEdge(id: string | null): void {
  store.selectEdge(id);
  if (id) {
    rightPanelMode.value = "inspector";
  }
}

function onInlineConfigUpdate(payload: { nodeId: string; path: string; value: unknown; emptyValue?: "delete" | "keep" | "null" }): void {
  const node = store.document?.nodes.find((candidate) => candidate.id === payload.nodeId);
  if (!node) {
    return;
  }
  const next = applyInlineConfigValue(node.config, payload.path, payload.value, { emptyValue: payload.emptyValue });
  store.updateNodeConfig(node.id, next);
}

function onOpenNodeInspector(nodeId: string): void {
  store.selectNode(nodeId);
  rightPanelMode.value = "inspector";
  panelOpen.value = true;
}

function onOpenGraphSettings(): void {
  rightPanelMode.value = "settings";
  panelOpen.value = true;
}

// NG2-4：编辑现场安全运行。第一版默认 dry_run，运行的是已保存版本（dirty 时禁用）。
const { state: runState, runGraph, stopPolling, clearRunState } = useGraphRun();

/** 运行按钮可用性：需有项目、已保存图版本、非示例、无未保存改动、非保存/提交中。 */
const canRunGraph = computed(() =>
  Boolean(
    projectSelected.value
      && store.graphId
      && store.baseVersionId
      && store.document
      && !store.isSample
      && !store.dirty
      && !store.saving
      && runState.value.status !== "submitting"
      && runState.value.status !== "running",
  ),
);

/** 运行按钮禁用时的定位提示。 */
const runGraphTitle = computed(() => {
  if (!projectSelected.value) {
    return t("graph.run.noProject");
  }
  if (store.isSample) {
    return t("graph.run.sampleUnavailable");
  }
  if (!store.graphId || !store.baseVersionId) {
    return t("graph.run.noVersion");
  }
  if (store.dirty) {
    return t("graph.run.saveFirst");
  }
  return t("graph.run.dryRunHint");
});

const runStatusLabel = computed(() => {
  const key = `graph.run.status.${runState.value.status}`;
  return te(key) ? t(key) : runState.value.status;
});

const runNodeSummary = computed(() => summarizeNodeRunStatuses(runState.value.nodeStatusById));

async function onRunGraph(): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (!projectId || !store.graphId || !store.baseVersionId || !canRunGraph.value) {
    return;
  }
  await runGraph({
    projectId,
    graphId: store.graphId,
    input: {
      version_id: store.baseVersionId,
      intent: "dry_run",
      dry_run: true,
      session_id: ctx.currentSessionId ?? null,
    },
  });
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
      void store.loadFloorGraphBindings(projectId);
    } else {
      graphs.value = [];
      store.floorGraphBindings = [];
    }
  },
);

onMounted(()=> {
  store.loadSample();
  // Agent 节点卡片上的模型来源下拉需要真实 Profile 列表；失败不阻断图编辑。
  void models.loadProfiles().catch(() => undefined);
  if (ctx.currentProjectId) {
    void loadGraphList(ctx.currentProjectId);
    void store.loadFloorGraphBindings(ctx.currentProjectId);
  }
});

onUnmounted(() => {
  // 卸载图编辑器：仅清助手本地态。
  assistant.reset();
  // 避免拖拽中卸载遗留全局指针监听。
  onActivityBarDragEnd();
});
</script>

<template>
  <section class="flex h-full min-h-0 flex-col overflow-hidden">
    <!-- Toolbar：左侧“看哪张图 + 往图里加东西”，右侧“状态 + 主动作 + 菜单收纳的次要动作” -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line-active bg-panel px-3">
      <!-- 组 1：图源与版本 -->
      <div class="flex items-center gap-1.5">
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
       v{{ version.version_no }}{{ version.id === store.serverCurrentVersionId ? ` · ${t("graph.versionCurrent")}`: "" }}
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
      </div>

      <div class="h-5 w-px shrink-0 bg-line-subtle" aria-hidden="true" />

      <!-- 组 2：构建与导航 -->
      <div class="flex items-center gap-1.5">
        <NodeTypePicker
          :entries="store.availableNodeTypes"
          :disabled="!store.document"
          :advisor-subgraphs="advisorSubgraphs"
          :can-insert-subgraph="canInsertSubgraph"
          :advisor-label="advisorSubgraphLabel"
          @add="onAddNode"
          @insert-subgraph="onInsertSubgraph"
        />

        <!-- Drill-in 分组导航：钻入时显示面包屑（回根图 / 当前组名 / 提取）；进入分组改为双击画布组节点 -->
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
      </div>

      <!-- 右区：状态 · 保存 · 菜单收纳的次要动作 -->
      <div class="ml-auto flex items-center gap-2">
        <!-- 状态：错误 / 脏点 / 丢弃草稿 -->
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

        <div v-if="store.draftRestored || errorMessage" class="h-5 w-px shrink-0 bg-line-subtle" aria-hidden="true" />

        <!-- 主动作：保存（最常用、单独突出） -->
        <UiButton
          class="!h-7 !px-2 text-xs"
          :disabled="!store.canSaveVersion || !projectSelected"
          :title="!projectSelected ? t('graph.selectProjectFirst') : t('graph.save')"
          @click="onSave"
        >
          <Save :size="12" :stroke-width="1.5" />
          {{ store.saving ? t("graph.saving") : t("graph.save") }}
        </UiButton>

        <!-- 工具菜单：服务端校验 · 版本 diff · 楼层图绑定 -->
        <UiDropdown align="right" panel-width="18rem">
          <template #trigger="{ toggle, open }">
            <UiButton variant="ghost" class="!h-7 !px-2 text-xs" :class="open ? 'bg-float text-text-primary' : ''" @click="toggle">
              <Wrench :size="12" :stroke-width="1.5" />
              {{ t("graph.tools") }}
              <ChevronDown :size="12" :stroke-width="1.5" />
            </UiButton>
          </template>
          <template #default="{ close }">
            <UiMenuItem
              :label="t('graph.nodeType.openBrowser')"
              @click="() => { showNodeTypeBrowser = true; close(); }"
            >
         <template #icon><BookOpen :size="14" :stroke-width="1.5" /></template>
            </UiMenuItem>
            <div class="my-1 h-px bg-line-subtle" aria-hidden="true" />
            <UiMenuItem
              :label="t('graph.settings.open')"
              :disabled="!store.document"
              @click="() => { onOpenGraphSettings(); close(); }"
            >
              <template #icon><Settings :size="14" :stroke-width="1.5" /></template>
            </UiMenuItem>
            <div class="my-1 h-px bg-line-subtle" aria-hidden="true" />
            <UiMenuItem
              :label="store.serverValidating ? t('graph.serverValidating') : t('graph.serverValidate')"
              :hint="canServerValidate ? undefined : t('graph.serverValidateUnavailable')"
              :disabled="!canServerValidate"
              @click="() => { onServerValidate(); close(); }"
            >
              <template #icon><ShieldCheck :size="14" :stroke-width="1.5" /></template>
            </UiMenuItem>
            <UiMenuItem
              :label="t('graph.diff.open')"
         :hint="canShowDiff ? undefined : t('graph.diff.noVersion')"
              :disabled="!canShowDiff"
              @click="() => { showDiff = true; close(); }"
            >
              <template #icon><GitCompare :size="14" :stroke-width="1.5" /></template>
            </UiMenuItem>

            <!-- 楼层图绑定：native / compat 的状态与绑定/解绑 -->
            <template v-if="projectSelected">
              <div class="my-1 h-px bg-line-subtle" aria-hidden="true" />
              <div class="px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-text-muted">
                {{ t("graph.floorBinding.title") }}
              </div>
              <div
                v-for="kind in floorBindingKinds"
                :key="kind"
                class="flex items-center gap-2 px-3 py-1"
              >
                <span
                  class="rounded border px-1.5 py-0.5 font-mono text-[10px]"
                  :class="store.isCurrentVersionBoundAs(kind)
                    ? 'border-signal-accent/50 text-signal-accent'
                    : store.hasCurrentGraphFloorBindingVersionMismatch(kind)
                      ? 'border-signal-warn/60 text-signal-warn'
                      : 'border-line-subtle text-text-muted'"
                  :title="floorBindingStatusText(kind)"
                >
                  {{ floorBindingLabel(kind) }}
                </span>
             <span class="min-w-0 flex-1 truncate text-[10px] text-text-muted" :title="floorBindingStatusText(kind)">
                  {{ floorBindingStatusText(kind) }}
                </span>
                <UiIconButton
                  :label="floorBindingSetTitle(kind)"
                  :disabled="!store.canBindCurrentVersionAsFloorGraph || !projectSelected"
                  @click="onSetFloorBinding(kind)"
                >
                  <Link2 :size="14" :stroke-width="1.5" />
                </UiIconButton>
                <UiIconButton
                  :label="t('graph.floorBinding.clear', { kind: floorBindingLabel(kind) })"
                  :disabled="!store.getFloorGraphBinding(kind) || store.floorGraphBindingSaving"
                  @click="onClearFloorBinding(kind)"
                >
                  <Unlink2 :size="14" :stroke-width="1.5" />
          </UiIconButton>
              </div>
            </template>
          </template>
        </UiDropdown>

        <div class="h-5 w-px shrink-0 bg-line-subtle" aria-hidden="true" />

        <!-- 导入菜单：导入图 · 导入预设（箭头向下 = 把外部资产取进来） -->
        <UiDropdown align="right" panel-width="14rem">
          <template #trigger="{ toggle, open }">
            <UiIconButton :label="t('graph.importMenu')" :active="open" @click="toggle">
              <Download :size="16" :stroke-width="1.5" />
            </UiIconButton>
          </template>
          <template #default="{ close }">
            <UiMenuItem
      v-if="projectSelected"
              :label="t('graph.package.import')"
              @click="() => { showImport = true; close(); }"
          >
              <template #icon><Package :size="14" :stroke-width="1.5" /></template>
            </UiMenuItem>
            <UiMenuItem
              :label="t('graph.preset.import')"
              @click="() => { showPresetImport = true; close(); }"
            >
              <template #icon><FileDown :size="14" :stroke-width="1.5" /></template>
            </UiMenuItem>
          </template>
        </UiDropdown>

        <!-- 导出：箭头向上 = 把当前图送出去；已有 package 导出走弹窗，否则为占位 -->
        <UiIconButton
          v-if="canExport"
          :label="t('graph.package.export')"
          @click="showExport = true"
        >
          <Upload :size="16" :stroke-width="1.5" />
        </UiIconButton>
        <UiIconButton
          v-else
          :label="t('graph.exportPlaceholder')"
          disabled
        >
          <Upload :size="16" :stroke-width="1.5" />
        </UiIconButton>

        <div class="h-5 w-px shrink-0 bg-line-subtle" aria-hidden="true" />

        <!-- 删除 · AI 助手 · 面板开合 -->
        <div class="flex items-center gap-1">
          <UiIconButton
            v-if="projectSelected && store.graphId && !store.isSample"
       :label="t('graph.delete')"
            :disabled="store.saving"
            @click="onDeleteGraph"
          >
            <Trash2 :size="16" :stroke-width="1.5" />
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
    </div>


    <!-- Body -->
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          v-if="compatFloorImportNotice"
          class="pointer-events-none absolute left-3 right-3 top-3 z-10 rounded-md border border-signal-accent/40 bg-panel/95 px-3 py-2 text-xs leading-relaxed text-text-secondary shadow-sm"
        >
          {{ compatFloorImportNotice }}
        </div>
        <!-- 画布左上角：节点/边/组计数（从 header 移出，一排贴图显示） -->
        <div
          v-if="counts"
          class="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 font-mono text-[10px] text-text-muted"
        >
          <span class="rounded border border-line-subtle bg-panel/85 px-1.5 py-0.5">{{ counts.nodes }} {{ t("graph.nodes") }}</span>
          <span class="rounded border border-line-subtle bg-panel/85 px-1.5 py-0.5">{{ counts.edges }} {{ t("graph.edges") }}</span>
          <span class="rounded border border-line-subtle bg-panel/85 px-1.5 py-0.5">{{ counts.groups }} {{ t("graph.groups") }}</span>
          <span
            v-if="usesPlaceholderLayout"
            class="rounded border border-line-subtle bg-panel/85 px-1.5 py-0.5"
            :title="t('graph.placeholderHint')"
          >{{ t("graph.placeholder") }}</span>
        </div>


        <!-- NG2-4：运行状态小浮层（右上角）：显示整体状态、run/job id、节点统计与控制。 -->
        <div
          v-if="runState.status !== 'idle'"
          class="absolute right-3 top-3 z-20 w-64 rounded-md border border-line-subtle bg-panel/95 px-3 py-2 text-xs shadow-md"
        >
          <div class="flex items-center justify-between gap-2">
            <span
              class="font-mono text-[11px]"
          :class="{
                'text-signal-accent': runState.status === 'running' || runState.status === 'submitting',
                'text-signal-success': runState.status === 'succeeded',
                'text-signal-error': runState.status === 'failed',
                'text-signal-warn': runState.status === 'timeout' || runState.status === 'queued',
                'text-text-muted': runState.status === 'cancelled',
              }"
            >
              {{ runStatusLabel }}
            </span>
            <button
              type="button"
              class="rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
              :title="t('graph.run.clearStatus')"
              @click="clearRunState"
        >
              <X :size="12" :stroke-width="1.5" />
            </button>
          </div>

          <p v-if="runState.runId" class="mt-1 truncate font-mono text-[10px] text-text-muted">
            {{ runState.runId }}
          </p>
          <p v-else-if="runState.jobId" class="mt-1 truncate font-mono text-[10px] text-text-muted">
            job · {{ runState.jobId }}
          </p>

          <p
            v-if="runState.queuedWithoutRun"
            class="mt-1 leading-relaxed text-text-muted"
          >
            {{ t("graph.run.queuedWithoutRun") }}
            <span v-if="runState.workerEnabled === false"> {{ t("graph.run.workerMayBeRequired") }}</span>
          </p>

          <p
       v-else-if="runNodeSummary.total > 0"
            class="mt-1 leading-relaxed text-text-secondary"
          >
            {{ t("graph.run.nodeStatusSummary", {
              total: runNodeSummary.total,
              succeeded: runNodeSummary.succeeded,
              failed: runNodeSummary.failed,
            }) }}
          </p>

          <p v-if="runState.errorMessage" class="mt-1 leading-relaxed text-signal-error">
            {{ runState.errorMessage }}
          </p>

          <div class="mt-2 flex justify-end gap-2">
            <UiButton
              v-if="runState.status === 'running'"
              variant="ghost"
              class="!h-6 !px-2 text-[10px]"
              :title="t('graph.run.stopPollingHint')"
          @click="stopPolling"
            >
              {{ t("graph.run.stopPolling") }}
            </UiButton>
         </div>
        </div>
        <!-- 画布底部活动栏（ComfyUI 风格）：可拖拽，左侧手柄图标；当前只放一个试运行按钮 -->
            <div
          class="absolute bottom-4 left-1/2 z-20"
          :style="{ transform: `translate(calc(-50% + ${activityBarOffset.x}px), ${activityBarOffset.y}px)` }"
        >
          <div
            class="flex items-center gap-1 rounded-lg border border-line-active bg-panel/95 py-1.5 pl-1 pr-2"
            :class="activityBarDragging ? 'border-signal-accent/60' : ''"
          >
            <button
              type="button"
              class="flex h-8 cursor-grab items-center px-1 text-text-muted transition-colors duration-150 hover:text-text-secondary active:cursor-grabbing"
              :class="activityBarDragging ? 'cursor-grabbing text-text-secondary' : ''"
              :aria-label="t('graph.run.dragHandle')"
              :title="t('graph.run.dragHandle')"
              @pointerdown="onActivityBarDragStart"
            >
              <GripVertical :size="16" :stroke-width="1.5" />
      </button>
            <UiButton
              class="!h-8 !px-3 text-xs"
              :disabled="!canRunGraph"
              :title="runGraphTitle"
              @click="onRunGraph"
            >
       <Play :size="14" :stroke-width="1.5" />
              {{ runState.status === "running" || runState.status === "submitting" ? t("graph.run.running") : t("graph.run.dryRun") }}
            </UiButton>
          </div>
        </div>

        <GraphCanvas
          v-if="store.document"
          :document="store.document"
          editable
          :reset-key="store.loadToken"
          :highlight="highlight"
          :focus-group-id="store.activeGroupId"
          :run-status-by-node-id="runState.nodeStatusById"
          :llm-profiles="llmProfileOptions"
          @update:laid-out="(value: boolean) => (laidOut = value)"
          @update:positions="(positions) => store.applyNodePositions(positions)"
          @select-node="onCanvasSelectNode"
          @select-edge="onCanvasSelectEdge"
          @connect="onConnect"
          @enter-group="onEnterGroup"
          @toggle-group="onToggleGroup"
          @set-group-collapsed="onSetGroupCollapsed"
          @select-group="onSelectGroup"
          @move-group="onMoveGroup"
          @update-node-config="onInlineConfigUpdate"
          @open-node-inspector="onOpenNodeInspector"
        />

        <div v-else-if="store.loading" class="absolute inset-0 flex flex-col gap-2 p-4">
          <div class="h-6 w-40 animate-pulse rounded bg-float" />
          <div class="min-h-0 flex-1 rounded bg-float" />
        </div>

        <div v-else class="absolute inset-0 flex items-center justify-center p-8">
          <div class="flex max-w-md flex-col items-center text-center">
            <Workflow :size="32" :stroke-width="1.25" class="text-text-muted" />
            <h1 class="mt-4 text-base font-medium text-text-primary">{{ t("graph.emptyTitle") }}</h1>
            <p class="mt-2 text-sm leading-relaxed text-text-secondary">{{ t("graph.noVersion") }}</p>
          </div>
        </div>

        <!-- AI 助手抽屉：右侧浮层，浮于画布之上，不占用诊断/检视器右栏 -->
        <GraphAssistantDrawer
          v-if="assistantOpen && projectSelected"
          :project-id="ctx.currentProjectId"
          :session-id="ctx.currentSessionId"
          @close="assistantOpen = false"
        />
      </div>

      <!-- Right panel: diagnostics + inspector -->
      <aside
        v-if="panelOpen"
                class="flex w-80 shrink-0 flex-col border-l border-line-active bg-panel"
      >
        <div class="flex min-h-0 flex-[2] flex-col border-b border-line-subtle">
          <DiagnosticsPanel
            :diagnostics="store.diagnostics"
            :active-target="activeTarget"
            @locate="onLocate"
          />
        </div>
        <div class="flex min-h-0 flex-[3] flex-col">
          <GraphSettingsPanel
            v-if="rightPanelMode === 'settings'"
            :document="store.document"
            :diagnostics="store.diagnostics"
            :selected-node="store.selectedNode"
            :llm-profiles="llmProfileOptions"
            :readonly="store.isSample || store.saving"
            @update-policies="store.updateGraphPolicies"
            @update-permissions="store.updateGraphPermissions"
            @update-budgets="store.updateGraphBudgets"
            @update-node-config="(nodeId, config) => store.updateNodeConfig(nodeId, config)"
            @focus-node="onOpenNodeInspector"
          />
          <NodeInspector v-else @open-node-type="onOpenNodeType" />
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
    <GraphVersionDiffPanel
      v-if="showDiff && store.document"
      :current-document="store.document"
      :current-version-id="store.baseVersionId"
      :versions="store.versions"
      :graph-name="store.graphName"
      @close="showDiff = false"
    />
    <NodeTypeBrowser
      v-if="showNodeTypeBrowser"
      :entries="store.availableNodeTypes"
      :selected-type="nodeTypeBrowserType"
      :can-add="Boolean(store.document)"
      @add="onAddNode"
      @close="showNodeTypeBrowser = false"
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
