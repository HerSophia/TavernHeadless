import { describe, expect, it } from 'vitest';

import {
  MemoryScopeResolutionError,
  MemoryScopeResolver,
} from '../memory-scope-resolver.js';

describe('MemoryScopeResolver', () => {
  it('resolves chat scope to sessionId', () => {
    const resolver = new MemoryScopeResolver();

    expect(resolver.resolve('chat', { sessionId: 'session-1' })).toBe('session-1');
  });

  it('resolves floor scope to floorId', () => {
    const resolver = new MemoryScopeResolver();

    expect(resolver.resolve('floor', { floorId: 'floor-1' })).toBe('floor-1');
  });

  it('resolves global scope to accountId', () => {
    const resolver = new MemoryScopeResolver();

    expect(resolver.resolve('global', { accountId: 'account-1' })).toBe('account-1');
  });

  it('uses fallback scopeId for matching chat or floor scope', () => {
    const resolver = new MemoryScopeResolver();

    expect(resolver.resolve('chat', {}, 'session-1')).toBe('session-1');
    expect(resolver.resolve('floor', {}, 'floor-1')).toBe('floor-1');
  });

  it('throws when required scope context is missing', () => {
    const resolver = new MemoryScopeResolver();

    expect(() => resolver.resolve('global', {})).toThrow(MemoryScopeResolutionError);
    expect(() => resolver.resolve('chat', {})).toThrow(MemoryScopeResolutionError);
    expect(() => resolver.resolve('floor', {})).toThrow(MemoryScopeResolutionError);
  });

  it('resolves visible refs in global chat floor order', () => {
    const resolver = new MemoryScopeResolver();

    expect(resolver.resolveVisibleRefs({
      accountId: 'account-1',
      sessionId: 'session-1',
      floorId: 'floor-1',
    })).toEqual([
      { scope: 'global', scopeId: 'account-1' },
      { scope: 'chat', scopeId: 'session-1' },
      { scope: 'floor', scopeId: 'floor-1' },
    ]);
  });

  it('skips missing refs when resolving visible scopes', () => {
    const resolver = new MemoryScopeResolver();

    expect(resolver.resolveVisibleRefs({ sessionId: 'session-1' })).toEqual([
      { scope: 'chat', scopeId: 'session-1' },
    ]);
  });
});
