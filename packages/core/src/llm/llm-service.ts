import { generateText, streamText } from 'ai';
import type { LanguageModel } from 'ai';
import type {
  LLMPort,
  LLMRequest,
  LLMResponse,
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

  // 如果用户的信号触发，也中止
  if (userSignal) {
    if (userSignal.aborted) {
      clearTimeout(timer);
      controller.abort(userSignal.reason);
    } else {
      const onAbort = () => {
        clearTimeout(timer);
        controller.abort(userSignal.reason);
      };
      userSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
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

  return {
    promptTokens: toTokenCount(raw?.promptTokens ?? raw?.inputTokens),
    completionTokens: toTokenCount(raw?.completionTokens ?? raw?.outputTokens),
    totalTokens: toTokenCount(raw?.totalTokens),
  };
}

/**
 * 将 GenerationParams 映射为 Vercel AI SDK 的设置。
 */
function mapParams(params: GenerationParams): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  if (params.maxOutputTokens !== undefined) mapped.maxTokens = params.maxOutputTokens;
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
        abortSignal: signal,
        ...settings,
      });

      return {
        text: result.text,
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason ?? 'unknown',
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
        abortSignal: signal,
        ...settings,
      });

      // 消费文本流
      let fullText = '';
      try {
        for await (const chunk of result.textStream) {
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

      const response: LLMResponse = {
        text: fullText,
        usage: normalizeUsage(usage),
        finishReason: finishReason ?? 'unknown',
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
