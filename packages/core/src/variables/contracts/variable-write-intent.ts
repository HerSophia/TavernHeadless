export type VariableWriteIntent = 'page_only' | 'promote_to_floor_on_accept';

export interface VariableWriteSourceMetadata {
  toolName?: string;
  agentId?: string;
  nodeId?: string;
  stepId?: string;
  providerId?: string;
}
