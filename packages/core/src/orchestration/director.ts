import type { LLMPort, GenerationParams, ModelConfig, TokenUsage } from '../llm/types.js';
import type { MemoryItem } from '../memory/types.js';

// ── 类型 ──────────────────────────────────────────────

/** Director 输入 */
export interface DirectorInput {
  /** 最近的聊天历史摘要 */
  recentContext: string;
  /** 已有的活跃 facts */
  activeFacts: MemoryItem[];
  /** 角色设定摘要 */
  characterSummary?: string;
  /** 上一个 Director 指令 */
  previousDirective?: string;
}

/** Director 输出 */
export interface DirectorOutput {
  /** 本回合的叙事指令 */
  directive: string;
  /** 建议的情绪基调 */
  tone?: string;
  /** 需要关注的角色/元素 */
  focusElements?: string[];
}

/** Director 执行结果 */
export interface DirectorResult {
  output: DirectorOutput;
  usage: TokenUsage;
}

// ── 内部工具 ──────────────────────────────────────────

const DIRECTOR_SYSTEM_PROMPT = `You are a Story Director for a role-playing narrative. Your job is to provide concise narrative directives that guide the Narrator.

You will receive:
1. Recent story context
2. Known facts about the world and characters
3. Character settings (if available)
4. Previous directive (if any)

Respond with a JSON object:
{
  "directive": "A concise instruction for the Narrator about what should happen or be emphasized this turn",
  "tone": "The emotional tone to aim for (e.g., 'tense', 'lighthearted', 'melancholic')",
  "focusElements": ["character or element to focus on", "another element"]
}

Rules:
- Keep directives concise (1-3 sentences)
- Don't write the story yourself, just guide its direction
- Consider narrative pacing and tension
- Respond ONLY with valid JSON`;

function buildDirectorUserMessage(input: DirectorInput): string {
  const parts: string[] = [];

  parts.push('## Recent Context');
  parts.push(input.recentContext);

  if (input.activeFacts.length > 0) {
    parts.push('');
    parts.push('## Known Facts');
    for (const fact of input.activeFacts) {
      parts.push(`- ${fact.content}`);
    }
  }

  if (input.characterSummary) {
    parts.push('');
    parts.push('## Character Setting');
    parts.push(input.characterSummary);
  }

  if (input.previousDirective) {
    parts.push('');
    parts.push('## Previous Directive');
    parts.push(input.previousDirective);
  }

  return parts.join('\n');
}

function parseDirectorJSON(text: string): DirectorOutput {
  // 尝试提取 code block 中的 JSON
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : text.trim();

  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  return {
    directive: typeof parsed.directive === 'string' ? parsed.directive : '',
    tone: typeof parsed.tone === 'string' ? parsed.tone : undefined,
    focusElements: Array.isArray(parsed.focusElements)
      ? (parsed.focusElements as string[])
      : (Array.isArray(parsed.focus_elements)
        ? (parsed.focus_elements as string[])
        : undefined),
  };
}

// ── Director ──────────────────────────────────────────

/**
 * Director 实例
 *
 * 在复杂 RP 场景中，Director 在 Narrator 之前执行，
 * 分析当前局势并输出结构化的叙事指令。
 *
 * Narrator 可以将 directive 作为额外的系统提示来引导生成。
 *
 * @example
 * ```typescript
 * const director = new Director(directorLLM);
 * const result = await director.direct({
 *   recentContext: '最近两个楼层的摘要...',
 *   activeFacts: facts,
 *   characterSummary: '角色设定...',
 * });
 * // result.output.directive = "Focus on the tension between Alice and Bob"
 * ```
 */
export class Director {
  constructor(private readonly llm: LLMPort) {}

  /**
   * 生成本回合的叙事指令。
   *
   * @param input - Director 输入
   * @param params - 生成参数覆盖
   * @returns Director 结果
   */
  async direct(
    input: DirectorInput,
    params?: GenerationParams,
    model?: ModelConfig,
  ): Promise<DirectorResult> {
    const userMessage = buildDirectorUserMessage(input);

    const response = await this.llm.generate({
      messages: [
        { role: 'system', content: DIRECTOR_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      params: {
        temperature: 0.4,
        maxOutputTokens: 500,
        ...params,
        stream: false,
      },
      model,
    });

    let output: DirectorOutput;
    try {
      output = parseDirectorJSON(response.text);
    } catch {
      // 优雅降级：把整个输出作为 directive
      output = {
        directive: response.text.trim(),
      };
    }

    // 确保 directive 不为空
    if (!output.directive) {
      output.directive = response.text.trim() || 'Continue the story naturally.';
    }

    return {
      output,
      usage: response.usage,
    };
  }
}
