import { describe, it, expect } from 'vitest';
import { parsePreset } from '../parsers/preset-parser.js';

describe('parsePreset', () => {
  const minimalPreset = {
    prompts: [
      { identifier: 'main', name: 'Main Prompt', role: 'system', content: 'Write {{char}}.' },
      { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
      { identifier: 'jailbreak', name: 'Jailbreak', role: 'system', content: 'Be creative.' },
    ],
    prompt_order: [
      {
        character_id: 100000,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'jailbreak', enabled: true },
        ],
      },
    ],
  };

  it('parses minimal preset with defaults', () => {
    const result = parsePreset(minimalPreset);

    expect(result.prompts).toHaveLength(3);
    expect(result.prompts[0]!.identifier).toBe('main');
    expect(result.prompts[0]!.content).toBe('Write {{char}}.');
    expect(result.prompts[0]!.enabled).toBe(true);

    expect(result.promptOrder).toEqual(['main', 'chatHistory', 'jailbreak']);

    // Default values
    expect(result.maxContext).toBe(4095);
    expect(result.maxTokens).toBe(300);
    expect(result.temperature).toBe(1);
    expect(result.topP).toBe(1);
    expect(result.stream).toBe(true);
    expect(result.wiFormat).toBe('{0}');
    expect(result.newChatPrompt).toBe('[Start a new Chat]');
  });

  it('filters disabled prompts from promptOrder', () => {
    const preset = {
      ...minimalPreset,
      prompt_order: [
        {
          character_id: 100000,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory', enabled: true },
            { identifier: 'jailbreak', enabled: false },
          ],
        },
      ],
    };

    const result = parsePreset(preset);
    expect(result.promptOrder).toEqual(['main', 'chatHistory']);
    // But prompts still has jailbreak with enabled=false
    expect(result.prompts.find(p => p.identifier === 'jailbreak')?.enabled).toBe(false);
  });

  it('parses generation parameters', () => {
    const preset = {
      ...minimalPreset,
      openai_max_context: 8192,
      openai_max_tokens: 500,
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      min_p: 0.05,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      repetition_penalty: 1.1,
    };

    const result = parsePreset(preset);
    expect(result.maxContext).toBe(8192);
    expect(result.maxTokens).toBe(500);
    expect(result.temperature).toBe(0.7);
    expect(result.topP).toBe(0.9);
    expect(result.topK).toBe(40);
    expect(result.minP).toBe(0.05);
    expect(result.frequencyPenalty).toBe(0.5);
    expect(result.presencePenalty).toBe(0.3);
    expect(result.repetitionPenalty).toBe(1.1);
  });

  it('uses first prompt_order if character_id 100000 not found', () => {
    const preset = {
      ...minimalPreset,
      prompt_order: [
        {
          character_id: 99999,
          order: [
            { identifier: 'jailbreak', enabled: true },
            { identifier: 'main', enabled: true },
          ],
        },
      ],
    };

    const result = parsePreset(preset);
    expect(result.promptOrder).toEqual(['jailbreak', 'main']);
  });

  it('handles empty prompt_order', () => {
    const preset = {
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: 'Hello' },
      ],
    };

    const result = parsePreset(preset);
    // Falls back to prompts order
    expect(result.promptOrder).toEqual(['main']);
  });

  it('preserves marker flag', () => {
    const result = parsePreset(minimalPreset);
    expect(result.prompts.find(p => p.identifier === 'chatHistory')?.marker).toBe(true);
    expect(result.prompts.find(p => p.identifier === 'main')?.marker).toBeUndefined();
  });

  it('ignores extra fields', () => {
    const preset = {
      ...minimalPreset,
      openai_model: 'gpt-4',
      claude_model: 'claude-3',
      reverse_proxy: 'http://proxy',
      show_external_models: true,
    };

    // Should not throw
    const result = parsePreset(preset);
    expect(result.prompts).toHaveLength(3);
  });

  it('supports legacy compact preset aliases', () => {
    const preset = {
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: 'Legacy content' },
        { identifier: 'chatHistory', name: 'History', marker: true, enabled: false },
      ],
      promptOrder: ['main'],
      maxContext: 9000,
      maxTokens: 700,
      topP: 0.85,
      frequencyPenalty: 0.3,
      stream: false,
    };

    const result = parsePreset(preset);
    expect(result.maxContext).toBe(9000);
    expect(result.maxTokens).toBe(700);
    expect(result.topP).toBe(0.85);
    expect(result.frequencyPenalty).toBe(0.3);
    expect(result.stream).toBe(false);
    expect(result.promptOrder).toEqual(['main']);
    expect(result.prompts.find((entry) => entry.identifier === 'chatHistory')?.enabled).toBe(false);
  });
});
