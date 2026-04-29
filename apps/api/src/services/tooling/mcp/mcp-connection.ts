/**
 * McpConnection
 *
 * 封装单个 MCP 服务器的连接生命周期。
 * 管理 transport 创建、连接/断开、工具列表缓存和工具调用。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type {
  ToolCallResult,
  ToolDefinition,
  ToolParameterProperty,
  ToolSideEffectLevel,
} from '@tavern/core';
import type { McpServerConfig, McpConnectionState } from './types.js';
import { buildStructuredToolCallErrorResult } from '../shared/execution-status.js';

export type McpCallToolResult = ToolCallResult;

// ── MCP 工具类型提取 ─────────────────────────────

interface McpToolSchema {
  type: 'object';
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema: McpToolSchema;
  [key: string]: unknown;
}

// ── Logger 接口 ───────────────────────────────────

export interface McpLogger {
  info(msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

class McpConnectTimeoutError extends Error {}

class McpCallTimeoutError extends Error {}

// ── McpConnection ────────────────────────────────

export class McpConnection {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private connectPromise: Promise<void> | null = null;
  private cachedTools: ToolDefinition[] = [];
  private lastRefresh = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private _state: McpConnectionState = 'disconnected';
  private _reconnectRequired = false;
  private _error: string | undefined;
  private _connectedAt: number | undefined;
  private _lastTimeoutAt: number | undefined;
  private _toolsRefreshedAt: number | undefined;
  private _stdioRetried = false;

  constructor(
    readonly config: McpServerConfig,
    private logger?: McpLogger,
  ) {}

  // ── State Getters ───────────────────────────────

  get state(): McpConnectionState {
    return this._state;
  }

  get error(): string | undefined {
    return this._error;
  }

  get reconnectRequired(): boolean {
    return this._reconnectRequired;
  }

  get lastTimeoutAt(): number | undefined {
    return this._lastTimeoutAt;
  }

  get connectedAt(): number | undefined {
    return this._connectedAt;
  }

  get toolsRefreshedAt(): number | undefined {
    return this._toolsRefreshedAt;
  }

  get toolCount(): number {
    return this.cachedTools.length;
  }

  // ── connect ─────────────────────────────────────

  async connect(): Promise<void> {
    if (this._state === 'connected') {
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.connectPromise = this.connectInternal();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connectInternal(): Promise<void> {
    this._state = 'connecting';
    this._error = undefined;
    this._reconnectRequired = false;

    try {
      this.transport = this.createTransport();
      this.client = new Client(
        { name: 'tavern-headless', version: '1.0.0' },
      );

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      // 连接超时控制
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new McpConnectTimeoutError(`Connection timeout after ${this.config.connectTimeoutMs}ms`)),
          this.config.connectTimeoutMs,
        );
      });

      await Promise.race([connectPromise, timeoutPromise]);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      this._state = 'connected';
      this._connectedAt = Date.now();
      this._reconnectRequired = false;

      // 拉取工具列表
      await this.refreshTools();

      // 启动定时刷新
      if (this.config.toolRefreshIntervalMs > 0) {
        this.refreshTimer = setInterval(() => {
          void this.refreshTools().catch((err) => {
            this.logger?.warn(
              { serverId: this.config.id, error: String(err) },
              'MCP tool refresh failed',
            );
          });
        }, this.config.toolRefreshIntervalMs);
      }

      // stdio 传输监听 onclose，触发自动重连
      if (this.transport && this.config.transport === 'stdio') {
        this.transport.onclose = () => {
          this.handleTransportClose();
        };
      }

      this.logger?.info(
        { serverId: this.config.id, serverName: this.config.name, toolCount: this.cachedTools.length },
        'MCP server connected',
      );
    } catch (err) {
      this._state = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      this.logger?.error(

        { serverId: this.config.id, serverName: this.config.name, error: this._error },
        'MCP connection failed',
      );
      this._connectedAt = undefined;
      this._toolsRefreshedAt = undefined;
      this.cachedTools = [];
      this.lastRefresh = 0;
      // 清理半成功的连接
      this.clearRefreshTimer();
      await this.cleanupTransport();
    }
  }

  // ── disconnect ──────────────────────────────────

  async disconnect(): Promise<void> {
    this.clearRefreshTimer();

    await this.cleanupTransport();

    this._state = 'disconnected';
    this._connectedAt = undefined;
    this._toolsRefreshedAt = undefined;
    this._reconnectRequired = false;
    this.cachedTools = [];
    this.lastRefresh = 0;

    this.logger?.info(
      { serverId: this.config.id, serverName: this.config.name },
      'MCP server disconnected',
    );
  }

  // ── listTools ───────────────────────────────────

  getTools(): ToolDefinition[] {
    return this.cachedTools;
  }

  // ── callTool ────────────────────────────────────

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpCallToolResult> {
    if (this._state !== 'connected' || !this.client) {
      const error = `MCP server "${this.config.name}" is not connected (state: ${this._state})`;
      const reconnectRequired = this._state === 'reconnect_required' ? true : undefined;
      return {
        ...buildStructuredToolCallErrorResult(error, {
          executionStatus: 'error',
          executionReasonCode: reconnectRequired
            ? 'mcp_connection_reconnect_required'
            : 'mcp_not_connected',
          ...(reconnectRequired ? { reconnectRequired: true } : {}),
        }),
      };
    }

    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const callPromise = this.client.callTool({ name, arguments: args });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new McpCallTimeoutError(`Tool call timeout after ${this.config.callTimeoutMs}ms`)),
          this.config.callTimeoutMs,
        );
      });

      const result = await Promise.race([callPromise, timeoutPromise]);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // 检查是否为错误响应
      if (result && typeof result === 'object' && 'isError' in result && result.isError) {
        const errorContent = this.extractTextContent(result);
        return {
          ...buildStructuredToolCallErrorResult(errorContent || 'MCP tool returned an error', {
            executionStatus: 'error',
            executionReasonCode: 'mcp_remote_error',
          }),
        };
      }

      // 提取内容
      const data = this.extractContent(result);
      return { data };
    } catch (err) {
      if (err instanceof McpCallTimeoutError) {
        await this.recycleAfterUncertainTimeout(err.message);
        const error = `${err.message}; execution outcome is uncertain; reconnect required before the next call`;
        return {
          ...buildStructuredToolCallErrorResult(error, {
            executionStatus: 'uncertain',
            executionReasonCode: 'mcp_call_timeout_uncertain',
            reconnectRequired: true,
            providerMessage: err.message,
          }),
        };
      }

      return {
        ...buildStructuredToolCallErrorResult(err instanceof Error ? err.message : String(err), {
          executionStatus: 'error',
          executionReasonCode: 'mcp_transport_error',
        }),
      };
    }
  }

  // ── refreshTools ────────────────────────────────

  async refreshTools(): Promise<void> {
    if (this._state !== 'connected' || !this.client) {
      return;
    }

    try {
      const response = await this.client.listTools();
      const mcpTools = (response.tools ?? []) as McpTool[];
      this.cachedTools = mcpTools.map((t) => this.convertTool(t));
      this.lastRefresh = Date.now();
      this._toolsRefreshedAt = this.lastRefresh;
    } catch (err) {
      this.logger?.warn(
        { serverId: this.config.id, error: String(err) },
        'Failed to refresh MCP tools',
      );
    }
  }

  // ── 内部辅助 ─────────────────────────────────────

  private createTransport(): Transport {
    if (this.config.transport === 'stdio') {
      const stdio = this.config.stdio!;
      return new StdioClientTransport({
        command: stdio.command,
        args: stdio.args,
        env: stdio.env,
        cwd: stdio.cwd,
        stderr: 'pipe',
      });
    }

    // HTTP (Streamable HTTP)
    const http = this.config.http!;
    return new StreamableHTTPClientTransport(
      new URL(http.url),
      {
        requestInit: http.headers
          ? { headers: http.headers }
          : undefined,
      },
    );
  }

  /**
   * 将 MCP 工具定义转换为系统的 ToolDefinition 格式。
   * 如果配置了 toolPrefix，工具名称会加上前缀。
   */
  private convertTool(mcpTool: McpTool): ToolDefinition {
    const prefix = this.config.toolPrefix ?? '';
    const properties: Record<string, ToolParameterProperty> = {};

    if (mcpTool.inputSchema.properties) {
      for (const [key, val] of Object.entries(mcpTool.inputSchema.properties)) {
        const prop = val as Record<string, unknown>;
        properties[key] = {
          type: (prop.type as string) ?? 'string',
          description: prop.description as string | undefined,
          enum: prop.enum as string[] | undefined,
          default: prop.default,
        };
      }
    }

    return {
      name: `${prefix}${mcpTool.name}`,
      description: mcpTool.description ?? '',
      parameters: {
        type: 'object',
        properties,
        required: mcpTool.inputSchema.required,
      },
      sideEffectLevel: this.config.defaultSideEffectLevel,
      allowedSlots: [],
      source: 'mcp',
    };
  }

  /**
   * 从 MCP callTool 结果中提取文本内容。
   */
  private extractTextContent(result: Record<string, unknown>): string {
    const content = result.content as Array<Record<string, unknown>> | undefined;
    if (!content || !Array.isArray(content)) return '';

    return content
      .filter((c) => c.type === 'text')
      .map((c) => c.text as string)
      .join('\n');
  }

  /**
   * 从 MCP callTool 结果中提取内容（文本、图片等）。
   * 如果只有一个 text content，直接返回字符串；
   * 否则返回完整的 content 数组。
   */
  private extractContent(result: Record<string, unknown>): unknown {
    const content = result.content as Array<Record<string, unknown>> | undefined;
    if (!content || !Array.isArray(content)) return result;

    // 如果只有一个 text 内容，简化返回
    if (content.length === 1 && content[0]!.type === 'text') {
      return content[0]!.text;
    }

    return content;
  }

  /**
   * stdio 传输意外关闭时的处理：
   * 第一次自动重连，第二次标记为 error。
   */
  private handleTransportClose(): void {
    if (this._state !== 'connected') return;

    if (!this._stdioRetried) {
      this._stdioRetried = true;
      this.logger?.warn(
        { serverId: this.config.id },
        'stdio transport closed unexpectedly, attempting reconnect',
      );

      this._state = 'disconnected';
      this.client = null;
      this.transport = null;

      void this.connect().catch((err) => {
        this._state = 'error';
        this._error = `Auto-reconnect failed: ${err instanceof Error ? err.message : String(err)}`;
      });
    } else {
      this._state = 'error';
      this._error = 'stdio transport closed unexpectedly after retry';
      this.logger?.error(
        { serverId: this.config.id },
        'stdio transport closed again after auto-retry, marking as error',
      );
    }
  }

  private async cleanupTransport(): Promise<void> {
    // 先移除 onclose 回调，避免断开时触发重连
    if (this.transport) {
      this.transport.onclose = undefined;
    }

    try {
      await this.client?.close();
    } catch {
      // 忽略关闭错误
    }

    try {
      await this.transport?.close();
    } catch {
      // 忽略关闭错误
    }

    this.client = null;
    this.transport = null;
  }

  private async recycleAfterUncertainTimeout(message: string): Promise<void> {
    this._lastTimeoutAt = Date.now();
    this._error = `${message}; execution outcome is uncertain; reconnect required`;
    this._state = 'reconnect_required';
    this._reconnectRequired = true;
    this._connectedAt = undefined;
    this._toolsRefreshedAt = undefined;
    this.cachedTools = [];
    this.lastRefresh = 0;
    this.clearRefreshTimer();

    await this.cleanupTransport();

    this.logger?.warn(
      {
        serverId: this.config.id,
        serverName: this.config.name,
        error: this._error,
        lastTimeoutAt: this._lastTimeoutAt,
      },
      'MCP tool call timed out locally; outcome is uncertain and connection will be recycled',
    );
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
