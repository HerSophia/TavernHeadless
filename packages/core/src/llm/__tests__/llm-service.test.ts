import { afterEach, describe, it, expect, vi } from 'vitest';
import { LLMService, LLMServiceError, LLMAbortError, LLMTimeoutError } from '../llm-service.js';
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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
          reasoningEffort: 'low',
        },
      });

      // MockLanguageModelV1 receives these through generateText's options
      expect(capturedSettings).toBeDefined();
      expect(capturedSettings.maxTokens).toBe(500);
      expect(capturedSettings.temperature).toBe(0.5);
      expect(capturedSettings.topP).toBe(0.9);
      expect(capturedSettings.frequencyPenalty).toBe(0.3);
      expect(capturedSettings.presencePenalty).toBe(0.2);
      expect(capturedSettings.providerMetadata).toEqual({
        openai: { reasoningEffort: 'low' },
      });
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

    it('maps AbortError with timeout cause to LLMTimeoutError', async () => {
      vi.useFakeTimers();

      let capturedAbortSignal: AbortSignal | undefined;
      const model = new MockLanguageModelV1({
        doGenerate: async (options: any) => {
          capturedAbortSignal = options.abortSignal as AbortSignal | undefined;

          return await new Promise((_, reject) => {
            capturedAbortSignal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('Aborted'), {
                name: 'AbortError',
                cause: capturedAbortSignal?.reason,
              }));
            }, { once: true });
          });
        },
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);
      const generatePromise = service.generate({
        messages: [{ role: 'user', content: 'timeout' }],
        params: { timeoutMs: 25 },
      });
      const expectation = expect(generatePromise).rejects.toBeInstanceOf(LLMTimeoutError);

      await vi.advanceTimersByTimeAsync(25);
      await expectation;
      expect(capturedAbortSignal).toBeInstanceOf(AbortSignal);

    });

    it('maps AbortError without timeout cause to LLMAbortError', async () => {
      const abortController = new AbortController();
      let capturedAbortSignal: AbortSignal | undefined;
      const model = new MockLanguageModelV1({
        doGenerate: async (options: any) => {
          capturedAbortSignal = options.abortSignal as AbortSignal | undefined;

          return await new Promise((_, reject) => {
            const rejectAbort = () => {
              reject(Object.assign(new Error('Aborted'), {
                name: 'AbortError',
              }));
            };

            if (capturedAbortSignal?.aborted) {
              rejectAbort();
              return;
            }

            capturedAbortSignal?.addEventListener('abort', rejectAbort, { once: true });
          });
        },
      });
      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      const generatePromise = service.generate({
        messages: [{ role: 'user', content: 'abort' }],
        params: {},
        abortSignal: abortController.signal,
      });
      const expectation = expect(generatePromise).rejects.toBeInstanceOf(LLMAbortError);

      abortController.abort(new Error('cancelled'));

      await expectation;
      expect(capturedAbortSignal).toBe(abortController.signal);
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

    it('uses request.model.languageModel without consulting the registry', async () => {
      const frozenHandle = new MockLanguageModelV1({
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          text: 'from frozen handle',
          usage: { promptTokens: 2, completionTokens: 1 },
          finishReason: 'stop',
        }),
      });

      const registry = createMockRegistry(new MockLanguageModelV1({
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          text: 'from registry',
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'stop',
        }),
      }));
      const getModelSpy = vi.spyOn(registry, 'getModel');
      const service = new LLMService(registry, defaultModel);

      const response = await service.generate({
        messages: [{ role: 'user', content: 'test' }],
        params: {},
        model: { providerId: 'p-frozen', modelId: 'm-frozen', languageModel: frozenHandle },
      });

      expect(response.text).toBe('from frozen handle');
      expect(getModelSpy).not.toHaveBeenCalled();
    });
  });
});
