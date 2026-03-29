import type { MemoryScope } from '@tavern/shared';

export interface MemoryScopeResolutionContext {
  accountId?: string;
  sessionId?: string;
  floorId?: string;
}

export interface ResolvedMemoryScopeRef {
  scope: MemoryScope;
  scopeId: string;
}

function normalizeScopeId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export class MemoryScopeResolutionError extends Error {
  constructor(scope: MemoryScope, missingField: 'accountId' | 'sessionId' | 'floorId') {
    super(`Cannot resolve memory scopeId for scope '${scope}': missing ${missingField}`);
    this.name = 'MemoryScopeResolutionError';
  }
}

export class MemoryScopeResolver {
  resolve(
    scope: MemoryScope,
    context: MemoryScopeResolutionContext,
    fallbackScopeId?: string,
  ): string {
    if (scope === 'global') {
      const accountId = normalizeScopeId(context.accountId);
      if (!accountId) {
        throw new MemoryScopeResolutionError(scope, 'accountId');
      }

      return accountId;
    }

    const primary = scope === 'chat'
      ? normalizeScopeId(context.sessionId)
      : normalizeScopeId(context.floorId);

    if (primary) {
      return primary;
    }

    const fallback = normalizeScopeId(fallbackScopeId);
    if (fallback) {
      return fallback;
    }

    throw new MemoryScopeResolutionError(scope, scope === 'chat' ? 'sessionId' : 'floorId');
  }

  resolveRef(
    scope: MemoryScope,
    context: MemoryScopeResolutionContext,
    fallbackScopeId?: string,
  ): ResolvedMemoryScopeRef {
    return {
      scope,
      scopeId: this.resolve(scope, context, fallbackScopeId),
    };
  }
}
