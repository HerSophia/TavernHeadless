import type { ExecutedToolCallRecord } from '../tools/types.js';

/**
 * 工具真实执行记录的数据访问契约
 * 由 API 层提供 Adapter 实现
 */
export interface ToolExecutionRepository {
  /** 批量插入一组真实执行记录 */
  insertMany(records: ExecutedToolCallRecord[]): Promise<void>;

  /** 按 floorId 查询真实执行记录 */
  findByFloorId(floorId: string): Promise<ExecutedToolCallRecord[]>;

  /** 按 runId 查询真实执行记录 */
  findByRunId(runId: string): Promise<ExecutedToolCallRecord[]>;
}
