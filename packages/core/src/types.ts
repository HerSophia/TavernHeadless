import type { FloorState } from '@tavern/shared';

/**
 * 变量解析上下文
 * 提供各级 scope 对应的实体 ID，用于级联查找
 */
export interface VariableContext {
  /** 当前消息页 ID（page scope） */
  pageId?: string;
  /** 当前楼层 ID（floor scope） */
  floorId?: string;
  /** 当前会话 ID（chat scope） */
  sessionId?: string;
  /** 当前账户 ID（用于多账户变量隔离） */
  accountId?: string;
  /** 全局 scope ID，默认 'global' */
  globalScopeId?: string;
}

/**
 * 楼层领域对象
 * 与 DB row 解耦，由 FloorRepository 返回
 */
export interface FloorEntity {
  id: string;
  sessionId: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: FloorState;
  tokenIn: number;
  tokenOut: number;
  createdAt: number;
  updatedAt: number;
}
