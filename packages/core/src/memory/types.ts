// ── 记忆领域类型 ──────────────────────────────────────

import type {
  MemoryLifecycleStatus,
  MemoryRelation,
  MemoryScope,
  MemoryStatus,
  MemorySummaryTier,
  MemoryType,
} from '@tavern/shared';

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
  /** type=summary 时可区分 micro / macro；其余类型通常为空 */
  summaryTier?: MemorySummaryTier;
  /** 纯文本内容 */
  content: string;
  /** fact 类型的结构化键。summary / open_loop 通常为空 */
  factKey?: string;
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
  /** V2 生命周期状态；Phase 1 起为 schema 一等字段 */
  lifecycleStatus?: MemoryLifecycleStatus;
  /** 来源异步作业 ID */
  sourceJobId?: string;
  /** 文本 token 估计值 */
  tokenCountEstimate?: number;
  /** 最近一次注入时间 */
  lastUsedAt?: number;
  /** summary 覆盖起始 floorNo */
  coverageStartFloorNo?: number;
  /** summary 覆盖结束 floorNo */
  coverageEndFloorNo?: number;
  /** macro summary 压缩来源数量 */
  derivedFromCount?: number;
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
export interface MemoryAccessOptions {
  accountId?: string;
}

export interface MemoryScopeContext {
  accountId?: string;
  sessionId?: string;
  branchId?: string;
  floorId?: string;
}

export interface MemoryScopeRef {
  scope: MemoryScope;
  scopeId: string;
}

export interface MemoryQuery {
  /** 限定作用域 */
  scope?: MemoryScope;
  /** 限定 scope 实体 ID */
  scopeId?: string;
  /** 同时查询多个可见 scope；提供时优先于 scope / scopeId */
  scopeRefs?: MemoryScopeRef[];
  /** 限定类型 */
  type?: MemoryType;
  /** 限定摘要分层（仅 summary 类型有效） */
  summaryTier?: MemorySummaryTier;
  /** 限定状态 */
  status?: MemoryStatus;
  /** 限定生命周期状态 */
  lifecycleStatus?: MemoryLifecycleStatus;
  /** 最低重要度阈值 */
  minImportance?: number;
  /** 限定结构化 factKey（仅 fact 类型有效） */
  factKey?: string;
  /** 最大返回条数 */
  limit?: number;
  /** 排序字段 */
  orderBy?: 'importance' | 'createdAt' | 'updatedAt';
  /** 排序方向 */
  orderDir?: 'asc' | 'desc';
  /** 当前账户 ID（多账号场景下必须传入） */
  accountId?: string;
}

/**
 * Memory LLM 实例的结构化输出格式
 *
 * 对应架构文档中 Memory 实例的 JSON 输出。
 */
export interface MemoryFactAddOperation {
  /** 新事实的结构化键。 */
  factKey?: string;
  /** @deprecated 使用 factKey。 */
  key?: string;
  value: string;
  /** 未显式提供时使用默认作用域。 */
  scope?: MemoryScope;
  importance?: number;
}

export interface MemoryFactUpdateOperation {
  id: string;
  value: string;
  factKey?: string;
  importance?: number;
}

export interface MemoryFactDeprecateOperation {
  id: string;
  reason: string;
}

export interface MemoryOpenLoopAddOperation {
  content: string;
  /** 未显式提供时使用默认作用域。 */
  scope?: MemoryScope;
  importance?: number;
}

export interface MemoryOpenLoopResolveOperation {
  id: string;
  resolution: string;
}

export interface MemoryConsolidationOutput {
  /** 本回合摘要 */
  turnSummary: string;
  /** 新增事实。factKey 为推荐字段，key 为兼容旧输出。 */
  factsAdd: MemoryFactAddOperation[];
  /**
   * 更新已有事实。
   *
   * 事实的主键仍以已落库的 factKey 为准。
   * 对于旧数据或需要显式回填 factKey 的场景，可附带 factKey。
   */
  factsUpdate: MemoryFactUpdateOperation[];
  /** 标记过时 */
  factsDeprecate: MemoryFactDeprecateOperation[];
}

/**
 * `ingest_turn` 异步作业的标准化输出。
 *
 * Phase 3 起由 worker-side MemoryIngestProcessor 使用。
 */
export interface MemoryIngestOutput {
  /** 当前 committed floor 的 micro summary。允许为空字符串。 */
  microSummary: string;
  factsAdd: MemoryFactAddOperation[];
  factsUpdate: MemoryFactUpdateOperation[];
  factsDeprecate: MemoryFactDeprecateOperation[];
  openLoopsAdd: MemoryOpenLoopAddOperation[];
  openLoopsResolve: MemoryOpenLoopResolveOperation[];
}

/**
 * `compact_macro` 异步作业的标准化输出。
 *
 * Phase 4 起由 worker-side MemoryCompactionProcessor 使用。
 */
export interface MemoryCompactionOutput {
  /** 选定 micro summaries 的 macro summary。 */
  macroSummary: string;
  factsAdd: MemoryFactAddOperation[];
  factsUpdate: MemoryFactUpdateOperation[];
  factsDeprecate: MemoryFactDeprecateOperation[];
  openLoopsAdd: MemoryOpenLoopAddOperation[];
  openLoopsResolve: MemoryOpenLoopResolveOperation[];
  /** 实际参与本次压缩的 source micro summary IDs。 */
  sourceMicroIds: string[];
}

export type MemoryInjectionStrategy = 'legacy' | 'dual_summary';

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
  /** 注入策略：legacy 保持当前行为，dual_summary 启用 micro / macro 双层预算。 */
  strategy?: MemoryInjectionStrategy;
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
  /** 按 global / chat / floor 可见范围补齐主链检索语义时使用的上下文 */
  scopeContext?: MemoryScopeContext;
  /** 限定作用域 */
  scope?: MemoryScope;
  /** 当前账户 ID（多账号场景下必须传入） */
  accountId?: string;
  /**
   * 严格 visible-refs 模式开关。
   *
   * 默认关闭：当 `scopeContext` 给出但 `resolveVisibleRefs()` 返回
   * 空集合时，仍然回退到直接 `scopeId` 查询，与历史行为兼容；
   * 但本次回退会被记录为显式 `direct_scope_fallback` 诊断。
   *
   * 打开后（`strictVisibleRefs: true`）：相同情况下不再回退，
   * `prepareInjection()` 直接返回空结果，并把诊断模式标为
   * `strict_empty`。仅推荐用于 explain / debug / 测试场景，
   * 第一轮不在生产默认启用。
   */
  strictVisibleRefs?: boolean;
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
  /**
   * scope-resolution 诊断。
   *
   * `prepareInjection()` 在 visible-refs 路径上是否发生退化的真实记录，
   * 供 explain / debug 接口透传给观察方，避免静默把退化当作正常行为。
   */
  scopeResolution?: MemoryScopeResolutionDiagnostic;
}

/** scope-resolution 诊断模式 */
export type MemoryScopeResolutionMode =
  | 'visible_refs'
  | 'direct_scope_fallback'
  | 'strict_empty'
  | 'direct_scope';

/** scope-resolution 诊断状态 */
export type MemoryScopeResolutionStatus =
  | 'ok'
  | 'empty_visible_refs'
  | 'resolver_error';

/**
 * scope-resolution 诊断结构。
 *
 * - `requestedMode`：调用方期望的解析模式（有 scopeContext 时为
 *   `visible_refs`，否则为 `direct_scope`）。
 * - `actualMode`：实际生效模式：
 *   - `visible_refs`：按可见范围注入；
 *   - `direct_scope`：调用方就期望直接 scope 查询；
 *   - `direct_scope_fallback`：期望可见范围但回退到了直接 scope；
 *   - `strict_empty`：strictVisibleRefs 打开时的空结果。
 * - `status`：解析过程的健康状态。
 * - `requestedScope`：调用方请求的 scope/scopeId。
 * - `resolvedScopeRefs`：实际查询使用的 scopeRefs（visible_refs 模式）。
 * - `fallbackReason`：触发回退/strict 空集时的简短原因。
 */
export interface MemoryScopeResolutionDiagnostic {
  requestedMode: 'visible_refs' | 'direct_scope';
  actualMode: MemoryScopeResolutionMode;
  status: MemoryScopeResolutionStatus;
  requestedScope: {
    scope?: MemoryScope;
    scopeId: string;
  };
  resolvedScopeRefs?: Array<{ scope: MemoryScope; scopeId: string }>;
  fallbackReason?: string;
}
