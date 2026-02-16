import { z } from 'zod';
import type { STCharacterCard } from '../types/character.js';

const NAME_MAX_LENGTH = 120;
const TEXT_MAX_LENGTH = 16_000;

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
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
}).passthrough();

const rawCharacterEnvelopeSchema = z.object({
  spec: z.string().optional(),
  spec_version: z.string().optional(),
  data: z.unknown(),
}).passthrough();

export function parseCharacterCard(json: unknown): STCharacterCard {
  const envelopeResult = rawCharacterEnvelopeSchema.safeParse(json);
  const payload = envelopeResult.success && envelopeResult.data.data !== undefined
    ? envelopeResult.data.data
    : json;
  const raw = rawCharacterDataSchema.parse(payload);

  return {
    name: raw.name,
    description: raw.description,
    personality: raw.personality,
    scenario: raw.scenario,
    firstMes: raw.first_mes,
    mesExample: raw.mes_example,
  };
}
