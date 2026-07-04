import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { readSseStream } from "../stream/read-sse.js";
import type { RespondStreamCallbacks } from "../stream/event-types.js";
import { resolveInputTokens, resolveOutputTokens, resolveTotalTokens, toApiUsage, type ApiUsage } from "../types/usage.js";
import {
  compactObject,
  readArray,
  readNullableNumber,
  readNullableString,
  readNumber,
  readOptionalString,
  readRecord,
  readString,
} from "./utils.js";

export type TemporaryConversationStatus =
  | "active"
  | "finalized"
  | "discarded"
  | "expired"
  | "cancelled";

export type TemporaryConversationRetentionPolicy =
  | "delete_on_finalize"
  | "ttl"
  | "keep_for_debug";

export type TemporaryConversationVisibility = "internal" | "client_visible";

export type TemporaryConversationRecord = {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  sourceSessionId: string | null;
  branchId: string;
  kind: "temporary";
  title: string | null;
  purpose: string | null;
  status: TemporaryConversationStatus;
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
};

export type TemporaryConversationMessageInput = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type TemporaryConversationCreateInput = {
  title?: string;
  purpose: string;
  retentionPolicy?: TemporaryConversationRetentionPolicy;
  ttlSeconds?: number;
};

export type TemporaryConversationAppendMessageOptions = {
  accountId?: AccountIdHint;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type TemporaryConversationMessageRef = {
  conversationId: string;
  floorId: string;
  pageId: string;
  messageId: string;
  seq: number;
  role: "user" | "assistant" | "system";
};

/**
 * 推理强度。字面量补全覆盖常用档位；同时允许传入任意非空字符串，
 * 以兼容不同 provider 的档位与手动思考预算（纯数字 token 数）。
 *
 * - low / medium / high /xhigh / max：努力级别（Anthropic 下走自适应 + effort）；
 * - adaptive：自适应，由模型自行决定思考深度（Anthropic Opus 4.6+ 仅支持此模式）；
 * - 纯数字字符串（如 '16384'）：Anthropic 手动思考预算 token 数。
* 是否产出 reasoning 仍取决于模型本身。
 */
export type TemporaryConversationReasoningEffort =
  | "adaptive"
  | "low"
  | "medium"
  | "high"
 | "xhigh"
  | "max"
  | (string & {});

export type TemporaryConversationGenerationParams = {
  /**
  * 本回合的推理强度（思维链）。
   *
   * 预设 low/medium/high，也可传入模型支持的更强档位；不传表示不覆盖。
   * 是否产生 reasoning 仍取决于模型本身。
   */
  reasoningEffort?: TemporaryConversationReasoningEffort;
  /**
   * 采样温度，取值范围 [0, 2]；不传表示不覆盖。
   */
  temperature?: number;
  /**
   * Top-P 采样，取值范围 [0, 1]；不传表示不覆盖。
   */
  topP?: number;
  /**
   * 最大输出 token 数，正整数；不传表示不覆盖。
   */
  maxOutputTokens?: number;
  /**
   * 最大上下文 token 数，正整数。主要用于 prompt 组装阶段的 token 预算（历史裁剪），
   * 不是下发给模型的上下文窗口设置；不传表示不覆盖。
   */
  maxContextTokens?: number;
};

/**
 *工具调用协议偏好（仅图助手 purpose=graph-assistant 生效）。
 *
 * - `auto`（默认）：按所选模型能力自动选——支持原生 function calling 则走原生，否则走文本协议。
 * - `native`：强制原生 function calling；模型不支持时后端安全回退到文本协议，不报错。
 * - `text_protocol`：强制文本协议。
 */
export type TemporaryConversationToolTransportPreference = "auto" | "native" | "text_protocol";


export type TemporaryConversationRespondOptions = {
  accountId?: AccountIdHint;
  conversationId: string;
  inputMessage?: TemporaryConversationMessageInput;
  /**
   * 本回合的动态上下文文本。
   *
   * 由调用方按当前上下文求值生成，随本回合注入 prompt 组装，不写入 transcript。
   * 空串 / 纯空白视为未提供。
   */
  dynamicContext?: string;
  /**
   * 本回合的生成参数覆盖。支持 reasoningEffort、temperature、topP、
   * maxOutputTokens、maxContextTokens；未设置的字段不会下发，由后端/模型默认值生效。
   */
  generationParams?: TemporaryConversationGenerationParams;
  /**
   * 本回合的工具调用协议偏好（仅图助手会话生效）。不传或传 `auto` 表示按模型能力自动选。
   */
  toolTransportPreference?: TemporaryConversationToolTransportPreference;
};

export type TemporaryConversationRespondStreamOptions =
  TemporaryConversationRespondOptions
  & RespondStreamCallbacks
  & {
    signal?: AbortSignal;
  };

export type TemporaryConversationResult = {
  conversationId: string;
  branchId: string;
  floorId: string;
  floorNo: number;
  pageId: string;
  generatedText: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalUsage: ApiUsage;
  finalState?: string;
};

/**
 * 重试入参（整轮重试）。
 *
 * 重试会在已提交的临时楼层上开一个新输出页版本（“开新消息页”），旧页历史保留。
 */
export type TemporaryConversationRetryOptions = {
  accountId?: AccountIdHint;
  conversationId: string;
  /** 目标楼层 id（必须属于本临时对话）。 */
  floorId: string;
  /**
   * 本回合的动态上下文文本。随本回合注入 prompt 组装，不写入 transcript。
   */
  dynamicContext?: string;
  /**
   * 本回合的生成参数覆盖。未设置的字段不会下发，由后端/模型默认值生效。
   */
  generationParams?: TemporaryConversationGenerationParams;
  /** 已确认可回放的工具执行 id 列表（图助手确认闸）。 */
  confirmedExecutionIds?: string[];
  /** 已确认可回放的会话状态变更 id 列表。 */
  confirmedSessionStateMutationIds?: string[];
};

export type TemporaryConversationRetryStreamOptions =
  TemporaryConversationRetryOptions
  & RespondStreamCallbacks
  & {
    signal?: AbortSignal;
  };

export type TemporaryConversationRetryStepOptions = TemporaryConversationRetryOptions & {
  /** 从第几步重生成（1-based）。该步及其之后的工具往返被丢弃，之前的成功往返保留。 */
  fromStepIndex: number;
};

export type TemporaryConversationRetryStepStreamOptions =
  TemporaryConversationRetryStepOptions
  & RespondStreamCallbacks
  & {
    signal?: AbortSignal;
  };

/** 起点之前已产生、不会回滚的写类副作用条目（脱敏后只暴露摘要字段）。 */
export type TemporaryConversationIrreversibleSideEffect = {
  executionId: string;
  generationStepNo?: number | null;
  sideEffectLevel: string;
  startedAt: number;
  toolName: string;
};

export type TemporaryConversationRetryStepResult = TemporaryConversationResult & {
  /** 实际被丢弃的起始步号（1-based）。 */
  discardedFromStepIndex: number;
  /** 起点之前已产生、不会回滚的写类副作用清单（脱敏摘要）。 */
  irreversibleSideEffects: TemporaryConversationIrreversibleSideEffect[];
};


export type TemporaryConversationTranscriptMessage = {
  id: string;
  seq: number;
  role: string;
  content: string;
  contentFormat: string;
  isHidden: boolean;
  source: string | null;
  createdAt: number;
};

export type TemporaryConversationTranscriptPage = {
  id: string;
  pageNo: number;
  pageKind: string;
  isActive: boolean;
  version: number;
  checksum: string | null;
  createdAt: number;
  updatedAt: number;
  messages: TemporaryConversationTranscriptMessage[];
};

export type TemporaryConversationTranscriptToolExecution = {
  id: string;
  toolName: string;
  status: string;
  /** 工具入参（后端已从 args_json 解析）。 */
  args: unknown;
  /** 工具结果（后端已从 result_json 解析）。inspect 受限时为 null。 */
  result: unknown;
  sideEffectLevel: string | null;
  commitOutcome: string;
  errorMessage: string | null;
  durationMs: number;
  startedAt: number;
  finishedAt: number | null;
  attemptNo: number;
  replayParentExecutionId: string | null;
  /** 该执行所属的 LLM 生成步号（1-based，旧数据为 null）；供前端按步归并与 step 重试定位。 */
  generationStepNo: number | null;
};

/**
 * 楼层的一条中间叙述（native 多步循环旁路展示用）。
 *
 * 不进 floor→page→message 层级、不进 prompt；供前端把「中间叙述 + 工具组」按真实时序呈现。
 */
export type TemporaryConversationTranscriptStepNarration = {
  stepIndex: number;
  text: string;
  createdAt: number;
};

export type TemporaryConversationTranscriptFloor = {
  id: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: string;
  tokenIn: number;
  tokenOut: number;
    createdAt: number;
 updatedAt: number;
 /**
  * 该楼层的推理（思维链）文本。
  *
  * 模型未返回 reasoning 或未提交时为 null。
  */
 reasoningText: string | null;
  /** 该楼层的 native 多步中间叙述（旁路数组，不进层级、不进 prompt）。无时为空数组。 */
  stepNarrations: TemporaryConversationTranscriptStepNarration[];
  /** 该楼层的工具执行记录（与 message 并列的旁路数组，不进层级、不进 prompt）。 */
  toolExecutions: TemporaryConversationTranscriptToolExecution[];
  pages: TemporaryConversationTranscriptPage[];
};

export type TemporaryConversationTranscript = {
  conversationId: string;
  branchId: string;
  floors: TemporaryConversationTranscriptFloor[];
};

export type TemporaryConversationExportToPageStagedWriteOptions = {
  accountId?: AccountIdHint;
  conversationId: string;
  targetPageId: string;
  sourceOutputPageId?: string;
  reason?: string;
};

export type TemporaryConversationExportResult = {
  conversationId: string;
  target: "page_staged_write";
  stagedWriteId: string;
  targetPageId: string;
  sourcePageId: string;
  createdAt: number;
  status: "staged";
};

export type TemporaryConversationInspectTranscriptMessage = {
  id: string;
  seq: number;
  role: string;
  content: string | null;
  contentLength: number;
  contentFormat: string;
  isHidden: boolean;
  source: string | null;
  restricted: boolean;
  createdAt: number;
};

export type TemporaryConversationInspectTranscriptPage = {
  id: string;
  pageNo: number;
  pageKind: string;
  isActive: boolean;
  version: number;
  checksum: string | null;
  createdAt: number;
  updatedAt: number;
  messages: TemporaryConversationInspectTranscriptMessage[];
};

export type TemporaryConversationInspectTranscriptFloor = {
  id: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: string;
  tokenIn: number;
  tokenOut: number;
  createdAt: number;
  updatedAt: number;
  /**
   * 该楼层的推理（思维链）文本。
   *
   * agent-private 受限时为 null（脱敏）；模型未返回 reasoning 时也为 null。
   */
  reasoningText: string | null;
  /** 该楼层的 native 多步中间叙述（旁路数组）。agent-private 受限时 text 为空串，保留结构。 */
  stepNarrations: TemporaryConversationTranscriptStepNarration[];
  pages: TemporaryConversationInspectTranscriptPage[];
};

export type TemporaryConversationExportRecord = {
  stagedWriteId: string;
  deliveryTarget: string;
  targetSessionId: string;
  targetPageId: string;
  sourcePageId: string | null;
  status: string;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
  appliedAt: number | null;
  discardedAt: number | null;
};

export type TemporaryConversationAgentOrigin = {
  sourceAgentRunId?: string;
  parentRunId?: string;
  rootRunId?: string;
  sourceNodeRunId?: string;
  sourcePageId?: string;
  sourceFloorId?: string;
  sourceSessionId?: string;
  sourceAttemptNo?: number;
};

export type TemporaryConversationInspect = {
  conversation: TemporaryConversationRecord;
  agentPrivate: boolean;
  transcriptRestricted: boolean;
  sourceSnapshot: {
    digest: string | null;
    sourceSessionId: string | null;
  };
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
};

export type TemporaryConversationInspectOptions = {
  accountId?: AccountIdHint;
  conversationId: string;
  includeAgentPrivate?: boolean;
};

export type TemporaryConversationsRequestOptions = {
  accountId?: AccountIdHint;
  conversationId: string;
};

export type TemporaryConversationsResource = {
  getDetail(options: TemporaryConversationsRequestOptions): Promise<TemporaryConversationRecord>;
  appendMessage(options: TemporaryConversationAppendMessageOptions): Promise<TemporaryConversationMessageRef>;
  respond(options: TemporaryConversationRespondOptions): Promise<TemporaryConversationResult>;
  respondStream(options: TemporaryConversationRespondStreamOptions): Promise<TemporaryConversationResult>;
  retry(options: TemporaryConversationRetryOptions): Promise<TemporaryConversationResult>;
  retryStream(options: TemporaryConversationRetryStreamOptions): Promise<TemporaryConversationResult>;
  retryStep(options: TemporaryConversationRetryStepOptions): Promise<TemporaryConversationRetryStepResult>;
  retryStepStream(options: TemporaryConversationRetryStepStreamOptions): Promise<TemporaryConversationRetryStepResult>;
  getTranscript(options: TemporaryConversationsRequestOptions): Promise<TemporaryConversationTranscript>;
  inspect(options: TemporaryConversationInspectOptions): Promise<TemporaryConversationInspect>;
  finalize(options: TemporaryConversationsRequestOptions): Promise<TemporaryConversationRecord>;
  discard(options: TemporaryConversationsRequestOptions): Promise<TemporaryConversationRecord>;
  cancel(options: TemporaryConversationsRequestOptions): Promise<TemporaryConversationRecord>;
  exportToPageStagedWrite(options: TemporaryConversationExportToPageStagedWriteOptions): Promise<TemporaryConversationExportResult>;
};

export function createTemporaryConversationsResource(client: TransportClient): TemporaryConversationsResource {
  return {
    async getDetail(options): Promise<TemporaryConversationRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );
      const record = mapTemporaryConversationRecord(readRecord(response.body)?.data);
      if (!record) {
        throw new Error("Temporary conversation detail payload is missing");
      }
      return record;
    },
    async appendMessage(options): Promise<TemporaryConversationMessageRef> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/messages`,
        {
          body: {
            role: options.role,
            content: options.content,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      return mapTemporaryConversationMessageRef(readRecord(response.body)?.data);
    },
    async respond(options): Promise<TemporaryConversationResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/respond`,
        {
          body: mapTemporaryConversationRespondRequestBody(options),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      const result = mapTemporaryConversationResult(readRecord(response.body)?.data);
      if (!result) {
        throw new Error("Temporary conversation respond payload is missing");
      }
      return result;
    },
    async respondStream(options): Promise<TemporaryConversationResult> {
      const response = await client.fetchRaw(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/respond`,
        {
          accept: "text/event-stream",
          body: mapTemporaryConversationRespondRequestBody(options),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
          signal: options.signal,
        },
      );

      const donePayload = await readSseStream(response, {
        onChunk: (payload) => options.onChunk?.(payload),
        onError: (payload) => options.onError?.(payload),
        onEvent: (event) => options.onEvent?.(event),
        onReasoning: (payload) => options.onReasoning?.(payload),
        onStepNarration: (payload) => options.onStepNarration?.(payload),
        onRun: (payload) => options.onRun?.(payload),
        onStart: (payload) => options.onStart?.(payload),
        onSummary: (payload) => options.onSummary?.(payload),
        onTool: (payload) => options.onTool?.(payload),
      });

      const result = mapTemporaryConversationDonePayload(donePayload);
      if (!result) {
        throw new Error("Temporary conversation stream ended without a valid result payload");
      }
      return result;
    },
    async retry(options):Promise<TemporaryConversationResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/retry`,
        {
          body: mapTemporaryConversationRetryRequestBody(options),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      const result = mapTemporaryConversationResult(readRecord(response.body)?.data);
      if (!result) {
  throw new Error("Temporary conversation retry payload is missing");
      }
      return result;
    },
    async retryStream(options): Promise<TemporaryConversationResult> {
      const response = await client.fetchRaw(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/retry`,
        {
          accept: "text/event-stream",
          body:mapTemporaryConversationRetryRequestBody(options),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
          signal: options.signal,
        },
      );

      const donePayload = await readSseStream(response, forwardRetryStreamCallbacks(options));
      const result = mapTemporaryConversationDonePayload(donePayload);
      if (!result) {
        throw new Error("Temporary conversation retry stream ended without a valid result payload");
      }
      return result;
    },
    async retryStep(options): Promise<TemporaryConversationRetryStepResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/retry-step`,
        {
          body: mapTemporaryConversationRetryStepRequestBody(options),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      const result = mapTemporaryConversationRetryStepResult(readRecord(response.body)?.data);
      if (!result) {
        throw new Error("Temporary conversation retry-step payload is missing");
      }
      return result;
    },
    async retryStepStream(options): Promise<TemporaryConversationRetryStepResult> {
      const response = await client.fetchRaw(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/retry-step`,
        {
          accept: "text/event-stream",
          body: mapTemporaryConversationRetryStepRequestBody(options),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
          signal: options.signal,
        },
      );

      const donePayload = await readSseStream(response, forwardRetryStreamCallbacks(options));
      const result = mapTemporaryConversationRetryStepDonePayload(donePayload);
      if (!result) {
        throw new Error("Temporary conversation retry-step stream ended without a valid result payload");
      }
      return result;
    },

    async getTranscript(options): Promise<TemporaryConversationTranscript> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/transcript`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );
      const transcript = mapTemporaryConversationTranscript(readRecord(response.body)?.data);
      if (!transcript) {
        throw new Error("Temporary conversation transcript payload is missing");
      }
      return transcript;
    },
    async inspect(options): Promise<TemporaryConversationInspect> {
      const query = options.includeAgentPrivate ? "?include_agent_private=true" : "";
      const response = await client.fetchJson<Record<string, unknown>>(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/inspect${query}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );
      const inspect = mapTemporaryConversationInspect(readRecord(response.body)?.data);
      if (!inspect) {
        throw new Error("Temporary conversation inspect payload is missing");
      }
      return inspect;
    },
    async finalize(options): Promise<TemporaryConversationRecord> {
      return mutateTemporaryConversation(client, options, "finalize");
    },
    async discard(options): Promise<TemporaryConversationRecord> {
      return mutateTemporaryConversation(client, options, "discard");
    },
    async cancel(options): Promise<TemporaryConversationRecord> {
      return mutateTemporaryConversation(client, options, "cancel");
    },
    async exportToPageStagedWrite(options): Promise<TemporaryConversationExportResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/temporary-conversations/${encodeURIComponent(options.conversationId)}/export`,
        {
          body: compactObject({
            target: "page_staged_write",
            target_page_id: options.targetPageId,
            source_output_page_id: options.sourceOutputPageId,
            reason: options.reason,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      const result = mapTemporaryConversationExportResult(readRecord(response.body)?.data);
      if (!result) {
        throw new Error("Temporary conversation export payload is missing");
      }
      return result;
    },
  };
}

export type SessionsCreateTemporaryConversationOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
  input: TemporaryConversationCreateInput;
};

export type ProjectsCreateTemporaryConversationOptions = {
  accountId?: AccountIdHint;
  projectId: string;
  input: TemporaryConversationCreateInput;
};

export async function createTemporaryConversationFromSession(
  client: TransportClient,
  options: SessionsCreateTemporaryConversationOptions,
): Promise<TemporaryConversationRecord> {
  const response = await client.fetchJson<Record<string, unknown>>(
    `/sessions/${encodeURIComponent(options.sessionId)}/temporary-conversations`,
    {
      body: mapTemporaryConversationCreateRequestBody(options.input),
      headers: buildAccountHeaders(options.accountId),
      method: "POST",
    },
  );
  const record = mapTemporaryConversationRecord(readRecord(response.body)?.data);
  if (!record) {
    throw new Error("Temporary conversation create payload is missing");
  }
  return record;
}

export async function createTemporaryConversationFromProject(
  client: TransportClient,
  options: ProjectsCreateTemporaryConversationOptions,
): Promise<TemporaryConversationRecord> {
  const response = await client.fetchJson<Record<string, unknown>>(
    `/projects/${encodeURIComponent(options.projectId)}/temporary-conversations`,
    {
      body: mapTemporaryConversationCreateRequestBody(options.input),
      headers: buildAccountHeaders(options.accountId),
      method: "POST",
    },
  );
  const record = mapTemporaryConversationRecord(readRecord(response.body)?.data);
  if (!record) {
    throw new Error("Temporary conversation create payload is missing");
  }
  return record;
}

function mapTemporaryConversationCreateRequestBody(input: TemporaryConversationCreateInput): Record<string, unknown> {
  return compactObject({
    title: input.title,
    purpose: input.purpose,
    retention_policy: input.retentionPolicy,
    ttl_seconds: input.ttlSeconds,
  });
}

function mapTemporaryConversationRespondRequestBody(
  options: TemporaryConversationRespondOptions | TemporaryConversationRespondStreamOptions,
): Record<string, unknown> {
  const params = options.generationParams;
  const generationParams = params
    ? compactObject({
        reasoning_effort: params.reasoningEffort,
        temperature: params.temperature,
        top_p: params.topP,
        max_output_tokens: params.maxOutputTokens,
        max_context_tokens: params.maxContextTokens,
      })
    : undefined;
  return compactObject({
    input_message: options.inputMessage
      ? {
  role: options.inputMessage.role,
 content: options.inputMessage.content,
        }
      : undefined,
    dynamic_context: options.dynamicContext,
    generation_params:
      generationParams && Object.keys(generationParams).length > 0
        ? generationParams
        : undefined,
    tool_transport_preference: options.toolTransportPreference,
  });
}
function mapGenerationParamsBody(
  params: TemporaryConversationGenerationParams | undefined,
): Record<string, unknown> | undefined {
  if (!params) {
    return undefined;
  }
  const generationParams = compactObject({
    reasoning_effort: params.reasoningEffort,
    temperature: params.temperature,
    top_p: params.topP,
    max_output_tokens: params.maxOutputTokens,
    max_context_tokens: params.maxContextTokens,
  });
  return Object.keys(generationParams).length > 0 ? generationParams : undefined;
}

function mapTemporaryConversationRetryRequestBody(
  options: TemporaryConversationRetryOptions | TemporaryConversationRetryStreamOptions,
): Record<string, unknown> {
  return compactObject({
    floor_id: options.floorId,
    dynamic_context: options.dynamicContext,
    generation_params: mapGenerationParamsBody(options.generationParams),
    confirmed_execution_ids: options.confirmedExecutionIds,
    confirmed_session_state_mutation_ids: options.confirmedSessionStateMutationIds,
  });
}

function mapTemporaryConversationRetryStepRequestBody(
  options: TemporaryConversationRetryStepOptions | TemporaryConversationRetryStepStreamOptions,
): Record<string, unknown> {
  return compactObject({
    floor_id: options.floorId,
    from_step_index: options.fromStepIndex,
    dynamic_context: options.dynamicContext,
    generation_params: mapGenerationParamsBody(options.generationParams),
    confirmed_execution_ids: options.confirmedExecutionIds,
    confirmed_session_state_mutation_ids: options.confirmedSessionStateMutationIds,
  });
}

/** 将重试流式回调透传给 readSseStream（与 respondStream 一致）。 */
function forwardRetryStreamCallbacks(
  options: TemporaryConversationRetryStreamOptions | TemporaryConversationRetryStepStreamOptions,
): RespondStreamCallbacks {
  return {
    onChunk: (payload) => options.onChunk?.(payload),
    onError: (payload) => options.onError?.(payload),
    onEvent: (event) => options.onEvent?.(event),
    onReasoning: (payload) => options.onReasoning?.(payload),
    onStepNarration: (payload) => options.onStepNarration?.(payload),
    onRun: (payload) => options.onRun?.(payload),
    onStart: (payload) =>options.onStart?.(payload),
    onSummary: (payload) => options.onSummary?.(payload),
    onTool: (payload) => options.onTool?.(payload),
  };
}

function mapTemporaryConversationIrreversibleSideEffect(
  value: unknown,
): TemporaryConversationIrreversibleSideEffect | null {
  const record = readRecord(value);
  const executionId = readOptionalString(record?.execution_id);
  if (!executionId) {
    return null;
  }
  return {
    executionId,
    generationStepNo: readNullableNumber(record?.generation_step_no),
    sideEffectLevel: readString(record?.side_effect_level),
    startedAt: readNumber(record?.started_at),
    toolName: readString(record?.tool_name),
  };
}

function mapTemporaryConversationRetryStepResult(
  value: unknown,
): TemporaryConversationRetryStepResult | null {
  const base = mapTemporaryConversationResult(value);
  if (!base) {
    return null;
  }
  const record = readRecord(value);
  return {
    ...base,
    discardedFromStepIndex: readNullableNumber(record?.discarded_from_step_index) ?? 0,
    irreversibleSideEffects: readArray(record?.irreversible_side_effects)
      .map(mapTemporaryConversationIrreversibleSideEffect)
      .filter((item): item is TemporaryConversationIrreversibleSideEffect => item !== null),
  };
}

function mapTemporaryConversationRetryStepDonePayload(value: {
  branchId?: string;
  conversationId?: string;
  floorId: string;
  floorNo: number;
  generatedText?: string;
  pageId?: string;
  totalUsage: ApiUsage;
  finalState?: string;
  discardedFromStepIndex?: number;
  irreversibleSideEffects?: {
    executionId: string;
    generationStepNo?: number | null;
    sideEffectLevel: string;
    startedAt: number;
    toolName: string;
  }[];
}): TemporaryConversationRetryStepResult | null {
  const base = mapTemporaryConversationDonePayload(value);
  if (!base) {
    return null;
  }
  return {
    ...base,
    discardedFromStepIndex: value.discardedFromStepIndex ?? 0,
    irreversibleSideEffects: (value.irreversibleSideEffects ?? []).map((item) => ({
      executionId: item.executionId,
      generationStepNo: item.generationStepNo ?? null,
      sideEffectLevel: item.sideEffectLevel,
      startedAt: item.startedAt,
      toolName: item.toolName,
    })),
  };
}


function mapTemporaryConversationRecord(value: unknown): TemporaryConversationRecord | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  const branchId = readOptionalString(record?.branch_id);
  const kind = readOptionalString(record?.kind);
  const status = readOptionalString(record?.status) as TemporaryConversationStatus | undefined;
  const retentionPolicy = readOptionalString(record?.retention_policy) as TemporaryConversationRetentionPolicy | undefined;
  const visibility = readOptionalString(record?.visibility) as TemporaryConversationVisibility | undefined;
  const createdAt = readNullableNumber(record?.created_at);
  const updatedAt = readNullableNumber(record?.updated_at);
  const lastActivityAt = readNullableNumber(record?.last_activity_at);

  if (!id || !branchId || kind !== "temporary" || !status || !retentionPolicy || !visibility || createdAt === null || updatedAt === null || lastActivityAt === null) {
    return null;
  }

  return {
    id,
    workspaceId: readNullableString(record?.workspace_id),
    projectId: readNullableString(record?.project_id),
    sourceSessionId: readNullableString(record?.source_session_id),
    branchId,
    kind: "temporary",
    title: readNullableString(record?.title),
    purpose: readNullableString(record?.purpose),
    status,
    retentionPolicy,
    visibility,
    createdAt,
    updatedAt,
    lastActivityAt,
    expiresAt: readNullableNumber(record?.expires_at),
    finalizedAt: readNullableNumber(record?.finalized_at),
    discardedAt: readNullableNumber(record?.discarded_at),
    cancelledAt: readNullableNumber(record?.cancelled_at),
    cleanedAt: readNullableNumber(record?.cleaned_at),
  };
}

function mapTemporaryConversationMessageRef(value: unknown): TemporaryConversationMessageRef {
  const record = readRecord(value);
  return {
    conversationId: readString(record?.conversation_id),
    floorId: readString(record?.floor_id),
    pageId: readString(record?.page_id),
    messageId: readString(record?.message_id),
    seq: Number(record?.seq ?? 0),
    role: readString(record?.role) as TemporaryConversationMessageRef["role"],
  };
}

function mapTemporaryConversationResult(value: unknown): TemporaryConversationResult | null {
  const record = readRecord(value);
  const totalUsage = toApiUsage(record?.total_usage);
  const conversationId = readOptionalString(record?.conversation_id);
  const branchId = readOptionalString(record?.branch_id);
  const floorId = readOptionalString(record?.floor_id);
  const floorNo = readNullableNumber(record?.floor_no);
  const pageId = readOptionalString(record?.page_id);

  if (!conversationId || !branchId || !floorId || floorNo === null || !pageId) {
    return null;
  }

  return {
    conversationId,
    branchId,
    floorId,
    floorNo,
    pageId,
    generatedText: readString(record?.generated_text, ""),
    inputTokens: resolveInputTokens(totalUsage),
    outputTokens: resolveOutputTokens(totalUsage),
    totalTokens: resolveTotalTokens(totalUsage),
    totalUsage,
    finalState: readOptionalString(record?.final_state),
  };
}

function mapTemporaryConversationDonePayload(value: {
  branchId?: string;
  conversationId?: string;
  floorId: string;
  floorNo: number;
  generatedText?: string;
  pageId?: string;
  totalUsage: ApiUsage;
  finalState?: string;
}): TemporaryConversationResult | null {
  if (!value.conversationId || !value.branchId || !value.pageId) {
    return null;
  }

  return {
    conversationId: value.conversationId,
    branchId: value.branchId,
    floorId: value.floorId,
    floorNo: value.floorNo,
    pageId: value.pageId,
    generatedText: value.generatedText ?? "",
    inputTokens: resolveInputTokens(value.totalUsage),
    outputTokens: resolveOutputTokens(value.totalUsage),
    totalTokens: resolveTotalTokens(value.totalUsage),
    totalUsage: value.totalUsage,
    finalState: value.finalState,
  };
}

function mapTemporaryConversationTranscript(value: unknown): TemporaryConversationTranscript | null {
  const record = readRecord(value);
  const conversationId = readOptionalString(record?.conversation_id);
  const branchId = readOptionalString(record?.branch_id);
  if (!conversationId || !branchId) {
    return null;
  }

  return {
    conversationId,
    branchId,
    floors: readArray(record?.floors)
      .map(mapTemporaryConversationTranscriptFloor)
      .filter((floor): floor is TemporaryConversationTranscriptFloor => floor !== null),
  };
}

function mapTemporaryConversationTranscriptFloor(value: unknown): TemporaryConversationTranscriptFloor | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  const branchId = readOptionalString(record?.branch_id);
  const floorNo = readNullableNumber(record?.floor_no);
  const createdAt = readNullableNumber(record?.created_at);
  const updatedAt = readNullableNumber(record?.updated_at);
  const tokenIn = readNullableNumber(record?.token_in);
  const tokenOut = readNullableNumber(record?.token_out);
  const state = readOptionalString(record?.state);
  if (!id || !branchId || floorNo === null || createdAt === null || updatedAt === null || tokenIn === null || tokenOut === null || !state) {
    return null;
  }

  return {
    id,
    floorNo,
    branchId,
    parentFloorId: readNullableString(record?.parent_floor_id),
    state,
    tokenIn,
    tokenOut,
    createdAt,
    updatedAt,
    reasoningText: readNullableString(record?.reasoning_text),
    stepNarrations: readArray(record?.step_narrations)
      .map(mapTemporaryConversationTranscriptStepNarration)
      .filter((narration): narration is TemporaryConversationTranscriptStepNarration => narration !== null),
    toolExecutions: readArray(record?.tool_executions)
      .map(mapTemporaryConversationTranscriptToolExecution)
      .filter((exec): exec is TemporaryConversationTranscriptToolExecution => exec !== null),
    pages: readArray(record?.pages)
      .map(mapTemporaryConversationTranscriptPage)
      .filter((page): page is TemporaryConversationTranscriptPage => page !== null),
  };
}

function mapTemporaryConversationTranscriptToolExecution(
  value: unknown,
): TemporaryConversationTranscriptToolExecution | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  const toolName = readOptionalString(record?.tool_name);
  const status = readOptionalString(record?.status);
  const commitOutcome = readOptionalString(record?.commit_outcome);
  const durationMs = readNullableNumber(record?.duration_ms);
  const startedAt = readNullableNumber(record?.started_at);
  const attemptNo = readNullableNumber(record?.attempt_no);
  if (!id || !toolName || !status || !commitOutcome || durationMs === null || startedAt === null || attemptNo === null) {
    return null;
  }

  return {
    id,
    toolName,
    status,
    args: record?.args ?? null,
    result: record?.result ?? null,
    sideEffectLevel: readNullableString(record?.side_effect_level),
    commitOutcome,
    errorMessage: readNullableString(record?.error_message),
    durationMs,
    startedAt,
   finishedAt: readNullableNumber(record?.finished_at),
    attemptNo,
       replayParentExecutionId: readNullableString(record?.replay_parent_execution_id),
       generationStepNo: readNullableNumber(record?.generation_step_no),
  };
}

function mapTemporaryConversationTranscriptStepNarration(
  value: unknown,
): TemporaryConversationTranscriptStepNarration | null {
  const record = readRecord(value);
  const stepIndex = readNullableNumber(record?.step_index);
  const createdAt = readNullableNumber(record?.created_at);
  if (stepIndex === null || createdAt === null) {
    return null;
  }
  return {
    stepIndex,
    text: readNullableString(record?.text) ?? "",
    createdAt,
  };
}

function mapTemporaryConversationTranscriptPage(value: unknown): TemporaryConversationTranscriptPage | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  const pageNo = readNullableNumber(record?.page_no);
  const pageKind = readOptionalString(record?.page_kind);
  const version = readNullableNumber(record?.version);
  const createdAt = readNullableNumber(record?.created_at);
  const updatedAt = readNullableNumber(record?.updated_at);
  if (!id || pageNo === null || !pageKind || version === null || createdAt === null || updatedAt === null) {
    return null;
  }

  return {
    id,
    pageNo,
    pageKind,
    isActive: Boolean(record?.is_active),
    version,
    checksum: readNullableString(record?.checksum),
    createdAt,
    updatedAt,
    messages: readArray(record?.messages)
      .map(mapTemporaryConversationTranscriptMessage)
      .filter((message): message is TemporaryConversationTranscriptMessage => message !== null),
  };
}

function mapTemporaryConversationTranscriptMessage(value: unknown): TemporaryConversationTranscriptMessage | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  const seq = readNullableNumber(record?.seq);
  const role = readOptionalString(record?.role);
  const content = readOptionalString(record?.content);
  const contentFormat = readOptionalString(record?.content_format);
  const createdAt = readNullableNumber(record?.created_at);
  if (!id || seq === null || !role || content === undefined || !contentFormat || createdAt === null) {
    return null;
  }

  return {
    id,
    seq,
    role,
    content,
    contentFormat,
    isHidden: Boolean(record?.is_hidden),
    source: readNullableString(record?.source),
    createdAt,
  };
}

function mapTemporaryConversationInspect(value: unknown): TemporaryConversationInspect | null {
  const record = readRecord(value);
  const conversation = mapTemporaryConversationRecord(record?.conversation);
  if (!conversation) {
    return null;
  }

  const sourceSnapshot = readRecord(record?.source_snapshot);
  const cleanup = readRecord(record?.cleanup);
  const transcript = readRecord(record?.transcript);

  return {
    conversation,
    agentPrivate: Boolean(record?.agent_private),
    transcriptRestricted: Boolean(record?.transcript_restricted),
    sourceSnapshot: {
      digest: readNullableString(sourceSnapshot?.digest),
      sourceSessionId: readNullableString(sourceSnapshot?.source_session_id),
    },
    agentOrigin: mapTemporaryConversationAgentOrigin(record?.agent_origin),
    cleanup: {
      cleaned: Boolean(cleanup?.cleaned),
      cleanedAt: readNullableNumber(cleanup?.cleaned_at),
      retentionPolicy:
        (readOptionalString(cleanup?.retention_policy) as TemporaryConversationRetentionPolicy | undefined)
        ?? conversation.retentionPolicy,
    },
    transcript: {
      conversationId: readString(transcript?.conversation_id, conversation.id),
      branchId: readString(transcript?.branch_id, conversation.branchId),
      floors: readArray(transcript?.floors)
        .map(mapTemporaryConversationInspectFloor)
        .filter((floor): floor is TemporaryConversationInspectTranscriptFloor => floor !== null),
    },
    exports: readArray(record?.exports)
      .map(mapTemporaryConversationExportRecord)
      .filter((entry): entry is TemporaryConversationExportRecord => entry !== null),
  };
}

function mapTemporaryConversationAgentOrigin(value: unknown): TemporaryConversationAgentOrigin | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const origin: TemporaryConversationAgentOrigin = {};
  const sourceAgentRunId = readOptionalString(record.source_agent_run_id);
  if (sourceAgentRunId) origin.sourceAgentRunId = sourceAgentRunId;
  const parentRunId = readOptionalString(record.parent_run_id);
  if (parentRunId) origin.parentRunId = parentRunId;
  const rootRunId = readOptionalString(record.root_run_id);
  if (rootRunId) origin.rootRunId = rootRunId;
  const sourceNodeRunId = readOptionalString(record.source_node_run_id);
  if (sourceNodeRunId) origin.sourceNodeRunId = sourceNodeRunId;
  const sourcePageId = readOptionalString(record.source_page_id);
  if (sourcePageId) origin.sourcePageId = sourcePageId;
  const sourceFloorId = readOptionalString(record.source_floor_id);
  if (sourceFloorId) origin.sourceFloorId = sourceFloorId;
  const sourceSessionId = readOptionalString(record.source_session_id);
  if (sourceSessionId) origin.sourceSessionId = sourceSessionId;
  const sourceAttemptNo = readNullableNumber(record.source_attempt_no);
  if (sourceAttemptNo !== null) origin.sourceAttemptNo = sourceAttemptNo;

  return Object.keys(origin).length > 0 ? origin : null;
}

function mapTemporaryConversationInspectFloor(value: unknown): TemporaryConversationInspectTranscriptFloor | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  const branchId = readOptionalString(record?.branch_id);
  const floorNo = readNullableNumber(record?.floor_no);
  const createdAt = readNullableNumber(record?.created_at);
  const updatedAt = readNullableNumber(record?.updated_at);
  const tokenIn = readNullableNumber(record?.token_in);
  const tokenOut = readNullableNumber(record?.token_out);
  const state = readOptionalString(record?.state);
  if (!id || !branchId || floorNo === null || createdAt === null || updatedAt === null || tokenIn === null || tokenOut === null || !state) {
    return null;
  }

  return {
    id,
    floorNo,
    branchId,
    parentFloorId: readNullableString(record?.parent_floor_id),
    state,
    tokenIn,
    tokenOut,
    createdAt,
    updatedAt,
    reasoningText: readNullableString(record?.reasoning_text),
    stepNarrations: readArray(record?.step_narrations)
      .map(mapTemporaryConversationTranscriptStepNarration)
      .filter((narration): narration is TemporaryConversationTranscriptStepNarration => narration !== null),
    pages: readArray(record?.pages)
      .map(mapTemporaryConversationInspectPage)
      .filter((page): page is TemporaryConversationInspectTranscriptPage => page !== null),
  };
}

function mapTemporaryConversationInspectPage(value: unknown): TemporaryConversationInspectTranscriptPage | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  const pageNo = readNullableNumber(record?.page_no);
  const pageKind = readOptionalString(record?.page_kind);
  const version = readNullableNumber(record?.version);
  const createdAt = readNullableNumber(record?.created_at);
  const updatedAt = readNullableNumber(record?.updated_at);
  if (!id || pageNo === null || !pageKind || version === null || createdAt === null || updatedAt === null) {
    return null;
  }

  return {
    id,
    pageNo,
    pageKind,
    isActive: Boolean(record?.is_active),
    version,
    checksum: readNullableString(record?.checksum),
    createdAt,
    updatedAt,
    messages: readArray(record?.messages)
      .map(mapTemporaryConversationInspectMessage)
      .filter((message): message is TemporaryConversationInspectTranscriptMessage => message !== null),
  };
}

function mapTemporaryConversationInspectMessage(value: unknown): TemporaryConversationInspectTranscriptMessage | null {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  const seq = readNullableNumber(record?.seq);
  const role = readOptionalString(record?.role);
  const contentFormat = readOptionalString(record?.content_format);
  const createdAt = readNullableNumber(record?.created_at);
  if (!id || seq === null || !role || !contentFormat || createdAt === null) {
    return null;
  }

  return {
    id,
    seq,
    role,
    content: readNullableString(record?.content),
    contentLength: readNullableNumber(record?.content_length) ?? 0,
    contentFormat,
    isHidden: Boolean(record?.is_hidden),
    source: readNullableString(record?.source),
    restricted: Boolean(record?.restricted),
    createdAt,
  };
}

function mapTemporaryConversationExportRecord(value: unknown): TemporaryConversationExportRecord | null {
  const record = readRecord(value);
  const stagedWriteId = readOptionalString(record?.staged_write_id);
  const targetSessionId = readOptionalString(record?.target_session_id);
  const targetPageId = readOptionalString(record?.target_page_id);
  const createdAt = readNullableNumber(record?.created_at);
  const updatedAt = readNullableNumber(record?.updated_at);
  if (!stagedWriteId || !targetSessionId || !targetPageId || createdAt === null || updatedAt === null) {
    return null;
  }

  return {
    stagedWriteId,
    deliveryTarget: readString(record?.delivery_target, "page_staged_write"),
    targetSessionId,
    targetPageId,
    sourcePageId: readNullableString(record?.source_page_id),
    status: readString(record?.status, "staged"),
    reason: readNullableString(record?.reason),
    createdAt,
    updatedAt,
    appliedAt: readNullableNumber(record?.applied_at),
    discardedAt: readNullableNumber(record?.discarded_at),
  };
}

function mapTemporaryConversationExportResult(value: unknown): TemporaryConversationExportResult | null {
  const record = readRecord(value);
  const conversationId = readOptionalString(record?.conversation_id);
  const target = readOptionalString(record?.target);
  const stagedWriteId = readOptionalString(record?.staged_write_id);
  const targetPageId = readOptionalString(record?.target_page_id);
  const sourcePageId = readOptionalString(record?.source_page_id);
  const createdAt = readNullableNumber(record?.created_at);
  const status = readOptionalString(record?.status);

  if (!conversationId || target !== "page_staged_write" || !stagedWriteId || !targetPageId || !sourcePageId || createdAt === null || status !== "staged") {
    return null;
  }

  return {
    conversationId,
    target: "page_staged_write",
    stagedWriteId,
    targetPageId,
    sourcePageId,
    createdAt,
    status: "staged",
  };
}

async function mutateTemporaryConversation(
  client: TransportClient,
  options: TemporaryConversationsRequestOptions,
  action: "finalize" | "discard" | "cancel",
): Promise<TemporaryConversationRecord> {
  const response = await client.fetchJson<Record<string, unknown>>(
    `/temporary-conversations/${encodeURIComponent(options.conversationId)}/${action}`,
    {
      headers: buildAccountHeaders(options.accountId),
      method: "POST",
    },
  );
  const record = mapTemporaryConversationRecord(readRecord(response.body)?.data);
  if (!record) {
    throw new Error(`Temporary conversation ${action} payload is missing`);
  }
  return record;
}
