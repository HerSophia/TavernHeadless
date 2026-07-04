<script setup lang="ts">
import type { NodeGraphDocument, NodeGraphNodeRunStatus } from "@tavern/core/node-graph";
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
import { computed, nextTick, provide, ref, toRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import "@vue-flow/core/dist/style.css";

import UiIconButton from "../../../ui/UiIconButton.vue";
import { useAutoLayout } from "../layout/use-auto-layout";
import type { DiagnosticTarget } from "../validate/local-validation";
import GraphCollapsedGroupNode from "./nodes/GraphCollapsedGroupNode.vue";
import GraphGroupNode from "./nodes/GraphGroupNode.vue";
import GraphNode from "./nodes/GraphNode.vue";
import {
  GRAPH_EDITABLE_KEY,
  GRAPH_GROUP_COLLAPSE_KEY,
  GRAPH_GROUP_ENTER_KEY,
  GRAPH_GROUP_TOGGLE_KEY,
} from "./editable-context";
import {
  COLLAPSED_NODE_ID_PREFIX,
  GROUP_COLLAPSED_NODE_TYPE,
  GROUP_NODE_TYPE,
  TAVERN_NODE_TYPE,
  mapDocumentToFlow,
  type GraphFlowNodeData,
} from "./map-document";
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
  }>(),
  { editable: false, highlight: null, runStatusByNodeId: () => ({}), resetKey: undefined, focusGroupId: null, llmProfiles: () => [] },
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
}>();

const { t } = useI18n();

const flowId = "graph-canvas";
const { getNodes, findNode, findEdge, fitView, addSelectedNodes, addSelectedEdges, removeSelectedElements } =
  useVueFlow(flowId);
const { isLayouting, runAutoLayout } = useAutoLayout();

// 供自定义节点决定端口是否可连线（编辑态才允许）。
provide(GRAPH_EDITABLE_KEY, toRef(props, "editable"));
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

const mapped = computed(() =>
  mapDocumentToFlow(props.document, {
    runStatusByNodeId: props.runStatusByNodeId,
    focusGroupId: props.focusGroupId,
    llmProfiles: props.llmProfiles,
  }),
);
const nodes = computed(() => mapped.value.nodes);
const edges = computed(() => mapped.value.edges);

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
  <div class="graph-canvas">
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
