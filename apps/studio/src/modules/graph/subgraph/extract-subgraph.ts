/**
 * 「Extract to NodeGroup」纯逻辑（方案 β，见
 * `.limcode/design/agentic-batch10-nodegroup-subgraph-v1-design.md` §3.6）。
 *
 * 把父图里的一个**组**抽取为一份**可复用子图文档** + 在父图原处替换为单个 `group.node` 实例：
 *
 * - 组内边 → 子图内部边；
 * - 跨入边界的数据边（外部 → 组内）→ 子图 `group.input` 边界节点 + 父图 `group.node` 输入口；
 * - 跨出边界的数据边（组内 → 外部）→ 子图 `group.output` 边界节点 + 父图 `group.node` 输出口；
 * - `group.node.config.interface` 由子图边界推导（与父图实例端口一致）。
 *
 * 产出的子图文档可经现有 `nodeGraphApi.create` 持久化（普通 NodeGraph 定义，`metadata.subgraph=true`）；
 * 父图填入 `ref` 后即为合法可保存文档。纯函数、可单测；v1 不支持跨边界的 control 边（返回 null）。
 */
import {
  createDefaultNodeTypeRegistry,
  deriveSubgraphInterface,
  nodeGraphEdgeKind,
  resolveNodeGraphNodePorts,
  NODE_GRAPH_GROUP_INPUT_TYPE,
  NODE_GRAPH_GROUP_NODE_TYPE,
  NODE_GRAPH_GROUP_OUTPUT_TYPE,
  NODE_GRAPH_PHASES,
  type NodeGraphDocument,
  type NodeGraphEdge,
  type NodeGraphNode,
  type NodeGraphPhase,
  type NodeGraphPortType,
} from "@tavern/core/node-graph";

export interface ExtractSubgraphResult {
  /** 待持久化的子图文档（graphId 留空，由后端分配）。 */
  subDocument: NodeGraphDocument;
  /** 父图替换结果（group.node 的 config.ref.graphId 为占位空串，持久化后回填）。 */
  parentDocument: NodeGraphDocument;
  /** 新建的 group.node 节点 id（供选中/回填 ref）。 */
  groupNodeId: string;
}

export type ExtractSubgraphError =
  | "group_not_found"
  | "group_empty"
  | "control_edge_crosses_boundary";

const registry = createDefaultNodeTypeRegistry();

function phaseOrder(phase: NodeGraphPhase): number {
  const index = (NODE_GRAPH_PHASES as readonly string[]).indexOf(phase);
  return index < 0 ? 0 : index;
}

function outputPortType(node: NodeGraphNode, portName: string): NodeGraphPortType {
  const ports = resolveNodeGraphNodePorts(node, registry.find(node.type, node.typeVersion));
  return ports.outputPorts.find((port) => port.name === portName)?.type ?? "json";
}

function inputPortType(node: NodeGraphNode, portName: string): NodeGraphPortType {
  const ports = resolveNodeGraphNodePorts(node, registry.find(node.type, node.typeVersion));
  return ports.inputPorts.find((port) => port.name === portName)?.type ?? "json";
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let index = 1;
  let candidate = `${base}_${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${base}_${index}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * 把 `document` 中 `groupId` 指向的组抽取为子图 + group.node。
 * 失败返回 `{ error }`（组不存在/为空/含跨边界 control 边）。
 */
export function extractSubgraph(
  document: NodeGraphDocument,
  groupId: string,
): ExtractSubgraphResult | { error: ExtractSubgraphError } {
  const group = (document.groups ?? []).find((candidate) => candidate.id === groupId);
  if (!group) {
    return { error: "group_not_found" };
  }
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const));
  const members = group.nodeIds.filter((id) => nodeById.has(id));
  if (members.length === 0) {
    return { error: "group_empty" };
  }
  const memberSet = new Set(members);

  const internalEdges: NodeGraphEdge[] = [];
  const inboundEdges: NodeGraphEdge[] = [];
  const outboundEdges: NodeGraphEdge[] = [];
  for (const edge of document.edges) {
    const fromMember = memberSet.has(edge.from.nodeId);
    const toMember = memberSet.has(edge.to.nodeId);
    if (fromMember && toMember) {
      internalEdges.push(edge);
    } else if (!fromMember && toMember) {
      if (nodeGraphEdgeKind(edge) === "control") {
        return { error: "control_edge_crosses_boundary" };
      }
      inboundEdges.push(edge);
    } else if (fromMember && !toMember) {
      if (nodeGraphEdgeKind(edge) === "control") {
        return { error: "control_edge_crosses_boundary" };
      }
      outboundEdges.push(edge);
    }
  }

  // 子图节点 id 占用集（成员 + 即将新增的边界节点）。
  const subNodeIds = new Set<string>(members);
  const subNodes: NodeGraphNode[] = members.map((id) => {
    const node = nodeById.get(id)!;
    const { ui: _ui, ...rest } = node;
    return { ...rest } as NodeGraphNode;
  });
  const subEdges: NodeGraphEdge[] = internalEdges.map((edge) => ({ ...edge }));
  const subEdgeIds = new Set<string>(subEdges.map((edge) => edge.id));

  // —— 入边界：单个 Group Input（多端口，仿 Blender）；按「外部源端点」去重为命名端口 ——
  const inboundPortByExternal = new Map<string, string>();
  if (inboundEdges.length > 0) {
    const giNodeId = uniqueId("gi", subNodeIds);
    const inboundPorts: Array<{ name: string; type: NodeGraphPortType }> = [];
    let inboundCounter = 0;
    for (const edge of inboundEdges) {
      const externalKey = `${edge.from.nodeId}:${edge.from.port}`;
      let portName = inboundPortByExternal.get(externalKey);
      if (!portName) {
        inboundCounter += 1;
        portName = `in_${inboundCounter}`;
        // 端口类型取「成员目标输入端口类型」，使内部连线类型匹配。
        const targetNode = nodeById.get(edge.to.nodeId)!;
        inboundPorts.push({ name: portName, type: inputPortType(targetNode, edge.to.port) });
        inboundPortByExternal.set(externalKey, portName);
      }
      subEdges.push({
        id: uniqueId(`e_${giNodeId}_${edge.to.nodeId}`, subEdgeIds),
        from: { nodeId: giNodeId, port: portName },
        to: { nodeId: edge.to.nodeId, port: edge.to.port },
      });
    }
    subNodes.push({
      id: giNodeId,
      type: NODE_GRAPH_GROUP_INPUT_TYPE,
      typeVersion: "1",
      name: "Group Input",
      phase: "pre_response",
      config: { ports: inboundPorts },
    });
  }

  // —— 出边界：单个 Group Output（多端口）；按「成员源端点」去重为命名端口 ——
  const outboundPortByMember = new Map<string, string>();
  if (outboundEdges.length > 0) {
    const goNodeId = uniqueId("go", subNodeIds);
    const outboundPorts: Array<{ name: string; type: NodeGraphPortType }> = [];
    let outboundCounter = 0;
    for (const edge of outboundEdges) {
      const memberKey = `${edge.from.nodeId}:${edge.from.port}`;
      let portName = outboundPortByMember.get(memberKey);
      if (!portName) {
        outboundCounter += 1;
        portName = `out_${outboundCounter}`;
        const sourceNode = nodeById.get(edge.from.nodeId)!;
        outboundPorts.push({ name: portName, type: outputPortType(sourceNode, edge.from.port) });
        outboundPortByMember.set(memberKey, portName);
        subEdges.push({
          id: uniqueId(`e_${edge.from.nodeId}_${goNodeId}`, subEdgeIds),
          from: { nodeId: edge.from.nodeId, port: edge.from.port },
          to: { nodeId: goNodeId, port: portName },
        });
      }
    }
    subNodes.push({
      id: goNodeId,
      type: NODE_GRAPH_GROUP_OUTPUT_TYPE,
      typeVersion: "1",
      name: "Group Output",
      phase: "commit",
      config: { ports: outboundPorts },
    });
  }

  const subDocument: NodeGraphDocument = {
    schemaVersion: 2,
    graphId: "",
    name: group.name || "子图",
    description: `从「${document.name}」抽取的可复用子图`,
    mode: "native_graph",
    nodes: subNodes,
    edges: subEdges,
    policies: { ...document.policies },
    permissions: document.permissions ? { ...document.permissions } : undefined,
    metadata: { subgraph: true },
  };

  const interfaceDef = deriveSubgraphInterface(subDocument);

  // —— 父图：移除成员与其全部关联边，替换为 group.node ——
  const parentNodeIds = new Set(document.nodes.map((node) => node.id));
  const groupNodeId = uniqueId("n_group_1", new Set(parentNodeIds));

  // group.node 相位：取成员中最早相位（满足入边 phase<=gn、gn<=出边 phase 的常见情形）。
  const memberMinOrder = Math.min(...members.map((id) => phaseOrder(nodeById.get(id)!.phase)));
  const gnPhase = (NODE_GRAPH_PHASES[memberMinOrder] ?? "pre_response") as NodeGraphPhase;

  const parentNodes: NodeGraphNode[] = document.nodes
    .filter((node) => !memberSet.has(node.id))
    .map((node) => ({ ...node }));
  parentNodes.push({
    id: groupNodeId,
    type: NODE_GRAPH_GROUP_NODE_TYPE,
    typeVersion: "1",
    name: group.name || "Node Group",
    phase: gnPhase,
    config: { ref: { graphId: "" }, interface: interfaceDef },
  });

  const parentEdges: NodeGraphEdge[] = document.edges
    .filter((edge) => !memberSet.has(edge.from.nodeId) && !memberSet.has(edge.to.nodeId))
    .map((edge) => ({ ...edge }));
  const parentEdgeIds = new Set<string>(parentEdges.map((edge) => edge.id));

  // 入边：外部源 → group.node 输入口（按外部源去重，一条）。
  for (const [externalKey, portName] of inboundPortByExternal) {
    const [fromNodeId, fromPort] = externalKey.split(":");
    parentEdges.push({
      id: uniqueId(`e_${fromNodeId}_${groupNodeId}_${portName}`, parentEdgeIds),
      from: { nodeId: fromNodeId!, port: fromPort! },
      to: { nodeId: groupNodeId, port: portName },
    });
  }
  // 出边：group.node 输出口 → 各外部目标（保留每条原出边的目标）。
  for (const edge of outboundEdges) {
    const portName = outboundPortByMember.get(`${edge.from.nodeId}:${edge.from.port}`)!;
    parentEdges.push({
      id: uniqueId(`e_${groupNodeId}_${portName}_${edge.to.nodeId}`, parentEdgeIds),
      from: { nodeId: groupNodeId, port: portName },
      to: { nodeId: edge.to.nodeId, port: edge.to.port },
    });
  }

  // 其余分组：剔除被抽取组；从所有组里移除已迁出的成员 id（避免悬挂引用）。
  const parentGroups = (document.groups ?? [])
    .filter((candidate) => candidate.id !== groupId)
    .map((candidate) => ({ ...candidate, nodeIds: candidate.nodeIds.filter((id) => !memberSet.has(id)) }))
    .filter((candidate) => candidate.nodeIds.length > 0);

  const parentDocument: NodeGraphDocument = {
    ...document,
    nodes: parentNodes,
    edges: parentEdges,
    groups: parentGroups,
  };

  return { subDocument, parentDocument, groupNodeId };
}
