import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { TavernApiError } from "../errors/tavern-api-error.js";
import {
  mapPromptDebugPayload,
  mapPromptLiveDebugOptionsRequest,
  type PromptLiveDebugOptions,
} from "../prompt-runtime.js";
import { resolveInputTokens, resolveOutputTokens, resolveTotalTokens, toApiUsage } from "../types/usage.js";
import type { RegenerateResult } from "./messages.js";
import type { RespondGenerationParams, RespondMemoryReceipt, RespondTurnConfig } from "./sessions.js";
import {
  compactObject,
  readArray,
  readBoolean,
  readNullableNumber,
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
  supersededAt: number | null;
  supersededByFloorId: string | null;
  tokenIn: number;
  tokenOut: number;
  updatedAt: number;
};

export type FloorRunType = "respond" | "regenerate_page" | "retry_turn" | "edit_and_regenerate";

export type FloorRunStatus = "running" | "completed" | "failed" | "cancelled";

export type FloorRunPhase =
  | "input_recorded"
  | "semantic_resolved"
  | "prechecked"
  | "prompt_assembled"
  | "page_generating"
  | "candidate_generated"
  | "verifier_checked"
  | "transaction_prepared"
  | "transaction_committed"
  | "post_commit_scheduled";

export type FloorRunPublicPhase = "preparing" | "generating" | "verifying" | "committing" | "post_processing";

export type FloorRunPendingOutput = {
  attemptNo: number;
  error?: string | null;
  startedAt: number;
  state: "draft" | "streaming" | "generated" | "failed";
  tempId: string;
  text: string;
  updatedAt: number;
};

export type FloorRunVerifierIssue = {
  description: string;
  severity: "warning" | "error";
};

export type FloorRunVerifierSnapshot = {
  issues?: FloorRunVerifierIssue[] | null;
  status: "pending" | "passed" | "warned" | "blocked" | "skipped";
  suggestion?: string | null;
};

export type FloorCommittedResultSnapshot = {
  assistantMessageId: string;
  committedAt: number;
  floorId: string;
  generatedText: string;
  inputTokens: number;
  outputPageId: string;
  outputTokens: number;
  summaries: string[];
  totalTokens: number;
  totalUsage: ReturnType<typeof toApiUsage>;
  verifier?: FloorRunVerifierSnapshot | null;
};

export type FloorBranchResult = {
  branchId: string;
  sessionId: string;
  sourceFloorId: string;
  sourceFloorNo: number;
};

export type FloorsCreateOptions = {
  accountId?: AccountIdHint;
  branchId?: string;
  floorNo: number;
  parentFloorId?: string;
  sessionId: string;
  state?: FloorState;
  tokenIn?: number;
  tokenOut?: number;
};

export type FloorsListOptions = {
  accountId?: AccountIdHint;
  branchId?: string;
  limit?: number;
  offset?: number;
  sessionId?: string;
  sortBy?: "created_at" | "floor_no" | "updated_at";
  sortOrder?: "asc" | "desc";
  state?: FloorState;
};

export type FloorsGetDetailOptions = {
  accountId?: AccountIdHint;
  floorId: string;
};

export type FloorRunSnapshot = {
  attemptNo: number;
  completedAt?: number | null;
  error?: { code: string; message: string } | null;
  pendingOutput?: FloorRunPendingOutput | null;
  phase: FloorRunPhase;
  phaseSeq: number;
  publicPhase: FloorRunPublicPhase;
  runId: string;
  runType: FloorRunType;
  startedAt: number;
  status: FloorRunStatus;
  updatedAt: number;
  verifier?: FloorRunVerifierSnapshot | null;
};

export type FloorRunRecord = { floorId: string; state: FloorState; run: FloorRunSnapshot | null; };

export type FloorsGetRunOptions = FloorsGetDetailOptions;

export type FloorsGetResultOptions = FloorsGetDetailOptions;

export type FloorsUpdateOptions = {
  accountId?: AccountIdHint;
  branchId?: string;
  floorId: string;
  floorNo?: number;
  parentFloorId?: string;
  state?: FloorState;
  tokenIn?: number;
  tokenOut?: number;
};

export type FloorsRemoveOptions = {
  accountId?: AccountIdHint;
  floorId: string;
};

export type FloorsBranchOptions = {
  accountId?: AccountIdHint;
  branchId?: string;
  floorId: string;
};

export type FloorsRetryOptions = {
  accountId?: AccountIdHint;
  confirmedExecutionIds?: string[];
  confirmedSessionStateMutationIds?: string[];
  config?: RespondTurnConfig;
  floorId: string;
  generationParams?: RespondGenerationParams;
  debugOptions?: PromptLiveDebugOptions;
};

export type FloorsResource = {
  branch(options: FloorsBranchOptions): Promise<FloorBranchResult>;
  create(options: FloorsCreateOptions): Promise<FloorRecord>;
  getDetail(options: FloorsGetDetailOptions): Promise<FloorRecord>;
  getRun(options: FloorsGetRunOptions): Promise<FloorRunRecord>;
  getResult(options: FloorsGetResultOptions): Promise<FloorCommittedResultSnapshot>;
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
    async getRun(options): Promise<FloorRunRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/floors/${encodeURIComponent(options.floorId)}/run`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapFloorRunRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Floor run payload is missing");
      }

      return payload;
    },
    async getResult(options): Promise<FloorCommittedResultSnapshot> {
      const response = await client.fetchJson<Record<string, unknown>>(`/floors/${encodeURIComponent(options.floorId)}/result`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapFloorCommittedResultSnapshot(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Floor committed result payload is missing");
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
          confirmed_execution_ids: options.confirmedExecutionIds,
          confirmed_session_state_mutation_ids: options.confirmedSessionStateMutationIds,
          config: options.config,
          debug_options: mapPromptLiveDebugOptionsRequest(options.debugOptions),
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
    supersededAt: readNullableNumber(record.superseded_at),
    supersededByFloorId: readNullableString(record.superseded_by_floor_id),
    tokenIn: readNumber(record.token_in),
    tokenOut: readNumber(record.token_out),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapFloorRunRecord(value: unknown): FloorRunRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    floorId: readString(record.floor_id),
    state: readString(record.state) as FloorState,
    run: mapFloorRunSnapshot(record.run),
  };
}

function mapFloorRunSnapshot(value: unknown): FloorRunSnapshot | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const pendingOutputRecord = readRecord(record.pending_output);
  const verifierRecord = readRecord(record.verifier);
  const errorRecord = readRecord(record.error);

  return {
    attemptNo: readNumber(record.attempt_no),
    completedAt: readNullableNumber(record.completed_at),
    error: errorRecord
      ? { code: readString(errorRecord.code), message: readString(errorRecord.message) }
      : null,
    pendingOutput: pendingOutputRecord
      ? {
          attemptNo: readNumber(pendingOutputRecord.attempt_no),
          error: readNullableString(pendingOutputRecord.error),
          startedAt: readNumber(pendingOutputRecord.started_at),
          state: readString(pendingOutputRecord.state) as FloorRunPendingOutput["state"],
          tempId: readString(pendingOutputRecord.temp_id),
          text: readString(pendingOutputRecord.text),
          updatedAt: readNumber(pendingOutputRecord.updated_at),
        }
      : null,
    phase: readString(record.phase) as FloorRunPhase,
    phaseSeq: readNumber(record.phase_seq),
    publicPhase: readString(record.public_phase) as FloorRunPublicPhase,
    runId: readString(record.run_id),
    runType: readString(record.run_type) as FloorRunType,
    startedAt: readNumber(record.started_at),
    status: readString(record.status) as FloorRunStatus,
    updatedAt: readNumber(record.updated_at),
    verifier: verifierRecord ? { issues: readArray(verifierRecord.issues).map((item) => readRecord(item)).filter((item): item is Record<string, unknown> => item !== null).map((item) => ({ description: readString(item.description), severity: readString(item.severity) as FloorRunVerifierIssue["severity"] })), status: readString(verifierRecord.status) as FloorRunVerifierSnapshot["status"], suggestion: readNullableString(verifierRecord.suggestion) } : null,
  };
}

function mapFloorCommittedResultSnapshot(value: unknown): FloorCommittedResultSnapshot | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const totalUsage = toApiUsage(record.usage);
  const verifierRecord = readRecord(record.verifier);

  return {
    assistantMessageId: readString(record.assistant_message_id),
    committedAt: readNumber(record.committed_at),
    floorId: readString(record.floor_id),
    generatedText: readString(record.generated_text),
    inputTokens: resolveInputTokens(totalUsage),
    outputPageId: readString(record.output_page_id),
    outputTokens: resolveOutputTokens(totalUsage),
    summaries: mapStringArray(record.summaries),
    totalTokens: resolveTotalTokens(totalUsage),
    totalUsage,
    verifier: verifierRecord ? { issues: readArray(verifierRecord.issues).map((item) => readRecord(item)).filter((item): item is Record<string, unknown> => item !== null).map((item) => ({ description: readString(item.description), severity: readString(item.severity) as FloorRunVerifierIssue["severity"] })), status: readString(verifierRecord.status) as FloorRunVerifierSnapshot["status"], suggestion: readNullableString(verifierRecord.suggestion) } : null,
  };
}

function mapStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readOptionalString(item))
    .filter((item): item is string => item !== undefined);
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
    memory: readRespondMemoryReceipt(data?.memory),
    summaries: mapStringArray(data?.summaries),
    totalTokens: resolveTotalTokens(totalUsage),
    totalUsage,
    ...mapPromptDebugPayload(data),
  };
}
