import type {
  FloorRunSnapshot,
  PromptRunIntent,
  TokenUsage,
  TurnConfig,
} from "@tavern/core";

import type {
  PromptLiveDebugOptions,
  RespondRuntimeToolEvent,
  RetryStepIrreversibleSideEffect,
} from "./chat/contracts.js";
import type { ToolTransportPreference } from "./chat/tool-call-transport-resolver.js";
import type { PromptRuntimeClientInjectionInput } from "./prompt-runtime-injection-types.js";
import type { GenerationParamsInput } from "../lib/llm-params.js";
import type {
  PromptDeliveryPolicy,
  PromptStructurePolicy,
} from "./prompt-assembler.js";

export const TEMPORARY_CONVERSATION_SESSION_KIND = "temporary" as const;
export const TEMPORARY_CONVERSATION_BRANCH_ID = "main" as const;

/**
 * 图助手临时对话的 purpose 标记。
 *
 * studio 图编辑器助手创建临时对话时必填该 purpose（取值与前端
 * `apps/studio/src/lib/temp-conversation` 的 `GRAPH_ASSISTANT_PURPOSE` 一致）。
 * 后端据此在 respond 路径强制启用 NodeGraph 工具与一次性引导注入，不影响其他 purpose。
 */
export const GRAPH_ASSISTANT_PURPOSE = "graph-assistant" as const;

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
  cleanedAt: number | null;
}

export interface TemporaryConversationHandle
  extends TemporaryConversationResource {
  conversationId: string;
}

/** Terminal states that make a temporary conversation eligible for retention cleanup. */
export const TEMPORARY_CONVERSATION_TERMINAL_STATUSES = [
  "finalized",
  "discarded",
  "cancelled",
  "expired",
] as const;
export type TemporaryConversationTerminalStatus =
  (typeof TEMPORARY_CONVERSATION_TERMINAL_STATUSES)[number];

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
  /**
   * 本回合的动态上下文文本（图助手·提示词阶段二）。
   *
   * 由前端按当前画布状态求值生成（上下文数据块 + 动态模板）。后端将其包装为一条
   * request-scope 的 client injection 参与本回合 prompt 组装，不写入 transcript。
   * 空串 / 纯空白视为未提供，不产生注入。
   */
  dynamicContext?: string;
  /**
   * 本回合的工具调用协议偏好（图助手·原生 function calling 阶段二）。
   *
   * 三档：`auto`（默认，按 provider 能力选）/ `native`（强制原生，不支持时安全回退文本协议）/
   * `text_protocol`（强制文本协议）。仅对图助手（purpose=graph-assistant）生效；缺省视为 `auto`。
   */
  toolTransportPreference?: ToolTransportPreference;
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
  /** step 级重试：实际被丢弃的起点步号（1-based）。仅 retryStep 结果存在。 */
  discardedFromStepIndex?: number;
  /** step 级重试：起点之前不可回滚的写类副作用清单。仅 retryStep 结果存在。 */
  irreversibleSideEffects?: RetryStepIrreversibleSideEffect[];
}

/**
 * 临时对话（图助手）floor 级重试输入。
 *
 * 重试语义：在目标已提交楼层上重生成，产生新 output page version（开新消息页，保留旧页历史）。
 * 复用主会话 retryFloor 骨架，仅限临时对话（allowTemporary）。
 */
export interface TemporaryConversationRetryInput {
  accountId: string;
  conversationId: string;
  branchId?: string;
  /** 要重试的已提交楼层 id。 */
  floorId: string;
  config?: TurnConfig;
  generationParams?: GenerationParamsInput;
  debugOptions?: PromptLiveDebugOptions;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  promptRuntimeInjections?: PromptRuntimeClientInjectionInput[];
  /** 本回合动态上下文（与 respond 一致，折叠为 request-scope 注入）。 */
  dynamicContext?: string;
  /** 重放确认：已确认可重放的工具执行 id。 */
  confirmedExecutionIds?: string[];
  /** 重放确认：已确认可重放的会话状态变更 id。 */
  confirmedSessionStateMutationIds?: string[];
  abortSignal?: AbortSignal;
}

/** 临时对话 step 级重试输入：在 floor 级重试基础上指定从第几步重生成。 */
export interface TemporaryConversationRetryStepInput extends TemporaryConversationRetryInput {
  /** 从第几步重新生成（1-based）。 */
  fromStepIndex: number;
}

export type TemporaryConversationRetryStreamInput = TemporaryConversationRetryInput;
export type TemporaryConversationRetryStepStreamInput = TemporaryConversationRetryStepInput;

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

/**
 * 楼层的一次工具执行记录（视图旁路数据）。
 *
 * 来自 `tool_execution_record`（工具执行主审计真相），按 floorId 关联、startedAt 升序。
 * 它与 message 并列挂在 floor 上，不进入 floor→page→message 层级，也不参与 prompt 投影；
 * 供前端把「工具步 + 回答步」归并成 step 序列展示。
 */
export interface TemporaryConversationTranscriptToolExecution {
  id: string;
  toolName: string;
  status:
    | "running"
    | "queued"
    | "success"
    | "error"
    | "denied"
    | "timeout"
    | "uncertain"
    | "blocked";
  /** 工具入参（已从 args_json 解析；解析失败时回退为原始字符串）。 */
  args: unknown;
  /** 工具结果（已从 result_json 解析；解析失败时回退为原始字符串）。inspect 受限时置 null。*/
  result: unknown;
  sideEffectLevel: "none" | "sandbox" | "irreversible" | null;
  commitOutcome: "pending" | "committed" | "discarded" | "replay_blocked" | "uncertain";
  /** 失败原因等附带消息；inspect 受限时置 null。 */
  errorMessage: string | null;
  durationMs: number;
  startedAt: number;
  finishedAt: number | null;
  attemptNo: number;
  replayParentExecutionId: string | null;
  /** 该执行所属的 LLM 生成步号（1-based，可空，旧数据为 null）；供前端按步归并与 step 重试。 */
  generationStepNo?: number | null;
}

/**
 * 楼层的一条中间叙述（native 多步循环旁路展示用）。
 *
 * 来自 floor_result_snapshot.step_narrations_json；不进 floor→page→message 层级、不进 prompt 投影。
 * 供前端把「中间叙述 + 工具组」按真实时序呈现。
 */
export interface TemporaryConversationTranscriptStepNarration {
  stepIndex: number;
  text: string;
  createdAt: number;
}

export interface TemporaryConversationTranscriptFloor {
  id: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: "draft" | "generating" | "committed" |"failed";
  tokenIn: number;
  tokenOut: number;
  createdAt: number;
updatedAt: number;
  /**
   * 该楼层的推理（思维链）文本。
   *
   * 来自 floor_result_snapshot.reasoning_text；模型未返回 reasoning 或未提交时为 null。
   */
  reasoningText: string | null;
  /**
   * 该楼层的 native 多步中间叙述（旁路数组，不进层级、不进 prompt）。无时为空数组。
   */
  stepNarrations: TemporaryConversationTranscriptStepNarration[];
  /**
   * 该楼层的工具执行记录（与 message 并列的旁路数组，不进层级、不进 prompt）。
   * 无工具调用时为空数组。
   */
  toolExecutions: TemporaryConversationTranscriptToolExecution[];
  pages: TemporaryConversationTranscriptPage[];
}

export interface TemporaryConversationTranscript {
  conversationId: string;
  branchId: string;
  floors: TemporaryConversationTranscriptFloor[];
}

/**
 * Inspect transcript message.
 *
 * Like the public transcript message, but `content` may be redacted to `null`
 * when the conversation is agent-private and the caller has not been granted
 * agent-private access. Structural fields (role, seq, page, floor) are kept so
 * authorized observers can still see shape without reading hidden bodies.
 */
export interface TemporaryConversationInspectTranscriptMessage {
  id: string;
  seq: number;
  role: "user" | "assistant" | "system" | "narrator";
  content: string | null;
  contentLength: number;
  contentFormat: "text" | "markdown" | "json";
  isHidden: boolean;
  source: string | null;
  restricted: boolean;
  createdAt: number;
}

export interface TemporaryConversationInspectTranscriptPage {
  id: string;
  pageNo: number;
  pageKind: "input" | "output" | "mixed";
  isActive: boolean;
  version: number;
  checksum: string | null;
  createdAt: number;
  updatedAt: number;
  messages: TemporaryConversationInspectTranscriptMessage[];
}

export interface TemporaryConversationInspectTranscriptFloor {
  id: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: "draft" | "generating" | "committed" | "failed";
  tokenIn: number;
  tokenOut: number;
  createdAt: number;
  updatedAt: number;
  /**
   * 该楼层的推理（思维链）文本。
   *
   * agent-private 受限时置 null（脱敏）；模型未返回 reasoning 时也为 null。
   */
  reasoningText: string | null;
  /**
   * 该楼层的 native 多步中间叙述（旁路数组）。agent-private 受限时 text 置空串，保留 stepIndex / createdAt 结构。
   */
  stepNarrations: TemporaryConversationTranscriptStepNarration[];
  /**
   * 该楼层的工具执行记录（旁路数组）。agent-private 受限时 args / result / errorMessage 置 null。
   */
  toolExecutions: TemporaryConversationTranscriptToolExecution[];
  pages: TemporaryConversationInspectTranscriptPage[];
}

/** Source snapshot reference for a temporary conversation (no large bodies). */
export interface TemporaryConversationSourceSnapshotRef {
  digest: string | null;
  sourceSessionId: string | null;
}

/** One export record (currently page_staged_write deliveries). */
export interface TemporaryConversationExportRecord {
  stagedWriteId: string;
  deliveryTarget: string;
  targetSessionId: string;
  targetPageId: string;
  sourcePageId: string | null;
  status: "staged" | "accepted" | "applied" | "discarded";
  reason: string | null;
  createdAt: number;
  updatedAt: number;
  appliedAt: number | null;
  discardedAt: number | null;
}

/** Aggregated debug / audit view for a single temporary conversation. */
export interface TemporaryConversationInspect {
  conversation: TemporaryConversationResource;
  agentPrivate: boolean;
  transcriptRestricted: boolean;
  sourceSnapshot: TemporaryConversationSourceSnapshotRef;
  agentOrigin: TemporaryConversationAgentOrigin | null;
  cleanup: {
    cleaned: boolean;
    cleanedAt: number | null;
    retentionPolicy: TemporaryConversationRetentionPolicy;
  };
  transcript: {
    conversationId: string;
    branchId: string;
    floors: TemporaryConversationInspectTranscriptFloor[];
  };
  exports: TemporaryConversationExportRecord[];
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
      type: "reasoning";
      text: string;
    }
  | {
      type: "narration";
      stepIndex: number;
      text: string;
      createdAt: number;
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
