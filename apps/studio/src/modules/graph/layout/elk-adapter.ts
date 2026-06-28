/**
 * `NodeGraphDocument` → ELK 图（B10 阶段 5，纯函数、可单测）。
 *
 * 设计 §3.2：`layered` 算法、方向 RIGHT；phase 映射为 ELK partitioning（分层列约束）；
 * group 映射为 ELK 复合（compound）节点使其成块；节点端口映射为 ELK ports（输入 WEST /
 * 输出 EAST）。布局在 Web Worker 中进行（见 use-auto-layout）；本模块只负责**构图**与
 * **结果坐标还原**（ELK 子节点坐标相对父节点，这里累加为画布绝对坐标）。
 */
import {
  createDefaultNodeTypeRegistry,
  type NodeGraphDocument,
  type NodeTypeRegistry,
  type NodeTypeRegistryEntry,
} from "@tavern/core/node-graph";
import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from "elkjs";

import {
  COLLAPSED_NODE_ID_PREFIX,
  NODE_FOOTER_HEIGHT,
  NODE_HEADER_HEIGHT,
  NODE_PORT_ROW_HEIGHT,
  NODE_WIDTH,
  estimateNodeHeight,
} from "../canvas/map-document";
import { phaseStyle } from "../canvas/port-styles";
import {
  channelHandleId,
  deriveGroupBoundaryHandles,
  inputHandleId,
  type GroupBoundaryHandles,
} from "../subgraph/group-channels";

export interface ElkAdapterOptions {
  registry?: NodeTypeRegistry;
  /** 已渲染测量到的节点真实尺寸（按 nodeId）；缺省时用几何常量估算。 */
  sizeByNodeId?: Record<string, { width: number; height: number }>;
}

export interface NodeRect {
  x: number;
  y: number;
}

export interface GroupRect extends NodeRect {
  width: number;
  height: number;
}

export interface ElkLayoutResult {
  /** 叶子节点的画布绝对坐标（按 nodeId）。 */
  positions: Record<string, NodeRect>;
  /** 分组容器的画布绝对几何（按 VueFlow 容器 id `group:<id>`）。 */
  groups: Record<string, GroupRect>;
}

const ROOT_LAYOUT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.partitioning.activate": "true",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.spacing.nodeNode": "28",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
};

const GROUP_LAYOUT_OPTIONS: LayoutOptions = {
  "elk.partitioning.activate": "true",
  "elk.padding": "[top=30,left=24,bottom=24,right=24]",
};

const PORT_SIZE = 8;

function portElkId(nodeId: string, portName: string, dir: "in" | "out"): string {
  return `${nodeId}::${dir}::${portName}`;
}

function buildPorts(nodeId: string, entry: NodeTypeRegistryEntry | undefined): ElkPort[] {
  if (!entry) {
    return [];
  }
  const ports: ElkPort[] = [];
  entry.inputPorts.forEach((port, index) => {
    ports.push({
      id: portElkId(nodeId, port.name, "in"),
      width: PORT_SIZE,
      height: PORT_SIZE,
      layoutOptions: { "elk.port.side": "WEST", "elk.port.index": String(index) },
    });
  });
  entry.outputPorts.forEach((port, index) => {
    ports.push({
      id: portElkId(nodeId, port.name, "out"),
      width: PORT_SIZE,
      height: PORT_SIZE,
      layoutOptions: { "elk.port.side": "EAST", "elk.port.index": String(index) },
    });
  });
  return ports;
}

/**
 * 构建 ELK 根图（含复合分组、partitioning、ports）。
 *
 * 折叠子图组（`kind==='subgraph' && collapsed===true`）在布局时按**单个叶子节点**参与，
 * 不展开其内部成员——与画布上的折叠节点表现一致，避免「按展开后的内部结构」占位而在
 * 折叠视图里留下大块空隙。其左入右出端口由跨边界连线派生；跨界边重路由到折叠叶子，组内边略去。
 */
export function buildElkGraph(document: NodeGraphDocument, options: ElkAdapterOptions = {}): ElkNode {
  const registry = options.registry ?? createDefaultNodeTypeRegistry();
  const sizeByNodeId = options.sizeByNodeId ?? {};

  // 折叠子图组：布局时折叠为单节点。memberNodeId -> 折叠叶子 id。
  const collapsedGroups = (document.groups ?? []).filter(
    (group) => group.kind === "subgraph" && group.collapsed === true,
  );
  const boundaryByGroup = new Map<string, GroupBoundaryHandles>();
  const collapsedLeafIdByMember = new Map<string, string>();
  for (const group of collapsedGroups) {
    boundaryByGroup.set(group.id, deriveGroupBoundaryHandles(document, group, registry));
    for (const nodeId of group.nodeIds) {
      collapsedLeafIdByMember.set(nodeId, `${COLLAPSED_NODE_ID_PREFIX}${group.id}`);
    }
  }
  const collapsedMemberSet = new Set(collapsedLeafIdByMember.keys());

  const entries = new Map<string, NodeTypeRegistryEntry | undefined>();
  const orderByNodeId = new Map<string, number>();
  for (const node of document.nodes) {
    entries.set(node.id, registry.find(node.type, node.typeVersion));
    orderByNodeId.set(node.id, phaseStyle(node.phase).order);
  }

  const hasPortId = new Set<string>();
  const leafById = new Map<string, ElkNode>();
  for (const node of document.nodes) {
    // 折叠组成员不单独参与布局（整组折叠为单节点）。
    if (collapsedMemberSet.has(node.id)) {
      continue;
    }
    const entry = entries.get(node.id);
    const size = sizeByNodeId[node.id];
    const ports = buildPorts(node.id, entry);
    for (const port of ports) {
      hasPortId.add(port.id);
    }
    leafById.set(node.id, {
      id: node.id,
      width: size?.width ?? NODE_WIDTH,
      height: size?.height ?? estimateNodeHeight(entry),
      ports,
      layoutOptions: {
        "elk.partitioning.partition": String(orderByNodeId.get(node.id) ?? 0),
        "elk.portConstraints": ports.length > 0 ? "FIXED_ORDER" : "FREE",
      },
    });
  }

  // 折叠组叶子：端口由派生的输入/输出通道生成（与画布折叠节点的 handle id 对齐）。
  const collapsedLeaves: ElkNode[] = [];
  for (const group of collapsedGroups) {
    const handles = boundaryByGroup.get(group.id);
    if (!handles) {
      continue;
    }
    const ports: ElkPort[] = [];
    handles.inputs.forEach((handle, index) => {
      hasPortId.add(handle.id);
      ports.push({
        id: handle.id,
        width: PORT_SIZE,
        height: PORT_SIZE,
        layoutOptions: { "elk.port.side": "WEST", "elk.port.index": String(index) },
      });
    });
    handles.outputs.forEach((handle, index) => {
      hasPortId.add(handle.id);
      ports.push({
        id: handle.id,
        width: PORT_SIZE,
        height: PORT_SIZE,
        layoutOptions: { "elk.port.side": "EAST", "elk.port.index": String(index) },
      });
    });
    const rows = Math.max(handles.inputs.length, handles.outputs.length, 1);
    let minOrder = Number.POSITIVE_INFINITY;
    for (const nodeId of group.nodeIds) {
      minOrder = Math.min(minOrder, orderByNodeId.get(nodeId) ?? 0);
    }
    collapsedLeaves.push({
      id: `${COLLAPSED_NODE_ID_PREFIX}${group.id}`,
      width: NODE_WIDTH,
      height: NODE_HEADER_HEIGHT + rows * NODE_PORT_ROW_HEIGHT + NODE_FOOTER_HEIGHT,
      ports,
      layoutOptions: {
        "elk.partitioning.partition": String(Number.isFinite(minOrder) ? minOrder : 0),
        "elk.portConstraints": ports.length > 0 ? "FIXED_ORDER" : "FREE",
      },
    });
  }

  // 分组容器（复合节点）：成员叶子作为其 children；折叠子图组跳过（已折叠为单叶子）。
  const groupedNodeIds = new Set<string>();
  const groupNodes: ElkNode[] = [];
  for (const group of document.groups ?? []) {
    if (group.kind === "subgraph" && group.collapsed === true) {
      continue;
    }
    const memberLeaves: ElkNode[] = [];
    let minOrder = Number.POSITIVE_INFINITY;
    for (const nodeId of group.nodeIds) {
      const leaf = leafById.get(nodeId);
      if (!leaf || groupedNodeIds.has(nodeId)) {
        continue;
      }
      groupedNodeIds.add(nodeId);
      memberLeaves.push(leaf);
      minOrder = Math.min(minOrder, orderByNodeId.get(nodeId) ?? 0);
    }
    if (memberLeaves.length === 0) {
      continue;
    }
    groupNodes.push({
      id: `group:${group.id}`,
      children: memberLeaves,
      layoutOptions: {
        ...GROUP_LAYOUT_OPTIONS,
        "elk.partitioning.partition": String(Number.isFinite(minOrder) ? minOrder : 0),
      },
    });
  }

  const topLevelLeaves: ElkNode[] = [];
  for (const node of document.nodes) {
    if (collapsedMemberSet.has(node.id) || groupedNodeIds.has(node.id)) {
      continue;
    }
    topLevelLeaves.push(leafById.get(node.id)!);
  }

  const edges: ElkExtendedEdge[] = [];
  for (const edge of document.edges) {
    const fromCollapsed = collapsedLeafIdByMember.get(edge.from.nodeId);
    const toCollapsed = collapsedLeafIdByMember.get(edge.to.nodeId);
    // 折叠组内部边：略去（已收进折叠叶子）。
    if (fromCollapsed && toCollapsed && fromCollapsed === toCollapsed) {
      continue;
    }
    let source: string;
    if (fromCollapsed) {
      source = channelHandleId(edge.from.nodeId, edge.from.port);
    } else {
      const sourcePortId = portElkId(edge.from.nodeId, edge.from.port, "out");
      source = hasPortId.has(sourcePortId) ? sourcePortId : edge.from.nodeId;
    }
    let target: string;
    if (toCollapsed) {
      target = inputHandleId(edge.to.nodeId, edge.to.port);
    } else {
      const targetPortId = portElkId(edge.to.nodeId, edge.to.port, "in");
      target = hasPortId.has(targetPortId) ? targetPortId : edge.to.nodeId;
    }
    edges.push({ id: edge.id, sources: [source], targets: [target] });
  }

  return {
    id: "root",
    layoutOptions: ROOT_LAYOUT_OPTIONS,
    children: [...topLevelLeaves, ...groupNodes, ...collapsedLeaves],
    edges,
  };
}

/** 把 ELK 布局结果还原为画布绝对坐标（叶子位置 + 分组容器几何）。 */
export function extractElkLayout(root: ElkNode): ElkLayoutResult {
  const positions: Record<string, NodeRect> = {};
  const groups: Record<string, GroupRect> = {};

  for (const child of root.children ?? []) {
    const baseX = child.x ?? 0;
    const baseY = child.y ?? 0;
    if (child.id.startsWith("group:")) {
      groups[child.id] = {
        x: baseX,
        y: baseY,
        width: child.width ?? 0,
        height: child.height ?? 0,
      };
      for (const member of child.children ?? []) {
        positions[member.id] = { x: baseX + (member.x ?? 0), y: baseY + (member.y ?? 0) };
      }
    } else {
      positions[child.id] = { x: baseX, y: baseY };
    }
  }

  return { positions, groups };
}
