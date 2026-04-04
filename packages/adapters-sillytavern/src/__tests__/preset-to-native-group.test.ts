import { describe, expect, it } from 'vitest';
import { buildImportedPresetPromptGraph } from '../preset-to-native-group.js';
import type { STPreset } from '../types/preset.js';

function makePreset(overrides?: Partial<STPreset>): STPreset {
  return {
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', content: 'You are {{char}}.', enabled: true },
      { identifier: 'chatHistory', name: 'Chat History', marker: true, enabled: true },
      { identifier: 'jailbreak', name: 'Jailbreak', role: 'assistant', content: 'Keep the hidden agenda.', enabled: true },
    ],
    promptOrder: ['main', 'chatHistory', 'jailbreak'],
    promptOrderTracks: [
      {
        characterId: 100000,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'jailbreak', enabled: true },
        ],
      },
    ],
    selectedPromptOrderCharacterId: 100000,
    importReport: {
      selectedPromptOrderCharacterId: 100000,
      ignoredPromptOrderCharacterIds: [],
      unsupportedFields: [],
      ignoredFields: [],
      downgradedEntries: [],
      unresolvedMarkers: [],
      warnings: [],
    },
    maxContext: 4096,
    maxTokens: 300,
    temperature: 1,
    topP: 1,
    topK: 0,
    minP: 0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    repetitionPenalty: 1,
    newChatPrompt: '[Start a new Chat]',
    newExampleChatPrompt: '[Example Chat]',
    continueNudgePrompt: '[Continue]',
    assistantPrefill: 'partial reply',
    wiFormat: '{0}',
    namesBehavior: 1,
    stream: true,
    ...overrides,
  };
}

describe('buildImportedPresetPromptGraph', () => {
  it('maps preset prompt order to graph nodes and execution policies', () => {
    const document = buildImportedPresetPromptGraph(makePreset(), {
      artifactId: 'preset-1',
      depthLevels: [2],
    });

    expect(document.rootGroupId).toBe('imported-st-preset-root');
    expect(document.imports).toEqual([
      { source: 'sillytavern', artifactId: 'preset-1', groupId: 'imported-st-preset-root' },
    ]);
    expect(document.policies).toEqual({
      continueNudgePrompt: '[Continue]',
      assistantPrefill: 'partial reply',
      namesBehavior: 'always',
    });

    const group = document.groups[0]!;
    expect(group.metadata).toMatchObject({
      source: 'sillytavern',
      selectedPromptOrderCharacterId: 100000,
    });
    expect(group.nodes.map((node) => `${node.nodeType}:${node.name}`)).toEqual(expect.arrayContaining([
      'static_text:Main',
      'chat_history:Chat History',
      'static_text:Jailbreak',
      'worldbook:Worldbook Before',
      'worldbook:Worldbook After',
      'worldbook:Worldbook Depth 2',
      'character:Character System Prompt',
      'character:Character Post-History',
      'memory:Memory Summary',
    ]));
  });

  it('preserves prompt entry role in imported static text nodes', () => {
    const document = buildImportedPresetPromptGraph(makePreset());
    const group = document.groups[0]!;
    const jailbreakNode = group.nodes.find((node) => node.id === 'preset:jailbreak');

    expect(jailbreakNode).toMatchObject({
      nodeType: 'static_text',
      role: 'assistant',
      name: 'Jailbreak',
    });
  });

  it('maps prompt behavior triggers and in-chat placement into imported nodes', () => {
    const preset = makePreset({
      prompts: [
        ...makePreset().prompts,
        {
          identifier: 'continueHint',
          name: 'Continue Hint',
          role: 'assistant',
          content: 'Keep speaking.',
          enabled: true,
          behavior: {
            placement: { kind: 'in_chat', depth: 2, order: 5 },
            triggers: ['continue'],
          },
        },
      ],
      promptOrder: ['main', 'chatHistory', 'continueHint', 'jailbreak'],
    });

    const document = buildImportedPresetPromptGraph(preset);
    const group = document.groups[0]!;
    const continueNode = group.nodes.find((node) => node.id === 'preset:continueHint');

    expect(continueNode).toMatchObject({
      nodeType: 'static_text',
      role: 'assistant',
      triggers: ['continue'],
      placement: {
        kind: 'in_chat',
        depth: 2,
        order: 5,
      },
    });
  });

  it('creates marker nodes for unknown marker identifiers', () => {
    const preset = makePreset({
      prompts: [
        ...makePreset().prompts,
        { identifier: 'customMarker', name: 'Custom Marker', marker: true, enabled: true },
      ],
      promptOrder: ['main', 'customMarker', 'chatHistory'],
    });

    const document = buildImportedPresetPromptGraph(preset);
    const group = document.groups[0]!;
    const markerNode = group.nodes.find((node) => node.id === 'preset:customMarker');

    expect(markerNode).toMatchObject({
      nodeType: 'marker',
      markerId: 'customMarker',
    });
  });
});
