/**
 * 把导入预检响应映射为分区视图模型（PKG10 / 阶段 D，纯函数可单测）。
 *
 * 节点类型按 required + missing/degradable 集合标注状态；诊断按 severity 分为
 * 不可降级（error）与可降级/提示（warning/info）两组；迁移与计数归一。
 * 节点类型标题由调用方注入的 resolver（基于 `@tavern/core/node-graph` registry）解析。
 */
import type {
  NodeGraphImportPreflightResponse,
  PreflightDiagnostic,
  PreflightSecuritySummary,
} from "../../../lib/nodegraph-api/types";

export type NodeTypeStatus = "available" | "missing" | "degradable";
export type MigrationState = "none" | "available" | "required";

export interface PreflightNodeTypeView {
  type: string;
  title: string;
  status: NodeTypeStatus;
}

export interface PreflightView {
  installable: boolean;
  contentHash: string;
  migration: MigrationState;
  counts: { error: number; warning: number; info: number };
  nodeTypes: PreflightNodeTypeView[];
  blockingDiagnostics: PreflightDiagnostic[];
  advisoryDiagnostics: PreflightDiagnostic[];
  security: PreflightSecuritySummary;
}

export function mapPreflight(
  response: NodeGraphImportPreflightResponse,
  resolveTypeTitle?: (type: string) => string | undefined,
): PreflightView {
  const missing = new Set(response.missing_node_types ?? []);
  const degradable = new Set(response.degradable_node_types ?? []);

  const nodeTypes: PreflightNodeTypeView[] = (response.required_node_types ?? []).map((type) => ({
    type,
    title: resolveTypeTitle?.(type) ?? type,
    status: missing.has(type) ? (degradable.has(type) ? "degradable" : "missing") : "available",
  }));

  const diagnostics = response.diagnostics ?? [];
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const advisoryDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity !== "error");

  const migration: MigrationState = response.migration_required
    ? "required"
    : response.migration_available
      ? "available"
      : "none";

  return {
    installable: response.installable,
    contentHash: response.content_hash,
    migration,
    counts: {
      error: response.counts?.error ?? 0,
      warning: response.counts?.warning ?? 0,
      info: response.counts?.info ?? 0,
    },
    nodeTypes,
    blockingDiagnostics,
    advisoryDiagnostics,
    security: response.security_summary ?? {},
  };
}
