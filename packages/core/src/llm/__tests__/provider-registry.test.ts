import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry, ProviderNotFoundError, ProviderInitError } from '../provider-registry.js';
import type { ProviderConfig, ProviderFactory } from '../types.js';

// Mock LanguageModel
const mockLanguageModel = {
  specificationVersion: 'v1',
  provider: 'mock',
  modelId: 'mock-model',
  defaultObjectGenerationMode: undefined,
  supportsImageUrls: false,
  supportsStructuredOutputs: false,
} as any;

// Mock factory that returns our mock model
const mockFactory: ProviderFactory = (_config) => {
  return (_modelId: string) => mockLanguageModel;
};

// Mock factory that tracks calls
const trackingFactory: ProviderFactory = (config) => {
  return (modelId: string) => ({
    ...mockLanguageModel,
    provider: config.id,
    modelId,
  });
};

describe('ProviderRegistry', () => {
  describe('registerFactory + register', () => {
    it('registers a custom factory and uses it', () => {
      const registry = new ProviderRegistry();
      registry.registerFactory('custom-type', mockFactory);

      const config: ProviderConfig = {
        id: 'my-provider',
        type: 'custom-type' as any,
        apiKey: 'test-key',
      };

      registry.register(config);
      expect(registry.has('my-provider')).toBe(true);
    });

    it('throws ProviderInitError for unknown type', () => {
      const registry = new ProviderRegistry();

      expect(() =>
        registry.register({
          id: 'bad',
          type: 'nonexistent' as any,
        }),
      ).toThrow(ProviderInitError);
    });

    it('throws ProviderInitError when factory throws', () => {
      const registry = new ProviderRegistry();
      const failingFactory: ProviderFactory = () => {
        throw new Error('SDK not available');
      };
      registry.registerFactory('failing', failingFactory);

      expect(() =>
        registry.register({
          id: 'fail-provider',
          type: 'failing' as any,
        }),
      ).toThrow(ProviderInitError);
    });
  });

  describe('register / unregister / has', () => {
    it('registers and checks presence', () => {
      const registry = new ProviderRegistry();
      registry.registerFactory('test', mockFactory);

      expect(registry.has('p1')).toBe(false);
      registry.register({ id: 'p1', type: 'test' as any });
      expect(registry.has('p1')).toBe(true);
    });

    it('unregisters a provider', () => {
      const registry = new ProviderRegistry();
      registry.registerFactory('test', mockFactory);
      registry.register({ id: 'p1', type: 'test' as any });

      registry.unregister('p1');
      expect(registry.has('p1')).toBe(false);
    });

    it('re-register overwrites previous', () => {
      const registry = new ProviderRegistry();
      registry.registerFactory('test', trackingFactory);

      registry.register({ id: 'p1', type: 'test' as any, apiKey: 'key1' });
      registry.register({ id: 'p1', type: 'test' as any, apiKey: 'key2' });

      const providers = registry.listProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0]!.apiKey).toBe('key2');
    });
  });

  describe('getModel', () => {
    it('returns a LanguageModel', () => {
      const registry = new ProviderRegistry();
      registry.registerFactory('test', trackingFactory);
      registry.register({ id: 'p1', type: 'test' as any });

      const model = registry.getModel('p1', 'gpt-4o');
      expect(model).toBeDefined();
      expect(model.modelId).toBe('gpt-4o');
    });

    it('throws ProviderNotFoundError for unknown provider', () => {
      const registry = new ProviderRegistry();

      expect(() => registry.getModel('unknown', 'model')).toThrow(ProviderNotFoundError);
    });

    it('passes modelId to the factory getter', () => {
      const registry = new ProviderRegistry();
      const getter = vi.fn().mockReturnValue(mockLanguageModel);
      const factory: ProviderFactory = () => getter;
      registry.registerFactory('test', factory);
      registry.register({ id: 'p1', type: 'test' as any });

      registry.getModel('p1', 'claude-3');
      expect(getter).toHaveBeenCalledWith('claude-3');
    });
  });

  describe('listProviders', () => {
    it('lists all registered providers', () => {
      const registry = new ProviderRegistry();
      registry.registerFactory('test', mockFactory);

      registry.register({ id: 'a', type: 'test' as any });
      registry.register({ id: 'b', type: 'test' as any });
      registry.register({ id: 'c', type: 'test' as any });

      const providers = registry.listProviders();
      expect(providers).toHaveLength(3);
      expect(providers.map(p => p.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array when no providers', () => {
      const registry = new ProviderRegistry();
      expect(registry.listProviders()).toEqual([]);
    });
  });

  describe('unregister non-existent', () => {
    it('does not throw when unregistering non-existent provider', () => {
      const registry = new ProviderRegistry();
      expect(() => registry.unregister('nonexistent')).not.toThrow();
    });
  });
});
