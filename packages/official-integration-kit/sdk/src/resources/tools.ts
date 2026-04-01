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
export type ToolHandlerType = "script" | "prompt" | "delegate";
export type ToolCallRecordStatus = "success" | "error" | "denied";

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
  sideEffectLevel: ToolSideEffectLevel | null;
  startedAt: number;
  status: ToolExecutionStatus;
  runtimeJobId: string | null;
  toolName: string;
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

export type ToolsResource = {
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
  listCallRecords(options: {
    accountId?: AccountIdHint;
    callerSlot?: string;
    floorId?: string;
    limit?: number;
    offset?: number;
    pageId?: string;
    sortBy?: "seq" | "created_at";
    sortOrder?: "asc" | "desc";
    status?: ToolCallRecordStatus;
  }): Promise<ToolCallRecordsListResult>;
  listExecutions(options: {
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
  }): Promise<ToolExecutionsListResult>;
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
  toggleDefinition(options: { accountId?: AccountIdHint; definitionId: string; enabled: boolean }): Promise<ToolDefinitionRecord>;
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
          .map(mapToolExecutionRecord)
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

  return {
    allowedSlots: readStringArray(record.allowed_slots),
    createdAt: readNumber(record.created_at),
    description: readString(record.description),
    enabled: readBoolean(record.enabled),
    handler: readRecord(record.handler) ?? {},
    handlerType: readString(record.handler_type, "script") as ToolHandlerType,
    id: readString(record.id),
    name: readString(record.name),
    parameters: readRecord(record.parameters) ?? {},
    sideEffectLevel: readString(record.side_effect_level, "none") as ToolSideEffectLevel,
    source: readString(record.source, "custom") as ToolDefinitionSource,
    sourceId: readNullableString(record.source_id),
    updatedAt: readNumber(record.updated_at),
  };
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

function readStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readString(item))
    .filter((item) => item.length > 0);
}
