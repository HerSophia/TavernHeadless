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
  groupSwitchState,
  nodeGraphEdgeKind,
  resolveNodeGraphNodePorts,
  type NodeGraphDocument,
  type NodeGraphEdgeKind,
  type NodeGraphGroup,
  type NodeGraphGroupSwitchState,
  type NodeGraphNode,
  type NodeGraphNodeRunStatus,
  type NodeGraphPhase,
  type NodeGraphPortDefinition,
  type NodeGraphPortType,
  type NodeGraphPreviewPolicy,
  type NodeTypeRegistry,
  type NodeTypeRegistryEntry,
} from "@tavern/core/node-graph";
import type { Edge, EdgeMarker, MarkerType, Node, Styles } from "@vue-flow/core";

import {
  channelHandleId,
  deriveGroupBoundaryHandles,
  inputHandleId,
  type GroupBoundaryHandles,
} from "../subgraph/group-channels";
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
/** 折叠态子图组：对外表现为单个节点（Blender 式 NodeGroup）。 */
export const GROUP_COLLAPSED_NODE_TYPE = "groupCollapsed" as const;

/** 折叠节点的 Vue Flow node id 前缀（区别于包围盒容器 `group:`）。 */
export const COLLAPSED_NODE_ID_PREFIX = "groupx:" as const;

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
  /** 组开关三态（由成员 `node.enabled` 派生）：驱动组容器上的开关 UI。 */
  switchState: NodeGraphGroupSwitchState;
}

/** 折叠节点的一个接口端口（由跨边界连线派生）。 */
export interface CollapsedGroupHandle {
  /** Vue Flow handle id（与重路由后的边 sourceHandle/targetHandle 对应）。 */
  id: string;
  /** 展示标签（取边界成员节点标题 + 端口）。 */
  label: string;
  /** 端口数据类型（用于句柄形状/配色）。 */
  type: NodeGraphPortDefinition["type"];
  /** 产出该输出通道的成员节点 id（仅输出句柄）。 */
  producerNodeId?: string;
  /** 通道关闭态（显式关闭或末端节点禁用）：灰显标签、虚化连线（仅输出句柄）。 */
  disabled?: boolean;
}

export interface GraphCollapsedGroupNodeData {
  kind: "groupCollapsed";
  group: NodeGraphGroup;
  memberCount: number;
  switchState: NodeGraphGroupSwitchState;
  /** 左侧输入插槽（外部 → 组内成员的跨界连线派生，按首现去重）。 */
  inputs: CollapsedGroupHandle[];
  /** 右侧输出插槽（组内成员 → 外部的跨界连线派生，按首现去重）。 */
  outputs: CollapsedGroupHandle[];
}

export type GraphFlowNodeData =
  | GraphTavernNodeData
  | GraphGroupNodeData
  | GraphCollapsedGroupNodeData;

export type GraphFlowNode = Node<GraphFlowNodeData>;
/**
 * 边附带渲染元信息：`kind`（data/control）+ `muted`（产出侧关闭：禁用节点/关闭通道→虚化）。
 * `dashed = kind === 'control' || muted`，供「仅显示实线」过滤。
 */
export interface GraphFlowEdgeData {
  kind: NodeGraphEdgeKind;
  muted: boolean;
}
export type GraphFlowEdge = Edge<GraphFlowEdgeData>;

export interface MapDocumentOptions {
  registry?: NodeTypeRegistry;
  /** 节点运行状态（按 nodeId），用于运行态叠加。 */
  runStatusByNodeId?: Record<string, NodeGraphNodeRunStatus>;
  /**
   * 钻入（drill-in）：仅渲染该组的成员节点与组内边，隐藏其余节点与所有分组容器。
   * 用于把导入的大图按「系统功能」分组聚焦编辑。组不存在时回退为整图。
   */
  focusGroupId?: string | null;
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

/** 关闭/禁用产出侧的虚化连线视觉（更细、点划、低对比）。 */
const MUTED_EDGE_STROKE = "rgb(113 113 122 / 0.4)";
const MUTED_EDGE_DASH = "2 4";

function toEdgeStyle(kind: NodeGraphEdgeKind, muted: boolean): { style: Styles; markerColor: string } {
  const edgeStyle = EDGE_STYLES[kind];
  if (muted) {
    return {
      style: { stroke: MUTED_EDGE_STROKE, strokeWidth: 1.25, strokeDasharray: MUTED_EDGE_DASH },
      markerColor: MUTED_EDGE_STROKE,
    };
  }
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

  // 钻入：聚焦某组时仅渲染其成员 + 组内边，隐藏其余节点与所有分组容器。
  const focusGroup = options.focusGroupId
    ? (document.groups ?? []).find((group) => group.id === options.focusGroupId)
    : undefined;
  const focusSet = focusGroup ? new Set(focusGroup.nodeIds) : null;
  const isRoot = !focusSet;

  // 参与布局/坐标计算的节点集合：根图 = 全部；钻入 = 该组成员。
  const layoutNodes = focusSet ? document.nodes.filter((node) => focusSet.has(node.id)) : document.nodes;

  // 折叠子图组（仅根视图）：成员从画布隐藏、整组改画为单个折叠节点。
  const collapsedGroups = isRoot
    ? (document.groups ?? []).filter((group) => group.kind === "subgraph" && group.collapsed === true)
    : [];
  const memberToCollapsed = new Map<string, NodeGraphGroup>();
  for (const group of collapsedGroups) {
    for (const nodeId of group.nodeIds) {
      memberToCollapsed.set(nodeId, group);
    }
  }
  const hiddenNodeIds = new Set(memberToCollapsed.keys());

  const entries = new Map<string, NodeTypeRegistryEntry | undefined>();
  const titleById = new Map<string, string>();
  const portsById = new Map<
    string,
    { inputPorts: readonly NodeGraphPortDefinition[]; outputPorts: readonly NodeGraphPortDefinition[] }
  >();
  const nodeById = new Map<string, NodeGraphNode>();
  for (const node of layoutNodes) {
    const entry = registry.find(node.type, node.typeVersion);
    entries.set(node.id, entry);
    titleById.set(node.id, node.name ?? entry?.title ?? node.type);
    portsById.set(node.id, resolveNodeGraphNodePorts(node, entry));
    nodeById.set(node.id, node);
  }

  const fallbackPositions = computeFallbackPositions(layoutNodes, entries);
  const resolvedPositions = new Map<string, { x: number; y: number }>();
  for (const node of layoutNodes) {
    resolvedPositions.set(node.id, node.ui?.position ?? fallbackPositions.get(node.id) ?? { x: 0, y: 0 });
  }

  // 钻入兜底：若组成员的显式坐标存在重叠（例如折叠组成员曾被写入同一坐标），
  // 改用确定性占位布局，避免「多个节点叠在一起、只看得到最上面一个」。
  if (focusSet) {
    const seenPositionKeys = new Set<string>();
    let hasOverlap = false;
    for (const node of layoutNodes) {
      const position = resolvedPositions.get(node.id);
      if (!position) {
        continue;
      }
      const key = `${Math.round(position.x)}:${Math.round(position.y)}`;
      if (seenPositionKeys.has(key)) {
        hasOverlap = true;
        break;
      }
      seenPositionKeys.add(key);
    }
    if (hasOverlap) {
      // 强制对全部可见节点重排（忽略其显式坐标），得到互不重叠的占位布局。
      const relaid = computeFallbackPositions(
        layoutNodes.map((node) => ({ ...node, ui: undefined })),
            entries,
      );
      for (const node of layoutNodes) {
        resolvedPositions.set(node.id, relaid.get(node.id) ?? { x: 0, y: 0 });
      }
    }
  }

  // 折叠组的边界端口/输出通道（含通道关闭态），供折叠节点渲染与连线虚化共用。
  const boundaryByGroup = new Map<string, GroupBoundaryHandles>();
  const outputDisabledById = new Map<string, boolean>();
  for (const group of collapsedGroups) {
    const handles = deriveGroupBoundaryHandles(document, group, registry);
    boundaryByGroup.set(group.id, handles);
    for (const channel of handles.outputs) {
      outputDisabledById.set(channel.id, channel.disabled);
    }
  }

  // 普通可见节点：排除被折叠组隐藏的成员。
  const tavernNodes: GraphFlowNode[] = layoutNodes
    .filter((node) => !hiddenNodeIds.has(node.id))
    .map((node) => {
      const entry = entries.get(node.id);
      const explicit = node.ui?.position;
      const position = resolvedPositions.get(node.id) ?? { x: 0, y: 0 };
      const ports = portsById.get(node.id) ?? { inputPorts: [], outputPorts: [] };

      const data: GraphTavernNodeData = {
        kind: "node",
        node,
        entry,
        // 优先显示节点自身 name（如导入预设的 slot 名），便于「哪个节点 = 哪个 slot」；
        // 无 name 时回退注册表标题，再回退类型 id。
        title: titleById.get(node.id) ?? node.type,
        phase: node.phase,
        sideEffects: (entry?.sideEffects ?? "none") as NodeSideEffect,
        inputPorts: [...ports.inputPorts],
        outputPorts: [...ports.outputPorts],
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

  // —— 边：根视图全部、钻入仅组内；折叠组内部边隐藏，跨界边重路由到折叠节点的派生端口 ——
  const visibleEdges = focusSet
    ? document.edges.filter((edge) => focusSet.has(edge.from.nodeId) && focusSet.has(edge.to.nodeId))
    : document.edges;

  const edges: GraphFlowEdge[] = [];
  for (const edge of visibleEdges) {
    const fromGroup = memberToCollapsed.get(edge.from.nodeId);
    const toGroup = memberToCollapsed.get(edge.to.nodeId);
    // 同一折叠组内部的边：隐藏（已收进折叠节点）。
    if (fromGroup && toGroup && fromGroup.id === toGroup.id) {
      continue;
    }

    // 产出侧关闭 → 连线虚化：折叠组看输出通道关闭态；普通节点看其 enabled。
    let source = edge.from.nodeId;
    let sourceHandle = edge.from.port;
    let muted: boolean;
    if (fromGroup) {
      const handleId = channelHandleId(edge.from.nodeId, edge.from.port);
      source = `${COLLAPSED_NODE_ID_PREFIX}${fromGroup.id}`;
      sourceHandle = handleId;
      muted = outputDisabledById.get(handleId) ?? false;
    } else {
      muted = nodeById.get(edge.from.nodeId)?.enabled === false;
    }

    let target = edge.to.nodeId;
    let targetHandle = edge.to.port;
    if (toGroup) {
      target = `${COLLAPSED_NODE_ID_PREFIX}${toGroup.id}`;
      targetHandle = inputHandleId(edge.to.nodeId, edge.to.port);
    }

    const kind = nodeGraphEdgeKind(edge);
    const { style, markerColor } = toEdgeStyle(kind, muted);
    // 字面量 'arrowclosed' 即 MarkerType.ArrowClosed，避免从 @vue-flow/core 引入运行时值，
    // 使本纯映射可在无 DOM 的 node 环境单测。
    const markerEnd: EdgeMarker = {
      type: "arrowclosed" as MarkerType,
      color: markerColor,
      width: 12,
      height: 12,
    };
    edges.push({
      id: edge.id,
      source,
      target,
      sourceHandle,
      targetHandle,
      data: { kind, muted },
      class: `graph-edge graph-edge--${kind}${muted ? " graph-edge--muted" : ""}`,
      style,
      markerEnd,
    });
  }

  // —— 分组包围盒：根视图、非折叠子图组 / 可视组才画框（折叠组改画折叠节点）——
  const boxGroups = focusSet
    ? []
    : (document.groups ?? []).filter((group) => !(group.kind === "subgraph" && group.collapsed === true));
  const groupNodes: GraphFlowNode[] = [];
  for (const group of boxGroups) {
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

    const members = group.nodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is NodeGraphNode => Boolean(node));

    groupNodes.push({
      id: `group:${group.id}`,
      type: GROUP_NODE_TYPE,
      position: { x: minX - GROUP_PADDING, y: minY - GROUP_PADDING - GROUP_LABEL_SPACE },
      data: { kind: "group", group, memberCount: memberRects.length, switchState: groupSwitchState(members) },
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

  // —— 折叠节点：每个折叠子图组一个单节点，端口由跨界连线派生 ——
  const collapsedNodes: GraphFlowNode[] = [];
  for (const group of collapsedGroups) {
    const positions = group.nodeIds
      .map((nodeId) => resolvedPositions.get(nodeId))
      .filter((position): position is { x: number; y: number } => Boolean(position));
    if (positions.length === 0) {
      continue;
    }
    const minX = Math.min(...positions.map((position) => position.x));
    const minY = Math.min(...positions.map((position) => position.y));
    const members = group.nodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is NodeGraphNode => Boolean(node));

    const boundary = boundaryByGroup.get(group.id);
    const data: GraphCollapsedGroupNodeData = {
      kind: "groupCollapsed",
      group,
      memberCount: members.length,
      switchState: groupSwitchState(members),
      inputs: (boundary?.inputs ?? []).map((handle) => ({
        id: handle.id,
        label: handle.label,
        type: handle.type,
      })),
      outputs: (boundary?.outputs ?? []).map((channel) => ({
        id: channel.id,
        label: channel.label,
        type: channel.type,
        producerNodeId: channel.memberNodeId,
        disabled: channel.disabled,
      })),
    };

    collapsedNodes.push({
      id: `${COLLAPSED_NODE_ID_PREFIX}${group.id}`,
      type: GROUP_COLLAPSED_NODE_TYPE,
      position: { x: minX, y: minY },
      data,
      zIndex: 1,
      // 可拖动：拖动折叠节点时由上层按位移整体平移其成员坐标（保留内部布局）。
      draggable: true,
      connectable: false,
      style: { width: `${NODE_WIDTH}px` },
    });
  }

  // 分组容器在前（zIndex 0），普通节点与折叠节点在后（zIndex 1）。
  return { nodes: [...groupNodes, ...tavernNodes, ...collapsedNodes], edges };
}
