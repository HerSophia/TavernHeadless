import type {
  ExecutedToolCallRecord,
  ToolExecutionCommitOutcome,
  ToolExecutionFinishPatch,
  ToolExecutionOpenRecord,
} from '../tools/types.js';

/**
 * 工具真实执行记录的数据访问契约
 * 由 API 层提供 Adapter 实现
 */
export interface ToolExecutionRepository {
  /** 批量插入一组真实执行记录（兼容回填 / 测试场景） */
  insertMany(records: ExecutedToolCallRecord[]): Promise<void>;

  /** 在真实 provider 执行前打开一条执行日志 */
  open(record: ToolExecutionOpenRecord): Promise<void>;

  /** 在真实 provider 结束后补全执行日志 */
  finish(recordId: string, patch: ToolExecutionFinishPatch): Promise<void>;

  /** 在回合最终落定后标记整组 run 的 commit 归宿 */
  markRunCommitOutcome(runId: string, outcome: ToolExecutionCommitOutcome): Promise<number>;

  /** 按 floorId 查询真实执行记录 */
  findByFloorId(floorId: string): Promise<ExecutedToolCallRecord[]>;

  /** 按 runId 查询真实执行记录 */
  findByRunId(runId: string): Promise<ExecutedToolCallRecord[]>;
}
