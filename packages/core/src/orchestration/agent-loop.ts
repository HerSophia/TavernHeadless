import type { CoreEventBus } from '../events/index.js';
import type { ChatMessage } from '../prompt/types.js';
import type {
  InstanceSlot,
  LLMMessage,
  ModelTextPart,
  ModelToolResultOutput,
  TokenUsage,
} from '../llm/types.js';
import { isPlainTextModelMessage } from '../llm/types.js';
import type {
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolPermissions,
  ToolSideEffectLevel,
} from '../tools/types.js';
import type { ToolExecutor } from '../tools/tool-executor.js';
import type { ToolCallParseDiagnostic, ToolCallParseStats } from '../tools/transport/index.js';

// ── 确认决策（场景无关） ──────────────────────────────
//
// 本循环骨架不绑定「图助手」这个名字或场景：确认决策由调用方以回调注入，
// core 只消费回调结果，不反向依赖任何上层服务。将来主链路接确认闸时可直接复用。

/**
 * 单个工具的执行前确认决策。
 *
 * - `auto`：直接执行，结果喂回循环上下文，继续多轮。
 * - `confirm`：不执行，登记待确认并暂停，等待用户批准。
 */
export type ToolConfirmationDecision = 'auto' | 'confirm';

/** 确认决策回调的输入上下文。 */
export interface ToolConfirmationContext {
  toolName: string;
  args: Record<string, unknown>;
  callId: string;
  floorId: string;
  pageId?: string;
  /** 当前是第几个生成步（1-based）。 */
  stepIndex: number;
}

/**
 * 确认决策回调。
 *
 * 由上层（如 apps/api）注入，决策来源不在 core 范围内。
 * core 不反向依赖上层服务，只消费回调结果。
 */
export type ToolConfirmationDecider = (
  ctx: ToolConfirmationContext,
) => ToolConfirmationDecision | Promise<ToolConfirmationDecision>;

// ── 统一工具调用 ──────────────────────────────────────

/** 经传输适配归一化后的单个工具调用。 */
export interface NormalizedToolCall {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
}

// ── 单步生成回调 ──────────────────────────────────────

/** 单步生成回调输入。 */
export interface AgentLoopStepInput {
  /** 当前累计的对话上下文（含此前轮次的 assistant 输出与工具结果）。 */
  messages: LLMMessage[];
  /** 当前是第几个生成步（1-based）。 */
  stepIndex: number;
}

/** 单步生成回调输出。 */
export interface AgentLoopStepOutput {
  /** 去除工具调用块后的可见文本（用于落库 / 展示）。 */
  visibleText: string;
  /** 原始模型输出文本（文本协议用于解析 `<tool_call>`）。 */
  rawText: string;
  usage: TokenUsage;
  finishReason: string;
  summaries: string[];
  /**
   * native 传输：模型本步请求的结构化工具调用。
   *
   * 文本协议不填此字段（调用从 rawText 解析）。
   */
  toolCalls?: NormalizedToolCall[];
}

/** 由上层（TurnOrchestrator）提供的单步生成实现。 */
export type AgentLoopGenerate = (input: AgentLoopStepInput) => Promise<AgentLoopStepOutput>;

// ── 循环结果 ──────────────────────────────────────────

/** 循环停止原因。 */
export type AgentLoopStopReason =
  | 'natural_stop'
  | 'awaiting_confirmation'
  | 'max_steps'
  | 'invalid_format_stop';

/**
 * 连续「只产出无法解析的 tool_call、没有任何有效调用」步数的上限。
 *
 * 模型本想调用工具但格式写错时，会被回填一段纠正反馈续跑。若连续多步仍只产出
 * 无效块，则以 `invalid_format_stop` 收敛停止，避免无意义的循环消耗。
 * 仅文本协议会触发；native 不产生解析诊断。
 */
export const MAX_CONSECUTIVE_INVALID_STEPS = 2;

/**
 * 单步生成的结构化记录（按真实步序保留）。
 *
 * 循环出口的 `visibleText` 把多步文本 join 成单串，丢失了步序边界。本记录保留
 * 每步的可见文本与「该步是否触发了工具调用」，供调用方区分「中间叙述步」与
 * 「最终结论步」：native 多步循环里，触发工具的步其文本是动作预告（中间叙述），
 * 最后一个未触发工具、自然结束的步其文本才是最终回答。
 */
export interface AgentLoopStepRecord {
  /** 步序（1-based）。 */
  stepIndex: number;
  /** 该步去除工具块后的可见文本（已 trim）。 */
  visibleText: string;
  /** 该步是否请求了工具调用（区分中间叙述步与最终结论步）。 */
  hasToolCalls: boolean;
  /**
   * 该步生成完成时刻（毫秒）。
   *
   * 供下游旁路展示作时序排序键：中间叙述步先于其发起的工具调用产出，
   * 用此时刻能把叙述排在对应工具组之前。
   */
  createdAt: number;
}

/**
 * 从步记录序列里挑出「最终回答文本」。
 *
 * 规则：从后往前找第一条「未触发工具调用且可见文本非空」的步——这是模型在所有
 * 工具完成后的总结发言。找不到（例如每步都带工具调用）时回退到最后一条非空可见
 * 文本；都为空则返回空串。
 */
export function selectFinalAnswerText(stepRecords: readonly AgentLoopStepRecord[]): string {
  for (let i = stepRecords.length - 1; i >= 0; i -= 1) {
    const record = stepRecords[i];
    if (record && !record.hasToolCalls && record.visibleText.length > 0) {
      return record.visibleText;
    }
  }
  for (let i = stepRecords.length - 1; i >= 0; i -= 1) {
    const record = stepRecords[i];
    if (record && record.visibleText.length > 0) {
      return record.visibleText;
    }
  }
  return '';
}

/**暂停时登记的待确认工具调用信息。 */
export interface AgentLoopPendingConfirmation {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  sideEffectLevel?: ToolSideEffectLevel;
}

/** 循环执行结果。 */
export interface AgentLoopResult {
  stopReason: AgentLoopStopReason;
  /** 跨步累计的可见文本（按步以空行连接）。 */
  visibleText: string;
  summaries: string[];
  totalUsage: TokenUsage;
  /** 实际执行的生成步数。 */
  steps: number;
  /**
   * 按步保留的结构化记录（每步可见文本 + 是否触发工具）。
   *
   * 供调用方用 selectFinalAnswerText 挑出最终回答、以及后续旁路落库中间叙述。
   */
  stepRecords: AgentLoopStepRecord[];
  /**
   * 累计的工具结果写回块（auto 工具执行后的 `<tool_result>` 文本）。
   *
   * 仅文本协议产生；native 不向 transcript 写回工具结果，故缺省。
   */
  toolResultWritebackText?: string;
  /** 暂停时的待确认调用（仅 stopReason='awaiting_confirmation' 时存在）。 */
  pendingConfirmation?: AgentLoopPendingConfirmation;
  /**
   * 暂停 / 停止时的完整对话上下文，供 apps/api 持久化以支持续跑。
   *
   * 文本协议路径为纯文本消息；native 路径含结构化工具往返消息。
   */
  conversationMessages: LLMMessage[];
  /** 跨步聚合的解析统计。 */
  parsing: ToolCallParseStats & {
    diagnostics: ToolCallParseDiagnostic[];
  };
}

/** 循环执行输入。 */
export interface AgentLoopRunInput {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  /** 初始对话上下文（已拼装好的 messages，纯文本）。 */
  initialMessages: LLMMessage[];
  /** 本轮可见的工具（auto 与 confirm 都暴露）。 */
  tools: ToolDefinition[];
  toolContext: ToolExecutionContext;
  permissions: ToolPermissions;
  toolExecutor: ToolExecutor;
  /** 单步生成实现。 */
  generate: AgentLoopGenerate;
  /** 确认决策回调。 */
  decideConfirmation: ToolConfirmationDecider;
  /**
   * 批准后续跑：在进入生成循环前先执行这个已批准的（原为 confirm 的）工具调用，
   * 把结果回填进上下文，再从该上下文继续多轮生成。
   *
   * 仅由上层「批准后续跑」路径传入；首次生成不传。
   */
  resumeApprovedCall?: {
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
  };
  /**
   * step 重试：已完成的前缀工具往返（按 stepIndex 升序）。
   *
   * 进入生成循环前，loop 把这些往返按 transport.buildStepMessages 拼进上下文、
   * 计入 stepIndex 基线与 stepRecords，再从下一步重启生成。保留前缀已成功工具结果、
   * 从指定步重生成。与 resumeApprovedCall 互斥（两者同时传入会报错）。
   *
   * 仅由上层 step 重试路径传入；首次生成不传。
   */
  priorRoundtrips?: AgentLoopPriorRoundtrip[];
  /** 最大生成步数（复用 maxStepsPerGeneration 语义）。 */
  maxSteps: number;
  abortSignal?: AbortSignal;
}

// ── 传输适配 ──────────────────────────────────────────

/** auto 执行后的单条工具结果。 */
export interface AgentLoopExecutedCall {
 call: NormalizedToolCall;
  coercedArgs: Record<string, unknown>;
  result: ToolCallResult;
}

/**前缀往返中单个已完成的工具调用（含执行结果）。 */
export interface AgentLoopPriorRoundtripCall {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: ToolCallResult;
}

/**
 * 一个已完成的前缀生成步往返（用于 step 重试）。
 *
 * 表示「重试起点之前、已经成功生成并执行过工具」的某一步：含该步的可见文本
 * 与该步触发的全部工具调用结果。loop 在进入生成循环前会把这些往返按 transport
 * 的 buildStepMessages 重新拼进上下文，从而保留前缀已成功工具结果，再从下一步重启生成。
 */
export interface AgentLoopPriorRoundtrip {
  /** 该步在原次生成中的步号（仅用于按序还原，最终 stepRecords 会连续重新编号）。 */
  stepIndex: number;
  /** 该步去除工具块后的可见文本（中间叙述），可空。 */
visibleText?:string;
  /** 该步触发并已执行的工具调用（按调用顺序）。 */
  calls:AgentLoopPriorRoundtripCall[];
}

/**
 * 传输适配：把与具体协议强绑定的三处行为抽出来。
 *
 * - 生成：由上层 `generate` 回调按 transport 决定传不传 LLM 工具（不在本接口内）。
 * - 解析：`parseCalls` 从模型输出得到统一工具调用列表。
 * - 回填：`buildStepMessages` / `buildResumeMessages` 把工具往返转成续跑消息。
 */
export interface AgentLoopTransport {
  /** 从本步生成输出得到统一的工具调用列表与解析诊断。 */
  parseCalls(output: AgentLoopStepOutput, allowedToolNames: Set<string>): {
    calls: NormalizedToolCall[];
    diagnostics: ToolCallParseDiagnostic[];
    stats: ToolCallParseStats;
  };

  /** 还原工具调用参数类型（文本协议把字符串化 JSON 按 schema 还原；native 原样返回）。 */
  coerceArgs(call: NormalizedToolCall, tool: ToolDefinition | undefined): Record<string, unknown>;

  /**
   * 构造一个「请求了工具的生成步」之后要追加进上下文的消息。
   *
   * `executed` 为本步 auto 执行的 (call, result) 顺序列表；`paused` 表示遇到 confirm 暂停。
   * 文本协议返回 assistant 原文 + 合并的 user 工具结果块；
   * native 返回 assistant(tool-call parts) + tool(tool-result parts)，仅含已执行调用。
   */
  buildStepMessages(args: {
    output: AgentLoopStepOutput;
    executed: AgentLoopExecutedCall[];
    stepBlocks: string[];
    paused: boolean;
  }): LLMMessage[];

  /**
   * 构造「模型本想调用工具但格式写错」时的纠正反馈消息；不适用时返回 undefined。
   *
   *仅文本协议会用到；native 不产生解析诊断，返回 undefined。
   */
  buildInvalidFormatFeedback(
    output: AgentLoopStepOutput,
    diagnostics: ToolCallParseDiagnostic[],
  ): LLMMessage[] | undefined;

  /** 构造「批准后续跑」执行单个已批准调用后的回填消息。 */
  buildResumeMessages(
    call: NormalizedToolCall,
    coercedArgs: Record<string, unknown>,
    result: ToolCallResult,
  ): LLMMessage[];

  /**
   * 单条工具结果的可见 transcript 写回块（仅文本协议）。
   *
   * native 不向 transcript 写回工具结果，故不实现此方法。
   */
  formatWritebackBlock?(call: NormalizedToolCall, result: ToolCallResult): string;
}

// ── 工具函数 ──────────────────────────────────────────

function safeToken(value: unknown): number {
 if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.trunc(value);
}

export function addAgentLoopUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return{
    promptTokens: safeToken(a.promptTokens) + safeToken(b.promptTokens),
    completionTokens: safeToken(a.completionTokens) + safeToken(b.completionTokens),
    totalTokens: safeToken(a.totalTokens) + safeToken(b.totalTokens),
  };
}

export function zeroAgentLoopUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function stringifyToolResultOutput(output: ModelToolResultOutput): string {
  if (output.type === 'json') {
    try {
      return JSON.stringify(output.value);
    } catch {
      return String(output.value);
    }
  }
  return output.value;
}

/**
 * 把循环内部的（可能含结构化往返的）消息投影为纯文本 ChatMessage[]。
 *
 * 文本协议路径本就是纯文本，投影后不变；native 路径的结构化工具往返消息会被
 * 拍平为可读文本，仅用于持久化与审计（不用于续跑重建）。
 */
export function projectAgentLoopMessagesToChat(messages: LLMMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (isPlainTextModelMessage(message)) {
      return { role: message.role, content: message.content };
    }

    if (message.role === 'assistant') {
      const text = message.content
        .filter((part): part is ModelTextPart => part.type === 'text')
        .map((part) => part.text)
        .join('');
      return { role: 'assistant', content: text };
    }

    // tool 角色：把工具结果拍平为 user文本（仅审计用）。
    const text = message.content
      .map((part) => `tool_result(${part.toolName}): ${stringifyToolResultOutput(part.output)}`)
      .join('\n');
    return { role:'user', content: text };
  });
}

// ── 传输无关 + 场景无关的循环骨架 ─────────────────────

/**
 * 传输无关、场景无关的多轮 agent 循环骨架。
 *
 * 负责 while(steps<maxSteps)、调 `generate`、拿到本步的工具调用列表、逐个
 * `decideConfirmation`、auto 执行 + 回填、confirm 暂停登记、stopReason 收敛、
 * usage 累加与事件 emit；与传输强绑定的解析 / 回填交给 `transport` 适配。
 *
 * 依赖方向：core 不依赖 apps/api 与任何场景策略服务；auto/confirm 决策以回调注入。
 */
export async function runAgentLoop(
  input: AgentLoopRunInput,
  transport: AgentLoopTransport,
  eventBus: CoreEventBus,
): Promise<AgentLoopResult> {
  const allowedToolNames = new Set(input.tools.map((tool) => tool.name));
  const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool] as const));

  const messages: LLMMessage[] = [...input.initialMessages];
  const visibleParts: string[] = [];
  const stepRecords: AgentLoopStepRecord[] = [];
  const summaries: string[] = [];
  const writebackBlocks: string[] = [];
  const aggregatedDiagnostics: ToolCallParseDiagnostic[] = [];
let aggregatedBlockCount = 0;
  let aggregatedAcceptedCount = 0;
  let aggregatedRejectedCount = 0;
  let totalUsage = zeroAgentLoopUsage();
  let steps = 0;
  let stopReason: AgentLoopStopReason | undefined;
  let pendingConfirmation: AgentLoopPendingConfirmation | undefined;
  // 连续「只产出无效 tool_call 块」的步数；出现有效调用时归零。
  let consecutiveInvalidSteps = 0;

  const maxSteps = Math.max(1, Math.trunc(input.maxSteps));

  // resumeApprovedCall（批准后续跑）与 priorRoundtrips（step 重试前缀重启）语义互斥：
  // 前者是在生成前执行一个待确认工具，后者是预置一批已完成的工具往返，两者混用会产生歧义的起点。
  if (input.resumeApprovedCall && input.priorRoundtrips && input.priorRoundtrips.length > 0) {
    throw new Error('runAgentLoop: resumeApprovedCall 与 priorRoundtrips 不能同时传入');
  }

  // step 重试：预置已完成的前缀工具往返。按 stepIndex 升序重建上下文、计入步基线与
  // stepRecords，随后 while 循环从下一步（steps+1）重新生成。这些前缀步不调用 generate。
  if (input.priorRoundtrips && input.priorRoundtrips.length > 0) {
    const sortedRoundtrips = [...input.priorRoundtrips].sort((a, b) => a.stepIndex - b.stepIndex);
    for (const roundtrip of sortedRoundtrips) {
      const executed: AgentLoopExecutedCall[] = roundtrip.calls.map((call) => ({
        call: { callId: call.callId, toolName: call.toolName, args: call.args },
        coercedArgs: call.args,
        result: call.result,
      }));
      const visible = (roundtrip.visibleText ?? '').trim();
      // 合成一个「该步生成输出」，仅供 transport.buildStepMessages 拼装前缀往返使用。
      const syntheticOutput: AgentLoopStepOutput = {
        visibleText: roundtrip.visibleText ?? '',
        rawText: roundtrip.visibleText ?? '',
        usage: zeroAgentLoopUsage(),
        finishReason: 'tool_calls',
        summaries: [],
        toolCalls: executed.map((item) => item.call),
      };
      const stepBlocks: string[] = [];
      for (const item of executed) {
        const block = transport.formatWritebackBlock?.(item.call, item.result);
        if (block !== undefined) {
          stepBlocks.push(block);
          writebackBlocks.push(block);
        }
      }
      messages.push(
        ...transport.buildStepMessages({ output: syntheticOutput, executed, stepBlocks, paused: false }),
      );
      if (visible.length > 0) {
        visibleParts.push(visible);
      }
      steps += 1;
      stepRecords.push({
        stepIndex: steps,
        visibleText: visible,
        hasToolCalls: executed.length > 0,
        createdAt: Date.now(),
      });
    }
  }

  // 批准后续跑：先执行已批准的工具调用，把结果回填，再进入生成循环。
  // 这一步不计入生成步数（它是工具执行而非模型生成）。
  if (input.resumeApprovedCall) {
    const approved: NormalizedToolCall = {
      callId: input.resumeApprovedCall.callId,
      toolName: input.resumeApprovedCall.toolName,
      args: input.resumeApprovedCall.args,
    };
    const coercedArgs = transport.coerceArgs(approved, toolsByName.get(approved.toolName));
    const result = await input.toolExecutor.execute(
      approved.toolName,
      coercedArgs,
      input.toolContext,
      input.permissions,
    );
    const block = transport.formatWritebackBlock?.(approved, result);
    if (block !== undefined) {
      writebackBlocks.push(block);
    }
    messages.push(...transport.buildResumeMessages(approved, coercedArgs, result));
  }

  while (steps < maxSteps) {
    if (input.abortSignal?.aborted) {
      break;
    }

    steps += 1;
    const generation = await input.generate({
      messages: [...messages],
      stepIndex: steps,
    });

    totalUsage = addAgentLoopUsage(totalUsage, generation.usage);
    if (generation.summaries.length > 0) {
      summaries.push(...generation.summaries);
    }
    const visible = generation.visibleText.trim();
    if (visible.length > 0) {
      visibleParts.push(visible);
    }

    const parsed = transport.parseCalls(generation, allowedToolNames);
    aggregatedBlockCount += parsed.stats.blockCount;
    aggregatedAcceptedCount += parsed.stats.acceptedCount;
    aggregatedRejectedCount += parsed.stats.rejectedCount;
    if (parsed.diagnostics.length > 0) {
      aggregatedDiagnostics.push(...parsed.diagnostics);
    }

    // 按步记录：保留本步可见文本与是否触发工具调用（hasToolCalls 以有效调用为准，
    // 格式错误的无效块不算调用）。供 selectFinalAnswerText 挑出最终回答、旁路落库中间叙述。
    stepRecords.push({
      stepIndex: steps,
      visibleText: visible,
      hasToolCalls: parsed.calls.length > 0,
      createdAt: Date.now(),
    });

    if (parsed.calls.length === 0) {
      // 本步没有任何可执行调用。若存在解析诊断，说明模型本想调用工具但格式写错；
      // 此时不应误判为「自然结束」，而要把诊断翻译成可读反馈回填，引导下一步纠正。
      if (parsed.diagnostics.length > 0) {
        consecutiveInvalidSteps += 1;
        if (consecutiveInvalidSteps >= MAX_CONSECUTIVE_INVALID_STEPS) {
          stopReason = 'invalid_format_stop';
          break;
        }
        const feedback = transport.buildInvalidFormatFeedback(generation, parsed.diagnostics);
        if (feedback && feedback.length > 0) {
          messages.push(...feedback);
          continue;
        }
        // 适配未提供纠正反馈：按自然结束收尾。
        stopReason = 'natural_stop';
        break;
      }
      // 无诊断：模型确实没有尝试调用工具，按自然结束收尾。
      stopReason = 'natural_stop';
      break;
    }

    // 出现有效调用，连续无效步计数归零。
    consecutiveInvalidSteps = 0;

    const executed: AgentLoopExecutedCall[] = [];
    const stepBlocks: string[] = [];
    let paused = false;

    for (const call of parsed.calls) {
      const tool = toolsByName.get(call.toolName);
      const coercedArgs = transport.coerceArgs(call, tool);

      const decision = await input.decideConfirmation({
        toolName: call.toolName,
        args: coercedArgs,
        callId: call.callId,
        floorId: input.floorId,
        ...(input.pageId ? { pageId: input.pageId } : {}),
        stepIndex: steps,
});

      if (decision === 'confirm') {
        const sideEffectLevel = tool?.sideEffectLevel;
        pendingConfirmation = {
          callId:call.callId,
          toolName: call.toolName,
          args: coercedArgs,
          ...(sideEffectLevel ? { sideEffectLevel } : {}),
};

        await eventBus.emit('tool.call_awaiting_confirmation', {
          floorId: input.floorId,
          ...(input.pageId ? { pageId: input.pageId } : {}),
          callerSlot: input.callerSlot,
          callId: call.callId,
          ...(sideEffectLevel ? { sideEffectLevel } : {}),
          toolName: call.toolName,
          args: coercedArgs,
        });

        paused = true;
        break;
      }

      // auto：执行并把结果回填。
      // 注入当前生成步号（steps），让落库的工具执行记录带上 generation_step_no，支撑 step 级重试按步截断。
      const result = await input.toolExecutor.execute(
        call.toolName,
        coercedArgs,
        { ...input.toolContext, generationStepNo: steps },
        input.permissions,
      );
      executed.push({ call, coercedArgs, result });
      const block = transport.formatWritebackBlock?.(call, result);
      if (block !== undefined) {
        stepBlocks.push(block);
        writebackBlocks.push(block);
      }
    }

    messages.push(...transport.buildStepMessages({ output: generation, executed, stepBlocks, paused }));

    if (paused) {
      stopReason = 'awaiting_confirmation';
      break;
    }

    // 继续循环：下一步模型可看到本步工具结果
  }

  if (!stopReason) {
    stopReason = 'max_steps';
  }

  return {
    stopReason,
  visibleText: visibleParts.join('\n\n'),
    summaries,
    totalUsage,
    steps,
    stepRecords,
    ...(writebackBlocks.length > 0
      ? { toolResultWritebackText: writebackBlocks.join('\n\n') }
      : {}),
    ...(pendingConfirmation ? { pendingConfirmation } : {}),
    conversationMessages: messages,
    parsing: {
      blockCount: aggregatedBlockCount,
      acceptedCount: aggregatedAcceptedCount,
      rejectedCount: aggregatedRejectedCount,
      diagnostics: aggregatedDiagnostics,
   },
  };
}
