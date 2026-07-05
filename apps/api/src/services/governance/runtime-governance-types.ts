/**
 * Shared Batch 8 governance vocabulary for runtime traces and operation logs.
 *
 * These constants keep C3 / I4 / T4 / R6 from inventing separate names for the
 * same trace fields, domains, and reason-code concepts.
 */
export const RUNTIME_GOVERNANCE_CONTRACT_VERSION = "b8-governance.v1" as const;

/** Runtime surfaces that can produce a governance trace summary. */
export const RUNTIME_GOVERNANCE_RUNTIME_KINDS = [
  "chat_turn",
  "tool_transport",
  "prompt_injection",
  "temporary_conversation",
  "agent_run",
  "node_graph_run",
  "node_graph_node_run",
] as const;

export type RuntimeGovernanceRuntimeKind = (typeof RUNTIME_GOVERNANCE_RUNTIME_KINDS)[number];

/** Operation-log domains reserved by the Batch 8 governance contract. */
export const RUNTIME_GOVERNANCE_OPERATION_DOMAINS = [
  "tool_transport",
  "prompt_injection",
  "temporary_conversation",
  "agent_runtime",
  "node_graph",
  "node_graph_run",
  "floor_graph_binding",
  // WP-B（Workspace 与平台基础批次 B）：身份 / 成员 / 权限审计接线复用同一治理契约，
  // 不再另起一套审计与限流 domain。
  "permission",
  "workspace",
  "project",
  "scope_integrity",
  "client_data",
] as const;

export type RuntimeGovernanceOperationDomain = (typeof RUNTIME_GOVERNANCE_OPERATION_DOMAINS)[number];

/** Common status values used in public trace summaries. */
export type RuntimeGovernanceStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "denied"
  | "skipped"
  | "reused"
  | "unknown";

/** Common reason-code anchors. Domain-specific codes may extend these values. */
export const RUNTIME_GOVERNANCE_COMMON_REASON_CODES = [
  "succeeded",
  "failed",
  "cancelled",
  "denied",
  "unknown",
  "permission_denied",
  "budget_exceeded",
  "quota_exceeded",
  "parse_failed",
  "validation_failed",
  "not_found",
  "not_executable",
  "node_graph_not_executable",
  "node_graph_node_execution_failed",
] as const;

export type RuntimeGovernanceCommonReasonCode = (typeof RUNTIME_GOVERNANCE_COMMON_REASON_CODES)[number];

/**
 * R6-2（缺口 4）预算 / 背压 reason code。
 *
 * 统一命名，避免 Agent / NodeGraph / worker 背压各自发明限流错误码。
 */
export const RUNTIME_GOVERNANCE_BUDGET_REASON_CODES = {
  nodeGraphMaxNodes: "node_graph_budget_max_nodes_exceeded",
  nodeGraphMaxDepth: "node_graph_budget_max_depth_exceeded",
  nodeGraphMaxFanOut: "node_graph_budget_max_fan_out_exceeded",
  nodeGraphMaxNestedAgentJobs: "node_graph_budget_max_nested_agent_jobs_exceeded",
  nodeGraphMaxTemporaryConversations: "node_graph_budget_max_temporary_conversations_exceeded",
  nodeGraphMaxDuration: "node_graph_budget_max_duration_exceeded",
  nodeGraphProjectRunConcurrency: "node_graph_run_project_concurrency_exceeded",
  agentRunMaxOutputDispatch: "agent_run_budget_max_output_dispatch_exceeded",
  agentRunMaxNestedJobs: "agent_run_budget_max_nested_jobs_exceeded",
} as const;

export type RuntimeGovernanceBudgetReasonCode =
  (typeof RUNTIME_GOVERNANCE_BUDGET_REASON_CODES)[keyof typeof RUNTIME_GOVERNANCE_BUDGET_REASON_CODES];

/** A small reference object. It must not contain large prompt, transcript, tool result, or node output bodies. */
export type RuntimeGovernanceRef = Record<string, string | number | boolean | null>;

/** Summary for one class of side effects, such as output dispatch or nested jobs. */
export type RuntimeGovernanceSideEffectSummary = {
  count?: number;
  written?: boolean;
  planned?: number;
  pending?: number;
  dispatched?: number;
  rejected?: number;
  created?: number;
  dry_run?: number;
  result_count?: number;
  targets?: string[];
  target_counts?: Record<string, number>;
  refs?: RuntimeGovernanceRef[];
};

/** Side effects recorded by a runtime trace summary. */
export type RuntimeGovernanceSideEffectsSummary = Record<string, RuntimeGovernanceSideEffectSummary>;

/** Stable summary fields shared by runtime traces. */
export type RuntimeGovernanceTraceSummary = {
  contract_version: typeof RUNTIME_GOVERNANCE_CONTRACT_VERSION;
  runtime_kind: RuntimeGovernanceRuntimeKind;
  run_id?: string | null;
  root_run_id?: string | null;
  parent_run_id?: string | null;
  /**
   * NG2-13 / NG2-14：本次 run 在血缘树中的角色。`main` = 主链 run，`subgraph` = `group.node`
   * 触发的持久 child run。缺省（旧 run / 未标注）不影响现有消费方。
   */
  run_role?: "main" | "subgraph" | null;
  /** NG2-14：true 表示影子 / 观测用 run（非正史、无副作用）。 */
  shadow?: boolean;
  /** NG2-13：子图 child run 的父图中触发它的 `group.node` 节点 id。 */
  parent_node_id?: string | null;
  /** NG2-13：子图 child run 引用的子图（graph_id / graph_version_id）。 */
  subgraph_ref?: RuntimeGovernanceRef | null;
  /**
   * NG2-14：主链 run 的承载方式（`system_graph` 表示由 system graph 承载）。缺省（旧 run /
   * 子图 child run）不影响现有消费方。
   */
  carrier?: string | null;
  source_kind?: string | null;
  source_ref?: RuntimeGovernanceRef | null;
  target_kind?: string | null;
  target_ref?: RuntimeGovernanceRef | null;
  status: RuntimeGovernanceStatus;
  reason_code: string;
  diagnostics?: Record<string, unknown> | null;
  started_at?: number | null;
  finished_at?: number | null;
  duration_ms?: number | null;
  dry_run?: boolean;
  preview?: boolean;
  side_effects?: RuntimeGovernanceSideEffectsSummary;
};

/** Marker used by operation-log summaries that intentionally omit sensitive payload bodies. */
export const SENSITIVE_PAYLOAD_REDACTION_MARKER = "runtime_governance_payload_redacted" as const;
