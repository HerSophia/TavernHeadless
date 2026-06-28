/**
 * 节点组「接口（Interface）」编辑纯逻辑（仿 Blender 节点组的 Inputs/Outputs 面板）。
 *
 * 作用对象：`group.node` 的 `config.interface = { inputs, outputs }`（实例对外端口）。
 * 全部为纯函数（不可变更新），供右侧检查器面板 CRUD 调用并易于单测。
 */
import {
  NODE_GRAPH_PORT_TYPES,
  type NodeGraphPortDefinition,
  type NodeGraphPortType,
} from "@tavern/core/node-graph";

export type PortDirection = "inputs" | "outputs";

export interface SubgraphInterface {
  inputs: NodeGraphPortDefinition[];
  outputs: NodeGraphPortDefinition[];
}

export const PORT_TYPE_OPTIONS: readonly NodeGraphPortType[] = NODE_GRAPH_PORT_TYPES;

const PORT_TYPE_SET = new Set<string>(NODE_GRAPH_PORT_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPort(value: unknown): NodeGraphPortDefinition | null {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) {
    return null;
  }
  const type = typeof value.type === "string" && PORT_TYPE_SET.has(value.type)
    ? (value.type as NodeGraphPortType)
    : "json";
  const port: NodeGraphPortDefinition = { name: value.name, type };
  if (value.required === true) {
    port.required = true;
  }
  if (value.multiple === true) {
    port.multiple = true;
  }
  return port;
}

function readPortList(value: unknown): NodeGraphPortDefinition[] {
  return Array.isArray(value)
    ? value.map(readPort).filter((port): port is NodeGraphPortDefinition => port !== null)
    : [];
}

export function emptyInterface(): SubgraphInterface {
  return { inputs: [], outputs: [] };
}

/** 从节点 config 读取 interface（容错；缺失/非法返回空）。 */
export function readInterface(config: unknown): SubgraphInterface {
  const root = isRecord(config) ? config : {};
  const iface = isRecord(root.interface) ? root.interface : {};
  return { inputs: readPortList(iface.inputs), outputs: readPortList(iface.outputs) };
}

/** 把编辑后的 interface 合并回 config（保留 ref 等其它字段）。 */
export function writeInterface(config: unknown, next: SubgraphInterface): Record<string, unknown> {
  const root = isRecord(config) ? { ...config } : {};
  root.interface = { inputs: next.inputs, outputs: next.outputs };
  return root;
}

function uniquePortName(existing: readonly NodeGraphPortDefinition[], dir: PortDirection): string {
  const taken = new Set(existing.map((port) => port.name));
  const prefix = dir === "inputs" ? "in" : "out";
  let index = existing.length + 1;
  let candidate = `${prefix}_${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${prefix}_${index}`;
  }
  return candidate;
}

export function addPort(
  iface: SubgraphInterface,
  dir: PortDirection,
  type: NodeGraphPortType = "json",
): SubgraphInterface {
  const port: NodeGraphPortDefinition = { name: uniquePortName(iface[dir], dir), type };
  return { ...iface, [dir]: [...iface[dir], port] };
}

export function removePort(iface: SubgraphInterface, dir: PortDirection, index: number): SubgraphInterface {
  return { ...iface, [dir]: iface[dir].filter((_, i) => i !== index) };
}

export function renamePort(
  iface: SubgraphInterface,
  dir: PortDirection,
  index: number,
  name: string,
): SubgraphInterface {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return iface;
  }
  return {
    ...iface,
    [dir]: iface[dir].map((port, i) => (i === index ? { ...port, name: trimmed } : port)),
  };
}

export function retypePort(
  iface: SubgraphInterface,
  dir: PortDirection,
  index: number,
  type: NodeGraphPortType,
): SubgraphInterface {
  return {
    ...iface,
    [dir]: iface[dir].map((port, i) => (i === index ? { ...port, type } : port)),
  };
}
