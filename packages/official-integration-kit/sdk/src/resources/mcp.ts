import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  buildQueryString,
  compactObject,
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type McpTransport = "stdio" | "http";
export type McpConnectionState = "disconnected" | "connecting" | "connected" | "reconnect_required" | "error";
export type McpDefaultSideEffectLevel = "none" | "sandbox" | "irreversible";
export type McpServerLiveStatusReason = "disabled" | "manager_unavailable" | "not_attached";

export type McpStdioConfig = {
  args?: string[];
  command: string;
  cwd?: string;
  env?: Record<string, string>;
};

export type McpHttpConfig = {
  headers?: Record<string, string>;
  url: string;
};

export type McpMaskedStdioConfig = {
  args?: string[];
  command: string;
  cwd?: string;
  envMasked?: Record<string, string>;
};

export type McpMaskedHttpConfig = {
  headersMasked?: Record<string, string>;
  url: string;
};

export type McpServerRecord = {
  callTimeoutMs: number;
  connectTimeoutMs: number;
  createdAt: number;
  defaultSideEffectLevel: McpDefaultSideEffectLevel;
  enabled: boolean;
  http: McpMaskedHttpConfig | null;
  id: string;
  liveStatus?: {
    attached: boolean;
    connectedAt: number | null;
    error: string | null;
    lastTimeoutAt: number | null;
    reason: McpServerLiveStatusReason | null;
    reconnectRequired: boolean;
    state: McpConnectionState;
    toolCount: number;
    toolsRefreshedAt: number | null;
  } | null;
  name: string;
  stdio: McpMaskedStdioConfig | null;
  toolPrefix: string | null;
  toolRefreshIntervalMs: number;
  transport: McpTransport;
  updatedAt: number;
};

export type McpServerStatus = {
  attached?: boolean;
  connectedAt: number | null;
  error: string | null;
  serverId: string;
  reason?: McpServerLiveStatusReason | null;
  serverName: string;
  state: McpConnectionState;
  toolCount: number;
  toolsRefreshedAt: number | null;
  reconnectRequired: boolean;
  lastTimeoutAt: number | null;
  transport: McpTransport;
};

/**
 * MCP 服务器原始工具目录视图。
 * 它只表示 MCP server 当前声明了哪些工具，不等于某个 session 最终可见的运行时工具目录。
 */
export type McpServerToolRecord = {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
  sideEffectLevel: string;
  source: string;
};

export type McpTestResult = {
  durationMs: number;
  error: string | null;
  success: boolean;
  toolCount: number;
};

export type McpListMeta = {
  hasMore: boolean;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  total: number;
};

export type McpServersListResult = {
  meta: McpListMeta;
  servers: McpServerRecord[];
};

export type McpResource = {
  connectServer(options: { accountId?: AccountIdHint; serverId: string }): Promise<McpServerStatus>;
  createServer(options: {
    accountId?: AccountIdHint;
    callTimeoutMs?: number;
    connectTimeoutMs?: number;
    defaultSideEffectLevel?: McpDefaultSideEffectLevel;
    enabled?: boolean;
    http?: McpHttpConfig;
    name: string;
    stdio?: McpStdioConfig;
    toolPrefix?: string;
    toolRefreshIntervalMs?: number;
    transport: McpTransport;
  }): Promise<McpServerRecord>;
  disconnectServer(options: { accountId?: AccountIdHint; serverId: string }): Promise<McpServerStatus>;
  getServer(options: { accountId?: AccountIdHint; serverId: string }): Promise<McpServerRecord>;
  getServerStatus(options: { accountId?: AccountIdHint; serverId: string }): Promise<McpServerStatus>;
  /**
   * 读取 MCP server 当前直接声明的工具列表。
   * 如果你需要 session 级可见目录、权限过滤结果或运行时可用性，
   * 应改用 `client.sessions.getRuntimeToolCatalog(...)`。
   */
  listServerTools(options: { accountId?: AccountIdHint; serverId: string }): Promise<McpServerToolRecord[]>;
  listServers(options?: {
    accountId?: AccountIdHint;
    enabled?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: "created_at" | "name";
    sortOrder?: "asc" | "desc";
  }): Promise<McpServersListResult>;
  listStatuses(options?: { accountId?: AccountIdHint }): Promise<McpServerStatus[]>;
  removeServer(options: { accountId?: AccountIdHint; serverId: string }): Promise<boolean>;
  testServer(options: { accountId?: AccountIdHint; serverId: string }): Promise<McpTestResult>;
  toggleServer(options: { accountId?: AccountIdHint; enabled: boolean; serverId: string }): Promise<McpServerRecord>;
  updateServer(options: {
    accountId?: AccountIdHint;
    callTimeoutMs?: number;
    connectTimeoutMs?: number;
    defaultSideEffectLevel?: McpDefaultSideEffectLevel;
    http?: McpHttpConfig;
    name?: string;
    serverId: string;
    stdio?: McpStdioConfig;
    toolPrefix?: string | null;
    toolRefreshIntervalMs?: number;
    transport?: McpTransport;
  }): Promise<McpServerRecord>;
};

export function createMcpResource(client: TransportClient): McpResource {
  return {
    async connectServer(options): Promise<McpServerStatus> {
      const response = await client.fetchJson<Record<string, unknown>>(`/mcp/servers/${encodeURIComponent(options.serverId)}/connect`, {
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapMcpStatus(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("MCP connect returned an invalid payload");
      }

      return payload;
    },
    async createServer(options): Promise<McpServerRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/mcp/servers", {
        body: compactObject({
          call_timeout_ms: options.callTimeoutMs,
          connect_timeout_ms: options.connectTimeoutMs,
          default_side_effect_level: options.defaultSideEffectLevel,
          enabled: options.enabled,
          http: options.http,
          name: options.name,
          stdio: options.stdio,
          tool_prefix: options.toolPrefix,
          tool_refresh_interval_ms: options.toolRefreshIntervalMs,
          transport: options.transport,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapMcpServer(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("MCP server create returned an invalid payload");
      }

      return payload;
    },
    async disconnectServer(options): Promise<McpServerStatus> {
      const response = await client.fetchJson<Record<string, unknown>>(`/mcp/servers/${encodeURIComponent(options.serverId)}/disconnect`, {
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapMcpStatus(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("MCP disconnect returned an invalid payload");
      }

      return payload;
    },
    async getServer(options): Promise<McpServerRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/mcp/servers/${encodeURIComponent(options.serverId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapMcpServer(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("MCP server detail returned an invalid payload");
      }

      return payload;
    },
    async getServerStatus(options): Promise<McpServerStatus> {
      const response = await client.fetchJson<Record<string, unknown>>(`/mcp/servers/${encodeURIComponent(options.serverId)}/status`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapMcpStatus(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("MCP server status returned an invalid payload");
      }

      return payload;
    },
    async listServerTools(options): Promise<McpServerToolRecord[]> {
      const response = await client.fetchJson<Record<string, unknown>>(`/mcp/servers/${encodeURIComponent(options.serverId)}/tools`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapMcpServerTool)
        .filter((item): item is McpServerToolRecord => item !== null);
    },
    async listServers(options = {}): Promise<McpServersListResult> {
      const query = buildQueryString(compactObject({
        enabled: options.enabled,
        limit: options.limit,
        offset: options.offset,
        sort_by: options.sortBy,
        sort_order: options.sortOrder,
      }));
      const pathname = query ? `/mcp/servers?${query}` : "/mcp/servers";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return {
        meta: mapMcpListMeta(readRecord(response.body)?.meta),
        servers: readArray(readRecord(response.body)?.data)
          .map(mapMcpServer)
          .filter((item): item is McpServerRecord => item !== null),
      };
    },
    async listStatuses(options = {}): Promise<McpServerStatus[]> {
      const response = await client.fetchJson<Record<string, unknown>>("/mcp/statuses", {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapMcpStatus)
        .filter((item): item is McpServerStatus => item !== null);
    },
    async removeServer(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/mcp/servers/${encodeURIComponent(options.serverId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async testServer(options): Promise<McpTestResult> {
      const response = await client.fetchJson<Record<string, unknown>>(`/mcp/servers/${encodeURIComponent(options.serverId)}/test`, {
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const data = readRecord(readRecord(response.body)?.data);
      return {
        durationMs: readNumber(data?.duration_ms),
        error: readNullableString(data?.error),
        success: readBoolean(data?.success),
        toolCount: readNumber(data?.tool_count),
      };
    },
    async toggleServer(options): Promise<McpServerRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/mcp/servers/${encodeURIComponent(options.serverId)}/toggle`, {
        body: {
          enabled: options.enabled,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      const payload = mapMcpServer(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("MCP server toggle returned an invalid payload");
      }

      return payload;
    },
    async updateServer(options): Promise<McpServerRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/mcp/servers/${encodeURIComponent(options.serverId)}`, {
        body: compactObject({
          call_timeout_ms: options.callTimeoutMs,
          connect_timeout_ms: options.connectTimeoutMs,
          default_side_effect_level: options.defaultSideEffectLevel,
          http: options.http,
          name: options.name,
          stdio: options.stdio,
          tool_prefix: options.toolPrefix,
          tool_refresh_interval_ms: options.toolRefreshIntervalMs,
          transport: options.transport,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      const payload = mapMcpServer(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("MCP server update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapMcpServer(value: unknown): McpServerRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const liveStatus = mapMcpLiveStatus(record.live_status);

  return {
    callTimeoutMs: readNumber(record.call_timeout_ms),
    connectTimeoutMs: readNumber(record.connect_timeout_ms),
    createdAt: readNumber(record.created_at),
    defaultSideEffectLevel: readString(record.default_side_effect_level, "irreversible") as McpDefaultSideEffectLevel,
    enabled: readBoolean(record.enabled),
    http: mapMcpMaskedHttpConfig(record.http),
    id: readString(record.id),
    ...(liveStatus !== null ? { liveStatus } : {}),
    name: readString(record.name),
    stdio: mapMcpMaskedStdioConfig(record.stdio),
    toolPrefix: readNullableString(record.tool_prefix),
    toolRefreshIntervalMs: readNumber(record.tool_refresh_interval_ms),
    transport: readString(record.transport, "stdio") as McpTransport,
    updatedAt: readNumber(record.updated_at),
  };
}

function mapMcpStatus(value: unknown): McpServerStatus | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    ...(record.attached !== undefined ? { attached: readBoolean(record.attached) } : {}),
    connectedAt: readNullableNumber(record.connected_at),
    error: readNullableString(record.error),
    lastTimeoutAt: readNullableNumber(record.last_timeout_at),
    ...(record.reason !== undefined ? { reason: readNullableString(record.reason) as McpServerLiveStatusReason | null } : {}),
    reconnectRequired: readBoolean(record.reconnect_required, readString(record.state) === "reconnect_required"),
    serverId: readString(record.server_id),
    serverName: readString(record.server_name),
    state: readString(record.state, "disconnected") as McpConnectionState,
    toolCount: readNumber(record.tool_count),
    toolsRefreshedAt: readNullableNumber(record.tools_refreshed_at),
    transport: readString(record.transport, "stdio") as McpTransport,
  };
}

function mapMcpServerTool(value: unknown): McpServerToolRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    description: readString(record.description),
    name: readString(record.name),
    parameters: readRecord(record.parameters) ?? {},
    sideEffectLevel: readString(record.side_effect_level),
    source: readString(record.source),
  };
}

function mapMcpListMeta(value: unknown): McpListMeta {
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

function mapMcpLiveStatus(value: unknown): McpServerRecord["liveStatus"] {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    attached: readBoolean(record.attached),
    connectedAt: readNullableNumber(record.connected_at),
    error: readNullableString(record.error),
    lastTimeoutAt: readNullableNumber(record.last_timeout_at),
    reason: readNullableString(record.reason) as McpServerLiveStatusReason | null,
    reconnectRequired: readBoolean(record.reconnect_required, readString(record.state) === "reconnect_required"),
    state: readString(record.state, "disconnected") as McpConnectionState,
    toolCount: readNumber(record.tool_count),
    toolsRefreshedAt: readNullableNumber(record.tools_refreshed_at),
  };
}

function mapMcpMaskedStdioConfig(value: unknown): McpMaskedStdioConfig | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    args: readStringArray(record.args),
    command: readString(record.command),
    cwd: readNullableString(record.cwd) ?? undefined,
    envMasked: readStringRecord(record.env_masked) ?? undefined,
  };
}

function mapMcpMaskedHttpConfig(value: unknown): McpMaskedHttpConfig | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    headersMasked: readStringRecord(record.headers_masked) ?? undefined,
    url: readString(record.url),
  };
}

function readStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readString(item))
    .filter((item) => item.length > 0);
}

function readStringRecord(value: unknown): Record<string, string> | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
