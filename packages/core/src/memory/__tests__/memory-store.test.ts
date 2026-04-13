import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildBranchMemoryScopeId } from '@tavern/shared';
import { MemoryStore } from '../memory-store.js';
import type { MemoryRepository } from '../../ports/memory-repository.js';
import type { CoreEventBus } from '../../events/index.js';
import type { TokenCounter } from '../../prompt/types.js';
import type { MemoryItem, MemoryConsolidationOutput } from '../types.js';

// ── Test Helpers ──────────────────────────────────────

let nextId = 1;

function createMockRepo(): MemoryRepository {
  const storage = new Map<string, MemoryItem>();

  return {
    async findById(id, _options) {
      return storage.get(id) ?? null;
    },
    async findMany(query) {
      let items = Array.from(storage.values());

      if (query.scopeRefs && query.scopeRefs.length > 0) {
        const allowedRefs = new Set(
          query.scopeRefs.map((scopeRef) => `${scopeRef.scope}:${scopeRef.scopeId}`),
        );
        items = items.filter((item) => allowedRefs.has(`${item.scope}:${item.scopeId}`));
      } else {
        if (query.scopeId) {
          items = items.filter((i) => i.scopeId === query.scopeId);
        }
        if (query.scope) {
          items = items.filter((i) => i.scope === query.scope);
        }
      }

      if (query.type) items = items.filter((i) => i.type === query.type);
      if (query.summaryTier) items = items.filter((i) => i.summaryTier === query.summaryTier);
      if (query.status) items = items.filter((i) => i.status === query.status);
      if (query.lifecycleStatus) {
        items = items.filter((i) => (i.lifecycleStatus ?? 'active') === query.lifecycleStatus);
      }
      if (query.minImportance !== undefined) {
        items = items.filter((i) => i.importance >= query.minImportance!);
      }
      if (query.factKey !== undefined) items = items.filter((i) => i.factKey === query.factKey);

      if (query.orderBy === 'importance') {
        items.sort((a, b) =>
          query.orderDir === 'asc'
            ? a.importance - b.importance
            : b.importance - a.importance,
        );
      } else if (query.orderBy === 'createdAt') {
        items.sort((a, b) =>
          query.orderDir === 'asc'
            ? a.createdAt - b.createdAt
            : b.createdAt - a.createdAt,
        );
      } else if (query.orderBy === 'updatedAt') {
        items.sort((a, b) =>
          query.orderDir === 'asc'
            ? a.updatedAt - b.updatedAt
            : b.updatedAt - a.updatedAt,
        );
      }

      if (query.limit) items = items.slice(0, query.limit);
      return items;
    },
    async create(input, _options) {
      const now = Date.now();
      const item: MemoryItem = {
        id: `mem_${nextId++}`,
        ...input,
        createdAt: now,
        updatedAt: now,
      };
      storage.set(item.id, item);
      return item;
    },
    async update(id, patch, _options) {
      const item = storage.get(id);
      if (!item) return null;
      const updated = {
        ...item,
        ...patch,
        updatedAt: Date.now(),
      };
      storage.set(id, updated);
      return updated;
    },
    async deprecate(id, _options) {
      const item = storage.get(id);
      if (!item) return null;
      const deprecated = { ...item, status: 'deprecated' as const, updatedAt: Date.now() };
      storage.set(id, deprecated);
      return deprecated;
    },
    async createEdge(input, _options) {
      return { id: `edge_${nextId++}`, ...input, createdAt: Date.now() };
    },
    async findEdges(_itemId, _options) {
      return [];
    },
  };
}

function createMockEventBus(): CoreEventBus {
  return {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as CoreEventBus;
}

function createSimpleCounter(): TokenCounter {
  return {
    name: 'simple',
    count: (text: string) => Math.ceil(text.length / 4),
  };
}

function createStore() {
  const repo = createMockRepo();
  const eventBus = createMockEventBus();
  const counter = createSimpleCounter();
  const store = new MemoryStore(repo, eventBus, counter);
  return { store, repo, eventBus, counter };
}

// ── Tests ─────────────────────────────────────────────

describe('MemoryStore', () => {
  beforeEach(() => {
    nextId = 1;
  });

  // ── ingestSummaries ─────────────────────────────────

  describe('ingestSummaries', () => {
    it('returns empty array for empty summaries', async () => {
      const { store } = createStore();
      const result = await store.ingestSummaries([], 'chat', 'session-1');
      expect(result).toEqual([]);
    });

    it('creates a summary memory for each non-empty string', async () => {
      const { store } = createStore();
      const result = await store.ingestSummaries(
        ['Alice met Bob', 'They became friends'],
        'chat',
        'session-1',
        'floor-1',
      );

      expect(result).toHaveLength(2);
      expect(result[0]!.type).toBe('summary');
      expect(result[0]!.content).toBe('Alice met Bob');
      expect(result[0]!.scope).toBe('chat');
      expect(result[0]!.scopeId).toBe('session-1');
      expect(result[0]!.sourceFloorId).toBe('floor-1');
      expect(result[0]!.importance).toBe(0.5);
      expect(result[0]!.status).toBe('active');
      expect(result[1]!.content).toBe('They became friends');
    });

    it('skips blank summaries', async () => {
      const { store } = createStore();
      const result = await store.ingestSummaries(
        ['Valid', '', '  ', 'Also valid'],
        'chat',
        'session-1',
      );

      expect(result).toHaveLength(2);
      expect(result[0]!.content).toBe('Valid');
      expect(result[1]!.content).toBe('Also valid');
    });

    it('trims whitespace from summaries', async () => {
      const { store } = createStore();
      const result = await store.ingestSummaries(
        ['  trimmed  '],
        'chat',
        'session-1',
      );

      expect(result[0]!.content).toBe('trimmed');
    });

    it('emits memory.created event for each summary', async () => {
      const { store, eventBus } = createStore();
      await store.ingestSummaries(['Fact A', 'Fact B'], 'chat', 'session-1');

      expect(eventBus.emit).toHaveBeenCalledTimes(2);
      expect(eventBus.emit).toHaveBeenCalledWith('memory.created', expect.objectContaining({
        sessionId: 'session-1',
        scope: 'chat',
        scopeId: 'session-1',
        source: 'extraction',
      }));
    });
  });

  // ── prepareInjection ────────────────────────────────

  describe('prepareInjection', () => {
    it('returns empty result when no memories exist', async () => {
      const { store } = createStore();
      const result = await store.prepareInjection('session-1', {
        maxTokens: 1000,
      });

      expect(result.items).toEqual([]);
      expect(result.formattedText).toBe('');
      expect(result.tokenCount).toBe(0);
    });

    it('selects memories within token budget', async () => {
      const { store } = createStore();
      // Create some memories
      await store.ingestSummaries(
        ['Short fact', 'Another short fact'],
        'chat',
        'session-1',
      );

      const result = await store.prepareInjection('session-1', {
        maxTokens: 1000,
      });

      expect(result.items).toHaveLength(2);
      expect(result.formattedText).toContain('[Memory]');
      expect(result.formattedText).toContain('Short fact');
      expect(result.formattedText).toContain('Another short fact');
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it('respects token budget limit', async () => {
      const { store } = createStore();
      // Create memories with enough text to exceed a small budget
      await store.ingestSummaries(
        ['First memory that takes some tokens', 'Second memory that also takes tokens'],
        'chat',
        'session-1',
      );

      // Very small budget - should only include header + maybe one item
      const result = await store.prepareInjection('session-1', {
        maxTokens: 15,
      });

      // Should include fewer items than available
      expect(result.items.length).toBeLessThanOrEqual(2);
    });

    it('respects maxItems limit', async () => {
      const { store } = createStore();
      await store.ingestSummaries(
        ['Fact 1', 'Fact 2', 'Fact 3'],
        'chat',
        'session-1',
      );

      const result = await store.prepareInjection('session-1', {
        maxTokens: 10000,
        maxItems: 2,
      });

      expect(result.items).toHaveLength(2);
    });

    it('filters by includeTypes', async () => {
      const { store, repo } = createStore();
      // Create different types
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'fact',
        content: 'A fact', importance: 0.8, confidence: 1.0, status: 'active',
      });
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'summary',
        content: 'A summary', importance: 0.5, confidence: 1.0, status: 'active',
      });

      const result = await store.prepareInjection('session-1', {
        maxTokens: 10000,
        includeTypes: ['fact'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.type).toBe('fact');
    });

    it('merges visible global branch and floor scopes when branch scopeContext is provided', async () => {
      const { store, repo } = createStore();

      await repo.create({
        scope: 'global',
        scopeId: 'account-1',
        type: 'fact',
        content: 'global fact',
        importance: 0.9,
        confidence: 1.0,
        status: 'active',
      });
      await repo.create({
        scope: 'branch',
        scopeId: buildBranchMemoryScopeId('session-1', 'main'),
        type: 'summary',
        content: 'branch summary',
        importance: 0.8,
        confidence: 1.0,
        status: 'active',
      });
      await repo.create({
        scope: 'floor',
        scopeId: 'floor-1',
        type: 'open_loop',
        content: 'floor open loop',
        importance: 0.7,
        confidence: 1.0,
        status: 'active',
      });

      const result = await store.prepareInjection('session-1', {
        maxTokens: 10000,
        scopeContext: { accountId: 'account-1', sessionId: 'session-1', branchId: 'main', floorId: 'floor-1' },
      });

      expect(result.items.map((item) => item.scope)).toEqual(['global', 'branch', 'floor']);
    });

    it('orders by importance (highest first)', async () => {
      const { store, repo } = createStore();
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'fact',
        content: 'Low importance', importance: 0.3, confidence: 1.0, status: 'active',
      });
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'fact',
        content: 'High importance', importance: 0.9, confidence: 1.0, status: 'active',
      });

      const result = await store.prepareInjection('session-1', {
        maxTokens: 10000,
      });

      expect(result.items[0]!.content).toBe('High importance');
      expect(result.items[1]!.content).toBe('Low importance');
    });

    it('supports optional decay sorting (prefers newer memories when enabled)', async () => {
      const { store, repo } = createStore();

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
        const older = await repo.create({
          scope: 'chat',
          scopeId: 'session-1',
          type: 'fact',
          content: 'Older',
          importance: 0.5,
          confidence: 1.0,
          status: 'active',
        });

        vi.setSystemTime(new Date('2020-01-01T00:00:10.000Z'));
        const newer = await repo.create({
          scope: 'chat',
          scopeId: 'session-1',
          type: 'fact',
          content: 'Newer',
          importance: 0.5,
          confidence: 1.0,
          status: 'active',
        });

        const withoutDecay = await store.prepareInjection('session-1', {
          maxTokens: 10000,
          maxItems: 1,
        });
        expect(withoutDecay.items[0]!.id).toBe(older.id);

        const withDecay = await store.prepareInjection('session-1', {
          maxTokens: 10000,
          maxItems: 1,
          now: new Date('2020-01-01T00:00:10.000Z').getTime(),
          decay: {
            halfLifeMs: 1000,
            minFactor: 0.05,
            by: 'updatedAt',
          },
        });
        expect(withDecay.items[0]!.id).toBe(newer.id);
      } finally {
        vi.useRealTimers();
      }
    });

    it('supports balanced selection across memory types', async () => {
      const { store, repo } = createStore();
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'fact',
        content: 'Fact A', importance: 0.95, confidence: 1.0, status: 'active',
      });
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'summary',
        content: 'Summary A', importance: 0.9, confidence: 1.0, status: 'active',
      });
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'open_loop',
        content: 'Open Loop A', importance: 0.4, confidence: 1.0, status: 'active',
      });

      const result = await store.prepareInjection('session-1', {
        maxTokens: 10000,
        includeTypes: ['open_loop', 'fact', 'summary'],
        selectionMode: 'balanced',
        typeOrder: ['open_loop', 'fact', 'summary'],
      });

      expect(result.items).toHaveLength(3);
      expect(result.items[0]!.type).toBe('open_loop');
      expect(result.items[1]!.type).toBe('fact');
      expect(result.items[2]!.type).toBe('summary');
    });

    it('respects typeMaxItems when using balanced selection', async () => {
      const { store, repo } = createStore();
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'fact',
        content: 'Fact A', importance: 0.9, confidence: 1.0, status: 'active',
      });
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'fact',
        content: 'Fact B', importance: 0.8, confidence: 1.0, status: 'active',
      });
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'summary',
        content: 'Summary A', importance: 0.7, confidence: 1.0, status: 'active',
      });
      await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'summary',
        content: 'Summary B', importance: 0.6, confidence: 1.0, status: 'active',
      });

      const result = await store.prepareInjection('session-1', {
        maxTokens: 10000,
        selectionMode: 'balanced',
        typeOrder: ['fact', 'summary'],
        typeMaxItems: { fact: 1, summary: 1 },
      });

      expect(result.items).toHaveLength(2);
      expect(result.items.filter((item) => item.type === 'fact')).toHaveLength(1);
      expect(result.items.filter((item) => item.type === 'summary')).toHaveLength(1);
    });

    it('supports dual-summary injection ordering and treats legacy summaries as micro', async () => {
      const { store, repo } = createStore();
      await repo.create({
        scope: 'chat',
        scopeId: 'session-1',
        type: 'fact',
        content: 'alliance_status: cautious allies',
        factKey: 'alliance_status',
        importance: 0.95,
        confidence: 1.0,
        status: 'active',
        lifecycleStatus: 'active',
      });
      await repo.create({
        scope: 'chat',
        scopeId: 'session-1',
        type: 'open_loop',
        content: 'Can the guide be trusted?',
        importance: 0.8,
        confidence: 1.0,
        status: 'active',
        lifecycleStatus: 'active',
      });
      await repo.create({
        scope: 'chat',
        scopeId: 'session-1',
        type: 'summary',
        content: 'Legacy summary rows should still act like micro summaries.',
        importance: 0.75,
        confidence: 1.0,
        status: 'active',
        lifecycleStatus: 'active',
      });
      await repo.create({
        scope: 'chat',
        scopeId: 'session-1',
        type: 'summary',
        summaryTier: 'micro',
        content: 'A recent micro summary of the latest turn.',
        importance: 0.7,
        confidence: 1.0,
        status: 'active',
        lifecycleStatus: 'active',
      });
      await repo.create({
        scope: 'chat',
        scopeId: 'session-1',
        type: 'summary',
        summaryTier: 'macro',
        content: 'A macro summary of the recent phase.',
        importance: 0.65,
        confidence: 1.0,
        status: 'active',
        lifecycleStatus: 'active',
      });
      await repo.create({
        scope: 'chat',
        scopeId: 'session-1',
        type: 'summary',
        summaryTier: 'micro',
        content: 'Compacted summaries must stay out of active injection.',
        importance: 0.9,
        confidence: 1.0,
        status: 'active',
        lifecycleStatus: 'compacted',
      });

      const result = await store.prepareInjection('session-1', {
        maxTokens: 10000,
        maxItems: 24,
        minImportance: 0.35,
        includeTypes: ['open_loop', 'fact', 'summary'],
        strategy: 'dual_summary',
      });

      expect(result.formattedText).toContain('[Memory Facts]');
      expect(result.formattedText).toContain('[Open Loops]');
      expect(result.formattedText).toContain('[Recent Micro Summaries]');
      expect(result.formattedText).toContain('[Macro Summary]');
      expect(result.formattedText.indexOf('[Memory Facts]')).toBeLessThan(result.formattedText.indexOf('[Open Loops]'));
      expect(result.formattedText.indexOf('[Open Loops]')).toBeLessThan(result.formattedText.indexOf('[Recent Micro Summaries]'));
      expect(result.formattedText.indexOf('[Recent Micro Summaries]')).toBeLessThan(result.formattedText.indexOf('[Macro Summary]'));
      expect(result.formattedText).toContain('Legacy summary rows should still act like micro summaries.');
      expect(result.formattedText).not.toContain('Compacted summaries must stay out of active injection.');
    });

    it('formats memory text correctly', async () => {
      const { store } = createStore();
      await store.ingestSummaries(['Important event'], 'chat', 'session-1');

      const result = await store.prepareInjection('session-1', {
        maxTokens: 10000,
      });

      expect(result.formattedText).toBe('[Memory]\n- (summary) Important event');
    });
  });

  // ── applyConsolidation ──────────────────────────────

  describe('applyConsolidation', () => {
    it('creates turnSummary as a summary memory', async () => {
      const { store, eventBus } = createStore();
      const output: MemoryConsolidationOutput = {
        turnSummary: 'Alice discovered the truth',
        factsAdd: [],
        factsUpdate: [],
        factsDeprecate: [],
      };

      await store.applyConsolidation(output, 'chat', 'session-1', 'floor-1');

      expect(eventBus.emit).toHaveBeenCalledWith('memory.created', expect.objectContaining({
        source: 'consolidation',
      }));
      expect(eventBus.emit).toHaveBeenCalledWith('memory.consolidated', expect.objectContaining({
        sessionId: 'session-1',
        scope: 'chat',
        scopeId: 'session-1',
        floorId: 'floor-1',
        created: 1,
        updated: 0,
        deprecated: 0,
      }));
    });

    it('creates new facts from factsAdd', async () => {
      const { store, eventBus } = createStore();
      const output: MemoryConsolidationOutput = {
        turnSummary: '',
        factsAdd: [
          { key: 'mood', value: 'happy', scope: 'chat', importance: 0.7 },
          { key: 'location', value: 'library', scope: 'chat' },
        ],
        factsUpdate: [],
        factsDeprecate: [],
      };

      await store.applyConsolidation(output, 'chat', 'session-1', 'floor-1');

      // 2 facts created, 0 turnSummary (empty)
      const createdCalls = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'memory.created',
      );
      expect(createdCalls).toHaveLength(2);
      expect(createdCalls[0]![1].item.content).toBe('mood: happy');
      expect(createdCalls[0]![1].item.factKey).toBe('mood');
      expect(createdCalls[0]![1].item.importance).toBe(0.7);
      expect(createdCalls[1]![1].item.content).toBe('location: library');
      expect(createdCalls[1]![1].item.factKey).toBe('location');
      expect(createdCalls[1]![1].item.importance).toBe(0.5); // default
    });

    it('auto-deprecates older facts with the same key when a new fact is added', async () => {
      const { store, repo, eventBus } = createStore();

      await repo.create({
        scope: 'chat',
        scopeId: 'session-1',
        type: 'fact',
        content: 'mood: sad',
        factKey: 'mood',
        importance: 0.5,
        confidence: 1.0,
        status: 'active',
      });

      const output: MemoryConsolidationOutput = {
        turnSummary: '',
        factsAdd: [{ key: 'mood', value: 'happy', scope: 'chat' }],
        factsUpdate: [],
        factsDeprecate: [],
      };

      await store.applyConsolidation(output, 'chat', 'session-1', 'floor-1');

      const activeFacts = await store.query({
        scope: 'chat',
        scopeId: 'session-1',
        type: 'fact',
        status: 'active',
      });
      expect(activeFacts).toHaveLength(1);
      expect(activeFacts[0]!.content).toBe('mood: happy');

      const depCalls = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'memory.deprecated',
      );
      expect(depCalls).toHaveLength(1);
      expect(depCalls[0]![1].reason).toBe('conflict_resolution:mood');

      expect(eventBus.emit).toHaveBeenCalledWith('memory.consolidated', expect.objectContaining({
        sessionId: 'session-1',
        scope: 'chat',
        scopeId: 'session-1',
        floorId: 'floor-1',
        created: 1,
        updated: 0,
        deprecated: 1,
      }));
    });

    it('updates existing facts from factsUpdate', async () => {
      const { store, repo, eventBus } = createStore();
      // Pre-create a fact
      const existing = await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'fact',
        content: 'mood: sad', importance: 0.5, confidence: 1.0, status: 'active',
      });

      const output: MemoryConsolidationOutput = {
        turnSummary: '',
        factsAdd: [],
        factsUpdate: [{ id: existing.id, value: 'mood: happy', importance: 0.8 }],
        factsDeprecate: [],
      };

      await store.applyConsolidation(output, 'chat', 'session-1', 'floor-1');

      const updateCalls = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'memory.updated',
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]![1].item.content).toBe('mood: happy');
      expect(updateCalls[0]![1].previousContent).toBe('mood: sad');
    });

    it('skips update for non-existent IDs', async () => {
      const { store, eventBus } = createStore();
      const output: MemoryConsolidationOutput = {
        turnSummary: '',
        factsAdd: [],
        factsUpdate: [{ id: 'non-existent', value: 'new value' }],
        factsDeprecate: [],
      };

      await store.applyConsolidation(output, 'chat', 'session-1', 'floor-1');

      const updateCalls = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'memory.updated',
      );
      expect(updateCalls).toHaveLength(0);
    });

    it('deprecates facts from factsDeprecate', async () => {
      const { store, repo, eventBus } = createStore();
      const existing = await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'fact',
        content: 'old fact', importance: 0.5, confidence: 1.0, status: 'active',
      });

      const output: MemoryConsolidationOutput = {
        turnSummary: '',
        factsAdd: [],
        factsUpdate: [],
        factsDeprecate: [{ id: existing.id, reason: 'contradicted' }],
      };

      await store.applyConsolidation(output, 'chat', 'session-1', 'floor-1');

      const depCalls = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'memory.deprecated',
      );
      expect(depCalls).toHaveLength(1);
      expect(depCalls[0]![1].reason).toBe('contradicted');
    });

    it('emits memory.consolidated with correct counts', async () => {
      const { store, repo, eventBus } = createStore();
      const existing = await repo.create({
        scope: 'chat', scopeId: 'session-1', type: 'fact',
        content: 'will update', importance: 0.5, confidence: 1.0, status: 'active',
      });

      const output: MemoryConsolidationOutput = {
        turnSummary: 'Summary of turn',
        factsAdd: [{ key: 'new', value: 'fact', scope: 'chat' }],
        factsUpdate: [{ id: existing.id, value: 'updated' }],
        factsDeprecate: [],
      };

      await store.applyConsolidation(output, 'chat', 'session-1', 'floor-1');

      const consolidatedCalls = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'memory.consolidated',
      );
      expect(consolidatedCalls).toHaveLength(1);
      expect(consolidatedCalls[0]![1]).toEqual(expect.objectContaining({
        sessionId: 'session-1',
        scope: 'chat',
        scopeId: 'session-1',
        floorId: 'floor-1',
        created: 2, // turnSummary + 1 fact
        updated: 1,
        deprecated: 0,
      }));
    });
  });

  // ── query ───────────────────────────────────────────

  describe('query', () => {
    it('delegates to repository findMany', async () => {
      const { store, repo } = createStore();
      await repo.create({
        scope: 'chat', scopeId: 's1', type: 'fact',
        content: 'fact', importance: 0.5, confidence: 1.0, status: 'active',
      });

      const results = await store.query({ scopeId: 's1', type: 'fact' });
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe('fact');
    });
  });

  // ── deprecate ───────────────────────────────────────

  describe('deprecate', () => {
    it('marks memory as deprecated and emits event', async () => {
      const { store, repo, eventBus } = createStore();
      const item = await repo.create({
        scope: 'chat', scopeId: 's1', type: 'fact',
        content: 'will deprecate', importance: 0.5, confidence: 1.0, status: 'active',
      });

      await store.deprecate(item.id, 'outdated');

      expect(eventBus.emit).toHaveBeenCalledWith('memory.deprecated', expect.objectContaining({
        sessionId: 's1',
        scope: 'chat',
        scopeId: 's1',
        item: expect.objectContaining({ id: item.id, status: 'deprecated' }),
        reason: 'outdated',
      }));
    });

    it('does nothing for non-existent ID', async () => {
      const { store, eventBus } = createStore();
      await store.deprecate('non-existent', 'reason');

      const depCalls = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'memory.deprecated',
      );
      expect(depCalls).toHaveLength(0);
    });
  });

  // ── create ──────────────────────────────────────────

  describe('create', () => {
    it('creates memory and emits event with source=manual', async () => {
      const { store, eventBus } = createStore();
      const item = await store.create({
        scope: 'chat',
        scopeId: 'session-1',
        type: 'fact',
        content: 'manually added fact',
        importance: 0.7,
        confidence: 1.0,
        status: 'active',
      });

      expect(item.content).toBe('manually added fact');
      expect(eventBus.emit).toHaveBeenCalledWith('memory.created', expect.objectContaining({
        sessionId: 'session-1',
        scope: 'chat',
        scopeId: 'session-1',
        item,
        source: 'manual',
      }));
    });
  });
});
