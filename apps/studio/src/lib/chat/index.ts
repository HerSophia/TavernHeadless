/**
 * 第一方聊天客户端薄封装（B10 阶段 7）。
 *
 * 经 `@tavern/sdk` 收敛 studio 聊天所需的最小资源面：建会话 / 取时间线 / 重生（retry）。
 * 会话**选择**沿用共享的 context store（顶栏切换器）；流式发送见 `./stream`。
 * 刻意不复用 `apps/web` 的 workspace-api。
 */
import type {
  FloorRunRecord,
  PromptRuntimeHistoricalExplain,
  SessionDetail,
  SessionRecord,
  SessionRegenerateResult,
  SessionTimeline,
} from "@tavern/sdk";

import { apiClient } from "../sdk";

const accountIdHint: string | undefined = import.meta.env.VITE_ACCOUNT_ID || undefined;

export const chatApi = {
  createSession(projectId: string, title?: string): Promise<SessionRecord | null> {
    return apiClient.sessions.create({ projectId, title, accountId: accountIdHint });
  },
  getTimeline(sessionId: string): Promise<SessionTimeline> {
    return apiClient.sessions.timeline({ sessionId, accountId: accountIdHint });
  },
  regenerate(sessionId: string): Promise<SessionRegenerateResult> {
    return apiClient.sessions.regenerate({ sessionId, accountId: accountIdHint });
  },
  getSessionDetail(sessionId: string): Promise<SessionDetail> {
    return apiClient.sessions.getDetail({ sessionId, accountId: accountIdHint });
  },
  // —— trace 抽屉数据源（阶段 8）：均按 floorId、账号隔离，服务端默认裁剪受限内容 ——
  getFloorRun(floorId: string): Promise<FloorRunRecord> {
    return apiClient.floors.getRun({ floorId, accountId: accountIdHint });
  },
  getFloorExplain(floorId: string): Promise<PromptRuntimeHistoricalExplain> {
    return apiClient.promptRuntime.getFloorExplain({ floorId, accountId: accountIdHint });
  },
};

export * from "./stream";
export type {
  FloorRunRecord,
  FloorRunSnapshot,
  PromptRuntimeHistoricalExplain,
  RespondResult,
  SessionDetail,
  SessionRecord,
  SessionRegenerateResult,
  SessionTimeline,
  TimelineFloor,
  TimelineMessage,
  TimelinePage,
} from "@tavern/sdk";
