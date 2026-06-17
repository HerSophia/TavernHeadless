import type {
  FloorRunSnapshot,
  PromptRunIntent,
  TokenUsage,
  TurnConfig,
} from "@tavern/core";

import type {
  PromptLiveDebugOptions,
  RespondRuntimeToolEvent,
} from "./chat/contracts.js";
import type { GenerationParamsInput } from "../lib/llm-params.js";
import type {
  PromptDeliveryPolicy,
  PromptStructurePolicy,
} from "./prompt-assembler.js";

export const TEMPORARY_CONVERSATION_SESSION_KIND = "temporary" as const;
export const TEMPORARY_CONVERSATION_BRANCH_ID = "main" as const;

export const TEMPORARY_CONVERSATION_RETENTION_POLICIES = [
  "delete_on_finalize",
  "ttl",
  "keep_for_debug",
] as const;
export type TemporaryConversationRetentionPolicy =
  (typeof TEMPORARY_CONVERSATION_RETENTION_POLICIES)[number];

export const TEMPORARY_CONVERSATION_VISIBILITIES = [
  "internal",
  "client_visible",
] as const;
export type TemporaryConversationVisibility =
  (typeof TEMPORARY_CONVERSATION_VISIBILITIES)[number];

export const TEMPORARY_CONVERSATION_STATUSES = [
  "active",
  "finalized",
  "discarded",
  "expired",
  "cancelled",
] as const;
export type TemporaryConversationStatus =
  (typeof TEMPORARY_CONVERSATION_STATUSES)[number];

export interface TemporaryConversationResource {
  id: string;
  branchId: typeof TEMPORARY_CONVERSATION_BRANCH_ID;
  kind: typeof TEMPORARY_CONVERSATION_SESSION_KIND;
  title: string | null;
  status: TemporaryConversationStatus;
  purpose: string | null;
  workspaceId: string | null;
  projectId: string | null;
  sourceSessionId: string | null;
  retentionPolicy: TemporaryConversationRetentionPolicy;
  visibility: TemporaryConversationVisibility;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  expiresAt: number | null;
  finalizedAt: number | null;
  discardedAt: number | null;
  cancelledAt: number | null;
}

export interface TemporaryConversationHandle
  extends TemporaryConversationResource {
  conversationId: string;
}

/**
 * 临时对话的 Agent 来源血缘。
 *
 * R3 阶段五先以 metadata 下的 `agent_origin` 过渡存储（设计里允许的过渡方案）。
 * 是否拆成独立列（source_agent_run_id 等）由 T3 决定。字段名与 AgentLineageRef 保持一致。
 */
export interface TemporaryConversationAgentOrigin {
  sourceAgentRunId?: string;
  parentRunId?: string;
  rootRunId?: string;
  sourceNodeRunId?: string;
  sourcePageId?: string;
  sourceFloorId?: string;
  sourceSessionId?: string;
  sourceAttemptNo?: number;
}

export interface TemporaryConversationCreateInput {
  accountId: string;
  sourceSessionId: string;
  sourceBranchId?: string;
  title?: string | null;
  purpose?: string | null;
  retentionPolicy?: TemporaryConversationRetentionPolicy | null;
  ttlSeconds?: number | null;
  visibility?: TemporaryConversationVisibility | null;
  agentOrigin?: TemporaryConversationAgentOrigin | null;
}

export interface TemporaryConversationCreateFromProjectInput {
  accountId: string;
  projectId: string;
  title?: string | null;
  purpose?: string | null;
  retentionPolicy?: TemporaryConversationRetentionPolicy | null;
  ttlSeconds?: number | null;
  visibility?: TemporaryConversationVisibility | null;
  agentOrigin?: TemporaryConversationAgentOrigin | null;
}

export interface TemporaryConversationMessageInput {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface TemporaryConversationAppendInput {
  accountId: string;
  conversationId: string;
  branchId?: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export interface TemporaryConversationMessageRef {
  conversationId: string;
  floorId: string;
  pageId: string;
  messageId: string;
  seq: number;
  role: "user" | "assistant" | "system";
}

export interface TemporaryConversationRespondInput {
  accountId: string;
  conversationId: string;
  branchId?: string;
  inputMessage?: TemporaryConversationMessageInput;
  config?: TurnConfig;
  generationParams?: GenerationParamsInput;
  promptIntent?: PromptRunIntent;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  debugOptions?: PromptLiveDebugOptions;
  abortSignal?: AbortSignal;
}

export type TemporaryConversationStreamInput = TemporaryConversationRespondInput;

export interface TemporaryConversationResult {
  conversationId: string;
  branchId: string;
  floorId: string;
  floorNo: number;
  pageId: string;
  text: string;
  usage?: TokenUsage;
  finalState?: string;
  finishReason?: string;
  warnings?: string[];
}

export interface TemporaryConversationExportInput {
  accountId: string;
  conversationId: string;
  target: "page_staged_write";
  targetPageId: string;
  sourceOutputPageId?: string;
  reason?: string | null;
}

export interface TemporaryConversationExportResult {
  conversationId: string;
  target: "page_staged_write";
  stagedWriteId: string;
  targetPageId: string;
  sourcePageId: string;
  createdAt: number;
  status: "staged";
}

export interface TemporaryConversationTranscriptMessage {
  id: string;
  seq: number;
  role: "user" | "assistant" | "system" | "narrator";
  content: string;
  contentFormat: "text" | "markdown" | "json";
  isHidden: boolean;
  source: string | null;
  createdAt: number;
}

export interface TemporaryConversationTranscriptPage {
  id: string;
  pageNo: number;
  pageKind: "input" | "output" | "mixed";
  isActive: boolean;
  version: number;
  checksum: string | null;
  createdAt: number;
  updatedAt: number;
  messages: TemporaryConversationTranscriptMessage[];
}

export interface TemporaryConversationTranscriptFloor {
  id: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: "draft" | "generating" | "committed" | "failed";
  tokenIn: number;
  tokenOut: number;
  createdAt: number;
  updatedAt: number;
  pages: TemporaryConversationTranscriptPage[];
}

export interface TemporaryConversationTranscript {
  conversationId: string;
  branchId: string;
  floors: TemporaryConversationTranscriptFloor[];
}

export type TemporaryConversationStreamChunk =
  | {
      type: "start";
      floorId: string;
      floorNo: number;
      branchId: string;
    }
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "tool";
      event: RespondRuntimeToolEvent;
    }
  | {
      type: "run";
      event: FloorRunSnapshot;
    }
  | {
      type: "result";
      result: TemporaryConversationResult;
    };

export function isTemporaryConversationSessionLike(
  value: { kind?: string | null } | null | undefined,
): boolean {
  return value?.kind === TEMPORARY_CONVERSATION_SESSION_KIND;
}
