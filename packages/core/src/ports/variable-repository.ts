import type { VariableScope, VariableEntry } from '@tavern/shared';

/**
 * 变量数据访问契约
 * 由 API 层提供 Adapter 实现
 */
export interface VariableRepository {
  /** 查询指定 scope + scopeId 下的某个 key */
  findByKey(scope: VariableScope, scopeId: string, key: string): Promise<VariableEntry | null>;

  /** 查询指定 scope + scopeId 下的所有变量 */
  findAllByScope(scope: VariableScope, scopeId: string): Promise<VariableEntry[]>;

  /** 写入/更新变量（upsert 语义），返回最终条目 */
  upsert(scope: VariableScope, scopeId: string, key: string, value: unknown): Promise<VariableEntry>;

  /** 根据 ID 删除变量 */
  deleteById(id: string): Promise<boolean>;

  /** 按 scope + scopeId + key 删除 */
  deleteByKey(scope: VariableScope, scopeId: string, key: string): Promise<boolean>;
}
