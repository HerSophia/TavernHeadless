/**
 * 图编辑器临时对话流式发送薄封装（图临时对话助手 · 阶段 1）。
 *
 * 复用 `@tavern/sdk` 的 `temporaryConversations.respondStream`（其内部已处理 SSE 解析与
 * start/chunk/run/summary/tool/error/done 事件），收敛成图助手所需的最小回调面：
 * 开始（floorNo）/ 正文增量 chunk / 错误，并透传 AbortSignal 支持中断。
 *
 * 与 `lib/chat/stream.ts` 同构；统一经第一方 SDK，不旁路 apps/web 的 workspace-api。
 */
import type { TemporaryConversationResult } from "@tavern/sdk";

import { apiClient } from "../sdk";

const accountIdHint: string | undefined = import.meta.env.VITE_ACCOUNT_ID || undefined;

export interface TempStreamCallbacks {
  /** 流开始：携带后端分配的 floorNo（可能为空）。 */
  onStart?: (floorNo: number | null) => void;
  /** 正文增量（已是 delta，调用方自行累加）。 */
  onChunk?: (delta: string) => void;
  onError?: (message: string) => void;
}

export interface StreamTempRespondParams {
  conversationId: string;
  message: string;
  signal?: AbortSignal;
  callbacks?: TempStreamCallbacks;
}

/** 发送一条用户消息并流式接收助手正文；resolve 为最终结果。 */
export function streamTempRespond(
  params: StreamTempRespondParams,
): Promise<TemporaryConversationResult> {
  const { callbacks } = params;
  return apiClient.temporaryConversations.respondStream({
    conversationId: params.conversationId,
    inputMessage: { role: "user", content: params.message },
    accountId: accountIdHint,
    signal: params.signal,
    onStart: (payload) => callbacks?.onStart?.(payload.floorNo ?? null),
    onChunk: (payload) => callbacks?.onChunk?.(payload.chunk),
    onError: (payload) => callbacks?.onError?.(payload.message ?? payload.code ?? "stream_error"),
  });
}
