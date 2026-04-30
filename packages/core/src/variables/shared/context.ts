import { SCOPE_PRIORITY, buildBranchVariableScopeId, type VariableScope } from '@tavern/shared';

import type { VariableRepositoryOptions } from '../../ports/index.js';
import type { VariableContext } from '../../types.js';
import { MissingScopeIdError } from '../../errors.js';

export type ScopeContextKey = 'pageId' | 'floorId' | 'sessionId' | 'globalScopeId';

export const SCOPE_TO_CONTEXT_KEY: Partial<Record<VariableScope, ScopeContextKey>> = {
  page: 'pageId',
  floor: 'floorId',
  chat: 'sessionId',
  global: 'globalScopeId',
};

export const DEFAULT_GLOBAL_SCOPE_ID = 'global';

export function getScopeId(scope: VariableScope, context: VariableContext): string | undefined {
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

export function requireScopeId(scope: VariableScope, context: VariableContext): string {
  const id = getScopeId(scope, context);
  if (id === undefined) {
    throw new MissingScopeIdError(scope);
  }
  return id;
}

export function getEventContext(context?: Pick<VariableContext, 'sessionId' | 'branchId'>): {
  sessionId?: string;
  branchId?: string;
} {
  return {
    ...(context?.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context?.branchId ? { branchId: context.branchId } : {}),
  };
}

export function getRepositoryOptions(accountId?: string): VariableRepositoryOptions | undefined {
  if (accountId === undefined) {
    return undefined;
  }

  return { accountId };
}

export function getToolMutationState(context: VariableContext): {
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

export function findLowestAvailableScope(context: VariableContext): VariableScope {
  for (const scope of SCOPE_PRIORITY) {
    if (getScopeId(scope, context) !== undefined) {
      return scope;
    }
  }

  return 'global';
}
