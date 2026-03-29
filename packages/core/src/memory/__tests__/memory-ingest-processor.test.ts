import { describe, expect, it } from 'vitest';

import type { LLMPort, LLMRequest, LLMResponse, StreamCallbacks } from '../../llm/types.js';
import { MemoryIngestProcessor } from '../memory-ingest-processor.js';
import type { MemoryIngestInput, MemoryItem } from '../index.js';

function createMockLLM(responseText: string, capture?: (request: LLMRequest) => void): LLMPort {
  return {
    async generate(request: LLMRequest): Promise<LLMResponse> {
      capture?.(request);
      return {
        text: responseText,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeInput(overrides: Partial<MemoryIngestInput> = {}): MemoryIngestInput {
  return {
    currentFloorContent: 'User:\nAlice asks about the sealed vault.\n\nAssistant:\nBob admits he still has the key.',
    extractedSummaries: ['Alice learns Bob still has the vault key.'],
    recentSummaries: [
      makeItem({ id: 'sum-1', type: 'summary', summaryTier: 'micro', content: 'Alice began to distrust Bob.' }),
    ],
    existingFacts: [
      makeItem({ id: 'fact-1', type: 'fact', factKey: 'vault_key_owner', content: 'vault_key_owner: unknown' }),
    ],
    existingOpenLoops: [
      makeItem({ id: 'loop-1', type: 'open_loop', content: 'Who currently holds the vault key?' }),
    ],
    scope: 'chat',
    scopeId: 'session-1',
    sourceFloorId: 'floor-9',
    ...overrides,
  };
}

describe('MemoryIngestProcessor', () => {
  it('parses valid JSON output with micro summary, facts, and open loops', async () => {
    const processor = new MemoryIngestProcessor(createMockLLM(JSON.stringify({
      microSummary: 'Alice confirms Bob still holds the key to the vault.',
      factsAdd: [
        { factKey: 'vault_key_owner', value: 'Bob currently holds the vault key.', scope: 'chat', importance: 0.8 },
      ],
      factsUpdate: [],
      factsDeprecate: [],
      openLoopsAdd: [
        { content: 'Why Bob kept the key secret remains unclear.', scope: 'chat', importance: 0.7 },
      ],
      openLoopsResolve: [
        { id: 'loop-1', resolution: 'Bob admits he has the key.' },
      ],
    })));

    const result = await processor.process(makeInput());

    expect(result.output).toEqual({
      microSummary: 'Alice confirms Bob still holds the key to the vault.',
      factsAdd: [
        {
          factKey: 'vault_key_owner',
          key: 'vault_key_owner',
          value: 'Bob currently holds the vault key.',
          scope: 'chat',
          importance: 0.8,
        },
      ],
      factsUpdate: [],
      factsDeprecate: [],
      openLoopsAdd: [
        {
          content: 'Why Bob kept the key secret remains unclear.',
          scope: 'chat',
          importance: 0.7,
        },
      ],
      openLoopsResolve: [
        {
          id: 'loop-1',
          resolution: 'Bob admits he has the key.',
        },
      ],
    });
    expect(result.degraded).toBeUndefined();
    expect(result.usage.totalTokens).toBe(150);
  });

  it('falls back to extracted summaries when JSON parsing fails', async () => {
    const processor = new MemoryIngestProcessor(createMockLLM('This is not valid JSON.'));

    const result = await processor.process(makeInput({ extractedSummaries: ['Fallback micro summary from generation.'] }));

    expect(result.output).toEqual({
      microSummary: 'Fallback micro summary from generation.',
      factsAdd: [],
      factsUpdate: [],
      factsDeprecate: [],
      openLoopsAdd: [],
      openLoopsResolve: [],
    });
    expect(result.degraded).toEqual(expect.objectContaining({
      reason: 'json_parse_failed',
      rawText: 'This is not valid JSON.',
      error: expect.any(Error),
    }));
  });

  it('includes recent summaries, facts, and open loops in the prompt', async () => {
    let capturedRequest: LLMRequest | undefined;
    const processor = new MemoryIngestProcessor(createMockLLM(JSON.stringify({
      microSummary: 'ok',
      factsAdd: [],
      factsUpdate: [],
      factsDeprecate: [],
      openLoopsAdd: [],
      openLoopsResolve: [],
    }), (request) => {
      capturedRequest = request;
    }));

    await processor.process(makeInput());

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest!.messages).toHaveLength(2);
    expect(capturedRequest!.messages[0]!.content).toContain('Memory Ingest Processor');
    expect(capturedRequest!.messages[1]!.content).toContain('Latest Floor Transcript');
    expect(capturedRequest!.messages[1]!.content).toContain('Current Turn Extracted Summaries');
    expect(capturedRequest!.messages[1]!.content).toContain('Recent Summaries');
    expect(capturedRequest!.messages[1]!.content).toContain('Known Facts');
    expect(capturedRequest!.messages[1]!.content).toContain('Active Open Loops');
    expect(capturedRequest!.messages[1]!.content).toContain('Who currently holds the vault key?');
  });
});
