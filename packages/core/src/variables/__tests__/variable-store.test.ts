import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VariableScope, VariableEntry } from '@tavern/shared';
import type { VariableRepository, VariableRepositoryOptions } from '../../ports/index.js';
import type { VariableContext } from '../../types.js';
import { createEventBus, type CoreEventBus } from '../../events/index.js';
import { VariableResolver } from '../variable-resolver.js';
import { VariableStore } from '../variable-store.js';
import { InvalidScopePromotionError, MissingScopeIdError, VariableNotFoundError } from '../../errors.js';

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

    it('isolates writes by accountId', async () => {
      const accountAContext: VariableContext = {
        ...fullContext,
        accountId: 'account-a',
      };
      const accountBContext: VariableContext = {
        ...fullContext,
        accountId: 'account-b',
      };

      await store.set('mood', 'happy', accountAContext);
      await store.set('mood', 'sad', accountBContext);

      await expect(store.get('mood', accountAContext)).resolves.toBe('happy');
      await expect(store.get('mood', accountBContext)).resolves.toBe('sad');
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

  describe('promoteAll', () => {
    it('promotes all variables from one scope to another', async () => {
      repo.seed('page', 'page-1', 'mood', 'happy');
      repo.seed('page', 'page-1', 'hp', 100);
      repo.seed('page', 'page-1', 'location', 'tavern');

      const promoted = await store.promoteAll('page', 'page-1', 'floor', 'floor-1');

      expect(promoted).toHaveLength(3);
      expect(promoted.every((entry) => entry.scope === 'floor')).toBe(true);
    });

    it('filters source variables by accountId', async () => {
      repo.seed('page', 'page-1', 'mood', 'happy', 'account-a');
      repo.seed('page', 'page-1', 'mood', 'sad', 'account-b');

      const promoted = await store.promoteAll(
        'page',
        'page-1',
        'floor',
        'floor-1',
        'account-a'
      );

      expect(promoted).toHaveLength(1);
      expect(promoted[0]!.value).toBe('happy');
      await expect(
        resolver.resolve('mood', { floorId: 'floor-1', accountId: 'account-a' })
      ).resolves.toMatchObject({ value: 'happy', scope: 'floor' });
      await expect(
        resolver.resolve('mood', { floorId: 'floor-1', accountId: 'account-b' })
      ).resolves.toBeNull();
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
