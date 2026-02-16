import type { MemoryItem, MemoryEdge, MemoryQuery } from '../memory/types.js';

/**
 * 记忆数据访问契约
 * 由 API 层提供 Adapter 实现
 */
export interface MemoryRepository {
  /** 根据 ID 查找记忆 */
  findById(id: string): Promise<MemoryItem | null>;

  /** 按条件查询记忆列表 */
  findMany(query: MemoryQuery): Promise<MemoryItem[]>;

  /** 创建记忆条目，返回含 ID 和时间戳的完整对象 */
  create(item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryItem>;

  /** 更新记忆字段（部分更新），返回更新后对象 */
  update(
    id: string,
    patch: Partial<Pick<MemoryItem, 'content' | 'importance' | 'confidence' | 'status'>>,
  ): Promise<MemoryItem | null>;

  /** 标记记忆为 deprecated */
  deprecate(id: string): Promise<MemoryItem | null>;

  // ── 关系边操作 ──

  /** 创建记忆关系边 */
  createEdge(edge: Omit<MemoryEdge, 'id' | 'createdAt'>): Promise<MemoryEdge>;

  /** 查找与某条记忆相关的所有边（from 或 to） */
  findEdges(itemId: string): Promise<MemoryEdge[]>;
}
