import { jsonSchema } from 'ai';
import { describe, it, expect, vi } from 'vitest';
import { GenerationPipeline, GenerationPipelineError } from '../generation-pipeline.js';
import type { LLMPort, LLMRequest, LLMResponse, LLMToolCall, StreamCallbacks } from '../../llm/types.js';
import type { GenerationInput } from '../types.js';

// ── Mock LLM ──────────────────────────────────────────

function createMockLLM(responseText: string, options?: {
  usage?: LLMResponse['usage'];
  finishReason?: string;
  streamChunks?: string[];
  throwError?: Error;
  toolCalls?: LLMToolCall[];
}): LLMPort {
  const usage = options?.usage ?? { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
  const finishReason = options?.finishReason ?? 'stop';

  return {
    async generate(_request: LLMRequest): Promise<LLMResponse> {
      if (options?.throwError) throw options.throwError;
      return { text: responseText, usage, finishReason, toolCalls: options?.toolCalls };
    },
    async stream(request: LLMRequest, callbacks: StreamCallbacks): Promise<LLMResponse> {
      if (options?.throwError) throw options.throwError;
      const chunks = options?.streamChunks ?? [responseText];
      for (const chunk of chunks) {
        callbacks.onChunk?.(chunk);
      }
      const response: LLMResponse = { text: responseText, usage, finishReason, toolCalls: options?.toolCalls };
      callbacks.onFinish?.(response);
      return response;
    },
  };
}

function baseInput(overrides?: Partial<GenerationInput>): GenerationInput {
  return {
    messages: [
      { role: 'system', content: 'You are a narrator.' },
      { role: 'user', content: 'Hello' },
    ],
    params: { temperature: 0.7 },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────

describe('GenerationPipeline', () => {
  describe('basic generation', () => {
    it('runs non-streaming generation', async () => {
      const llm = createMockLLM('Hello World');
      const pipeline = new GenerationPipeline(llm);

      const output = await pipeline.run(baseInput({ params: { stream: false } }));

      expect(output.text).toBe('Hello World');
      expect(output.rawText).toBe('Hello World');
      expect(output.summaries).toEqual([]);
      expect(output.usage.promptTokens).toBe(10);
      expect(output.usage.completionTokens).toBe(5);
      expect(output.finishReason).toBe('stop');
    });

    it('runs streaming generation by default', async () => {
      const chunks = ['Hello', ' ', 'World'];
      const llm = createMockLLM('Hello World', { streamChunks: chunks });
      const pipeline = new GenerationPipeline(llm);

      const receivedChunks: string[] = [];
      const output = await pipeline.run(baseInput(), {
        onChunk: (chunk) => receivedChunks.push(chunk),
      });

      expect(output.text).toBe('Hello World');
      expect(receivedChunks).toEqual(['Hello', ' ', 'World']);
    });
  });

  describe('summary extraction', () => {
    it('extracts summaries from LLM output', async () => {
      const rawText = 'Story content\n<summary>Alice met Bob</summary>\nMore story';
      const llm = createMockLLM(rawText);
      const pipeline = new GenerationPipeline(llm);

      const output = await pipeline.run(baseInput());

      expect(output.summaries).toEqual(['Alice met Bob']);
      expect(output.text).toBe('Story content\n\nMore story');
      expect(output.rawText).toBe(rawText);
    });

    it('extracts multiple summaries', async () => {
      const rawText = '<summary>Fact 1</summary> text <memory>Fact 2</memory>';
      const llm = createMockLLM(rawText);
      const pipeline = new GenerationPipeline(llm);

      const output = await pipeline.run(baseInput());

      expect(output.summaries).toEqual(['Fact 1', 'Fact 2']);
    });

    it('uses custom summary options', async () => {
      const rawText = '<custom>Custom fact</custom>';
      const llm = createMockLLM(rawText);
      const pipeline = new GenerationPipeline(llm);

      const output = await pipeline.run(
        baseInput({ summaryOptions: { tagNames: ['custom'] } }),
      );

      expect(output.summaries).toEqual(['Custom fact']);
    });
  });

  describe('pre-processing', () => {
    it('applies preProcess to messages', async () => {
      const llm = createMockLLM('processed');
      const pipeline = new GenerationPipeline(llm);

      const preProcess = vi.fn((msgs) =>
        msgs.map((m: any) => ({
          ...m,
          content: m.content.toUpperCase(),
        })),
      );

      const output = await pipeline.run(baseInput({ preProcess }));

      expect(preProcess).toHaveBeenCalledOnce();
      expect(output.text).toBe('processed');
    });

    it('wraps preProcess errors as GenerationPipelineError', async () => {
      const llm = createMockLLM('ok');
      const pipeline = new GenerationPipeline(llm);

      await expect(
        pipeline.run(
          baseInput({
            preProcess: () => {
              throw new Error('preprocess fail');
            },
          }),
        ),
      ).rejects.toThrow(GenerationPipelineError);
    });
  });

  describe('post-processing', () => {
    it('applies postProcess to cleaned text', async () => {
      const rawText = 'hello <summary>fact</summary> world';
      const llm = createMockLLM(rawText);
      const pipeline = new GenerationPipeline(llm);

      const output = await pipeline.run(
        baseInput({
          postProcess: (text) => text.toUpperCase(),
        }),
      );

      // Summary extracted first, then post-process on cleaned text
      expect(output.summaries).toEqual(['fact']);
      expect(output.text).toBe('HELLO  WORLD');
      expect(output.rawText).toBe(rawText);
    });

    it('wraps postProcess errors as GenerationPipelineError', async () => {
      const llm = createMockLLM('ok');
      const pipeline = new GenerationPipeline(llm);

      await expect(
        pipeline.run(
          baseInput({
            postProcess: () => {
              throw new Error('postprocess fail');
            },
          }),
        ),
      ).rejects.toThrow(GenerationPipelineError);
    });
  });

  describe('error handling', () => {
    it('wraps LLM errors as GenerationPipelineError with phase=llm', async () => {
      const llm = createMockLLM('', { throwError: new Error('API down') });
      const pipeline = new GenerationPipeline(llm);

      try {
        await pipeline.run(baseInput());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GenerationPipelineError);
        expect((e as GenerationPipelineError).phase).toBe('llm');
      }
    });

    it('calls onError callback for stream errors', async () => {
      const llm: LLMPort = {
        async generate() { throw new Error('not used'); },
        async stream(_req, callbacks) {
          const err = new Error('stream broke');
          callbacks.onError?.(err);
          throw err;
        },
      };

      const pipeline = new GenerationPipeline(llm);
      const onError = vi.fn();

      await expect(
        pipeline.run(baseInput(), { onError }),
      ).rejects.toThrow(GenerationPipelineError);
    });
  });

  describe('abort support', () => {
    it('passes abortSignal to LLM', async () => {
      let capturedSignal: AbortSignal | undefined;
      const llm: LLMPort = {
        async generate() { throw new Error('not used'); },
        async stream(req, callbacks) {
          capturedSignal = req.abortSignal;
          callbacks.onChunk?.('ok');
          return { text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: 'stop' };
        },
      };

      const pipeline = new GenerationPipeline(llm);
      const controller = new AbortController();

      await pipeline.run(baseInput({ abortSignal: controller.signal }));

      expect(capturedSignal).toBe(controller.signal);
    });
  });

  describe('full pipeline integration', () => {
    it('preProcess → LLM → extractSummaries → postProcess', async () => {
      const rawOutput = 'Result text <summary>Important fact</summary> end';
      const llm = createMockLLM(rawOutput, {
        streamChunks: ['Result text <summary>Important fact</summary> end'],
      });
      const pipeline = new GenerationPipeline(llm);

      const log: string[] = [];

      const output = await pipeline.run(
        baseInput({
          preProcess: (msgs) => {
            log.push('preProcess');
            return msgs;
          },
          postProcess: (text) => {
            log.push('postProcess');
            return text.trim();
          },
        }),
        {
          onChunk: () => log.push('chunk'),
        },
      );

      // Verify order
      expect(log).toEqual(['preProcess', 'chunk', 'postProcess']);

      // Verify output
      expect(output.summaries).toEqual(['Important fact']);
      expect(output.text).toBe('Result text  end');
      expect(output.rawText).toBe(rawOutput);
      expect(output.usage.totalTokens).toBe(15);
      expect(output.finishReason).toBe('stop');
    });

    it('works with empty messages', async () => {
      const llm = createMockLLM('output');
      const pipeline = new GenerationPipeline(llm);

      const output = await pipeline.run({
        messages: [],
        params: {},
      });

      expect(output.text).toBe('output');
    });
  });

  describe('tool calling support', () => {
    it('passes tools and maxSteps to LLM request', async () => {
      let capturedRequest: LLMRequest | undefined;
      const llm: LLMPort = {
        async generate(request) {
          capturedRequest = request;
          return { text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: 'stop' };
        },
        async stream(request, callbacks) {
          capturedRequest = request;
          const response: LLMResponse = { text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: 'stop' };
          callbacks.onFinish?.(response);
          return response;
        },
      };

      const fakeTool = {
        description: 'test tool',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => 'result',
      };

      const pipeline = new GenerationPipeline(llm);
      await pipeline.run(baseInput({
        params: { stream: false },
        tools: { my_tool: fakeTool },
        maxSteps: 3,
      }));

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest!.tools).toBeDefined();
      expect(capturedRequest!.tools!['my_tool']).toBeDefined();
      expect(capturedRequest!.maxSteps).toBe(3);
    });

    it('propagates toolCalls from LLM response to output', async () => {
      const mockToolCalls: LLMToolCall[] = [
        { toolName: 'roll_dice', args: { sides: 6 } },
        { toolName: 'get_variable', args: { key: 'hp' } },
      ];

      const llm = createMockLLM('The dice shows 4.', { toolCalls: mockToolCalls });
      const pipeline = new GenerationPipeline(llm);

      const output = await pipeline.run(baseInput({ params: { stream: false } }));

      expect(output.toolCalls).toBeDefined();
      expect(output.toolCalls).toHaveLength(2);
      expect(output.toolCalls![0]!.toolName).toBe('roll_dice');
      expect(output.toolCalls![1]!.toolName).toBe('get_variable');
    });

    it('output.toolCalls is undefined when LLM returns no tool calls', async () => {
      const llm = createMockLLM('No tools used.');
      const pipeline = new GenerationPipeline(llm);

      const output = await pipeline.run(baseInput({ params: { stream: false } }));
      expect(output.toolCalls).toBeUndefined();
    });
  });
});
