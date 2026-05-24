export const AGENT_SCOPE_KIND_VALUES = [
  "floor",
  "session",
  "project",
  "workspace",
] as const;

export const TOOL_EXECUTION_TRIGGER_SCOPE_VALUES = [
  "chat_turn",
  "manual",
  "unknown",
  "agent_step",
] as const;

export type AgentScopeKind = (typeof AGENT_SCOPE_KIND_VALUES)[number];

export const AGENT_TYPE_STATUS_VALUES = ["active", "disabled"] as const;
export type AgentTypeStatus = (typeof AGENT_TYPE_STATUS_VALUES)[number];

export const PROJECT_AGENT_BINDING_STATUS_VALUES = [
  "enabled",
  "disabled",
  "error",
] as const;
export type ProjectAgentBindingStatus = (typeof PROJECT_AGENT_BINDING_STATUS_VALUES)[number];

export const AGENT_STEP_STATE_STATUS_VALUES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "uncertain",
] as const;

export interface AgentEventSubscription {
  type: string;
  filterJson?: Record<string, unknown> | null;
}

export interface AgentMcpBindingEntry {
  mcpServerId: string;
  allowedTools?: string[];
  configOverrideJson?: Record<string, unknown> | null;
}

export interface AgentTypeDefaults {
  llmProfileId?: string | null;
  toolPolicyId?: string | null;
  mcpBindings: AgentMcpBindingEntry[];
  eventSubscriptions: AgentEventSubscription[];
  /**
   * Free-form grants (e.g. `{ allowed_output_targets: [...], reads: [...] }`).
   * The shape is intentionally untyped so future grants can be added without
   * schema churn. Two well-known keys are validated by
   * {@link AgentPermissionPolicy}:
   *  - allowed_output_targets: string[]
   *  - reads: string[]
   */
  grants: Record<string, unknown>;
  metadata: Record<string, unknown>;
}
