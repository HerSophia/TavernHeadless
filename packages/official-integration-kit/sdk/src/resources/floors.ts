import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import { TavernApiError } from "../errors/tavern-api-error.js";
import { resolveInputTokens, resolveOutputTokens, resolveTotalTokens, toApiUsage } from "../types/usage.js";
import type { RegenerateResult } from "./messages.js";
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

export type FloorState = "draft" | "generating" | "committed" | "failed";

export type FloorRecord = {
  branchId: string;
  createdAt: number;
  floorNo: number;
  id: string;
  parentFloorId: string | null;
  sessionId: string;
  state: FloorState;
  tokenIn: number;
  tokenOut: number;
  updatedAt: number;
};

export type FloorBranchResult = {
  branchId: string;
  sessionId: string;
  sourceFloorId: string;
  sourceFloorNo: number;
};

export type FloorsCreateOptions = {
  accountId?: string;
  branchId?: string;
  floorNo: number;
  parentFloorId?: string;
  sessionId: string;
  state?: FloorState;
  tokenIn?: number;
  tokenOut?: number;
};

export type FloorsListOptions = {
  accountId?: string;
  branchId?: string;
  limit?: number;
  offset?: number;
  sessionId?: string;
  sortBy?: "created_at" | "floor_no" | "updated_at";
  sortOrder?: "asc" | "desc";
  state?: FloorState;
};

export type FloorsGetDetailOptions = {
  accountId?: string;
  floorId: string;
};

export type FloorsUpdateOptions = {
  accountId?: string;
  branchId?: string;
  floorId: string;
  floorNo?: number;
  parentFloorId?: string;
  state?: FloorState;
  tokenIn?: number;
  tokenOut?: number;
};

export type FloorsRemoveOptions = {
  accountId?: string;
  floorId: string;
};

export type FloorsBranchOptions = {
  accountId?: string;
  branchId?: string;
  floorId: string;
};

export type FloorsRetryOptions = {
  accountId?: string;
  config?: RespondTurnConfig;
  floorId: string;
  generationParams?: RespondGenerationParams;
};

export type FloorsResource = {
  branch(options: FloorsBranchOptions): Promise<FloorBranchResult>;
  create(options: FloorsCreateOptions): Promise<FloorRecord>;
  getDetail(options: FloorsGetDetailOptions): Promise<FloorRecord>;
  list(options?: FloorsListOptions): Promise<FloorRecord[]>;
  remove(options: FloorsRemoveOptions): Promise<boolean>;
  retry(options: FloorsRetryOptions): Promise<RegenerateResult>;
  update(options: FloorsUpdateOptions): Promise<FloorRecord>;
};

export function createFloorsResource(client: TransportClient): FloorsResource {
  return {
    async branch(options): Promise<FloorBranchResult> {
      const response = await client.fetchJson<Record<string, unknown>>(`/floors/${encodeURIComponent(options.floorId)}/branch`, {
        body: compactObject({
          branch_id: options.branchId,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const data = readRecord(readRecord(response.body)?.data);
      return {
        branchId: readString(data?.branch_id),
        sessionId: readString(data?.session_id),
        sourceFloorId: readString(data?.source_floor_id),
        sourceFloorNo: readNumber(data?.source_floor_no),
      };
    },
    async create(options): Promise<FloorRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/floors", {
        body: compactObject({
          branch_id: options.branchId,
          floor_no: options.floorNo,
          parent_floor_id: options.parentFloorId,
          session_id: options.sessionId,
          state: options.state,
          token_in: options.tokenIn,
          token_out: options.tokenOut,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapFloorRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Floor create payload is missing");
      }

      return payload;
    },
    async getDetail(options): Promise<FloorRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/floors/${encodeURIComponent(options.floorId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapFloorRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Floor detail payload is missing");
      }

      return payload;
    },
    async list(options: FloorsListOptions = {}): Promise<FloorRecord[]> {
      const response = await client.get("/floors", {
        headers: buildAccountHeaders(options.accountId),
        query: compactObject({
          branch_id: options.branchId,
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
          session_id: options.sessionId,
          sort_by: options.sortBy ?? "created_at",
          sort_order: options.sortOrder ?? "desc",
          state: options.state,
        }),
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapFloorRecord)
        .filter((item): item is FloorRecord => item !== null);
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/floors/${encodeURIComponent(options.floorId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async retry(options): Promise<RegenerateResult> {
      const response = await client.fetchJson<Record<string, unknown>>(`/floors/${encodeURIComponent(options.floorId)}/retry`, {
        body: compactObject({
          config: options.config,
          generation_params: mapGenerationParams(options.generationParams),
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapRetryPayload(response.body);
    },
    async update(options): Promise<FloorRecord> {
      const response = await client.patch("/floors/{id}", {
        body: compactObject({
          branch_id: options.branchId,
          floor_no: options.floorNo,
          parent_floor_id: options.parentFloorId,
          state: options.state,
          token_in: options.tokenIn,
          token_out: options.tokenOut,
        }),
        headers: buildAccountHeaders(options.accountId),
        path: {
          id: options.floorId,
        },
      });

      const payload = mapFloorRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Floor update payload is missing");
      }

      return payload;
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

function mapFloorRecord(value: unknown): FloorRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    branchId: readString(record.branch_id),
    createdAt: readNumber(record.created_at),
    floorNo: readNumber(record.floor_no),
    id: readString(record.id),
    parentFloorId: readNullableString(record.parent_floor_id),
    sessionId: readString(record.session_id),
    state: readString(record.state) as FloorState,
    tokenIn: readNumber(record.token_in),
    tokenOut: readNumber(record.token_out),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readOptionalString(item))
    .filter((item): item is string => item !== undefined);
}

function mapRetryPayload(payload: Record<string, unknown> | null): RegenerateResult {
  const data = readRecord(payload?.data);
  const floorId = readOptionalString(data?.floor_id);
  const floorNo = typeof data?.floor_no === "number" ? data.floor_no : undefined;

  if (!floorId || floorNo === undefined) {
    throw new TavernApiError({
      message: "Retry-floor API returned an invalid payload",
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
    summaries: mapStringArray(data?.summaries),
    totalTokens: resolveTotalTokens(totalUsage),
    totalUsage,
  };
}
