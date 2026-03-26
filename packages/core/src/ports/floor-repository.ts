import type { FloorState } from '@tavern/shared';
import type { FloorEntity } from '../types.js';

/**
 * 楼层数据访问契约
 * 由 API 层提供 Adapter 实现
 */
export interface FloorRepository {
  /** 根据 ID 查找楼层 */
  findById(id: string): Promise<FloorEntity | null>;

  /**
   * 更新楼层状态并返回更新后的实体。
   *
   * @deprecated 过渡接口。新状态机路径应使用 updateStateCas。
   */
  updateState(id: string, state: FloorState, updatedAt: number): Promise<FloorEntity | null>;

  /**
   * 以 CAS 语义更新楼层状态。
   * 仅当当前状态等于 expectedState 时才执行更新。
   */
  updateStateCas(id: string, expectedState: FloorState, targetState: FloorState, updatedAt: number): Promise<FloorEntity | null>;
}
