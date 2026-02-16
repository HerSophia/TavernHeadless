import type { LLMPort, GenerationParams, ModelConfig, TokenUsage } from '../llm/types.js';
import type { MemoryItem } from '../memory/types.js';

// ── 类型 ──────────────────────────────────────────────

/** Verifier 输入 */
export interface VerifierInput {
  /** 生成的文本 */
  generatedText: string;
  /** 角色设定/规则 */
  characterRules?: string;
  /** 活跃 facts（作为一致性参考） */
  activeFacts?: MemoryItem[];
}

/** 问题条目 */
export interface VerifierIssue {
  description: string;
  severity: 'warning' | 'error';
}

/** Verifier 输出 */
export interface VerifierOutput {
  /** 是否通过 */
  passed: boolean;
  /** 问题列表 */
  issues: VerifierIssue[];
  /** 建议修正 */
  suggestion?: string;
}

/** Verifier 执行结果 */
export interface VerifierResult {
  output: VerifierOutput;
  usage: TokenUsage;
}

// ── 内部工具 ──────────────────────────────────────────

const VERIFIER_SYSTEM_PROMPT = `You are a Story Verifier for a role-playing narrative. Your job is to check if the generated text is consistent with established facts and character rules.

You will receive:
1. The generated text to verify
2. Character rules/settings (if available)
3. Known facts (if available)

Respond with a JSON object:
{
  "passed": true/false,
  "issues": [
    { "description": "what is wrong", "severity": "warning" or "error" }
  ],
  "suggestion": "optional suggestion for improvement"
}

Rules:
- "passed" should be true if there are no errors (warnings are okay)
- severity "error" = factual contradiction or rule violation
- severity "warning" = minor inconsistency or style concern
- If everything is fine, return {"passed": true, "issues": []}
- Respond ONLY with valid JSON`;

function buildVerifierUserMessage(input: VerifierInput): string {
  const parts: string[] = [];

  parts.push('## Generated Text');
  parts.push(input.generatedText);

  if (input.characterRules) {
    parts.push('');
    parts.push('## Character Rules');
    parts.push(input.characterRules);
  }

  if (input.activeFacts && input.activeFacts.length > 0) {
    parts.push('');
    parts.push('## Known Facts');
    for (const fact of input.activeFacts) {
      parts.push(`- ${fact.content}`);
    }
  }

  return parts.join('\n');
}

function parseVerifierJSON(text: string): VerifierOutput {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : text.trim();

  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  const issues: VerifierIssue[] = [];
  if (Array.isArray(parsed.issues)) {
    for (const issue of parsed.issues) {
      if (typeof issue === 'object' && issue !== null) {
        const i = issue as Record<string, unknown>;
        issues.push({
          description: typeof i.description === 'string' ? i.description : 'Unknown issue',
          severity: i.severity === 'error' ? 'error' : 'warning',
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');

  return {
    passed: typeof parsed.passed === 'boolean' ? parsed.passed : !hasErrors,
    issues,
    suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : undefined,
  };
}

// ── Verifier ──────────────────────────────────────────

/**
 * Verifier 实例
 *
 * 在 Narrator 生成内容后，Verifier 检查生成内容是否与
 * 已有事实和角色设定一致。
 *
 * 这是一个可选模块，只在严格场景中使用。
 *
 * @example
 * ```typescript
 * const verifier = new Verifier(verifierLLM);
 * const result = await verifier.verify({
 *   generatedText: '生成的故事内容...',
 *   characterRules: '角色不会飞',
 *   activeFacts: facts,
 * });
 * if (!result.output.passed) {
 *   console.log('Issues:', result.output.issues);
 * }
 * ```
 */
export class Verifier {
  constructor(private readonly llm: LLMPort) {}

  /**
   * 检查生成内容的一致性。
   *
   * @param input - Verifier 输入
   * @param params - 生成参数覆盖
   * @returns Verifier 结果
   */
  async verify(
    input: VerifierInput,
    params?: GenerationParams,
    model?: ModelConfig,
  ): Promise<VerifierResult> {
    const userMessage = buildVerifierUserMessage(input);

    const response = await this.llm.generate({
      messages: [
        { role: 'system', content: VERIFIER_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      params: {
        temperature: 0.2,
        maxOutputTokens: 500,
        ...params,
        stream: false,
      },
      model,
    });

    let output: VerifierOutput;
    try {
      output = parseVerifierJSON(response.text);
    } catch {
      // 优雅降级：无法解析时默认通过
      output = {
        passed: true,
        issues: [],
        suggestion: undefined,
      };
    }

    return {
      output,
      usage: response.usage,
    };
  }
}
