import { createDefaultNodeTypeRegistry } from './registry.js';
import { NODE_GRAPH_PORT_TYPES, type NodeGraphDocument, type NodeGraphNode, type NodeGraphPortDefinition, type NodeGraphPortType } from './types.js';

/**
 * NodeGroup（节点组）/ 子图（subgraph）核心助手（方案 β）。
 *
 * 见 `.limcode/design/agentic-batch10-nodegroup-subgraph-v1-design.md`：
 *
 * - **子图定义**：一份持久化的 NodeGraph 定义，其对外接口由内部的 `group.input` / `group.output`
 *   边界节点声明（约定 `config = { portName, portType, required? }`）。
 * - **`group.node`**：在父图里实例化一个子图（Blender 式可复用节点）。其端口不来自注册表静态
 *   声明，而来自 `config.interface`（绑定子图时从子图边界**反规范化缓存**而来），使核心 validator
 *   / 画布 / ELK 能在**同步、单文档**下解析其端口而无需拉取远端子图。
 */

/** `group.node`（NodeGroup 实例）节点类型 id。 */
export const NODE_GRAPH_GROUP_NODE_TYPE = 'group.node' as const;

/** 子图边界节点类型 id。 */
export const NODE_GRAPH_GROUP_INPUT_TYPE = 'group.input' as const;
export const NODE_GRAPH_GROUP_OUTPUT_TYPE = 'group.output' as const;

export function isNodeGraphGroupNodeType(type: string): boolean {
  return type === NODE_GRAPH_GROUP_NODE_TYPE;
}

/**
 * 节点组「开关」的三态显示状态，由其成员节点的 `enabled` 派生：
 * - `on`：全部成员启用（或空组）；
 * - `off`：全部成员禁用；
 * - `mixed`：部分启用部分禁用（成员被单独开关过）。
 *
 * 这是组开关 UI 的权威来源（即便用户单独切换了某个成员，也能如实反映为 `mixed`）。
 */
export type NodeGraphGroupSwitchState = 'on' | 'off' | 'mixed';

export function groupSwitchState(members: ReadonlyArray<Pick<NodeGraphNode, 'enabled'>>): NodeGraphGroupSwitchState {
  let enabledCount = 0;
  let disabledCount = 0;
  for (const member of members) {
    if (member.enabled === false) {
      disabledCount += 1;
    } else {
      enabledCount += 1;
    }
  }
  if (disabledCount === 0) {
    return 'on';
  }
  if (enabledCount === 0) {
    return 'off';
  }
  return 'mixed';
}

/** `group.node` 引用（指向一份持久化子图定义 + 可选锁定版本）。 */
export interface NodeGraphGroupNodeRef {
  graphId: string;
  versionId?: string;
}

/** `group.node` 的反规范化接口缓存（绑定子图时拷贝其边界端口）。 */
export interface NodeGraphSubgraphInterface {
  inputs: NodeGraphPortDefinition[];
  outputs: NodeGraphPortDefinition[];
}

const PORT_TYPE_SET = new Set<string>(NODE_GRAPH_PORT_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPortDefinition(value: unknown): NodeGraphPortDefinition | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = value.name;
  const type = value.type;
  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }
  if (typeof type !== 'string' || !PORT_TYPE_SET.has(type)) {
    return null;
  }
  const port: NodeGraphPortDefinition = { name, type: type as NodeGraphPortType };
  if (value.required === true) {
    port.required = true;
  }
  if (value.multiple === true) {
    port.multiple = true;
  }
  if (value.variadic === true) {
    port.variadic = true;
  }
  return port;
}

function readPortList(value: unknown): NodeGraphPortDefinition[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ports: NodeGraphPortDefinition[] = [];
  for (const item of value) {
    const port = readPortDefinition(item);
    if (!port) {
      return null;
    }
    ports.push(port);
  }
  return ports;
}

/**
 * 读取 `group.node` 的接口缓存（`config.interface`）。
 * 返回 null 表示缺失或结构非法（由 validator 报对应诊断）。
 */
export function readGroupNodeInterface(node: Pick<NodeGraphNode, 'config'>): NodeGraphSubgraphInterface | null {
  if (!isRecord(node.config) || !isRecord(node.config.interface)) {
    return null;
  }
  const inputs = readPortList(node.config.interface.inputs);
  const outputs = readPortList(node.config.interface.outputs);
  if (!inputs || !outputs) {
    return null;
  }
  return { inputs, outputs };
}

/** 读取 `group.node` 的子图引用（`config.ref`）。返回 null 表示缺失或非法。 */
export function readGroupNodeRef(node: Pick<NodeGraphNode, 'config'>): NodeGraphGroupNodeRef | null {
  if (!isRecord(node.config) || !isRecord(node.config.ref)) {
    return null;
  }
  const graphId = node.config.ref.graphId;
  if (typeof graphId !== 'string' || graphId.length === 0) {
    return null;
  }
  const ref: NodeGraphGroupNodeRef = { graphId };
  if (typeof node.config.ref.versionId === 'string' && node.config.ref.versionId.length > 0) {
    ref.versionId = node.config.ref.versionId;
  }
  return ref;
}

/**
 * 读取边界节点 `config.ports`（**多端口**，仿 Blender 单 Group Input/Output 多插槽）。
 * 返回有效端口列表（过滤非法项）；无 `config.ports` 时返回空。
 */
function boundaryPortList(node: Pick<NodeGraphNode, 'config'>): NodeGraphPortDefinition[] {
  if (!isRecord(node.config) || !Array.isArray(node.config.ports)) {
    return [];
  }
  const ports: NodeGraphPortDefinition[] = [];
  for (const item of node.config.ports) {
    const port = readPortDefinition(item);
    if (port) {
      ports.push(port);
    }
  }
  return ports;
}

/** 读取边界节点（group.input / group.output）声明的对外端口（旧式单端口 `config = {portName, portType, required?}`）。 */
function readBoundaryPort(node: NodeGraphNode): NodeGraphPortDefinition | null {
  const config = node.config;
  if (!isRecord(config)) {
    return null;
  }
  const portName = config.portName;
  const portType = config.portType;
  if (typeof portName !== 'string' || portName.length === 0) {
    return null;
  }
  if (typeof portType !== 'string' || !PORT_TYPE_SET.has(portType)) {
    return null;
  }
  const port: NodeGraphPortDefinition = { name: portName, type: portType as NodeGraphPortType };
  if (config.required === true) {
    port.required = true;
  }
  return port;
}

/**
 * 由一份子图文档推导其对外接口：扫描 `group.input` / `group.output` 边界节点的 config。
 * 这是「绑定子图 → 写入 `group.node.config.interface`」的来源。
 */
export function deriveSubgraphInterface(document: Pick<NodeGraphDocument, 'nodes'>): NodeGraphSubgraphInterface {
  const inputs: NodeGraphPortDefinition[] = [];
  const outputs: NodeGraphPortDefinition[] = [];
  for (const node of document.nodes) {
    if (node.type === NODE_GRAPH_GROUP_INPUT_TYPE) {
      const ports = boundaryPortList(node);
      if (ports.length > 0) {
        inputs.push(...ports);
      } else {
        const port = readBoundaryPort(node);
        if (port) {
          inputs.push(port);
        }
      }
    } else if (node.type === NODE_GRAPH_GROUP_OUTPUT_TYPE) {
      const ports = boundaryPortList(node);
      if (ports.length > 0) {
        outputs.push(...ports);
      } else {
        const port = readBoundaryPort(node);
        if (port) {
          outputs.push(port);
        }
      }
    }
  }
  return { inputs, outputs };
}

/** 读取边界节点 config.portType（缺省 json），用于其内部 `value` 端口的类型。 */
function boundaryPortType(node: Pick<NodeGraphNode, 'config'>): NodeGraphPortType {
  if (isRecord(node.config) && typeof node.config.portType === 'string' && PORT_TYPE_SET.has(node.config.portType)) {
    return node.config.portType as NodeGraphPortType;
  }
  return 'json';
}

/**
 * 解析某节点用于**连线校验/渲染**的端口：
 * - `group.node` → 取 `config.interface`（动态）；
 * - `group.input` / `group.output` → 内部 `value` 端口类型取 `config.portType`（缺省 json），
 *   使「外部数据 → 边界 → 内部具体类型端口」的连线能通过类型校验；
 * - 其余 → 取注册表静态端口（由调用方传入）。
 */
export function resolveNodeGraphNodePorts(
  node: Pick<NodeGraphNode, 'type' | 'config'>,
  registryPorts: { inputPorts: readonly NodeGraphPortDefinition[]; outputPorts: readonly NodeGraphPortDefinition[] } | undefined,
): { inputPorts: readonly NodeGraphPortDefinition[]; outputPorts: readonly NodeGraphPortDefinition[] } {
  if (isNodeGraphGroupNodeType(node.type)) {
    const iface = readGroupNodeInterface(node);
    return { inputPorts: iface?.inputs ?? [], outputPorts: iface?.outputs ?? [] };
  }
  if (node.type === NODE_GRAPH_GROUP_INPUT_TYPE) {
    const ports = boundaryPortList(node);
    return { inputPorts: [], outputPorts: ports.length > 0 ? ports : [{ name: 'value', type: boundaryPortType(node) }] };
  }
  if (node.type === NODE_GRAPH_GROUP_OUTPUT_TYPE) {
    const ports = boundaryPortList(node);
    return { inputPorts: ports.length > 0 ? ports : [{ name: 'value', type: boundaryPortType(node) }], outputPorts: [] };
  }
  return {
    inputPorts: registryPorts?.inputPorts ?? [],
    outputPorts: registryPorts?.outputPorts ?? [],
  };
}

/**
 * NG2-13（缺口 4.5，方案 A）：诊断码 —— 被 `group.node` 引用的子图内部含持久 `output.*` 写节点。
 *
 * 持久正史写入只能发生在**主图（父图）**的单一 CommitGate 边界，不能从子图内部旁路。
 * 违反不变量「CommitGate 单一正史边界」，因此在子图引用解析处静态拒绝 + 运行时兜底拒绝。
 */
export const NODE_GRAPH_SUBGRAPH_PERSISTENT_OUTPUT_FORBIDDEN_CODE =
  'node_graph_subgraph_persistent_output_forbidden' as const;

/**
 * 持久输出（写正史）节点类型集合。**事实源为节点注册表**：`sideEffects === 'write'`
 * 的内置节点即持久写节点（当前为 `output.session_state_proposal` / `output.derived_output`
 * / `output.project_inbox`）。以类型（而非 typeVersion）匹配，跨版本稳健，避免在多处硬编码列表。
 */
let cachedPersistentOutputNodeTypes: ReadonlySet<string> | null = null;

function persistentOutputNodeTypes(): ReadonlySet<string> {
  if (!cachedPersistentOutputNodeTypes) {
    const registry = createDefaultNodeTypeRegistry();
    cachedPersistentOutputNodeTypes = new Set(
      registry
        .list()
        .filter((entry) => entry.sideEffects === 'write')
        .map((entry) => entry.type),
    );
  }
  return cachedPersistentOutputNodeTypes;
}

/** 某节点类型是否为持久输出（写正史）节点（事实源：注册表 `sideEffects === 'write'`）。 */
export function isNodeGraphPersistentOutputNodeType(type: string): boolean {
  return persistentOutputNodeTypes().has(type);
}

/**
 * 扫描一份（子图）文档，返回其中所有持久输出写节点的 id。
 *
 * NG2-13 方案 A：`group.node` 引用的子图不得包含这些节点。返回非空即应拒绝该图作为子图运行。
 */
export function findNodeGraphPersistentOutputNodeIds(
  document: Pick<NodeGraphDocument, 'nodes'>,
): string[] {
  const writeTypes = persistentOutputNodeTypes();
  return document.nodes.filter((node) => writeTypes.has(node.type)).map((node) => node.id);
}
