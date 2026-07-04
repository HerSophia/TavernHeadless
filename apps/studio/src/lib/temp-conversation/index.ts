/**
 * 第一方临时对话客户端薄封装（图临时对话助手 · 阶段 1）。
 *
 * 经 `@tavern/sdk`收敛图编辑器助手所需的最小资源面：基于 Project / Session 懒创建临时对话、
 * 读详情 / transcript、finalize / discard / cancel。创建默认带 TTL 保留策略（1 小时，
 * 用完即弃，过期由后端惰性回收）。
 *
 * 流式发送见 `./stream`。刻意不复用 apps/web 的 workspace-api；统一经第一方 SDK，
 * 鉴权与 baseUrl 随当前后端连接由 `lib/sdk` 注入。
 */
import type {
  TemporaryConversationRecord,
  TemporaryConversationTranscript,
} from "@tavern/sdk";

import { apiClient } from "../sdk";

const accountIdHint: string | undefined = import.meta.env.VITE_ACCOUNT_ID || undefined;

/** 图助手临时对话默认 TTL（秒）：1 小时。 */
export const GRAPH_ASSISTANT_TTL_SECONDS = 3600;
/** 图助手临时对话用途标记（后端 purpose 必填，1-120 字符）。 */
export const GRAPH_ASSISTANT_PURPOSE = "graph-assistant";

export const tempConversationApi = {
  /** 基于 Project 懒创建一段 client_visible 临时对话（默认 TTL 保留）。 */
  createFromProject(
    projectId: string,
    purpose: string,
    title?: string,
  ): Promise<TemporaryConversationRecord> {
    return apiClient.projects.createTemporaryConversation({
      projectId,
      accountId: accountIdHint,
      input: { purpose, title, retentionPolicy: "ttl", ttlSeconds: GRAPH_ASSISTANT_TTL_SECONDS },
    });
  },
  /** 基于 Session 懒创建一段 client_visible 临时对话（默认 TTL 保留）。 */
  createFromSession(
    sessionId: string,
    purpose: string,
    title?: string,
  ): Promise<TemporaryConversationRecord> {
    return apiClient.sessions.createTemporaryConversation({
      sessionId,
      accountId: accountIdHint,
      input: { purpose, title, retentionPolicy: "ttl", ttlSeconds: GRAPH_ASSISTANT_TTL_SECONDS },
    });
  },
  getDetail(conversationId: string): Promise<TemporaryConversationRecord> {
    return apiClient.temporaryConversations.getDetail({ conversationId, accountId: accountIdHint });
  },
  getTranscript(conversationId: string): Promise<TemporaryConversationTranscript> {
    return apiClient.temporaryConversations.getTranscript({ conversationId, accountId: accountIdHint });
  },
  finalize(conversationId: string): Promise<TemporaryConversationRecord> {
    return apiClient.temporaryConversations.finalize({ conversationId, accountId: accountIdHint });
  },
  discard(conversationId: string): Promise<TemporaryConversationRecord> {
    return apiClient.temporaryConversations.discard({ conversationId, accountId: accountIdHint });
  },
  cancel(conversationId: string): Promise<TemporaryConversationRecord> {
    return apiClient.temporaryConversations.cancel({ conversationId, accountId: accountIdHint });
  },
};

export * from "./stream";
export type {
  TemporaryConversationGenerationParams,
  TemporaryConversationIrreversibleSideEffect,
  TemporaryConversationReasoningEffort,
  TemporaryConversationRecord,
  TemporaryConversationResult,
  TemporaryConversationRetryStepResult,
  TemporaryConversationStatus,
  TemporaryConversationTranscript,
  TemporaryConversationTranscriptFloor,
  TemporaryConversationTranscriptMessage,
  TemporaryConversationTranscriptPage,
  TemporaryConversationToolTransportPreference,
} from "@tavern/sdk";
