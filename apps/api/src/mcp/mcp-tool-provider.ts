/**
 * McpToolProvider
 *
 * 实现 ToolProvider 接口，将 MCP 服务器的工具注册到 ToolRegistry 中。
 * 对上层（ToolExecutor、TurnOrchestrator、ChatService）完全透明。
 */

import type {
  ToolProvider,
  ToolDefinition,
  ToolCallResult,
  ToolExecutionContext,
  ToolExecutionStatus,
  ToolProviderType,
} from '@tavern/core';

import type { McpServerConfig } from './types.js';
import type { McpConnectionManager } from './mcp-connection-manager.js';
import type { McpToolCatalogSnapshotStore } from './mcp-tool-catalog-snapshot-store.js';
import type { ToolRuntimePolicy } from '../services/tool-runtime-policy.js';

/**
 * Structured status inference fallback for MCP providers.
 *
 * 注意：仅当底层连接层未返回显式 `executionStatus` / `executionReasonCode` 时使用。
 * 新代码应优先传递显式结构化状态，避免依赖错误字符串。
 */
function inferExecutionStatus(error: string): Exclude<ToolExecutionStatus, 'running' | 'queued'> {
  const normalized = error.toLowerCase();
  if (normalized.includes('execution outcome is uncertain')) {
    return 'uncertain';
  }

  if (normalized.includes('timeout')) {
    return 'timeout';
  }

  return 'error';
}

function cloneToolDefinition(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    parameters: {
      type: tool.parameters.type,
      properties: { ...tool.parameters.properties },
      ...(tool.parameters.required ? { required: [...tool.parameters.required] } : {}),
    },
    allowedSlots: [...tool.allowedSlots],
  };
}

function normalizeListedTools(
  configId: string,
  tools: ToolDefinition[],
  toolRuntimePolicy?: ToolRuntimePolicy,
): ToolDefinition[] {
  return tools.map((tool) => {
    const annotated = toolRuntimePolicy?.annotateMcpTool(configId, tool) ?? cloneToolDefinition(tool);
    return cloneToolDefinition(annotated);
  });
}

/**
 * runtime catalog 中 MCP 工具来源状态。
 *
 * - `live` — 来自本次 live 拉取成功的结果
 * - `cached` — 来自本地 snapshot 回退
 * - `unavailable` — 当前 live 不可达且没有 snapshot，**不等于**“MCP server 确认零工具”
 */
export type McpToolCatalogSource = 'live' | 'cached' | 'unavailable';

export interface McpToolCatalogResult {
  tools: ToolDefinition[];
  source: McpToolCatalogSource;
  capturedAt: number;
}

export class McpToolProvider implements ToolProvider {
  readonly id: string;
  readonly type: ToolProviderType = 'mcp';

  constructor(
    private config: McpServerConfig,
    private connectionManager: McpConnectionManager,
    private readonly options: {
      toolRuntimePolicy?: ToolRuntimePolicy;
      snapshotStore?: McpToolCatalogSnapshotStore;
    } = {},
  ) {
    this.id = `mcp:${config.id}`;
  }

  /**
   * 列出该 MCP 服务器的所有工具。
   * 如果连接不可用，返回空数组而不抛异常。
   */
  async listTools(): Promise<ToolDefinition[]> {
    const catalog = await this.listToolsWithMetadata();
    return catalog.tools;
  }

  async listToolsWithMetadata(): Promise<McpToolCatalogResult> {
    const capturedAt = Date.now();

    try {
      const connection = await this.connectionManager.getConnection(this.config.id);
      if (!connection || connection.state !== 'connected') {
        return await this.readCachedCatalog(capturedAt);
      }

      const tools = normalizeListedTools(
        this.config.id,
        connection.getTools(),
        this.options.toolRuntimePolicy,
      );

      if (this.options.snapshotStore) {
        try {
          await this.options.snapshotStore.put(this.id, {
            providerKey: this.id,
            tools,
            capturedAt,
          });
        } catch {
          // Snapshot writes use best-effort semantics and must not hide live results.
        }
      }

      return {
        tools,
        source: 'live',
        capturedAt,
      };
    } catch {
      return await this.readCachedCatalog(capturedAt);
    }
  }

  private async readCachedCatalog(capturedAt: number): Promise<McpToolCatalogResult> {
    const snapshot = this.options.snapshotStore
      ? await this.options.snapshotStore.get(this.id)
      : null;

    if (snapshot) {
      return {
        tools: snapshot.tools.map((tool) => cloneToolDefinition(tool)),
        source: 'cached',
        capturedAt: snapshot.capturedAt,
      };
    }

    return { tools: [], source: 'unavailable', capturedAt };
  }

  /**
   * 执行工具调用。
   * 如果配置了 toolPrefix，会先去除前缀还原 MCP 原始工具名。
   * 不抛异常——失败时返回 { error }。
   */
  async executeTool(
    name: string,
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    try {
      const connection = await this.connectionManager.getConnection(this.config.id);
      if (!connection || connection.state !== 'connected') {
        const error = `MCP server "${this.config.name}" is not connected`;
        return {
          error,
          executionStatus: 'error',
          executionReasonCode: 'mcp_not_connected',
        };
      }

      // 去除 toolPrefix 还原 MCP 原始工具名
      const rawName = this.stripPrefix(name);

      const result = await connection.callTool(rawName, args);

      if (result.error) {
        // 优先透传底层显式状态 / 原因码，不再主动覆盖
        if (result.executionStatus) {
          return {
            error: result.error,
            executionStatus: result.executionStatus,
            ...(result.executionReasonCode ? { executionReasonCode: result.executionReasonCode } : {}),
          };
        }

        return {
          error: result.error,
          executionStatus: inferExecutionStatus(result.error),
          executionReasonCode: 'mcp_remote_error',
        };
      }

      return { data: result.data };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        error,
        executionStatus: inferExecutionStatus(error),
        executionReasonCode: 'mcp_provider_error',
      };
    }
  }

  // ── 内部辅助 ─────────────────────────────────────

  /**
   * 去除 toolPrefix。
   * 例如：工具名 "github_list_repos"，前缀 "github_"，
   * 返回 "list_repos"。
   */
  private stripPrefix(name: string): string {
    const prefix = this.config.toolPrefix;
    if (prefix && name.startsWith(prefix)) {
      return name.slice(prefix.length);
    }
    return name;
  }
}
