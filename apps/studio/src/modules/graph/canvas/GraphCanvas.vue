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
import { Wand2 } from "lucide-vue-next";
import { computed, nextTick, provide, ref, toRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import "@vue-flow/core/dist/style.css";

import UiIconButton from "../../../ui/UiIconButton.vue";
import { useAutoLayout } from "../layout/use-auto-layout";
import type { DiagnosticTarget } from "../validate/local-validation";
import GraphGroupNode from "./nodes/GraphGroupNode.vue";
import GraphNode from "./nodes/GraphNode.vue";
import { GRAPH_EDITABLE_KEY } from "./editable-context";
import { TAVERN_NODE_TYPE, mapDocumentToFlow, type GraphFlowNodeData } from "./map-document";
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
  }>(),
  { editable: false, highlight: null, runStatusByNodeId: () => ({}), resetKey: undefined },
);

const emit = defineEmits<{
  (event: "update:laidOut", value: boolean): void;
  (event: "update:positions", positions: Record<string, { x: number; y: number }>): void;
  (event: "selectNode", nodeId: string | null): void;
  (event: "selectEdge", edgeId: string | null): void;
  (event: "connect", payload: { source: string; target: string; sourceHandle: string; targetHandle: string }): void;
}>();

const { t } = useI18n();

const flowId = "graph-canvas";
const { getNodes, findNode, findEdge, fitView, addSelectedNodes, addSelectedEdges, removeSelectedElements } =
  useVueFlow(flowId);
const { isLayouting, runAutoLayout } = useAutoLayout();

// 供自定义节点决定端口是否可连线（编辑态才允许）。
provide(GRAPH_EDITABLE_KEY, toRef(props, "editable"));

const mapped = computed(() =>
  mapDocumentToFlow(props.document, { runStatusByNodeId: props.runStatusByNodeId }),
);
const nodes = computed(() => mapped.value.nodes);
const edges = computed(() => mapped.value.edges);

/** 重挂载键：优先用外部 resetKey（加载/版本切换时变化），否则回退图标识。 */
const flowKey = computed(() => props.resetKey ?? props.document.graphId);

const autoLayoutDone = ref(false);

watch(flowKey, () => {
  autoLayoutDone.value = false;
});

function miniMapNodeColor(node: FlowGraphNode): string {
  const data = node.data as GraphFlowNodeData | undefined;
  if (!data || data.kind === "group") {
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

  if (persist) {
    emit("update:positions", result.positions);
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
    }
  }
  if (Object.keys(positions).length > 0) {
    emit("update:positions", positions);
  }
}

function onNodeClick(event: NodeMouseEvent): void {
  if (event.node.type === TAVERN_NODE_TYPE) {
    emit("selectNode", event.node.id);
  }
}

function onEdgeClick(event: EdgeMouseEvent): void {
  emit("selectEdge", event.edge.id);
}

function onPaneClick(): void {
  emit("selectNode", null);
  emit("selectEdge", null);
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
      :edges="edges"
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
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
      @connect="onConnect"
    >
      <template #node-tavern="nodeProps">
        <GraphNode v-bind="nodeProps" />
      </template>
      <template #node-group="nodeProps">
        <GraphGroupNode v-bind="nodeProps" />
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
