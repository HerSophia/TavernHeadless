// ── MCP 集成类型定义 ──────────────────────────────────

import type { ToolSideEffectLevel } from '@tavern/core';

// ── Transport 配置 ─────────────────────────────────────

/** stdio 传输配置 */
export interface StdioTransportConfig {
  /** 启动命令 */
  command: string;
  /** 命令行参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
}

/** HTTP (Streamable HTTP) 传输配置 */
export interface HttpTransportConfig {
  /** MCP 服务器 URL */
  url: string;
  /** 额外请求头 */
  headers?: Record<string, string>;
}

// ── Server 配置 ────────────────────────────────────────

/** 传输类型 */
export type McpTransportType = 'stdio' | 'http';

/** MCP 服务器配置（从数据库加载） */
export interface McpServerConfig {
  /** 服务器 ID */
  id: string;
  /** 显示名称（唯一） */
  name: string;
  /** 传输类型 */
  transport: McpTransportType;
  /** stdio 传输配置（transport='stdio' 时必须） */
  stdio?: StdioTransportConfig;
  /** HTTP 传输配置（transport='http' 时必须） */
  http?: HttpTransportConfig;
  /** 工具名称前缀（用于避免冲突） */
  toolPrefix?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 连接超时（毫秒） */
  connectTimeoutMs: number;
  /** 工具调用超时（毫秒） */
  callTimeoutMs: number;
  /** 工具列表刷新间隔（毫秒，0 = 不自动刷新） */
  toolRefreshIntervalMs: number;
  /** 该服务器工具的默认副作用级别 */
  defaultSideEffectLevel: ToolSideEffectLevel;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

// ── 连接状态 ───────────────────────────────────────────

/** MCP 连接状态 */
export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** MCP 连接运行时状态（用于 API 返回） */
export interface McpConnectionStatus {
  /** 服务器 ID */
  serverId: string;
  /** 服务器名称 */
  serverName: string;
  /** 传输类型 */
  transport: McpTransportType;
  /** 连接状态 */
  state: McpConnectionState;
  /** 当前已发现的工具数量 */
  toolCount: number;
  /** 连接建立时间（epoch ms） */
  connectedAt?: number;
  /** 工具列表最后刷新时间（epoch ms） */
  toolsRefreshedAt?: number;
  /** 最近一次错误信息 */
  error?: string;
}

// ── Service 层输入类型 ─────────────────────────────────

/** 创建 MCP 服务器配置的输入 */
export interface CreateMcpServerInput {
  name: string;
  transport: McpTransportType;
  stdio?: StdioTransportConfig;
  http?: HttpTransportConfig;
  tool_prefix?: string;
  enabled?: boolean;
  connect_timeout_ms?: number;
  call_timeout_ms?: number;
  tool_refresh_interval_ms?: number;
  default_side_effect_level?: ToolSideEffectLevel;
}

/** 更新 MCP 服务器配置的输入 */
export interface UpdateMcpServerInput {
  name?: string;
  transport?: McpTransportType;
  stdio?: StdioTransportConfig;
  http?: HttpTransportConfig;
  tool_prefix?: string | null;
  connect_timeout_ms?: number;
  call_timeout_ms?: number;
  tool_refresh_interval_ms?: number;
  default_side_effect_level?: ToolSideEffectLevel;
}

/** MCP 服务器配置 API 响应 */
export interface McpServerConfigResponse {
  id: string;
  name: string;
  transport: McpTransportType;
  stdio?: StdioTransportConfig;
  http?: HttpTransportConfig;
  tool_prefix: string | null;
  enabled: boolean;
  connect_timeout_ms: number;
  call_timeout_ms: number;
  tool_refresh_interval_ms: number;
  default_side_effect_level: ToolSideEffectLevel;
  created_at: number;
  updated_at: number;
}
