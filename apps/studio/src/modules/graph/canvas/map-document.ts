/**
 * `NodeGraphDocument` ↔ Vue Flow 映射（B10 阶段 4，纯函数、可单测）。
 *
 * 设计 §3.1：用 registry 元数据驱动节点外观（phase / side-effect / ports），
 * 区分 data/control 边，并支持运行状态叠加。坐标 `ui.position` 可缺省——本映射对缺省
 * 节点用**确定性的占位列布局**（按 phase 分列、列内按文档序堆叠）兜底，真正的 elkjs
 * 自动布局在阶段 5 接入；`hasPosition` 标记原文档是否自带坐标，供上层提示与阶段 5 复用。
 */
import {
  createDefaultNodeTypeRegistry,
  nodeGraphEdgeKind,
  type NodeGraphDocument,
  type NodeGraphEdgeKind,
  type NodeGraphGroup,
  type NodeGraphNode,
  type NodeGraphNodeRunStatus,
  type NodeGraphPhase,
  type NodeGraphPortDefinition,
  type NodeGraphPreviewPolicy,
  type NodeTypeRegistry,
  type NodeTypeRegistryEntry,
} from "@tavern/core/node-graph";
import type { Edge, EdgeMarker, MarkerType, Node, Styles } from "@vue-flow/core";

import { EDGE_STYLES, phaseStyle, type NodeSideEffect } from "./port-styles";

/** 节点固定宽度（px）。组件与包围盒计算共用，保证一致。 */
export const NODE_WIDTH = 220;
/** 节点头部高度（标题 + 类型行）。 */
export const NODE_HEADER_HEIGHT = 48;
/** 单个端口行高。 */
export const NODE_PORT_ROW_HEIGHT = 22;
/** 节点底部高度（phase / previewPolicy 行）。 */
export const NODE_FOOTER_HEIGHT = 22;

/** 占位列布局：列间距、列内行间距、起点。 */
const FALLBACK_COLUMN_GAP = 320;
const FALLBACK_ROW_GAP = 28;
const FALLBACK_ORIGIN = { x: 0, y: 0 };

/** 分组容器内边距与顶部标签预留高度。 */
const GROUP_PADDING = 24;
const GROUP_LABEL_SPACE = 8;

/** 自定义节点 / 分组容器在 Vue Flow 中的 type 标识。 */
export const TAVERN_NODE_TYPE = "tavern" as const;
export const GROUP_NODE_TYPE = "group" as const;

export interface GraphTavernNodeData {
  kind: "node";
  node: NodeGraphNode;
  /** registry 元数据；未知节点类型时为 undefined。 */
  entry?: NodeTypeRegistryEntry;
  title: string;
  phase: NodeGraphPhase;
  sideEffects: NodeSideEffect;
  inputPorts: NodeGraphPortDefinition[];
  outputPorts: NodeGraphPortDefinition[];
  previewPolicy: NodeGraphPreviewPolicy;
  /** 运行状态叠加（来自 run trace，可缺省）。 */
  runStatus?: NodeGraphNodeRunStatus;
  /** 原文档是否自带坐标（false = 本次为占位布局）。 */
  hasPosition: boolean;
  /** registry 未登记该类型。 */
  unknownType: boolean;
  enabled: boolean;
}

export interface GraphGroupNodeData {
  kind: "group";
  group: NodeGraphGroup;
  memberCount: number;
}

export type GraphFlowNodeData = GraphTavernNodeData | GraphGroupNodeData;

export type GraphFlowNode = Node<GraphFlowNodeData>;
export type GraphFlowEdge = Edge<{ kind: NodeGraphEdgeKind }>;

export interface MapDocumentOptions {
  registry?: NodeTypeRegistry;
  /** 节点运行状态（按 nodeId），用于运行态叠加。 */
  runStatusByNodeId?: Record<string, NodeGraphNodeRunStatus>;
}

export interface MappedGraph {
  nodes: GraphFlowNode[];
  edges: GraphFlowEdge[];
}

export function estimateNodeHeight(entry: NodeTypeRegistryEntry | undefined): number {
  const inCount = entry?.inputPorts.length ?? 0;
  const outCount = entry?.outputPorts.length ?? 0;
  const rows = Math.max(inCount, outCount, 0);
  return NODE_HEADER_HEIGHT + rows * NODE_PORT_ROW_HEIGHT + NODE_FOOTER_HEIGHT;
}

/**
 * 为缺省坐标的节点计算占位列布局：按 phase 顺序分列（仅排入实际出现的 phase，避免空列拉开
 * 大距离），列内按文档顺序自上而下堆叠（用各节点估算高度避免重叠）。
 */
function computeFallbackPositions(
  nodes: NodeGraphNode[],
  entries: Map<string, NodeTypeRegistryEntry | undefined>,
): Map<string, { x: number; y: number }> {
  const missing = nodes.filter((node) => !node.ui?.position);
  const orders = [...new Set(missing.map((node) => phaseStyle(node.phase).order))].sort(
    (left, right) => left - right,
  );
  const columnByOrder = new Map<number, number>(orders.map((order, index) => [order, index]));
  const cumulativeYByOrder = new Map<number, number>();

  const result = new Map<string, { x: number; y: number }>();
  for (const node of missing) {
    const order = phaseStyle(node.phase).order;
    const column = columnByOrder.get(order) ?? 0;
    const cumulativeY = cumulativeYByOrder.get(order) ?? 0;
    result.set(node.id, {
      x: FALLBACK_ORIGIN.x + column * FALLBACK_COLUMN_GAP,
      y: FALLBACK_ORIGIN.y + cumulativeY,
    });
    cumulativeYByOrder.set(order, cumulativeY + estimateNodeHeight(entries.get(node.id)) + FALLBACK_ROW_GAP);
  }
  return result;
}

function toEdgeStyle(kind: NodeGraphEdgeKind): { style: Styles; markerColor: string } {
  const edgeStyle = EDGE_STYLES[kind];
  const style: Styles = {
    stroke: edgeStyle.stroke,
    strokeWidth: edgeStyle.width,
  };
  if (edgeStyle.dash) {
    style.strokeDasharray = edgeStyle.dash;
  }
  return { style, markerColor: edgeStyle.stroke };
}

/** 将 `NodeGraphDocument` 映射为 Vue Flow 的 nodes / edges。 */
export function mapDocumentToFlow(
  document: NodeGraphDocument,
  options: MapDocumentOptions = {},
): MappedGraph {
  const registry = options.registry ?? createDefaultNodeTypeRegistry();
  const runStatusByNodeId = options.runStatusByNodeId ?? {};

  const entries = new Map<string, NodeTypeRegistryEntry | undefined>();
  for (const node of document.nodes) {
    entries.set(node.id, registry.find(node.type, node.typeVersion));
  }

  const fallbackPositions = computeFallbackPositions(document.nodes, entries);
  const resolvedPositions = new Map<string, { x: number; y: number }>();

  const tavernNodes: GraphFlowNode[] = document.nodes.map((node) => {
    const entry = entries.get(node.id);
    const explicit = node.ui?.position;
    const position = explicit ?? fallbackPositions.get(node.id) ?? { x: 0, y: 0 };
    resolvedPositions.set(node.id, position);

    const data: GraphTavernNodeData = {
      kind: "node",
      node,
      entry,
      title: entry?.title ?? node.name ?? node.type,
      phase: node.phase,
      sideEffects: (entry?.sideEffects ?? "none") as NodeSideEffect,
      inputPorts: entry?.inputPorts ?? [],
      outputPorts: entry?.outputPorts ?? [],
      previewPolicy: node.previewPolicy ?? entry?.previewPolicy ?? "auto",
      runStatus: runStatusByNodeId[node.id],
      hasPosition: Boolean(explicit),
      unknownType: !entry,
      enabled: node.enabled !== false,
    };

    return {
      id: node.id,
      type: TAVERN_NODE_TYPE,
      position: { ...position },
      data,
      zIndex: 1,
      style: { width: `${NODE_WIDTH}px` },
    };
  });

  const groupNodes: GraphFlowNode[] = [];
  for (const group of document.groups ?? []) {
    const memberRects = group.nodeIds
      .map((nodeId) => {
        const position = resolvedPositions.get(nodeId);
        if (!position) {
          return null;
        }
        return {
          x: position.x,
          y: position.y,
          width: NODE_WIDTH,
          height: estimateNodeHeight(entries.get(nodeId)),
        };
      })
      .filter((rect): rect is { x: number; y: number; width: number; height: number } => rect !== null);

    if (memberRects.length === 0) {
      continue;
    }

    const minX = Math.min(...memberRects.map((rect) => rect.x));
    const minY = Math.min(...memberRects.map((rect) => rect.y));
    const maxX = Math.max(...memberRects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...memberRects.map((rect) => rect.y + rect.height));

    groupNodes.push({
      id: `group:${group.id}`,
      type: GROUP_NODE_TYPE,
      position: { x: minX - GROUP_PADDING, y: minY - GROUP_PADDING - GROUP_LABEL_SPACE },
      data: { kind: "group", group, memberCount: memberRects.length },
      zIndex: 0,
      selectable: false,
      draggable: false,
      focusable: false,
      connectable: false,
      style: {
        width: `${maxX - minX + GROUP_PADDING * 2}px`,
        height: `${maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_SPACE}px`,
      },
    });
  }

  const edges: GraphFlowEdge[] = document.edges.map((edge) => {
    const kind = nodeGraphEdgeKind(edge);
    const { style, markerColor } = toEdgeStyle(kind);
    // 字面量 'arrowclosed' 即 MarkerType.ArrowClosed，避免从 @vue-flow/core 引入运行时值，
    // 使本纯映射可在无 DOM 的 node 环境单测。
    const markerEnd: EdgeMarker = {
      type: "arrowclosed" as MarkerType,
      color: markerColor,
      width: 12,
      height: 12,
    };
    return {
      id: edge.id,
      source: edge.from.nodeId,
      target: edge.to.nodeId,
      sourceHandle: edge.from.port,
      targetHandle: edge.to.port,
      data: { kind },
      class: `graph-edge graph-edge--${kind}`,
      style,
      markerEnd,
    };
  });

  // 分组容器在前（zIndex 0，绘制于成员之后亦因 pointer-events:none 不拦截交互）。
  return { nodes: [...groupNodes, ...tavernNodes], edges };
}
