import type { MemoryScope } from '@tavern/shared';
import type { CoreEventBus } from '../events/index.js';
import type { MemoryRepository } from '../ports/memory-repository.js';
import type { TokenCounter } from '../prompt/types.js';
import type {
  MemoryAccessOptions,
  MemoryConsolidationOutput,
  MemoryInjectionOptions,
  MemoryInjectionResult,
  MemoryItem,
  MemoryQuery,
} from './types.js';
import { MemoryMutationApplier } from './memory-mutation-applier.js';
import { MemoryInjectionSelector } from './memory-injection-selector.js';
import {
  MemoryScopeResolver,
  type MemoryScopeResolutionContext,
} from './memory-scope-resolver.js';

// ── MemoryStore ───────────────────────────────────────

/**
 * 记忆存储服务
 *
 * 职责：
 * - 包装 MemoryRepository 的 CRUD 操作并广播事件
 * - 将 extractSummaries 的输出存入记忆
 * - 按 token 预算查询并格式化记忆注入块
 * - 应用 MemoryConsolidator 的整理结果
 *
 * @example
 * ```typescript
 * const store = new MemoryStore(repo, eventBus, tokenCounter);
 *
 * // 摘要提取后存入记忆
 * await store.ingestSummaries(['Alice表白被拒'], 'chat', sessionId, floorId);
 *
 * // 编排时注入记忆
 * const injection = await store.prepareInjection(sessionId, { maxTokens: 200 });
 * ```
 */
export class MemoryStore {
  private readonly scopeResolver = new MemoryScopeResolver();

  constructor(
    private readonly repo: MemoryRepository,
    private readonly eventBus: CoreEventBus,
    private readonly counter: TokenCounter,
  ) {}

  private buildEventContext(item: MemoryItem): {
    sessionId?: string;
    scope: MemoryScope;
    scopeId: string;
    floorId?: string;
    sourceJobId?: string;
  } {
    return {
      sessionId: item.scope === 'chat' ? item.scopeId : undefined,
      scope: item.scope,
      scopeId: item.scopeId,
      ...(item.sourceFloorId ? { floorId: item.sourceFloorId } : {}),
      ...(item.sourceJobId ? { sourceJobId: item.sourceJobId } : {}),
    };
  }

  private createMutationApplier(context?: MemoryScopeResolutionContext): MemoryMutationApplier {
    const accountId = context?.accountId;
    const access = accountId ? { accountId } : undefined;

    return new MemoryMutationApplier(
      {
        findById: (id) => this.repo.findById(id, access),
        findMany: (query) => this.repo.findMany(accountId ? { ...query, accountId } : query),
        create: (item) => this.repo.create(item, access),
        update: (id, patch) => this.repo.update(id, patch, access),
        deprecate: (id) => this.repo.deprecate(id, access),
        createEdge: (edge) => this.repo.createEdge(edge, access),
      },
      this.scopeResolver,
      async (event) => {
        await this.eventBus.emit(event.name, event.payload as never);
      },
    );
  }

  /**
   * 将摘要提取结果存入记忆。
   *
   * 每条摘要创建一个 type='summary' 的记忆条目。
   * 默认 importance=0.5, confidence=1.0。
   *
   * @param summaries - extractSummaries 提取到的摘要列表
   * @param scope - 存储的作用域
   * @param scopeId - 作用域实体 ID
   * @param sourceFloorId - 来源楼层 ID（可选）
   * @returns 创建的记忆条目列表
   */
  async ingestSummaries(
    summaries: string[],
    scope: MemoryScope,
    scopeId: string,
    sourceFloorId?: string,
    context: MemoryScopeResolutionContext = {},
  ): Promise<MemoryItem[]> {
    if (summaries.length === 0) return [];

    const result = await this.createMutationApplier(context).ingestSummaries({
      summaries,
      defaultScope: scope,
      defaultScopeId: scopeId,
      context,
      sourceFloorId,
      source: 'extraction',
    });

    return result.items;
  }

  /**
   * 按预算查询并格式化记忆注入块。
   *
   * 默认策略：
   * 1. 查询活跃记忆，按 importance 降序排列
   * 2. 可选 balanced 模式：按类型顺序交错混排，支持每类型配额
   * 3. 逐条累加 token，超过预算时停止
   * 4. 将选中的条目格式化为文本
   *
   * @param scopeId - 作用域实体 ID
   * @param options - 注入选项
   * @returns 注入结果（选中条目 + 格式化文本 + token 数）
   */
  async prepareInjection(
    scopeId: string,
    options: MemoryInjectionOptions,
  ): Promise<MemoryInjectionResult> {
    const query: MemoryQuery = {
      status: 'active',
      orderBy: 'importance',
      lifecycleStatus: 'active',
      orderDir: 'desc',
      accountId: options.accountId,
    };

    if (options.scopeContext) {
      if (options.scope) {
        query.scope = options.scope;
        query.scopeId = this.scopeResolver.resolve(options.scope, options.scopeContext, scopeId);
      } else {
        const scopeRefs = this.scopeResolver.resolveVisibleRefs(options.scopeContext);
        if (scopeRefs.length > 0) {
          query.scopeRefs = scopeRefs;
        } else {
          query.scopeId = scopeId;
        }
      }
    } else {
      query.scopeId = scopeId;
      if (options.scope) {
        query.scope = options.scope;
      }
    }

    if (options.minImportance !== undefined) query.minImportance = options.minImportance;

    const baseLimit = options.maxItems ?? 50;
    const decayEnabled = !!options.decay && options.decay.halfLifeMs > 0;
    const dualSummaryEnabled = options.strategy === 'dual_summary';

    // 查询足够多的候选项（给 token 裁剪 / decay 重排留余量）
    query.limit = decayEnabled || dualSummaryEnabled
      ? Math.min(500, Math.max(baseLimit * 5, 100))
      : baseLimit;

    let candidates = await this.repo.findMany(query);

    return new MemoryInjectionSelector(this.counter).select(candidates, options);
  }

  /**
   * 应用 Memory 实例的整理结果。
   *
   * 处理三类操作：
   * - factsAdd: 创建新的 fact 记忆
   * - factsUpdate: 更新已有记忆的内容/重要度
   * - factsDeprecate: 标记记忆为过时
   *
   * 同时创建 turnSummary 作为 summary 类型的记忆。
   *
   * @param output - MemoryConsolidator 的输出
   * @param scope - 默认作用域
   * @param scopeId - 作用域实体 ID
   * @param sourceFloorId - 来源楼层 ID
   */
  async applyConsolidation(
    output: MemoryConsolidationOutput,
    scope: MemoryScope,
    scopeId: string,
    sourceFloorId: string,
    context: MemoryScopeResolutionContext = {},
  ): Promise<void> {
    await this.createMutationApplier(context).applyConsolidation({
      output,
      defaultScope: scope,
      defaultScopeId: scopeId,
      context,
      sourceFloorId,
    });
  }

  /**
   * 直接查询记忆。
   */
  async query(query: MemoryQuery): Promise<MemoryItem[]> {
    return this.repo.findMany(query);
  }

  /**
   * 标记记忆为过时。
   */
  async deprecate(id: string, reason: string, access: MemoryAccessOptions = {}): Promise<void> {
    const deprecated = await this.repo.deprecate(id, access);
    if (deprecated) {
      const eventContext = this.buildEventContext(deprecated);

      await this.eventBus.emit('memory.deprecated', {
        ...eventContext,
        item: deprecated,
        reason,
      });
    }
  }

  /**
   * 创建记忆条目（手动创建）。
   */
  async create(
    item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>,
    access: MemoryAccessOptions = {},
  ): Promise<MemoryItem> {
    const created = await this.repo.create(item, access);

    const eventContext = this.buildEventContext(created);

    await this.eventBus.emit('memory.created', {
      ...eventContext,
      item: created,
      source: 'manual',
    });

    return created;
  }
}
