/**
 * 图编辑器临时对话流式发送薄封装（图临时对话助手 · 阶段 1）。
 *
 * 复用 `@tavern/sdk` 的 `temporaryConversations.respondStream`（其内部已处理 SSE 解析与
 * start/chunk/run/summary/tool/error/done 事件），收敛成图助手所需的最小回调面：
 * 开始（floorNo）/ 正文增量 chunk / 错误，并透传 AbortSignal 支持中断。
 *
 * 与 `lib/chat/stream.ts` 同构；统一经第一方 SDK，不旁路 apps/web 的 workspace-api。
 */
import type {
  RespondStreamCallbacks,
  TemporaryConversationGenerationParams,
  TemporaryConversationResult,
  TemporaryConversationRetryStepResult,
  TemporaryConversationToolTransportPreference,
} from "@tavern/sdk";

import { apiClient } from "../sdk";

const accountIdHint: string | undefined = import.meta.env.VITE_ACCOUNT_ID || undefined;

/**
 * 流式期间的工具调用事件（薄客户端归一化，去掉 SDK 类型耦合）。
 * 同一 executionId 可能先后报 start / success 等不同 phase，调用方按 executionId 合并。
 */
export interface TempStreamToolEvent {
  executionId: string;
  toolName: string;
  phase: string;
  providerId: string;
  sideEffectLevel?: string;
  durationMs?: number;
  args?: Record<string, unknown>;
  message?: string;
}

/**
 * 流式期间的一条中间叙述（native 多步循环旁路）。
 * 同一 stepIndex 覆盖、新 stepIndex 追加，供进行中楼层卡片在工具组前显示。
 */
export interface TempStreamStepNarration {
  stepIndex: number;
  text: string;
  createdAt: number;
}

export interface TempStreamCallbacks {
  /** 流开始：携带后端分配的 floorNo（可能为空）。 */
  onStart?: (floorNo: number | null) => void;
  /** 正文增量（已是 delta，调用方自行累加）。 */
  onChunk?: (delta: string) => void;
  /**
   * 推理（思维链）增量（已是 delta，调用方自行累加）。
   * 仅当模型在生成过程中产出 reasoning 时触发；模型不返回则不触发。
   */
  onReasoning?: (delta: string) => void;
  /**
   * 中间叙述事件（native 多步循环；某步触发工具调用且产出可见文本时上报）。
   * 供进行中楼层卡片在工具组前显示。
   */
  onStepNarration?: (narration: TempStreamStepNarration) => void;
  /** 工具调用事件（流式期间逐条上报，供进行中楼层卡片显示）。 */
  onTool?: (event: TempStreamToolEvent) => void;
  onError?: (message: string) => void;
}

export interface StreamTempRespondParams {
  conversationId: string;
  message: string;
  /**
   * 本回合的动态上下文文本（图助手·提示词阶段二）。
   * 由调用方按当前画布状态求值生成，随本回合注入 prompt，不写入 transcript。
  */
    dynamicContext?: string;
    /**
     * 本回合的生成参数覆盖（推理强度、温度、Top-P、最大输出/上下文 token 等）。
     * 由调用方按图助手设置组装；未设置的字段不下发，由后端/模型默认值生效。
     */
    generationParams?: TemporaryConversationGenerationParams;
    /**
     * 本回合的工具调用协议偏好（自动 /原生 / 文本协议）。
     * 不传或传 `auto` 表示按模型能力自动选；随本回合下发。
     */
    toolTransportPreference?: TemporaryConversationToolTransportPreference;
signal?: AbortSignal;
  callbacks?: TempStreamCallbacks;
}

/**
 * 把图助手最小回调面转成 SDK 流式回调（respond / retry / retryStep 三路共用）。
 *
 * SDK 三个流式方法都接受同一套 `RespondStreamCallbacks`，因此这里统一构造一次，
 * 避免 start/chunk/reasoning/narration/tool/error 的映射在多处重复。
 */
function buildSdkStreamHandlers(callbacks?: TempStreamCallbacks): RespondStreamCallbacks {
  return {
    onStart: (payload) => callbacks?.onStart?.(payload.floorNo ?? null),
    onChunk: (payload) => callbacks?.onChunk?.(payload.chunk),
    onReasoning: (payload) => callbacks?.onReasoning?.(payload.delta),
    onStepNarration: (payload) =>
      callbacks?.onStepNarration?.({
        stepIndex: payload.stepIndex,
        text: payload.text,
        createdAt: payload.createdAt,
      }),
    onTool: (payload) =>
      callbacks?.onTool?.({
        executionId: payload.executionId,
        toolName: payload.toolName,
        phase: payload.phase,
        providerId: payload.providerId,
        sideEffectLevel: payload.sideEffectLevel,
        durationMs: payload.durationMs,
        args: payload.args,
        message: payload.message,
      }),
    onError: (payload) => callbacks?.onError?.(payload.message ?? payload.code ?? "stream_error"),
  };
}

/** 发送一条用户消息并流式接收助手正文；resolve 为最终结果。 */
export function streamTempRespond(
  params: StreamTempRespondParams,
): Promise<TemporaryConversationResult> {
  return apiClient.temporaryConversations.respondStream({
    conversationId: params.conversationId,
    inputMessage: { role: "user", content: params.message },
    ...(params.dynamicContext ? { dynamicContext: params.dynamicContext } : {}),
    ...(params.generationParams ? { generationParams: params.generationParams } : {}),
    ...(params.toolTransportPreference
      ? { toolTransportPreference: params.toolTransportPreference }
      : {}),
    accountId: accountIdHint,
    signal: params.signal,
    ...buildSdkStreamHandlers(params.callbacks),
  });
}

/** floor级重试的入参：在指定楼层上开新消息页版本，重跑整轮。 */
export interface StreamTempRetryParams {
  conversationId: string;
  /** 目标楼层 id（必须属于本临时对话）。 */
  floorId: string;
  /** 本回合动态上下文文本；随本回合注入 prompt，不写入 transcript。 */
  dynamicContext?: string;
  /** 本回合生成参数覆盖；未设置的字段不下发。 */
  generationParams?: TemporaryConversationGenerationParams;
  /** 已确认可回放的工具执行 id 列表（图助手确认闸）。 */
  confirmedExecutionIds?: string[];
  /** 已确认可回放的会话状态变更 id 列表。 */
  confirmedSessionStateMutationIds?: string[];
  signal?: AbortSignal;
  callbacks?: TempStreamCallbacks;
}

/** 在指定楼层上开新消息页版本重跑整轮，并流式接收正文；resolve 为最终结果。 */
export function streamTempRetry(
  params: StreamTempRetryParams,
): Promise<TemporaryConversationResult> {
  return apiClient.temporaryConversations.retryStream({
    conversationId: params.conversationId,
    floorId: params.floorId,
    ...(params.dynamicContext ? { dynamicContext: params.dynamicContext } : {}),
    ...(params.generationParams ? { generationParams: params.generationParams } : {}),
 ...(params.confirmedExecutionIds ? { confirmedExecutionIds: params.confirmedExecutionIds } : {}),
    ...(params.confirmedSessionStateMutationIds
      ? { confirmedSessionStateMutationIds: params.confirmedSessionStateMutationIds }
     : {}),
    accountId:accountIdHint,
    signal: params.signal,
    ...buildSdkStreamHandlers(params.callbacks),
  });
}

/** step 级重试的入参：在 floor 级基础上追加起始步号。 */
export interface StreamTempRetryStepParams extends StreamTempRetryParams {
  /** 从第几步重生成（1-based，后端按 generation_step_no 解释）。 */
  fromStepIndex: number;
}

/** 从指定步重生成（保留前缀工具往返），并流式接收正文；resolve 为携副作用清单的结果。 */
export function streamTempRetryStep(
  params: StreamTempRetryStepParams,
): Promise<TemporaryConversationRetryStepResult> {
  return apiClient.temporaryConversations.retryStepStream({
    conversationId: params.conversationId,
    floorId: params.floorId,
    fromStepIndex: params.fromStepIndex,
    ...(params.dynamicContext ? { dynamicContext: params.dynamicContext } : {}),
    ...(params.generationParams ? { generationParams: params.generationParams } : {}),
    ...(params.confirmedExecutionIds ? { confirmedExecutionIds: params.confirmedExecutionIds } : {}),
    ...(params.confirmedSessionStateMutationIds
      ? { confirmedSessionStateMutationIds: params.confirmedSessionStateMutationIds }
      : {}),
    accountId: accountIdHint,
    signal: params.signal,
    ...buildSdkStreamHandlers(params.callbacks),
 });
}

