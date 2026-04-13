import type { MemoryScope } from '@tavern/shared';
import type { LLMPort, GenerationParams, ModelConfig, TokenUsage } from '../llm/types.js';
import type {
  MemoryFactAddOperation,
  MemoryFactUpdateOperation,
  MemoryFactDeprecateOperation,
  MemoryIngestOutput,
  MemoryItem,
  MemoryOpenLoopAddOperation,
  MemoryOpenLoopResolveOperation,
} from './types.js';

const MAX_FALLBACK_MICRO_SUMMARY_LENGTH = 1_000;

export interface MemoryIngestInput {
  /** 当前 committed floor 的完整文本（应包含 user / assistant 内容）。 */
  currentFloorContent: string;
  /** 当前 floor 的提取摘要，可作为降级兜底。 */
  extractedSummaries?: string[];
  /** 最近摘要（可混合 legacy / micro / macro）。 */
  recentSummaries: MemoryItem[];
  /** 当前 active facts。 */
  existingFacts: MemoryItem[];
  /** 当前 active open loops。 */
  existingOpenLoops: MemoryItem[];
  /** 作用域。 */
  scope: MemoryScope;
  /** 作用域实体 ID。 */
  scopeId: string;
  /** 来源楼层 ID。 */
  sourceFloorId: string;
  /** 生成参数（可选覆盖）。 */
  params?: GenerationParams;
  /** 模型配置（可选覆盖）。 */
  model?: ModelConfig;
}

export interface MemoryIngestResult {
  output: MemoryIngestOutput;
  degraded?: { reason: 'json_parse_failed'; rawText: string; error: Error };
  usage: TokenUsage;
}

const SYSTEM_PROMPT = `You are a Memory Ingest Processor for a role-playing story.

You will receive:
1. The latest committed floor transcript containing the user's input and the assistant's reply
2. Current-turn extracted summaries that can be used as fallback hints
3. Recent summaries from previous memory items
4. Currently active facts
5. Currently active open loops

You must respond with a JSON object in the following format:
{
  "microSummary": "A concise micro summary of the latest committed floor",
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
    { "id": "existing_open_loop_id", "resolution": "how it was resolved in this floor" }
  ]
}

Rules:
- microSummary should usually be a short, concrete summary of the latest floor; it may be an empty string only if the floor contains no meaningful change
- importance is a number between 0 and 1
- prefer scope "branch" for branch-local memory, "chat" only for explicit session-shared memory, "global" only for durable world facts, and "floor" only for floor-local details
- factsAdd items should include a structured factKey whenever possible
- factsUpdate, factsDeprecate, and openLoopsResolve must use ids from the provided lists
- openLoopsAdd should track unresolved questions, promises, suspicions, missing information, or pending actions
- openLoopsResolve should only reference loops that are clearly resolved in the latest floor
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

function formatSummaryLabel(item: MemoryItem): string {
  if (item.summaryTier === 'micro') {
    return 'micro';
  }

  if (item.summaryTier === 'macro') {
    return 'macro';
  }

  return 'summary';
}

function buildUserMessage(input: MemoryIngestInput): string {
  const parts: string[] = [];

  parts.push('## Latest Floor Transcript');
  parts.push(input.currentFloorContent);

  const extractedSummaries = (input.extractedSummaries ?? [])
    .map((summary) => summary.trim())
    .filter((summary) => summary.length > 0);
  if (extractedSummaries.length > 0) {
    parts.push('');
    parts.push('## Current Turn Extracted Summaries');
    extractedSummaries.forEach((summary) => {
      parts.push(`- ${summary}`);
    });
  }

  if (input.recentSummaries.length > 0) {
    parts.push('');
    parts.push('## Recent Summaries');
    input.recentSummaries.forEach((summary) => {
      parts.push(`- [${summary.id}] (${formatSummaryLabel(summary)}) ${summary.content}`);
    });
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

function parseJsonText(text: string): Record<string, unknown> {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1]! : text.trim();
  return JSON.parse(jsonText) as Record<string, unknown>;
}

function toIngestOutput(parsed: Record<string, unknown>): MemoryIngestOutput {
  return {
    microSummary: typeof parsed.microSummary === 'string'
      ? parsed.microSummary.trim()
      : (typeof parsed.micro_summary === 'string' ? parsed.micro_summary.trim() : ''),
    factsAdd: normalizeFactAddEntries(parsed.factsAdd ?? parsed.facts_add),
    factsUpdate: normalizeFactUpdateEntries(parsed.factsUpdate ?? parsed.facts_update),
    factsDeprecate: normalizeFactDeprecateEntries(parsed.factsDeprecate ?? parsed.facts_deprecate),
    openLoopsAdd: normalizeOpenLoopAddEntries(parsed.openLoopsAdd ?? parsed.open_loops_add),
    openLoopsResolve: normalizeOpenLoopResolveEntries(parsed.openLoopsResolve ?? parsed.open_loops_resolve),
  };
}

function resolveFallbackMicroSummary(extractedSummaries: string[] | undefined, rawText: string): string {
  const candidate = (extractedSummaries ?? [])
    .map((summary) => summary.trim())
    .filter((summary) => summary.length > 0)
    .join(' ')
    .trim();

  if (candidate) {
    return candidate;
  }

  return rawText.trim().slice(0, MAX_FALLBACK_MICRO_SUMMARY_LENGTH);
}

export class MemoryIngestProcessor {
  constructor(private readonly llm: LLMPort) {}

  async process(input: MemoryIngestInput): Promise<MemoryIngestResult> {
    const userMessage = buildUserMessage(input);
    const response = await this.llm.generate({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      params: {
        temperature: 0.2,
        maxOutputTokens: 1200,
        ...input.params,
        stream: false,
      },
      model: input.model,
    });

    let output: MemoryIngestOutput;
    let degraded: MemoryIngestResult['degraded'];

    try {
      output = toIngestOutput(parseJsonText(response.text));
      if (!output.microSummary && input.extractedSummaries?.length) {
        output = {
          ...output,
          microSummary: resolveFallbackMicroSummary(input.extractedSummaries, response.text),
        };
      }
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      output = {
        microSummary: resolveFallbackMicroSummary(input.extractedSummaries, response.text),
        factsAdd: [],
        factsUpdate: [],
        factsDeprecate: [],
        openLoopsAdd: [],
        openLoopsResolve: [],
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
