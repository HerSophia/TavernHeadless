/**
 * McpConnectionManager
 *
 * 管理多个 MCP 服务器连接的生命周期。
 * - stdio 服务器：启动时立即连接
 * - HTTP 服务器：首次使用时连接（按需连接）
 */

import { McpConnection, type McpLogger } from './mcp-connection.js';
import type { McpServerConfig, McpConnectionStatus } from './types.js';

export class McpConnectionManager {
  private connections = new Map<string, McpConnection>();

  constructor(
    private logger?: McpLogger,
  ) {}

  // ── 初始化 ──────────────────────────────────────

  /**
   * 根据配置列表初始化所有连接。
   * stdio 服务器立即连接，失败仅记录日志，不中断启动。
   * HTTP 服务器只创建 McpConnection 实例，不连接。
   */
  async initialize(configs: McpServerConfig[]): Promise<void> {
    const connectPromises: Promise<void>[] = [];

    for (const config of configs) {
      const connection = new McpConnection(config, this.logger);
      this.connections.set(config.id, connection);

      if (config.transport === 'stdio') {
        connectPromises.push(
          connection.connect().catch((err)=> {
            this.logger?.error(
              { serverId: config.id, serverName: config.name, error: String(err) },
              'Failed to connect stdio MCP server during initialization',
            );
          }),
        );
      }
      // HTTP 服务器不在初始化时连接
    }

    // 并发连接所有 stdio 服务器
    await Promise.all(connectPromises);
  }

  // ── 获取连接 ───────────────────────────────────

  /**
   * 获取指定服务器的连接。
   * 如果是 HTTP 服务器且未连接，会自动发起连接。
   */
  async getConnection(serverId: string): Promise<McpConnection | null> {
    const connection = this.connections.get(serverId);
    if (!connection) return null;

    // HTTP 按需连接
    if (
      connection.config.transport === 'http' &&
      connection.state === 'disconnected'
    ) {
      await connection.connect();
    }

    return connection;
  }

  /**
   * 获取连接（不触发自动连接）。
   */
  getConnectionSync(serverId: string): McpConnection | null {
    return this.connections.get(serverId) ?? null;
  }

  // ── 动态管理 ───────────────────────────────────

  /**
   * 动态添加服务器。
   * stdio 服务器立即连接；HTTP 服务器延迟到首次使用。
   */
  async addServer(config: McpServerConfig): Promise<void> {
    // 如果已存在，先移除
    if (this.connections.has(config.id)) {
      await this.removeServer(config.id);
    }

    const connection = new McpConnection(config, this.logger);
    this.connections.set(config.id, connection);

    if (config.transport === 'stdio') {
      await connection.connect();
    }
  }

  /**
   * 移除服务器，断开连接并从管理器中删除。
   */
  async removeServer(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    await connection.disconnect();
    this.connections.delete(serverId);
  }

  /**
   * 重新连接指定服务器：先断开再连接。
   */
  async reconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`MCP server "${serverId}" not found in manager`);
    }

    await connection.disconnect();
    await connection.connect();
  }

  // ── 状态查询 ───────────────────────────────────

  /**
   * 获取所有连接的状态。
   */
  getStatuses(): McpConnectionStatus[] {
    return Array.from(this.connections.values()).map((c) => this.toStatus(c));
  }

  /**
   * 获取单个服务器的连接状态。
   */
  getStatus(serverId: string): McpConnectionStatus | null {
    const connection = this.connections.get(serverId);
    if (!connection) return null;
    return this.toStatus(connection);
  }

  /**
   * 返回管理器中是否有指定 ID 的服务器。
   */
  hasServer(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  // ── 关闭 ───────────────────────────────────────

  /**
   * 断开所有连接，清空管理器。
   */
  async shutdown(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.values()).map(
      (c) => c.disconnect().catch(() => {}),
    );

    await Promise.all(disconnectPromises);
    this.connections.clear();

    this.logger?.info('MCP connection manager shut down');
  }

  // ── 内部辅助 ─────────────────────────────────────

  private toStatus(connection: McpConnection): McpConnectionStatus {
    return {
      serverId: connection.config.id,
      serverName: connection.config.name,
      transport: connection.config.transport,
      state: connection.state,
      toolCount: connection.toolCount,
      connectedAt: connection.connectedAt,
      toolsRefreshedAt: connection.toolsRefreshedAt,
      error: connection.error,
    };
  }
}
