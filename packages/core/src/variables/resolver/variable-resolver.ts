import { SCOPE_PRIORITY, type VariableEntry } from '@tavern/shared';

import type { VariableRepository } from '../../ports/index.js';
import type { VariableContext } from '../../types.js';
import {
  getRepositoryOptions,
  getScopeId,
  getToolMutationState,
} from '../shared/context.js';

/**
 * 变量级联读取器
 *
 * 按优先级 page → floor → branch → chat → global 逐级查找变量。
 * 找到即返回，跳过 context 中未提供 scopeId 的层级。
 */
export class VariableResolver {
  constructor(private readonly variableRepo: VariableRepository) {}

  /**
   * 按优先级级联查找变量
   * @returns 命中的 VariableEntry，找不到返回 null
   */
  async resolve(key: string, context: VariableContext): Promise<VariableEntry | null> {
    const repoOptions = getRepositoryOptions(context.accountId);
    const toolMutationState = getToolMutationState(context);

    for (const scope of SCOPE_PRIORITY) {
      const scopeId = getScopeId(scope, context);
      if (scopeId === undefined) continue;

      if (toolMutationState) {
        const bufferedEntry = toolMutationState.buffer.findByKey({
          generationAttemptNo: toolMutationState.generationAttemptNo,
          scope,
          scopeId,
          key,
          accountId: context.accountId,
        });
        if (bufferedEntry) return bufferedEntry;
      }

      const entry = await this.variableRepo.findByKey(scope, scopeId, key, repoOptions);
      if (entry) return entry;
    }
    return null;
  }

  /**
   * 解析变量值，找不到时返回默认值
   */
  async resolveValue<T = unknown>(
    key: string,
    context: VariableContext,
    defaultValue: T
  ): Promise<T> {
    const entry = await this.resolve(key, context);
    if (entry === null) return defaultValue;
    return entry.value as T;
  }

  /**
   * 批量解析多个 key
   * @returns Map<key, VariableEntry>（仅包含找到的 key）
   */
  async resolveMany(
    keys: string[],
    context: VariableContext
  ): Promise<Map<string, VariableEntry>> {
    const result = new Map<string, VariableEntry>();
    for (const key of keys) {
      const entry = await this.resolve(key, context);
      if (entry) result.set(key, entry);
    }
    return result;
  }

  /**
   * 获取某个 context 下所有可见变量
   * 从最高 scope（global）开始合并，低 scope 的同名 key 覆盖高 scope
   */
  async resolveAll(context: VariableContext): Promise<Map<string, VariableEntry>> {
    const merged = new Map<string, VariableEntry>();
    const repoOptions = getRepositoryOptions(context.accountId);
    const toolMutationState = getToolMutationState(context);

    // 反向遍历：global → chat → branch → floor → page，后写入的覆盖先写入的
    const reversedScopes = [...SCOPE_PRIORITY].reverse();

    for (const scope of reversedScopes) {
      const scopeId = getScopeId(scope, context);
      if (scopeId === undefined) continue;

      const entries = await this.variableRepo.findAllByScope(scope, scopeId, repoOptions);
      for (const entry of entries) {
        merged.set(entry.key, entry);
      }
    }

    if (toolMutationState) {
      for (const scope of reversedScopes) {
        const scopeId = getScopeId(scope, context);
        if (scopeId === undefined) continue;

        const bufferedEntries = toolMutationState.buffer.findAllByScope({
          generationAttemptNo: toolMutationState.generationAttemptNo,
          scope,
          scopeId,
          accountId: context.accountId,
        });
        for (const entry of bufferedEntries) {
          merged.set(entry.key, entry);
        }
      }
    }

    return merged;
  }
}
