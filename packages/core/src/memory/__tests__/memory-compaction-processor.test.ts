import { describe, expect, it } from 'vitest';

import type { LLMPort, LLMRequest, LLMResponse, StreamCallbacks } from '../../llm/types.js';
import { MemoryCompactionProcessor } from '../memory-compaction-processor.js';
import type { MemoryCompactionInput, MemoryItem } from '../index.js';

function createMockLLM(responseText: string, capture?: (request: LLMRequest) => void): LLMPort {
  return {
    async generate(request: LLMRequest): Promise<LLMResponse> {
      capture?.(request);
      return {
        text: responseText,
        usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
        finishReason: 'stop',
      };
    },
    async stream(_request: LLMRequest, _callbacks: StreamCallbacks): Promise<LLMResponse> {
      throw new Error('not used');
    },
  };
}

function makeItem(overrides: Partial<MemoryItem>): MemoryItem {
  const now = Date.now();
  return {
    id: 'mem-1',
    scope: 'chat',
    scopeId: 'session-1',
    type: 'summary',
    content: 'Default content',
    importance: 0.5,
    confidence: 1,
    status: 'active',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeInput(overrides: Partial<MemoryCompactionInput> = {}): MemoryCompactionInput {
  return {
    sourceMicroSummaries: [
      makeItem({
        id: 'micro-1',
        summaryTier: 'micro',
        content: 'Alice and Bob formed a fragile alliance.',
        coverageStartFloorNo: 1,
        coverageEndFloorNo: 1,
      }),
      makeItem({
        id: 'micro-2',
        summaryTier: 'micro',
        content: 'They found the map but still distrusted the guide.',
        coverageStartFloorNo: 2,
        coverageEndFloorNo: 2,
      }),
    ],
    latestMacroSummary: makeItem({
      id: 'macro-1',
      summaryTier: 'macro',
      content: 'Earlier, Alice entered the city and started searching for the archive.',
    }),
    existingFacts: [
      makeItem({
        id: 'fact-1',
        type: 'fact',
        factKey: 'alliance_status',
        content: 'alliance_status: uncertain',
      }),
    ],
    existingOpenLoops: [
      makeItem({
        id: 'loop-1',
        type: 'open_loop',
        content: 'Can the guide be trusted?',
      }),
    ],
    scope: 'chat',
    scopeId: 'session-1',
    ...overrides,
  };
}

describe('MemoryCompactionProcessor', () => {
  it('parses valid JSON output for macro summary compaction', async () => {
    const processor = new MemoryCompactionProcessor(createMockLLM(JSON.stringify({
      macroSummary: 'Alice and Bob reached a working alliance, secured the map, and still have reason to doubt the guide.',
      factsAdd: [
        { factKey: 'alliance_status', value: 'Alice and Bob are working together cautiously.', scope: 'chat', importance: 0.8 },
      ],
      factsUpdate: [],
      factsDeprecate: [],
      openLoopsAdd: [],
      openLoopsResolve: [
        { id: 'loop-1', resolution: 'The guide remains suspicious but not yet exposed.' },
      ],
      sourceMicroIds: ['micro-1', 'micro-2', 'invalid-id'],
    })));

    const result = await processor.process(makeInput());

    expect(result.output).toEqual({
      macroSummary: 'Alice and Bob reached a working alliance, secured the map, and still have reason to doubt the guide.',
      factsAdd: [
        {
          factKey: 'alliance_status',
          key: 'alliance_status',
          value: 'Alice and Bob are working together cautiously.',
          scope: 'chat',
          importance: 0.8,
        },
      ],
      factsUpdate: [],
      factsDeprecate: [],
      openLoopsAdd: [],
      openLoopsResolve: [
        {
          id: 'loop-1',
          resolution: 'The guide remains suspicious but not yet exposed.',
        },
      ],
      sourceMicroIds: ['micro-1', 'micro-2'],
    });
    expect(result.degraded).toBeUndefined();
    expect(result.usage.totalTokens).toBe(180);
  });

  it('falls back to the source micro summaries when JSON parsing fails', async () => {
    const processor = new MemoryCompactionProcessor(createMockLLM('not valid json'));

    const result = await processor.process(makeInput());

    expect(result.output).toEqual({
      macroSummary: 'Alice and Bob formed a fragile alliance. They found the map but still distrusted the guide.',
      factsAdd: [],
      factsUpdate: [],
      factsDeprecate: [],
      openLoopsAdd: [],
      openLoopsResolve: [],
      sourceMicroIds: ['micro-1', 'micro-2'],
    });
    expect(result.degraded).toEqual(expect.objectContaining({
      reason: 'json_parse_failed',
      rawText: 'not valid json',
      error: expect.any(Error),
    }));
  });

  it('includes source micro summaries, the latest macro summary, facts, and open loops in the prompt', async () => {
    let capturedRequest: LLMRequest | undefined;
    const processor = new MemoryCompactionProcessor(createMockLLM(JSON.stringify({
      macroSummary: 'ok',
      factsAdd: [],
      factsUpdate: [],
      factsDeprecate: [],
      openLoopsAdd: [],
      openLoopsResolve: [],
      sourceMicroIds: ['micro-1', 'micro-2'],
    }), (request) => {
      capturedRequest = request;
    }));

    await processor.process(makeInput());

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest!.messages).toHaveLength(2);
    expect(capturedRequest!.messages[0]!.content).toContain('Memory Macro Compaction Processor');
    expect(capturedRequest!.messages[1]!.content).toContain('Source Micro Summaries');
    expect(capturedRequest!.messages[1]!.content).toContain('Latest Macro Summary');
    expect(capturedRequest!.messages[1]!.content).toContain('Known Facts');
    expect(capturedRequest!.messages[1]!.content).toContain('Active Open Loops');
    expect(capturedRequest!.messages[1]!.content).toContain('Alice and Bob formed a fragile alliance.');
    expect(capturedRequest!.messages[1]!.content).toContain('Can the guide be trusted?');
  });
});
