import { z } from 'zod';
import type { STPreset, STPromptEntry } from '../types/preset.js';

const rawPromptEntrySchema = z.object({
  identifier: z.string(),
  name: z.string().default(''),
  system_prompt: z.boolean().optional(),
  role: z.enum(['system', 'user', 'assistant']).optional(),
  content: z.string().optional(),
  marker: z.boolean().optional(),
}).passthrough();

const rawPromptOrderItemSchema = z.object({
  identifier: z.string(),
  enabled: z.boolean().default(true),
});

const rawPromptOrderSchema = z.object({
  character_id: z.number(),
  order: z.array(rawPromptOrderItemSchema),
}).passthrough();

const rawPresetSchema = z.object({
  prompts: z.array(rawPromptEntrySchema).default([]),
  prompt_order: z.array(rawPromptOrderSchema).default([]),

  openai_max_context: z.number().default(4095),
  openai_max_tokens: z.number().default(300),
  temperature: z.number().default(1),
  top_p: z.number().default(1),
  top_k: z.number().default(0),
  min_p: z.number().default(0),
  frequency_penalty: z.number().default(0),
  presence_penalty: z.number().default(0),
  repetition_penalty: z.number().default(1),

  new_chat_prompt: z.string().default('[Start a new Chat]'),
  new_example_chat_prompt: z.string().default('[Example Chat]'),
  continue_nudge_prompt: z.string().default('[Continue your last message without repeating its original content.]'),
  assistant_prefill: z.string().default(''),

  wi_format: z.string().default('{0}'),
  names_behavior: z.number().default(0),

  stream_openai: z.boolean().default(true),
}).passthrough();

const legacyPresetAliases: Record<string, string> = {
  maxContext: 'openai_max_context',
  maxTokens: 'openai_max_tokens',
  topP: 'top_p',
  topK: 'top_k',
  minP: 'min_p',
  frequencyPenalty: 'frequency_penalty',
  presencePenalty: 'presence_penalty',
  repetitionPenalty: 'repetition_penalty',
  newChatPrompt: 'new_chat_prompt',
  newExampleChatPrompt: 'new_example_chat_prompt',
  continueNudgePrompt: 'continue_nudge_prompt',
  assistantPrefill: 'assistant_prefill',
  wiFormat: 'wi_format',
  namesBehavior: 'names_behavior',
  stream: 'stream_openai',
};

function normalizeLegacyPreset(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const record = { ...(input as Record<string, unknown>) };

  for (const [legacyKey, rawKey] of Object.entries(legacyPresetAliases)) {
    if (record[rawKey] === undefined && record[legacyKey] !== undefined) {
      record[rawKey] = record[legacyKey];
    }
  }

  if (Array.isArray(record.promptOrder) && !Array.isArray(record.prompt_order)) {
    const promptOrder = record.promptOrder as unknown[];
    const prompts = Array.isArray(record.prompts) ? record.prompts : [];
    const order: Array<{ identifier: string; enabled: boolean }> = [];
    const seen = new Set<string>();

    for (const item of promptOrder) {
      if (typeof item !== 'string' || !item.trim() || seen.has(item)) {
        continue;
      }
      seen.add(item);
      order.push({ identifier: item, enabled: true });
    }

    for (const promptItem of prompts) {
      if (!promptItem || typeof promptItem !== 'object' || Array.isArray(promptItem)) {
        continue;
      }
      const prompt = promptItem as Record<string, unknown>;
      if (typeof prompt.identifier !== 'string' || !prompt.identifier.trim()) {
        continue;
      }
      if (seen.has(prompt.identifier)) {
        continue;
      }
      seen.add(prompt.identifier);
      order.push({
        identifier: prompt.identifier,
        enabled: typeof prompt.enabled === 'boolean' ? prompt.enabled : true,
      });
    }

    record.prompt_order = [{ character_id: 100000, order }];
  }

  return record;
}

export function parsePreset(json: unknown): STPreset {
  const raw = rawPresetSchema.parse(normalizeLegacyPreset(json));

  const defaultOrder = raw.prompt_order.find((entry) => entry.character_id === 100000)
    ?? raw.prompt_order[0];

  const enabledMap = new Map<string, boolean>();
  if (defaultOrder) {
    for (const item of defaultOrder.order) {
      enabledMap.set(item.identifier, item.enabled);
    }
  }

  const prompts: STPromptEntry[] = raw.prompts.map((prompt) => ({
    identifier: prompt.identifier,
    name: prompt.name,
    role: prompt.role,
    content: prompt.content,
    marker: prompt.marker,
    enabled: enabledMap.get(prompt.identifier)
      ?? (typeof prompt.enabled === 'boolean' ? prompt.enabled : true),
  }));

  const promptOrder: string[] = defaultOrder
    ? defaultOrder.order.filter((item) => item.enabled).map((item) => item.identifier)
    : prompts.map((prompt) => prompt.identifier);

  return {
    prompts,
    promptOrder,
    maxContext: raw.openai_max_context,
    maxTokens: raw.openai_max_tokens,
    temperature: raw.temperature,
    topP: raw.top_p,
    topK: raw.top_k,
    minP: raw.min_p,
    frequencyPenalty: raw.frequency_penalty,
    presencePenalty: raw.presence_penalty,
    repetitionPenalty: raw.repetition_penalty,
    newChatPrompt: raw.new_chat_prompt,
    newExampleChatPrompt: raw.new_example_chat_prompt,
    continueNudgePrompt: raw.continue_nudge_prompt,
    assistantPrefill: raw.assistant_prefill,
    wiFormat: raw.wi_format,
    namesBehavior: raw.names_behavior,
    stream: raw.stream_openai,
  };
}
