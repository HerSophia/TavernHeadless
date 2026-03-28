import { describe, it, expect, beforeEach } from 'vitest';
import type { VariableScope, VariableEntry } from '@tavern/shared';
import type { VariableRepository, VariableRepositoryOptions } from '../../ports/index.js';
import type { VariableContext } from '../../types.js';
import { VariableResolver } from '../../variables/variable-resolver.js';
import { TemplateEngine, TemplateVariableError } from '../template-engine.js';

// ─── In-memory VariableRepository ─────────────────────

class InMemoryVariableRepository implements VariableRepository {
  private store: VariableEntry[] = [];
  private nextId = 1;

  seed(scope: VariableScope, scopeId: string, key: string, value: unknown): void {
    this.store.push({
      id: `var-${this.nextId++}`,
      scope,
      scopeId,
      key,
      value,
      updatedAt: Date.now(),
    });
  }

  async findByKey(
    scope: VariableScope,
    scopeId: string,
    key: string,
    _options?: VariableRepositoryOptions
  ): Promise<VariableEntry | null> {
    return this.store.find(e => e.scope === scope && e.scopeId === scopeId && e.key === key) ?? null;
  }

  async findAllByScope(
    scope: VariableScope,
    scopeId: string,
    _options?: VariableRepositoryOptions
  ): Promise<VariableEntry[]> {
    return this.store.filter(e => e.scope === scope && e.scopeId === scopeId);
  }

  async upsert(
    scope: VariableScope,
    scopeId: string,
    key: string,
    value: unknown,
    _options?: VariableRepositoryOptions
  ): Promise<VariableEntry> {
    const entry: VariableEntry = {
      id: `var-${this.nextId++}`, scope, scopeId, key, value, updatedAt: Date.now(),
    };
    this.store.push(entry);
    return entry;
  }

  async deleteById(_id: string, _options?: VariableRepositoryOptions): Promise<boolean> { return false; }
  async deleteByKey(
    _scope: VariableScope,
    _scopeId: string,
    _key: string,
    _options?: VariableRepositoryOptions
  ): Promise<boolean> { return false; }
}

// ─── Tests ────────────────────────────────────────────

describe('TemplateEngine', () => {
  let engine: TemplateEngine;

  beforeEach(() => {
    engine = new TemplateEngine();
  });

  // ── render (synchronous) ──

  describe('render', () => {
    it('replaces a single variable', () => {
      const vars = new Map<string, unknown>([['name', 'Alice']]);
      expect(engine.render('Hello, {{name}}!', vars)).toBe('Hello, Alice!');
    });

    it('replaces multiple variables', () => {
      const vars = new Map<string, unknown>([
        ['name', 'Alice'],
        ['mood', 'happy'],
      ]);
      expect(engine.render('{{name}} is {{mood}}', vars)).toBe('Alice is happy');
    });

    it('handles spaces in placeholders', () => {
      const vars = new Map<string, unknown>([['name', 'Bob']]);
      expect(engine.render('Hi {{ name }}!', vars)).toBe('Hi Bob!');
    });

    it('uses default value when variable is missing', () => {
      const vars = new Map<string, unknown>();
      expect(engine.render('Mode: {{mode:normal}}', vars)).toBe('Mode: normal');
    });

    it('prefers variable value over default', () => {
      const vars = new Map<string, unknown>([['mode', 'advanced']]);
      expect(engine.render('Mode: {{mode:normal}}', vars)).toBe('Mode: advanced');
    });

    it('handles spaces in default value syntax', () => {
      const vars = new Map<string, unknown>();
      expect(engine.render('{{ mode : fallback }}', vars)).toBe('fallback');
    });

    it('serializes number values', () => {
      const vars = new Map<string, unknown>([['hp', 100]]);
      expect(engine.render('HP: {{hp}}', vars)).toBe('HP: 100');
    });

    it('serializes boolean values', () => {
      const vars = new Map<string, unknown>([['alive', true]]);
      expect(engine.render('Alive: {{alive}}', vars)).toBe('Alive: true');
    });

    it('serializes object values as JSON', () => {
      const vars = new Map<string, unknown>([['data', { x: 1 }]]);
      expect(engine.render('Data: {{data}}', vars)).toBe('Data: {"x":1}');
    });

    it('serializes null to empty string', () => {
      const vars = new Map<string, unknown>([['val', null]]);
      expect(engine.render('V: {{val}}', vars)).toBe('V: ');
    });

    // ── undefinedBehavior ──

    it('keep: preserves placeholder when variable missing (default)', () => {
      const vars = new Map<string, unknown>();
      expect(engine.render('{{unknown}}', vars)).toBe('{{unknown}}');
    });

    it('empty: replaces with empty string', () => {
      const vars = new Map<string, unknown>();
      expect(engine.render('A{{x}}B', vars, { undefinedBehavior: 'empty' })).toBe('AB');
    });

    it('error: throws TemplateVariableError', () => {
      const vars = new Map<string, unknown>();
      expect(() =>
        engine.render('{{missing}}', vars, { undefinedBehavior: 'error' })
      ).toThrow(TemplateVariableError);
    });

    // ── Edge cases ──

    it('returns template as-is when no placeholders', () => {
      const vars = new Map<string, unknown>();
      expect(engine.render('plain text', vars)).toBe('plain text');
    });

    it('handles empty template', () => {
      const vars = new Map<string, unknown>();
      expect(engine.render('', vars)).toBe('');
    });

    it('handles adjacent placeholders', () => {
      const vars = new Map<string, unknown>([
        ['a', 'X'],
        ['b', 'Y'],
      ]);
      expect(engine.render('{{a}}{{b}}', vars)).toBe('XY');
    });

    it('does not process nested braces', () => {
      const vars = new Map<string, unknown>([['name', 'A']]);
      // {{{name}}} → outer {{ is partial, inner {{name}} matches
      expect(engine.render('{{{name}}}', vars)).toBe('{A}');
    });
  });

  // ── renderAsync ──

  describe('renderAsync', () => {
    it('resolves variables via VariableResolver', async () => {
      const repo = new InMemoryVariableRepository();
      repo.seed('global', 'global', 'char_name', 'Eve');
      repo.seed('chat', 'session-1', 'mood', 'curious');

      const resolver = new VariableResolver(repo);
      const context: VariableContext = { sessionId: 'session-1' };

      const result = await engine.renderAsync(
        '{{char_name}} feels {{mood}}',
        resolver,
        context
      );

      expect(result).toBe('Eve feels curious');
    });

    it('respects undefinedBehavior', async () => {
      const repo = new InMemoryVariableRepository();
      const resolver = new VariableResolver(repo);
      const context: VariableContext = {};

      const result = await engine.renderAsync(
        'Hello {{name}}',
        resolver,
        context,
        { undefinedBehavior: 'empty' }
      );

      expect(result).toBe('Hello ');
    });

    it('returns template as-is when no placeholders', async () => {
      const repo = new InMemoryVariableRepository();
      const resolver = new VariableResolver(repo);

      const result = await engine.renderAsync('no vars', resolver, {});
      expect(result).toBe('no vars');
    });
  });

  // ── extractVariableNames ──

  describe('extractVariableNames', () => {
    it('extracts single name', () => {
      expect(engine.extractVariableNames('{{name}}')).toEqual(['name']);
    });

    it('extracts multiple unique names', () => {
      const names = engine.extractVariableNames('{{a}} {{b}} {{a}}');
      expect(names).toEqual(['a', 'b']);
    });

    it('extracts name from default value syntax', () => {
      expect(engine.extractVariableNames('{{name:fallback}}')).toEqual(['name']);
    });

    it('trims whitespace', () => {
      expect(engine.extractVariableNames('{{ name  }}')).toEqual(['name']);
    });

    it('returns empty array for no placeholders', () => {
      expect(engine.extractVariableNames('plain text')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(engine.extractVariableNames('')).toEqual([]);
    });
  });
});
