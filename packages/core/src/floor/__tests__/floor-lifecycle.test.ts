import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FloorState, VariableScope, VariableEntry } from '@tavern/shared';
import type { FloorEntity, VariableContext } from '../../types.js';
import type { FloorRepository } from '../../ports/floor-repository.js';
import type { VariableRepository } from '../../ports/variable-repository.js';
import { createEventBus, type CoreEventBus } from '../../events/index.js';
import { VariableResolver } from '../../variables/variable-resolver.js';
import { VariableStore } from '../../variables/variable-store.js';
import { FloorLifecycle } from '../floor-lifecycle.js';
import { FloorNotFoundError, InvalidStateTransitionError } from '../../errors.js';

// ─── Helpers ──────────────────────────────────────────

function makeFloor(overrides: Partial<FloorEntity> = {}): FloorEntity {
  return {
    id: 'floor-1',
    sessionId: 'session-1',
    floorNo: 1,
    branchId: 'main',
    parentFloorId: null,
    state: 'generating',
    tokenIn: 100,
    tokenOut: 50,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

class InMemoryFloorRepository implements FloorRepository {
  private store = new Map<string, FloorEntity>();

  add(floor: FloorEntity): void {
    this.store.set(floor.id, { ...floor });
  }

  async findById(id: string): Promise<FloorEntity | null> {
    const f = this.store.get(id);
    return f ? { ...f } : null;
  }

  async updateState(
    id: string,
    state: FloorState,
    updatedAt: number
  ): Promise<FloorEntity | null> {
    const f = this.store.get(id);
    if (!f) return null;
    f.state = state;
    f.updatedAt = updatedAt;
    return { ...f };
  }
}

class InMemoryVariableRepository implements VariableRepository {
  private store: VariableEntry[] = [];
  private nextId = 1;

  seed(scope: VariableScope, scopeId: string, key: string, value: unknown): VariableEntry {
    const entry: VariableEntry = {
      id: `var-${this.nextId++}`,
      scope,
      scopeId,
      key,
      value,
      updatedAt: Date.now(),
    };
    this.store.push(entry);
    return entry;
  }

  async findByKey(
    scope: VariableScope,
    scopeId: string,
    key: string
  ): Promise<VariableEntry | null> {
    return (
      this.store.find(
        (e) => e.scope === scope && e.scopeId === scopeId && e.key === key
      ) ?? null
    );
  }

  async findAllByScope(
    scope: VariableScope,
    scopeId: string
  ): Promise<VariableEntry[]> {
    return this.store.filter(
      (e) => e.scope === scope && e.scopeId === scopeId
    );
  }

  async upsert(
    scope: VariableScope,
    scopeId: string,
    key: string,
    value: unknown
  ): Promise<VariableEntry> {
    const existing = this.store.find(
      (e) => e.scope === scope && e.scopeId === scopeId && e.key === key
    );
    if (existing) {
      existing.value = value;
      existing.updatedAt = Date.now();
      return { ...existing };
    }
    const entry: VariableEntry = {
      id: `var-${this.nextId++}`,
      scope,
      scopeId,
      key,
      value,
      updatedAt: Date.now(),
    };
    this.store.push(entry);
    return { ...entry };
  }

  async deleteById(id: string): Promise<boolean> {
    const idx = this.store.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.store.splice(idx, 1);
    return true;
  }

  async deleteByKey(
    scope: VariableScope,
    scopeId: string,
    key: string
  ): Promise<boolean> {
    const idx = this.store.findIndex(
      (e) => e.scope === scope && e.scopeId === scopeId && e.key === key
    );
    if (idx === -1) return false;
    this.store.splice(idx, 1);
    return true;
  }
}

// ─── Tests ────────────────────────────────────────────

describe('FloorLifecycle', () => {
  let floorRepo: InMemoryFloorRepository;
  let varRepo: InMemoryVariableRepository;
  let bus: CoreEventBus;
  let lifecycle: FloorLifecycle;

  const context: VariableContext = {
    pageId: 'page-1',
    floorId: 'floor-1',
    sessionId: 'session-1',
    globalScopeId: 'global',
  };

  beforeEach(() => {
    floorRepo = new InMemoryFloorRepository();
    varRepo = new InMemoryVariableRepository();
    bus = createEventBus();

    const resolver = new VariableResolver(varRepo);
    const store = new VariableStore(varRepo, resolver, bus);
    lifecycle = new FloorLifecycle(floorRepo, store, bus);
  });

  describe('commitFloor', () => {
    it('transitions floor to committed', async () => {
      floorRepo.add(makeFloor({ id: 'floor-1', state: 'generating' }));

      const result = await lifecycle.commitFloor('floor-1', context);

      expect(result.floor.state).toBe('committed');
    });

    it('promotes page variables to floor', async () => {
      floorRepo.add(makeFloor({ id: 'floor-1', state: 'generating' }));
      varRepo.seed('page', 'page-1', 'mood', 'happy');
      varRepo.seed('page', 'page-1', 'hp', 100);

      const result = await lifecycle.commitFloor('floor-1', context);

      expect(result.promotedVariables).toHaveLength(2);
      expect(result.promotedVariables.every((v) => v.scope === 'floor')).toBe(true);
    });

    it('returns empty promotedVariables when no page vars exist', async () => {
      floorRepo.add(makeFloor({ id: 'floor-1', state: 'generating' }));

      const result = await lifecycle.commitFloor('floor-1', context);

      expect(result.promotedVariables).toHaveLength(0);
    });

    it('skips variable promotion when context has no pageId', async () => {
      floorRepo.add(makeFloor({ id: 'floor-1', state: 'generating' }));
      varRepo.seed('page', 'page-1', 'mood', 'happy');

      const ctxNoPage: VariableContext = {
        floorId: 'floor-1',
        sessionId: 'session-1',
      };

      const result = await lifecycle.commitFloor('floor-1', ctxNoPage);

      expect(result.floor.state).toBe('committed');
      expect(result.promotedVariables).toHaveLength(0);
    });

    it('throws FloorNotFoundError for missing floor', async () => {
      await expect(
        lifecycle.commitFloor('nonexistent', context)
      ).rejects.toThrow(FloorNotFoundError);
    });

    it('throws InvalidStateTransitionError for draft floor', async () => {
      floorRepo.add(makeFloor({ id: 'floor-1', state: 'draft' }));

      await expect(
        lifecycle.commitFloor('floor-1', context)
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it('emits floor.stateChanged and floor.committed events', async () => {
      floorRepo.add(makeFloor({ id: 'floor-1', state: 'generating' }));

      const stateHandler = vi.fn();
      const commitHandler = vi.fn();
      bus.on('floor.stateChanged', stateHandler);
      bus.on('floor.committed', commitHandler);

      await lifecycle.commitFloor('floor-1', context);

      expect(stateHandler).toHaveBeenCalledOnce();
      expect(commitHandler).toHaveBeenCalledOnce();
    });
  });

  describe('startGenerating', () => {
    it('transitions draft → generating', async () => {
      floorRepo.add(makeFloor({ id: 'floor-1', state: 'draft' }));

      const result = await lifecycle.startGenerating('floor-1');
      expect(result.state).toBe('generating');
    });
  });

  describe('fail', () => {
    it('transitions to failed with error', async () => {
      floorRepo.add(makeFloor({ id: 'floor-1', state: 'generating' }));

      const failHandler = vi.fn();
      bus.on('floor.failed', failHandler);

      const err = new Error('timeout');
      const result = await lifecycle.fail('floor-1', err);

      expect(result.state).toBe('failed');
      expect(failHandler).toHaveBeenCalledOnce();
    });
  });
});
