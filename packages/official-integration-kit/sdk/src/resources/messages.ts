import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import { TavernApiError } from "../errors/tavern-api-error.js";
import { resolveTotalTokens, toApiUsage, type ApiUsage } from "../types/usage.js";
import type { RespondGenerationParams, RespondTurnConfig } from "./sessions.js";
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

export type RegenerateResult = {
  branchId?: string;
  floorId: string;
  floorNo: number;
  totalTokens: number;
  totalUsage: ApiUsage;
};

export type MessagesCreateOptions = {
  accountId?: string;
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
  accountId?: string;
  isHidden?: boolean;
  limit?: number;
  offset?: number;
  pageId?: string;
  role?: MessageRole;
  sortBy?: "created_at" | "seq";
  sortOrder?: "asc" | "desc";
};

export type MessagesGetDetailOptions = {
  accountId?: string;
  messageId: string;
};

export type MessagesUpdateOptions = {
  accountId?: string;
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
  accountId?: string;
  messageId: string;
};

export type MessagesBatchUpdateVisibilityOptions = {
  accountId?: string;
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
  accountId?: string;
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
  accountId?: string;
  branchId?: string;
  config?: RespondTurnConfig;
  content: string;
  generationParams?: RespondGenerationParams;
  messageId: string;
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
            config: options.config,
            content: options.content,
            generation_params: mapGenerationParams(options.generationParams),
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
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
          page_id: options.pageId,
          role: options.role,
          sort_by: options.sortBy ?? "created_at",
          sort_order: options.sortOrder ?? "desc",
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
    floorId,
    floorNo,
    totalTokens: resolveTotalTokens(totalUsage),
    totalUsage,
  };
}
