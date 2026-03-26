import type { MemoryRelation, MemoryScope, MemoryType } from '@tavern/shared';
import type { CoreEventBus } from '../events/index.js';
import type { TokenCounter } from '../prompt/types.js';
import type { MemoryRepository } from '../ports/memory-repository.js';
import type {
  MemoryItem,
  MemoryQuery,
  MemoryConsolidationOutput,
  MemoryInjectionOptions,
  MemoryInjectionResult,
} from './types.js';

// ── 内部工具 ──────────────────────────────────────────

/**
 * 将记忆条目列表格式化为可注入到提示词中的文本块。
 *
 * 格式：
 * ```
 * [Memory]
 * - (fact) key: value
 * - (summary) 摘要内容
 * ```
 */
function formatMemoryItems(items: MemoryItem[]): string {
  if (items.length === 0) return '';

  const lines = items.map((item) => {
    if (item.type === 'fact' && item.factKey) {
      const normalizedContent = item.content.trim().toLowerCase();
      const startsWithKey = normalizedContent.startsWith(`${item.factKey}:`)
        || normalizedContent.startsWith(`${item.factKey}：`);

      return `- (${item.type}) ${startsWithKey ? item.content : `${item.factKey}: ${item.content}`}`;
    }

    return `- (${item.type}) ${item.content}`;
  });

  return `[Memory]\n${lines.join('\n')}`;
}

function normalizeFactKey(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function resolveFactAddKey(
  fact: MemoryConsolidationOutput['factsAdd'][number],
): string | undefined {
  const rawKey = fact.factKey ?? fact.key;
  if (!rawKey) return undefined;

  const normalized = normalizeFactKey(rawKey);
  return normalized.length > 0 ? normalized : undefined;
}

function compareFactItemsForConflictResolution(
  a: MemoryItem,
  b: MemoryItem,
  preferredIds: Set<string>,
): number {
  const aPreferred = preferredIds.has(a.id);
  const bPreferred = preferredIds.has(b.id);
  if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;

  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.importance !== b.importance) return b.importance - a.importance;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;

  return b.id.localeCompare(a.id);
}

const BALANCED_DEFAULT_ORDER: MemoryType[] = ['open_loop', 'fact', 'summary'];

function resolveBalancedOrder(
  includeTypes: MemoryType[] | undefined,
  customOrder: MemoryType[] | undefined,
): MemoryType[] {
  const includeSet = includeTypes && includeTypes.length > 0
    ? new Set(includeTypes)
    : undefined;

  const baseOrder = customOrder && customOrder.length > 0
    ? customOrder
    : BALANCED_DEFAULT_ORDER;

  const normalized = baseOrder.filter((type) => includeSet ? includeSet.has(type) : true);

  if (includeSet) {
    for (const type of includeSet) {
      if (!normalized.includes(type)) {
        normalized.push(type);
      }
    }
  }

  if (normalized.length > 0) {
    return normalized;
  }

  return [...BALANCED_DEFAULT_ORDER];
}

function selectBalancedCandidates(
  candidates: MemoryItem[],
  order: MemoryType[],
  typeMaxItems: Partial<Record<MemoryType, number>> | undefined,
): MemoryItem[] {
  const buckets = new Map<MemoryType, MemoryItem[]>();
  for (const type of order) {
    buckets.set(type, []);
  }

  for (const item of candidates) {
    const bucket = buckets.get(item.type);
    if (!bucket) continue;

    const maxForType = typeMaxItems?.[item.type];
    if (maxForType !== undefined && maxForType >= 0 && bucket.length >= maxForType) {
      continue;
    }

    bucket.push(item);
  }

  const mixed: MemoryItem[] = [];
  let hasRemaining = true;

  while (hasRemaining) {
    hasRemaining = false;
    for (const type of order) {
      const bucket = buckets.get(type);
      if (!bucket || bucket.length === 0) continue;
      mixed.push(bucket.shift()!);
      hasRemaining = true;
    }
  }

  return mixed;
}

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
  constructor(
    private readonly repo: MemoryRepository,
    private readonly eventBus: CoreEventBus,
    private readonly counter: TokenCounter,
  ) {}

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
  ): Promise<MemoryItem[]> {
    if (summaries.length === 0) return [];

    const created: MemoryItem[] = [];

    for (const summary of summaries) {
      const trimmed = summary.trim();
      if (!trimmed) continue;

      const item = await this.repo.create({
        scope,
        scopeId,
        type: 'summary',
        content: trimmed,
        importance: 0.5,
        confidence: 1.0,
        sourceFloorId,
        status: 'active',
      });

      created.push(item);

      await this.eventBus.emit('memory.created', {
        item,
        source: 'extraction',
      });
    }

    return created;
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
      scopeId,
      status: 'active',
      orderBy: 'importance',
      orderDir: 'desc',
    };

    if (options.scope) query.scope = options.scope;
    if (options.minImportance !== undefined) query.minImportance = options.minImportance;

    const baseLimit = options.maxItems ?? 50;
    const decayEnabled = !!options.decay && options.decay.halfLifeMs > 0;

    // 查询足够多的候选项（给 token 裁剪 / decay 重排留余量）
    query.limit = decayEnabled
      ? Math.min(500, Math.max(baseLimit * 5, 100))
      : baseLimit;

    let candidates = await this.repo.findMany(query);

    // 按类型过滤
    const includeTypes = options.includeTypes;
    if (includeTypes && includeTypes.length > 0) {
      const typeSet = new Set(options.includeTypes);
      candidates = candidates.filter((item) => typeSet.has(item.type));
    }

    if (decayEnabled) {
      const decay = options.decay!;
      const now = options.now ?? Date.now();
      const by = decay.by ?? 'updatedAt';
      const halfLifeMs = decay.halfLifeMs;
      const minFactor = Math.max(0, Math.min(1, decay.minFactor ?? 0.05));

      const scored = candidates.map((item) => {
        const ts = by === 'createdAt' ? item.createdAt : item.updatedAt;
        const ageMs = Math.max(0, now - ts);
        const rawFactor = Math.pow(0.5, ageMs / halfLifeMs);
        const factor = Math.max(minFactor, rawFactor);
        const score = item.importance * factor;
        return { item, score };
      });

      scored.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.item.updatedAt !== b.item.updatedAt) return b.item.updatedAt - a.item.updatedAt;
        if (a.item.importance !== b.item.importance) return b.item.importance - a.item.importance;
        return b.item.id.localeCompare(a.item.id);
      });

      candidates = scored.map(({ item }) => item);
    }

    if (options.selectionMode === 'balanced') {
      const order = resolveBalancedOrder(includeTypes, options.typeOrder);
      candidates = selectBalancedCandidates(candidates, order, options.typeMaxItems);
    }

    // 按 token 预算裁剪
    const selected: MemoryItem[] = [];
    let totalTokens = 0;
    // "[Memory]\n" 的基础开销
    const headerTokens = this.counter.count('[Memory]\n');
    totalTokens += headerTokens;

    const globalMaxItems = options.maxItems;

    for (const item of candidates) {
      const lineText = `- (${item.type}) ${item.content}\n`;
      const lineTokens = this.counter.count(lineText);

      if (totalTokens + lineTokens > options.maxTokens) break;

      selected.push(item);
      totalTokens += lineTokens;

      if (globalMaxItems && selected.length >= globalMaxItems) break;
    }

    // 如果没有选中任何条目，返回空结果
    if (selected.length === 0) {
      return { items: [], formattedText: '', tokenCount: 0 };
    }

    const formattedText = formatMemoryItems(selected);
    const tokenCount = this.counter.count(formattedText);

    return { items: selected, formattedText, tokenCount };
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
  ): Promise<void> {
    let createdCount = 0;
    let updatedCount = 0;
    let deprecatedCount = 0;

    const touchedFactKeysByScope = new Map<MemoryScope, Set<string>>();
    const touchedFactItemIds = new Set<string>();

    const markTouchedFactKey = (factScope: MemoryScope, key: string | undefined) => {
      if (!key) return;
      const normalized = normalizeFactKey(key);
      if (!normalized) return;

      const set = touchedFactKeysByScope.get(factScope) ?? new Set<string>();
      set.add(normalized);
      touchedFactKeysByScope.set(factScope, set);
    };

    // 1. 存储 turnSummary
    if (output.turnSummary?.trim()) {
      const item = await this.repo.create({
        scope,
        scopeId,
        type: 'summary',
        content: output.turnSummary.trim(),
        importance: 0.6,
        confidence: 1.0,
        sourceFloorId,
        status: 'active',
      });

      await this.eventBus.emit('memory.created', {
        item,
        source: 'consolidation',
      });
      createdCount++;
    }

    // 2. 新增 facts
    for (const fact of output.factsAdd) {
      const factKey = resolveFactAddKey(fact);
      markTouchedFactKey(fact.scope ?? scope, factKey);
      const factContent = factKey ? `${factKey}: ${fact.value}` : fact.value;
      const item = await this.repo.create({
        scope: fact.scope ?? scope,
        scopeId,
        type: 'fact',
        content: factContent,
        factKey,
        importance: fact.importance ?? 0.5,
        confidence: 1.0,
        sourceFloorId,
        status: 'active',
      });

      touchedFactItemIds.add(item.id);

      await this.eventBus.emit('memory.created', {
        item,
        source: 'consolidation',
      });
      createdCount++;
    }

    // 3. 更新已有 facts
    for (const update of output.factsUpdate) {
      const existing = await this.repo.findById(update.id);
      if (!existing) continue;

      const previousContent = existing.content;
      const patch: Partial<Pick<MemoryItem, 'content' | 'factKey' | 'importance' | 'confidence' | 'status'>> = {
        content: update.value,
        ...(update.factKey !== undefined ? { factKey: normalizeFactKey(update.factKey) } : {}),
      };
      if (update.importance !== undefined) {
        patch.importance = update.importance;
      }

      const updated = await this.repo.update(update.id, patch);
      if (updated) {
        touchedFactItemIds.add(updated.id);
        markTouchedFactKey(updated.scope, updated.factKey ?? normalizeFactKey(update.factKey));

        await this.eventBus.emit('memory.updated', {
          item: updated,
          previousContent,
        });
        updatedCount++;
      }
    }

    // 4. 标记过时
    for (const dep of output.factsDeprecate) {
      const deprecated = await this.repo.deprecate(dep.id);
      if (deprecated) {
        await this.eventBus.emit('memory.deprecated', {
          item: deprecated,
          reason: dep.reason,
        });
        deprecatedCount++;
      }
    }

    // 5. 自动冲突消解：同一 key 只保留最新/本轮触达的 active fact
    for (const [factScope, touchedKeys] of touchedFactKeysByScope) {
      if (touchedKeys.size === 0) continue;

      const activeFacts = await this.repo.findMany({
        scope: factScope,
        scopeId,
        type: 'fact',
        status: 'active',
        limit: 1000,
        orderBy: 'updatedAt',
        orderDir: 'desc',
      });

      const grouped = new Map<string, MemoryItem[]>();
      for (const item of activeFacts) {
        const key = item.factKey;
        if (!key || !touchedKeys.has(key)) continue;

        const bucket = grouped.get(key);
        if (bucket) {
          bucket.push(item);
        } else {
          grouped.set(key, [item]);
        }
      }

      for (const [key, items] of grouped) {
        if (items.length <= 1) continue;

        const sorted = [...items].sort((a, b) =>
          compareFactItemsForConflictResolution(a, b, touchedFactItemIds)
        );

        const winner = sorted[0]!;
        for (const other of sorted.slice(1)) {
          const deprecated = await this.repo.deprecate(other.id);
          if (!deprecated) continue;

          await this.eventBus.emit('memory.deprecated', {
            item: deprecated,
            reason: `conflict_resolution:${key}`,
          });
          deprecatedCount++;

          // Best-effort：记录关系边（winner updates old）
          try {
            const relation: MemoryRelation = 'updates';
            await this.repo.createEdge({
              fromId: winner.id,
              toId: deprecated.id,
              relation,
            });
          } catch {
            // ignore
          }
        }
      }
    }

    // 6. 广播整理完成事件
    await this.eventBus.emit('memory.consolidated', {
      floorId: sourceFloorId,
      created: createdCount,
      updated: updatedCount,
      deprecated: deprecatedCount,
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
  async deprecate(id: string, reason: string): Promise<void> {
    const deprecated = await this.repo.deprecate(id);
    if (deprecated) {
      await this.eventBus.emit('memory.deprecated', {
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
  ): Promise<MemoryItem> {
    const created = await this.repo.create(item);

    await this.eventBus.emit('memory.created', {
      item: created,
      source: 'manual',
    });

    return created;
  }
}
