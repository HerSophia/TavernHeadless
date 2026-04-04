import { z } from 'zod';
import type {
  CharacterCardFormat,
  ImportedCharacterCard,
} from '../types/character.js';

const NAME_MAX_LENGTH = 120;
const TEXT_MAX_LENGTH = 16_000;

const KNOWN_PAYLOAD_KEYS = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'alternate_greetings',
  'group_only_greetings',
  'system_prompt',
  'post_history_instructions',
  'creator_notes',
  'character_book',
  'tags',
  'creator',
  'character_version',
  'nickname',
  'source',
  'creation_date',
  'modification_date',
  'extensions',
  'assets',
]);

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function normalizeStringArray(values: string[]): string[] {
  const normalized = values
    .map(normalizeText)
    .filter((value) => value.length > 0);

  return [...new Set(normalized)];
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Character card payload must be an object');
  }

  return value as Record<string, unknown>;
}

const rawCharacterDataSchema = z.object({
  name: z.string().max(NAME_MAX_LENGTH).transform(normalizeText).refine(
    (value) => value.length > 0,
    'Character name is required',
  ),
  description: z.string().max(TEXT_MAX_LENGTH).optional().default('').transform(normalizeText),
  personality: z.string().max(TEXT_MAX_LENGTH).optional().default('').transform(normalizeText),
  scenario: z.string().max(TEXT_MAX_LENGTH).optional().default('').transform(normalizeText),
  first_mes: z.string().max(TEXT_MAX_LENGTH).optional().default('').transform(normalizeText),
  mes_example: z.string().max(TEXT_MAX_LENGTH).optional().default('').transform(normalizeText),
  alternate_greetings: z.array(z.string().max(TEXT_MAX_LENGTH)).optional().default([]).transform(normalizeStringArray),
  group_only_greetings: z.array(z.string().max(TEXT_MAX_LENGTH)).optional().default([]).transform(normalizeStringArray),
  system_prompt: z.string().max(TEXT_MAX_LENGTH).optional().default('').transform(normalizeText),
  post_history_instructions: z.string().max(TEXT_MAX_LENGTH).optional().default('').transform(normalizeText),
  creator_notes: z.string().max(TEXT_MAX_LENGTH).optional().default('').transform(normalizeText),
  character_book: z.unknown().optional(),
  tags: z.array(z.string().max(NAME_MAX_LENGTH)).optional().default([]).transform(normalizeStringArray),
  creator: z.string().max(NAME_MAX_LENGTH).optional().default('').transform(normalizeText),
  character_version: z.string().max(NAME_MAX_LENGTH).optional().default('').transform(normalizeText),
  nickname: z.string().max(NAME_MAX_LENGTH).optional().default('').transform(normalizeText),
  source: z.array(z.string().max(TEXT_MAX_LENGTH)).optional().default([]).transform(normalizeStringArray),
  creation_date: z.number().int().nonnegative().optional(),
  modification_date: z.number().int().nonnegative().optional(),
  extensions: z.record(z.unknown()).optional().default({}),
  assets: z.array(z.record(z.unknown())).optional().default([]),
}).passthrough();

const rawCharacterEnvelopeSchema = z.object({
  spec: z.string().optional(),
  spec_version: z.string().optional(),
  data: z.unknown(),
}).passthrough();

function resolveEnvelope(json: unknown) {
  const envelopeResult = rawCharacterEnvelopeSchema.safeParse(json);
  if (!envelopeResult.success || envelopeResult.data.data === undefined) {
    return null;
  }

  return envelopeResult.data;
}

function buildImportedCharacterCard(args: {
  format: CharacterCardFormat;
  raw: unknown;
  payload: unknown;
  spec?: string;
  specVersion?: string;
}): ImportedCharacterCard {
  const payloadRecord = asObject(args.payload);
  const parsed = rawCharacterDataSchema.parse(payloadRecord);
  const unknownFields = Object.fromEntries(
    Object.entries(payloadRecord).filter(([key]) => !KNOWN_PAYLOAD_KEYS.has(key)),
  );

  return {
    format: args.format,
    spec: args.spec,
    specVersion: args.specVersion,
    raw: args.raw,
    core: {
      name: parsed.name,
      description: parsed.description || undefined,
      personality: parsed.personality || undefined,
      scenario: parsed.scenario || undefined,
      exampleDialogue: parsed.mes_example || undefined,
    },
    greetings: {
      primaryGreeting: parsed.first_mes || undefined,
      alternateGreetings: parsed.alternate_greetings.length > 0 ? parsed.alternate_greetings : undefined,
      groupOnlyGreetings: parsed.group_only_greetings.length > 0 ? parsed.group_only_greetings : undefined,
    },
    prompts: {
      systemPrompt: parsed.system_prompt || undefined,
      postHistoryInstructions: parsed.post_history_instructions || undefined,
      creatorNotes: parsed.creator_notes || undefined,
    },
    metadata: {
      tags: parsed.tags.length > 0 ? parsed.tags : undefined,
      creator: parsed.creator || undefined,
      characterVersion: parsed.character_version || undefined,
      nickname: parsed.nickname || undefined,
      source: parsed.source.length > 0 ? parsed.source : undefined,
      creationDate: parsed.creation_date,
      modificationDate: parsed.modification_date,
    },
    characterBook: parsed.character_book,
    extensions: Object.keys(parsed.extensions).length > 0 ? parsed.extensions : undefined,
    assets: parsed.assets.length > 0 ? parsed.assets : undefined,
    unknownFields: Object.keys(unknownFields).length > 0 ? unknownFields : undefined,
  };
}

export function parseCharacterCardLegacy(json: unknown): ImportedCharacterCard {
  const envelope = resolveEnvelope(json);

  return buildImportedCharacterCard({
    format: 'legacy',
    raw: json,
    payload: envelope?.data ?? json,
    spec: envelope?.spec,
    specVersion: envelope?.spec_version,
  });
}

export function parseCharacterCardV2(json: unknown): ImportedCharacterCard {
  const envelope = resolveEnvelope(json);

  return buildImportedCharacterCard({
    format: 'v2',
    raw: json,
    payload: envelope?.data ?? json,
    spec: envelope?.spec ?? 'chara_card_v2',
    specVersion: envelope?.spec_version,
  });
}

export function parseCharacterCardV3(json: unknown): ImportedCharacterCard {
  const envelope = resolveEnvelope(json);

  return buildImportedCharacterCard({
    format: 'v3',
    raw: json,
    payload: envelope?.data ?? json,
    spec: envelope?.spec ?? 'chara_card_v3',
    specVersion: envelope?.spec_version,
  });
}

export function parseCharacterCard(json: unknown): ImportedCharacterCard {
  const envelope = resolveEnvelope(json);

  if (!envelope) {
    return parseCharacterCardLegacy(json);
  }

  if (envelope.spec === 'chara_card_v3') {
    return parseCharacterCardV3(json);
  }

  if (envelope.spec === 'chara_card_v2') {
    return parseCharacterCardV2(json);
  }

  return parseCharacterCardLegacy(json);
}
