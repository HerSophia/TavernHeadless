import type {
  McpDefaultSideEffectLevel,
  McpHttpConfig,
  McpServerRecord,
  McpServerStatus,
  McpServerToolRecord,
  McpServersListResult,
  McpStdioConfig,
  McpTestResult,
  McpTransport
} from "@tavern/sdk";

import { apiClient } from "../api";

export type WorkspaceMcpTransport = McpTransport;
export type WorkspaceMcpDefaultSideEffectLevel = McpDefaultSideEffectLevel;
export type WorkspaceMcpStdioConfig = McpStdioConfig;
export type WorkspaceMcpHttpConfig = McpHttpConfig;
export type WorkspaceMcpServer = McpServerRecord;
export type WorkspaceMcpServerStatus = McpServerStatus;
export type WorkspaceMcpServerTool = McpServerToolRecord;
export type WorkspaceMcpServersListResult = McpServersListResult;
export type WorkspaceMcpTestResult = McpTestResult;

export async function fetchMcpServers(options: {
  accountId?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: "created_at" | "name";
  sortOrder?: "asc" | "desc";
} = {}): Promise<WorkspaceMcpServersListResult> {
  return apiClient.mcp.listServers(options);
}

export async function fetchMcpServer(serverId: string, accountId?: string): Promise<WorkspaceMcpServer> {
  return apiClient.mcp.getServer({
    accountId,
    serverId
  });
}

export async function createMcpServer(options: {
  accountId?: string;
  callTimeoutMs?: number;
  connectTimeoutMs?: number;
  defaultSideEffectLevel?: WorkspaceMcpDefaultSideEffectLevel;
  enabled?: boolean;
  http?: WorkspaceMcpHttpConfig;
  name: string;
  stdio?: WorkspaceMcpStdioConfig;
  toolPrefix?: string;
  toolRefreshIntervalMs?: number;
  transport: WorkspaceMcpTransport;
}): Promise<WorkspaceMcpServer> {
  return apiClient.mcp.createServer(options);
}

export async function updateMcpServer(options: {
  accountId?: string;
  callTimeoutMs?: number;
  connectTimeoutMs?: number;
  defaultSideEffectLevel?: WorkspaceMcpDefaultSideEffectLevel;
  http?: WorkspaceMcpHttpConfig;
  name?: string;
  serverId: string;
  stdio?: WorkspaceMcpStdioConfig;
  toolPrefix?: string | null;
  toolRefreshIntervalMs?: number;
  transport?: WorkspaceMcpTransport;
}): Promise<WorkspaceMcpServer> {
  return apiClient.mcp.updateServer(options);
}

export async function toggleMcpServer(serverId: string, enabled: boolean, accountId?: string): Promise<WorkspaceMcpServer> {
  return apiClient.mcp.toggleServer({
    accountId,
    enabled,
    serverId
  });
}

export async function deleteMcpServer(serverId: string, accountId?: string): Promise<boolean> {
  return apiClient.mcp.removeServer({
    accountId,
    serverId
  });
}

export async function fetchMcpStatuses(accountId?: string): Promise<WorkspaceMcpServerStatus[]> {
  return apiClient.mcp.listStatuses({ accountId });
}

export async function fetchMcpServerStatus(serverId: string, accountId?: string): Promise<WorkspaceMcpServerStatus> {
  return apiClient.mcp.getServerStatus({
    accountId,
    serverId
  });
}

export async function connectMcpServer(serverId: string, accountId?: string): Promise<WorkspaceMcpServerStatus> {
  return apiClient.mcp.connectServer({
    accountId,
    serverId
  });
}

export async function disconnectMcpServer(serverId: string, accountId?: string): Promise<WorkspaceMcpServerStatus> {
  return apiClient.mcp.disconnectServer({
    accountId,
    serverId
  });
}

export async function fetchMcpServerTools(serverId: string, accountId?: string): Promise<WorkspaceMcpServerTool[]> {
  return apiClient.mcp.listServerTools({
    accountId,
    serverId
  });
}

export async function testMcpServer(serverId: string, accountId?: string): Promise<WorkspaceMcpTestResult> {
  return apiClient.mcp.testServer({
    accountId,
    serverId
  });
}
