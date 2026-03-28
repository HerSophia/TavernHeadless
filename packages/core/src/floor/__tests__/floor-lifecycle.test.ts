import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FloorState, VariableScope, VariableEntry } from '@tavern/shared';
import type { FloorEntity, VariableContext } from '../../types.js';
import type { FloorRepository } from '../../ports/floor-repository.js';
import type { VariableRepository, VariableRepositoryOptions } from '../../ports/variable-repository.js';
import { createEventBus, type CoreEventBus } from '../../events/index.js';
import { VariableResolver } from '../../variables/variable-resolver.js';
import { VariableStore } from '../../variables/variable-store.js';
import { FloorLifecycle } from '../floor-lifecycle.js';
import { FloorNotFoundError, InvalidStateTransitionError } from '../../errors.js';

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
    const floor = this.store.get(id);
    return floor ? { ...floor } : null;
  }

  async updateState(
    id: string,
    state: FloorState,
    updatedAt: number
  ): Promise<FloorEntity | null> {
    const floor = this.store.get(id);
    if (!floor) return null;
    floor.state = state;
    floor.updatedAt = updatedAt;
    return { ...floor };
  }

  async updateStateCas(
    id: string,
    expectedState: FloorState,
    targetState: FloorState,
    updatedAt: number
  ): Promise<FloorEntity | null> {
    const floor = this.store.get(id);
    if (!floor) return null;
    if (floor.state !== expectedState) return null;

    floor.state = targetState;
    floor.updatedAt = updatedAt;
    return { ...floor };
  }
}

interface StoredVariableRow extends VariableEntry {
  accountId?: string;
}

class InMemoryVariableRepository implements VariableRepository {
  private store: StoredVariableRow[] = [];
  private nextId = 1;

  private toEntry(row: StoredVariableRow): VariableEntry {
    return {
      id: row.id,
      scope: row.scope,
      scopeId: row.scopeId,
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt,
    };
  }

  private matchesAccount(row: StoredVariableRow, options?: VariableRepositoryOptions): boolean {
    return row.accountId === options?.accountId;
  }

  seed(
    scope: VariableScope,
    scopeId: string,
    key: string,
    value: unknown,
    accountId?: string
  ): VariableEntry {
    const row: StoredVariableRow = {
      id: `var-${this.nextId++}`,
      scope,
      scopeId,
      key,
      value,
      updatedAt: Date.now(),
      accountId,
    };
    this.store.push(row);
    return this.toEntry(row);
  }

  async findByKey(
    scope: VariableScope,
    scopeId: string,
    key: string,
    options?: VariableRepositoryOptions
  ): Promise<VariableEntry | null> {
    const row = this.store.find(
      (entry) =>
        entry.scope === scope &&
        entry.scopeId === scopeId &&
        entry.key === key &&
        this.matchesAccount(entry, options)
    );

    return row ? this.toEntry(row) : null;
  }

  async findAllByScope(
    scope: VariableScope,
    scopeId: string,
    options?: VariableRepositoryOptions
  ): Promise<VariableEntry[]> {
    return this.store
      .filter(
        (entry) =>
          entry.scope === scope &&
          entry.scopeId === scopeId &&
          this.matchesAccount(entry, options)
      )
      .map((entry) => this.toEntry(entry));
  }

  async upsert(
    scope: VariableScope,
    scopeId: string,
    key: string,
    value: unknown,
    options?: VariableRepositoryOptions
  ): Promise<VariableEntry> {
    const existing = this.store.find(
      (entry) =>
        entry.scope === scope &&
        entry.scopeId === scopeId &&
        entry.key === key &&
        this.matchesAccount(entry, options)
    );
    if (existing) {
      existing.value = value;
      existing.updatedAt = Date.now();
      return this.toEntry(existing);
    }

    return this.seed(scope, scopeId, key, value, options?.accountId);
  }

  async deleteById(id: string, options?: VariableRepositoryOptions): Promise<boolean> {
    const idx = this.store.findIndex(
      (entry) => entry.id === id && this.matchesAccount(entry, options)
    );
    if (idx === -1) return false;
    this.store.splice(idx, 1);
    return true;
  }

  async deleteByKey(
    scope: VariableScope,
    scopeId: string,
    key: string,
    options?: VariableRepositoryOptions
  ): Promise<boolean> {
    const idx = this.store.findIndex(
      (entry) =>
        entry.scope === scope &&
        entry.scopeId === scopeId &&
        entry.key === key &&
        this.matchesAccount(entry, options)
    );
    if (idx === -1) return false;
    this.store.splice(idx, 1);
    return true;
  }
}

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
      expect(result.promotedVariables.every((entry) => entry.scope === 'floor')).toBe(true);
    });

    it('promotes only variables visible to the current account', async () => {
      floorRepo.add(makeFloor({ id: 'floor-1', state: 'generating' }));
      varRepo.seed('page', 'page-1', 'mood', 'happy', 'account-a');
      varRepo.seed('page', 'page-1', 'mood', 'sad', 'account-b');

      const result = await lifecycle.commitFloor('floor-1', {
        ...context,
        accountId: 'account-a',
      });

      expect(result.promotedVariables).toHaveLength(1);
      expect(result.promotedVariables[0]!.value).toBe('happy');
      await expect(
        varRepo.findByKey('floor', 'floor-1', 'mood', { accountId: 'account-a' })
      ).resolves.toMatchObject({ value: 'happy' });
      await expect(
        varRepo.findByKey('floor', 'floor-1', 'mood', { accountId: 'account-b' })
      ).resolves.toBeNull();
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
