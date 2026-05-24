import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  buildQueryString,
  compactObject,
  readArray,
  readBoolean,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type ToolSideEffectLevel = "none" | "sandbox" | "irreversible";
export type ToolDefinitionSource = "preset" | "character" | "custom";
export type ToolHandlerType = "script";
export type ToolCallRecordStatus = "success" | "error" | "denied" | "queued" | "running";

export type ToolExecutionStatus = ToolCallRecordStatus | "running" | "queued" | "timeout" | "uncertain" | "blocked";
export type ToolExecutionLifecycleState = "opened" | "finished";
export type ToolExecutionCommitOutcome = "pending" | "committed" | "discarded" | "replay_blocked" | "uncertain";
export type ToolExecutionProviderType = "builtin" | "preset" | "mcp" | "unknown";
export type ToolExecutionDeliveryMode = "inline" | "async_job";

export type BuiltinToolRecord = {
  allowedSlots: string[];
  description: string;
  name: string;
  parameters: Record<string, unknown>;
  sideEffectLevel: ToolSideEffectLevel;
  source: string;
};

export type ToolDefinitionRecord = {
  allowedSlots: string[];
  createdAt: number;
  description: string;
  enabled: boolean;
  handler: Record<string, unknown>;
  handlerType: ToolHandlerType;
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  sideEffectLevel: ToolSideEffectLevel;
  source: ToolDefinitionSource;
  sourceId: string | null;
  updatedAt: number;
};

/**
 * 兼容查询记录模型，对应公开路由 `/tools/call-records`。
 * 当前主审计模型已经切换到 `tool_execution_record`，SDK 仍保留这组兼容期结果类型。
 */
export type ToolCallRecord = {
  args: unknown;
  callerSlot: string;
  createdAt: number;
  durationMs: number;
  id: string;
  pageId: string;
  result: unknown;
  seq: number;
  status: ToolCallRecordStatus;
  toolName: string;
};

export type ToolExecutionRecord = {
  executionId: string;
  args: unknown;
  attemptNo: number;
  callerSlot: string;
  commitOutcome: ToolExecutionCommitOutcome;
  createdAt: number;
  durationMs: number;
  errorMessage: string | null;
  deliveryMode: ToolExecutionDeliveryMode;
  finishedAt: number | null;
  floorId: string;
  id: string;
  lifecycleState: ToolExecutionLifecycleState;
  pageId: string | null;
  providerId: string;
  providerType: ToolExecutionProviderType;
  replayParentExecutionId: string | null;
  result: unknown;
  runId: string;
  replaySafety?: "safe" | "confirm_on_replay" | "never_auto_replay" | "uncertain";
  replayReason?: string;
  runtimeJob?: ToolRoundtripRuntimeJob;
  policy?: ToolExecutionPolicySnapshot | null;
  sideEffectLevel: ToolSideEffectLevel | null;
  startedAt: number;
  status: ToolExecutionStatus;
  runtimeJobId: string | null;
  toolName: string;
  provenance?: ToolExecutionProvenance;
  roundtrip?: ToolExecutionRoundtrip;
};

export type ToolRuntimeJobStatus = "pending" | "leased" | "running" | "retry_waiting" | "succeeded" | "dead_letter" | "cancelled";

export type ToolRoundtripRuntimeJob = {
  id: string | null;
  jobType: string | null;
  status: ToolRuntimeJobStatus | null;
  phase: string | null;
  attemptCount: number | null;
  maxAttempts: number | null;
  availableAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
};

export type ToolExecutionPolicySnapshot = {
  enableDeferredIrreversibleTools: boolean;
  deferredToolAllowlist: string[];
  timeoutMs: number | null;
  maxAttempts: number | null;
  retryableStatuses: ToolExecutionStatus[];
  maxDeferredJobsPerRun: number | null;
  maxIrreversibleCallsPerRun: number | null;
};

export type ToolExecutionProvenance = {
  triggerScope: "chat_turn" | "manual" | "unknown" | "agent_step";
  stepId: string | null;
  parentRunJobId: string | null;
  agentBindingId: string | null;
  sourceEventId: string | null;
};

export type ToolExecutionRoundtrip = {
  wasAccepted: boolean;
  wasEnqueued: boolean;
  wasStarted: boolean;
  wasCompleted: boolean;
  wasUncertain: boolean;
};

export type ToolsListMeta = {
  hasMore: boolean;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  total: number;
};

export type ToolDefinitionsListResult = {
  definitions: ToolDefinitionRecord[];
  meta: ToolsListMeta;
};

export type ToolCallRecordsListResult = {
  meta: ToolsListMeta;
  records: ToolCallRecord[];
};

export type ToolExecutionsListResult = {
  meta: ToolsListMeta;
  records: ToolExecutionRecord[];
};

type ToolCallRecordsListOptionsBase = {
  accountId?: AccountIdHint;
  callerSlot?: string;
  floorId?: string;
  limit?: number;
  offset?: number;
  pageId?: string;
  sortBy?: "seq" | "created_at";
  sortOrder?: "asc" | "desc";
  status?: ToolCallRecordStatus;
};

export type ToolCallRecordsListOptions =
  | (ToolCallRecordsListOptionsBase & { pageId: string; floorId?: string })
  | (ToolCallRecordsListOptionsBase & { floorId: string; pageId?: string });

type ToolExecutionsListOptionsBase = {
  accountId?: AccountIdHint;
  callerSlot?: string;
  commitOutcome?: ToolExecutionCommitOutcome;
  floorId?: string;
  lifecycleState?: ToolExecutionLifecycleState;
  limit?: number;
  offset?: number;
  providerType?: ToolExecutionProviderType;
  runId?: string;
  sessionId?: string;
  sortBy?: "created_at" | "started_at" | "finished_at";
  sortOrder?: "asc" | "desc";
  status?: ToolExecutionStatus;
  toolName?: string;
};

export type ToolExecutionsListOptions =
  | (ToolExecutionsListOptionsBase & { floorId: string; sessionId?: string; runId?: string })
  | (ToolExecutionsListOptionsBase & { sessionId: string; floorId?: string; runId?: string })
  | (ToolExecutionsListOptionsBase & { runId: string; floorId?: string; sessionId?: string });

export type ToolsResource = {
  /**
   * 创建自定义工具定义。
   * `script` handler 默认可能被服务端安全策略关闭；未开启受信开关时，服务端会返回 `tool_script_handler_disabled`。
   */
  createDefinition(options: {
    accountId?: AccountIdHint;
    allowedSlots?: string[];
    description?: string;
    enabled?: boolean;
    handler?: Record<string, unknown>;
    handlerType?: ToolHandlerType;
    name: string;
    parameters?: Record<string, unknown>;
    sideEffectLevel?: ToolSideEffectLevel;
    source?: ToolDefinitionSource;
    sourceId?: string | null;
  }): Promise<ToolDefinitionRecord>;
  getDefinition(options: { accountId?: AccountIdHint; definitionId: string }): Promise<ToolDefinitionRecord>;
  listBuiltin(options?: { accountId?: AccountIdHint }): Promise<BuiltinToolRecord[]>;
  /**
   * 兼容查询入口。仅承接当前公开的 `/tools/call-records`，不代表长期主审计模型。
   */
  listCallRecords(options: ToolCallRecordsListOptions): Promise<ToolCallRecordsListResult>;
  /**
   * 主审计查询入口。
   * 对应 `tool_execution_record`；deferred 执行时再结合 `runtime_job` 观察后台生命周期。
   */
  listExecutions(options: ToolExecutionsListOptions): Promise<ToolExecutionsListResult>;
  listDefinitions(options?: {
    accountId?: AccountIdHint;
    enabled?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: "updated_at" | "name";
    sortOrder?: "asc" | "desc";
    source?: ToolDefinitionSource;
    sourceId?: string;
  }): Promise<ToolDefinitionsListResult>;
  removeDefinition(options: { accountId?: AccountIdHint; definitionId: string }): Promise<boolean>;
  /**
   * 启用或禁用自定义工具定义。
   * 当服务端默认关闭 `script` handler 时，重新启用会返回 `tool_script_handler_disabled`。
   */
  toggleDefinition(options: { accountId?: AccountIdHint; definitionId: string; enabled: boolean }): Promise<ToolDefinitionRecord>;
  /**
   * 更新自定义工具定义。
   * `script` handler 默认可能被服务端安全策略关闭；未开启受信开关时，服务端会返回 `tool_script_handler_disabled`。
   */
  updateDefinition(options: {
    accountId?: AccountIdHint;
    allowedSlots?: string[];
    definitionId: string;
    description?: string;
    handler?: Record<string, unknown>;
    handlerType?: ToolHandlerType;
    name?: string;
    parameters?: Record<string, unknown>;
    sideEffectLevel?: ToolSideEffectLevel;
    source?: ToolDefinitionSource;
    sourceId?: string | null;
  }): Promise<ToolDefinitionRecord>;
};

export function createToolsResource(client: TransportClient): ToolsResource {
  return {
    async createDefinition(options): Promise<ToolDefinitionRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/tools/definitions", {
        body: compactObject({
          allowed_slots: options.allowedSlots,
          description: options.description,
          enabled: options.enabled,
          handler: options.handler,
          handler_type: options.handlerType,
          name: options.name,
          parameters: options.parameters,
          side_effect_level: options.sideEffectLevel,
          source: options.source,
          source_id: options.sourceId,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapToolDefinition(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Tool definition create returned an invalid payload");
      }

      return payload;
    },
    async getDefinition(options): Promise<ToolDefinitionRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/tools/definitions/${encodeURIComponent(options.definitionId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapToolDefinition(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Tool definition detail returned an invalid payload");
      }

      return payload;
    },
    async listBuiltin(options = {}): Promise<BuiltinToolRecord[]> {
      const response = await client.fetchJson<Record<string, unknown>>("/tools/builtin", {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapBuiltinTool)
        .filter((item): item is BuiltinToolRecord => item !== null);
    },
    async listCallRecords(options): Promise<ToolCallRecordsListResult> {
      assertToolCallRecordsScope(options);

      const query = buildQueryString(compactObject({
        caller_slot: options.callerSlot,
        floor_id: options.floorId,
        limit: options.limit,
        offset: options.offset,
        page_id: options.pageId,
        sort_by: options.sortBy,
        sort_order: options.sortOrder,
        status: options.status,
      }));
      const pathname = query ? `/tools/call-records?${query}` : "/tools/call-records";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return {
        meta: mapListMeta(readRecord(response.body)?.meta),
        records: readArray(readRecord(response.body)?.data)
          .map(mapToolCallRecord)
          .filter((item): item is ToolCallRecord => item !== null),
      };
    },
    async listExecutions(options): Promise<ToolExecutionsListResult> {
      assertToolExecutionsScope(options);

      const queryParams = compactObject({
        caller_slot: options.callerSlot,
        commit_outcome: options.commitOutcome,
        lifecycle_state: options.lifecycleState,
        limit: options.limit,
        offset: options.offset,
        provider_type: options.providerType,
        run_id: options.runId,
        session_id: options.sessionId,
        sort_by: options.sortBy,
        sort_order: options.sortOrder,
        status: options.status,
        tool_name: options.toolName,
      });
      const query = buildQueryString(queryParams);
      const pathname = options.floorId
        ? query
          ? `/floors/${encodeURIComponent(options.floorId)}/tool-executions?${query}`
          : `/floors/${encodeURIComponent(options.floorId)}/tool-executions`
        : (() => {
            const globalQuery = buildQueryString({ ...queryParams, floor_id: options.floorId });
            return globalQuery ? `/tool-executions?${globalQuery}` : "/tool-executions";
          })();
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return {
        meta: mapListMeta(readRecord(response.body)?.meta),
        records: readArray(readRecord(response.body)?.data)
          .map((item) => {
            const record = mapToolExecutionRecord(item);
            if (!record) {
              return null;
            }

            const source = readRecord(item);
            return source
              ? { ...record, replaySafety: readNullableString(source.replay_safety) as ToolExecutionRecord["replaySafety"], replayReason: readNullableString(source.replay_reason), runtimeJob: mapToolRoundtripRuntimeJob(source.runtime_job), policy: mapToolExecutionPolicySnapshot(source.policy), provenance: mapToolExecutionProvenance(source.provenance), roundtrip: mapToolExecutionRoundtrip(source.roundtrip) }
              : record;
          })
          .filter((item): item is ToolExecutionRecord => item !== null),
      };
    },
    async listDefinitions(options = {}): Promise<ToolDefinitionsListResult> {
      const query = buildQueryString(compactObject({
        enabled: options.enabled,
        limit: options.limit,
        offset: options.offset,
        sort_by: options.sortBy,
        sort_order: options.sortOrder,
        source: options.source,
        source_id: options.sourceId,
      }));
      const pathname = query ? `/tools/definitions?${query}` : "/tools/definitions";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return {
        definitions: readArray(readRecord(response.body)?.data)
          .map(mapToolDefinition)
          .filter((item): item is ToolDefinitionRecord => item !== null),
        meta: mapListMeta(readRecord(response.body)?.meta),
      };
    },
    async removeDefinition(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/tools/definitions/${encodeURIComponent(options.definitionId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async toggleDefinition(options): Promise<ToolDefinitionRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/tools/definitions/${encodeURIComponent(options.definitionId)}/toggle`,
        {
          body: {
            enabled: options.enabled,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );

      const payload = mapToolDefinition(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Tool definition toggle returned an invalid payload");
      }

      return payload;
    },
    async updateDefinition(options): Promise<ToolDefinitionRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/tools/definitions/${encodeURIComponent(options.definitionId)}`, {
        body: compactObject({
          allowed_slots: options.allowedSlots,
          description: options.description,
          handler: options.handler,
          handler_type: options.handlerType,
          name: options.name,
          parameters: options.parameters,
          side_effect_level: options.sideEffectLevel,
          source: options.source,
          source_id: options.sourceId,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      const payload = mapToolDefinition(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Tool definition update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapBuiltinTool(value: unknown): BuiltinToolRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    allowedSlots: readStringArray(record.allowed_slots),
    description: readString(record.description),
    name: readString(record.name),
    parameters: readRecord(record.parameters) ?? {},
    sideEffectLevel: readString(record.side_effect_level, "none") as ToolSideEffectLevel,
    source: readString(record.source),
  };
}

function mapToolDefinition(value: unknown): ToolDefinitionRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const handlerType = readToolHandlerType(record.handler_type);
  if (!handlerType) {
    return null;
  }

  return {
    allowedSlots: readStringArray(record.allowed_slots),
    createdAt: readNumber(record.created_at),
    description: readString(record.description),
    enabled: readBoolean(record.enabled),
    handler: readRecord(record.handler) ?? {},
    handlerType,
    id: readString(record.id),
    name: readString(record.name),
    parameters: readRecord(record.parameters) ?? {},
    sideEffectLevel: readString(record.side_effect_level, "none") as ToolSideEffectLevel,
    source: readString(record.source, "custom") as ToolDefinitionSource,
    sourceId: readNullableString(record.source_id),
    updatedAt: readNumber(record.updated_at),
  };
}

function readToolHandlerType(value: unknown): ToolHandlerType | null {
  return readString(value, "script") === "script" ? "script" : null;
}

function mapToolCallRecord(value: unknown): ToolCallRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    args: record.args,
    callerSlot: readString(record.caller_slot),
    createdAt: readNumber(record.created_at),
    durationMs: readNumber(record.duration_ms),
    id: readString(record.id),
    pageId: readString(record.page_id),
    result: record.result,
    seq: readNumber(record.seq),
    status: readString(record.status, "success") as ToolCallRecordStatus,
    toolName: readString(record.tool_name),
  };
}

function mapToolExecutionRecord(value: unknown): ToolExecutionRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    executionId: readString(record.execution_id, readString(record.id)),
    args: record.args,
    attemptNo: readNumber(record.attempt_no),
    callerSlot: readString(record.caller_slot),
    commitOutcome: readString(record.commit_outcome, "pending") as ToolExecutionCommitOutcome,
    createdAt: readNumber(record.created_at),
    durationMs: readNumber(record.duration_ms),
    deliveryMode: readString(record.delivery_mode, "inline") as ToolExecutionRecord["deliveryMode"],
    errorMessage: readNullableString(record.error_message),
    finishedAt: typeof record.finished_at === "number" ? record.finished_at : null,
    floorId: readString(record.floor_id),
    id: readString(record.id),
    lifecycleState: readString(record.lifecycle_state, "opened") as ToolExecutionLifecycleState,
    pageId: readNullableString(record.page_id),
    providerId: readString(record.provider_id),
    providerType: readString(record.provider_type, "unknown") as ToolExecutionProviderType,
    replayParentExecutionId: readNullableString(record.replay_parent_execution_id),
    result: record.result,
    runId: readString(record.run_id),
    sideEffectLevel: readNullableString(record.side_effect_level) as ToolExecutionRecord["sideEffectLevel"],
    startedAt: readNumber(record.started_at),
    status: readString(record.status, "running") as ToolExecutionStatus,
    runtimeJobId: readNullableString(record.runtime_job_id),
    toolName: readString(record.tool_name),
  };
}

function mapToolRoundtripRuntimeJob(value: unknown): ToolRoundtripRuntimeJob {
  const record = readRecord(value);
  return {
    id: readNullableString(record?.id),
    jobType: readNullableString(record?.job_type),
    status: readNullableString(record?.status) as ToolRoundtripRuntimeJob["status"],
    phase: readNullableString(record?.phase),
    attemptCount: typeof record?.attempt_count === "number" ? record.attempt_count : null,
    maxAttempts: typeof record?.max_attempts === "number" ? record.max_attempts : null,
    availableAt: typeof record?.available_at === "number" ? record.available_at : null,
    startedAt: typeof record?.started_at === "number" ? record.started_at : null,
    finishedAt: typeof record?.finished_at === "number" ? record.finished_at : null,
    lastError: readNullableString(record?.last_error),
  };
}

function mapToolExecutionPolicySnapshot(value: unknown): ToolExecutionPolicySnapshot | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    enableDeferredIrreversibleTools: readBoolean(record.enable_deferred_irreversible_tools),
    deferredToolAllowlist: readStringArray(record.deferred_tool_allowlist),
    timeoutMs: typeof record.timeout_ms === "number" ? record.timeout_ms : null,
    maxAttempts: typeof record.max_attempts === "number" ? record.max_attempts : null,
    retryableStatuses: readStringArray(record.retryable_statuses) as ToolExecutionStatus[],
    maxDeferredJobsPerRun: typeof record.max_deferred_jobs_per_run === "number" ? record.max_deferred_jobs_per_run : null,
    maxIrreversibleCallsPerRun: typeof record.max_irreversible_calls_per_run === "number" ? record.max_irreversible_calls_per_run : null,
  };
}

function mapListMeta(value: unknown): ToolsListMeta {
  const record = readRecord(value);

  return {
    hasMore: readBoolean(record?.has_more),
    limit: readNumber(record?.limit),
    offset: readNumber(record?.offset),
    sortBy: readString(record?.sort_by),
    sortOrder: readString(record?.sort_order, "desc") as "asc" | "desc",
    total: readNumber(record?.total),
  };
}

function mapToolExecutionProvenance(value: unknown): ToolExecutionProvenance {
  const record = readRecord(value);
  return {
    triggerScope: readString(record?.trigger_scope, "unknown") as ToolExecutionProvenance["triggerScope"],
    stepId: readNullableString(record?.step_id),
    parentRunJobId: readNullableString(record?.parent_run_job_id),
    agentBindingId: readNullableString(record?.agent_binding_id),
    sourceEventId: readNullableString(record?.source_event_id),
  };
}

function mapToolExecutionRoundtrip(value: unknown): ToolExecutionRoundtrip {
  const record = readRecord(value);
  return {
    wasAccepted: readBoolean(record?.wasAccepted),
    wasEnqueued: readBoolean(record?.wasEnqueued),
    wasStarted: readBoolean(record?.wasStarted),
    wasCompleted: readBoolean(record?.wasCompleted),
    wasUncertain: readBoolean(record?.wasUncertain),
  };
}

function assertToolCallRecordsScope(options: ToolCallRecordsListOptions): void {
  if (!options.pageId && !options.floorId) {
    throw new Error("tools.listCallRecords requires pageId or floorId");
  }
}

function assertToolExecutionsScope(options: ToolExecutionsListOptions): void {
  if (!options.sessionId && !options.floorId && !options.runId) {
    throw new Error("tools.listExecutions requires sessionId, floorId, or runId");
  }
}

function readStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readString(item))
    .filter((item) => item.length > 0);
}
