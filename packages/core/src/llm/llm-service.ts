import { generateText, streamText } from 'ai';
import type { LanguageModel } from 'ai';
import type {
  LLMPort,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  LLMStepResult,
  StreamCallbacks,
  ModelConfig,
  GenerationParams,
} from './types.js';
import type { ProviderRegistry } from './provider-registry.js';

// ── 错误类 ────────────────────────────────────────────

export class LLMServiceError extends Error {
  constructor(
    message: string,
    causedBy?: unknown,
  ) {
    super(message);
    this.name = 'LLMServiceError';
    this.cause = causedBy;
  }
}

export class LLMTimeoutError extends LLMServiceError {
  constructor(timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs}ms`);
    this.name = 'LLMTimeoutError';
  }
}

export class LLMAbortError extends LLMServiceError {
  constructor() {
    super('LLM request was aborted');
    this.name = 'LLMAbortError';
  }
}

// ── 内部工具 ──────────────────────────────────────────

/**
 * 创建带超时的 AbortSignal。
 * 如果用户已传入 abortSignal，则组合两者。
 */
function createTimeoutSignal(
  timeoutMs?: number,
  userSignal?: AbortSignal,
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (!timeoutMs && !userSignal) {
    return { signal: undefined, cleanup: () => {} };
  }

  if (!timeoutMs) {
    return { signal: userSignal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new LLMTimeoutError(timeoutMs)), timeoutMs);

  let onAbort: (() => void) | undefined;

  if (userSignal) {
    if (userSignal.aborted) {
      clearTimeout(timer);
      controller.abort(userSignal.reason);
    } else {
      onAbort = () => {
        clearTimeout(timer);
        controller.abort(userSignal.reason);
      };
      userSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (userSignal && onAbort) {
        userSignal.removeEventListener('abort', onAbort);
      }
    },
  };
}

function toTokenCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function normalizeUsage(usage: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const raw = usage as {
    promptTokens?: unknown;
    completionTokens?: unknown;
    totalTokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
  } | null | undefined;

  // v5 usage 结构（直接数字）:
  //   { inputTokens: number, outputTokens: number, totalTokens: number }
  // v5 usage 结构（嵌套，来自 mock/provider 底层）:
  //   { inputTokens: { total: number, ... }, outputTokens: { total: number, ... }, totalTokens: number }
  const inVal = raw?.inputTokens;
  const outVal = raw?.outputTokens;
  const prompt = typeof inVal === 'number' ? inVal
    : typeof inVal === 'object' && inVal !== null ? (inVal as any).total : undefined;
  const completion = typeof outVal === 'number' ? outVal
    : typeof outVal === 'object' && outVal !== null ? (outVal as any).total : undefined;
 
  const p = toTokenCount(raw?.promptTokens ?? prompt);
  const c = toTokenCount(raw?.completionTokens ?? completion);
  const t = raw?.totalTokens;
  // v5 generateText 可能把未传入的 totalTokens 写为零，零值应回退到 p + c
  const total = (typeof t === 'number' && t > 0) ? toTokenCount(t) : (p + c);
 
  return {
    promptTokens: p,
    completionTokens: c,
    totalTokens: total,
  };
}

function normalizeFinishReason(finishReason: unknown): string {
  if (typeof finishReason === 'string' && finishReason.length > 0) {
    return finishReason;
  }

  return typeof (finishReason as { unified?: unknown } | null | undefined)?.unified === 'string'
    ? (finishReason as { unified: string }).unified
    : 'unknown';
}

/**
 * 将 GenerationParams 映射为 Vercel AI SDK 的设置。
 */
function mapParams(params: GenerationParams): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  if (params.maxOutputTokens !== undefined) mapped.maxOutputTokens = params.maxOutputTokens;
  if (params.temperature !== undefined) mapped.temperature = params.temperature;
  if (params.topP !== undefined) mapped.topP = params.topP;
  if (params.topK !== undefined) mapped.topK = params.topK;
  if (params.frequencyPenalty !== undefined) mapped.frequencyPenalty = params.frequencyPenalty;
  if (params.presencePenalty !== undefined) mapped.presencePenalty = params.presencePenalty;
  if (params.stopSequences !== undefined) mapped.stopSequences = params.stopSequences;
  if (params.maxRetries !== undefined) mapped.maxRetries = params.maxRetries;
  if (params.reasoningEffort !== undefined) {
    mapped.providerOptions = {
      openai: {
        reasoningEffort: params.reasoningEffort,
      },
    };
  }

  return mapped;
}

// ── LLM Service ───────────────────────────────────────

/**
 * LLM 调用服务：基于 Vercel AI SDK 实现 LLMPort 接口。
 *
 * 支持：
 * - 非流式生成（generateText）
 * - 流式生成（streamText）
 * - 超时 / 中止控制
 * - Provider Registry 集成
 *
 * @example
 * ```typescript
 * const service = new LLMService(registry, { providerId: 'openai', modelId: 'gpt-4o' });
 * const response = await service.generate({
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   params: { temperature: 0.7 },
 * });
 * ```
 */
export class LLMService implements LLMPort {
  constructor(
    private registry: ProviderRegistry,
    private defaultModel: ModelConfig,
  ) {}

  /**
   * 获取 LanguageModel 实例。
   * 优先使用 request.model，否则使用 defaultModel。
   */
  private getLanguageModel(request: LLMRequest): LanguageModel {
    const model = request.model ?? this.defaultModel;
    if (model.languageModel) {
      return model.languageModel;
    }

    return this.registry.getModel(model.providerId, model.modelId);
  }

  /**
   * 非流式生成。
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const languageModel = this.getLanguageModel(request);
    const settings = mapParams(request.params);
    const { signal, cleanup } = createTimeoutSignal(
      request.params.timeoutMs,
      request.abortSignal,
    );

    try {
      const result = await generateText({
        model: languageModel,
        messages: request.messages,
        ...(request.tools ? { tools: request.tools as any } : {}),
        ...(request.maxSteps ? { maxSteps: request.maxSteps } : {}),
        abortSignal: signal,
        ...settings,
      });

      return {
        text: result.text,
        usage: normalizeUsage(result.usage),
        finishReason: normalizeFinishReason(result.finishReason),
        toolCalls: extractToolCalls(result),
        steps: extractSteps(result),
      };
    } catch (error) {
      throw this.wrapError(error);
    } finally {
      cleanup();
    }
  }

  /**
   * 流式生成。
   */
  async stream(request: LLMRequest, callbacks: StreamCallbacks): Promise<LLMResponse> {
    const languageModel = this.getLanguageModel(request);
    const settings = mapParams(request.params);
    const { signal, cleanup } = createTimeoutSignal(
      request.params.timeoutMs,
      request.abortSignal,
    );

    try {
      const result = streamText({
        model: languageModel,
        messages: request.messages,
        ...(request.tools ? { tools: request.tools as any } : {}),
        ...(request.maxSteps ? { maxSteps: request.maxSteps } : {}),
        abortSignal: signal,
        ...settings,
      });

      // 消费文本流
      let fullText = '';
      try {
        for await (const part of result.textStream) {
          // v5 返回的可能为字符串，也可能是 { type: 'text-delta', textDelta: '...' }
          const chunk: string = typeof part === 'string' ? part
            : ((part as any).textDelta ?? (part as any).delta ?? '');
          fullText += chunk;
          callbacks.onChunk?.(chunk);
        }
      } catch (error) {
        const wrapped = this.wrapError(error);
        callbacks.onError?.(wrapped);
        throw wrapped;
      }

      // 等待最终结果
      const usage = await result.usage;
      const finishReason = await result.finishReason;
      const normalizedFinish = normalizeFinishReason(finishReason);

      const response: LLMResponse = {
        text: fullText,
        usage: normalizeUsage(usage),
        finishReason: normalizedFinish,
        toolCalls: extractToolCallsFromStream(result),
        steps: extractStepsFromStream(result),
      };

      callbacks.onFinish?.(response);
      return response;
    } catch (error) {
      if (error instanceof LLMServiceError) throw error;
      throw this.wrapError(error);
    } finally {
      cleanup();
    }
  }

  /**
   * 将各种错误包装为标准错误类型。
   */
  private wrapError(error: unknown): LLMServiceError {
    if (error instanceof LLMServiceError) return error;

    // AbortError
    if (
      error instanceof DOMException && error.name === 'AbortError' ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      // 检查是否是超时引起的
      if (error instanceof Error && error.cause instanceof LLMTimeoutError) {
        return error.cause;
      }
      return new LLMAbortError();
    }

    // 通用错误
    return new LLMServiceError(
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}


// ── Tool Call 提取辅助函数 ─────────────────────────────

/**
 * 从 generateText 结果中提取工具调用记录。
 * Vercel AI SDK generateText 的结果中可能包含 toolCalls 和 steps。
 */
function extractToolCalls(result: any): LLMToolCall[] | undefined {
  // result.toolCalls 是当前步的 tool calls
  // result.steps 每步各有 toolCalls
  const calls: LLMToolCall[] = [];

  // 优先从 steps 中收集所有 tool calls
  if (Array.isArray(result.steps)) {
    for (const step of result.steps) {
      if (Array.isArray(step.toolCalls)) {
        for (const tc of step.toolCalls) {
          calls.push({ toolName: tc.toolName, args: tc.args });
        }
      }
    }
  } else if (Array.isArray(result.toolCalls)) {
    // 没有 steps 时，直接从顶层取
    for (const tc of result.toolCalls) {
      calls.push({ toolName: tc.toolName, args: tc.args });
    }
  }

  return calls.length > 0 ? calls : undefined;
}

/**
 * 从 generateText 结果中提取各步结果。
 */
function extractSteps(result: any): LLMStepResult[] | undefined {
  if (!Array.isArray(result.steps) || result.steps.length === 0) return undefined;

  return result.steps.map((step: any) => ({
    text: step.text ?? '',
    toolCalls: Array.isArray(step.toolCalls)
      ? step.toolCalls.map((tc: any) => ({ toolName: tc.toolName, args: tc.args }))
      : [],
    toolResults: Array.isArray(step.toolResults)
      ? step.toolResults.map((tr: any) => tr.result ?? tr)
      : [],
  }));
}

/**
 * 从 streamText 结果中提取工具调用记录。
 * streamText 返回的对象结构与 generateText 略有不同，
 * 某些字段是 promise。这里做安全提取。
 */
function extractToolCallsFromStream(result: any): LLMToolCall[] | undefined {
  // streamText 的 toolCalls 可能是 promise，这里只取已经 resolve 的同步数据
  // 在 stream() 方法中，流已经完全消费完毕，所以 steps 应该已就绪
  try {
    const steps = (result as any).steps;
    if (Array.isArray(steps) && steps.length > 0) {
      const calls: LLMToolCall[] = [];
      for (const step of steps) {
        if (Array.isArray(step.toolCalls)) {
          for (const tc of step.toolCalls) {
            calls.push({ toolName: tc.toolName, args: tc.args });
          }
        }
      }
      return calls.length > 0 ? calls : undefined;
    }
  } catch {
    // 安全降级：流式模式下提取失败不影响主流程
  }
  return undefined;
}

/**
 * 从 streamText 结果中提取各步结果。
 */
function extractStepsFromStream(result: any): LLMStepResult[] | undefined {
  try {
    const steps = (result as any).steps;
    if (Array.isArray(steps) && steps.length > 0) {
      return steps.map((step: any) => ({
        text: step.text ?? '',
        toolCalls: Array.isArray(step.toolCalls)
          ? step.toolCalls.map((tc: any) => ({ toolName: tc.toolName, args: tc.args }))
          : [],
        toolResults: Array.isArray(step.toolResults)
          ? step.toolResults.map((tr: any) => tr.result ?? tr)
          : [],
      }));
    }
  } catch {
    // 安全降级
  }
  return undefined;
}
