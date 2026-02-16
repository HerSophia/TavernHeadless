import { describe, it, expect } from 'vitest';
import { Director } from '../director.js';
import type { LLMPort, LLMRequest, LLMResponse, StreamCallbacks } from '../../llm/types.js';
import type { DirectorInput } from '../director.js';
import type { MemoryItem } from '../../memory/types.js';

// ── Test Helpers ──────────────────────────────────────

function createMockLLM(responseText: string): LLMPort {
  return {
    async generate(_request: LLMRequest): Promise<LLMResponse> {
      return {
        text: responseText,
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        finishReason: 'stop',
      };
    },
    async stream(_request: LLMRequest, _callbacks: StreamCallbacks): Promise<LLMResponse> {
      throw new Error('not used');
    },
  };
}

function makeFact(content: string): MemoryItem {
  return {
    id: `fact_${Math.random().toString(36).slice(2, 8)}`,
    scope: 'chat',
    scopeId: 'session-1',
    type: 'fact',
    content,
    importance: 0.5,
    confidence: 1.0,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function baseInput(overrides?: Partial<DirectorInput>): DirectorInput {
  return {
    recentContext: 'Alice entered the dark castle.',
    activeFacts: [makeFact('Alice is brave'), makeFact('The castle is haunted')],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────

describe('Director', () => {
  it('parses valid JSON output', async () => {
    const output = {
      directive: 'Focus on the eerie atmosphere',
      tone: 'tense',
      focusElements: ['castle', 'shadows'],
    };
    const llm = createMockLLM(JSON.stringify(output));
    const director = new Director(llm);

    const result = await director.direct(baseInput());

    expect(result.output.directive).toBe('Focus on the eerie atmosphere');
    expect(result.output.tone).toBe('tense');
    expect(result.output.focusElements).toEqual(['castle', 'shadows']);
    expect(result.usage.totalTokens).toBe(80);
  });

  it('handles JSON wrapped in code block', async () => {
    const output = { directive: 'Build tension', tone: 'dark' };
    const wrappedText = '```json\n' + JSON.stringify(output) + '\n```';
    const llm = createMockLLM(wrappedText);
    const director = new Director(llm);

    const result = await director.direct(baseInput());

    expect(result.output.directive).toBe('Build tension');
    expect(result.output.tone).toBe('dark');
  });

  it('handles snake_case keys (focus_elements)', async () => {
    const output = {
      directive: 'Test',
      tone: 'neutral',
      focus_elements: ['element1'],
    };
    const llm = createMockLLM(JSON.stringify(output));
    const director = new Director(llm);

    const result = await director.direct(baseInput());

    expect(result.output.focusElements).toEqual(['element1']);
  });

  it('gracefully degrades when LLM returns invalid JSON', async () => {
    const llm = createMockLLM('Just continue the story with more action and drama.');
    const director = new Director(llm);

    const result = await director.direct(baseInput());

    expect(result.output.directive).toBe('Just continue the story with more action and drama.');
    expect(result.output.tone).toBeUndefined();
    expect(result.output.focusElements).toBeUndefined();
  });

  it('provides fallback directive when JSON directive is empty', async () => {
    const output = { directive: '', tone: 'happy' };
    const llm = createMockLLM(JSON.stringify(output));
    const director = new Director(llm);

    const result = await director.direct(baseInput());

    expect(result.output.directive).toBeTruthy();
  });

  it('passes custom params to LLM', async () => {
    let capturedRequest: LLMRequest | undefined;
    const llm: LLMPort = {
      async generate(req: LLMRequest): Promise<LLMResponse> {
        capturedRequest = req;
        return {
          text: JSON.stringify({ directive: 'ok' }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: 'stop',
        };
      },
      async stream() { throw new Error('not used'); },
    };
    const director = new Director(llm);

    await director.direct(baseInput(), { temperature: 0.1, maxOutputTokens: 200 });

    expect(capturedRequest!.params.temperature).toBe(0.1);
    expect(capturedRequest!.params.maxOutputTokens).toBe(200);
    expect(capturedRequest!.params.stream).toBe(false);
  });

  it('includes characterSummary and previousDirective in user message', async () => {
    let capturedRequest: LLMRequest | undefined;
    const llm: LLMPort = {
      async generate(req: LLMRequest): Promise<LLMResponse> {
        capturedRequest = req;
        return {
          text: JSON.stringify({ directive: 'ok' }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: 'stop',
        };
      },
      async stream() { throw new Error('not used'); },
    };
    const director = new Director(llm);

    await director.direct(baseInput({
      characterSummary: 'Alice is a fearless knight',
      previousDirective: 'Build up the mystery',
    }));

    const userMsg = capturedRequest!.messages[1]!.content;
    expect(userMsg).toContain('Alice is a fearless knight');
    expect(userMsg).toContain('Build up the mystery');
  });

  it('throws when LLM call fails', async () => {
    const llm: LLMPort = {
      async generate(): Promise<LLMResponse> { throw new Error('API down'); },
      async stream() { throw new Error('not used'); },
    };
    const director = new Director(llm);

    await expect(director.direct(baseInput())).rejects.toThrow('API down');
  });
});
