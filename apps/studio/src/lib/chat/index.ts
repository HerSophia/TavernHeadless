/**
 * 第一方聊天客户端薄封装（B10 阶段 7）。
 *
 * 经 `@tavern/sdk` 收敛 studio 聊天所需的最小资源面：建会话 / 取时间线 / 重生（retry）。
 * 会话**选择**沿用共享的 context store（顶栏切换器）；流式发送见 `./stream`。
 * 刻意不复用 `apps/web` 的 workspace-api。
 */
import type {
  CommittedContentManualRevisionTimeline,
  FloorRetryStepResult,
  FloorRunRecord,
  PageRecord,
  PromptRuntimeHistoricalExplain,
  RegenerateResult,
  SessionActiveRunRecord,
  SessionDetail,
  SessionRecord,
  SessionRegenerateResult,
  SessionScopeResult,
  SessionTimeline,
} from "@tavern/sdk";

import { apiClient } from "../sdk";
import { buildCreateSessionOptions, type CreateSessionInput } from "./create-session";

const accountIdHint: string | undefined = import.meta.env.VITE_ACCOUNT_ID || undefined;

/** 会话生命周期状态（改名 / 归档共用）。 */
export type SessionStatus = "active" | "archived";

/** 批量结果类型从 SDK 方法返回派生，避免依赖 SDK 具名类型导出。 */
export type SessionsBatchUpdateStatusResult = Awaited<
  ReturnType<typeof apiClient.sessions.batchUpdateStatus>
>;
export type SessionsBatchDeleteResult = Awaited<ReturnType<typeof apiClient.sessions.batchDelete>>;

/** 有效配置视图类型从 SDK 方法返回派生（SDK 根 barrel 未导出该具名类型）。 */
export type SessionEffectiveConfigView = Awaited<
  ReturnType<typeof apiClient.sessions.getEffectiveConfig>
>;

export const chatApi = {
  /**
   * 建会话（SC2-4）：可选透传绑定入参（角色卡 / 预设 / 世界书 / 正则档 + promptMode / syncPolicy）。
   * 空 `input` 等价于原「建空会话」（仅 projectId + accountId），保持向后兼容。
   */
  createSession(projectId: string, input?: CreateSessionInput): Promise<SessionRecord | null> {
    return apiClient.sessions.create({
      ...buildCreateSessionOptions(projectId, input),
      accountId: accountIdHint,
    });
  },
  // —— SC1-2 会话生命周期写操作（单条走 update/remove，多选走 batch*） ——
  renameSession(sessionId: string, title: string): Promise<SessionRecord> {
    return apiClient.sessions.update({ sessionId, title, accountId: accountIdHint });
  },
  setSessionStatus(sessionId: string, status: SessionStatus): Promise<SessionRecord> {
    return apiClient.sessions.update({ sessionId, status, accountId: accountIdHint });
  },
  deleteSession(sessionId: string): Promise<boolean> {
    return apiClient.sessions.remove({ sessionId, accountId: accountIdHint });
  },
  batchSetSessionStatus(
    ids: string[],
    status: SessionStatus,
  ): Promise<SessionsBatchUpdateStatusResult> {
    return apiClient.sessions.batchUpdateStatus({ ids, status, accountId: accountIdHint });
  },
  batchDeleteSessions(ids: string[]): Promise<SessionsBatchDeleteResult> {
    return apiClient.sessions.batchDelete({ ids, accountId: accountIdHint });
  },
  /**
   * 取时间线。可选分页参数 { limit, offset, branchId }：
   * 后端为 committed 楼层、按 floor_no 升序（最旧在前）、offset 从最旧计。
   * 无参调用向后兼容（等价于 SDK 默认 branch_id=main）。
   */
  getTimeline(
    sessionId: string,
    opts?: { limit?: number; offset?: number; branchId?: string },
  ): Promise<SessionTimeline> {
    return apiClient.sessions.timeline({ sessionId, accountId: accountIdHint, ...opts });
  },
  regenerate(sessionId: string): Promise<SessionRegenerateResult> {
    return apiClient.sessions.regenerate({ sessionId, accountId: accountIdHint });
  },
  // —— SC1-7 编辑用户消息并重生：服务端新开分支重生，返回含新 branchId 的 RegenerateResult ——
  // 本期只接 messageId + content；branchId 由服务端自动生成（保留可选扩展位备后续分支专项）。
  editAndRegenerate(
    messageId: string,
    content: string,
    branchId?: string,
  ): Promise<RegenerateResult> {
    return apiClient.messages.editAndRegenerate({
      messageId,
      content,
      branchId,
      accountId: accountIdHint,
    });
  },
  // —— 编辑助手（LLM）回复内容：人工修订（manual-revision）就地改写已提交内容，不触发重生 ——
  // getMessageRevisions 返回 latestRevisionNo（乐观锁基线）+ 当前内容 / token；
  // createMessageRevision 以 expectedLatestRevisionNo 作乐观锁，不符后端抛 409 manual_revision_conflict。
  getMessageRevisions(messageId: string): Promise<CommittedContentManualRevisionTimeline> {
    return apiClient.messages.getManualRevisions({ messageId, accountId: accountIdHint });
  },
  createMessageRevision(
    messageId: string,
    content: string,
    expectedLatestRevisionNo: number,
    reason?: string,
  ): Promise<CommittedContentManualRevisionTimeline> {
    return apiClient.messages.createManualRevision({
      messageId,
      content,
      expectedLatestRevisionNo,
      reason,
      accountId: accountIdHint,
    });
  },
  // —— SC1-6 楼层重跑：对任意 committed 楼层原地重跑 / 从指定步（1-based）重跑 ——
  // 本期只接必要入参；confirmedExecutionIds 等高级参数走服务端默认（薄封装保留可选扩展位）。
  retryFloor(floorId: string): Promise<RegenerateResult> {
    return apiClient.floors.retry({ floorId, accountId: accountIdHint });
  },
  retryFloorStep(floorId: string, fromStepIndex: number): Promise<FloorRetryStepResult> {
    return apiClient.floors.retryStep({ floorId, fromStepIndex, accountId: accountIdHint });
  },
  // —— SC1-5 运行态感知：读取会话当前 active-run（busy / publicPhase / activeRunType / latestFloorId） ——
  getActiveRun(sessionId: string): Promise<SessionActiveRunRecord> {
    return apiClient.sessions.getActiveRun({ sessionId, accountId: accountIdHint });
  },
  // —— SC1-8 翻页 / swipes：取某楼层全部页（含各槽位所有版本，用于构建 swipe），并激活指定页 ——
  // 时间线只返回活跃页，swipe 备选须经 pages.list 单独取；activate 后同槽位其他版本自动置为非活跃。
  listFloorPages(floorId: string): Promise<PageRecord[]> {
    return apiClient.pages.list({ floorId, accountId: accountIdHint });
  },
  activatePage(pageId: string): Promise<PageRecord> {
    return apiClient.pages.activate({ pageId, accountId: accountIdHint });
  },
  getSessionDetail(sessionId: string): Promise<SessionDetail> {
    return apiClient.sessions.getDetail({ sessionId, accountId: accountIdHint });
  },
  // —— SC1-3 会话信息面板只读数据源：detail 为必需，下面两者为增强（失败可降级） ——
  getSessionEffectiveConfig(sessionId: string): Promise<SessionEffectiveConfigView> {
    return apiClient.sessions.getEffectiveConfig({ sessionId, accountId: accountIdHint });
  },
  getSessionScope(sessionId: string): Promise<SessionScopeResult> {
    return apiClient.sessions.getScope({ sessionId, accountId: accountIdHint });
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
export {
  buildCreateSessionOptions,
  type CreateSessionInput,
  type CreateSessionOptions,
} from "./create-session";
export type {
  CommittedContentManualRevisionTimeline,
  FloorIrreversibleSideEffect,
  FloorRetryStepResult,
  FloorRunRecord,
  FloorRunSnapshot,
  PageKind,
  PageRecord,
  PromptRuntimeHistoricalExplain,
  RegenerateResult,
  RespondResult,
  SessionActiveRunRecord,
  SessionActiveRunSummary,
  SessionCharacterBinding,
  SessionCharacterSyncPolicy,
  SessionDetail,
  SessionPromptMode,
  SessionRecord,
  SessionRegenerateResult,
  SessionScopeResult,
  SessionTimeline,
  SessionUserBinding,
  TimelineFloor,
  TimelineMessage,
  TimelinePage,
} from "@tavern/sdk";
