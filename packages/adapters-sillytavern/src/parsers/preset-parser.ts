import { z } from 'zod';
import type { PromptRunIntent } from '@tavern/core';
import type {
  STPreset,
  STPresetImportReport,
  STPromptEntry,
  STPromptEntryBehavior,
  STPromptOrderTrack,
} from '../types/preset.js';

const rawPromptEntrySchema = z.object({
  identifier: z.string(),
  name: z.string().default(''),
  system_prompt: z.boolean().optional(),
  role: z.enum(['system', 'user', 'assistant']).optional(),
  content: z.string().optional(),
  marker: z.boolean().optional(),
  enabled: z.boolean().optional(),
  injection_position: z.number().int().optional(),
  injection_depth: z.number().int().optional(),
  injection_order: z.number().int().optional(),
  injection_trigger: z.array(z.unknown()).optional(),
  forbid_overrides: z.boolean().optional(),
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

const RAW_PRESET_TOP_LEVEL_KNOWN_KEYS = new Set([
  'prompts',
  'prompt_order',
  'openai_max_context',
  'openai_max_tokens',
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'new_chat_prompt',
  'new_example_chat_prompt',
  'continue_nudge_prompt',
  'assistant_prefill',
  'wi_format',
  'names_behavior',
  'stream_openai',
  ...Object.keys(legacyPresetAliases),
]);

const RAW_PROMPT_KNOWN_KEYS = new Set([
  'identifier',
  'name',
  'system_prompt',
  'role',
  'content',
  'marker',
  'enabled',
  'injection_position',
  'injection_depth',
  'injection_order',
  'injection_trigger',
  'forbid_overrides',
]);

const RAW_PROMPT_ORDER_CONTEXT_KNOWN_KEYS = new Set([
  'character_id',
  'order',
]);

const KNOWN_MARKER_IDENTIFIERS = new Set([
  'chatHistory',
  'worldInfoBefore',
  'worldInfoAfter',
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
  'dialogueExamples',
]);

const PROMPT_RUN_INTENTS = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'] as const;

interface PromptBehaviorAnalysis {
  behavior: STPromptEntryBehavior;
  unsupportedFields: string[];
  warnings: string[];
  downgradedReason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

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

function toPromptOrderTracks(raw: z.infer<typeof rawPresetSchema>): STPromptOrderTrack[] {
  return raw.prompt_order.map((entry) => ({
    characterId: entry.character_id,
    order: entry.order.map((item) => ({
      identifier: item.identifier,
      enabled: item.enabled,
    })),
  }));
}

function normalizePromptIntent(value: unknown): PromptRunIntent | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return PROMPT_RUN_INTENTS.includes(normalized as PromptRunIntent)
    ? (normalized as PromptRunIntent)
    : null;
}

function parsePromptBehavior(prompt: z.infer<typeof rawPromptEntrySchema>): PromptBehaviorAnalysis {
  const unsupportedFields: string[] = [];
  const warnings: string[] = [];

  let placement: STPromptEntryBehavior['placement'] = { kind: 'relative', order: 0 };
  const rawPosition = prompt.injection_position;
  const rawDepth = prompt.injection_depth;
  const rawOrder = prompt.injection_order;

  if (rawPosition === undefined || rawPosition === 0) {
    placement = {
      kind: 'relative',
      order: typeof rawOrder === 'number' ? rawOrder : 0,
    };

    if (typeof rawDepth === 'number') {
      pushUnique(unsupportedFields, 'prompts[].injection_depth');
      warnings.push(`Prompt '${prompt.identifier}' 提供了 injection_depth，但当前 position 为 relative；该深度值不会生效。`);
    }
  } else if (rawPosition === 1) {
    placement = {
      kind: 'in_chat',
      depth: typeof rawDepth === 'number' ? Math.max(0, rawDepth) : 0,
      order: typeof rawOrder === 'number' ? rawOrder : 0,
    };
  } else {
    pushUnique(unsupportedFields, 'prompts[].injection_position');
    warnings.push(`Prompt '${prompt.identifier}' 使用了当前未识别的 injection_position=${String(rawPosition)}；已回退为 relative。`);
  }

  if (rawPosition !== 1 && rawOrder !== undefined) {
    pushUnique(unsupportedFields, 'prompts[].injection_order');
    warnings.push(`Prompt '${prompt.identifier}' 提供了 injection_order，但当前 placement 不是 in_chat；该顺序值不会生效。`);
  }

  const triggers: PromptRunIntent[] = [];
  if (prompt.injection_trigger !== undefined) {
    for (const trigger of prompt.injection_trigger) {
      const normalizedTrigger = normalizePromptIntent(trigger);
      if (normalizedTrigger) {
        if (!triggers.includes(normalizedTrigger)) {
          triggers.push(normalizedTrigger);
        }
        continue;
      }

      pushUnique(unsupportedFields, 'prompts[].injection_trigger');
      warnings.push(`Prompt '${prompt.identifier}' 包含当前未识别的 injection_trigger 值；该 trigger 将被忽略。`);
    }
  }

  const semantics = {
    ...(prompt.system_prompt !== undefined ? { systemPrompt: prompt.system_prompt } : {}),
    ...(prompt.forbid_overrides !== undefined ? { forbidOverrides: prompt.forbid_overrides } : {}),
  };

  const downgradedReason = unsupportedFields.some((field) => field.startsWith('prompts[].injection_'))
    ? '条目包含当前未完全承接的 Prompt Manager 位置或触发元数据；解析时已尽量保留可识别部分，并对其余部分发出告警。'
    : undefined;

  return {
    behavior: {
      placement,
      ...(triggers.length > 0 ? { triggers } : {}),
      ...(Object.keys(semantics).length > 0 ? { semantics } : {}),
    },
    unsupportedFields,
    warnings,
    ...(downgradedReason ? { downgradedReason } : {}),
  };
}

function buildPresetImportReport(args: {
  normalizedInput: unknown;
  prompts: STPromptEntry[];
  promptBehaviorAnalyses: PromptBehaviorAnalysis[];
  promptOrderTracks: STPromptOrderTrack[];
  selectedPromptOrderCharacterId: number | null;
  defaultOrderExists: boolean;
  selectedByFallback: boolean;
  assistantPrefillImplemented: boolean;
  continueNudgeImplemented: boolean;
  namesBehaviorImplemented: boolean;
  namesBehaviorValue: number;
}): STPresetImportReport {
  const report: STPresetImportReport = {
    selectedPromptOrderCharacterId: args.selectedPromptOrderCharacterId,
    ignoredPromptOrderCharacterIds: [],
    unsupportedFields: [],
    ignoredFields: [],
    downgradedEntries: [],
    unresolvedMarkers: [],
    warnings: [],
  };

  const trackCharacterIds = [...new Set(args.promptOrderTracks.map((track) => track.characterId))];
  report.ignoredPromptOrderCharacterIds = trackCharacterIds.filter(
    (characterId) => characterId !== args.selectedPromptOrderCharacterId
  );

  if (args.promptOrderTracks.length > 1) {
    report.warnings.push(
      `检测到 ${args.promptOrderTracks.length} 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=${String(args.selectedPromptOrderCharacterId)} 的 active 轨道。`
    );
  }

  if (args.selectedByFallback) {
    report.warnings.push('未找到 character_id=100000 的默认 prompt_order 上下文；当前已回退为使用第一条轨道。');
  }

  if (!args.defaultOrderExists) {
    report.warnings.push('未提供 prompt_order；当前已回退为使用 prompts 声明顺序。');
  }

  const normalizedRecord = isRecord(args.normalizedInput) ? args.normalizedInput : {};

  for (const key of Object.keys(normalizedRecord)) {
    if (!RAW_PRESET_TOP_LEVEL_KNOWN_KEYS.has(key)) {
      pushUnique(report.ignoredFields, `top_level.${key}`);
    }
  }

  const promptRecords = Array.isArray(normalizedRecord.prompts)
    ? normalizedRecord.prompts.filter(isRecord)
    : [];
  for (const promptRecord of promptRecords) {
    for (const key of Object.keys(promptRecord)) {
      if (!RAW_PROMPT_KNOWN_KEYS.has(key)) {
        pushUnique(report.ignoredFields, `prompts[].${key}`);
      }
    }
  }

  const promptOrderContexts = Array.isArray(normalizedRecord.prompt_order)
    ? normalizedRecord.prompt_order.filter(isRecord)
    : [];
  for (const contextRecord of promptOrderContexts) {
    for (const key of Object.keys(contextRecord)) {
      if (!RAW_PROMPT_ORDER_CONTEXT_KNOWN_KEYS.has(key)) {
        pushUnique(report.ignoredFields, `prompt_order[].${key}`);
      }
    }
  }

  const assistantPrefillValue = typeof normalizedRecord.assistant_prefill === 'string'
    ? normalizedRecord.assistant_prefill.trim()
    : typeof normalizedRecord.assistantPrefill === 'string'
      ? normalizedRecord.assistantPrefill.trim()
      : '';
  if (assistantPrefillValue.length > 0 && !args.assistantPrefillImplemented) {
    pushUnique(report.unsupportedFields, 'assistant_prefill');
  }

  const continueNudgeValue = typeof normalizedRecord.continue_nudge_prompt === 'string'
    ? normalizedRecord.continue_nudge_prompt.trim()
    : typeof normalizedRecord.continueNudgePrompt === 'string'
      ? normalizedRecord.continueNudgePrompt.trim()
      : '';
  if (continueNudgeValue.length > 0 && !args.continueNudgeImplemented) {
    pushUnique(report.unsupportedFields, 'continue_nudge_prompt');
  }

  if (!args.namesBehaviorImplemented && args.namesBehaviorValue !== 0) {
    pushUnique(report.unsupportedFields, 'names_behavior');
  }
  if (args.namesBehaviorImplemented && ![0, 1].includes(args.namesBehaviorValue)) {
    pushUnique(report.unsupportedFields, 'names_behavior');
    report.warnings.push(`names_behavior=${String(args.namesBehaviorValue)} 当前未映射到本地最小策略；已回退为 off。`);
  }

  args.prompts.forEach((prompt, index) => {
    const analysis = args.promptBehaviorAnalyses[index];
    if (!analysis) {
      return;
    }

    for (const field of analysis.unsupportedFields) {
      pushUnique(report.unsupportedFields, field);
    }

    for (const warning of analysis.warnings) {
      pushUnique(report.warnings, warning);
    }

    if (analysis.downgradedReason) {
      report.downgradedEntries.push({
        identifier: prompt.identifier,
        reason: analysis.downgradedReason,
      });
    }

    if (prompt.marker && !KNOWN_MARKER_IDENTIFIERS.has(prompt.identifier)) {
      pushUnique(report.unresolvedMarkers, prompt.identifier);
      report.downgradedEntries.push({
        identifier: prompt.identifier,
        reason: '未知 marker 标识当前不会映射到通用锚点；运行时通常只会把它保留为普通条目或忽略。',
      });
    }
  });

  if (report.unresolvedMarkers.length > 0) {
    report.warnings.push('检测到当前运行时无法映射的 marker 标识；请查看 unresolvedMarkers 与 downgradedEntries。');
  }

  if (report.unsupportedFields.length > 0) {
    report.warnings.push('检测到已识别但当前未完整执行的 preset 字段；请查看 unsupportedFields。');
  }

  return report;
}

export function parsePreset(json: unknown): STPreset {
  const normalizedInput = normalizeLegacyPreset(json);
  const raw = rawPresetSchema.parse(normalizedInput);

  const defaultOrder = raw.prompt_order.find((entry) => entry.character_id === 100000)
    ?? raw.prompt_order[0];
  const selectedByFallback = raw.prompt_order.length > 0 && !raw.prompt_order.some((entry) => entry.character_id === 100000);

  const enabledMap = new Map<string, boolean>();
  if (defaultOrder) {
    for (const item of defaultOrder.order) {
      enabledMap.set(item.identifier, item.enabled);
    }
  }

  const promptBehaviorAnalyses = raw.prompts.map((prompt) => parsePromptBehavior(prompt));
  const prompts: STPromptEntry[] = raw.prompts.map((prompt, index) => ({
    identifier: prompt.identifier,
    name: prompt.name,
    role: prompt.role,
    content: prompt.content,
    marker: prompt.marker,
    enabled: enabledMap.get(prompt.identifier)
      ?? (typeof prompt.enabled === 'boolean' ? prompt.enabled : true),
    behavior: promptBehaviorAnalyses[index]?.behavior,
  }));

  const promptOrder: string[] = defaultOrder
    ? defaultOrder.order.filter((item) => item.enabled).map((item) => item.identifier)
    : prompts.map((prompt) => prompt.identifier);

  const promptOrderTracks = toPromptOrderTracks(raw);
  const selectedPromptOrderCharacterId = defaultOrder?.character_id ?? null;
  const importReport = buildPresetImportReport({
    normalizedInput,
    prompts,
    promptBehaviorAnalyses,
    promptOrderTracks,
    selectedPromptOrderCharacterId,
    defaultOrderExists: !!defaultOrder,
    selectedByFallback,
    assistantPrefillImplemented: true,
    continueNudgeImplemented: true,
    namesBehaviorImplemented: true,
    namesBehaviorValue: raw.names_behavior,
  });

  return {
    prompts,
    promptOrder,
    promptOrderTracks,
    selectedPromptOrderCharacterId,
    importReport,
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
