import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { readSseStream } from "../stream/read-sse.js";
import type { RespondStreamCallbacks } from "../stream/event-types.js";
import { resolveInputTokens, resolveOutputTokens, resolveTotalTokens, toApiUsage, type ApiUsage } from "../types/usage.js";
import {
  compactObject,
  readArray,
  readNullableNumber,
  readNullableString,
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

export type TemporaryConversationRespondOptions = {
  accountId?: AccountIdHint;
  conversationId: string;
  inputMessage?: TemporaryConversationMessageInput;
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

export type TemporaryConversationsRequestOptions = {
  accountId?: AccountIdHint;
  conversationId: string;
};

export type TemporaryConversationsResource = {
  getDetail(options: TemporaryConversationsRequestOptions): Promise<TemporaryConversationRecord>;
  appendMessage(options: TemporaryConversationAppendMessageOptions): Promise<TemporaryConversationMessageRef>;
  respond(options: TemporaryConversationRespondOptions): Promise<TemporaryConversationResult>;
  respondStream(options: TemporaryConversationRespondStreamOptions): Promise<TemporaryConversationResult>;
  getTranscript(options: TemporaryConversationsRequestOptions): Promise<TemporaryConversationTranscript>;
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
  return compactObject({
    input_message: options.inputMessage
      ? {
          role: options.inputMessage.role,
          content: options.inputMessage.content,
        }
      : undefined,
  });
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
    pages: readArray(record?.pages)
      .map(mapTemporaryConversationTranscriptPage)
      .filter((page): page is TemporaryConversationTranscriptPage => page !== null),
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
