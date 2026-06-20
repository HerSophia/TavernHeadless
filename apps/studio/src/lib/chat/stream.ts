/**
 * 聊天流式发送薄封装（B10 阶段 7）。
 *
 * 直接复用 `@tavern/sdk` 的 `sessions.respondStream`（其内部已处理 SSE 解析与
 * start/chunk/run/summary/tool/error/done 事件），这里把它收敛成 studio 需要的最小回调面：
 * 开始（floorNo）/ 正文增量 chunk / 公开阶段 phase / 工具 / 错误，并透传 AbortSignal 支持中断。
 *
 * 不复用 `apps/web` 的 workspace-api；统一经第一方 SDK。
 */
import type {
  RespondResult,
  TavernRespondStartPayload,
  TavernRespondToolPayload,
} from "@tavern/sdk";

import { apiClient } from "../sdk";

const accountIdHint: string | undefined = import.meta.env.VITE_ACCOUNT_ID || undefined;

/** floor run 的公开阶段（与后端一致，trace 抽屉阶段 8 复用同口径）。 */
export type ChatStreamPhase =
  | "preparing"
  | "generating"
  | "verifying"
  | "committing"
  | "post_processing";

export interface ChatStreamCallbacks {
  onStart?: (payload: TavernRespondStartPayload) => void;
  /** 正文增量（已是 delta，调用方自行累加）。 */
  onChunk?: (delta: string) => void;
  onPhase?: (phase: ChatStreamPhase) => void;
  onTool?: (payload: TavernRespondToolPayload) => void;
  onError?: (message: string) => void;
}

export interface StreamRespondParams {
  sessionId: string;
  message: string;
  branchId?: string;
  callbacks?: ChatStreamCallbacks;
  signal?: AbortSignal;
}

/** 发送一条用户消息并流式接收 narrator 正文；resolve 为最终 floor 结果。 */
export function streamRespond(params: StreamRespondParams): Promise<RespondResult> {
  const { callbacks } = params;
  return apiClient.sessions.respondStream({
    sessionId: params.sessionId,
    message: params.message,
    branchId: params.branchId,
    accountId: accountIdHint,
    signal: params.signal,
    onStart: (payload) => callbacks?.onStart?.(payload),
    onChunk: (payload) => callbacks?.onChunk?.(payload.chunk),
    onRun: (payload) => callbacks?.onPhase?.(payload.publicPhase),
    onTool: (payload) => callbacks?.onTool?.(payload),
    onError: (payload) => callbacks?.onError?.(payload.message ?? payload.code ?? "stream_error"),
  });
}
