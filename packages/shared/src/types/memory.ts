export interface BranchMemoryScopeRef {
  sessionId: string;
  branchId: string;
}

// ── 记忆作用域（比变量少 page 级，记忆不需要页级隔离） ──
export const MEMORY_SCOPES = ['global', 'chat', 'branch', 'floor'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/**
 * 构造 branch 记忆作用域的内部 scopeId。
 *
 * 记忆 branch scope 需要同时编码 sessionId 和 branchId，避免不同 session
 * 的同名 branch 冲突。
 */
export function buildBranchMemoryScopeId(sessionId: string, branchId: string): string {
  if (sessionId.length === 0) {
    throw new Error('sessionId cannot be empty');
  }

  if (branchId.length === 0) {
    throw new Error('branchId cannot be empty');
  }

  return JSON.stringify([sessionId, branchId]);
}

/**
 * 解析 branch 记忆作用域的内部 scopeId。
 * 解析失败时返回 null。
 */
export function parseBranchMemoryScopeId(scopeId: string): BranchMemoryScopeRef | null {
  try {
    const parsed = JSON.parse(scopeId) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      return null;
    }

    const [sessionId, branchId] = parsed;
    if (typeof sessionId !== 'string' || typeof branchId !== 'string') {
      return null;
    }

    if (sessionId.length === 0 || branchId.length === 0) {
      return null;
    }

    return { sessionId, branchId };
  } catch {
    return null;
  }
}

/** 判断一个 scopeId 是否为合法的 branch 记忆作用域编码。 */
export function isBranchMemoryScopeId(scopeId: string): boolean {
  return parseBranchMemoryScopeId(scopeId) !== null;
}

// ── 记忆类型 ──
export const MEMORY_TYPES = ['fact', 'summary', 'open_loop'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

// ── 摘要分层 ──
export const MEMORY_SUMMARY_TIERS = ['micro', 'macro'] as const;
export type MemorySummaryTier = (typeof MEMORY_SUMMARY_TIERS)[number];

// ── 记忆状态 ──
export const MEMORY_STATUSES = ['active', 'deprecated'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

// ── 记忆生命周期状态 ──
export const MEMORY_LIFECYCLE_STATUSES = ['active', 'compacted', 'deprecated'] as const;
export type MemoryLifecycleStatus = (typeof MEMORY_LIFECYCLE_STATUSES)[number];

// ── 记忆关系类型 ──
export const MEMORY_RELATIONS = [
  'supports',
  'contradicts',
  'updates',
  'derived_from',
  'compacts',
  'resolves',
] as const;
export type MemoryRelation = (typeof MEMORY_RELATIONS)[number];

// ── 记忆作业类型 ──
export const MEMORY_JOB_TYPES = ['ingest_turn', 'compact_macro', 'maintenance', 'rebuild_scope'] as const;
export type MemoryJobType = (typeof MEMORY_JOB_TYPES)[number];

// ── 记忆作业状态 ──
export const MEMORY_JOB_STATUSES = [
  'pending',
  'leased',
  'running',
  'retry_waiting',
  'succeeded',
  'dead_letter',
  'cancelled',
] as const;
export type MemoryJobStatus = (typeof MEMORY_JOB_STATUSES)[number];
