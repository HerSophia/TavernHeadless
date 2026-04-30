import {
  SCOPE_PRIORITY,
  type VariableEntry,
  type VariableScope,
} from '@tavern/shared';

import type { CoreEventBus } from '../../events/index.js';
import { InvalidScopePromotionError, VariableNotFoundError } from '../../errors.js';
import type { VariableRepository } from '../../ports/index.js';
import type { VariableContext } from '../../types.js';
import type { VariableWriteIntent, VariableWriteSourceMetadata } from '../contracts/index.js';
import { VariableResolver } from '../resolver/variable-resolver.js';
import {
  findLowestAvailableScope,
  getEventContext,
  getRepositoryOptions,
  getToolMutationState,
  requireScopeId,
} from '../shared/context.js';

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
    scope?: VariableScope,
    metadata?: {
      intent?: VariableWriteIntent;
      reason?: string;
      source?: VariableWriteSourceMetadata;
    },
  ): Promise<VariableEntry> {
    const targetScope = scope ?? findLowestAvailableScope(context);
    const scopeId = requireScopeId(targetScope, context);
    const repoOptions = getRepositoryOptions(context.accountId);
    const toolMutationState = getToolMutationState(context);

    if (toolMutationState) {
      // buffered 写入属于 attempt-local 可见性，不在此时发射任何公共
      // variable.* 事件。公共 variable.set 只能在 commit 成功之后由
      // VariableCommitService/TurnCommitService 统一 flush。
      const entry = toolMutationState.buffer.upsert({
        generationAttemptNo: toolMutationState.generationAttemptNo,
        scope: targetScope,
        scopeId,
        key,
        value,
        accountId: context.accountId,
        intent: metadata?.intent,
        reason: metadata?.reason,
        source: metadata?.source,
      });

      return entry;
    }

    const existing = await this.variableRepo.findByKey(targetScope, scopeId, key, repoOptions);
    const entry = await this.variableRepo.upsert(targetScope, scopeId, key, value, repoOptions);

    await this.eventBus.emit('variable.set', {
      ...getEventContext(context),
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
    const repoOptions = getRepositoryOptions(context.accountId);

    // 从源 scope 读取
    const source = await this.variableRepo.findByKey(fromScope, fromScopeId, key, repoOptions);
    if (!source) {
      throw new VariableNotFoundError(key, `${fromScope}:${fromScopeId}`);
    }

    // 写入目标 scope
    const promoted = await this.variableRepo.upsert(toScope, toScopeId, key, source.value, repoOptions);

    await this.eventBus.emit('variable.promoted', {
      ...getEventContext(context),
      key,
      fromScope,
      toScope,
      value: source.value,
    });

    return promoted;
  }

  /**
   * 批量提升：将某个 scope 下的所有变量提升到目标 scope
   * 典型用途：楼层 commit 时将 page 变量提升到 floor/branch/chat
   */
  async promoteAll(
    fromScope: VariableScope,
    fromScopeId: string,
    toScope: VariableScope,
    toScopeId: string,
    accountId?: string,
    eventContext?: Pick<VariableContext, 'sessionId' | 'branchId'>
  ): Promise<VariableEntry[]> {
    // 验证方向
    const fromIndex = SCOPE_PRIORITY.indexOf(fromScope);
    const toIndex = SCOPE_PRIORITY.indexOf(toScope);

    if (fromIndex >= toIndex) {
      throw new InvalidScopePromotionError(fromScope, toScope);
    }

    const repoOptions = getRepositoryOptions(accountId);
    const entries = await this.variableRepo.findAllByScope(fromScope, fromScopeId, repoOptions);
    const promoted: VariableEntry[] = [];

    for (const entry of entries) {
      const result = await this.variableRepo.upsert(toScope, toScopeId, entry.key, entry.value, repoOptions);
      promoted.push(result);

      await this.eventBus.emit('variable.promoted', {
        ...getEventContext(eventContext),
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
  async delete(
    id: string,
    scope: VariableScope,
    key: string,
    accountId?: string,
    eventContext?: Pick<VariableContext, 'sessionId' | 'branchId'>
  ): Promise<void> {
    const deleted = await this.variableRepo.deleteById(id, getRepositoryOptions(accountId));
    if (deleted) {
      await this.eventBus.emit('variable.deleted', {
        ...getEventContext(eventContext),
        id,
        scope,
        key,
      });
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
