// ── 记忆领域类型 ──────────────────────────────────────

import type { MemoryScope, MemoryType, MemoryStatus, MemoryRelation } from '@tavern/shared';

/**
 * 记忆条目领域对象
 *
 * 与 DB row 解耦，由 MemoryRepository 返回。
 * content 为纯文本（DB 中以 JSON 存储）。
 */
export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  scopeId: string;
  type: MemoryType;
  /** 纯文本内容 */
  content: string;
  /** 重要度 0-1 */
  importance: number;
  /** 置信度 0-1 */
  confidence: number;
  /** 来源楼层 ID */
  sourceFloorId?: string;
  /** 来源消息 ID */
  sourceMessageId?: string;
  /** 条目状态 */
  status: MemoryStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * 记忆关系边
 *
 * 描述两条记忆之间的关系：支持、矛盾、更新。
 */
export interface MemoryEdge {
  id: string;
  fromId: string;
  toId: string;
  relation: MemoryRelation;
  createdAt: number;
}

/**
 * 记忆查询过滤器
 *
 * 所有字段可选，组合使用实现灵活查询。
 */
export interface MemoryQuery {
  /** 限定作用域 */
  scope?: MemoryScope;
  /** 限定 scope 实体 ID */
  scopeId?: string;
  /** 限定类型 */
  type?: MemoryType;
  /** 限定状态 */
  status?: MemoryStatus;
  /** 最低重要度阈值 */
  minImportance?: number;
  /** 最大返回条数 */
  limit?: number;
  /** 排序字段 */
  orderBy?: 'importance' | 'createdAt' | 'updatedAt';
  /** 排序方向 */
  orderDir?: 'asc' | 'desc';
}

/**
 * Memory LLM 实例的结构化输出格式
 *
 * 对应架构文档中 Memory 实例的 JSON 输出。
 */
export interface MemoryConsolidationOutput {
  /** 本回合摘要 */
  turnSummary: string;
  /** 新增事实 */
  factsAdd: {
    key: string;
    value: string;
    scope: MemoryScope;
    importance?: number;
  }[];
  /** 更新已有事实 */
  factsUpdate: {
    id: string;
    value: string;
    importance?: number;
  }[];
  /** 标记过时 */
  factsDeprecate: {
    id: string;
    reason: string;
  }[];
}

/**
 * 记忆注入选项
 *
 * 控制编排器从 MemoryStore 中选取哪些记忆注入到提示词中。
 */
export interface MemoryInjectionOptions {
  /** 记忆可用 token 预算 */
  maxTokens: number;
  /** 最大条目数 */
  maxItems?: number;
  /** 最低重要度阈值 */
  minImportance?: number;
  /** 包含的记忆类型 */
  includeTypes?: MemoryType[];
  /** 选择策略（默认 importance） */
  selectionMode?: 'importance' | 'balanced';
  /** balanced 模式下的类型顺序 */
  typeOrder?: MemoryType[];
  /** balanced 模式下各类型最多条目数 */
  typeMaxItems?: Partial<Record<MemoryType, number>>;
  /** 注入时使用的“当前时间”（ms），用于可测试的衰减；默认 Date.now() */
  now?: number;
  /** 可选：对重要度进行时间衰减后再排序（effectiveScore = importance * decayFactor） */
  decay?: {
    /** 半衰期（ms）。age=halfLife 时 decayFactor=0.5 */
    halfLifeMs: number;
    /** decayFactor 的下限，避免过旧条目完全归零（默认 0.05） */
    minFactor?: number;
    /** 使用哪个时间字段计算 age（默认 updatedAt） */
    by?: 'updatedAt' | 'createdAt';
  };
  /** 限定作用域 */
  scope?: MemoryScope;
}

/**
 * 记忆注入结果
 *
 * 由 MemoryStore.prepareInjection 返回，供编排器使用。
 */
export interface MemoryInjectionResult {
  /** 被选中的记忆条目 */
  items: MemoryItem[];
  /** 格式化后的注入文本 */
  formattedText: string;
  /** 估算 token 数 */
  tokenCount: number;
}
