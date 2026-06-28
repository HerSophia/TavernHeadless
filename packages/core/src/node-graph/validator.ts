import {
  collectNodeGraphConditionValueRefs,
  validateNodeGraphConditionExpr,
  type NodeGraphConditionExpr,
} from './condition.js';
import {
  isNodeGraphControlNodeType,
  nodeGraphControlOutputPorts,
  nodeGraphEdgeKind,
  NODE_GRAPH_ON_SKIP_BEHAVIORS,
} from './control.js';
import { hasNodeGraphErrors } from './diagnostics.js';
import { nodeGraphDocumentSchemaVersion } from './migration.js';
import { createDefaultNodeTypeRegistry, NodeTypeRegistry } from './registry.js';
import {
  isNodeGraphGroupNodeType,
  readGroupNodeInterface,
  readGroupNodeRef,
  resolveNodeGraphNodePorts,
} from './subgraph.js';
import {
  NODE_GRAPH_CHECKPOINT_POLICIES,
  NODE_GRAPH_NODE_SCOPES,
  NODE_GRAPH_PHASES,
  NODE_GRAPH_PORT_TYPES,
  NODE_GRAPH_SCHEMA_VERSION_V2,
  NODE_GRAPH_SUPPORTED_SCHEMA_VERSIONS,
  type NodeGraphCheckpointPolicy,
  type NodeGraphCompilerOptions,
  type NodeGraphDiagnostic,
  type NodeGraphDocument,
  type NodeGraphEdge,
  type NodeGraphFailurePolicy,
  type NodeGraphNode,
  type NodeGraphNodeScope,
  type NodeGraphPhase,
  type NodeGraphPortDefinition,
  type NodeGraphPortType,
  type NodeGraphRetryPolicy,
  type NodeTypeRegistryEntry,
} from './types.js';

export interface NodeGraphValidationOptions extends NodeGraphCompilerOptions {
  registry?: NodeTypeRegistry;
}

export interface NodeGraphValidationResult {
  diagnostics: NodeGraphDiagnostic[];
  nodesById: Map<string, NodeGraphNode>;
  incomingEdgesByNodeId: Map<string, NodeGraphEdge[]>;
  outgoingEdgesByNodeId: Map<string, NodeGraphEdge[]>;
  topologicalLevels: NodeGraphNode[][];
  isValid: boolean;
}

const PHASE_INDEX = new Map<NodeGraphPhase, number>(NODE_GRAPH_PHASES.map((phase, index) => [phase, index]));
const PORT_TYPE_SET = new Set<NodeGraphPortType>(NODE_GRAPH_PORT_TYPES);
const PAGE_SCOPED_RETRY_POLICIES = new Set(['always_rerun_per_page', 'never_reuse']);
const RETRY_POLICY_SET = new Set<NodeGraphRetryPolicy>([
  'reuse_if_inputs_same',
  'always_rerun_per_page',
  'rerun_if_upstream_changed',
  'never_reuse',
]);
const FAILURE_POLICY_SET = new Set<NodeGraphFailurePolicy>([
  'fail_open',
  'fail_closed',
  'use_default',
  'skip',
]);

function add(diagnostics: NodeGraphDiagnostic[], diagnostic: NodeGraphDiagnostic): void {
  diagnostics.push(diagnostic);
}

function phaseOrder(phase: NodeGraphPhase): number {
  return PHASE_INDEX.get(phase) ?? Number.MAX_SAFE_INTEGER;
}

function isKnownPortType(type: string): type is NodeGraphPortType {
  return PORT_TYPE_SET.has(type as NodeGraphPortType);
}

function findPort(ports: readonly NodeGraphPortDefinition[], name: string): NodeGraphPortDefinition | undefined {
  return ports.find((port) => port.name === name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arePortTypesCompatible(from: NodeGraphPortType, to: NodeGraphPortType): boolean {
  if (from === to) {
    return true;
  }
  return to === 'json';
}

function pushEdge(map: Map<string, NodeGraphEdge[]>, nodeId: string, edge: NodeGraphEdge): void {
  const current = map.get(nodeId);
  if (current) {
    current.push(edge);
    return;
  }
  map.set(nodeId, [edge]);
}

function buildEdgeMaps(edges: readonly NodeGraphEdge[]): {
  incomingEdgesByNodeId: Map<string, NodeGraphEdge[]>;
  outgoingEdgesByNodeId: Map<string, NodeGraphEdge[]>;
} {
  const incomingEdgesByNodeId = new Map<string, NodeGraphEdge[]>();
  const outgoingEdgesByNodeId = new Map<string, NodeGraphEdge[]>();
  for (const edge of edges) {
    pushEdge(outgoingEdgesByNodeId, edge.from.nodeId, edge);
    pushEdge(incomingEdgesByNodeId, edge.to.nodeId, edge);
  }
  return { incomingEdgesByNodeId, outgoingEdgesByNodeId };
}

function collectTopologicalLevels(
  nodes: readonly NodeGraphNode[],
  edges: readonly NodeGraphEdge[],
  diagnostics: NodeGraphDiagnostic[],
): NodeGraphNode[][] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, NodeGraphEdge[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!nodesById.has(edge.from.nodeId) || !nodesById.has(edge.to.nodeId)) {
      continue;
    }
    indegree.set(edge.to.nodeId, (indegree.get(edge.to.nodeId) ?? 0) + 1);
    pushEdge(outgoing, edge.from.nodeId, edge);
  }

  const levels: NodeGraphNode[][] = [];
  let ready = [...nodes]
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => left.id.localeCompare(right.id));
  const visited = new Set<string>();

  while (ready.length > 0) {
    levels.push(ready);
    const next: NodeGraphNode[] = [];
    for (const node of ready) {
      visited.add(node.id);
      for (const edge of outgoing.get(node.id) ?? []) {
        const nextIndegree = (indegree.get(edge.to.nodeId) ?? 0) - 1;
        indegree.set(edge.to.nodeId, nextIndegree);
        if (nextIndegree === 0) {
          const downstream = nodesById.get(edge.to.nodeId);
          if (downstream) {
            next.push(downstream);
          }
        }
      }
    }
    ready = next.sort((left, right) => left.id.localeCompare(right.id));
  }

  if (visited.size !== nodes.length) {
    const cyclicNodeIds = nodes
      .filter((node) => !visited.has(node.id))
      .map((node) => node.id)
      .sort();
    add(diagnostics, {
      severity: 'error',
      code: 'node_graph_cycle_detected',
      message: `NodeGraph contains a cycle involving nodes: ${cyclicNodeIds.join(', ')}`,
    });
  }

  return levels;
}

function validateNodeShape(document: NodeGraphDocument, diagnostics: NodeGraphDiagnostic[]): Map<string, NodeGraphNode> {
  const nodesById = new Map<string, NodeGraphNode>();
  for (const node of document.nodes) {
    if (!node.id || node.id.trim().length === 0) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_node_id_required',
        message: 'Node id is required.',
      });
      continue;
    }
    if (nodesById.has(node.id)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_duplicate_node_id',
        message: `Duplicate node id '${node.id}'.`,
        nodeId: node.id,
      });
      continue;
    }
    nodesById.set(node.id, node);
  }
  return nodesById;
}

function validateRegistryContracts(
  document: NodeGraphDocument,
  registry: NodeTypeRegistry,
  availablePermissionsInput: readonly string[] | undefined,
  diagnostics: NodeGraphDiagnostic[],
): Map<string, NodeTypeRegistryEntry> {
  const entriesByNodeId = new Map<string, NodeTypeRegistryEntry>();
  const availablePermissions = new Set([
    ...(document.permissions?.required ?? []),
    ...(availablePermissionsInput ?? []),
  ]);

  for (const node of document.nodes) {
    const entry = registry.find(node.type, node.typeVersion);
    if (!entry) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_unknown_node_type',
        message: `Node type '${node.type}@${node.typeVersion}' is not registered.`,
        nodeId: node.id,
      });
      continue;
    }

    entriesByNodeId.set(node.id, entry);

    if (!entry.supportedPhases.includes(node.phase)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_phase_not_supported',
        message: `Node '${node.id}' type '${node.type}' does not support phase '${node.phase}'.`,
        nodeId: node.id,
      });
    }

    for (const port of [...entry.inputPorts, ...entry.outputPorts]) {
      if (!isKnownPortType(port.type)) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_unknown_port_type',
          message: `Node '${node.id}' declares unknown port type '${port.type}'.`,
          nodeId: node.id,
          port: port.name,
        });
      }
    }

    for (const permission of entry.permissionsRequired ?? []) {
      if (!availablePermissions.has(permission)) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_permission_missing',
          message: `Node '${node.id}' requires permission '${permission}' that is not declared in the graph manifest.`,
          nodeId: node.id,
        });
      }
    }
  }

  return entriesByNodeId;
}

function validateEdges(
  document: NodeGraphDocument,
  nodesById: Map<string, NodeGraphNode>,
  entriesByNodeId: Map<string, NodeTypeRegistryEntry>,
  schemaVersion: number,
  diagnostics: NodeGraphDiagnostic[],
): void {
  const edgeIds = new Set<string>();
  const controlEdgesEnabled = schemaVersion >= NODE_GRAPH_SCHEMA_VERSION_V2;
  const incomingDataEdgesByNodePort = new Map<string, {
    nodeId: string;
    portName: string;
    edges: NodeGraphEdge[];
  }>();
  for (const edge of document.edges) {
    if (edgeIds.has(edge.id)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_duplicate_edge_id',
        message: `Duplicate edge id '${edge.id}'.`,
        edgeId: edge.id,
      });
    }
    edgeIds.add(edge.id);

    const kind = nodeGraphEdgeKind(edge);

    // NG2-CORE：control edge 仅在 schemaVersion >= 2 放行；v1 仍报 unsupported（保持 R5.1 行为）。
    if (kind === 'control' && !controlEdgesEnabled) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_control_edge_unsupported',
        message: `Control edge '${edge.id}' requires NodeGraph schemaVersion >= 2.`,
        edgeId: edge.id,
      });
      continue;
    }

    const fromNode = nodesById.get(edge.from.nodeId);
    const toNode = nodesById.get(edge.to.nodeId);
    if (!fromNode) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_edge_source_missing',
        message: `Edge '${edge.id}' references missing source node '${edge.from.nodeId}'.`,
        edgeId: edge.id,
      });
      continue;
    }
    if (!toNode) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_edge_target_missing',
        message: `Edge '${edge.id}' references missing target node '${edge.to.nodeId}'.`,
        edgeId: edge.id,
      });
      continue;
    }

    if (phaseOrder(fromNode.phase) > phaseOrder(toNode.phase)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_phase_barrier_violation',
        message: `Edge '${edge.id}' moves backward from '${fromNode.phase}' to '${toNode.phase}'.`,
        edgeId: edge.id,
      });
    }

    // NG2-CORE：control edge 只表达「是否执行下游」，不传数据。
    // 源必须是控制流节点的控制输出端口（branch true/false 或 gate open）；不做 data 端口类型 / 基数校验。
    if (kind === 'control') {
      if (!isNodeGraphControlNodeType(fromNode.type) || !nodeGraphControlOutputPorts(fromNode.type).includes(edge.from.port)) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_control_edge_invalid_source',
          message: `Control edge '${edge.id}' must originate from a control node's control port (branch 'true'/'false' or gate 'open').`,
          edgeId: edge.id,
          nodeId: fromNode.id,
          port: edge.from.port,
        });
      }
      continue;
    }

    const sourceEntry = entriesByNodeId.get(fromNode.id);
    const targetEntry = entriesByNodeId.get(toNode.id);
    if (!sourceEntry || !targetEntry) {
      continue;
    }

    // group.node 端口来自 config.interface（动态），其余取注册表静态端口。
    const sourcePorts = resolveNodeGraphNodePorts(fromNode, sourceEntry);
    const targetPorts = resolveNodeGraphNodePorts(toNode, targetEntry);

    const sourcePort = findPort(sourcePorts.outputPorts, edge.from.port);
    if (!sourcePort) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_output_port_missing',
        message: `Node '${fromNode.id}' has no output port '${edge.from.port}'.`,
        nodeId: fromNode.id,
        edgeId: edge.id,
        port: edge.from.port,
      });
      continue;
    }

    const targetPort = findPort(targetPorts.inputPorts, edge.to.port);
    if (!targetPort) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_input_port_missing',
        message: `Node '${toNode.id}' has no input port '${edge.to.port}'.`,
        nodeId: toNode.id,
        edgeId: edge.id,
        port: edge.to.port,
      });
      continue;
    }

    if (!arePortTypesCompatible(sourcePort.type, targetPort.type)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_port_type_mismatch',
        message: `Edge '${edge.id}' connects '${sourcePort.type}' to incompatible '${targetPort.type}'.`,
        edgeId: edge.id,
      });
    }

    if (kind === 'data') {
      const key = `${toNode.id}:${targetPort.name}`;
      const current = incomingDataEdgesByNodePort.get(key);
      if (current) {
        current.edges.push(edge);
      } else {
        incomingDataEdgesByNodePort.set(key, {
          nodeId: toNode.id,
          portName: targetPort.name,
          edges: [edge],
        });
      }
    }
  }

  for (const { nodeId, portName, edges } of incomingDataEdgesByNodePort.values()) {
    const node = nodesById.get(nodeId);
    const entry = entriesByNodeId.get(nodeId);
    const inputPorts = node ? resolveNodeGraphNodePorts(node, entry).inputPorts : (entry?.inputPorts ?? []);
    const port = findPort(inputPorts, portName);
    if (port && !port.multiple && edges.length > 1) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_input_cardinality_violation',
        message: `Input port '${portName}' on node '${nodeId}' accepts a single value but has ${edges.length} incoming data edges.`,
        nodeId,
        port: portName,
      });
    }
  }

  for (const node of document.nodes) {
    const entry = entriesByNodeId.get(node.id);
    if (!entry) {
      continue;
    }
    const connectedPorts = new Set(
      document.edges
        .filter((edge) => nodeGraphEdgeKind(edge) === 'data' && edge.to.nodeId === node.id)
        .map((edge) => edge.to.port),
    );
    for (const port of resolveNodeGraphNodePorts(node, entry).inputPorts) {
      if (!port.required || connectedPorts.has(port.name) || nodeConfigSatisfiesInput(node, port.name)) {
        continue;
      }
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_required_input_missing',
        message: `Required input port '${port.name}' on node '${node.id}' is not connected or provided by node config.`,
        nodeId: node.id,
        port: port.name,
      });
    }
  }
}

function nodeConfigSatisfiesInput(node: NodeGraphNode, portName: string): boolean {
  if (!isRecord(node.config)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(node.config, portName)) {
    return true;
  }
  const inputs = node.config.inputs;
  return isRecord(inputs) && Object.prototype.hasOwnProperty.call(inputs, portName);
}

function readMediumKind(node: NodeGraphNode): string | null {
  if (!isRecord(node.config) || !isRecord(node.config.medium)) {
    return null;
  }
  return typeof node.config.medium.kind === 'string' ? node.config.medium.kind : null;
}

function validatePolicies(
  document: NodeGraphDocument,
  entriesByNodeId: Map<string, NodeTypeRegistryEntry>,
  diagnostics: NodeGraphDiagnostic[],
): void {
  for (const node of document.nodes) {
    if (node.retryPolicy && !RETRY_POLICY_SET.has(node.retryPolicy)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_retry_policy_unknown',
        message: `Node '${node.id}' declares unsupported retryPolicy '${String(node.retryPolicy)}'.`,
        nodeId: node.id,
      });
    }
    if (node.failurePolicy && !FAILURE_POLICY_SET.has(node.failurePolicy)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_failure_policy_unknown',
        message: `Node '${node.id}' declares unsupported failurePolicy '${String(node.failurePolicy)}'.`,
        nodeId: node.id,
      });
    }
    if (
      (node.phase === 'response' || node.phase === 'post_response' || node.phase === 'commit')
      && node.retryPolicy
      && !PAGE_SCOPED_RETRY_POLICIES.has(node.retryPolicy)
    ) {
      add(diagnostics, {
        severity: 'warning',
        code: 'node_graph_retry_policy_page_scoped',
        message: `Node '${node.id}' runs in page-scoped phase '${node.phase}' and should not reuse floor-scoped outputs.`,
        nodeId: node.id,
      });
    }

    const entry = entriesByNodeId.get(node.id);
    if (!entry) {
      continue;
    }
    if (entry.sideEffects === 'write') {
      if (node.phase !== 'commit') {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_output_node_commit_phase_required',
          message: `Write node '${node.id}' must run in the commit phase.`,
          nodeId: node.id,
        });
      }
      if (document.policies.allowPersistentOutputs !== true) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_persistent_outputs_not_allowed',
          message: `Write node '${node.id}' requires graph policy allowPersistentOutputs=true.`,
          nodeId: node.id,
        });
      }
      if (node.failurePolicy === 'fail_open') {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_write_node_fail_open_forbidden',
          message: `Write node '${node.id}' cannot use failurePolicy 'fail_open'.`,
          nodeId: node.id,
        });
      }
    }

    if (node.type === 'agent.call' && readMediumKind(node) === 'background_job' && document.policies.allowBackgroundJobs !== true) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_background_jobs_not_allowed',
        message: `Node '${node.id}' uses background_job medium but graph policy allowBackgroundJobs=true is not set.`,
        nodeId: node.id,
      });
    }
  }
}

function validateGroups(
  document: NodeGraphDocument,
  nodesById: Map<string, NodeGraphNode>,
  diagnostics: NodeGraphDiagnostic[],
): void {
  const groupIds = new Set<string>();
  const subgraphMembership = new Map<string, string>();
  for (const group of document.groups ?? []) {
    if (groupIds.has(group.id)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_duplicate_group_id',
        message: `Duplicate group id '${group.id}'.`,
        groupId: group.id,
      });
    }
    groupIds.add(group.id);

    for (const nodeId of group.nodeIds) {
      if (!nodesById.has(nodeId)) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_group_node_missing',
          message: `Group '${group.id}' references missing node '${nodeId}'.`,
          groupId: group.id,
        });
      } else if (group.kind === 'subgraph') {
        const previousGroupId = subgraphMembership.get(nodeId);
        if (previousGroupId) {
          add(diagnostics, {
            severity: 'error',
            code: 'node_graph_subgraph_node_multiple_groups',
            message: `Node '${nodeId}' belongs to multiple subgraph groups: '${previousGroupId}' and '${group.id}'.`,
            nodeId,
            groupId: group.id,
          });
        }
        subgraphMembership.set(nodeId, group.id);
      }
    }

    for (const port of [...(group.inputPorts ?? []), ...(group.outputPorts ?? [])]) {
      if (!isKnownPortType(port.type)) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_group_port_type_unknown',
          message: `Group '${group.id}' declares unknown port type '${port.type}'.`,
          groupId: group.id,
          port: port.name,
        });
      }
    }

    if (group.kind === 'subgraph') {
      const groupNodes = group.nodeIds.map((nodeId) => nodesById.get(nodeId)).filter((node): node is NodeGraphNode => !!node);
      if ((group.inputPorts?.length ?? 0) > 0 && !groupNodes.some((node) => node.type === 'group.input')) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_subgraph_input_boundary_missing',
          message: `Subgraph group '${group.id}' declares input ports but contains no group.input node.`,
          groupId: group.id,
        });
      }
      if ((group.outputPorts?.length ?? 0) > 0 && !groupNodes.some((node) => node.type === 'group.output')) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_subgraph_output_boundary_missing',
          message: `Subgraph group '${group.id}' declares output ports but contains no group.output node.`,
          groupId: group.id,
        });
      }
    }
  }
}

const NODE_SCOPE_SET = new Set<NodeGraphNodeScope>(NODE_GRAPH_NODE_SCOPES);
const CHECKPOINT_POLICY_SET = new Set<NodeGraphCheckpointPolicy>(NODE_GRAPH_CHECKPOINT_POLICIES);
const ON_SKIP_SET = new Set<string>(NODE_GRAPH_ON_SKIP_BEHAVIORS);
const RESPONSE_AND_LATER_PHASES = new Set<NodeGraphPhase>(['response', 'post_response', 'commit']);

/** NG2-CORE：scope / checkpointPolicy 取值与 phase 一致性校验。 */
function validateNodeScopes(document: NodeGraphDocument, diagnostics: NodeGraphDiagnostic[]): void {
  for (const node of document.nodes) {
    if (node.scope !== undefined && !NODE_SCOPE_SET.has(node.scope)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_node_scope_unknown',
        message: `Node '${node.id}' declares unknown scope '${String(node.scope)}'.`,
        nodeId: node.id,
      });
    }
    if (node.checkpointPolicy !== undefined && !CHECKPOINT_POLICY_SET.has(node.checkpointPolicy)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_checkpoint_policy_unknown',
        message: `Node '${node.id}' declares unknown checkpointPolicy '${String(node.checkpointPolicy)}'.`,
        nodeId: node.id,
      });
    }
    if (
      (node.scope === 'floor_stable' || node.scope === 'pre_response_deterministic')
      && RESPONSE_AND_LATER_PHASES.has(node.phase)
    ) {
      add(diagnostics, {
        severity: 'warning',
        code: 'node_graph_scope_phase_conflict',
        message: `Node '${node.id}' declares floor-scoped '${node.scope}' but runs in page-scoped phase '${node.phase}'; it will not be floor-checkpointed.`,
        nodeId: node.id,
      });
    }
  }
}

function isAncestorNode(
  fromId: string,
  toId: string,
  outgoingEdgesByNodeId: Map<string, NodeGraphEdge[]>,
): boolean {
  const visited = new Set<string>([fromId]);
  const queue: string[] = [fromId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of outgoingEdgesByNodeId.get(current) ?? []) {
      const next = edge.to.nodeId;
      if (next === toId) {
        return true;
      }
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** NG2-CORE：控制流节点（condition/branch/gate）的条件、来源引用与 onSkip 校验。 */
function validateControlNodes(
  document: NodeGraphDocument,
  nodesById: Map<string, NodeGraphNode>,
  schemaVersion: number,
  incomingEdgesByNodeId: Map<string, NodeGraphEdge[]>,
  outgoingEdgesByNodeId: Map<string, NodeGraphEdge[]>,
  diagnostics: NodeGraphDiagnostic[],
): void {
  for (const node of document.nodes) {
    if (!isNodeGraphControlNodeType(node.type)) {
      continue;
    }
    if (schemaVersion < NODE_GRAPH_SCHEMA_VERSION_V2) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_control_node_unsupported',
        message: `Control node '${node.id}' (${node.type}) requires NodeGraph schemaVersion >= 2.`,
        nodeId: node.id,
      });
      continue;
    }

    const config = isRecord(node.config) ? node.config : {};
    const condition = config.condition;
    const incoming = incomingEdgesByNodeId.get(node.id) ?? [];
    const hasConditionInput = incoming.some(
      (edge) => nodeGraphEdgeKind(edge) === 'data' && edge.to.port === 'condition',
    );

    if (node.type === 'control.condition') {
      if (condition === undefined) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_control_condition_missing',
          message: `Condition node '${node.id}' requires a structured config.condition.`,
          nodeId: node.id,
        });
      }
    } else if (condition === undefined && !hasConditionInput) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_control_condition_missing',
        message: `Control node '${node.id}' requires either config.condition or a boolean 'condition' input edge.`,
        nodeId: node.id,
      });
    }

    if (condition !== undefined) {
      const issues = validateNodeGraphConditionExpr(condition);
      for (const issue of issues) {
        add(diagnostics, {
          severity: 'error',
          code: issue.code === 'condition_too_deep'
            ? 'node_graph_condition_too_deep'
            : issue.code === 'condition_too_many_items'
              ? 'node_graph_condition_too_many_items'
              : 'node_graph_condition_invalid',
          message: `Node '${node.id}': ${issue.message}`,
          nodeId: node.id,
        });
      }
      if (issues.length === 0) {
        for (const ref of collectNodeGraphConditionValueRefs(condition as NodeGraphConditionExpr)) {
          if (ref.source !== 'node_output') {
            continue;
          }
          const targetId = ref.path[0];
          if (!targetId || !nodesById.has(targetId)) {
            add(diagnostics, {
              severity: 'error',
              code: 'node_graph_condition_node_output_missing',
              message: `Condition on node '${node.id}' references unknown node output '${String(targetId)}'.`,
              nodeId: node.id,
            });
          } else if (targetId === node.id || !isAncestorNode(targetId, node.id, outgoingEdgesByNodeId)) {
            add(diagnostics, {
              severity: 'error',
              code: 'node_graph_condition_node_output_not_upstream',
              message: `Condition on node '${node.id}' references node output '${targetId}' that is not an upstream ancestor.`,
              nodeId: node.id,
            });
          }
        }
      }
    }

    if (node.type === 'control.gate' && config.onSkip !== undefined) {
      if (typeof config.onSkip !== 'string' || !ON_SKIP_SET.has(config.onSkip)) {
        add(diagnostics, {
          severity: 'error',
          code: 'node_graph_control_gate_on_skip_unknown',
          message: `Gate node '${node.id}' declares unknown onSkip '${String(config.onSkip)}'.`,
          nodeId: node.id,
        });
      }
    }
  }
}

/** NG2-β：`group.node`（NodeGroup 实例）配置校验：子图引用 + 反规范化接口缓存。 */
function validateGroupNodes(document: NodeGraphDocument, diagnostics: NodeGraphDiagnostic[]): void {
  for (const node of document.nodes) {
    if (!isNodeGraphGroupNodeType(node.type)) {
      continue;
    }
    if (!readGroupNodeRef(node)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_group_node_ref_missing',
        message: `Node group '${node.id}' requires config.ref.graphId pointing to a subgraph definition.`,
        nodeId: node.id,
      });
    }
    const config = isRecord(node.config) ? node.config : {};
    if (config.interface === undefined) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_group_node_interface_missing',
        message: `Node group '${node.id}' requires a config.interface { inputs, outputs } cached from its subgraph boundary.`,
        nodeId: node.id,
      });
    } else if (!readGroupNodeInterface(node)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_group_node_interface_invalid',
        message: `Node group '${node.id}' has a malformed config.interface; inputs/outputs must be arrays of { name, type } with known port types.`,
        nodeId: node.id,
      });
    }
  }
}

/** NG2-CORE：system graph 严格校验（metadata.systemGraph === true 时）。 */
function validateSystemGraph(document: NodeGraphDocument, diagnostics: NodeGraphDiagnostic[]): void {
  if (document.metadata?.systemGraph !== true) {
    return;
  }
  const narrators = document.nodes.filter((node) => node.type === 'narration.narrator');
  const commitGates = document.nodes.filter((node) => node.type === 'output.commit_gate');
  const composers = document.nodes.filter((node) => node.type === 'compose.final_messages');

  if (narrators.length === 0) {
    add(diagnostics, {
      severity: 'error',
      code: 'node_graph_system_graph_narrator_required',
      message: 'System graph must contain a narration.narrator node.',
    });
  } else if (narrators.length > 1) {
    add(diagnostics, {
      severity: 'error',
      code: 'node_graph_system_graph_narrator_not_unique',
      message: `System graph must contain exactly one narration.narrator node, found ${narrators.length}.`,
    });
  }

  if (commitGates.length === 0) {
    add(diagnostics, {
      severity: 'error',
      code: 'node_graph_system_graph_commit_gate_required',
      message: 'System graph must contain an output.commit_gate node.',
    });
  } else if (commitGates.length > 1) {
    add(diagnostics, {
      severity: 'error',
      code: 'node_graph_system_graph_commit_gate_not_unique',
      message: `System graph must contain exactly one output.commit_gate node, found ${commitGates.length}.`,
    });
  }

  if (composers.length === 0) {
    add(diagnostics, {
      severity: 'error',
      code: 'node_graph_system_graph_compose_required',
      message: 'System graph must contain a compose.final_messages node.',
    });
  }
}

export function validateNodeGraph(
  document: NodeGraphDocument,
  options: NodeGraphValidationOptions = {},
): NodeGraphValidationResult {
  const registry = options.registry ?? createDefaultNodeTypeRegistry();
  const diagnostics: NodeGraphDiagnostic[] = [];

  const schemaVersion = nodeGraphDocumentSchemaVersion(document);
  if (!(NODE_GRAPH_SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(schemaVersion)) {
    add(diagnostics, {
      severity: 'error',
      code: 'node_graph_schema_version_unsupported',
      message: `Unsupported NodeGraph schema version '${String(document.schemaVersion)}'.`,
      path: ['schemaVersion'],
    });
  }
  if (document.mode !== 'native_graph') {
    add(diagnostics, {
      severity: 'error',
      code: 'node_graph_mode_unsupported',
      message: `Unsupported NodeGraph mode '${document.mode}'.`,
      path: ['mode'],
    });
  }

  const { incomingEdgesByNodeId, outgoingEdgesByNodeId } = buildEdgeMaps(document.edges);
  const nodesById = validateNodeShape(document, diagnostics);
  const entriesByNodeId = validateRegistryContracts(document, registry, options.availablePermissions, diagnostics);
  validateEdges(document, nodesById, entriesByNodeId, schemaVersion, diagnostics);
  validatePolicies(document, entriesByNodeId, diagnostics);
  validateNodeScopes(document, diagnostics);
  validateControlNodes(document, nodesById, schemaVersion, incomingEdgesByNodeId, outgoingEdgesByNodeId, diagnostics);
  validateGroupNodes(document, diagnostics);
  validateSystemGraph(document, diagnostics);
  validateGroups(document, nodesById, diagnostics);

  const topologicalLevels = collectTopologicalLevels(document.nodes, document.edges, diagnostics);

  return {
    diagnostics,
    nodesById,
    incomingEdgesByNodeId,
    outgoingEdgesByNodeId,
    topologicalLevels,
    isValid: !hasNodeGraphErrors(diagnostics),
  };
}
