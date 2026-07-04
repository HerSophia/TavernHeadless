import type { ChatMessage } from '../prompt/types.js';
import type { LLMMessage, LLMPort } from '../llm/types.js';
import { isPlainTextModelMessage } from '../llm/types.js';
import type {
  GenerationInput,
  GenerationOutput,
  PipelineCallbacks,
} from './types.js';
import { extractSummaries } from './summary-extractor.js';

// ── 错误类 ────────────────────────────────────────────

export class GenerationPipelineError extends Error {
  constructor(
    message: string,
    public readonly phase: 'preprocess' | 'llm' | 'postprocess',
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GenerationPipelineError';
  }
}

// ── Generation Pipeline ───────────────────────────────

/**
 * 生成流水线
 *
 * 串联 LLM 调用的完整流程：
 * 1. 前处理（可选，如正则 USER_INPUT）
 * 2. LLM 调用（流式/非流式）
 * 3. 摘要提取
 * 4. 后处理（可选，如正则 AI_OUTPUT）
 *
 * 设计原则：
 * - 接收已拼装好的 messages[]，不依赖特定编排器
 * - 正则等处理通过回调注入，保持 core 与 adapters 解耦
 * - 支持流式和非流式两种模式
 *
 * @example
 * ```typescript
 * // 1. 外部编排
 * const ir = assembleCompat(input);
 * const assembled = messageBuilder.build(ir);
 *
 * // 2. 创建流水线并运行
 * const pipeline = new GenerationPipeline(llmService);
 * const output = await pipeline.run({
 *   messages: assembled.messages,
 *   params: { temperature: 0.7, maxOutputTokens: 500 },
 *   postProcess: (text) => applyRegexScripts(text, scripts, REGEX_PLACEMENT.AI_OUTPUT),
 * });
 * ```
 */
export class GenerationPipeline {
  constructor(private readonly llm: LLMPort) {}

  /**
   * 执行生成流水线。
   *
   * @param input - 流水线输入
   * @param callbacks - 流式回调（可选）
   * @returns 生成结果
   */
  async run(
    input: GenerationInput,
    callbacks?: PipelineCallbacks,
  ): Promise<GenerationOutput> {
    const { params, summaryOptions, abortSignal } = input;

    // ── 1. 前处理 ──
    // preProcess（正则 USER_INPUT 前处理）只作用于纯文本消息。native agent loop 续跑时
    // messages 可能含结构化 tool 往返消息，这些不是用户输入，不走 preProcess。
    let messages: LLMMessage[] = [...input.messages];
    if (input.preProcess && messages.every(isPlainTextModelMessage)) {
      try {
        messages = input.preProcess(messages as ChatMessage[]);
      } catch (e) {
        throw new GenerationPipelineError(
          `Pre-processing failed: ${e instanceof Error ? e.message : String(e)}`,
          'preprocess',
          e,
        );
      }
    }

    // ── 2. LLM 调用 ──
    const isStream = params.stream !== false; // 默认流式
    let rawText: string;
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason = 'other';
    let toolCalls: GenerationOutput['toolCalls'];
    let reasoningText: GenerationOutput['reasoningText'];

    try {
      const request = {
        ...(input.model ? { model: input.model } : {}),
        ...(input.tools ? { tools: input.tools, maxSteps: input.maxSteps } : {}),
        ...(input.toolChoice ? { toolChoice: input.toolChoice } : {}),
        // 纯文本消息归一化为 { role, content }；结构化消息原样透传给 SDK。
        messages: messages.map((m) =>
          isPlainTextModelMessage(m)
            ? { role: m.role, content: m.content }
            : m,
        ),
        params,
        abortSignal,
      };

      if (isStream) {
        const response = await this.llm.stream(request, {
          onChunk: callbacks?.onChunk,
          onReasoning: callbacks?.onReasoning,
          onError: callbacks?.onError,
        });
        rawText = response.text;
        usage = response.usage;
        finishReason = response.finishReason;
        toolCalls = response.toolCalls;
        reasoningText = response.reasoningText;
      } else {
        const response = await this.llm.generate(request);
        rawText = response.text;
        usage = response.usage;
        finishReason = response.finishReason;
        toolCalls = response.toolCalls;
        reasoningText = response.reasoningText;
      }
    } catch (e) {
      if (e instanceof GenerationPipelineError) throw e;
      throw new GenerationPipelineError(
        `LLM call failed: ${e instanceof Error ? e.message : String(e)}`,
        'llm',
        e,
      );
    }

    // ── 3. 摘要提取 ──
    const { summaries, cleanedText } = extractSummaries(rawText, summaryOptions);

    // ── 4. 后处理 ──
    let finalText = cleanedText;
    if (input.postProcess) {
      try {
        finalText = input.postProcess(finalText);
      } catch (e) {
        throw new GenerationPipelineError(
          `Post-processing failed: ${e instanceof Error ? e.message : String(e)}`,
          'postprocess',
          e,
        );
      }
    }

    return {
      text: finalText,
      rawText,
     summaries,
      usage,
      finishReason,
      toolCalls,
      ...(reasoningText ? { reasoningText } : {}),
    };
  }
}
