import { describe, it, expect } from 'vitest';
import { Verifier } from '../verifier.js';
import type { LLMPort, LLMRequest, LLMResponse, StreamCallbacks } from '../../llm/types.js';
import type { VerifierInput } from '../verifier.js';
import type { MemoryItem } from '../../memory/types.js';

// ── Test Helpers ──────────────────────────────────────

function createMockLLM(responseText: string): LLMPort {
  return {
    async generate(_request: LLMRequest): Promise<LLMResponse> {
      return {
        text: responseText,
        usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
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

function baseInput(overrides?: Partial<VerifierInput>): VerifierInput {
  return {
    generatedText: 'Alice flew across the room and cast a fireball.',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────

describe('Verifier', () => {
  it('parses valid JSON output with passed=true', async () => {
    const output = { passed: true, issues: [] };
    const llm = createMockLLM(JSON.stringify(output));
    const verifier = new Verifier(llm);

    const result = await verifier.verify(baseInput());

    expect(result.output.passed).toBe(true);
    expect(result.output.issues).toEqual([]);
    expect(result.output.suggestion).toBeUndefined();
    expect(result.usage.totalTokens).toBe(60);
  });

  it('parses output with issues and suggestion', async () => {
    const output = {
      passed: false,
      issues: [
        { description: 'Alice cannot fly', severity: 'error' },
        { description: 'Tone seems off', severity: 'warning' },
      ],
      suggestion: 'Replace flying with running',
    };
    const llm = createMockLLM(JSON.stringify(output));
    const verifier = new Verifier(llm);

    const result = await verifier.verify(baseInput());

    expect(result.output.passed).toBe(false);
    expect(result.output.issues).toHaveLength(2);
    expect(result.output.issues[0]!.description).toBe('Alice cannot fly');
    expect(result.output.issues[0]!.severity).toBe('error');
    expect(result.output.issues[1]!.severity).toBe('warning');
    expect(result.output.suggestion).toBe('Replace flying with running');
  });

  it('handles JSON wrapped in code block', async () => {
    const output = { passed: true, issues: [] };
    const wrappedText = '```json\n' + JSON.stringify(output) + '\n```';
    const llm = createMockLLM(wrappedText);
    const verifier = new Verifier(llm);

    const result = await verifier.verify(baseInput());

    expect(result.output.passed).toBe(true);
  });

  it('gracefully degrades when LLM returns invalid JSON', async () => {
    const llm = createMockLLM('The text looks fine to me!');
    const verifier = new Verifier(llm);

    const result = await verifier.verify(baseInput());

    // Should default to passed=true when parsing fails
    expect(result.output.passed).toBe(true);
    expect(result.output.issues).toEqual([]);
  });

  it('includes characterRules and activeFacts in user message', async () => {
    let capturedRequest: LLMRequest | undefined;
    const llm: LLMPort = {
      async generate(req: LLMRequest): Promise<LLMResponse> {
        capturedRequest = req;
        return {
          text: JSON.stringify({ passed: true, issues: [] }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: 'stop',
        };
      },
      async stream() { throw new Error('not used'); },
    };
    const verifier = new Verifier(llm);

    await verifier.verify(baseInput({
      characterRules: 'Alice cannot use magic',
      activeFacts: [makeFact('Alice is a normal human')],
    }));

    const userMsg = capturedRequest!.messages[1]!.content;
    expect(userMsg).toContain('Alice cannot use magic');
    expect(userMsg).toContain('Alice is a normal human');
    expect(userMsg).toContain('Alice flew across the room');
  });

  it('passes custom params to LLM', async () => {
    let capturedRequest: LLMRequest | undefined;
    const llm: LLMPort = {
      async generate(req: LLMRequest): Promise<LLMResponse> {
        capturedRequest = req;
        return {
          text: JSON.stringify({ passed: true, issues: [] }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: 'stop',
        };
      },
      async stream() { throw new Error('not used'); },
    };
    const verifier = new Verifier(llm);

    await verifier.verify(baseInput(), { temperature: 0.0, maxOutputTokens: 300 });

    expect(capturedRequest!.params.temperature).toBe(0.0);
    expect(capturedRequest!.params.maxOutputTokens).toBe(300);
    expect(capturedRequest!.params.stream).toBe(false);
  });

  it('infers passed=false when issues contain errors', async () => {
    // LLM forgets to include "passed" but returns errors
    const output = {
      issues: [
        { description: 'Contradiction found', severity: 'error' },
      ],
    };
    const llm = createMockLLM(JSON.stringify(output));
    const verifier = new Verifier(llm);

    const result = await verifier.verify(baseInput());

    expect(result.output.passed).toBe(false);
  });

  it('throws when LLM call fails', async () => {
    const llm: LLMPort = {
      async generate(): Promise<LLMResponse> { throw new Error('API down'); },
      async stream() { throw new Error('not used'); },
    };
    const verifier = new Verifier(llm);

    await expect(verifier.verify(baseInput())).rejects.toThrow('API down');
  });
});
