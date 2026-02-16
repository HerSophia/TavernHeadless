/**
 * 非法状态转移错误
 * 当楼层状态机收到不合法的状态转移请求时抛出
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
    message?: string
  ) {
    super(message ?? `Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * 楼层不可变错误
 * 当尝试修改已提交（committed）的楼层时抛出
 */
export class FloorImmutableError extends Error {
  constructor(floorId: string) {
    super(`Floor ${floorId} is committed and cannot be modified`);
    this.name = 'FloorImmutableError';
  }
}

/**
 * 楼层不存在错误
 */
export class FloorNotFoundError extends Error {
  constructor(floorId: string) {
    super(`Floor ${floorId} not found`);
    this.name = 'FloorNotFoundError';
  }
}

/**
 * 变量未找到错误
 */
export class VariableNotFoundError extends Error {
  constructor(key: string, context?: string) {
    super(`Variable "${key}" not found${context ? ` in ${context}` : ''}`);
    this.name = 'VariableNotFoundError';
  }
}

/**
 * 非法变量提升方向错误
 * 当尝试从高 scope 提升到低 scope 时抛出
 */
export class InvalidScopePromotionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot promote variable from ${from} to ${to} (must promote to a higher scope)`);
    this.name = 'InvalidScopePromotionError';
  }
}

/**
 * 变量上下文中缺少对应 scope 的 ID
 */
export class MissingScopeIdError extends Error {
  constructor(scope: string) {
    super(`Variable context is missing scopeId for scope "${scope}"`);
    this.name = 'MissingScopeIdError';
  }
}
