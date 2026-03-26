import type { PromptSnapshotRecord } from '../prompt/types.js';

/**
 * Prompt 快照数据访问契约
 * 由 API 层提供 Adapter 实现
 */
export interface PromptSnapshotRepository {
  /** 插入或覆盖某个 floor 的 Prompt 快照 */
  insert(record: PromptSnapshotRecord): Promise<PromptSnapshotRecord>;

  /** 根据 floorId 查找 Prompt 快照 */
  findByFloorId(floorId: string): Promise<PromptSnapshotRecord | null>;
}
