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
});
