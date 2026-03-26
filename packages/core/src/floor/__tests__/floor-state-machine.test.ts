import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FloorState } from '@tavern/shared';
import type { FloorEntity } from '../../types.js';
import type { FloorRepository } from '../../ports/index.js';
import { FloorStateMachine } from '../floor-state-machine.js';
import { createEventBus, type CoreEventBus } from '../../events/index.js';
import { FloorNotFoundError, FloorStateConflictError, InvalidStateTransitionError } from '../../errors.js';

// ─── Helpers ──────────────────────────────────────────

function makeFloor(overrides: Partial<FloorEntity> = {}): FloorEntity {
  return {
    id: 'floor-1',
    sessionId: 'session-1',
    floorNo: 1,
    branchId: 'main',
    parentFloorId: null,
    state: 'draft',
    tokenIn: 0,
    tokenOut: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

/**
 * 内存实现的 FloorRepository，用于测试
 */
class InMemoryFloorRepository implements FloorRepository {
  private store = new Map<string, FloorEntity>();
  private failNextCasUpdate = false;

  add(floor: FloorEntity): void {
    this.store.set(floor.id, { ...floor });
  }

  async findById(id: string): Promise<FloorEntity | null> {
    const f = this.store.get(id);
    return f ? { ...f } : null;
  }

  simulateNextCasConflict(): void {
    this.failNextCasUpdate = true;
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

  async updateStateCas(
    id: string,
    expectedState: FloorState,
    targetState: FloorState,
    updatedAt: number
  ): Promise<FloorEntity | null> {
    const f = this.store.get(id);
    if (this.failNextCasUpdate) {
      this.failNextCasUpdate = false;
      return null;
    }

    if (!f) return null;
    if (f.state !== expectedState) return null;

    f.state = targetState;
    f.updatedAt = updatedAt;
    return { ...f };
  }
}

// ─── Tests ────────────────────────────────────────────

describe('FloorStateMachine', () => {
  let repo: InMemoryFloorRepository;
  let bus: CoreEventBus;
  let sm: FloorStateMachine;

  beforeEach(() => {
    repo = new InMemoryFloorRepository();
    bus = createEventBus();
    sm = new FloorStateMachine(repo, bus);
  });

  // ── canTransition (pure) ──

  describe('canTransition', () => {
    it('draft → generating: allowed', () => {
      expect(sm.canTransition('draft', 'generating')).toBe(true);
    });

    it('draft → failed: allowed', () => {
      expect(sm.canTransition('draft', 'failed')).toBe(true);
    });

    it('generating → committed: allowed', () => {
      expect(sm.canTransition('generating', 'committed')).toBe(true);
    });

    it('generating → failed: allowed', () => {
      expect(sm.canTransition('generating', 'failed')).toBe(true);
    });

    it('draft → committed: NOT allowed (skip)', () => {
      expect(sm.canTransition('draft', 'committed')).toBe(false);
    });

    it('committed → *: NOT allowed (terminal)', () => {
      expect(sm.canTransition('committed', 'draft')).toBe(false);
      expect(sm.canTransition('committed', 'generating')).toBe(false);
      expect(sm.canTransition('committed', 'failed')).toBe(false);
    });

    it('failed → *: NOT allowed (terminal)', () => {
      expect(sm.canTransition('failed', 'draft')).toBe(false);
      expect(sm.canTransition('failed', 'generating')).toBe(false);
      expect(sm.canTransition('failed', 'committed')).toBe(false);
    });
  });

  // ── transition ──

  describe('transition', () => {
    it('draft → generating → committed: happy path', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'draft' }));

      const gen = await sm.transition('f1', 'generating');
      expect(gen.state).toBe('generating');

      const committed = await sm.transition('f1', 'committed');
      expect(committed.state).toBe('committed');
    });

    it('throws FloorNotFoundError for missing floor', async () => {
      await expect(sm.transition('nonexistent', 'generating')).rejects.toThrow(
        FloorNotFoundError
      );
    });

    it('throws InvalidStateTransitionError for illegal transition', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'draft' }));

      await expect(sm.transition('f1', 'committed')).rejects.toThrow(
        InvalidStateTransitionError
      );
    });

    it('throws for any transition from committed', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'committed' }));

      await expect(sm.transition('f1', 'generating')).rejects.toThrow(
        InvalidStateTransitionError
      );
    });

    it('throws for any transition from failed', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'failed' }));

      await expect(sm.transition('f1', 'draft')).rejects.toThrow(
        InvalidStateTransitionError
      );
    });

    it('throws FloorStateConflictError when CAS update loses the race', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'draft' }));
      repo.simulateNextCasConflict();

      await expect(sm.transition('f1', 'generating')).rejects.toThrow(
        FloorStateConflictError
      );
    });
  });

  // ── Events ──

  describe('events', () => {
    it('emits floor.stateChanged on every transition', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'draft' }));

      const handler = vi.fn();
      bus.on('floor.stateChanged', handler);

      await sm.transition('f1', 'generating');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          previousState: 'draft',
          newState: 'generating',
        })
      );
    });

    it('emits floor.committed when transitioning to committed', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'generating' }));

      const handler = vi.fn();
      bus.on('floor.committed', handler);

      await sm.transition('f1', 'committed');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          floor: expect.objectContaining({ id: 'f1', state: 'committed' }),
          promotedVariables: [],
        })
      );
    });

    it('does NOT emit floor.committed for non-committed transitions', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'draft' }));

      const handler = vi.fn();
      bus.on('floor.committed', handler);

      await sm.transition('f1', 'generating');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Convenience methods ──

  describe('startGenerating', () => {
    it('transitions draft → generating', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'draft' }));
      const result = await sm.startGenerating('f1');
      expect(result.state).toBe('generating');
    });
  });

  describe('commit', () => {
    it('transitions generating → committed', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'generating' }));
      const result = await sm.commit('f1');
      expect(result.state).toBe('committed');
    });
  });

  describe('fail', () => {
    it('transitions to failed and emits floor.failed with error', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'generating' }));

      const failedHandler = vi.fn();
      bus.on('floor.failed', failedHandler);

      const err = new Error('LLM timeout');
      const result = await sm.fail('f1', err);

      expect(result.state).toBe('failed');
      expect(failedHandler).toHaveBeenCalledOnce();
      expect(failedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          floor: expect.objectContaining({ id: 'f1', state: 'failed' }),
          error: err,
        })
      );
    });

    it('can fail from draft', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'draft' }));
      const result = await sm.fail('f1', new Error('cancelled'));
      expect(result.state).toBe('failed');
    });

    it('throws for fail from committed', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'committed' }));
      await expect(sm.fail('f1', new Error('nope'))).rejects.toThrow(
        InvalidStateTransitionError
      );
    });

    it('throws FloorNotFoundError for missing floor', async () => {
      await expect(sm.fail('nonexistent', new Error('x'))).rejects.toThrow(
        FloorNotFoundError
      );
    });

    it('throws FloorStateConflictError when fail CAS update loses the race', async () => {
      repo.add(makeFloor({ id: 'f1', state: 'generating' }));
      repo.simulateNextCasConflict();

      await expect(sm.fail('f1', new Error('x'))).rejects.toThrow(
        FloorStateConflictError
      );
    });
  });
});
