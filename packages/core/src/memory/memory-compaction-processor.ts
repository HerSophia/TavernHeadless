import type { MemoryScope } from '@tavern/shared';
import type { LLMPort, GenerationParams, ModelConfig, TokenUsage } from '../llm/types.js';
import type {
  MemoryCompactionOutput,
  MemoryFactAddOperation,
  MemoryFactDeprecateOperation,
  MemoryFactUpdateOperation,
  MemoryItem,
  MemoryOpenLoopAddOperation,
  MemoryOpenLoopResolveOperation,
} from './types.js';

const MAX_FALLBACK_MACRO_SUMMARY_LENGTH = 1_600;
const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export interface MemoryCompactionInput {
  sourceMicroSummaries: MemoryItem[];
  latestMacroSummary?: MemoryItem;
  existingFacts: MemoryItem[];
  existingOpenLoops: MemoryItem[];
  scope: MemoryScope;
  scopeId: string;
  params?: GenerationParams;
  model?: ModelConfig;
}

export interface MemoryCompactionResult {
  output: MemoryCompactionOutput;
  degraded?: { reason: 'json_parse_failed'; rawText: string; error: Error };
  usage: TokenUsage;
}

const SYSTEM_PROMPT = `You are a Memory Macro Compaction Processor for a role-playing story.

You will receive:
1. A list of source micro summaries that should be compacted into one macro summary
2. The latest existing macro summary, if there is one
3. Currently active facts
4. Currently active open loops

You must respond with a JSON object in the following format:
{
  "macroSummary": "A macro summary for the selected phase",
  "factsAdd": [
    { "factKey": "fact name", "value": "fact description", "scope": "branch", "importance": 0.7 }
  ],
  "factsUpdate": [
    { "id": "existing_fact_id", "value": "updated description", "importance": 0.8 }
  ],
  "factsDeprecate": [
    { "id": "outdated_fact_id", "reason": "why this fact is no longer relevant" }
  ],
  "openLoopsAdd": [
    { "content": "an unresolved question or pending thread", "scope": "branch", "importance": 0.6 }
  ],
  "openLoopsResolve": [
    { "id": "existing_open_loop_id", "resolution": "how it was resolved" }
  ],
  "sourceMicroIds": ["micro_summary_id_1", "micro_summary_id_2"]
}

Rules:
- macroSummary should compact the selected phase, not merely copy one source summary
- organize macroSummary around: what happened, stable state, unresolved issues, and durable background when useful
- sourceMicroIds must only contain ids from the provided source micro summaries
- if uncertain, include all provided source micro ids
- importance is a number between 0 and 1
- prefer scope "branch" for branch-local memory, "chat" only for explicit session-shared memory, "global" only for durable world facts, and "floor" only for floor-local details
- factsAdd items should include a structured factKey whenever possible
- factsUpdate, factsDeprecate, and openLoopsResolve must use ids from the provided lists
- openLoopsAdd should track unresolved questions, promises, suspicions, missing information, or pending actions
- respond ONLY with valid JSON, with no markdown and no extra text`;

function normalizeFactKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeScope(value: unknown): MemoryScope | undefined {
  return value === 'global' || value === 'chat' || value === 'branch' || value === 'floor' ? value : undefined;
}

function normalizeFactAddEntries(value: unknown): MemoryFactAddOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const factKey = normalizeFactKey(record.factKey ?? record.fact_key ?? record.key);
    const rawValue = typeof record.value === 'string'
      ? record.value.trim()
      : (typeof record.content === 'string' ? record.content.trim() : '');
    const scope = normalizeScope(record.scope);
    const importance = typeof record.importance === 'number' ? record.importance : undefined;

    if (!rawValue) {
      return [];
    }

    return [{
      ...(factKey ? { factKey, key: factKey } : {}),
      value: rawValue,
      ...(scope ? { scope } : {}),
      ...(importance !== undefined ? { importance } : {}),
    }];
  });
}

function normalizeFactUpdateEntries(value: unknown): MemoryFactUpdateOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    const rawValue = typeof record.value === 'string'
      ? record.value.trim()
      : (typeof record.content === 'string' ? record.content.trim() : '');
    const importance = typeof record.importance === 'number' ? record.importance : undefined;
    const factKey = normalizeFactKey(record.factKey ?? record.fact_key);

    if (!id || !rawValue) {
      return [];
    }

    return [{
      id,
      value: rawValue,
      ...(factKey ? { factKey } : {}),
      ...(importance !== undefined ? { importance } : {}),
    }];
  });
}

function normalizeFactDeprecateEntries(value: unknown): MemoryFactDeprecateOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    const reason = typeof record.reason === 'string' ? record.reason.trim() : '';

    if (!id || !reason) {
      return [];
    }

    return [{ id, reason }];
  });
}

function normalizeOpenLoopAddEntries(value: unknown): MemoryOpenLoopAddOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const content = typeof record.content === 'string'
      ? record.content.trim()
      : typeof record.value === 'string'
        ? record.value.trim()
        : typeof record.text === 'string'
          ? record.text.trim()
          : '';
    const scope = normalizeScope(record.scope);
    const importance = typeof record.importance === 'number' ? record.importance : undefined;

    if (!content) {
      return [];
    }

    return [{
      content,
      ...(scope ? { scope } : {}),
      ...(importance !== undefined ? { importance } : {}),
    }];
  });
}

function normalizeOpenLoopResolveEntries(value: unknown): MemoryOpenLoopResolveOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    const resolution = typeof record.resolution === 'string'
      ? record.resolution.trim()
      : typeof record.reason === 'string'
        ? record.reason.trim()
        : typeof record.value === 'string'
          ? record.value.trim()
          : 'resolved';

    if (!id) {
      return [];
    }

    return [{ id, resolution: resolution || 'resolved' }];
  });
}

function parseJsonText(text: string): Record<string, unknown> {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1]! : text.trim();
  return JSON.parse(jsonText) as Record<string, unknown>;
}

function resolveFallbackMacroSummary(sourceMicroSummaries: MemoryItem[], rawText: string): string {
  const summary = sourceMicroSummaries
    .map((item) => item.content.trim())
    .filter((content) => content.length > 0)
    .join(' ')
    .trim();

  if (summary) {
    return summary.slice(0, MAX_FALLBACK_MACRO_SUMMARY_LENGTH);
  }

  return rawText.trim().slice(0, MAX_FALLBACK_MACRO_SUMMARY_LENGTH);
}

function normalizeSourceMicroIds(value: unknown, allowedIds: Set<string>, fallbackIds: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallbackIds];
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((id) => allowedIds.has(id));

  return normalized.length > 0 ? [...new Set(normalized)] : [...fallbackIds];
}

function toCompactionOutput(
  parsed: Record<string, unknown>,
  sourceMicroIds: string[],
): MemoryCompactionOutput {
  const allowedIds = new Set(sourceMicroIds);

  return {
    macroSummary: typeof parsed.macroSummary === 'string'
      ? parsed.macroSummary.trim()
      : (typeof parsed.macro_summary === 'string' ? parsed.macro_summary.trim() : ''),
    factsAdd: normalizeFactAddEntries(parsed.factsAdd ?? parsed.facts_add),
    factsUpdate: normalizeFactUpdateEntries(parsed.factsUpdate ?? parsed.facts_update),
    factsDeprecate: normalizeFactDeprecateEntries(parsed.factsDeprecate ?? parsed.facts_deprecate),
    openLoopsAdd: normalizeOpenLoopAddEntries(parsed.openLoopsAdd ?? parsed.open_loops_add),
    openLoopsResolve: normalizeOpenLoopResolveEntries(parsed.openLoopsResolve ?? parsed.open_loops_resolve),
    sourceMicroIds: normalizeSourceMicroIds(
      parsed.sourceMicroIds ?? parsed.source_micro_ids,
      allowedIds,
      sourceMicroIds,
    ),
  };
}

function buildUserMessage(input: MemoryCompactionInput): string {
  const parts: string[] = [];

  parts.push('## Source Micro Summaries');
  input.sourceMicroSummaries.forEach((summary) => {
    parts.push(`- [${summary.id}] ${summary.content}`);
  });

  if (input.latestMacroSummary) {
    parts.push('');
    parts.push('## Latest Macro Summary');
    parts.push(`- [${input.latestMacroSummary.id}] ${input.latestMacroSummary.content}`);
  }

  if (input.existingFacts.length > 0) {
    parts.push('');
    parts.push('## Known Facts');
    input.existingFacts.forEach((fact) => {
      const factKeyLabel = fact.factKey ? ` [factKey=${fact.factKey}]` : '';
      parts.push(`- [${fact.id}]${factKeyLabel} (importance: ${fact.importance}) ${fact.content}`);
    });
  }

  if (input.existingOpenLoops.length > 0) {
    parts.push('');
    parts.push('## Active Open Loops');
    input.existingOpenLoops.forEach((openLoop) => {
      parts.push(`- [${openLoop.id}] (importance: ${openLoop.importance}) ${openLoop.content}`);
    });
  }

  return parts.join('\n');
}

export class MemoryCompactionProcessor {
  constructor(private readonly llm: LLMPort) {}

  async process(input: MemoryCompactionInput): Promise<MemoryCompactionResult> {
    if (input.sourceMicroSummaries.length === 0) {
      return {
        output: {
          macroSummary: '',
          factsAdd: [],
          factsUpdate: [],
          factsDeprecate: [],
          openLoopsAdd: [],
          openLoopsResolve: [],
          sourceMicroIds: [],
        },
        usage: EMPTY_USAGE,
      };
    }

    const sourceMicroIds = input.sourceMicroSummaries.map((item) => item.id);
    const userMessage = buildUserMessage(input);
    const response = await this.llm.generate({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      params: {
        temperature: 0.2,
        maxOutputTokens: 1400,
        ...input.params,
        stream: false,
      },
      model: input.model,
    });

    let output: MemoryCompactionOutput;
    let degraded: MemoryCompactionResult['degraded'];

    try {
      output = toCompactionOutput(parseJsonText(response.text), sourceMicroIds);
      if (!output.macroSummary) {
        output = {
          ...output,
          macroSummary: resolveFallbackMacroSummary(input.sourceMicroSummaries, response.text),
        };
      }
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      output = {
        macroSummary: resolveFallbackMacroSummary(input.sourceMicroSummaries, response.text),
        factsAdd: [],
        factsUpdate: [],
        factsDeprecate: [],
        openLoopsAdd: [],
        openLoopsResolve: [],
        sourceMicroIds,
      };
      degraded = {
        reason: 'json_parse_failed',
        rawText: response.text.trim(),
        error: parseError,
      };
    }

    return {
      output,
      ...(degraded ? { degraded } : {}),
      usage: response.usage,
    };
  }
}
