export const SCOPE_PRIORITY = ['page', 'floor', 'branch', 'chat', 'global'] as const;
export type VariableScope = (typeof SCOPE_PRIORITY)[number];

export interface BranchVariableScopeRef {
  sessionId: string;
  branchId: string;
}

const BRANCH_SCOPE_ID_PREFIX = 'branch';

/**
 * 构造 branch 作用域的内部 scopeId。
 *
 * branchId 只在单个 session 内唯一，因此内部持久化时必须同时编码
 * sessionId 和 branchId，避免不同 session 的同名 branch 冲突。
 */
export function buildBranchVariableScopeId(sessionId: string, branchId: string): string {
  if (sessionId.length === 0) {
    throw new Error('sessionId cannot be empty');
  }

  if (branchId.length === 0) {
    throw new Error('branchId cannot be empty');
  }

  return `${BRANCH_SCOPE_ID_PREFIX}:${encodeURIComponent(sessionId)}:${encodeURIComponent(branchId)}`;
}

/**
 * 解析 branch 作用域的内部 scopeId。
 * 解析失败时返回 null。
 */
export function parseBranchVariableScopeId(scopeId: string): BranchVariableScopeRef | null {
  const parts = scopeId.split(':');
  if (parts.length !== 3 || parts[0] !== BRANCH_SCOPE_ID_PREFIX) {
    return null;
  }

  const sessionId = safeDecodeURIComponent(parts[1]);
  const branchId = safeDecodeURIComponent(parts[2]);

  if (!sessionId || !branchId) {
    return null;
  }

  return { sessionId, branchId };
}

/** 判断一个 scopeId 是否为合法的 branch 作用域内部编码。 */
export function isBranchVariableScopeId(scopeId: string): boolean {
  return parseBranchVariableScopeId(scopeId) !== null;
}

function safeDecodeURIComponent(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** 变量条目（已从 JSON 解析的领域对象） */
export interface VariableEntry {
  id: string;
  scope: VariableScope;
  scopeId: string;
  key: string;
  value: unknown;
  updatedAt: number;
}
