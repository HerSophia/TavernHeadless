import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { TavernApiError } from "../errors/tavern-api-error.js";
import { readSseStream } from "../stream/read-sse.js";
import type { RespondStreamCallbacks } from "../stream/event-types.js";
import { resolveInputTokens, resolveOutputTokens, resolveTotalTokens, toApiUsage, type ApiUsage } from "../types/usage.js";
import {
  buildQueryString,
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

export type RespondTurnConfig = {
  enableDirector?: boolean;
  enableMemoryConsolidation?: boolean;
  enableVerifier?: boolean;
  maxRetries?: number;
  verifierFailStrategy?: "warn" | "block" | "retry";
};

export type RespondGenerationParams = {
  frequencyPenalty?: number;
  maxOutputTokens?: number;
  presencePenalty?: number;
  reasoningEffort?: "low" | "medium" | "high";
  stopSequences?: string[];
  stream?: boolean;
  temperature?: number;
  topK?: number;
  topP?: number;
};

export type SessionCharacterBinding = {
  characterId: string | null;
  characterVersionId: string | null;
  snapshotSummary: {
    hasGreeting: boolean;
    name: string;
  } | null;
  syncPolicy: "pin" | "manual" | "force" | "";
};

export type SessionUserBinding = {
  snapshotSummary: {
    name: string;
  } | null;
  userId: string | null;
};

export type SessionRecord = {
  characterBinding: {
    snapshotSummary: {
      hasGreeting: boolean;
      name: string;
    } | null;
  } | null;
  createdAt: number;
  id: string;
  status: string;
  title: string | null;
  updatedAt: number;
  userBinding: {
    snapshotSummary: {
      name: string;
    } | null;
  } | null;
  worldbookProfileId: string | null;
};

export type SessionDetail = {
  characterBinding: SessionCharacterBinding | null;
  createdAt: number;
  id: string;
  metadata: unknown | null;
  modelName: string | null;
  modelParams: unknown | null;
  modelProvider: string | null;
  presetId: string | null;
  promptMode: string | null;
  regexProfileId: string | null;
  status: string;
  title: string | null;
  updatedAt: number;
  userBinding: SessionUserBinding | null;
  worldbookProfileId: string | null;
};

export type TimelineMessage = {
  content: string;
  contentFormat: string;
  id: string;
  role: string;
  seq: number;
};

export type TimelinePage = {
  id: string;
  messages: TimelineMessage[];
  pageKind: string;
  pageNo: number;
  version: number;
};

export type TimelineFloor = {
  activePage: TimelinePage | null;
  createdAt: number;
  floorNo: number;
  id: string;
  pageCount: number;
  state: string;
  tokenIn: number;
  tokenOut: number;
};

export type SessionTimeline = {
  branchId?: string;
  floors: TimelineFloor[];
  sessionId?: string;
};

export type SessionActiveRunSummary = {
  activeRunId?: string;
  activeRunType?: "respond" | "regenerate_page" | "retry_turn" | "edit_and_regenerate";
  branchId: string;
  busy: boolean;
  latestFloorId?: string;
  publicPhase?: "preparing" | "generating" | "verifying" | "committing" | "post_processing";
  updatedAt: number;
};

export type SessionActiveRunRecord = {
  activeRun: SessionActiveRunSummary | null;
  sessionId: string;
};

export type RespondFinalState = "draft" | "generating" | "committed" | "failed";

export type RespondResult = {
  branchId?: string;
  finalState?: RespondFinalState;
  floorId: string;
  floorNo: number;
  generatedText: string;
  inputTokens: number;
  outputTokens: number;
  summaries: string[];
  totalTokens: number;
  totalUsage: ApiUsage;
};

export type SessionRegenerateResult = RespondResult & {
  previousFloorId?: string;
};

export type SessionBranchSummary = {
  branchId: string;
  floorCount: number;
  latestFloorId: string;
  latestFloorNo: number;
  latestState: string;
  updatedAt: number;
};

export type SessionBranchFloorSummary = {
  branchId: string;
  floorNo: number;
  id: string;
  state: string;
};

export type SessionBranchDiff = {
  baseBranchId: string;
  baseOnlyFloors: SessionBranchFloorSummary[];
  forkFloorNo: number | null;
  sessionId: string;
  sharedFloorNos: number[];
  targetBranchId: string;
  targetOnlyFloors: SessionBranchFloorSummary[];
};

export type SessionToolPermissions = {
  allowIrreversible?: boolean;
  enabled?: boolean;
  maxCallsPerTurn?: number;
  maxStepsPerGeneration?: number;
  slotAllowList?: Record<string, string[]>;
  slotDenyList?: Record<string, string[]>;
};

export type SessionRuntimeToolProviderType = "builtin" | "preset" | "mcp";
export type SessionRuntimeToolSource = "builtin" | "resource" | "custom" | "preset" | "character" | "mcp";
export type SessionRuntimeToolAvailability = "available" | "unavailable" | "conflict";
export type SessionRuntimeToolReplaySafety = "safe" | "confirm_on_replay" | "never_auto_replay" | "uncertain";
export type SessionRuntimeToolSlot = "narrator" | "director" | "verifier" | "memory";
export type SessionRuntimeToolAsyncCapability = "inline_only" | "deferred_ok";
export type SessionRuntimeToolDeliveryMode = "inline" | "async_job";
export type SessionRuntimeToolResultVisibility = "immediate" | "deferred_receipt";

export type SessionRuntimeToolCatalogEntry = {
  allowedSlots: SessionRuntimeToolSlot[];
  asyncCapability: SessionRuntimeToolAsyncCapability;
  availability: SessionRuntimeToolAvailability;
  availabilityReason: string | null;
  defaultDeliveryMode: SessionRuntimeToolDeliveryMode;
  name: string;
  providerId: string;
  providerType: SessionRuntimeToolProviderType;
  replaySafety: SessionRuntimeToolReplaySafety;
  resultVisibility: SessionRuntimeToolResultVisibility;
  sideEffectLevel: "none" | "sandbox" | "irreversible";
  source: SessionRuntimeToolSource;
};

export type SessionRuntimeToolCatalogConflict = {
  providerIds: string[];
  reason: "name_conflict";
  toolName: string;
};

export type SessionRuntimeToolCatalog = {
  conflicts: SessionRuntimeToolCatalogConflict[];
  generatedAt: number;
  sessionId: string;
  tools: SessionRuntimeToolCatalogEntry[];
};

export type RespondDryRunMessage = {
  content: string;
  role: "system" | "user" | "assistant";
};

export type RespondDryRunPromptSnapshot = {
  presetId: string | null;
  presetUpdatedAt: number | null;
  presetVersion: number | null;
  worldbookId: string | null;
  worldbookUpdatedAt: number | null;
  worldbookVersion: number | null;
  regexProfileId: string | null;
  regexProfileUpdatedAt: number | null;
  regexProfileVersion: number | null;
  worldbookActivatedEntryUids: number[];
  regexPreRuleNames: string[];
  regexPostRuleNames: string[];
  promptMode: "compat_strict" | "compat_plus" | "native";
  promptDigest: string;
  tokenEstimate: number;
};

export type RespondDryRunAssembly = {
  memorySummaryInjected: boolean;
  mode: "preset" | "fallback";
  preprocessedUserMessage: string | null;
  presetUsed: boolean;
  regexPostRules: string[];
  regexPreRules: string[];
  reservedVariableCollisions: Array<"char" | "user">;
  worldbookHits: number;
};

export type RespondDryRunResult = {
  assembly: RespondDryRunAssembly;
  availableForReply: number;
  memorySummary: string | null;
  messages: RespondDryRunMessage[];
  promptSnapshot: RespondDryRunPromptSnapshot;
  tokenEstimate: number;
};

export type SessionsListOptions = {
  accountId?: AccountIdHint;
  keyword?: string;
  limit?: number;
  offset?: number;
  sortBy?: "created_at" | "updated_at";
  sortOrder?: "asc" | "desc";
  status?: "active" | "archived";
};

export type SessionsCreateOptions = {
  accountId?: AccountIdHint;
  status?: "active" | "archived";
  title?: string;
};

export type SessionsGetDetailOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
};

export type SessionsUpdateOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
  status?: "active" | "archived";
  title?: string;
};

export type SessionsRemoveOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
};

export type SessionsRespondBaseOptions = {
  accountId?: AccountIdHint;
  branchId?: string;
  config?: RespondTurnConfig;
  generationParams?: RespondGenerationParams;
  sessionId: string;
  sourceFloorId?: string;
};

export type SessionsRespondOptions = SessionsRespondBaseOptions & {
  message: string;
};

export type SessionsRespondDryRunOptions = SessionsRespondOptions;

export type SessionsRespondStreamOptions = SessionsRespondOptions &
  RespondStreamCallbacks & {
    signal?: AbortSignal;
  };

export type SessionsRegenerateOptions = {
  accountId?: AccountIdHint;
  config?: RespondTurnConfig;
  generationParams?: RespondGenerationParams;
  sessionId: string;
};

export type SessionsSyncCharacterOptions = {
  accountId?: AccountIdHint;
  force?: boolean;
  sessionId: string;
};

export type SessionsTimelineOptions = {
  accountId?: AccountIdHint;
  branchId?: string;
  limit?: number;
  offset?: number;
  sessionId: string;
};

export type SessionsListBranchesOptions = {
  accountId?: AccountIdHint;
  limit?: number;
  offset?: number;
  sessionId: string;
  sortBy?: "branch_id" | "floor_count" | "latest_floor_no" | "updated_at";
  sortOrder?: "asc" | "desc";
};

export type SessionsDiffBranchesOptions = {
  accountId?: AccountIdHint;
  baseBranchId?: string;
  sessionId: string;
  targetBranchId: string;
};

export type SessionsBatchUpdateStatusOptions = {
  accountId?: AccountIdHint;
  ids: string[];
  status: "active" | "archived";
};

export type SessionsBatchUpdateStatusResult = {
  meta: {
    notFound: number;
    status: "active" | "archived";
    total: number;
    updated: number;
  };
  results: Array<{
    action: "not_found" | "updated" | string;
    id: string;
    index: number;
  }>;
};

export type SessionsBatchDeleteOptions = {
  accountId?: AccountIdHint;
  ids: string[];
};

export type SessionsBatchDeleteResult = {
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

export type SessionsToolPermissionsOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
};

export type SessionsGetRuntimeToolCatalogOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
};

export type SessionsGetActiveRunOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
};

export type SessionsPutToolPermissionsOptions = SessionsToolPermissionsOptions & {
  permissions: SessionToolPermissions;
};

export type SessionsPatchToolPermissionsOptions = SessionsToolPermissionsOptions & {
  permissions: SessionToolPermissions;
};

export type SessionsResource = {
  batchDelete(options: SessionsBatchDeleteOptions): Promise<SessionsBatchDeleteResult>;
  batchUpdateStatus(options: SessionsBatchUpdateStatusOptions): Promise<SessionsBatchUpdateStatusResult>;
  create(options?: SessionsCreateOptions): Promise<SessionRecord | null>;
  diffBranches(options: SessionsDiffBranchesOptions): Promise<SessionBranchDiff>;
  getActiveRun(options: SessionsGetActiveRunOptions): Promise<SessionActiveRunRecord>;
  getDetail(options: SessionsGetDetailOptions): Promise<SessionDetail>;
  getRuntimeToolCatalog(options: SessionsGetRuntimeToolCatalogOptions): Promise<SessionRuntimeToolCatalog>;
  getToolPermissions(options: SessionsToolPermissionsOptions): Promise<SessionToolPermissions>;
  list(options?: SessionsListOptions): Promise<SessionRecord[]>;
  listBranches(options: SessionsListBranchesOptions): Promise<SessionBranchSummary[]>;
  patchToolPermissions(options: SessionsPatchToolPermissionsOptions): Promise<SessionToolPermissions>;
  putToolPermissions(options: SessionsPutToolPermissionsOptions): Promise<SessionToolPermissions>;
  regenerate(options: SessionsRegenerateOptions): Promise<SessionRegenerateResult>;
  remove(options: SessionsRemoveOptions): Promise<boolean>;
  respond(options: SessionsRespondOptions): Promise<RespondResult>;
  respondDryRun(options: SessionsRespondDryRunOptions): Promise<RespondDryRunResult>;
  respondStream(options: SessionsRespondStreamOptions): Promise<RespondResult>;
  syncCharacter(options: SessionsSyncCharacterOptions): Promise<SessionDetail>;
  timeline(options: SessionsTimelineOptions): Promise<SessionTimeline>;
  update(options: SessionsUpdateOptions): Promise<boolean>;
};

export function createSessionsResource(client: TransportClient): SessionsResource {
  return {
    async batchDelete(options): Promise<SessionsBatchDeleteResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/sessions/batch/delete", {
        body: {
          ids: options.ids,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapBatchDeletePayload(response.body);
    },
    async batchUpdateStatus(options): Promise<SessionsBatchUpdateStatusResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/sessions/batch/status", {
        body: {
          ids: options.ids,
          status: options.status,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      return mapBatchStatusPayload(response.body, options.status);
    },
    async create(options: SessionsCreateOptions = {}): Promise<SessionRecord | null> {
      const response = await client.post("/sessions", {
        body: compactObject({
          status: options.status,
          title: options.title,
        }),
        headers: buildAccountHeaders(options.accountId),
      });

      const payload = readRecord(response.body);
      return mapSession(payload?.data);
    },
    async diffBranches(options): Promise<SessionBranchDiff> {
      const query = buildQueryString({
        base_branch_id: options.baseBranchId ?? "main",
        target_branch_id: options.targetBranchId,
      });
      const pathname = `/sessions/${encodeURIComponent(options.sessionId)}/branches/diff?${query}`;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const data = readRecord(readRecord(response.body)?.data);
      return {
        baseBranchId: readString(data?.base_branch_id),
        baseOnlyFloors: readArray(data?.base_only_floors)
          .map(mapBranchFloorSummary)
          .filter((item): item is SessionBranchFloorSummary => item !== null),
        forkFloorNo: readNullableNumber(data?.fork_floor_no),
        sessionId: readString(data?.session_id),
        sharedFloorNos: readArray(data?.shared_floor_nos)
          .map((item) => readNullableNumber(item))
          .filter((item): item is number => item !== null),
        targetBranchId: readString(data?.target_branch_id),
        targetOnlyFloors: readArray(data?.target_only_floors)
          .map(mapBranchFloorSummary)
          .filter((item): item is SessionBranchFloorSummary => item !== null),
      };
    },
    async getActiveRun(options): Promise<SessionActiveRunRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/sessions/${encodeURIComponent(options.sessionId)}/active-run`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapSessionActiveRunPayload(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Session active run payload is missing");
      }
      return payload;
    },
    async getDetail(options): Promise<SessionDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/sessions/${encodeURIComponent(options.sessionId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapSessionDetail(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Session detail payload is missing");
      }

      return payload;
    },
    async getRuntimeToolCatalog(options): Promise<SessionRuntimeToolCatalog> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/tools/runtime`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      return mapRuntimeToolCatalog(readRecord(response.body)?.data);
    },
    async getToolPermissions(options): Promise<SessionToolPermissions> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/tool-permissions`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      return mapToolPermissions(readRecord(response.body)?.data);
    },
    async list(options: SessionsListOptions = {}): Promise<SessionRecord[]> {
      const response = await client.get("/sessions", {
        headers: buildAccountHeaders(options.accountId),
        query: compactObject({
          keyword: options.keyword,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
          sort_by: options.sortBy ?? "updated_at",
          sort_order: options.sortOrder ?? "desc",
          status: options.status,
        }),
      });

      const payload = readRecord(response.body);
      return readArray(payload?.data)
        .map(mapSession)
        .filter((session): session is SessionRecord => session !== null);
    },
    async listBranches(options): Promise<SessionBranchSummary[]> {
      const query = buildQueryString({
        limit: options.limit ?? 50,
        offset: options.offset ?? 0,
        sort_by: options.sortBy ?? "updated_at",
        sort_order: options.sortOrder ?? "desc",
      });
      const pathname = `/sessions/${encodeURIComponent(options.sessionId)}/branches?${query}`;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapBranchSummary)
        .filter((item): item is SessionBranchSummary => item !== null);
    },
    async patchToolPermissions(options): Promise<SessionToolPermissions> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/tool-permissions`,
        {
          body: mapToolPermissionsRequest(options.permissions),
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );

      return mapToolPermissions(readRecord(response.body)?.data);
    },
    async putToolPermissions(options): Promise<SessionToolPermissions> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/tool-permissions`,
        {
          body: mapToolPermissionsRequest(options.permissions),
          headers: buildAccountHeaders(options.accountId),
          method: "PUT",
        },
      );

      return mapToolPermissions(readRecord(response.body)?.data);
    },
    async regenerate(options): Promise<SessionRegenerateResult> {
      const response = await client.fetchJson<Record<string, unknown>>(`/sessions/${encodeURIComponent(options.sessionId)}/regenerate`, {
        body: compactObject({
          config: options.config,
          generation_params: mapGenerationParams(options.generationParams),
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapRegeneratePayload(response.body, "Regenerate API returned an invalid payload");
    },
    async remove(options: SessionsRemoveOptions): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/sessions/${encodeURIComponent(options.sessionId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async respond(options: SessionsRespondOptions): Promise<RespondResult> {
      const response = await client.fetchJson<Record<string, unknown>>(`/sessions/${encodeURIComponent(options.sessionId)}/respond`, {
        body: mapRespondRequestBody(options),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapRespondPayload(response.body, "Respond API returned an invalid payload");
    },
    async respondDryRun(options: SessionsRespondDryRunOptions): Promise<RespondDryRunResult> {
      const response = await client.fetchJson<Record<string, unknown>>(`/sessions/${encodeURIComponent(options.sessionId)}/respond/dry-run`, {
        body: mapRespondRequestBody(options),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapDryRunPayload(response.body);
    },
    async respondStream(options: SessionsRespondStreamOptions): Promise<RespondResult> {
      const response = await client.fetchRaw(`/sessions/${encodeURIComponent(options.sessionId)}/respond/stream`, {
        accept: "text/event-stream",
        body: mapRespondRequestBody(options),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
        signal: options.signal,
      });

      const donePayload = await readSseStream(response, {
        onChunk: (payload) => options.onChunk?.(payload),
        onError: (payload) => options.onError?.(payload),
        onEvent: (event) => options.onEvent?.(event),
        onRun: (payload) => options.onRun?.(payload),
        onStart: (payload) => options.onStart?.(payload),
        onSummary: (payload) => options.onSummary?.(payload),
        onTool: (payload) => options.onTool?.(payload),
      });

      return mapDonePayload(donePayload);
    },
    async syncCharacter(options): Promise<SessionDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/character/sync`,
        {
          body: compactObject({
            force: options.force,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapSessionDetail(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Session character sync returned an invalid payload");
      }

      return payload;
    },
    async timeline(options: SessionsTimelineOptions): Promise<SessionTimeline> {
      const response = await client.get("/sessions/{id}/timeline", {
        headers: buildAccountHeaders(options.accountId),
        path: {
          id: options.sessionId,
        },
        query: compactObject({
          branch_id: options.branchId ?? "main",
          limit: options.limit ?? 200,
          offset: options.offset ?? 0,
        }),
      });

      const payload = readRecord(response.body);
      const data = readRecord(payload?.data);

      return {
        branchId: readOptionalString(data?.branch_id),
        floors: readArray(data?.floors)
          .map(mapTimelineFloor)
          .filter((floor): floor is TimelineFloor => floor !== null),
        sessionId: readOptionalString(data?.session_id),
      };
    },
    async update(options: SessionsUpdateOptions): Promise<boolean> {
      const response = await client.patch("/sessions/{id}", {
        body: compactObject({
          status: options.status,
          title: options.title,
        }),
        headers: buildAccountHeaders(options.accountId),
        path: {
          id: options.sessionId,
        },
      });

      return response.status === 200;
    },
  };
}

function mapDonePayload(payload: {
  branchId?: string;
  finalState?: RespondFinalState;
  floorId: string;
  floorNo: number;
  generatedText?: string;
  summaries?: string[];
  totalUsage?: unknown;
}): RespondResult {
  const totalUsage = toApiUsage(payload.totalUsage);

  return {
    branchId: payload.branchId,
    finalState: payload.finalState,
    floorId: payload.floorId,
    floorNo: payload.floorNo,
    generatedText: payload.generatedText ?? "",
    inputTokens: resolveInputTokens(totalUsage),
    outputTokens: resolveOutputTokens(totalUsage),
    summaries: payload.summaries ?? [],
    totalTokens: resolveTotalTokens(totalUsage),
    totalUsage,
  };
}

function readRespondFinalState(value: unknown): RespondFinalState | undefined {
  const state = readOptionalString(value);
  return state === "draft" || state === "generating" || state === "committed" || state === "failed" ? state : undefined;
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

function mapRespondRequestBody(options: SessionsRespondOptions | SessionsRespondStreamOptions | SessionsRespondDryRunOptions): Record<string, unknown> {
  return compactObject({
    branch_id: options.branchId,
    config: options.config,
    generation_params: mapGenerationParams(options.generationParams),
    message: options.message,
    source_floor_id: options.sourceFloorId,
  });
}

function mapStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readOptionalString(item))
    .filter((item): item is string => item !== undefined);
}

function mapReservedPromptAliasCollisions(value: unknown): Array<"char" | "user"> {
  return mapStringArray(value).filter(
    (item): item is "char" | "user" => {
      return item === "char" || item === "user";
    },
  );
}

function mapNumberArray(value: unknown): number[] {
  return readArray(value)
    .map((item) => (typeof item === "number" ? item : undefined))
    .filter((item): item is number => item !== undefined);
}

function readDryRunMode(value: unknown): RespondDryRunAssembly["mode"] {
  return readString(value) === "preset" ? "preset" : "fallback";
}

function readPromptMode(value: unknown): RespondDryRunPromptSnapshot["promptMode"] {
  const mode = readString(value);
  if (mode === "native" || mode === "compat_plus") {
    return mode;
  }

  return "compat_strict";
}

function mapDryRunMessage(value: unknown): RespondDryRunMessage | null {
  const record = readRecord(value);
  const role = readString(record?.role);
  if (role !== "system" && role !== "user" && role !== "assistant") {
    return null;
  }

  return {
    role,
    content: readString(record?.content),
  };
}

function mapDryRunPromptSnapshot(value: Record<string, unknown> | null): RespondDryRunPromptSnapshot {
  return {
    presetId: readNullableString(value?.preset_id),
    presetUpdatedAt: readNullableNumber(value?.preset_updated_at),
    presetVersion: readNullableNumber(value?.preset_version),
    worldbookId: readNullableString(value?.worldbook_id),
    worldbookUpdatedAt: readNullableNumber(value?.worldbook_updated_at),
    worldbookVersion: readNullableNumber(value?.worldbook_version),
    regexProfileId: readNullableString(value?.regex_profile_id),
    regexProfileUpdatedAt: readNullableNumber(value?.regex_profile_updated_at),
    regexProfileVersion: readNullableNumber(value?.regex_profile_version),
    worldbookActivatedEntryUids: mapNumberArray(value?.worldbook_activated_entry_uids),
    regexPreRuleNames: mapStringArray(value?.regex_pre_rule_names),
    regexPostRuleNames: mapStringArray(value?.regex_post_rule_names),
    promptMode: readPromptMode(value?.prompt_mode),
    promptDigest: readString(value?.prompt_digest),
    tokenEstimate: readNumber(value?.token_estimate),
  };
}

function mapDryRunPayload(payload: Record<string, unknown> | null): RespondDryRunResult {
  const data = readRecord(payload?.data);
  const assembly = readRecord(data?.assembly);
  const promptSnapshot = readRecord(data?.prompt_snapshot);

  return {
    assembly: {
      memorySummaryInjected: readBoolean(assembly?.memory_summary_injected),
      mode: readDryRunMode(assembly?.mode),
      preprocessedUserMessage: readNullableString(assembly?.preprocessed_user_message),
      presetUsed: readBoolean(assembly?.preset_used),
      regexPostRules: mapStringArray(assembly?.regex_post_rules),
      regexPreRules: mapStringArray(assembly?.regex_pre_rules),
      reservedVariableCollisions: mapReservedPromptAliasCollisions(assembly?.reserved_variable_collisions),
      worldbookHits: readNumber(assembly?.worldbook_hits),
    },
    availableForReply: readNumber(data?.available_for_reply),
    memorySummary: readNullableString(data?.memory_summary),
    messages: readArray(data?.messages)
      .map(mapDryRunMessage)
      .filter((message): message is RespondDryRunMessage => message !== null),
    promptSnapshot: mapDryRunPromptSnapshot(promptSnapshot),
    tokenEstimate: readNumber(data?.token_estimate),
  };
}

function mapRespondPayload(payload: Record<string, unknown> | null, errorMessage: string): RespondResult {
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
    finalState: readRespondFinalState(data?.final_state),
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

function mapRegeneratePayload(payload: Record<string, unknown> | null, errorMessage: string): SessionRegenerateResult {
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
    finalState: readRespondFinalState(data?.final_state),
    floorId,
    floorNo,
    generatedText: readString(data?.generated_text),
    inputTokens: resolveInputTokens(totalUsage),
    outputTokens: resolveOutputTokens(totalUsage),
    previousFloorId: readOptionalString(data?.previous_floor_id),
    summaries: mapStringArray(data?.summaries),
    totalTokens: resolveTotalTokens(totalUsage),
    totalUsage,
  };
}

function mapSession(value: unknown): SessionRecord | null {
  const detail = mapSessionDetail(value);
  if (!detail) {
    return null;
  }

  return {
    characterBinding: detail.characterBinding
      ? {
          snapshotSummary: detail.characterBinding.snapshotSummary,
        }
      : null,
    createdAt: detail.createdAt,
    id: detail.id,
    status: detail.status,
    title: detail.title,
    updatedAt: detail.updatedAt,
    userBinding: detail.userBinding
      ? {
          snapshotSummary: detail.userBinding.snapshotSummary,
        }
      : null,
    worldbookProfileId: detail.worldbookProfileId,
  };
}

function mapSessionDetail(value: unknown): SessionDetail | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    characterBinding: mapSessionCharacterBinding(record.character_binding),
    createdAt: readNumber(record.created_at),
    id: readString(record.id),
    metadata: record.metadata ?? null,
    modelName: readNullableString(record.model_name),
    modelParams: record.model_params ?? null,
    modelProvider: readNullableString(record.model_provider),
    presetId: readNullableString(record.preset_id),
    promptMode: readNullableString(record.prompt_mode),
    regexProfileId: readNullableString(record.regex_profile_id),
    status: readString(record.status),
    title: readNullableString(record.title),
    updatedAt: readNumber(record.updated_at),
    userBinding: mapSessionUserBinding(record.user_binding),
    worldbookProfileId: readNullableString(record.worldbook_profile_id),
  };
}

function mapSessionCharacterBinding(value: unknown): SessionCharacterBinding | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const snapshotSummary = readRecord(record.snapshot_summary);

  return {
    characterId: readNullableString(record.character_id),
    characterVersionId: readNullableString(record.character_version_id),
    snapshotSummary: snapshotSummary
      ? {
          hasGreeting: readBoolean(snapshotSummary.has_greeting),
          name: readString(snapshotSummary.name),
        }
      : null,
    syncPolicy: readString(record.sync_policy) as SessionCharacterBinding["syncPolicy"],
  };
}

function mapSessionUserBinding(value: unknown): SessionUserBinding | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const snapshotSummary = readRecord(record.snapshot_summary);

  return {
    snapshotSummary: snapshotSummary
      ? {
          name: readString(snapshotSummary.name),
        }
      : null,
    userId: readNullableString(record.user_id),
  };
}

function mapBranchSummary(value: unknown): SessionBranchSummary | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    branchId: readString(record.branch_id),
    floorCount: readNumber(record.floor_count),
    latestFloorId: readString(record.latest_floor_id),
    latestFloorNo: readNumber(record.latest_floor_no),
    latestState: readString(record.latest_state),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapBranchFloorSummary(value: unknown): SessionBranchFloorSummary | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    branchId: readString(record.branchId ?? record.branch_id),
    floorNo: readNumber(record.floorNo ?? record.floor_no),
    id: readString(record.id),
    state: readString(record.state),
  };
}

function mapBatchStatusPayload(
  payload: Record<string, unknown> | null,
  fallbackStatus: SessionsBatchUpdateStatusResult["meta"]["status"],
): SessionsBatchUpdateStatusResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      notFound: readNumber(meta?.not_found),
      status: (readString(meta?.status, fallbackStatus) as SessionsBatchUpdateStatusResult["meta"]["status"]),
      total: readNumber(meta?.total),
      updated: readNumber(meta?.updated),
    },
    results: readArray(data?.results)
      .map(mapBatchItemResult)
      .filter((item): item is SessionsBatchUpdateStatusResult["results"][number] => item !== null),
  };
}

function mapBatchDeletePayload(payload: Record<string, unknown> | null): SessionsBatchDeleteResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      deleted: readNumber(meta?.deleted),
      notFound: readNumber(meta?.not_found),
      total: readNumber(meta?.total),
    },
    results: readArray(data?.results)
      .map(mapBatchItemResult)
      .filter((item): item is SessionsBatchDeleteResult["results"][number] => item !== null),
  };
}

function mapBatchItemResult(value: unknown): { action: string; id: string; index: number } | null {
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

function mapTimelineFloor(value: unknown): TimelineFloor | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const activePage = readRecord(record.active_page);

  return {
    activePage: activePage ? mapTimelinePage(activePage) : null,
    createdAt: readNumber(record.created_at),
    floorNo: readNumber(record.floor_no),
    id: readString(record.id),
    pageCount: readNumber(record.page_count),
    state: readString(record.state),
    tokenIn: readNumber(record.token_in),
    tokenOut: readNumber(record.token_out),
  };
}

function mapTimelineMessage(value: unknown): TimelineMessage | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    content: readString(record.content),
    contentFormat: readString(record.content_format, "text"),
    id: readString(record.id),
    role: readString(record.role),
    seq: readNumber(record.seq),
  };
}

function mapTimelinePage(value: Record<string, unknown>): TimelinePage {
  return {
    id: readString(value.id),
    messages: readArray(value.messages)
      .map(mapTimelineMessage)
      .filter((message): message is TimelineMessage => message !== null),
    pageKind: readString(value.page_kind),
    pageNo: readNumber(value.page_no),
    version: readNumber(value.version),
  };
}

function mapSessionActiveRunPayload(value: unknown): SessionActiveRunRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const activeRun = readRecord(record.active_run);
  return {
    sessionId: readString(record.session_id),
    activeRun: activeRun
      ? {
          activeRunId: readOptionalString(activeRun.active_run_id),
          activeRunType: readOptionalString(activeRun.active_run_type) as SessionActiveRunSummary["activeRunType"],
          branchId: readString(activeRun.branch_id),
          busy: readBoolean(activeRun.busy),
          latestFloorId: readOptionalString(activeRun.latest_floor_id),
          publicPhase: readOptionalString(activeRun.public_phase) as SessionActiveRunSummary["publicPhase"],
          updatedAt: readNumber(activeRun.updated_at),
        }
      : null,
  };
}

function mapRuntimeToolCatalog(value: unknown): SessionRuntimeToolCatalog {
  const record = readRecord(value);

  return {
    conflicts: readArray(record?.conflicts)
      .map(mapRuntimeToolCatalogConflict)
      .filter((item): item is SessionRuntimeToolCatalogConflict => item !== null),
    generatedAt: readNumber(record?.generated_at),
    sessionId: readString(record?.session_id),
    tools: readArray(record?.tools)
      .map(mapRuntimeToolCatalogEntry)
      .filter((item): item is SessionRuntimeToolCatalogEntry => item !== null),
  };
}

function mapRuntimeToolCatalogConflict(value: unknown): SessionRuntimeToolCatalogConflict | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    providerIds: mapStringArray(record.provider_ids),
    reason: readString(record.reason, "name_conflict") as SessionRuntimeToolCatalogConflict["reason"],
    toolName: readString(record.tool_name),
  };
}

function mapToolPermissionsRequest(permissions: SessionToolPermissions): Record<string, unknown> {
  return compactObject({
    allow_irreversible: permissions.allowIrreversible,
    enabled: permissions.enabled,
    max_calls_per_turn: permissions.maxCallsPerTurn,
    max_steps_per_generation: permissions.maxStepsPerGeneration,
    slot_allow_list: permissions.slotAllowList,
    slot_deny_list: permissions.slotDenyList,
  });
}

function mapToolPermissions(value: unknown): SessionToolPermissions {
  const record = readRecord(value);

  return {
    allowIrreversible:
      record && typeof record.allow_irreversible === "boolean"
        ? record.allow_irreversible
        : undefined,
    enabled:
      record && typeof record.enabled === "boolean"
        ? record.enabled
        : undefined,
    maxCallsPerTurn: record && typeof record.max_calls_per_turn === "number" ? record.max_calls_per_turn : undefined,
    maxStepsPerGeneration: record && typeof record.max_steps_per_generation === "number" ? record.max_steps_per_generation : undefined,
    slotAllowList: mapStringArrayRecord(record?.slot_allow_list),
    slotDenyList: mapStringArrayRecord(record?.slot_deny_list),
  };
}

function mapRuntimeToolCatalogEntry(value: unknown): SessionRuntimeToolCatalogEntry | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    allowedSlots: mapStringArray(record.allowed_slots) as SessionRuntimeToolCatalogEntry["allowedSlots"],
    asyncCapability: readString(record.async_capability, "inline_only") as SessionRuntimeToolCatalogEntry["asyncCapability"],
    availability: readString(record.availability, "unavailable") as SessionRuntimeToolCatalogEntry["availability"],
    availabilityReason: readNullableString(record.availability_reason),
    defaultDeliveryMode: readString(record.default_delivery_mode, "inline") as SessionRuntimeToolCatalogEntry["defaultDeliveryMode"],
    name: readString(record.name),
    providerId: readString(record.provider_id),
    providerType: readString(record.provider_type, "builtin") as SessionRuntimeToolCatalogEntry["providerType"],
    replaySafety: readString(record.replay_safety, "uncertain") as SessionRuntimeToolCatalogEntry["replaySafety"],
    resultVisibility: readString(record.result_visibility, "immediate") as SessionRuntimeToolCatalogEntry["resultVisibility"],
    sideEffectLevel: readString(record.side_effect_level, "none") as SessionRuntimeToolCatalogEntry["sideEffectLevel"],
    source: readString(record.source, "builtin") as SessionRuntimeToolCatalogEntry["source"],
  };
}

function mapStringArrayRecord(value: unknown): Record<string, string[]> | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record)
    .map(([key, item]) => [
      key,
      readArray(item)
        .map((part) => readOptionalString(part))
        .filter((part): part is string => part !== undefined),
    ] as const)
    .filter(([, item]) => item.length > 0);

  return entries.length > 0 ? Object.fromEntries(entries) : {};
}
