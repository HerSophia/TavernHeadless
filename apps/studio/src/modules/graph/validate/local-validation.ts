/**
 * 本地 NodeGraph 校验（B10 阶段 6，纯函数、可单测）。
 *
 * 复用 `@tavern/core/node-graph` 的 `compileNodeGraph`——与后端
 * `NodeGraphDefinitionService.validate`（其内部即 `compileNodeGraph`）**完全同源**，
 * 杜绝前后端校验漂移：`isExecutable` 与后端 `assertExecutable` 的判定一致
 * （无 `error` 级诊断即可执行 / 可保存为版本，`warning` / `info` 不阻断）。
 *
 * 刻意不传 `availablePermissions`，与后端 `validateDocument(document)` 的调用口径一致。
 */
import {
  compileNodeGraph,
  findNodeGraphPersistentOutputNodeIds,
  NODE_GRAPH_GROUP_INPUT_TYPE,
  NODE_GRAPH_GROUP_OUTPUT_TYPE,
  NODE_GRAPH_SUBGRAPH_PERSISTENT_OUTPUT_FORBIDDEN_CODE,
  type NodeGraphDiagnostic,
  type NodeGraphDocument,
} from "@tavern/core/node-graph";

export type DiagnosticSeverity = NodeGraphDiagnostic["severity"];
export type DiagnosticSource = "local" | "server";

export type SourcedNodeGraphDiagnostic = NodeGraphDiagnostic & {
  /** 诊断来源：本地同步校验或手动服务端校验。 */
  source: DiagnosticSource;
};

export interface LocalValidationResult {
  /** 诊断列表（与后端 validate 同源），并标记为本地来源。 */
  diagnostics: SourcedNodeGraphDiagnostic[];
  /** 无 error 即可执行 / 可保存为版本（对齐后端 assertExecutable）。 */
  isExecutable: boolean;
  /** 各严重级别计数。 */
  counts: Record<DiagnosticSeverity, number>;
  /** 拓扑层级（节点 id），对齐后端 validation summary，供后续可视化复用。 */
  topologicalLevels: string[][];
}

export const EMPTY_LOCAL_VALIDATION: LocalValidationResult = {
  diagnostics: [],
  isExecutable: true,
  counts: { error: 0, warning: 0, info: 0 },
  topologicalLevels: [],
};

export function withDiagnosticSource(
  diagnostics: readonly NodeGraphDiagnostic[],
  source: DiagnosticSource,
): SourcedNodeGraphDiagnostic[] {
  return diagnostics.map((diagnostic) => ({ ...diagnostic, source }));
}

/**
 * NG2-13（缺口 4.5，方案 A）本地预警：一张“子图形态”的图——含 `group.input` / `group.output`
 * 接口节点，因而可被 `group.node` 或 `narration.narrator`（`source='subgraph'`）承载引用——
 * 不得包含持久 `output.*` 写节点。否则运行时 `buildSubgraphRunner` 会以
 * `node_graph_subgraph_persistent_output_forbidden` 拒绝执行（正史写入只能经父图单一 CommitGate）。
 *
 * 后端 `compileNodeGraph` 不含此检查（它是运行时子图引用解析处的执法），故此处在编辑现场前置
 * 一条 warning，避免用户“绑好承载子图、运行才报错”。事实源与后端同源：core
 * `findNodeGraphPersistentOutputNodeIds`（注册表 `sideEffects === 'write'`）。
 *
 * 严重级刻意为 warning、不改 `isExecutable`：该图作为独立顶层图仍可编译，约束只在“被当作承载子图”
 * 时成立，权威拒绝仍由运行时给出；以此保持与后端 `compileNodeGraph` 的 `isExecutable` 同源不漂移。
 */
export function findCarrierSubgraphPersistentOutputDiagnostics(
  document: NodeGraphDocument,
): NodeGraphDiagnostic[] {
  const isSubgraphShaped = document.nodes.some(
    (node) =>
      node.type === NODE_GRAPH_GROUP_INPUT_TYPE || node.type === NODE_GRAPH_GROUP_OUTPUT_TYPE,
  );
  if (!isSubgraphShaped) {
    return [];
  }
  return findNodeGraphPersistentOutputNodeIds(document).map((nodeId) => ({
    severity: "warning",
    code: NODE_GRAPH_SUBGRAPH_PERSISTENT_OUTPUT_FORBIDDEN_CODE,
    message: `Node '${nodeId}' writes persistent output; a subgraph (with group.input/group.output interface) cannot contain persistent output.* nodes. Persistent history writes must happen at the parent graph's CommitGate, not inside a carried subgraph.`,
    nodeId,
  }));
}

/** 同步校验一个文档，返回诊断、可执行性与计数。 */
export function validateGraphDocument(document: NodeGraphDocument): LocalValidationResult {
  const compiled = compileNodeGraph(document);
  // 合并 core 同源诊断与 Studio 本地补充预警（NG2-13 承载子图持久输出）。
  const diagnostics = [
    ...compiled.diagnostics,
    ...findCarrierSubgraphPersistentOutputDiagnostics(document),
  ];
  const counts: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] += 1;
  }
  return {
    diagnostics: withDiagnosticSource(diagnostics, "local"),
    isExecutable: compiled.isExecutable,
    counts,
    topologicalLevels: compiled.topologicalLevels.map((level) => level.map((node) => node.id)),
  };
}

/** 诊断在画布上的定位目标（用于诊断面板 ↔ 画布联动）。 */
export interface DiagnosticTarget {
  nodeId?: string;
  edgeId?: string;
  groupId?: string;
}

/** 从一条诊断解析出可定位的画布目标（无目标则返回 null，如图级 schema/mode 错误）。 */
export function diagnosticTarget(diagnostic: NodeGraphDiagnostic): DiagnosticTarget | null {
  if (diagnostic.nodeId) {
    return { nodeId: diagnostic.nodeId };
  }
  if (diagnostic.edgeId) {
    return { edgeId: diagnostic.edgeId };
  }
  if (diagnostic.groupId) {
    return { groupId: diagnostic.groupId };
  }
  return null;
}

/** 诊断稳定排序：error → warning → info，再按 code 与目标，保证面板渲染顺序确定。 */
const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

export function sortDiagnostics<T extends NodeGraphDiagnostic>(diagnostics: readonly T[]): T[] {
  return [...diagnostics].sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byCode = left.code.localeCompare(right.code);
    if (byCode !== 0) {
      return byCode;
    }
    const leftTarget = left.nodeId ?? left.edgeId ?? left.groupId ?? "";
    const rightTarget = right.nodeId ?? right.edgeId ?? right.groupId ?? "";
    return leftTarget.localeCompare(rightTarget);
  });
}
