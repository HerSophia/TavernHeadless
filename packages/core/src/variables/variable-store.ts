import {
  SCOPE_PRIORITY,
  type VariableScope,
  type VariableEntry,
} from '@tavern/shared';
import type { VariableContext } from '../types.js';
import type { VariableRepository } from '../ports/index.js';
import type { CoreEventBus } from '../events/index.js';
import { InvalidScopePromotionError, MissingScopeIdError, VariableNotFoundError } from '../errors.js';
import { VariableResolver } from './variable-resolver.js';

/** scope → VariableContext 中对应字段的映射 */
const SCOPE_TO_CONTEXT_KEY: Record<VariableScope, keyof VariableContext> = {
  page: 'pageId',
  floor: 'floorId',
  chat: 'sessionId',
  global: 'globalScopeId',
};

const DEFAULT_GLOBAL_SCOPE_ID = 'global';

/**
 * 获取 context 中某个 scope 对应的 scopeId
 */
function getScopeId(scope: VariableScope, context: VariableContext): string | undefined {
  const key = SCOPE_TO_CONTEXT_KEY[scope];
  const value = context[key];
  if (value !== undefined) return value;
  if (scope === 'global') return DEFAULT_GLOBAL_SCOPE_ID;
  return undefined;
}

/**
 * 获取 context 中某个 scope 对应的 scopeId，不存在则抛错
 */
function requireScopeId(scope: VariableScope, context: VariableContext): string {
  const id = getScopeId(scope, context);
  if (id === undefined) {
    throw new MissingScopeIdError(scope);
  }
  return id;
}

/**
 * 找到 context 中最低可用的 scope（优先级最高的）
 * 按 SCOPE_PRIORITY 顺序：page → floor → chat → global
 */
function findLowestAvailableScope(context: VariableContext): VariableScope {
  for (const scope of SCOPE_PRIORITY) {
    if (getScopeId(scope, context) !== undefined) {
      return scope;
    }
  }
  // global 总是有默认值，理论上不会到这里
  return 'global';
}

/**
 * 变量写入与提升
 *
 * - 写入默认到最低可用 scope（沙箱机制）
 * - 提升需显式调用，方向必须从低 scope 到高 scope
 * - 每次操作都通过事件总线广播
 */
export class VariableStore {
  constructor(
    private readonly variableRepo: VariableRepository,
    private readonly resolver: VariableResolver,
    private readonly eventBus: CoreEventBus
  ) {}

  /**
   * 写入变量
   * @param scope 不传则自动选择最低可用 scope
   */
  async set(
    key: string,
    value: unknown,
    context: VariableContext,
    scope?: VariableScope
  ): Promise<VariableEntry> {
    const targetScope = scope ?? findLowestAvailableScope(context);
    const scopeId = requireScopeId(targetScope, context);

    // 检查是否已存在（用于事件的 isNew 标志）
    const existing = await this.variableRepo.findByKey(targetScope, scopeId, key);
    const entry = await this.variableRepo.upsert(targetScope, scopeId, key, value);

    await this.eventBus.emit('variable.set', {
      entry,
      isNew: existing === null,
    });

    return entry;
  }

  /**
   * 提升变量：从低 scope 复制到高 scope
   *
   * @throws {InvalidScopePromotionError} 方向不合法（高→低）
   * @throws {VariableNotFoundError} 源 scope 中找不到该变量
   */
  async promote(
    key: string,
    fromScope: VariableScope,
    toScope: VariableScope,
    context: VariableContext
  ): Promise<VariableEntry> {
    // 验证方向：fromScope 的索引必须小于 toScope 的索引
    const fromIndex = SCOPE_PRIORITY.indexOf(fromScope);
    const toIndex = SCOPE_PRIORITY.indexOf(toScope);

    if (fromIndex >= toIndex) {
      throw new InvalidScopePromotionError(fromScope, toScope);
    }

    const fromScopeId = requireScopeId(fromScope, context);
    const toScopeId = requireScopeId(toScope, context);

    // 从源 scope 读取
    const source = await this.variableRepo.findByKey(fromScope, fromScopeId, key);
    if (!source) {
      throw new VariableNotFoundError(key, `${fromScope}:${fromScopeId}`);
    }

    // 写入目标 scope
    const promoted = await this.variableRepo.upsert(toScope, toScopeId, key, source.value);

    await this.eventBus.emit('variable.promoted', {
      key,
      fromScope,
      toScope,
      value: source.value,
    });

    return promoted;
  }

  /**
   * 批量提升：将某个 scope 下的所有变量提升到目标 scope
   * 典型用途：楼层 commit 时将 page 变量提升到 floor/chat
   */
  async promoteAll(
    fromScope: VariableScope,
    fromScopeId: string,
    toScope: VariableScope,
    toScopeId: string
  ): Promise<VariableEntry[]> {
    // 验证方向
    const fromIndex = SCOPE_PRIORITY.indexOf(fromScope);
    const toIndex = SCOPE_PRIORITY.indexOf(toScope);

    if (fromIndex >= toIndex) {
      throw new InvalidScopePromotionError(fromScope, toScope);
    }

    const entries = await this.variableRepo.findAllByScope(fromScope, fromScopeId);
    const promoted: VariableEntry[] = [];

    for (const entry of entries) {
      const result = await this.variableRepo.upsert(toScope, toScopeId, entry.key, entry.value);
      promoted.push(result);

      await this.eventBus.emit('variable.promoted', {
        key: entry.key,
        fromScope,
        toScope,
        value: entry.value,
      });
    }

    return promoted;
  }

  /**
   * 删除变量
   */
  async delete(id: string, scope: VariableScope, key: string): Promise<void> {
    const deleted = await this.variableRepo.deleteById(id);
    if (deleted) {
      await this.eventBus.emit('variable.deleted', { id, scope, key });
    }
  }

  /**
   * 便捷方法：读取变量值（代理给 resolver）
   */
  async get(key: string, context: VariableContext): Promise<unknown | undefined> {
    const entry = await this.resolver.resolve(key, context);
    return entry?.value;
  }
}
