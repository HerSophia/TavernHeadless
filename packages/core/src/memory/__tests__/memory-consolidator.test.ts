import { describe, it, expect } from 'vitest';
import { MemoryConsolidator } from '../memory-consolidator.js';
import type { LLMPort, LLMRequest, LLMResponse, StreamCallbacks } from '../../llm/types.js';
import type { MemoryItem, MemoryConsolidationOutput } from '../types.js';
import type { ConsolidationInput } from '../memory-consolidator.js';

function createMockLLM(responseText: string): LLMPort {
  return {
    async generate(_request: LLMRequest): Promise<LLMResponse> {
      return {
        text: responseText,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      };
    },
    async stream(_request: LLMRequest, _callbacks: StreamCallbacks): Promise<LLMResponse> {
      return {
        text: responseText,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      };
    },
  };
}

function makeFact(id: string, content: string, importance = 0.5): MemoryItem {
  return {
    id,
    scope: 'chat',
    scopeId: 'session-1',
    type: 'fact',
    content,
    importance,
    confidence: 1.0,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function baseInput(overrides?: Partial<ConsolidationInput>): ConsolidationInput {
  return {
    currentFloorContent: 'Alice walked into the library.',
    recentSummaries: ['Previous: Alice arrived at the school'],
    existingFacts: [makeFact('fact_1', 'Alice is a student')],
    scope: 'chat',
    scopeId: 'session-1',
    sourceFloorId: 'floor-5',
    ...overrides,
  };
}

describe('MemoryConsolidator', () => {
  describe('consolidate', () => {
    it('parses valid JSON output and returns structured result', async () => {
      const validOutput: MemoryConsolidationOutput = {
        turnSummary: 'Alice entered the library',
        factsAdd: [{ factKey: 'location', value: 'library', scope: 'chat', importance: 0.6 }],
        factsUpdate: [],
        factsDeprecate: [],
      };
      const llm = createMockLLM(JSON.stringify(validOutput));
      const consolidator = new MemoryConsolidator(llm);

      const result = await consolidator.consolidate(baseInput());

      expect(result.output.turnSummary).toBe('Alice entered the library');
      expect(result.output.factsAdd).toHaveLength(1);
      expect(result.output.factsAdd[0]!.factKey).toBe('location');
      expect(result.output.factsAdd[0]!.key).toBe('location');
      expect(result.usage.totalTokens).toBe(150);
    });

    it('handles JSON wrapped in markdown code block', async () => {
      const validOutput: MemoryConsolidationOutput = {
        turnSummary: 'Summary',
        factsAdd: [],
        factsUpdate: [],
        factsDeprecate: [],
      };
      const wrappedText = '```json\n' + JSON.stringify(validOutput) + '\n```';
      const llm = createMockLLM(wrappedText);
      const consolidator = new MemoryConsolidator(llm);

      const result = await consolidator.consolidate(baseInput());

      expect(result.output.turnSummary).toBe('Summary');
    });

    it('handles snake_case JSON keys (turn_summary, facts_add)', async () => {
      const snakeCaseOutput = {
        turn_summary: 'Snake case summary',
        facts_add: [{ fact_key: 'k', value: 'v', scope: 'chat' }],
        facts_update: [],
        facts_deprecate: [],
      };
      const llm = createMockLLM(JSON.stringify(snakeCaseOutput));
      const consolidator = new MemoryConsolidator(llm);

      const result = await consolidator.consolidate(baseInput());

      expect(result.output.turnSummary).toBe('Snake case summary');
      expect(result.output.factsAdd).toHaveLength(1);
      expect(result.output.factsAdd[0]!.factKey).toBe('k');
    });

    it('gracefully degrades when LLM returns invalid JSON', async () => {
      const llm = createMockLLM('This is not JSON at all. Just some text about the story.');
      const consolidator = new MemoryConsolidator(llm);

      const result = await consolidator.consolidate(baseInput());

      expect(result.output.turnSummary).toBe('This is not JSON at all. Just some text about the story.');
      expect(result.output.factsAdd).toEqual([]);
      expect(result.output.factsUpdate).toEqual([]);
      expect(result.output.factsDeprecate).toEqual([]);
      expect(result.degraded).toEqual(expect.objectContaining({
        reason: 'json_parse_failed',
        rawText: 'This is not JSON at all. Just some text about the story.',
        error: expect.any(Error),
      }));
    });

    it('works with empty facts and summaries', async () => {
      const validOutput: MemoryConsolidationOutput = {
        turnSummary: 'Nothing happened',
        factsAdd: [],
        factsUpdate: [],
        factsDeprecate: [],
      };
      const llm = createMockLLM(JSON.stringify(validOutput));
      const consolidator = new MemoryConsolidator(llm);

      const result = await consolidator.consolidate(
        baseInput({
          recentSummaries: [],
          existingFacts: [],
        }),
      );

      expect(result.output.turnSummary).toBe('Nothing happened');
    });

    it('passes custom params to LLM (overriding defaults)', async () => {
      let capturedRequest: LLMRequest | undefined;
      const llm: LLMPort = {
        async generate(req: LLMRequest): Promise<LLMResponse> {
          capturedRequest = req;
          return {
            text: JSON.stringify({ turnSummary: 'ok', factsAdd: [], factsUpdate: [], factsDeprecate: [] }),
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            finishReason: 'stop',
          };
        },
        async stream() {
          throw new Error('not used');
        },
      };
      const consolidator = new MemoryConsolidator(llm);

      await consolidator.consolidate(
        baseInput({ params: { temperature: 0.1, maxOutputTokens: 500 } }),
      );

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest!.params.temperature).toBe(0.1);
      expect(capturedRequest!.params.maxOutputTokens).toBe(500);
      expect(capturedRequest!.params.stream).toBe(false);
    });

    it('sends system prompt and user message with correct structure', async () => {
      let capturedRequest: LLMRequest | undefined;
      const llm: LLMPort = {
        async generate(req: LLMRequest): Promise<LLMResponse> {
          capturedRequest = req;
          return {
            text: JSON.stringify({ turnSummary: 'ok', factsAdd: [], factsUpdate: [], factsDeprecate: [] }),
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            finishReason: 'stop',
          };
        },
        async stream() {
          throw new Error('not used');
        },
      };
      const consolidator = new MemoryConsolidator(llm);

      await consolidator.consolidate(baseInput());

      expect(capturedRequest!.messages).toHaveLength(2);
      expect(capturedRequest!.messages[0]!.role).toBe('system');
      expect(capturedRequest!.messages[0]!.content).toContain('Memory');
      expect(capturedRequest!.messages[1]!.role).toBe('user');
      expect(capturedRequest!.messages[1]!.content).toContain('Alice walked into the library');
      expect(capturedRequest!.messages[1]!.content).toContain('Alice is a student');
      expect(capturedRequest!.messages[1]!.content).toContain('Alice arrived at the school');
    });

    it('handles complete consolidation with all operations', async () => {
      const fullOutput: MemoryConsolidationOutput = {
        turnSummary: 'Alice found a book',
        factsAdd: [
          { factKey: 'book', value: 'ancient tome', scope: 'chat', importance: 0.8 },
        ],
        factsUpdate: [
          { id: 'fact_1', value: 'Alice is a student who found a book', factKey: 'identity' },
        ],
        factsDeprecate: [
          { id: 'fact_old', reason: 'no longer relevant' },
        ],
      };
      const llm = createMockLLM(JSON.stringify(fullOutput));
      const consolidator = new MemoryConsolidator(llm);

      const result = await consolidator.consolidate(baseInput());

      expect(result.output.turnSummary).toBe('Alice found a book');
      expect(result.output.factsAdd).toHaveLength(1);
      expect(result.output.factsUpdate).toHaveLength(1);
      expect(result.output.factsUpdate[0]!.factKey).toBe('identity');
      expect(result.output.factsDeprecate).toHaveLength(1);
    });

    it('throws when LLM call fails', async () => {
      const llm: LLMPort = {
        async generate(): Promise<LLMResponse> {
          throw new Error('API down');
        },
        async stream() {
          throw new Error('not used');
        },
      };
      const consolidator = new MemoryConsolidator(llm);

      await expect(consolidator.consolidate(baseInput())).rejects.toThrow('API down');
    });
  });
});
