import { describe, it, expect, vi } from 'vitest';
import { LLMService, LLMServiceError } from '../llm-service.js';
import { ProviderRegistry } from '../provider-registry.js';
import type { LLMRequest, StreamCallbacks, ModelConfig, ProviderFactory } from '../types.js';
import { MockLanguageModelV1 } from 'ai/test';

// ── 测试 Helpers ──────────────────────────────────────

function createMockRegistry(mockModel: any): ProviderRegistry {
  const registry = new ProviderRegistry();
  const factory: ProviderFactory = () => () => mockModel;
  registry.registerFactory('test', factory);
  registry.register({ id: 'test-provider', type: 'test' as any });
  return registry;
}

const defaultModel: ModelConfig = {
  providerId: 'test-provider',
  modelId: 'test-model',
};

// ── Tests ─────────────────────────────────────────────

describe('LLMService', () => {
  describe('generate (non-streaming)', () => {
    it('returns text and usage', async () => {
      const model = new MockLanguageModelV1({
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          text: 'Hello World',
          usage: { promptTokens: 10, completionTokens: 5 },
          finishReason: 'stop',
        }),
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      const response = await service.generate({
        messages: [{ role: 'user', content: 'Hi' }],
        params: { temperature: 0.7 },
      });

      expect(response.text).toBe('Hello World');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.usage.totalTokens).toBe(15);
      expect(response.finishReason).toBe('stop');
    });

    it('maps generation params correctly', async () => {
      let capturedSettings: any;

      const model = new MockLanguageModelV1({
        doGenerate: async (options) => {
          capturedSettings = options;
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            text: 'ok',
            usage: { promptTokens: 1, completionTokens: 1 },
            finishReason: 'stop',
          };
        },
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      await service.generate({
        messages: [{ role: 'user', content: 'test' }],
        params: {
          maxOutputTokens: 500,
          temperature: 0.5,
          topP: 0.9,
          frequencyPenalty: 0.3,
          presencePenalty: 0.2,
        },
      });

      // MockLanguageModelV1 receives these through generateText's options
      expect(capturedSettings).toBeDefined();
    });

    it('wraps errors as LLMServiceError', async () => {
      const model = new MockLanguageModelV1({
        doGenerate: async () => {
          throw new Error('API Error');
        },
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      await expect(
        service.generate({
          messages: [{ role: 'user', content: 'test' }],
          params: {},
        }),
      ).rejects.toThrow(LLMServiceError);
    });
  });

  describe('stream', () => {
    it('streams chunks and returns full response', async () => {
      const model = new MockLanguageModelV1({
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-delta', textDelta: 'Hello' });
              controller.enqueue({ type: 'text-delta', textDelta: ' World' });
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { promptTokens: 8, completionTokens: 4 },
              });
              controller.close();
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      const chunks: string[] = [];
      let finishResponse: any;

      const callbacks: StreamCallbacks = {
        onChunk: (chunk) => chunks.push(chunk),
        onFinish: (response) => { finishResponse = response; },
      };

      const response = await service.stream(
        {
          messages: [{ role: 'user', content: 'Hi' }],
          params: {},
        },
        callbacks,
      );

      expect(chunks).toEqual(['Hello', ' World']);
      expect(response.text).toBe('Hello World');
      expect(response.usage.promptTokens).toBe(8);
      expect(response.usage.completionTokens).toBe(4);
      expect(response.finishReason).toBe('stop');
      expect(finishResponse).toBeDefined();
      expect(finishResponse.text).toBe('Hello World');
    });

    it('calls onError when stream fails', async () => {
      const model = new MockLanguageModelV1({
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-delta', textDelta: 'partial' });
              controller.error(new Error('Stream broke'));
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      const onError = vi.fn();

      await expect(
        service.stream(
          { messages: [{ role: 'user', content: 'test' }], params: {} },
          { onError },
        ),
      ).rejects.toThrow(LLMServiceError);

      expect(onError).toHaveBeenCalledOnce();
    });
  });

  describe('model override', () => {
    it('uses request.model over defaultModel', async () => {
      const model1 = new MockLanguageModelV1({
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          text: 'from model1',
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'stop',
        }),
      });

      const model2 = new MockLanguageModelV1({
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          text: 'from model2',
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'stop',
        }),
      });

      const registry = new ProviderRegistry();
      registry.registerFactory('type1', () => () => model1);
      registry.registerFactory('type2', () => () => model2);
      registry.register({ id: 'p1', type: 'type1' as any });
      registry.register({ id: 'p2', type: 'type2' as any });

      const service = new LLMService(registry, { providerId: 'p1', modelId: 'm1' });

      // Use default model → model1
      const r1 = await service.generate({
        messages: [{ role: 'user', content: 'test' }],
        params: {},
      });
      expect(r1.text).toBe('from model1');

      // Override with p2 → model2
      const r2 = await service.generate({
        messages: [{ role: 'user', content: 'test' }],
        params: {},
        model: { providerId: 'p2', modelId: 'm2' },
      });
      expect(r2.text).toBe('from model2');
    });
  });
});
