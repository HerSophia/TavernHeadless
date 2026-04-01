import type { FloorState } from '@tavern/shared';
import type { ToolMutationBuffer } from './tools/tool-mutation-buffer.js';

/**
 * 变量解析上下文
 * 提供各级 scope 对应的实体 ID，用于级联查找
 */
export interface VariableContext {
  /** 当前消息页 ID（page scope） */
  pageId?: string;
  /** 当前楼层 ID（floor scope） */
  floorId?: string;
  /** 当前分支 ID（branch scope，需要与 sessionId 共同确定宿主） */
  branchId?: string;
  /** 当前会话 ID（chat scope） */
  sessionId?: string;
  /** 当前账户 ID（用于多账户变量隔离） */
  accountId?: string;
  /** 全局 scope ID，默认 'global' */
  globalScopeId?: string;
  /** 当前工具回合的本地变量缓冲区（仅工具执行路径使用） */
  toolMutationBuffer?: ToolMutationBuffer;
  /** 当前生成尝试编号（用于隔离 verifier retry 之间的缓冲写入） */
  toolMutationAttemptNo?: number;
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
