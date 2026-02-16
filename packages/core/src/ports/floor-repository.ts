import type { FloorState } from '@tavern/shared';
import type { FloorEntity } from '../types.js';

/**
 * 楼层数据访问契约
 * 由 API 层提供 Adapter 实现
 */
export interface FloorRepository {
  /** 根据 ID 查找楼层 */
  findById(id: string): Promise<FloorEntity | null>;

  /** 更新楼层状态并返回更新后的实体 */
  updateState(id: string, state: FloorState, updatedAt: number): Promise<FloorEntity | null>;
}
