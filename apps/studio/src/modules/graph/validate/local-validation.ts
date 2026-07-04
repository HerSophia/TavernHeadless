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

/** 同步校验一个文档，返回诊断、可执行性与计数。 */
export function validateGraphDocument(document: NodeGraphDocument): LocalValidationResult {
  const compiled = compileNodeGraph(document);
  const counts: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of compiled.diagnostics) {
    counts[diagnostic.severity] += 1;
  }
  return {
    diagnostics: withDiagnosticSource(compiled.diagnostics, "local"),
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
