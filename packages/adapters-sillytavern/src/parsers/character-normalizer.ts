import type { CharacterProfile, ImportedCharacterCard } from '../types/character.js';

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalStringArray(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (normalized.length === 0) {
    return undefined;
  }

  return [...new Set(normalized)];
}

export function normalizeImportedCharacterCard(card: ImportedCharacterCard): CharacterProfile {
  return {
    core: {
      name: card.core.name,
      description: normalizeOptionalText(card.core.description),
      personality: normalizeOptionalText(card.core.personality),
      scenario: normalizeOptionalText(card.core.scenario),
      exampleDialogue: normalizeOptionalText(card.core.exampleDialogue),
    },
    greetings: {
      primaryGreeting: normalizeOptionalText(card.greetings.primaryGreeting),
      alternateGreetings: normalizeOptionalStringArray(card.greetings.alternateGreetings),
      groupOnlyGreetings: normalizeOptionalStringArray(card.greetings.groupOnlyGreetings),
    },
    prompts: {
      systemPrompt: normalizeOptionalText(card.prompts.systemPrompt),
      postHistoryInstructions: normalizeOptionalText(card.prompts.postHistoryInstructions),
      creatorNotes: normalizeOptionalText(card.prompts.creatorNotes),
    },
    metadata: {
      tags: normalizeOptionalStringArray(card.metadata.tags),
      creator: normalizeOptionalText(card.metadata.creator),
      characterVersion: normalizeOptionalText(card.metadata.characterVersion),
      nickname: normalizeOptionalText(card.metadata.nickname),
      source: normalizeOptionalStringArray(card.metadata.source),
      creationDate: card.metadata.creationDate,
      modificationDate: card.metadata.modificationDate,
    },
    characterBook: card.characterBook,
    extensions: card.extensions && Object.keys(card.extensions).length > 0
      ? { ...card.extensions }
      : undefined,
    assets: card.assets && card.assets.length > 0
      ? [...card.assets]
      : undefined,
    importedFormat: card.format,
  };
}
