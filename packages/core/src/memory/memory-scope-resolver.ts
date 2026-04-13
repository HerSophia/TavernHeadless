import {
  MEMORY_SCOPES,
  buildBranchMemoryScopeId,
  type MemoryScope,
} from '@tavern/shared';

import type { MemoryScopeContext, MemoryScopeRef } from './types.js';

export type MemoryScopeResolutionContext = MemoryScopeContext;

export type ResolvedMemoryScopeRef = MemoryScopeRef;

function normalizeScopeId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export class MemoryScopeResolutionError extends Error {
  constructor(scope: MemoryScope, missingField: 'accountId' | 'sessionId' | 'branchId' | 'floorId') {
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

    if (scope === 'chat') {
      const sessionId = normalizeScopeId(context.sessionId);
      if (sessionId) {
        return sessionId;
      }

      const fallback = normalizeScopeId(fallbackScopeId);
      if (fallback) {
        return fallback;
      }

      throw new MemoryScopeResolutionError(scope, 'sessionId');
    }

    if (scope === 'branch') {
      const sessionId = normalizeScopeId(context.sessionId);
      const branchId = normalizeScopeId(context.branchId);
      if (sessionId && branchId) {
        return buildBranchMemoryScopeId(sessionId, branchId);
      }

      const fallback = normalizeScopeId(fallbackScopeId);
      if (fallback) {
        return fallback;
      }

      throw new MemoryScopeResolutionError(scope, sessionId ? 'branchId' : 'sessionId');
    }

    const floorId = normalizeScopeId(context.floorId);
    if (floorId) {
      return floorId;
    }

    const fallback = normalizeScopeId(fallbackScopeId);
    if (fallback) {
      return fallback;
    }

    throw new MemoryScopeResolutionError(scope, 'floorId');
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

  resolveVisibleRefs(
    context: MemoryScopeResolutionContext,
    scopes: readonly MemoryScope[] = MEMORY_SCOPES,
  ): ResolvedMemoryScopeRef[] {
    const resolved: ResolvedMemoryScopeRef[] = [];
    const accountId = normalizeScopeId(context.accountId);
    const sessionId = normalizeScopeId(context.sessionId);
    const branchId = normalizeScopeId(context.branchId);
    const floorId = normalizeScopeId(context.floorId);
    const hasBranchContext = !!sessionId && !!branchId;

    for (const scope of scopes) {
      if (scope === 'global') {
        if (accountId) {
          resolved.push({ scope, scopeId: accountId });
        }
        continue;
      }

      if (scope === 'chat') {
        if (!hasBranchContext && sessionId) {
          resolved.push({ scope, scopeId: sessionId });
        }
        continue;
      }

      if (scope === 'branch') {
        if (hasBranchContext) {
          resolved.push({ scope, scopeId: buildBranchMemoryScopeId(sessionId, branchId) });
        }
        continue;
      }

      if (floorId) {
        resolved.push({ scope, scopeId: floorId });
      }
    }

    return resolved;
  }
}
