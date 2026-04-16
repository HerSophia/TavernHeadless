import type { MemoryAccessOptions, MemoryItem, MemoryEdge, MemoryQuery } from '../memory/types.js';

/**
 * 记忆条目更新 patch。
 *
 * 字段语义：
 * - `undefined`：跳过；
 * - 显式值：写入；
 * - 可空字段传 `null`：显式清空（factKey / summaryTier / sourceFloorId / sourceMessageId）。
 */
export type MemoryItemUpdatePatch = {
  content?: MemoryItem['content'];
  factKey?: MemoryItem['factKey'] | null;
  importance?: MemoryItem['importance'];
  confidence?: MemoryItem['confidence'];
  status?: MemoryItem['status'];
  lifecycleStatus?: MemoryItem['lifecycleStatus'];
  scope?: MemoryItem['scope'];
  scopeId?: MemoryItem['scopeId'];
  type?: MemoryItem['type'];
  summaryTier?: MemoryItem['summaryTier'] | null;
  sourceFloorId?: MemoryItem['sourceFloorId'] | null;
  sourceMessageId?: MemoryItem['sourceMessageId'] | null;
};

/**
 * 记忆数据访问契约
 * 由 API 层提供 Adapter 实现
 */
export interface MemoryRepository {
  /** 根据 ID 查找记忆 */
  findById(id: string, options?: MemoryAccessOptions): Promise<MemoryItem | null>;

  /** 按条件查询记忆列表 */
  findMany(query: MemoryQuery): Promise<MemoryItem[]>;

  /** 创建记忆条目，返回含 ID 和时间戳的完整对象 */
  create(item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>, options?: MemoryAccessOptions): Promise<MemoryItem>;

  /**
   * 更新记忆字段（部分更新），返回更新后对象。
   *
   * patch 字段语义：
   * - `undefined`：跳过该字段，保持原值；
   * - 非空值：写入新值；
   * - 对于可空字段（如 `factKey`、`summaryTier`、`sourceFloorId`、`sourceMessageId`）传 `null`：显式清空。
   */
  update(
    id: string,
    patch: MemoryItemUpdatePatch,
    options?: MemoryAccessOptions,
  ): Promise<MemoryItem | null>;

  /** 标记记忆为 deprecated */
  deprecate(id: string, options?: MemoryAccessOptions): Promise<MemoryItem | null>;

  // ── 关系边操作 ──

  /** 创建记忆关系边 */
  createEdge(edge: Omit<MemoryEdge, 'id' | 'createdAt'>, options?: MemoryAccessOptions): Promise<MemoryEdge>;

  /** 查找与某条记忆相关的所有边（from 或 to） */
  findEdges(itemId: string, options?: MemoryAccessOptions): Promise<MemoryEdge[]>;
}
