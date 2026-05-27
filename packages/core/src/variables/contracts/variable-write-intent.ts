export type VariableWriteIntent = 'page_only' | 'promote_to_floor_on_accept';

export type VariableWriteTargetSurface = 'variable' | 'session_state';

export interface VariableWriteSourceMetadata {
  toolName?: string;
  agentId?: string;
  nodeId?: string;
  stepId?: string;
  providerId?: string;
  /**
   * 显式声明该写入最终应落到哪套状态面。
   * 未声明时默认仍走变量主链。
   */
  targetSurface?: VariableWriteTargetSurface;
  sessionStateNamespace?: string;
  sessionStateSlot?: string;
}
