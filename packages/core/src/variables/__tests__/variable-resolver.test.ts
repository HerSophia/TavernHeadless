import { describe, it, expect, beforeEach } from 'vitest';
import type { VariableScope, VariableEntry } from '@tavern/shared';
import type { VariableRepository } from '../../ports/index.js';
import type { VariableContext } from '../../types.js';
import { VariableResolver } from '../variable-resolver.js';

// ─── In-memory VariableRepository ─────────────────────

class InMemoryVariableRepository implements VariableRepository {
  private store: VariableEntry[] = [];
  private nextId = 1;

  add(scope: VariableScope, scopeId: string, key: string, value: unknown): VariableEntry {
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
      return existing;
    }
    return this.add(scope, scopeId, key, value);
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

describe('VariableResolver', () => {
  let repo: InMemoryVariableRepository;
  let resolver: VariableResolver;

  const fullContext: VariableContext = {
    pageId: 'page-1',
    floorId: 'floor-1',
    sessionId: 'session-1',
    globalScopeId: 'global',
  };

  beforeEach(() => {
    repo = new InMemoryVariableRepository();
    resolver = new VariableResolver(repo);
  });

  describe('resolve', () => {
    it('returns global variable when only global has the key', async () => {
      repo.add('global', 'global', 'mood', 'happy');

      const entry = await resolver.resolve('mood', fullContext);
      expect(entry).not.toBeNull();
      expect(entry!.value).toBe('happy');
      expect(entry!.scope).toBe('global');
    });

    it('page overrides global for same key', async () => {
      repo.add('global', 'global', 'mood', 'happy');
      repo.add('page', 'page-1', 'mood', 'sad');

      const entry = await resolver.resolve('mood', fullContext);
      expect(entry!.value).toBe('sad');
      expect(entry!.scope).toBe('page');
    });

    it('floor overrides chat and global', async () => {
      repo.add('global', 'global', 'mood', 'happy');
      repo.add('chat', 'session-1', 'mood', 'neutral');
      repo.add('floor', 'floor-1', 'mood', 'angry');

      const entry = await resolver.resolve('mood', fullContext);
      expect(entry!.value).toBe('angry');
      expect(entry!.scope).toBe('floor');
    });

    it('skips scope when context has no scopeId', async () => {
      repo.add('page', 'page-1', 'mood', 'sad');
      repo.add('global', 'global', 'mood', 'happy');

      // No pageId in context → page scope skipped
      const contextNoPage: VariableContext = {
        floorId: 'floor-1',
        sessionId: 'session-1',
      };

      const entry = await resolver.resolve('mood', contextNoPage);
      expect(entry!.value).toBe('happy');
      expect(entry!.scope).toBe('global');
    });

    it('returns null when variable not found in any scope', async () => {
      const entry = await resolver.resolve('nonexistent', fullContext);
      expect(entry).toBeNull();
    });

    it('uses default global scopeId when not specified', async () => {
      repo.add('global', 'global', 'lang', 'zh');

      const contextNoGlobal: VariableContext = {
        sessionId: 'session-1',
        // globalScopeId not set → defaults to 'global'
      };

      const entry = await resolver.resolve('lang', contextNoGlobal);
      expect(entry!.value).toBe('zh');
    });
  });

  describe('resolveValue', () => {
    it('returns value when found', async () => {
      repo.add('global', 'global', 'count', 42);
      const value = await resolver.resolveValue('count', fullContext, 0);
      expect(value).toBe(42);
    });

    it('returns defaultValue when not found', async () => {
      const value = await resolver.resolveValue('missing', fullContext, 'default');
      expect(value).toBe('default');
    });
  });

  describe('resolveMany', () => {
    it('resolves multiple keys', async () => {
      repo.add('global', 'global', 'mood', 'happy');
      repo.add('chat', 'session-1', 'hp', 100);

      const result = await resolver.resolveMany(['mood', 'hp', 'missing'], fullContext);

      expect(result.size).toBe(2);
      expect(result.get('mood')!.value).toBe('happy');
      expect(result.get('hp')!.value).toBe(100);
      expect(result.has('missing')).toBe(false);
    });
  });

  describe('resolveAll', () => {
    it('merges all scopes, lower scope overrides higher', async () => {
      repo.add('global', 'global', 'mood', 'happy');
      repo.add('global', 'global', 'lang', 'en');
      repo.add('chat', 'session-1', 'mood', 'neutral');
      repo.add('page', 'page-1', 'mood', 'sad');
      repo.add('floor', 'floor-1', 'hp', 50);

      const all = await resolver.resolveAll(fullContext);

      // mood: page overrides chat overrides global
      expect(all.get('mood')!.value).toBe('sad');
      expect(all.get('mood')!.scope).toBe('page');

      // lang: only in global
      expect(all.get('lang')!.value).toBe('en');

      // hp: only in floor
      expect(all.get('hp')!.value).toBe(50);

      expect(all.size).toBe(3);
    });

    it('skips scopes without context ids', async () => {
      repo.add('page', 'page-1', 'secret', 'hidden');
      repo.add('global', 'global', 'visible', 'yes');

      const contextNoPage: VariableContext = { sessionId: 'session-1' };
      const all = await resolver.resolveAll(contextNoPage);

      expect(all.has('secret')).toBe(false);
      expect(all.get('visible')!.value).toBe('yes');
    });

    it('returns empty map when nothing matches', async () => {
      const all = await resolver.resolveAll(fullContext);
      expect(all.size).toBe(0);
    });
  });
});
