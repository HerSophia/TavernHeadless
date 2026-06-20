import type { NodeGraphEdge, NodeGraphEdgeKind } from './types.js';

/**
 * NG2-CORE：控制流节点最小集合（B9-DESIGN 3.2）。
 *
 * - `control.condition`：纯谓词，算出 boolean（通过 data edge 流向 branch/gate）。
 * - `control.branch`：true/false 路由（控制端口 `true` / `false`）。
 * - `control.gate`：带 onSkip 的门控（控制端口 `open`）。
 */
export const NODE_GRAPH_CONTROL_NODE_TYPES = [
  'control.condition',
  'control.branch',
  'control.gate',
] as const;

export type NodeGraphControlNodeType = (typeof NODE_GRAPH_CONTROL_NODE_TYPES)[number];

/** 每类控制流节点对外暴露的**控制输出端口**（control edge 只能从这些端口出发）。 */
export const NODE_GRAPH_CONTROL_OUTPUT_PORTS: Record<NodeGraphControlNodeType, readonly string[]> = {
  'control.condition': [],
  'control.branch': ['true', 'false'],
  'control.gate': ['open'],
};

export type NodeGraphOnSkipBehavior = 'empty_output' | 'use_cached' | 'use_default' | 'error';

export const NODE_GRAPH_ON_SKIP_BEHAVIORS = [
  'empty_output',
  'use_cached',
  'use_default',
  'error',
] as const;

export const DEFAULT_NODE_GRAPH_ON_SKIP: NodeGraphOnSkipBehavior = 'empty_output';

export function isNodeGraphControlNodeType(type: string): type is NodeGraphControlNodeType {
  return (NODE_GRAPH_CONTROL_NODE_TYPES as readonly string[]).includes(type);
}

/** 归一化 edge.kind：缺省视为 `data`（v1 兼容）。 */
export function nodeGraphEdgeKind(edge: Pick<NodeGraphEdge, 'kind'>): NodeGraphEdgeKind {
  return edge.kind === 'control' ? 'control' : 'data';
}

export function isNodeGraphControlEdge(edge: Pick<NodeGraphEdge, 'kind'>): boolean {
  return nodeGraphEdgeKind(edge) === 'control';
}

/** 某控制流节点类型的合法控制输出端口集合（非控制节点返回空）。 */
export function nodeGraphControlOutputPorts(type: string): readonly string[] {
  return isNodeGraphControlNodeType(type) ? NODE_GRAPH_CONTROL_OUTPUT_PORTS[type] : [];
}

/** 控制流节点运行时产出的控制信号：哪些控制端口处于 active。 */
export interface NodeGraphControlSignal {
  activePorts: string[];
}

/**
 * 由控制流节点的 boolean 判定结果计算控制信号。
 *
 * - branch：true → `['true']`；false → `['false']`。
 * - gate：true → `['open']`；false → `[]`（关闭）。
 * - condition：无控制端口，始终空（它只产出 data boolean）。
 */
export function computeNodeGraphControlSignal(type: string, result: boolean): NodeGraphControlSignal {
  switch (type) {
    case 'control.branch':
      return { activePorts: result ? ['true'] : ['false'] };
    case 'control.gate':
      return { activePorts: result ? ['open'] : [] };
    default:
      return { activePorts: [] };
  }
}

export interface NodeGraphControlActivationInput {
  /** 目标节点的 incoming control edges。 */
  incomingControlEdges: readonly NodeGraphEdge[];
  /** 各控制流节点本次运行产出的控制信号（按 nodeId）。 */
  signalsByNodeId: ReadonlyMap<string, NodeGraphControlSignal>;
  /** 本次被跳过 / 未运行的节点（其控制端口视为全部 inactive）。 */
  skippedNodeIds: ReadonlySet<string>;
  /** gate 节点声明的 onSkip（按 nodeId）。 */
  onSkipByNodeId: ReadonlyMap<string, NodeGraphOnSkipBehavior>;
}

export interface NodeGraphControlActivation {
  /** 目标节点是否被控制边门控（有 incoming control edge）。 */
  gated: boolean;
  /** 目标节点本次是否应运行。 */
  active: boolean;
  /** 若 inactive，跳过行为（来自门控它的 gate；缺省 empty_output）。 */
  onSkip: NodeGraphOnSkipBehavior;
}

/**
 * 解析目标节点的控制门控（B9-DESIGN 3.2.3）。
 *
 * - 无 incoming control edge → 正常运行。
 * - 有 → 当且仅当任一 incoming control edge 处于 active 时运行（OR 可达）。
 * - 全部 inactive → 被门控关闭，onSkip 取首个 inactive gate 控制源的策略。
 */
export function resolveNodeGraphControlActivation(
  input: NodeGraphControlActivationInput,
): NodeGraphControlActivation {
  const edges = [...input.incomingControlEdges].sort((left, right) => left.id.localeCompare(right.id));
  if (edges.length === 0) {
    return { gated: false, active: true, onSkip: DEFAULT_NODE_GRAPH_ON_SKIP };
  }

  let active = false;
  for (const edge of edges) {
    const sourceId = edge.from.nodeId;
    if (input.skippedNodeIds.has(sourceId)) {
      continue;
    }
    const signal = input.signalsByNodeId.get(sourceId);
    if (signal && signal.activePorts.includes(edge.from.port)) {
      active = true;
      break;
    }
  }

  let onSkip: NodeGraphOnSkipBehavior = DEFAULT_NODE_GRAPH_ON_SKIP;
  if (!active) {
    for (const edge of edges) {
      const gateSkip = input.onSkipByNodeId.get(edge.from.nodeId);
      if (gateSkip) {
        onSkip = gateSkip;
        break;
      }
    }
  }

  return { gated: true, active, onSkip };
}
