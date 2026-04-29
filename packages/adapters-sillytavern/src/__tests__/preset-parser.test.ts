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
    expect(result.promptOrderTracks).toEqual([
      {
        characterId: 100000,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'jailbreak', enabled: true },
        ],
      },
    ]);
    expect(result.selectedPromptOrderCharacterId).toBe(100000);

    // Default values
    expect(result.maxContext).toBe(4095);
    expect(result.maxTokens).toBe(300);
    expect(result.temperature).toBe(1);
    expect(result.topP).toBe(1);
    expect(result.stream).toBe(true);
    expect(result.wiFormat).toBe('{0}');
    expect(result.newChatPrompt).toBe('[Start a new Chat]');
    expect(result.prompts.find((entry) => entry.identifier === 'chatHistory')?.behavior?.semantics).toEqual({ systemPrompt: true });
    expect(result.importReport?.unsupportedFields).not.toContain('prompts[].system_prompt');
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

  it('preserves all prompt_order contexts and reports ignored tracks', () => {
    const preset = {
      ...minimalPreset,
      prompt_order: [
        {
          character_id: 100000,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory', enabled: true },
          ],
          xiaobai_ext: 'default-context',
        },
        {
          character_id: 4242,
          order: [
            { identifier: 'jailbreak', enabled: true },
            { identifier: 'main', enabled: true },
          ],
        },
      ],
      openai_model: 'gpt-4',
    };

    const result = parsePreset(preset);

    expect(result.promptOrder).toEqual(['main', 'chatHistory']);
    expect(result.promptOrderTracks).toEqual([
      {
        characterId: 100000,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: true },
        ],
      },
      {
        characterId: 4242,
        order: [
          { identifier: 'jailbreak', enabled: true },
          { identifier: 'main', enabled: true },
        ],
      },
    ]);
    expect(result.selectedPromptOrderCharacterId).toBe(100000);
    expect(result.importReport?.ignoredPromptOrderCharacterIds).toEqual([4242]);
    expect(result.importReport?.warnings.some((warning) => warning.includes('prompt_order 上下文轨道'))).toBe(true);
    expect(result.importReport?.ignoredFields).toContain('top_level.openai_model');
    expect(result.importReport?.ignoredFields).toContain('prompt_order[].xiaobai_ext');
  });

  it('uses first prompt_order if character_id 100000 not found and records fallback', () => {
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
    expect(result.selectedPromptOrderCharacterId).toBe(99999);
    expect(result.importReport?.warnings.some((warning) => warning.includes('回退'))).toBe(true);
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
    expect(result.promptOrderTracks).toEqual([]);
    expect(result.selectedPromptOrderCharacterId).toBeNull();
    expect(result.importReport?.warnings.some((warning) => warning.includes('未提供 prompt_order'))).toBe(true);
  });

  it('preserves marker flag', () => {
    const result = parsePreset(minimalPreset);
    expect(result.prompts.find(p => p.identifier === 'chatHistory')?.marker).toBe(true);
    expect(result.prompts.find(p => p.identifier === 'main')?.marker).toBeUndefined();
  });

  it('records unresolved markers and placement-related downgrade hints', () => {
    const preset = {
      ...minimalPreset,
      prompts: [
        ...minimalPreset.prompts,
        {
          identifier: 'customMarker',
          name: 'Custom Marker',
          marker: true,
          injection_position: 1,
          injection_depth: 2,
          injection_order: 3,
          injection_trigger: ['continue'],
        },
      ],
      prompt_order: [
        {
          character_id: 100000,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'customMarker', enabled: true },
          ],
        },
      ],
      assistant_prefill: 'prefill',
      continue_nudge_prompt: 'continue',
      names_behavior: 1,
    };

    const result = parsePreset(preset);
    const customMarker = result.prompts.find((entry) => entry.identifier === 'customMarker');

    expect(customMarker?.behavior).toEqual({
      placement: { kind: 'in_chat', depth: 2, order: 3 },
      triggers: ['continue'],
    });
    expect(result.prompts.find((entry) => entry.identifier === 'chatHistory')?.behavior?.semantics).toEqual({ systemPrompt: true });
    expect(result.importReport?.unsupportedFields).not.toContain('prompts[].system_prompt');
    expect(result.importReport?.unsupportedFields).not.toContain('prompts[].forbid_overrides');
    expect(result.importReport?.unresolvedMarkers).toContain('customMarker');
    expect(result.importReport?.downgradedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ identifier: 'customMarker' }),
    ]));
  });

  it('maps supported Prompt Manager placement and trigger fields into prompt behavior', () => {
    const preset = {
      ...minimalPreset,
      prompts: [
        {
          identifier: 'main',
          name: 'Main Prompt',
          role: 'assistant',
          content: 'Reply inline',
          injection_position: 1,
          injection_depth: 1,
          injection_order: 4,
          injection_trigger: ['continue', 'quiet'],
        },
      ],
      prompt_order: [
        {
          character_id: 100000,
          order: [{ identifier: 'main', enabled: true }],
        },
      ],
      names_behavior: 1,
      continue_nudge_prompt: '[Continue]',
    };

    const result = parsePreset(preset);

    expect(result.prompts[0]?.behavior).toEqual({
      placement: { kind: 'in_chat', depth: 1, order: 4 },
      triggers: ['continue', 'quiet'],
    });
    expect(result.importReport?.unsupportedFields).toEqual([]);
  });

  it('maps system_prompt and forbid_overrides into prompt semantics', () => {
    const result = parsePreset({
      ...minimalPreset,
      prompts: [
        {
          identifier: 'main',
          name: 'Main Prompt',
          role: 'system',
          content: 'Keep this system prompt.',
          system_prompt: true,
          forbid_overrides: true,
        },
      ],
    });

    expect(result.prompts[0]?.behavior?.semantics).toEqual({
      systemPrompt: true,
      forbidOverrides: true,
    });
    expect(result.importReport?.unsupportedFields).toEqual([]);
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
    expect(result.importReport?.ignoredFields).toEqual(expect.arrayContaining([
      'top_level.openai_model',
      'top_level.claude_model',
      'top_level.reverse_proxy',
      'top_level.show_external_models',
    ]));
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
    expect(result.promptOrderTracks).toEqual([
      {
        characterId: 100000,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: false },
        ],
      },
    ]);
    expect(result.prompts.find((entry) => entry.identifier === 'chatHistory')?.enabled).toBe(false);
  });
});
