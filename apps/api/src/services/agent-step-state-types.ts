export const TOOL_EXECUTION_TRIGGER_SCOPE_VALUES = [
  "chat_turn",
  "manual",
  "unknown",
  "agent_step",
] as const;

export type ToolExecutionTriggerScope =
  (typeof TOOL_EXECUTION_TRIGGER_SCOPE_VALUES)[number];

export interface ToolExecutionProvenanceRef {
  triggerScope: ToolExecutionTriggerScope;
  stepId?: string;
  parentRunJobId?: string;
  agentBindingId?: string;
  sourceEventId?: string;
}

export const AGENT_STEP_STATE_STATUS_VALUES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "uncertain",
] as const;

export type AgentStepStateStatus = (typeof AGENT_STEP_STATE_STATUS_VALUES)[number];

export interface AgentStepState {
  stepId: string;
  status: AgentStepStateStatus;
  triggerScope: ToolExecutionTriggerScope;
  parentRunJobId?: string | null;
  resumeToken?: string | null;
  toolExecutionIds: string[];
}
