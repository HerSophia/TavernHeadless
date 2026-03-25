import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
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

export type ToolsResource = {
  createDefinition(options: {
    accountId?: string;
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
  getDefinition(options: { accountId?: string; definitionId: string }): Promise<ToolDefinitionRecord>;
  listBuiltin(options?: { accountId?: string }): Promise<BuiltinToolRecord[]>;
  listCallRecords(options: {
    accountId?: string;
    callerSlot?: string;
    floorId?: string;
    limit?: number;
    offset?: number;
    pageId?: string;
    sortBy?: "seq" | "created_at";
    sortOrder?: "asc" | "desc";
    status?: ToolCallRecordStatus;
  }): Promise<ToolCallRecordsListResult>;
  listDefinitions(options?: {
    accountId?: string;
    enabled?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: "updated_at" | "name";
    sortOrder?: "asc" | "desc";
    source?: ToolDefinitionSource;
    sourceId?: string;
  }): Promise<ToolDefinitionsListResult>;
  removeDefinition(options: { accountId?: string; definitionId: string }): Promise<boolean>;
  toggleDefinition(options: { accountId?: string; definitionId: string; enabled: boolean }): Promise<ToolDefinitionRecord>;
  updateDefinition(options: {
    accountId?: string;
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
