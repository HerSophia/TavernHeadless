import { generateText, streamText, wrapLanguageModel } from 'ai';
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
  ProviderType,
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
    : 'other';
}

/**
 * 从 generateText 结果中提取推理（思维链）文本。
 *
 * Vercel AI SDK 不同版本的字段可能不同，这里做一层归一化隔离：
 * - 优先取 `result.reasoningText`（拼接好的字符串）。
 * - 其次从 `result.reasoning` 数组拼接。
 * 都为空时返回 undefined，代表「无 reasoning」。
 */
function extractReasoningText(result: unknown): string | undefined {
  const raw = result as {
    reasoningText?: unknown;
    reasoning?: unknown;
  } | null | undefined;

  const direct = raw?.reasoningText;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }

  const reasoning = raw?.reasoning;
  if (Array.isArray(reasoning)) {
    const joined = reasoning
   .map((part) => (typeof part === 'string' ? part : ((part as { text?: unknown })?.text ?? '')))
      .filter((text): text is string => typeof text === 'string')
      .join('');
    if (joined.length > 0) {
      return joined;
    }
  }

  return undefined;
}

type ProviderResponseFormat = {
  type: 'text';
} | {
  type: 'json';
  schema?: Record<string, unknown>;
};

/**
 * 合并某个 provider 的 providerOptions 子对象（不覆盖其他 provider 的配置）。
 */
function mergeProviderOptions(
  mapped: Record<string, unknown>,
  providerKey: string,
  options: Record<string, unknown>,
): void {
  const currentProviderOptions = mapped.providerOptions as Record<string, unknown> | undefined;
  const currentForProvider = currentProviderOptions?.[providerKey] as Record<string, unknown> | undefined;

  mapped.providerOptions = {
    ...(currentProviderOptions ?? {}),
    [providerKey]: {
      ...(currentForProvider ?? {}),
      ...options,
    },
  };
}

function mergeOpenAIProviderOptions(
  mapped: Record<string, unknown>,
  options: Record<string, unknown>,
): void {
  mergeProviderOptions(mapped, 'openai', options);
}

// ── 推理强度映射 ──────────────────────────────────────

/**
 * Anthropic adaptive 思考模式下 `effort`（output_config.effort）支持的努力级别。
 *
 * 注意：xhigh 仅 Opus 4.7、max 仅 Opus 4.6 支持，模型不支持时由 API 报错，这里不拦截。
 */
const ANTHROPIC_EFFORT_LEVELS: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

/** Anthropic 手动思考预算下限（低于此值 API 拒绝）。 */
const ANTHROPIC_MIN_THINKING_BUDGET = 1024;

/** 手动思考时，在 budget 之上为正文输出预留的 token 余量（保证 max_tokens > budget）。 */
const ANTHROPIC_RESPONSE_TOKEN_HEADROOM = 4096;

/**
 * 把纯数字字符串解析为 Anthropic 手动思考预算 token；非数字或低于下限返回 null。
 */
function parseAnthropicThinkingBudget(effort: string): number | null {
  const numeric = Number.parseInt(effort, 10);
  if (Number.isFinite(numeric) && numeric >= ANTHROPIC_MIN_THINKING_BUDGET) {
    return numeric;
  }
  return null;
}

/**
 * 按 provider 类型下发推理强度。
 *
 * Anthropic（providerOptions.anthropic）按 reasoningEffort 字符串语义分流：
 * - 努力级别 low/medium/high/xhigh/max → thinking.type=adaptive + effort（自适应模式 + 努力级别）；
 * - 纯数字（思考预算 token）→ thinking.type=enabled + budgetTokens（手动模式），并抬高 max_tokens；
 * - 'adaptive'或其他无法识别的值 → thinking.type=adaptive（自适应，由模型自行决定思考深度）。
 * Opus 4.6+ 仅支持 adaptive，因此默认走 adaptive；思考开启时移除自定义 temperature/topP/topK
 * （Anthropic 思考模式不接受这些采样参数，否则报错）。
 *
 * OpenAI 系（openai / openai-compatible / deepseek / xai / 未知）走
 * providerOptions.openai.reasoningEffort：
 * - 'adaptive' 是 Anthropic 专有概念，对 OpenAI 不下发（由模型默认决定）；
 * - 其余值原样透传，由模型自行解释。
 */
function applyReasoningEffort(
  mapped: Record<string, unknown>,
  effort: string,
  providerType: ProviderType | undefined,
): void {
  if (providerType === 'anthropic') {
   const budget = parseAnthropicThinkingBudget(effort);
    if (budget !== null) {
      // 手动模式：enabled + budgetTokens；max_tokens 必须大于 budget。
      mergeProviderOptions(mapped, 'anthropic', {
        thinking: { type: 'enabled', budgetTokens: budget },
      });
      const minOutput = budget + ANTHROPIC_RESPONSE_TOKEN_HEADROOM;
      const currentMax = typeof mapped.maxOutputTokens === 'number' ? mapped.maxOutputTokens : 0;
      mapped.maxOutputTokens = Math.max(currentMax, minOutput);
    } else if(ANTHROPIC_EFFORT_LEVELS.has(effort)) {
      // 自适应模式 + 努力级别（output_config.effort）。
      mergeProviderOptions(mapped, 'anthropic', {
        thinking: { type: 'adaptive' },
        effort,
      });
    } else {
      // 'adaptive' 或其他：自适应，由模型自行决定思考深度（Opus 4.6+ 仅支持此模式）。
      mergeProviderOptions(mapped, 'anthropic', {
        thinking: { type: 'adaptive' },
      });
    }
    // Anthropic 思考模式不接受自定义采样参数，移除以免 API 报错。
    delete mapped.temperature;
    delete mapped.topP;
    delete mapped.topK;
    return;
  }

  // OpenAI 系：'adaptive' 是 Anthropic 专有概念，不下发（由模型默认决定）；其余原样透传。
  if (effort === 'adaptive') {
    return;
  }
  mergeOpenAIProviderOptions(mapped, { reasoningEffort: effort });
}

function mapResponseFormat(
  responseFormat: GenerationParams['responseFormat'],
): ProviderResponseFormat | undefined {
  if (responseFormat === undefined || responseFormat === null) {
    return undefined;
  }

  switch (responseFormat.type) {
    case 'text':
      return { type: 'text' };
    case 'json_object':
      return { type: 'json' };
    case 'json_schema':
      return responseFormat.jsonSchema
        ? { type: 'json', schema: responseFormat.jsonSchema }
        : undefined;
    default:
      return undefined;
  }
}

function applyResponseFormatMiddleware(
  model: LanguageModel,
  responseFormat: ProviderResponseFormat | undefined,
): LanguageModel {
  if (!responseFormat) {
    return model;
  }

  return wrapLanguageModel({
    model: model as any,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        responseFormat,
      }),
    },
  }) as LanguageModel;
}

/**
 * 将 GenerationParams 映射为 Vercel AI SDK 的设置。
 */
function mapParams(
  params: GenerationParams,
  providerType?: ProviderType,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  if (params.maxOutputTokens !== undefined && params.maxOutputTokens !== null) mapped.maxOutputTokens = params.maxOutputTokens;
  if (params.temperature !== undefined && params.temperature !== null) mapped.temperature = params.temperature;
  if (params.topP !== undefined && params.topP !== null) mapped.topP = params.topP;
  if (params.topK !== undefined && params.topK !== null) mapped.topK = params.topK;
  if (params.frequencyPenalty !== undefined && params.frequencyPenalty !== null) mapped.frequencyPenalty = params.frequencyPenalty;
  if (params.presencePenalty !== undefined && params.presencePenalty !== null) mapped.presencePenalty = params.presencePenalty;
  if (params.stopSequences !== undefined && params.stopSequences !== null) mapped.stopSequences = params.stopSequences;
  if (params.seed !== undefined && params.seed !== null) mapped.seed = params.seed;
  const responseFormat = mapResponseFormat(params.responseFormat);
  if (responseFormat !== undefined) mapped.responseFormat = responseFormat;
  if (params.maxRetries !== undefined && params.maxRetries !== null) mapped.maxRetries = params.maxRetries;

  const openAIProviderOptions: Record<string, unknown> = {};
  if (params.repetitionPenalty !== undefined && params.repetitionPenalty !== null) {
    openAIProviderOptions.repetitionPenalty = params.repetitionPenalty;
  }
  if (params.minP !== undefined && params.minP !== null) {
    openAIProviderOptions.minP = params.minP;
  }
  if (params.logitBias !== undefined && params.logitBias !== null) {
    openAIProviderOptions.logitBias = params.logitBias;
  }
  if (Object.keys(openAIProviderOptions).length > 0) {
    mergeOpenAIProviderOptions(mapped, openAIProviderOptions);
  }

  // 推理强度按 provider 分流。放在采样参数之后，便于 Anthropic 分支按需移除 temperature/topP/topK。
  if (params.reasoningEffort !== undefined && params.reasoningEffort !== null) {
    applyReasoningEffort(mapped, params.reasoningEffort, providerType);
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
    const baseModel = model.languageModel
      ? model.languageModel
      : this.registry.getModel(model.providerId, model.modelId);

    return applyResponseFormatMiddleware(
      baseModel,
      mapResponseFormat(request.params.responseFormat),
    );
  }

  /**
   * 解析本次请求的 provider 类型（用于推理强度按 provider 分流）。
   *
   * 优先用 request.model，否则 defaultModel；按 providerId 从 registry 反查配置。
   * registry 未注册该 provider（例如 turn 级冻结的裸 languageModel 句柄）时返回 undefined，
   * 此时推理强度按 OpenAI 系默认处理。
   */
  private resolveProviderType(request: LLMRequest): ProviderType | undefined {
    const model = request.model ?? this.defaultModel;
    // 优先用上层显式注入的 providerType（turn 级 languageModel 句柄场景 registry 查不到）。
    if (model.providerType) {
      return model.providerType;
    }
    try {
      return this.registry.getConfig(model.providerId)?.type;
    } catch {
      return undefined;
    }
  }

  /**
   * 非流式生成。
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const languageModel = this.getLanguageModel(request);
    const settings = mapParams(request.params, this.resolveProviderType(request));
    const { signal, cleanup } = createTimeoutSignal(
      request.params.timeoutMs,
      request.abortSignal,
    );

    try {
      const result = await generateText({
        model: languageModel,
        // request.messages 可能含结构化 assistant tool-call / tool-result 消息；
        // 这些类型贴合 SDK 的 ModelMessage，直接透传（沿用既有 tools as any 的隔离方式）。
        messages: request.messages as any,
        ...(request.tools ? { tools: request.tools as any } : {}),
        ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
        ...(request.maxSteps ? { maxSteps: request.maxSteps } : {}),
        abortSignal: signal,
        ...settings,
      });

      const reasoningText = extractReasoningText(result);
      return {
        text: result.text,
       usage: normalizeUsage(result.usage),
        finishReason: normalizeFinishReason(result.finishReason),
        toolCalls: extractToolCalls(result),
        steps: extractSteps(result),
        ...(reasoningText ? { reasoningText } : {}),
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
    const settings = mapParams(request.params, this.resolveProviderType(request));
    const { signal, cleanup } = createTimeoutSignal(
      request.params.timeoutMs,
      request.abortSignal,
    );

    try {
      const result = streamText({
        model: languageModel,
        // request.messages 可能含结构化 assistant tool-call / tool-result 消息；
        // 这些类型贴合 SDK 的 ModelMessage，直接透传（沿用既有 tools as any 的隔离方式）。
        messages: request.messages as any,
        ...(request.tools ? { tools: request.tools as any } : {}),
        ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
        ...(request.maxSteps ? { maxSteps: request.maxSteps } : {}),
        abortSignal: signal,
        ...settings,
      });

      // 消费完整流：区分正文 delta 与 reasoning delta。
      // 改用 fullStream（而非 textStream）以便捕获 reasoning-delta，正文 delta 行为保持不变。
      let fullText = '';
      let reasoningText = '';
      try {
        for await (const part of result.fullStream) {
          const type = (part as { type?: unknown }).type;
          if (type === 'text-delta') {
            // fullStream 的 text-delta 使用 text字段；兼容旧版本的 textDelta / delta
            const chunk: string =
              (part as any).text ?? (part as any).textDelta ?? (part as any).delta ?? '';
            if (chunk.length > 0) {
              fullText += chunk;
              callbacks.onChunk?.(chunk);
            }
          } else if (type === 'reasoning-delta') {
            const delta: string = (part as any).text ?? (part as any).delta ?? '';
            if (delta.length > 0) {
              reasoningText += delta;
              callbacks.onReasoning?.(delta);
            }
          } else if (type === 'error') {
            // fullStream 以 error part 形式暴露流内错误，转为抛出以走统一错误处理
            const errorPart = part as { error?: unknown; errorText?: unknown };
            throw errorPart.error instanceof Error
              ? errorPart.error
              : new Error(
                  typeof errorPart.errorText === 'string'
                    ? errorPart.errorText
                    : String(errorPart.error ?? 'stream error'),
                );
          }
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

      // reasoning可能仅在结果汇总中给出（未走 delta），此时回退读取 result.reasoningText
      let finalReasoning = reasoningText;
      if (!finalReasoning) {
        try {
          const promised = await (result as { reasoningText?: PromiseLike<string | undefined> }).reasoningText;
          if (typeof promised === 'string' && promised.length > 0) {
            finalReasoning = promised;
          }
        } catch {
          // 安全降级：拿不到 reasoning 不影响正文结果
        }
      }

      // v6 下 result.steps / result.toolCalls 是 Promise，需在流消费完后 await 才能取到
      // 已解析的步骤数组。native agent loop 依赖这里拿到结构化 toolCalls。
      let resolvedSteps: unknown;
      try {
        resolvedSteps = await (result as { steps?: PromiseLike<unknown> }).steps;
      } catch {
        resolvedSteps = undefined;
      }
      let resolvedToolCalls: unknown;
  try {
        resolvedToolCalls = await (result as { toolCalls?: PromiseLike<unknown> }).toolCalls;
      } catch {
        resolvedToolCalls = undefined;
      }
      const resolvedResult = { steps: resolvedSteps, toolCalls: resolvedToolCalls };

      const response: LLMResponse = {
        text: fullText,
        usage: normalizeUsage(usage),
        finishReason: normalizedFinish,
        toolCalls: extractToolCalls(resolvedResult),
          steps: extractSteps(resolvedResult),
        ...(finalReasoning ? { reasoningText: finalReasoning } : {}),
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
          calls.push(normalizeToolCall(tc));
        }
          }
    }
  } else if (Array.isArray(result.toolCalls)) {
    // 没有 steps 时，直接从顶层取
    for (const tc of result.toolCalls) {
      calls.push(normalizeToolCall(tc));
    }
  }

  return calls.length > 0 ? calls : undefined;
}

/**
 * 归一化 SDK 的单条 tool call。
 *
 * v5/v6 工具调用对象用 `input` 承载参数、`toolCallId` 承载调用 ID；
 * 兼容旧字段 `args`。native agent loop 依赖 callId 匹配 tool-call 与 tool-result。
 */
function normalizeToolCall(tc: any): LLMToolCall {
  const args = (tc?.input ?? tc?.args ?? {}) as Record<string, unknown>;
  return {
    ...(typeof tc?.toolCallId === 'string' ? { callId: tc.toolCallId } : {}),
    toolName: tc?.toolName,
    args,
  };
}

/**
 * 从 generateText 结果中提取各步结果。
 */
function extractSteps(result: any): LLMStepResult[] | undefined {
  if (!Array.isArray(result.steps) || result.steps.length === 0) return undefined;

  return result.steps.map((step: any) => ({
    text: step.text ?? '',
    toolCalls: Array.isArray(step.toolCalls)
      ? step.toolCalls.map((tc: any) => normalizeToolCall(tc))
      : [],
    toolResults: Array.isArray(step.toolResults)
      ? step.toolResults.map((tr: any) => tr.result ?? tr)
      : [],
  }));
}
