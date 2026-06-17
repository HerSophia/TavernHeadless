export type AgentMediumKind =
  | "single_call"
  | "temporary_conversation"
  | "background_job";

export type AgentPersistedOutputTarget =
  | "page_staged_write"
  | "session_state_proposal"
  | "derived_output"
  | "project_inbox"
  | "prompt_runtime_injection"
  | "client_data"
  | "plugin_data";

export type AgentDeliveryTarget =
  | "return_inline"
  | AgentPersistedOutputTarget;

export type AgentMediumPurpose =
  | "agent_private"
  | "agent_assist"
  | "draft"
  | "research";

export interface AgentMediumSelection {
  kind: AgentMediumKind;
  purpose?: AgentMediumPurpose;
  deliveryTarget: AgentDeliveryTarget;
  visibility?: "internal" | "client_visible";
  retentionPolicy?: "delete_on_finalize" | "ttl" | "keep_for_debug";
}
