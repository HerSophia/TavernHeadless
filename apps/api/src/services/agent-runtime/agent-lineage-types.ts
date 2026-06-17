export interface AgentLineageRef {
  rootRunId?: string;
  parentRunId?: string;
  sourceAgentRunId?: string;
  sourceNodeRunId?: string;
  sourceSessionId?: string;
  sourceFloorId?: string;
  sourcePageId?: string;
  sourceAttemptNo?: number;
}
