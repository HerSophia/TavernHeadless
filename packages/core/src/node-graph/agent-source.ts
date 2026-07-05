import type { NodeGraphNode } from './types.js';

/**
 * NG2-7：Agent 承载节点的「执行来源二选一」核心契约（只落 core，不接运行）。
 *
 * 见 `.limcode/design/nodegraph-ng2-7-agent-source-mutual-exclusion-design.md`：
 *
 * 一个 Agent 承载节点（本任务为 `narration.narrator`）要么承载**一份酒馆预设**（走传统
 * `assemblePrompt` / compat 链路），要么承载**一张子图**（走 `subgraphRunner` 图链路），
 * 二者互斥、不可同时。`source` 字段可选：缺省时按内容推断，保证既有图零回归。
 *
 * 本模块只提供**纯结构读取 + 有效来源推断**（无 DB 依赖，可进浏览器子路径）。
 * 引用有效性（preset / subgraph 是否真实存在、属当前 account、是否成环）不在此校验，
 * 交后端解析时校验（NG2-8 / NG2-9）。运行分派同样不在本任务，留给 NG2-8 / NG2-9。
 * validator 用它做互斥/结构校验；将来运行分派、前端二选一编辑与导入器都复用这一份判定，
 * 避免多处漂移。
 */

/** 承载来源的两种取值：承载预设 or 承载子图。 */
export const NODE_GRAPH_AGENT_SOURCES = ['preset', 'subgraph'] as const;

/** 承载来源类型。 */
export type NodeGraphAgentSource = (typeof NODE_GRAPH_AGENT_SOURCES)[number];

/** 预设承载引用（指向一份酒馆预设 + 可选锁定版本）。 */
export interface NodeGraphPresetRef {
  presetId: string;
  presetVersionId: string | null;
}

/** 子图承载引用（指向一份持久化子图定义 + 可选锁定版本）。 */
export interface NodeGraphSubgraphRef {
  graphId: string;
  versionId: string | null;
}

const AGENT_SOURCE_SET = new Set<string>(NODE_GRAPH_AGENT_SOURCES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 读取承载节点的预设引用（`config.presetRef`）。
 *
 * 纯结构读取：`presetId` 须为非空字符串，`presetVersionId` 须为字符串或 null（缺省/空串归一为
 * `null`）。缺失或结构非法一律返回 `null`（由 validator 报对应诊断）。
 */
export function readNodeGraphPresetRef(node: Pick<NodeGraphNode, 'config'>): NodeGraphPresetRef | null {
  if (!isRecord(node.config) || !isRecord(node.config.presetRef)) {
    return null;
  }
  const presetRef = node.config.presetRef;
  const presetId = presetRef.presetId;
  if (typeof presetId !== 'string' || presetId.length === 0) {
    return null;
  }
  const versionRaw = presetRef.presetVersionId;
  if (versionRaw !== undefined && versionRaw !== null && typeof versionRaw !== 'string') {
    return null;
  }
  return {
    presetId,
    presetVersionId: typeof versionRaw === 'string' && versionRaw.length > 0 ? versionRaw : null,
  };
}

/**
 * 读取承载节点的子图引用（`config.subgraphRef`）。
 *
 * 纯结构读取：`graphId` 须为非空字符串，`versionId` 须为字符串或 null（缺省/空串归一为
 * `null`）。缺失或结构非法一律返回 `null`（由 validator 报对应诊断）。风格与
 * `subgraph.ts` 的 `readGroupNodeRef` 对齐。
 */
export function readNodeGraphSubgraphRef(node: Pick<NodeGraphNode, 'config'>): NodeGraphSubgraphRef | null {
  if (!isRecord(node.config) || !isRecord(node.config.subgraphRef)) {
    return null;
  }
  const subgraphRef = node.config.subgraphRef;
  const graphId = subgraphRef.graphId;
  if (typeof graphId !== 'string' || graphId.length === 0) {
    return null;
  }
  const versionRaw = subgraphRef.versionId;
  if (versionRaw !== undefined && versionRaw !== null && typeof versionRaw !== 'string') {
    return null;
  }
  return {
    graphId,
    versionId: typeof versionRaw === 'string' && versionRaw.length > 0 ? versionRaw : null,
  };
}

/**
 * 推断承载节点的「有效来源」（设计 §3.2 表；不做 DB 校验、不检测冲突）。
 *
 * | `source` | `presetRef` | `subgraphRef` | 有效来源 |
 * | --- | --- | --- | --- |
 * | 缺省 | 无 | 无 | `preset`（回退 session 预设） |
 * | 缺省 | 有 | 无 | `preset` |
 * | 缺省 | 无 | 有 | `subgraph` |
 * | `preset` | 任意 | 无 | `preset` |
 * | `subgraph` | 无 | 有 | `subgraph` |
 *
 * - `source` 显式且合法：直接返回该来源。
 * - `source` 显式但取值非法（不属于 `'preset' | 'subgraph'`）：返回 `null`。
 * - `source` 缺省：有结构有效的 `subgraphRef` → `subgraph`，否则 → `preset`。
 *
 * 冲突组合（同时承载预设与子图 / source 与 ref 矛盾）不在此函数判定，交 validator 报诊断。
 */
export function resolveNodeGraphAgentSource(node: Pick<NodeGraphNode, 'config'>): NodeGraphAgentSource | null {
  const config = isRecord(node.config) ? node.config : {};
  const source = config.source;
  if (source !== undefined) {
    if (typeof source === 'string' && AGENT_SOURCE_SET.has(source)) {
      return source as NodeGraphAgentSource;
    }
    return null;
  }
  if (readNodeGraphSubgraphRef(node)) {
    return 'subgraph';
  }
  return 'preset';
}
