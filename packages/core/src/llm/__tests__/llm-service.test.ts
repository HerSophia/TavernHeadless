import { afterEach, describe, it, expect, vi } from 'vitest';
import { LLMService, LLMServiceError, LLMAbortError, LLMTimeoutError } from '../llm-service.js';
import { ProviderRegistry } from '../provider-registry.js';
import type { LLMRequest, StreamCallbacks, ModelConfig, ProviderFactory } from '../types.js';
import { MockLanguageModelV3 } from 'ai/test';

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
      const model = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'Hello World' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
            raw: { totalTokens: 15 },
          },
          warnings: [],
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

      const model = new MockLanguageModelV3({
        doGenerate: async (options) => {
          capturedSettings = options;
          return {
            content: [{ type: 'text', text: 'ok' }],
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
              raw: { totalTokens: 2 },
            },
            warnings: [],
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
          seed: 42,
          repetitionPenalty: 1.1,
          minP: 0.05,
          logitBias: { '42': -5 },
          responseFormat: { type: 'json_schema', jsonSchema: { type: 'object' } },
          reasoningEffort: 'low',
        },
      });

      expect(capturedSettings).toBeDefined();
      expect(capturedSettings.maxOutputTokens).toBe(500);
      expect(capturedSettings.temperature).toBe(0.5);
      expect(capturedSettings.topP).toBe(0.9);
      expect(capturedSettings.frequencyPenalty).toBe(0.3);
      expect(capturedSettings.presencePenalty).toBe(0.2);
      expect(capturedSettings.seed).toBe(42);
      expect(capturedSettings.responseFormat).toEqual({
        type: 'json',
        schema: { type: 'object' },
      });
      expect(capturedSettings.providerOptions).toEqual({
        openai: {
          reasoningEffort: 'low',
          repetitionPenalty: 1.1,
          minP: 0.05,
          logitBias: { '42': -5 },
        },
      });
    });
    function createAnthropicService(captured: { settings?: any }) {
      const model = new MockLanguageModelV3({
        doGenerate: async (options) => {
          captured.settings = options;
          return {
            content: [{ type: 'text', text: 'ok' }],
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
              raw: { totalTokens: 2 },
            },
            warnings: [],
          };
        },
      });
      const registry = new ProviderRegistry();
      const factory: ProviderFactory = () => () => model;
      registry.registerFactory('anthropic', factory);
      registry.register({ id: 'anthropic-provider', type: 'anthropic' });
      return new LLMService(registry, {
      providerId: 'anthropic-provider',
        modelId: 'claude-opus-4-6',
      });
    }

    it('maps an effort level to anthropic adaptive thinking + effort anddrops sampling params', async () => {
      const captured: { settings?: any } = {};
      const service = createAnthropicService(captured);

      await service.generate({
        messages: [{ role: 'user', content: 'test' }],
        params: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          reasoningEffort: 'high',
        },
      });

      // 努力级别走 adaptive + effort（output_config.effort），不强制 budget / max_tokens。
      expect(captured.settings.providerOptions).toEqual({
        anthropic: { thinking: { type: 'adaptive' }, effort: 'high' },
      });
    //anthropic 思考模式不接受这些采样参数，应被移除
      expect(captured.settings.temperature).toBeUndefined();
      expect(captured.settings.topP).toBeUndefined();
      expect(captured.settings.topK).toBeUndefined();
    });

    it('maps the new xhigh / max effort levels to anthropic adaptive thinking + effort', async () => {
      const captured: { settings?: any } = {};
      const service = createAnthropicService(captured);

      await service.generate({
        messages: [{ role: 'user', content: 'test' }],
        params: { reasoningEffort: 'max' },
      });

      expect(captured.settings.providerOptions).toEqual({
        anthropic: { thinking: { type: 'adaptive' }, effort: 'max' },
      });
    });

    it('maps a numeric reasoning effort to anthropic enabled thinking budget and bumps max_tokens', async () => {
      const captured: { settings?: any } = {};
      const service = createAnthropicService(captured);

      await service.generate({
        messages: [{ role: 'user', content: 'test' }],
  params: { reasoningEffort: '12000' },
      });

      expect(captured.settings.providerOptions).toEqual({
        anthropic: { thinking: { type: 'enabled', budgetTokens: 12000 } },
      });
      expect(captured.settings.maxOutputTokens).toBe(12000 + 4096);
    });

    it('maps the adaptive keyword to bare anthropic adaptive thinking', async () => {
      const captured: { settings?: any } = {};
      const service = createAnthropicService(captured);

      await service.generate({
        messages: [{ role: 'user', content: 'test' }],
        params: { reasoningEffort: 'adaptive' },
      });

      expect(captured.settings.providerOptions).toEqual({
        anthropic: { thinking: { type: 'adaptive' } },
      });
    });

    it('does not send reasoning effort to openai when the adaptive keyword is used', async () => {
      let capturedSettings: any;
      const model = new MockLanguageModelV3({
        doGenerate: async (options) => {
          capturedSettings = options;
          return {
            content: [{ type: 'text', text: 'ok' }],
            finishReason: { unified: 'stop', raw: undefined},
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
             raw: { totalTokens: 2 },
            },
            warnings: [],
          };
        },
      });
      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      await service.generate({
        messages: [{ role: 'user', content: 'test' }],
        params: { reasoningEffort: 'adaptive' },
      });

      // 'adaptive' 是 Anthropic 专有概念，OpenAI 系不应下发 reasoningEffort。
      expect(capturedSettings.providerOptions?.openai?.reasoningEffort).toBeUndefined();
    });




    it('omits null-valued generation params from the final sdk settings', async () => {
      let capturedSettings: any;

      const model = new MockLanguageModelV3({
        doGenerate: async (options) => {
          capturedSettings = options;
          return {
            content: [{ type: 'text', text: 'ok' }],
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
              raw: { totalTokens: 2 },
            },
            warnings: [],
          };
        },
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      await service.generate({
        messages: [{ role: 'user', content: 'test' }],
        params: {
          temperature: null as any,
          topP: 0.9,
        },
      });

      expect(capturedSettings).toBeDefined();
      expect(capturedSettings.temperature).toBeUndefined();
      expect(capturedSettings.topP).toBe(0.9);
    });

    it('wraps errors as LLMServiceError', async () => {
      const model = new MockLanguageModelV3({
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
      const model = new MockLanguageModelV3({
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
      const model = new MockLanguageModelV3({
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
      const model = new MockLanguageModelV3({
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Hello' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: ' World' });
              controller.enqueue({ type: 'text-end', id: 'text-1' });
              controller.enqueue(({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                logprobs: undefined,
                usage: {
                  inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 4, text: 4, reasoning: undefined },
                },
              } as any));
              controller.close();
            },
          }),
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
      const model = new MockLanguageModelV3({
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'partial' } as any);
              controller.error(new Error('Stream broke'));
            },
          }),
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
  describe('reasoning capture', () => {
    it('captures reasoning text from non-streaming generation', async () => {
      const model = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [
            { type: 'reasoning', text: 'Thinking step by step' },
            { type: 'text', text: 'Final answer' },
          ],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5,text: 3, reasoning: 2 },
            raw: { totalTokens: 10 },
          },
      warnings: [],
        }),
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      const response = await service.generate({
        messages: [{ role: 'user', content: 'Hi' }],
        params: { reasoningEffort: 'medium' },
      });

      expect(response.text).toBe('Final answer');
      expect(response.reasoningText).toBe('Thinking step by step');
    });

    it('leaves reasoning text undefined when the model returns no reasoning', async () => {
      const model = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'Plain answer' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 2, noCache: 2, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 2, text: 2, reasoning: undefined },
            raw: { totalTokens: 4 },
          },
          warnings: [],
        }),
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      const response = await service.generate({
        messages: [{ role: 'user', content: 'Hi' }],
        params: {},
      });

      expect(response.text).toBe('Plain answer');
      expect(response.reasoningText).toBeUndefined();
    });

    it('streams reasoning deltas and returns the accumulated reasoning text',async () => {
      const model= new MockLanguageModelV3({
    doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'reasoning-start', id: 'r-1' });
              controller.enqueue({ type: 'reasoning-delta', id: 'r-1', delta: 'Think' });
              controller.enqueue({ type: 'reasoning-delta', id: 'r-1', delta: 'ing' });
           controller.enqueue({ type: 'reasoning-end', id: 'r-1' });
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Hello' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: ' World' });
              controller.enqueue({ type: 'text-end', id: 'text-1' });
              controller.enqueue(({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                logprobs: undefined,
                usage: {
                  inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: {total: 6, text: 4, reasoning: 2 },
                },
              } as any));
              controller.close();
            },
          }),
        }),
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      const chunks: string[] = [];
      const reasoningChunks: string[] = [];

      const response = await service.stream(
        {
        messages: [{ role: 'user', content: 'Hi' }],
          params: {},
        },
        {
          onChunk: (chunk) => chunks.push(chunk),
          onReasoning: (delta) => reasoningChunks.push(delta),
        },
      );

      expect(chunks).toEqual(['Hello', ' World']);
      expect(reasoningChunks).toEqual(['Think', 'ing']);
      expect(response.text).toBe('Hello World');
      expect(response.reasoningText).toBe('Thinking');
    });

    it('does not invoke onReasoning when the stream has no reasoning parts', async () => {
      const model = new MockLanguageModelV3({
        doStream: async () => ({
     stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Hello' });
          controller.enqueue({ type: 'text-end', id: 'text-1' });
              controller.enqueue(({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                logprobs: undefined,
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined},
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
              } as any));
          controller.close();
            },
          }),
        }),
      });

      const registry = createMockRegistry(model);
      const service = new LLMService(registry, defaultModel);

      const onReasoning = vi.fn();
      const response = await service.stream(
        {
          messages: [{ role: 'user', content: 'Hi' }],
          params: {},
        },
        { onReasoning },
      );

      expect(response.text).toBe('Hello');
      expect(response.reasoningText).toBeUndefined();
      expect(onReasoning).not.toHaveBeenCalled();
    });
  });



  describe('model override', () => {
    it('uses request.model over defaultModel', async () => {
      const model1 = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'from model1' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
            raw: { totalTokens: 2 },
          },
          warnings: [],
        }),
      });

      const model2 = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'from model2' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
            raw: { totalTokens: 2 },
          },
          warnings: [],
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
      const frozenHandle = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'from frozen handle' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 2, noCache: 2, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
            raw: { totalTokens: 3 },
          },
          warnings: [],
        }),
      });

      const registry = createMockRegistry(new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'from registry' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
            raw: { totalTokens: 2 },
          },
          warnings: [],
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
