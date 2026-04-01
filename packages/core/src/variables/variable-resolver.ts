import { SCOPE_PRIORITY, buildBranchVariableScopeId, type VariableScope, type VariableEntry } from '@tavern/shared';
import type { VariableContext } from '../types.js';
import type { VariableRepository, VariableRepositoryOptions } from '../ports/index.js';

/** scope → VariableContext 中对应字段的映射 */
type ScopeContextKey = 'pageId' | 'floorId' | 'sessionId' | 'globalScopeId';

const SCOPE_TO_CONTEXT_KEY: Partial<Record<VariableScope, ScopeContextKey>> = {
  page: 'pageId',
  floor: 'floorId',
  chat: 'sessionId',
  global: 'globalScopeId',
};

/** 默认的全局 scope ID */
const DEFAULT_GLOBAL_SCOPE_ID = 'global';

/**
 * 获取 context 中某个 scope 对应的 scopeId
 * global 如果未设置则使用默认值 'global'
 */
function getScopeId(scope: VariableScope, context: VariableContext): string | undefined {
  if (scope === 'branch') {
    if (!context.sessionId || !context.branchId) {
      return undefined;
    }

    return buildBranchVariableScopeId(context.sessionId, context.branchId);
  }

  const key = SCOPE_TO_CONTEXT_KEY[scope];
  if (!key) return undefined;
  const value = context[key];
  if (value !== undefined) return value;
  if (scope === 'global') return DEFAULT_GLOBAL_SCOPE_ID;
  return undefined;
}

function getRepositoryOptions(context: VariableContext): VariableRepositoryOptions | undefined {
  if (context.accountId === undefined) {
    return undefined;
  }

  return { accountId: context.accountId };
}

function getToolMutationState(context: VariableContext): {
  buffer: NonNullable<VariableContext['toolMutationBuffer']>;
  generationAttemptNo: number;
} | null {
  if (!context.toolMutationBuffer) {
    return null;
  }

  const attemptNo = context.toolMutationAttemptNo;

  if (typeof attemptNo !== 'number' || !Number.isInteger(attemptNo) || attemptNo < 1) {
    return null;
  }

  return { buffer: context.toolMutationBuffer, generationAttemptNo: attemptNo };
}

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
    const repoOptions = getRepositoryOptions(context);
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
    const repoOptions = getRepositoryOptions(context);
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
