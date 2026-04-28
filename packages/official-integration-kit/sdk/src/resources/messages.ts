import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { TavernApiError } from "../errors/tavern-api-error.js";
import {
  mapPromptDebugPayload,
  mapPromptLiveDebugOptionsRequest,
  type PromptLiveDebugOptions,
} from "../prompt-runtime.js";
import { resolveInputTokens, resolveOutputTokens, resolveTotalTokens, toApiUsage } from "../types/usage.js";
import type { RespondGenerationParams, RespondMemoryReceipt, RespondResult, RespondTurnConfig, TurnSessionStateWrite } from "./sessions.js";
import {
  compactObject,
  readArray,
  readBoolean,
  readNullableString,
  readNumber,
  readOptionalString,
  readRecord,
  readString,
} from "./utils.js";

export type MessageRole = "user" | "assistant" | "system" | "narrator";
export type MessageContentFormat = "text" | "markdown" | "json";

export type MessageRecord = {
  content: string;
  contentFormat: MessageContentFormat;
  createdAt: number;
  id: string;
  isHidden: boolean;
  pageId: string;
  role: MessageRole;
  seq: number;
  source: string | null;
  tokenCount: number;
};

export type MessageUpdateResult = {
  content: string;
  id: string;
  role: string;
};

export type RegenerateResult = RespondResult & {
  sourceFloorId?: string;
  sourceMessageId?: string;
};

export type MessagesCreateOptions = {
  accountId?: AccountIdHint;
  content: string;
  contentFormat?: MessageContentFormat;
  isHidden?: boolean;
  pageId: string;
  role: MessageRole;
  seq: number;
  source?: string;
  tokenCount?: number;
};

export type MessagesListOptions = {
  accountId?: AccountIdHint;
  isHidden?: boolean;
  limit?: number;
  offset?: number;
  pageId?: string;
  role?: MessageRole;
  sortBy?: "created_at" | "seq";
  sortOrder?: "asc" | "desc";
};

export type MessagesGetDetailOptions = {
  accountId?: AccountIdHint;
  messageId: string;
};

export type MessagesUpdateOptions = {
  accountId?: AccountIdHint;
  content?: string;
  contentFormat?: MessageContentFormat;
  isHidden?: boolean;
  messageId: string;
  role?: MessageRole;
  seq?: number;
  source?: string;
  tokenCount?: number;
};

export type MessagesRemoveOptions = {
  accountId?: AccountIdHint;
  messageId: string;
};

export type MessagesBatchUpdateVisibilityOptions = {
  accountId?: AccountIdHint;
  ids: string[];
  isHidden: boolean;
};

export type MessagesBatchUpdateVisibilityResult = {
  meta: {
    isHidden: boolean;
    notFound: number;
    total: number;
    updated: number;
  };
  results: Array<{
    action: "not_found" | "updated" | string;
    data?: MessageRecord;
    id: string;
    index: number;
  }>;
};

export type MessagesBatchDeleteOptions = {
  accountId?: AccountIdHint;
  ids: string[];
};

export type MessagesBatchDeleteResult = {
  meta: {
    deleted: number;
    notFound: number;
    total: number;
  };
  results: Array<{
    action: "deleted" | "not_found" | string;
    id: string;
    index: number;
  }>;
};

export type MessagesEditAndRegenerateOptions = {
  accountId?: AccountIdHint;
  branchId?: string;
  confirmedExecutionIds?: string[];
  confirmedSessionStateMutationIds?: string[];
  config?: RespondTurnConfig;
  content: string;
  generationParams?: RespondGenerationParams;
  messageId: string;
  debugOptions?: PromptLiveDebugOptions;
  sessionStateWrites?: TurnSessionStateWrite[];
};

export type MessagesResource = {
  batchDelete(options: MessagesBatchDeleteOptions): Promise<MessagesBatchDeleteResult>;
  batchUpdateVisibility(options: MessagesBatchUpdateVisibilityOptions): Promise<MessagesBatchUpdateVisibilityResult>;
  create(options: MessagesCreateOptions): Promise<MessageRecord>;
  editAndRegenerate(options: MessagesEditAndRegenerateOptions): Promise<RegenerateResult>;
  getDetail(options: MessagesGetDetailOptions): Promise<MessageRecord>;
  list(options?: MessagesListOptions): Promise<MessageRecord[]>;
  remove(options: MessagesRemoveOptions): Promise<boolean>;
  update(options: MessagesUpdateOptions): Promise<MessageUpdateResult | null>;
};

export function createMessagesResource(client: TransportClient): MessagesResource {
  return {
    async batchDelete(options): Promise<MessagesBatchDeleteResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/messages/batch/delete", {
        body: {
          ids: options.ids,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapBatchDeletePayload(response.body);
    },
    async batchUpdateVisibility(options): Promise<MessagesBatchUpdateVisibilityResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/messages/batch/visibility", {
        body: {
          ids: options.ids,
          is_hidden: options.isHidden,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      return mapBatchUpdateVisibilityPayload(response.body);
    },
    async create(options): Promise<MessageRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/messages", {
        body: compactObject({
          content: options.content,
          content_format: options.contentFormat,
          is_hidden: options.isHidden,
          page_id: options.pageId,
          role: options.role,
          seq: options.seq,
          source: options.source,
          token_count: options.tokenCount,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapMessageRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Message create payload is missing");
      }

      return payload;
    },
    async editAndRegenerate(options): Promise<RegenerateResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/messages/${encodeURIComponent(options.messageId)}/edit-and-regenerate`,
        {
          body: compactObject({
            branch_id: options.branchId,
            confirmed_execution_ids: options.confirmedExecutionIds,
            confirmed_session_state_mutation_ids: options.confirmedSessionStateMutationIds,
            config: options.config,
            content: options.content,
            debug_options: mapPromptLiveDebugOptionsRequest(options.debugOptions),
            generation_params: mapGenerationParams(options.generationParams),
            session_state_writes: mapTurnSessionStateWrites(options.sessionStateWrites),
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      return mapRegeneratePayload(response.body, "Edit-and-regenerate API returned an invalid payload");
    },
    async getDetail(options): Promise<MessageRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/messages/${encodeURIComponent(options.messageId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapMessageRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Message detail payload is missing");
      }

      return payload;
    },
    async list(options: MessagesListOptions = {}): Promise<MessageRecord[]> {
      const response = await client.get("/messages", {
        headers: buildAccountHeaders(options.accountId),
        query: compactObject({
          is_hidden: options.isHidden,
          limit: options.limit,
          offset: options.offset,
          page_id: options.pageId,
          role: options.role,
          sort_by: options.sortBy,
          sort_order: options.sortOrder,
        }),
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapMessageRecord)
        .filter((item): item is MessageRecord => item !== null);
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/messages/${encodeURIComponent(options.messageId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async update(options): Promise<MessageUpdateResult | null> {
      const response = await client.patch("/messages/{id}", {
        body: compactObject({
          content: options.content,
          content_format: options.contentFormat,
          is_hidden: options.isHidden,
          role: options.role,
          seq: options.seq,
          source: options.source,
          token_count: options.tokenCount,
        }),
        headers: buildAccountHeaders(options.accountId),
        path: {
          id: options.messageId,
        },
      });

      const payload = readRecord(response.body);
      const data = readRecord(payload?.data);
      if (!data) {
        return null;
      }

      return {
        content: readString(data.content),
        id: readString(data.id),
        role: readString(data.role),
      };
    },
  };
}

function mapGenerationParams(generationParams?: RespondGenerationParams): Record<string, unknown> | undefined {
  if (!generationParams) {
    return undefined;
  }

  const mapped = compactObject({
    frequency_penalty: generationParams.frequencyPenalty,
    max_output_tokens: generationParams.maxOutputTokens,
    presence_penalty: generationParams.presencePenalty,
    reasoning_effort: generationParams.reasoningEffort,
    stop_sequences: generationParams.stopSequences,
    stream: generationParams.stream,
    temperature: generationParams.temperature,
    top_k: generationParams.topK,
    top_p: generationParams.topP,
  });

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mapMessageRecord(value: unknown): MessageRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    content: readString(record.content),
    contentFormat: readString(record.content_format, "text") as MessageContentFormat,
    createdAt: readNumber(record.created_at),
    id: readString(record.id),
    isHidden: readBoolean(record.is_hidden),
    pageId: readString(record.page_id),
    role: readString(record.role) as MessageRole,
    seq: readNumber(record.seq),
    source: readNullableString(record.source),
    tokenCount: readNumber(record.token_count),
  };
}

function mapBatchUpdateVisibilityPayload(payload: Record<string, unknown> | null): MessagesBatchUpdateVisibilityResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      isHidden: readBoolean(meta?.is_hidden),
      notFound: readNumber(meta?.not_found),
      total: readNumber(meta?.total),
      updated: readNumber(meta?.updated),
    },
    results: readArray(data?.results)
      .map(mapVisibilityBatchItem)
      .filter((item): item is MessagesBatchUpdateVisibilityResult["results"][number] => item !== null),
  };
}

function mapVisibilityBatchItem(value: unknown): MessagesBatchUpdateVisibilityResult["results"][number] | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const data = mapMessageRecord(record.data);

  return {
    action: readString(record.action),
    data: data ?? undefined,
    id: readString(record.id),
    index: readNumber(record.index),
  };
}

function mapBatchDeletePayload(payload: Record<string, unknown> | null): MessagesBatchDeleteResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      deleted: readNumber(meta?.deleted),
      notFound: readNumber(meta?.not_found),
      total: readNumber(meta?.total),
    },
    results: readArray(data?.results)
      .map(mapDeleteBatchItem)
      .filter((item): item is MessagesBatchDeleteResult["results"][number] => item !== null),
  };
}

function mapDeleteBatchItem(value: unknown): MessagesBatchDeleteResult["results"][number] | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    action: readString(record.action),
    id: readString(record.id),
    index: readNumber(record.index),
  };
}

function mapStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readOptionalString(item))
    .filter((item): item is string => item !== undefined);
}

function mapTurnSessionStateWrites(writes?: TurnSessionStateWrite[]): Record<string, unknown>[] | undefined {
  if (!writes || writes.length === 0) {
    return undefined;
  }

  return writes.map((write) => {
    if ("delete" in write && write.delete === true) {
      return {
        namespace: write.namespace,
        slot: write.slot,
        delete: true,
      };
    }

    return {
      namespace: write.namespace,
      slot: write.slot,
      value: "value" in write ? write.value : undefined,
    };
  });
}

function readRespondMemoryReceipt(value: unknown): RespondMemoryReceipt | undefined {
  const record = readRecord(value);
  const mode = readOptionalString(record?.mode);
  const status = readOptionalString(record?.status);

  if ((mode !== "sync" && mode !== "async") || (status !== "applied" && status !== "queued")) {
    return undefined;
  }

  return {
    jobId: readNullableString(record?.job_id),
    mode,
    status,
  };
}

function mapRegeneratePayload(payload: Record<string, unknown> | null, errorMessage: string): RegenerateResult {
  const data = readRecord(payload?.data);
  const floorId = readOptionalString(data?.floor_id);
  const floorNo = typeof data?.floor_no === "number" ? data.floor_no : undefined;

  if (!floorId || floorNo === undefined) {
    throw new TavernApiError({
      message: errorMessage,
      status: 500,
    });
  }

  const totalUsage = toApiUsage(data?.total_usage);

  return {
    branchId: readOptionalString(data?.branch_id),
    finalState:
      data?.final_state === "draft" ||
      data?.final_state === "generating" ||
      data?.final_state === "committed" ||
      data?.final_state === "failed"
        ? data.final_state
        : undefined,
    floorId,
    floorNo,
    generatedText: readString(data?.generated_text),
    inputTokens: resolveInputTokens(totalUsage),
    outputTokens: resolveOutputTokens(totalUsage),
    memory: readRespondMemoryReceipt(data?.memory),
    sourceFloorId: readOptionalString(data?.source_floor_id),
    sourceMessageId: readOptionalString(data?.source_message_id),
    summaries: mapStringArray(data?.summaries),
    totalTokens: resolveTotalTokens(totalUsage),
    totalUsage,
    ...mapPromptDebugPayload(data),
  };
}
