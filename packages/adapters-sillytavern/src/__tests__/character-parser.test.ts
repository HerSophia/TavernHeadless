import { describe, expect, it } from 'vitest';

import { parseCharacterCard } from '../parsers/character-parser.js';

describe('parseCharacterCard', () => {
  it('parses TavernCard v2 envelope payload', () => {
    const parsed = parseCharacterCard({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Ari',
        description: '  A wandering mage.  ',
        personality: 'Calm and witty',
        scenario: 'Foggy port city',
        first_mes: 'Hello, traveler.',
        mes_example: '<START>\nAri: The stars are loud tonight.',
      },
    });

    expect(parsed).toEqual({
      name: 'Ari',
      description: 'A wandering mage.',
      personality: 'Calm and witty',
      scenario: 'Foggy port city',
      firstMes: 'Hello, traveler.',
      mesExample: '<START>\nAri: The stars are loud tonight.',
    });
  });

  it('parses legacy flat payload and fills defaults', () => {
    const parsed = parseCharacterCard({
      name: 'Nora',
      description: '  ',
    });

    expect(parsed).toEqual({
      name: 'Nora',
      description: '',
      personality: '',
      scenario: '',
      firstMes: '',
      mesExample: '',
    });
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
