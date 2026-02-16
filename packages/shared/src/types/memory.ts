// ── 记忆作用域（比变量少 page 级，记忆不需要页级隔离） ──
export const MEMORY_SCOPES = ['global', 'chat', 'floor'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

// ── 记忆类型 ──
export const MEMORY_TYPES = ['fact', 'summary', 'open_loop'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

// ── 记忆状态 ──
export const MEMORY_STATUSES = ['active', 'deprecated'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

// ── 记忆关系类型 ──
export const MEMORY_RELATIONS = ['supports', 'contradicts', 'updates'] as const;
export type MemoryRelation = (typeof MEMORY_RELATIONS)[number];
