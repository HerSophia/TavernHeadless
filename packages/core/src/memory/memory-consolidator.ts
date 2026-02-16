import type { MemoryScope } from '@tavern/shared';
import type { LLMPort, GenerationParams, ModelConfig, TokenUsage } from '../llm/types.js';
import type { MemoryItem, MemoryConsolidationOutput } from './types.js';
import type { MemoryStore } from './memory-store.js';

// ── 类型 ──────────────────────────────────────────────

/** 整理输入 */
export interface ConsolidationInput {
  /** 当前楼层的文本内容 */
  currentFloorContent: string;
  /** 最近的摘要列表（已从 MemoryStore 查询） */
  recentSummaries: string[];
  /** 已有的活跃 facts */
  existingFacts: MemoryItem[];
  /** 作用域 */
  scope: MemoryScope;
  /** 作用域实体 ID */
  scopeId: string;
  /** 来源楼层 ID */
  sourceFloorId: string;
  /** 生成参数（可选覆盖） */
  params?: GenerationParams;
  /** 模型配置（可选覆盖） */
  model?: ModelConfig;
}

/** 整理结果 */
export interface ConsolidationResult {
  /** 结构化输出 */
  output: MemoryConsolidationOutput;
  /** Token 使用统计 */
  usage: TokenUsage;
}

// ── 内部工具 ──────────────────────────────────────────

/** 默认的 Memory 实例系统提示词 */
const SYSTEM_PROMPT = `You are a Memory Manager for a role-playing story. Your job is to maintain a structured memory of important facts, events, and character states.

You will receive:
1. The latest story content
2. Recent summaries from previous turns
3. Currently known facts

You must respond with a JSON object in the following format:
{
  "turnSummary": "A brief summary of what happened in this turn",
  "factsAdd": [
    { "key": "fact name", "value": "fact description", "scope": "chat", "importance": 0.7 }
  ],
  "factsUpdate": [
    { "id": "existing_fact_id", "value": "updated description", "importance": 0.8 }
  ],
  "factsDeprecate": [
    { "id": "outdated_fact_id", "reason": "why this fact is no longer relevant" }
  ]
}

Rules:
- importance is a number between 0 and 1 (0.5 = normal, 0.8+ = very important, 0.3- = minor)
- scope should be "chat" for most facts, "global" only for world-building facts
- Only deprecate facts that are clearly contradicted or no longer relevant
- Keep summaries concise but informative
- Respond ONLY with valid JSON, no additional text`;

/**
 * 构建用户消息：包含当前内容、最近摘要、已有 facts
 */
function buildUserMessage(
  currentFloorContent: string,
  recentSummaries: string[],
  existingFacts: MemoryItem[],
): string {
  const parts: string[] = [];

  parts.push('## Latest Story Content');
  parts.push(currentFloorContent);

  if (recentSummaries.length > 0) {
    parts.push('');
    parts.push('## Recent Summaries');
    for (const summary of recentSummaries) {
      parts.push(`- ${summary}`);
    }
  }

  if (existingFacts.length > 0) {
    parts.push('');
    parts.push('## Known Facts');
    for (const fact of existingFacts) {
      parts.push(`- [${fact.id}] (importance: ${fact.importance}) ${fact.content}`);
    }
  }

  return parts.join('\n');
}

/**
 * 从 LLM 输出中解析 JSON。
 * 支持 markdown code block 包裹（```json ... ```）。
 */
function parseConsolidationJSON(text: string): MemoryConsolidationOutput {
  // 尝试提取 code block 中的 JSON
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : text.trim();

  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  // 安全解析各字段
  return {
    turnSummary: typeof parsed.turnSummary === 'string'
      ? parsed.turnSummary
      : (typeof parsed.turn_summary === 'string' ? parsed.turn_summary : ''),
    factsAdd: Array.isArray(parsed.factsAdd ?? parsed.facts_add)
      ? (parsed.factsAdd ?? parsed.facts_add) as MemoryConsolidationOutput['factsAdd']
      : [],
    factsUpdate: Array.isArray(parsed.factsUpdate ?? parsed.facts_update)
      ? (parsed.factsUpdate ?? parsed.facts_update) as MemoryConsolidationOutput['factsUpdate']
      : [],
    factsDeprecate: Array.isArray(parsed.factsDeprecate ?? parsed.facts_deprecate)
      ? (parsed.factsDeprecate ?? parsed.facts_deprecate) as MemoryConsolidationOutput['factsDeprecate']
      : [],
  };
}

// ── MemoryConsolidator ────────────────────────────────

/**
 * 记忆整理器
 *
 * 使用 Memory 角色的 LLM 实例，将最近的故事内容和已有记忆
 * 整理成结构化的记忆操作（新增/更新/标记过时）。
 *
 * 流程：
 * 1. 构建 Memory 实例的提示词（包含当前内容 + 已有 facts）
 * 2. 调用 LLM（要求输出 JSON）
 * 3. 解析 JSON 输出
 * 4. 通过 MemoryStore.applyConsolidation 落库
 *
 * @example
 * ```typescript
 * const consolidator = new MemoryConsolidator(memoryLLM, memoryStore);
 * const result = await consolidator.consolidate({
 *   currentFloorContent: '角色A向角色B表白...',
 *   recentSummaries: ['上一轮的摘要'],
 *   existingFacts: activeFacts,
 *   scope: 'chat',
 *   scopeId: sessionId,
 *   sourceFloorId: floorId,
 * });
 * ```
 */
export class MemoryConsolidator {
  constructor(
    private readonly llm: LLMPort,
    private readonly memoryStore: MemoryStore,
  ) {}

  /**
   * 执行记忆整理。
   *
   * @param input - 整理输入
   * @returns 整理结果（结构化输出 + token 统计）
   * @throws 如果 LLM 调用失败，抛出原始错误
   */
  async consolidate(input: ConsolidationInput): Promise<ConsolidationResult> {
    const {
      currentFloorContent,
      recentSummaries,
      existingFacts,
      scope,
      scopeId,
      sourceFloorId,
      params,
      model,
    } = input;

    const userMessage = buildUserMessage(
      currentFloorContent,
      recentSummaries,
      existingFacts,
    );

    const response = await this.llm.generate({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      params: {
        temperature: 0.3,
        maxOutputTokens: 1000,
        ...params,
        stream: false,
      },
      model,
    });

    let output: MemoryConsolidationOutput;
    try {
      output = parseConsolidationJSON(response.text);
    } catch {
      // JSON 解析失败 → 优雅降级：把整个输出作为 turnSummary
      output = {
        turnSummary: response.text.trim(),
        factsAdd: [],
        factsUpdate: [],
        factsDeprecate: [],
      };
    }

    // 应用到 MemoryStore
    await this.memoryStore.applyConsolidation(
      output,
      scope,
      scopeId,
      sourceFloorId,
    );

    return {
      output,
      usage: response.usage,
    };
  }
}
