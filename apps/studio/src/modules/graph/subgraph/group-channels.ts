/**
 * 节点组边界端口 / 输出通道派生（纯函数、可单测）。
 *
 * 折叠节点组对外表现为单节点时，其左入右出插槽由**跨边界连线**派生：
 * - 输入插槽：外部 → 组内成员的边（按「成员入端口」去重）。
 * - 输出插槽（= 输出通道）：组内成员 → 外部的边（按「成员出端口」去重）。
 *
 * 「输出通道」可被显式开关（`group.disabledChannels`）；其**末端节点**（产出该通道的成员）
 * 若被禁用（`node.enabled===false`），则该通道在语义上亦视为关闭（数据未变，仅显示/编排关闭）。
 * 同一成员贡献多个同侧句柄时，标签附加端口名以消歧（避免「多个同名插位」）。
 */
import {
  createDefaultNodeTypeRegistry,
  resolveNodeGraphNodePorts,
  type NodeGraphDocument,
  type NodeGraphGroup,
  type NodeGraphPortType,
  type NodeTypeRegistry,
} from "@tavern/core/node-graph";

export interface GroupBoundaryHandle {
  /** Vue Flow handle id（与重路由后的边 sourceHandle/targetHandle 对应）。 */
  id: string;
  label: string;
  type: NodeGraphPortType;
}

export interface GroupOutputChannel extends GroupBoundaryHandle {
  /** 产出该通道的成员节点 id（通道「末端节点」）。 */
  memberNodeId: string;
  port: string;
  /** 被 `group.disabledChannels` 显式关闭。 */
  explicitlyDisabled: boolean;
  /** 末端节点自身被禁用（`node.enabled===false`）。 */
  producerDisabled: boolean;
  /** 综合关闭态（显式关闭 或 末端禁用）。 */
  disabled: boolean;
}

export interface GroupBoundaryHandles {
  inputs: GroupBoundaryHandle[];
  outputs: GroupOutputChannel[];
}

/** 输出通道 handle id（同时是 `group.disabledChannels` 的键）。 */
export function channelHandleId(memberNodeId: string, port: string): string {
  return `out:${memberNodeId}:${port}`;
}

/** 输入 handle id。 */
export function inputHandleId(memberNodeId: string, port: string): string {
  return `in:${memberNodeId}:${port}`;
}

/** 同成员多句柄时，给标签附加端口名消歧。 */
function disambiguate<T extends { id: string; label: string; memberNodeId: string; port: string }>(handles: T[]): void {
  const countByMember = new Map<string, number>();
  for (const handle of handles) {
    countByMember.set(handle.memberNodeId, (countByMember.get(handle.memberNodeId) ?? 0) + 1);
  }
  for (const handle of handles) {
    if ((countByMember.get(handle.memberNodeId) ?? 0) > 1) {
      handle.label = `${handle.label} · ${handle.port}`;
    }
  }
}

/** 派生某节点组的边界输入/输出（仅看跨边界连线，去重、消歧、带通道关闭态）。 */
export function deriveGroupBoundaryHandles(
  document: Pick<NodeGraphDocument, "nodes" | "edges">,
  group: NodeGraphGroup,
  registry: NodeTypeRegistry = createDefaultNodeTypeRegistry(),
): GroupBoundaryHandles {
  const memberSet = new Set(group.nodeIds);
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));
  const disabledSet = new Set(group.disabledChannels ?? []);

  function titleOf(nodeId: string): string {
    const node = nodeById.get(nodeId);
    if (!node) {
      return nodeId;
    }
    return node.name ?? registry.find(node.type, node.typeVersion)?.title ?? node.type;
  }
  function portType(nodeId: string, portName: string, dir: "in" | "out"): NodeGraphPortType {
    const node = nodeById.get(nodeId);
    if (!node) {
      return "json";
    }
    const ports = resolveNodeGraphNodePorts(node, registry.find(node.type, node.typeVersion));
    const list = dir === "in" ? ports.inputPorts : ports.outputPorts;
    return list.find((port) => port.name === portName)?.type ?? "json";
  }

  const inputs: (GroupBoundaryHandle & { memberNodeId: string; port: string })[] = [];
  const outputs: GroupOutputChannel[] = [];
  const seenIn = new Set<string>();
  const seenOut = new Set<string>();

  for (const edge of document.edges) {
    const fromMember = memberSet.has(edge.from.nodeId);
    const toMember = memberSet.has(edge.to.nodeId);
    if (fromMember === toMember) {
      continue; // 同在/同不在组内：非跨界边
    }
    if (toMember) {
      const id = inputHandleId(edge.to.nodeId, edge.to.port);
      if (!seenIn.has(id)) {
        seenIn.add(id);
        inputs.push({
          id,
          label: titleOf(edge.to.nodeId),
          type: portType(edge.to.nodeId, edge.to.port, "in"),
          memberNodeId: edge.to.nodeId,
          port: edge.to.port,
        });
      }
    } else {
      const id = channelHandleId(edge.from.nodeId, edge.from.port);
      if (!seenOut.has(id)) {
        seenOut.add(id);
        const explicitlyDisabled = disabledSet.has(id);
        const producerDisabled = nodeById.get(edge.from.nodeId)?.enabled === false;
        outputs.push({
          id,
          label: titleOf(edge.from.nodeId),
          type: portType(edge.from.nodeId, edge.from.port, "out"),
          memberNodeId: edge.from.nodeId,
          port: edge.from.port,
          explicitlyDisabled,
          producerDisabled,
          disabled: explicitlyDisabled || producerDisabled,
        });
      }
    }
  }

  disambiguate(inputs);
  disambiguate(outputs);

  return {
    inputs: inputs.map(({ id, label, type }) => ({ id, label, type })),
    outputs,
  };
}
