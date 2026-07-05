<script setup lang="ts">
import {
  createDefaultNodeTypeRegistry,
  resolveNodeGraphNodePorts,
  nodeGraphEdgeKind,
  type NodeGraphDocument,
  type NodeGraphNodeRunStatus,
  type NodeGraphPortType,
} from "@tavern/core/node-graph";
import {
  Panel,
  VueFlow,
  useVueFlow,
  type Connection,
  type EdgeMouseEvent,
  type GraphNode as FlowGraphNode,
  type NodeDragEvent,
  type NodeMouseEvent,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import { EyeOff, Minus, Spline, Wand2 } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, toRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import "@vue-flow/core/dist/style.css";

import UiIconButton from "../../../ui/UiIconButton.vue";
import { useAutoLayout } from "../layout/use-auto-layout";
import { isEditableTarget } from "../keyboard-shortcuts";
import type { DiagnosticTarget } from "../validate/local-validation";
import GraphCollapsedGroupNode from "./nodes/GraphCollapsedGroupNode.vue";
import GraphGroupNode from "./nodes/GraphGroupNode.vue";
import GraphNode from "./nodes/GraphNode.vue";
import {
  GRAPH_CONNECTING_SOURCE_TYPE_KEY,
  GRAPH_EDITABLE_KEY,
  GRAPH_GROUP_COLLAPSE_KEY,
  GRAPH_GROUP_ENTER_KEY,
  GRAPH_GROUP_TOGGLE_KEY,
} from "./editable-context";
import {
  COLLAPSED_NODE_ID_PREFIX,
  GROUP_COLLAPSED_NODE_TYPE,
  GROUP_NODE_TYPE,
  NODE_HEADER_HEIGHT,
  NODE_PORT_ROW_HEIGHT,
  NODE_WIDTH,
  TAVERN_NODE_TYPE,
  decorateSelectedEdge,
  mapDocumentToFlow,
  type GraphFlowNodeData,
} from "./map-document";
import {
  collectCutEdges,
    pickLazyConnectTarget,
  type CandidateInputPort,
  type CuttableEdge,
  type Point,
} from "./connect-geometry";
import type { InlineConfigLlmProfileOption } from "../inline-config/node-inline-config";
import { phaseStyle } from "./port-styles";

const props = withDefaults(
  defineProps<{
    document: NodeGraphDocument;
    runStatusByNodeId?: Record<string, NodeGraphNodeRunStatus>;
    editable?: boolean;
    /** 远程定位目标（诊断面板点击）→ 选中并居中。 */
    highlight?: DiagnosticTarget | null;
    /** 重挂载键：仅在加载 / 切换版本时变化，编辑增删时保持稳定（增量更新）。 */
    resetKey?: string | number;
    /** 钻入（drill-in）：仅渲染该组成员；null = 根图。 */
    focusGroupId?: string | null;
    /** 可选的 LLM Profile 列表：供 Agent 节点卡片上的模型来源下拉选择。 */
    llmProfiles?: InlineConfigLlmProfileOption[];
    /** NG2-6：当前选中的边 id（选中高亮）。 */
    selectedEdgeId?: string | null;
  }>(),
  { editable: false, highlight: null, runStatusByNodeId: () => ({}), resetKey: undefined, focusGroupId: null, llmProfiles: () => [], selectedEdgeId: null },
);

const emit = defineEmits<{
  (event: "update:laidOut", value: boolean): void;
  (event: "update:positions", positions: Record<string, { x: number; y: number }>): void;
  (event: "selectNode", nodeId: string | null): void;
  (event: "selectEdge", edgeId: string | null): void;
  (event: "connect", payload: { source: string; target: string; sourceHandle: string; targetHandle: string }): void;
  (event: "enterGroup", groupId: string): void;
  (event: "toggleGroup", payload: { groupId: string; enabled: boolean }): void;
  (event: "setGroupCollapsed", payload: { groupId: string; collapsed: boolean }): void;
  (event: "selectGroup", groupId: string | null): void;
  (event: "moveGroup", payload: { groupId: string; position: { x: number; y: number } }): void;
  (event: "updateNodeConfig", payload: { nodeId: string; path: string; value: unknown; emptyValue?: "delete" | "keep" | "null" }): void;
  (event: "openNodeInspector", nodeId: string): void;
  /** NG2-6：键盘删除当前选中的节点 / 边（由 GraphView 转调 store）。 */
  (event: "deleteSelection", payload: { nodeIds: string[]; edgeIds: string[] }): void;
  /** NG2-6：快捷键：复制选中节点。 */
  (event: "duplicateSelection", nodeIds: string[]): void;
  /** NG2-6：快捷键：把选中节点成组。 */
  (event: "groupSelection", nodeIds: string[]): void;
  /** NG2-6：快捷键：撤销 / 重做。 */
  (event: "undo"): void;
  (event: "redo"): void;
  /** NG2-6：`Shift+A` 唤起节点搜索面板（在画布坐标落点）。 */
  (event: "requestAddNode", position: { x: number; y: number } | null): void;
  /** NG2-6：cut connection：批量断开相交的连线。 */
  (event: "cutEdges", edgeIds: string[]): void;
  /** NG2-6：lazy connect：自动选目标节点最近兼容端口完成连线。 */
  (event: "lazyConnect", payload: { source: string; sourceHandle: string; target: string; targetHandle: string }): void;
}>();

const { t } = useI18n();

const flowId = "graph-canvas";
const {
  getNodes,
  getSelectedNodes,
  getSelectedEdges,
  findNode,
  findEdge,
  fitView,
  addSelectedNodes,
  addSelectedEdges,
  removeSelectedElements,
  screenToFlowCoordinate,
} = useVueFlow(flowId);
const { isLayouting, runAutoLayout } = useAutoLayout();

const registry = createDefaultNodeTypeRegistry();
const canvasRef = ref<HTMLDivElement | null>(null);

// 供自定义节点决定端口是否可连线（编辑态才允许）。
provide(GRAPH_EDITABLE_KEY, toRef(props, "editable"));
// NG2-6：拖出连线时的源端口类型（供输入端口兼容高亮）。
const connectingSourceType = ref<NodeGraphPortType | null>(null);
provide(GRAPH_CONNECTING_SOURCE_TYPE_KEY, connectingSourceType);
// 组开关回调：组容器点击开关 → 上抛 toggleGroup（编辑态由 GraphGroupNode 自身把关是否显示）。
provide(GRAPH_GROUP_TOGGLE_KEY, (groupId: string, enabled: boolean) => {
  emit("toggleGroup", { groupId, enabled });
});
// 折叠/展开回调：折叠节点的展开按钮 → 上抛 setGroupCollapsed。
provide(GRAPH_GROUP_COLLAPSE_KEY, (groupId: string, collapsed: boolean) => {
  emit("setGroupCollapsed", { groupId, collapsed });
});
// 进入子图回调：折叠节点的「进入」按钮 → 上抛 enterGroup（与双击同义）。
provide(GRAPH_GROUP_ENTER_KEY, (groupId: string) => {
  emit("enterGroup", groupId);
});

// 注意：不把 `selectedEdgeId` 传入映射，否则选中边会连带 nodes 一起重算，
// 从而丢失仅存于视图层、未写回文档的自动布局坐标（节点回退到默认排布）。
const mapped = computed(() =>
  mapDocumentToFlow(props.document, {
    runStatusByNodeId: props.runStatusByNodeId,
    focusGroupId: props.focusGroupId,
    llmProfiles: props.llmProfiles,
  }),
);
const nodes = computed(() => mapped.value.nodes);
// 选中边高亮单独叠加：仅影响 edges，不触发 nodes 重算。
const edges = computed(() =>
  mapped.value.edges.map((edge) => decorateSelectedEdge(edge, edge.id === props.selectedEdgeId)),
);

/**
 * 连线渲染模式（左下角切换）：
 * - `all`：全部显示；
 * - `solid`：仅显示实线（虚线 = control 边或产出侧关闭的 muted 边）；
 * - `none`：全部不显示。
 */
type EdgeRenderMode = "all" | "solid" | "none";
const EDGE_RENDER_ORDER: EdgeRenderMode[] = ["all", "solid", "none"];
const edgeRenderMode = ref<EdgeRenderMode>("all");

const displayEdges = computed(() => {
  if (edgeRenderMode.value === "none") {
    return [];
  }
  if (edgeRenderMode.value === "solid") {
    return edges.value.filter((edge) => !(edge.data?.kind === "control" || edge.data?.muted));
  }
  return edges.value;
});

const edgeRenderIcon = computed(() => {
  switch (edgeRenderMode.value) {
    case "solid":
      return Minus;
    case "none":
      return EyeOff;
    default:
      return Spline;
  }
});

const edgeRenderLabel = computed(() => t(`graph.edgeRender.${edgeRenderMode.value}`));

function cycleEdgeRenderMode(): void {
  const index = EDGE_RENDER_ORDER.indexOf(edgeRenderMode.value);
  edgeRenderMode.value = EDGE_RENDER_ORDER[(index + 1) % EDGE_RENDER_ORDER.length] ?? "all";
}

/** 当前根视图下的折叠子图组（供自动布局坐标写回与拖动平移）。 */
const collapsedGroups = computed(() =>
  props.focusGroupId
        ? []
    : (props.document.groups ?? []).filter((group) => group.kind === "subgraph" && group.collapsed === true),
);

/** 重挂载键：优先用外部 resetKey（加载/版本切换时变化），否则回退图标识；钻入切换也重挂载并 fitView。 */
const flowKey = computed(() => `${props.resetKey ?? props.document.graphId}::${props.focusGroupId ?? "root"}`);

const autoLayoutDone = ref(false);

// 自动布局仅在“打开 / 切换某张图”（resetKey 变化）时重新允许一次。
// 钻入 / 退出组、折叠切换等仅改变 focusGroupId 的操作不再触发自动布局（仍会重挂载并 fitView）。
watch(
  () => props.resetKey,
  () => {
    autoLayoutDone.value = false;
  },
);

function miniMapNodeColor(node: FlowGraphNode): string {
  const data = node.data as GraphFlowNodeData | undefined;
  if (!data || data.kind !== "node") {
    return "transparent";
  }
  return phaseStyle(data.phase).accent;
}

/**
 * 自动布局。`persist=true`（用户显式点击 / 拖动语义）才把坐标写回文档（标记 dirty、随版本保存）；
 * `persist=false`（加载后无坐标时的一次性自动整理）只更新视图，不弄脏文档。
 */
async function applyAutoLayout(persist: boolean): Promise<void> {
  if (isLayouting.value) {
    return;
  }
  const sizeByNodeId: Record<string, { width: number; height: number }> = {};
  for (const node of getNodes.value) {
    if (node.type === TAVERN_NODE_TYPE && node.dimensions?.width) {
      sizeByNodeId[node.id] = { width: node.dimensions.width, height: node.dimensions.height };
    }
  }

  const result = await runAutoLayout(props.document, { sizeByNodeId });
  if (!result) {
    return;
  }

  for (const [id, position] of Object.entries(result.positions)) {
    const node = findNode(id);
    if (node) {
      node.position = { x: position.x, y: position.y };
    }
  }
  for (const [id, rect] of Object.entries(result.groups)) {
    const node = findNode(id);
    if (node) {
      node.position = { x: rect.x, y: rect.y };
      const base = typeof node.style === "object" && node.style ? node.style : {};
      node.style = { ...base, width: `${rect.width}px`, height: `${rect.height}px` };
    }
  }

  // 折叠节点组：ELK 返回的是折叠叶子（`groupx:<id>`）位置；其成员不参与布局。
  // 先把折叠叶子位置落到画布节点上（预览），再展开为成员坐标写回文档。
  // 有坐标的成员保持内部相对布局并整体平移到 leafPos；缺省坐标的成员按列堆叠落位，
  // 避免「全部落在同一点」导致钻入时成员重叠（只看得到最上面一个）。
  const COLLAPSED_MEMBER_STACK_GAP = 160;
  const persistPositions: Record<string, { x: number; y: number }> = { ...result.positions };
  for (const group of collapsedGroups.value) {
    const leafId = `${COLLAPSED_NODE_ID_PREFIX}${group.id}`;
    const leafPos = result.positions[leafId];
    if (!leafPos) {
      continue;
    }
    const leafNode = findNode(leafId);
    if (leafNode) {
      leafNode.position = { x: leafPos.x, y: leafPos.y };
    }
    // 仅依据「有坐标」的成员推导内部最小角，避免把缺省坐标当成 (0,0) 拉偏整组。
    const memberPositions = group.nodeIds
      .map((nodeId) => props.document.nodes.find((node) => node.id === nodeId)?.ui?.position)
      .filter((position): position is { x: number; y: number } => Boolean(position));
    const minX = memberPositions.length > 0 ? Math.min(...memberPositions.map((p) => p.x)) : 0;
    const minY = memberPositions.length > 0 ? Math.min(...memberPositions.map((p) => p.y)) : 0;
    let stackOffset = 0;
    for (const nodeId of group.nodeIds) {
      const base = props.document.nodes.find((node) => node.id === nodeId)?.ui?.position;
      if (base) {
        persistPositions[nodeId] = { x: leafPos.x + (base.x - minX), y: leafPos.y + (base.y - minY) };
      } else {
        persistPositions[nodeId] = { x: leafPos.x, y: leafPos.y + stackOffset };
        stackOffset += COLLAPSED_MEMBER_STACK_GAP;
      }
    }
    delete persistPositions[leafId];
  }

  if (persist) {
    emit("update:positions", persistPositions);
  }
  emit("update:laidOut", true);
  await nextTick();
  await fitView({ padding: 0.18 });
}

/** 节点测量完成后：若文档无任何坐标，则一次性自动布局（不覆盖用户已有布局，不弄脏文档）。 */
function onNodesInitialized(): void {
  if (autoLayoutDone.value) {
    return;
  }
  autoLayoutDone.value = true;
  const allMissing = props.document.nodes.every((node) => !node.ui?.position);
  if (allMissing) {
    void applyAutoLayout(false);
  }
}

function onNodeDragStop(event: NodeDragEvent): void {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of event.nodes) {
    if (node.type === TAVERN_NODE_TYPE) {
      positions[node.id] = { x: node.position.x, y: node.position.y };
    } else if (node.type === GROUP_COLLAPSED_NODE_TYPE && node.id.startsWith(COLLAPSED_NODE_ID_PREFIX)) {
      // 折叠节点组拖动：坐标由成员派生，上招由 store 整体平移成员。
      emit("moveGroup", {
        groupId: node.id.slice(COLLAPSED_NODE_ID_PREFIX.length),
        position: { x: node.position.x, y: node.position.y },
      });
    }
  }
  if (Object.keys(positions).length > 0) {
    emit("update:positions", positions);
  }
}

function onNodeClick(event: NodeMouseEvent): void {
  if (event.node.type === TAVERN_NODE_TYPE) {
    emit("selectNode", event.node.id);
    return;
  }
  if (event.node.type === GROUP_COLLAPSED_NODE_TYPE && event.node.id.startsWith(COLLAPSED_NODE_ID_PREFIX)) {
    emit("selectGroup", event.node.id.slice(COLLAPSED_NODE_ID_PREFIX.length));
  }
}

/** 双击分组容器 / 折叠节点 → 钻入该组（drill-in）。容器 id 形如 `group:<id>`、折叠节点 `groupx:<id>`。 */
function onNodeDoubleClick(event: NodeMouseEvent): void {
  if (event.node.type === GROUP_NODE_TYPE && event.node.id.startsWith("group:")) {
    emit("enterGroup", event.node.id.slice("group:".length));
    return;
  }
  if (event.node.type === GROUP_COLLAPSED_NODE_TYPE && event.node.id.startsWith(COLLAPSED_NODE_ID_PREFIX)) {
    emit("enterGroup", event.node.id.slice(COLLAPSED_NODE_ID_PREFIX.length));
  }
}

function onEdgeClick(event: EdgeMouseEvent): void {
  emit("selectEdge", event.edge.id);
}

function onPaneClick(): void {
  emit("selectNode", null);
  emit("selectEdge", null);
  emit("selectGroup", null);
}

function onConnect(connection: Connection): void {
  if (connection.source && connection.target && connection.sourceHandle && connection.targetHandle) {
    emit("connect", {
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    });
  }
}

// —— NG2-6：连线交互增强（类型兼容高亮 / lazy connect） ——

/** 当前连线拖拽的源端点（用于 lazy connect 松手时补连）。 */
let connectStart: { nodeId: string; handleId: string; type: NodeGraphPortType } | null = null;
/** 松手时是否按住 Alt（lazy connect）。*/
let lazyModifier = false;

/** 取某节点某输出端口的类型（未知时回退 json）。 */
function outputPortType(nodeId: string, portName: string): NodeGraphPortType {
  const node = props.document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return "json";
  }
  const ports = resolveNodeGraphNodePorts(node, registry.find(node.type, node.typeVersion));
  return (ports.outputPorts.find((port) => port.name === portName)?.type ?? "json") as NodeGraphPortType;
}

/** 连线开始：记录源端口类型并点亮兼容目标端口。 */
function onConnectStart(payload: { nodeId?: string | null; handleId?: string | null; handleType?: string | null }): void {
  if (!props.editable || !payload.nodeId || !payload.handleId || payload.handleType !== "source") {
    return;
  }
  connectStart = {
    nodeId: payload.nodeId,
    handleId: payload.handleId,
    type: outputPortType(payload.nodeId, payload.handleId),
  };
  connectingSourceType.value = connectStart.type;
}

/** 连线结束：清除高亮态；若为 lazy connect 且未精确命中 socket，则补连最近兼容端口。 */
function onConnectEnd(event?: MouseEvent | TouchEvent): void {
  const start = connectStart;
  connectStart = null;
  connectingSourceType.value = null;
  if (!start || !props.editable || !lazyModifier || !(event instanceof MouseEvent)) {
    lazyModifier = false;
    return;
  }
  lazyModifier = false;
  const dropPoint = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  const candidates = collectInputPortCandidates();
  const target = pickLazyConnectTarget(start.type, dropPoint, candidates, LAZY_CONNECT_MAX_DISTANCE);
  if (target && target.nodeId !== start.nodeId) {
    emit("lazyConnect", {
      source: start.nodeId,
      sourceHandle: start.handleId,
      target: target.nodeId,
      targetHandle: target.port,
    });
  }
}

/** lazy connect 最大吸附距离（画布坐标）。 */
const LAZY_CONNECT_MAX_DISTANCE = 260;

/** 收集所有可见 tavern 节点的输入端口候选（画布坐标 + 类型 + 占用态）。 */
function collectInputPortCandidates(): CandidateInputPort[] {
  const occupiedKeys = new Set(
    props.document.edges
      .filter((edge) => nodeGraphEdgeKind(edge) === "data")
      .map((edge) => `${edge.to.nodeId}:${edge.to.port}`),
  );
  const candidates: CandidateInputPort[] = [];
  for (const flowNode of getNodes.value) {
    if (flowNode.type !== TAVERN_NODE_TYPE) {
      continue;
    }
    const data = flowNode.data as GraphFlowNodeData | undefined;
    if (!data || data.kind !== "node") {
      continue;
    }
    data.inputPorts.forEach((port, index) => {
      const top = NODE_HEADER_HEIGHT + index * NODE_PORT_ROW_HEIGHT + NODE_PORT_ROW_HEIGHT / 2;
      candidates.push({
        nodeId: flowNode.id,
        port: port.name,
        type: port.type as NodeGraphPortType,
        position: { x: flowNode.position.x, y: flowNode.position.y + top },
        occupied: occupiedKeys.has(`${flowNode.id}:${port.name}`) && !port.multiple,
      });
    });
  }
  return candidates;
}

// —— NG2-6：cut connection（Ctrl+Drag 划线断连） ——

const cutting = ref(false);
const cutStart = ref<Point | null>(null);
const cutEnd = ref<Point | null>(null);

/** 划线覆盖层坐标（屏幕坐标，画布容器相对）。 */
const cutOverlayLine = computed(() => {
  if (!cutStart.value || !cutEnd.value) {
    return null;
  }
  return { x1: cutStart.value.x, y1: cutStart.value.y, x2: cutEnd.value.x, y2: cutEnd.value.y };
});

function onCanvasPointerDown(event: PointerEvent): void {
  // Ctrl（或 meta）+ 主键在画布空白处按下 → 进入划线断连。
  if (!props.editable || event.button !== 0 || !(event.ctrlKey || event.metaKey)) {
    return;
  }
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }
  cutting.value = true;
  cutStart.value = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  cutEnd.value = { ...cutStart.value };
  window.addEventListener("pointermove", onCutPointerMove);
  window.addEventListener("pointerup", onCutPointerUp);
 event.preventDefault();
}

function onCutPointerMove(event: PointerEvent): void {
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect || !cutting.value) {
    return;
}
  cutEnd.value = { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function onCutPointerUp(event: PointerEvent): void {
  window.removeEventListener("pointermove", onCutPointerMove);
  window.removeEventListener("pointerup", onCutPointerUp);
  const start = cutStart.value;
  cutting.value = false;
  cutStart.value = null;
  cutEnd.value = null;
  if (!start) {
    return;
  }
  // 屏幕坐标转画布坐标后与连线线段求交（两端都转）。
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }
  const startFlow = screenToFlowCoordinate({ x: rect.left + start.x, y: rect.top + start.y });
  const endFlow = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  const cutLine = { a: startFlow, b: endFlow };
  const edges = collectCuttableEdges();
  const hitIds = collectCutEdges(cutLine, edges);
  if (hitIds.length > 0) {
    emit("cutEdges", hitIds);
  }
}

/** 收集当前可见连线的画布坐标线段（端口中心近似）。 */
function collectCuttableEdges(): CuttableEdge[] {
  const result: CuttableEdge[] = [];
  for (const edge of displayEdges.value) {
    const sourceNode = findNode(edge.source);
    const targetNode = findNode(edge.target);
    if (!sourceNode || !targetNode) {
      continue;
    }
    result.push({
      id: edge.id,
      segment: {
        a: { x: sourceNode.position.x + NODE_WIDTH, y: sourceNode.position.y + NODE_HEADER_HEIGHT },
        b: { x: targetNode.position.x, y: targetNode.position.y + NODE_HEADER_HEIGHT },
      },
    });
  }
  return result;
}

// —— NG2-6：键盘快捷键（Blender 风格） ——

function onKeyDown(event: KeyboardEvent): void {
  if (!props.editable || isEditableTarget(event.target)) {
    return;
  }
  const meta = event.ctrlKey || event.metaKey;
  const key = event.key;
  // 撤销 / 重做
  if (meta && (key === "z" || key === "Z")) {
    event.preventDefault();
    if (event.shiftKey) {
      emit("redo");
    } else {
      emit("undo");
    }
    return;
  }
  if (meta && (key === "y" || key === "Y")) {
    event.preventDefault();
    emit("redo");
    return;
  }
  // 复制
  if (meta && (key === "d" || key === "D")) {
    event.preventDefault();
    const nodeIds = selectedTavernNodeIds();
    if (nodeIds.length > 0) {
      emit("duplicateSelection", nodeIds);
    }
    return;
  }
  // 成组
  if (meta && (key ==="g" || key === "G")) {
    event.preventDefault();
    const nodeIds = selectedTavernNodeIds();
    if (nodeIds.length >= 2) {
      emit("groupSelection", nodeIds);
    }
    return;
  }
  // 节点搜索（Shift+A）
  if (event.shiftKey && (key === "a" || key === "A")) {
 event.preventDefault();
    emit("requestAddNode", lastPointerFlowPosition.value);
    return;
  }
  //删除
  if (key === "Delete" || key === "Backspace" || key === "x" || key === "X") {
    const nodeIds = selectedTavernNodeIds();
    const edgeIds = getSelectedEdges.value.map((edge) => edge.id);
    if (nodeIds.length > 0 || edgeIds.length > 0) {
      event.preventDefault();
      emit("deleteSelection", { nodeIds, edgeIds });
    }
  }
}

/** 当前选中的 tavern 节点 id（排除分组容器 / 折叠节点）。 */
function selectedTavernNodeIds(): string[] {
  return getSelectedNodes.value.filter((node) => node.type === TAVERN_NODE_TYPE).map((node) => node.id);
}

/** 最近一次鼠标在画布上的画布坐标（供 Shift+A 落点）。 */
const lastPointerFlowPosition = ref<{ x: number; y: number } | null>(null);

function onCanvasPointerMove(event: PointerEvent): void {
  lastPointerFlowPosition.value = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
}

function onWindowKeyDownForModifier(event: KeyboardEvent): void {
  if (event.altKey) {
    lazyModifier = true;
  }
}

function onWindowKeyUpForModifier(event: KeyboardEvent): void {
  if (!event.altKey) {
    lazyModifier = false;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keydown", onWindowKeyDownForModifier);
  window.addEventListener("keyup", onWindowKeyUpForModifier);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keydown", onWindowKeyDownForModifier);
  window.removeEventListener("keyup", onWindowKeyUpForModifier);
  window.removeEventListener("pointermove", onCutPointerMove);
  window.removeEventListener("pointerup", onCutPointerUp);
});

/** 诊断面板点击 → 选中并居中对应元素。 */
watch(
  () => props.highlight,
  async (target) => {
    if (!target) {
      return;
    }
    removeSelectedElements();
    await nextTick();
    if (target.nodeId) {
      const node = findNode(target.nodeId);
      if (node) {
        addSelectedNodes([node]);
        await fitView({ nodes: [target.nodeId], padding: 0.4, maxZoom: 1.3, duration: 250 });
      }
      return;
    }
    if (target.edgeId) {
      const edge = findEdge(target.edgeId);
      if (edge) {
        addSelectedEdges([edge]);
        await fitView({ nodes: [edge.source, edge.target], padding: 0.4, maxZoom: 1.3, duration: 250 });
      }
      return;
    }
    if (target.groupId) {
      await fitView({ nodes: [`group:${target.groupId}`], padding: 0.4, duration: 250 });
    }
  },
);
</script>

<template>
  <div ref="canvasRef" class="graph-canvas" @pointerdown="onCanvasPointerDown" @pointermove="onCanvasPointerMove">
    <VueFlow
      :id="flowId"
      :key="flowKey"
      :nodes="nodes"
      :edges="displayEdges"
      :min-zoom="0.2"
      :max-zoom="2"
      :nodes-connectable="editable"
      :nodes-draggable="true"
      :elements-selectable="true"
      :edges-updatable="false"
      :delete-key-code="null"
      fit-view-on-init
      @nodes-initialized="onNodesInitialized"
      @node-drag-stop="onNodeDragStop"
      @node-click="onNodeClick"
      @node-double-click="onNodeDoubleClick"
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
      @connect="onConnect"
      @connect-start="onConnectStart"
      @connect-end="onConnectEnd"
    >
      <template #node-tavern="nodeProps">
        <GraphNode
          v-bind="nodeProps"
          @update-node-config="(payload) => emit('updateNodeConfig', payload)"
          @open-node-inspector="(nodeId) => emit('openNodeInspector', nodeId)"
        />
      </template>
      <template #node-group="nodeProps">
        <GraphGroupNode v-bind="nodeProps" />
      </template>
      <template #node-groupCollapsed="nodeProps">
        <GraphCollapsedGroupNode v-bind="nodeProps" />
      </template>

      <Panel position="top-right">
        <UiIconButton
          :label="t('graph.autoLayout')"
          :disabled="isLayouting"
          @click="() => applyAutoLayout(true)"
        >
          <Wand2 :size="16" :stroke-width="1.5" />
        </UiIconButton>
      </Panel>

      <Panel position="bottom-left" class="edge-render-panel">
        <UiIconButton :label="edgeRenderLabel" :active="edgeRenderMode !== 'all'" @click="cycleEdgeRenderMode">
          <component :is="edgeRenderIcon" :size="16" :stroke-width="1.5" />
        </UiIconButton>
      </Panel>

      <!-- NG2-6：cut connection 划线覆盖层 -->
      <svg v-if="cutOverlayLine" class="cut-overlay" aria-hidden="true">
        <line
          :x1="cutOverlayLine.x1"
          :y1="cutOverlayLine.y1"
          :x2="cutOverlayLine.x2"
          :y2="cutOverlayLine.y2"
        />
      </svg>

      <Background :gap="18" :size="1" color="rgb(113 113 122 / 0.18)" />
      <Controls :show-interactive="false" position="bottom-left" />
      <MiniMap
        :node-color="miniMapNodeColor"
        mask-color="rgb(113 113 122 / 0.22)"
        position="bottom-right"
        pannable
        zoomable
      />
    </VueFlow>
  </div>
</template>

<style scoped>
.graph-canvas {
  width: 100%;
  height: 100%;
}

/* NG2-6：cut connection 划线覆盖层（位于画布之上，不拦截交互）。 */
.graph-canvas .cut-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

.graph-canvas .cut-overlay line {
  stroke: var(--color-signal-error);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}

.graph-canvas :deep(.vue-flow) {
  height: 100%;
}
/* 连线渲染切换：置于左下角 Controls 之上，避免与缩放控件重叠。 */
.graph-canvas :deep(.edge-render-panel) {
  margin-bottom: 92px;
}


/* Controls：令牌化、无阴影，靠 1px 边框 + 背景层差。 */
.graph-canvas :deep(.vue-flow__controls) {
  box-shadow: none;
  border-radius: 6px;
  overflow: hidden;
}

.graph-canvas :deep(.vue-flow__controls-button) {
  width: 24px;
  height: 24px;
  padding: 5px;
  background: var(--color-panel);
  border: 1px solid var(--color-line-subtle);
  border-bottom-width: 0;
}

.graph-canvas :deep(.vue-flow__controls-button:last-child) {
  border-bottom-width: 1px;
}

.graph-canvas :deep(.vue-flow__controls-button:hover) {
  background: var(--color-float);
}

.graph-canvas :deep(.vue-flow__controls-button svg) {
  fill: var(--color-text-secondary);
}

/* MiniMap：面板底色 + 细边框。 */
.graph-canvas :deep(.vue-flow__minimap) {
  background: var(--color-panel);
  border: 1px solid var(--color-line-subtle);
  border-radius: 6px;
}

/* 节点 focus 可达性：去掉默认描边，由节点组件自身的 selected 微环表达。 */
.graph-canvas :deep(.vue-flow__node:focus),
.graph-canvas :deep(.vue-flow__node:focus-visible) {
  outline: none;
}
</style>
