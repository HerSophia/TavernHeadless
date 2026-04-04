import { describe, expect, it } from 'vitest';

import { parseCharacterCard } from '../parsers/character-parser.js';

describe('parseCharacterCard', () => {
  it('parses TavernCard v2 envelope payload and preserves richer fields', () => {
    const input = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Ari',
        description: '  A wandering mage.  ',
        personality: 'Calm and witty',
        scenario: 'Foggy port city',
        first_mes: 'Hello, traveler.',
        mes_example: '<START>\nAri: The stars are loud tonight.',
        alternate_greetings: ['Alt one.', '  Alt two.  '],
        system_prompt: ' Stay in character. ',
        post_history_instructions: ' End with a question. ',
        creator_notes: ' Creator note. ',
        tags: ['mage', '  night  '],
        creator: ' Archivist ',
        character_version: ' 2.1 ',
        extensions: { foo: 'bar' },
        extra_field: 'keep me',
      },
    };

    const parsed = parseCharacterCard(input);

    expect(parsed.format).toBe('v2');
    expect(parsed.spec).toBe('chara_card_v2');
    expect(parsed.specVersion).toBe('2.0');
    expect(parsed.raw).toEqual(input);
    expect(parsed.core).toEqual({
      name: 'Ari',
      description: 'A wandering mage.',
      personality: 'Calm and witty',
      scenario: 'Foggy port city',
      exampleDialogue: '<START>\nAri: The stars are loud tonight.',
    });
    expect(parsed.greetings.primaryGreeting).toBe('Hello, traveler.');
    expect(parsed.greetings.alternateGreetings).toEqual(['Alt one.', 'Alt two.']);
    expect(parsed.prompts.systemPrompt).toBe('Stay in character.');
    expect(parsed.prompts.postHistoryInstructions).toBe('End with a question.');
    expect(parsed.prompts.creatorNotes).toBe('Creator note.');
    expect(parsed.metadata.tags).toEqual(['mage', 'night']);
    expect(parsed.metadata.creator).toBe('Archivist');
    expect(parsed.metadata.characterVersion).toBe('2.1');
    expect(parsed.extensions).toEqual({ foo: 'bar' });
    expect(parsed.unknownFields).toEqual({ extra_field: 'keep me' });
  });

  it('parses legacy flat payload and fills normalized defaults', () => {
    const parsed = parseCharacterCard({
      name: 'Nora',
      description: '  ',
    });

    expect(parsed.format).toBe('legacy');
    expect(parsed.core).toEqual({
      name: 'Nora',
      description: undefined,
      personality: undefined,
      scenario: undefined,
      exampleDialogue: undefined,
    });
    expect(parsed.greetings.primaryGreeting).toBeUndefined();
    expect(parsed.greetings.alternateGreetings).toBeUndefined();
    expect(parsed.prompts.systemPrompt).toBeUndefined();
    expect(parsed.extensions).toBeUndefined();
  });

  it('parses Character Card V3 payload and keeps V3-specific fields', () => {
    const parsed = parseCharacterCard({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Lyra',
        first_mes: 'The archive is open.',
        alternate_greetings: ['The archive is open.', 'The pages are ready.'],
        group_only_greetings: ['Group archive greeting'],
        assets: [
          { type: 'icon', uri: 'https://example.com/icon.png', name: 'main', ext: 'png' },
        ],
        source: ['https://example.com/cards/lyra'],
        creation_date: 1710000000,
        modification_date: 1710001234,
      },
    });

    expect(parsed.format).toBe('v3');
    expect(parsed.spec).toBe('chara_card_v3');
    expect(parsed.greetings.primaryGreeting).toBe('The archive is open.');
    expect(parsed.greetings.alternateGreetings).toEqual(['The archive is open.', 'The pages are ready.']);
    expect(parsed.greetings.groupOnlyGreetings).toEqual(['Group archive greeting']);
    expect(parsed.assets).toEqual([
      { type: 'icon', uri: 'https://example.com/icon.png', name: 'main', ext: 'png' },
    ]);
    expect(parsed.metadata.source).toEqual(['https://example.com/cards/lyra']);
    expect(parsed.metadata.creationDate).toBe(1710000000);
    expect(parsed.metadata.modificationDate).toBe(1710001234);
  });

  it('throws for missing character name', () => {
    expect(() => parseCharacterCard({ data: { description: 'No name' } })).toThrow();
  });

  it('throws when name exceeds max length', () => {
    expect(() =>
      parseCharacterCard({
        name: 'x'.repeat(121),
      }),
    ).toThrow();
  });
});
