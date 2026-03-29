// ── 记忆作用域（比变量少 page 级，记忆不需要页级隔离） ──
export const MEMORY_SCOPES = ['global', 'chat', 'floor'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

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
