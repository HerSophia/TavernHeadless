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

import { NODE_WIDTH, estimateNodeHeight } from "../canvas/map-document";
import { phaseStyle } from "../canvas/port-styles";

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

/** 构建 ELK 根图（含复合分组、partitioning、ports）。 */
export function buildElkGraph(document: NodeGraphDocument, options: ElkAdapterOptions = {}): ElkNode {
  const registry = options.registry ?? createDefaultNodeTypeRegistry();
  const sizeByNodeId = options.sizeByNodeId ?? {};

  const entries = new Map<string, NodeTypeRegistryEntry | undefined>();
  const orderByNodeId = new Map<string, number>();
  for (const node of document.nodes) {
    entries.set(node.id, registry.find(node.type, node.typeVersion));
    orderByNodeId.set(node.id, phaseStyle(node.phase).order);
  }

  const hasPortId = new Set<string>();
  const leafById = new Map<string, ElkNode>();
  for (const node of document.nodes) {
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

  // 分组容器（复合节点）：成员叶子作为其 children。
  const groupedNodeIds = new Set<string>();
  const groupNodes: ElkNode[] = [];
  for (const group of document.groups ?? []) {
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
    if (!groupedNodeIds.has(node.id)) {
      topLevelLeaves.push(leafById.get(node.id)!);
    }
  }

  const edges: ElkExtendedEdge[] = document.edges.map((edge) => {
    const sourcePortId = portElkId(edge.from.nodeId, edge.from.port, "out");
    const targetPortId = portElkId(edge.to.nodeId, edge.to.port, "in");
    return {
      id: edge.id,
      sources: [hasPortId.has(sourcePortId) ? sourcePortId : edge.from.nodeId],
      targets: [hasPortId.has(targetPortId) ? targetPortId : edge.to.nodeId],
    };
  });

  return {
    id: "root",
    layoutOptions: ROOT_LAYOUT_OPTIONS,
    children: [...topLevelLeaves, ...groupNodes],
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
