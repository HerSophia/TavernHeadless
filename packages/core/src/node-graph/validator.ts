import { isNodeGraphAnnotationNodeType } from './annotation.js';
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
  // NG2-GLOBAL-INPUT：`any` 为通配类型，与任意端口类型兼容（作为输出可流向任意输入，作为输入可接受任意输出）。
  if (from === to || from === 'any' || to === 'any') {
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
  const runtimeNodes = nodes.filter((node) => !isNodeGraphAnnotationNodeType(node.type));
  const nodesById = new Map(runtimeNodes.map((node) => [node.id, node] as const));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, NodeGraphEdge[]>();
  for (const node of runtimeNodes) {
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
  let ready = [...runtimeNodes]
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

  if (visited.size !== runtimeNodes.length) {
    const cyclicNodeIds = runtimeNodes
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

function validateBudgets(document: NodeGraphDocument, diagnostics: NodeGraphDiagnostic[]): void {
  const budgets = document.budgets;
  if (budgets === undefined) {
    return;
  }
  if (!isRecord(budgets)) {
    add(diagnostics, {
      severity: 'error',
      code: 'node_graph_budget_invalid',
      message: 'NodeGraph budgets must be an object when provided.',
      path: ['budgets'],
    });
    return;
  }

  validatePositiveIntegerBudget(budgets, 'maxNodesExecuted', diagnostics);
  validatePositiveIntegerBudget(budgets, 'maxDepth', diagnostics);
  validatePositiveIntegerBudget(budgets, 'maxFanOut', diagnostics);
  validateNonNegativeIntegerBudget(budgets, 'maxNestedAgentJobs', diagnostics);
  validateNonNegativeIntegerBudget(budgets, 'maxTemporaryConversations', diagnostics);
  validatePositiveIntegerBudget(budgets, 'maxRuntimeDurationMs', diagnostics);
}

function validatePositiveIntegerBudget(
  budgets: Record<string, unknown>,
  key: string,
  diagnostics: NodeGraphDiagnostic[],
): void {
  const value = budgets[key];
  if (value === undefined) {
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) {
    return;
  }
  add(diagnostics, {
    severity: 'error',
    code: 'node_graph_budget_invalid',
    message: `NodeGraph budget '${key}' must be a positive finite integer.`,
    path: ['budgets', key],
  });
}

function validateNonNegativeIntegerBudget(
  budgets: Record<string, unknown>,
  key: string,
  diagnostics: NodeGraphDiagnostic[],
): void {
  const value = budgets[key];
  if (value === undefined) {
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
    return;
  }
  add(diagnostics, {
    severity: 'error',
    code: 'node_graph_budget_invalid',
    message: `NodeGraph budget '${key}' must be a non-negative finite integer.`,
    path: ['budgets', key],
  });
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

/**
 * NG2-GLOBAL-INPUT：编译期广播解析。
 *
 * `source.global_input` 只有一个 `value:any` 输出端口。它的广播目标由显式连线推导：
 * 用户先把 `value` 接到某个输入口（例如 `narrator.user_input:text`），该输入口的
 * 「名称 + 类型」就成为一组广播规格。随后编译器把同一个 `value` 自动连到图中所有
 * 同名、同类型、未连线的输入口，并跳过子图（subgraph）内部节点。
 *
 * 生成的边是编译产物虚拟边（`auto: true`），不写入 document.edges，仅补入编译产物的
 * edge maps 与拓扑层级，使下游节点能在运行时收到值。
 */
function collectGlobalInputBroadcastEdges(
  document: NodeGraphDocument,
  nodesById: Map<string, NodeGraphNode>,
  entriesByNodeId: Map<string, NodeTypeRegistryEntry>,
  outgoingEdgesByNodeId: Map<string, NodeGraphEdge[]>,
): NodeGraphEdge[] {
  // 1. 子图内部成员集合（广播跳过这些节点；group.node 实例本身不在其中，可被广播）。
  const subgraphMemberIds = new Set<string>();
  for (const group of document.groups ?? []) {
    if (group.kind !== 'subgraph') {
      continue;
    }
    for (const nodeId of group.nodeIds) {
      subgraphMemberIds.add(nodeId);
    }
  }

  // 2. 已连线的输入口集合（以 `toNode:toPort` 标记），广播不覆盖已有连线。
  const connectedInputKeys = new Set<string>();
  for (const edge of document.edges) {
    if (nodeGraphEdgeKind(edge) !== 'data') {
      continue;
    }
    connectedInputKeys.add(`${edge.to.nodeId}:${edge.to.port}`);
  }

  // 3. 从 global_input 的显式出边中收集广播规格：目标输入口的 name + type。
  const specs: Array<{ sourceNodeId: string; outputPort: string; inputName: string; inputType: NodeGraphPortType }> = [];
  const seenSpecKeys = new Set<string>();
  for (const node of document.nodes) {
    if (node.type !== 'source.global_input') {
      continue;
    }
    for (const edge of outgoingEdgesByNodeId.get(node.id) ?? []) {
      if (nodeGraphEdgeKind(edge) !== 'data' || edge.from.port !== 'value' || subgraphMemberIds.has(edge.to.nodeId)) {
        continue;
      }
      const target = nodesById.get(edge.to.nodeId);
      const targetEntry = target ? entriesByNodeId.get(target.id) : undefined;
      if (!target || !targetEntry) {
        continue;
      }
      const targetPort = resolveNodeGraphNodePorts(target, targetEntry).inputPorts.find((port) => port.name === edge.to.port);
      if (!targetPort || !arePortTypesCompatible('any', targetPort.type)) {
        continue;
      }
      const specKey = `${node.id}:value:${targetPort.name}:${targetPort.type}`;
      if (seenSpecKeys.has(specKey)) {
        continue;
      }
      specs.push({
        sourceNodeId: node.id,
        outputPort: 'value',
        inputName: targetPort.name,
        inputType: targetPort.type,
      });
      seenSpecKeys.add(specKey);
    }
  }
  if (specs.length === 0) {
    return [];
  }

  const broadcastEdges: NodeGraphEdge[] = [];
  for (const spec of specs) {
    const sourceNode = nodesById.get(spec.sourceNodeId);
    if (!sourceNode) {
      continue;
    }
    for (const node of document.nodes) {
      if (node.id === spec.sourceNodeId || subgraphMemberIds.has(node.id)) {
        continue;
      }
      if (phaseOrder(sourceNode.phase) > phaseOrder(node.phase)) {
        continue;
      }
      const entry = entriesByNodeId.get(node.id);
      if (!entry) {
        continue;
      }
      const inputPorts = resolveNodeGraphNodePorts(node, entry).inputPorts;
      for (const inputPort of inputPorts) {
        if (inputPort.name !== spec.inputName || inputPort.type !== spec.inputType) {
          continue;
        }
        const key = `${node.id}:${inputPort.name}`;
        if (connectedInputKeys.has(key)) {
          continue;
        }
        // 生成虚拟广播边；不写入 document，仅存在于编译产物。
        broadcastEdges.push({
          id: `e_auto_${spec.sourceNodeId}_${node.id}_${inputPort.name}`,
          from: { nodeId: spec.sourceNodeId, port: spec.outputPort },
          to: { nodeId: node.id, port: inputPort.name },
          kind: 'data',
          auto: true,
        });
        // 标记该输入口已被广播覆盖，避免多个广播规格重复连入。
        connectedInputKeys.add(key);
      }
    }
  }
  return broadcastEdges;
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

/**
 * LI11-3（3b）：`narration.narrator` 节点的 `config.presetRef` 结构校验。
 *
 * `presetRef` 可选——节点不带它时配方回退 `session.presetId`（设计 §6.2、§8）。提供时只做
 * **结构校验**：必须是对象，且 `presetId` 为非空字符串；`presetVersionId` 若提供须为字符串或 null。
 * 引用有效性（preset 是否存在 / 属当前 account）不在 core 校验，而在后端解析时校验并阻断
 * （core 无 DB 依赖，保持可进浏览器子路径）。
 */
function validateNarrationNodes(document: NodeGraphDocument, diagnostics: NodeGraphDiagnostic[]): void {
  for (const node of document.nodes) {
    if (node.type !== 'narration.narrator') {
      continue;
    }
    const config = isRecord(node.config) ? node.config : {};
    const presetRef = config.presetRef;
    if (presetRef === undefined) {
      continue;
    }
    if (!isRecord(presetRef)) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_narrator_preset_ref_invalid',
        message: `Narrator node '${node.id}' has a malformed config.presetRef; it must be an object { presetId, presetVersionId? }.`,
        nodeId: node.id,
      });
      continue;
    }
    if (typeof presetRef.presetId !== 'string' || presetRef.presetId.length === 0) {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_narrator_preset_ref_invalid',
        message: `Narrator node '${node.id}' config.presetRef requires a non-empty 'presetId' string.`,
        nodeId: node.id,
      });
    }
    if (presetRef.presetVersionId !== undefined
      && presetRef.presetVersionId !== null
      && typeof presetRef.presetVersionId !== 'string') {
      add(diagnostics, {
        severity: 'error',
        code: 'node_graph_narrator_preset_ref_invalid',
        message: `Narrator node '${node.id}' config.presetRef.presetVersionId must be a string or null when provided.`,
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

  const explicitEdgeMaps = buildEdgeMaps(document.edges);
  const nodesById = validateNodeShape(document, diagnostics);
  const entriesByNodeId = validateRegistryContracts(document, registry, options.availablePermissions, diagnostics);

  // NG2-GLOBAL-INPUT：编译期广播解析。对每个 source.global_input 节点，
  // 从其显式出边推导「目标输入口名称 + 类型」，再自动连到同名同类型未连线输入口。
  // 生成的虚拟边不写入 document.edges，仅补入编译产物（edge maps + 拓扑）。
  // 这里必须早于 validateEdges，保证自动边可以满足 required 输入口与拓扑入度。
  const broadcastEdges = collectGlobalInputBroadcastEdges(
    document,
    nodesById,
    entriesByNodeId,
    explicitEdgeMaps.outgoingEdgesByNodeId,
  );
  const effectiveEdges = broadcastEdges.length > 0 ? [...document.edges, ...broadcastEdges] : document.edges;
  const effectiveDocument = broadcastEdges.length > 0 ? { ...document, edges: effectiveEdges } : document;
  const { incomingEdgesByNodeId, outgoingEdgesByNodeId } = buildEdgeMaps(effectiveEdges);

  validateEdges(effectiveDocument, nodesById, entriesByNodeId, schemaVersion, diagnostics);
  validatePolicies(document, entriesByNodeId, diagnostics);
  validateBudgets(document, diagnostics);
  validateNodeScopes(document, diagnostics);
  validateControlNodes(effectiveDocument, nodesById, schemaVersion, incomingEdgesByNodeId, outgoingEdgesByNodeId, diagnostics);
  validateGroupNodes(document, diagnostics);
  validateNarrationNodes(document, diagnostics);
  validateSystemGraph(document, diagnostics);
  validateGroups(document, nodesById, diagnostics);

  const topologicalLevels = collectTopologicalLevels(document.nodes, effectiveEdges, diagnostics);

  return {
    diagnostics,
    nodesById,
    incomingEdgesByNodeId,
    outgoingEdgesByNodeId,
    topologicalLevels,
    isValid: !hasNodeGraphErrors(diagnostics),
  };
}
