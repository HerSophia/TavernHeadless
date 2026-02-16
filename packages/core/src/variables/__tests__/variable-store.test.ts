import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VariableScope, VariableEntry } from '@tavern/shared';
import type { VariableRepository } from '../../ports/index.js';
import type { VariableContext } from '../../types.js';
import { createEventBus, type CoreEventBus } from '../../events/index.js';
import { VariableResolver } from '../variable-resolver.js';
import { VariableStore } from '../variable-store.js';
import { InvalidScopePromotionError, MissingScopeIdError, VariableNotFoundError } from '../../errors.js';

// ─── In-memory VariableRepository ─────────────────────

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

describe('VariableStore', () => {
  let repo: InMemoryVariableRepository;
  let resolver: VariableResolver;
  let bus: CoreEventBus;
  let store: VariableStore;

  const fullContext: VariableContext = {
    pageId: 'page-1',
    floorId: 'floor-1',
    sessionId: 'session-1',
    globalScopeId: 'global',
  };

  beforeEach(() => {
    repo = new InMemoryVariableRepository();
    resolver = new VariableResolver(repo);
    bus = createEventBus();
    store = new VariableStore(repo, resolver, bus);
  });

  // ── set ──

  describe('set', () => {
    it('defaults to page scope when context has pageId', async () => {
      const entry = await store.set('mood', 'happy', fullContext);
      expect(entry.scope).toBe('page');
      expect(entry.key).toBe('mood');
      expect(entry.value).toBe('happy');
    });

    it('falls back to floor when no pageId', async () => {
      const ctx: VariableContext = {
        floorId: 'floor-1',
        sessionId: 'session-1',
      };
      const entry = await store.set('mood', 'angry', ctx);
      expect(entry.scope).toBe('floor');
    });

    it('falls back to chat when no pageId and no floorId', async () => {
      const ctx: VariableContext = {
        sessionId: 'session-1',
      };
      const entry = await store.set('mood', 'calm', ctx);
      expect(entry.scope).toBe('chat');
    });

    it('falls back to global when only global available', async () => {
      const ctx: VariableContext = {};
      const entry = await store.set('mood', 'zen', ctx);
      expect(entry.scope).toBe('global');
    });

    it('writes to explicit scope', async () => {
      const entry = await store.set('hp', 100, fullContext, 'chat');
      expect(entry.scope).toBe('chat');
      expect(entry.scopeId).toBe('session-1');
    });

    it('emits variable.set with isNew=true for new variable', async () => {
      const handler = vi.fn();
      bus.on('variable.set', handler);

      await store.set('mood', 'happy', fullContext);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ isNew: true })
      );
    });

    it('emits variable.set with isNew=false for existing variable', async () => {
      await store.set('mood', 'happy', fullContext);

      const handler = vi.fn();
      bus.on('variable.set', handler);

      await store.set('mood', 'sad', fullContext);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ isNew: false })
      );
    });

    it('throws MissingScopeIdError when explicit scope has no id', async () => {
      const ctx: VariableContext = { sessionId: 'session-1' };
      await expect(store.set('x', 1, ctx, 'page')).rejects.toThrow(
        MissingScopeIdError
      );
    });
  });

  // ── promote ──

  describe('promote', () => {
    it('promotes page → floor', async () => {
      repo.seed('page', 'page-1', 'mood', 'happy');

      const promoted = await store.promote('mood', 'page', 'floor', fullContext);

      expect(promoted.scope).toBe('floor');
      expect(promoted.value).toBe('happy');
    });

    it('promotes page → chat', async () => {
      repo.seed('page', 'page-1', 'mood', 'happy');

      const promoted = await store.promote('mood', 'page', 'chat', fullContext);

      expect(promoted.scope).toBe('chat');
      expect(promoted.value).toBe('happy');
    });

    it('promotes floor → global', async () => {
      repo.seed('floor', 'floor-1', 'count', 5);

      const promoted = await store.promote('count', 'floor', 'global', fullContext);

      expect(promoted.scope).toBe('global');
      expect(promoted.value).toBe(5);
    });

    it('throws InvalidScopePromotionError for chat → page', async () => {
      repo.seed('chat', 'session-1', 'mood', 'calm');

      await expect(
        store.promote('mood', 'chat', 'page', fullContext)
      ).rejects.toThrow(InvalidScopePromotionError);
    });

    it('throws InvalidScopePromotionError for same scope', async () => {
      repo.seed('page', 'page-1', 'mood', 'happy');

      await expect(
        store.promote('mood', 'page', 'page', fullContext)
      ).rejects.toThrow(InvalidScopePromotionError);
    });

    it('throws VariableNotFoundError when source key missing', async () => {
      await expect(
        store.promote('nonexistent', 'page', 'floor', fullContext)
      ).rejects.toThrow(VariableNotFoundError);
    });

    it('emits variable.promoted event', async () => {
      repo.seed('page', 'page-1', 'mood', 'happy');

      const handler = vi.fn();
      bus.on('variable.promoted', handler);

      await store.promote('mood', 'page', 'floor', fullContext);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({
        key: 'mood',
        fromScope: 'page',
        toScope: 'floor',
        value: 'happy',
      });
    });
  });

  // ── promoteAll ──

  describe('promoteAll', () => {
    it('promotes all variables from one scope to another', async () => {
      repo.seed('page', 'page-1', 'mood', 'happy');
      repo.seed('page', 'page-1', 'hp', 100);
      repo.seed('page', 'page-1', 'location', 'tavern');

      const promoted = await store.promoteAll('page', 'page-1', 'floor', 'floor-1');

      expect(promoted).toHaveLength(3);
      expect(promoted.every((e) => e.scope === 'floor')).toBe(true);
    });

    it('returns empty array when source scope has no variables', async () => {
      const promoted = await store.promoteAll('page', 'page-1', 'floor', 'floor-1');
      expect(promoted).toHaveLength(0);
    });

    it('throws InvalidScopePromotionError for wrong direction', async () => {
      await expect(
        store.promoteAll('chat', 'session-1', 'page', 'page-1')
      ).rejects.toThrow(InvalidScopePromotionError);
    });

    it('emits variable.promoted for each variable', async () => {
      repo.seed('page', 'page-1', 'a', 1);
      repo.seed('page', 'page-1', 'b', 2);

      const handler = vi.fn();
      bus.on('variable.promoted', handler);

      await store.promoteAll('page', 'page-1', 'floor', 'floor-1');

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  // ── delete ──

  describe('delete', () => {
    it('deletes variable and emits event', async () => {
      const entry = repo.seed('page', 'page-1', 'mood', 'happy');

      const handler = vi.fn();
      bus.on('variable.deleted', handler);

      await store.delete(entry.id, 'page', 'mood');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({
        id: entry.id,
        scope: 'page',
        key: 'mood',
      });
    });

    it('does not emit event when variable not found', async () => {
      const handler = vi.fn();
      bus.on('variable.deleted', handler);

      await store.delete('nonexistent-id', 'page', 'mood');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── get (proxy) ──

  describe('get', () => {
    it('returns value via resolver', async () => {
      repo.seed('global', 'global', 'lang', 'zh');

      const value = await store.get('lang', fullContext);
      expect(value).toBe('zh');
    });

    it('returns undefined when not found', async () => {
      const value = await store.get('nonexistent', fullContext);
      expect(value).toBeUndefined();
    });
  });
});
