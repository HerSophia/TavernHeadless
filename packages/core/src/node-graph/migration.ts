import {
  NODE_GRAPH_SCHEMA_VERSION,
  NODE_GRAPH_SCHEMA_VERSION_V2,
  type NodeGraphDocument,
} from './types.js';

/**
 * 读取文档 schema 版本。缺省（旧文档无字段）按 v1。
 */
export function nodeGraphDocumentSchemaVersion(document: Pick<NodeGraphDocument, 'schemaVersion'>): number {
  const version = document.schemaVersion;
  return typeof version === 'number' && Number.isFinite(version) ? version : NODE_GRAPH_SCHEMA_VERSION;
}

export interface NodeGraphMigrationResult {
  document: NodeGraphDocument;
  changed: boolean;
}

/**
 * NG2-CORE：把 v1 文档升级为 v2（B9-DESIGN 3.6 写路径升级）。
 *
 * - `schemaVersion` 升为 2。
 * - 每条 edge 补 `kind = 'data'` 缺省。
 * - 不改变既有执行结果（除非用户随后显式启用 control / checkpoint 等 v2 能力）。
 *
 * 幂等：已是 v2 且 edge 都带 kind 时返回 `changed = false` 与原文档引用。
 */
export function migrateNodeGraphDocumentToV2(document: NodeGraphDocument): NodeGraphMigrationResult {
  const currentVersion = nodeGraphDocumentSchemaVersion(document);
  let changed = currentVersion < NODE_GRAPH_SCHEMA_VERSION_V2;

  const edges = document.edges.map((edge) => {
    if (edge.kind === undefined) {
      changed = true;
      return { ...edge, kind: 'data' as const };
    }
    return edge;
  });

  if (!changed) {
    return { document, changed: false };
  }

  return {
    document: {
      ...document,
      schemaVersion: NODE_GRAPH_SCHEMA_VERSION_V2,
      edges,
    },
    changed: true,
  };
}

export interface NodeGraphSchemaMigrationDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: 'MIGRATION_AVAILABLE' | 'MIGRATION_REQUIRED';
  message: string;
  fromVersion: number;
  toVersion: number;
}

/**
 * NG2-CORE：schema 级迁移诊断（B9-DESIGN 3.6 迁移诊断）。
 *
 * 当文档低于 v2 时产出 `MIGRATION_AVAILABLE`（info，可升级但不强制）。
 * 完整 node-type / capability 兼容性诊断（`MIGRATION_REQUIRED` 等）归 NG2-PKG。
 */
export function detectNodeGraphSchemaMigration(
  document: Pick<NodeGraphDocument, 'schemaVersion'>,
): NodeGraphSchemaMigrationDiagnostic[] {
  const version = nodeGraphDocumentSchemaVersion(document);
  if (version < NODE_GRAPH_SCHEMA_VERSION_V2) {
    return [{
      severity: 'info',
      code: 'MIGRATION_AVAILABLE',
      message: `NodeGraph schema v${version} can be migrated to v${NODE_GRAPH_SCHEMA_VERSION_V2}.`,
      fromVersion: version,
      toVersion: NODE_GRAPH_SCHEMA_VERSION_V2,
    }];
  }
  return [];
}
