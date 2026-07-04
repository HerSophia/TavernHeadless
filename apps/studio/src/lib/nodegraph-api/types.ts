import type {
  NodeGraphDiagnostic,
  NodeGraphDocument,
  NodeGraphNodeRunStatus,
} from "@tavern/core/node-graph";

/**
 * 第一方 NodeGraph 客户端的响应类型（对齐 apps/api `routes/node-graphs.ts` 的
 * `definitionToResponse` / `versionToResponse` / `runToResponse` 等）。
 *
 * NodeGraph 不在公共 OpenAPI/SDK 面，studio 用这层薄客户端直连；若日后升入公共 SDK，
 * 应迁移到 `@tavern/sdk` 并删除本层。
 */
export interface NodeGraphDefinitionResponse {
  id: string;
  account_id: string;
  workspace_id: string | null;
  project_id: string | null;
  name: string;
  status: string;
  current_version_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface NodeGraphVersionResponse {
  id: string;
  graph_id: string;
  version_no: number;
  document: NodeGraphDocument;
  document_hash: string;
  parent_version_id: string | null;
  operation_log_id: string | null;
  created_at: number;
}

/** 服务端 validate 直接返回校验结果；字段以 diagnostics 为主，保留容错索引。 */
export interface NodeGraphValidationResponse {
  diagnostics?: NodeGraphDiagnostic[];
  isValid?: boolean;
  [key: string]: unknown;
}

export interface NodeGraphListResponse {
  items: NodeGraphDefinitionResponse[];
}

export interface NodeGraphVersionsResponse {
  items: NodeGraphVersionResponse[];
}

export interface NodeGraphGetResponse {
  definition: NodeGraphDefinitionResponse;
  current_version: NodeGraphVersionResponse | null;
}

export interface NodeGraphMutationResponse {
  definition: NodeGraphDefinitionResponse;
  version: NodeGraphVersionResponse;
  validation: NodeGraphValidationResponse;
}

export interface NodeGraphSetVersionResponse {
  definition: NodeGraphDefinitionResponse;
  version: NodeGraphVersionResponse;
}

export interface NodeGraphArchiveResponse {
  definition: NodeGraphDefinitionResponse;
}

export type FloorGraphBindingKind = "native" | "compat";

export interface FloorGraphBindingResponse {
  id: string;
  account_id: string;
  workspace_id: string;
  project_id: string;
  kind: FloorGraphBindingKind;
  graph_id: string;
  graph_version_id: string;
  graph_name: string;
  graph_version_no: number;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface FloorGraphBindingListResponse {
  items: FloorGraphBindingResponse[];
}

export interface FloorGraphBindingMutationResponse {
  item: FloorGraphBindingResponse;
}

export interface FloorGraphBindingClearResponse {
  cleared: boolean;
  previous: FloorGraphBindingResponse | null;
}

export interface FloorGraphBindingSetInput {
  graph_id: string;
  graph_version_id: string;
}

export interface NodeGraphRunEnqueueResponse {
  job_id: string;
  created: boolean;
  dedupe_key: string | null;
  graph_id: string;
  graph_version_id: string;
  worker_enabled: boolean;
  /**
   * 后端 `/run` 当前只返回 `job_id`（run record 由 worker 执行时才创建，id 无法在入队时获知）。
   * 保留 `run_id` 可选字段用于容错：若后续后端在同步 dry-run 场景直接返回 run id，前端可无缝接入轮询。
   */
  run_id?: string | null;
}

/** getRun 返回的单条节点运行记录（对齐路由 `nodeRunToResponse`）。 */
export interface NodeGraphNodeRunResponse {
  id: string;
  graph_run_id: string;
  node_id: string;
  phase: string;
  status: NodeGraphNodeRunStatus | string;
  input_hash: string | null;
  output_hash: string | null;
  started_at: number | null;
  finished_at: number | null;
  /** 节点输出正文，仅 manage debug 权限可见，默认裁剪为 null。 */
  preview?: unknown;
  diagnostics?: unknown;
  restricted?: boolean;
}

/** getRun 返回的运行记录主体（对齐路由 `runToResponse`）。 */
export interface NodeGraphRunRecord {
  id: string;
  graph_id: string;
  graph_version_id: string;
  status: string;
  intent: string;
  session_id: string | null;
  floor_id: string | null;
  page_id: string | null;
  trace: unknown;
  cleaned_at: number | null;
  created_at: number;
  updated_at: number;
  [key: string]: unknown;
}

/**
 * getRun 完整响应（对齐 apps/api `GET /projects/:id/node-graph-runs/:run_id`）。
 * 后端返回 `{ run, node_runs, restricted }`，节点级状态来自 `node_runs`。
 */
export interface NodeGraphRunRecordResponse {
  run: NodeGraphRunRecord;
  node_runs: NodeGraphNodeRunResponse[];
  restricted: boolean;
}

export interface NodeGraphPreviewInput {
  version_id?: string;
  node_id?: string | null;
  input_json?: Record<string, unknown>;
  user_input?: string;
  chat_history?: Array<{ role: string; content: string }>;
  cached_node_outputs?: Record<string, unknown>;
}

export interface NodeGraphRunInput {
  version_id?: string;
  intent?: "normal" | "dry_run" | "regenerate" | "preview";
  dry_run?: boolean;
  input_json?: Record<string, unknown>;
  session_id?: string | null;
  floor_id?: string | null;
  page_id?: string | null;
  dedupe_key?: string | null;
}

export type NodeGraphPreviewResponse = Record<string, unknown>;

/** 导入预检诊断（对齐 core `GraphImportDiagnostic`；浏览器子路径不导出 package 模块，故本地声明）。 */
export interface PreflightDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  nodeId?: string;
  dependencyId?: string;
  degradable?: boolean;
  resolution?: { action: string; label: string };
}

/** 导入安全摘要（对齐路由 `securitySummaryToResponse`）。 */
export interface PreflightSecuritySummary {
  long_term_data_reads?: string[];
  session_state_namespace_reads?: string[];
  proposes_committed_writes?: boolean;
  persistent_output_targets?: string[];
  mcp_servers?: string[];
  requests_network_access?: boolean;
  requests_file_write?: boolean;
  required_permissions?: string[];
}

export interface NodeGraphImportPreflightResponse {
  package_id: string;
  content_hash: string;
  installable: boolean;
  migration_available: boolean;
  migration_required: boolean;
  counts: { error?: number; warning?: number; info?: number };
  diagnostics: PreflightDiagnostic[];
  required_node_types: string[];
  missing_node_types: string[];
  degradable_node_types: string[];
  security_summary: PreflightSecuritySummary;
}

export interface NodeGraphExportResponse {
  /** NodeGraphPackage 信封（下载为 JSON）。 */
  package: Record<string, unknown>;
  security_summary: PreflightSecuritySummary;
  graph_id: string;
  version_id: string;
  version_no: number;
}

export interface NodeGraphImportResponse {
  confirmed: boolean;
  requires_confirmation: boolean;
  preflight: NodeGraphImportPreflightResponse;
  definition?: NodeGraphDefinitionResponse;
  version?: NodeGraphVersionResponse;
  validation?: NodeGraphValidationResponse;
}
