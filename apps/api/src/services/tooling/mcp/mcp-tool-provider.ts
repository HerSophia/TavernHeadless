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
  ToolProviderType,
} from '@tavern/core';

import type {
  DeferredToolProviderHandler,
  RuntimeToolDescriptor,
} from '../runtime/deferred-tool-provider-handler.js';
import type { ToolRuntimePolicy } from '../runtime/tool-runtime-policy.js';
import type { McpServerConfig } from './types.js';
import type { McpConnectionManager } from './mcp-connection-manager.js';
import type { McpToolCatalogSnapshotStore } from './mcp-tool-catalog-snapshot-store.js';
import {
  cloneGovernedMcpTool,
  governMcpTool,
  type GovernedMcpTool,
} from './mcp-tool-metadata-governance.js';
import {
  buildStructuredToolCallErrorResult,
  resolveStructuredToolExecutionOutcome,
} from '../shared/execution-status.js';

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

function prepareDeferredToolDefinition(
  config: McpServerConfig,
  tool: ToolDefinition,
  options: {
    deferredHandler?: DeferredToolProviderHandler;
    toolRuntimePolicy?: ToolRuntimePolicy;
  },
): ToolDefinition {
  const descriptor: RuntimeToolDescriptor = {
    providerId: `mcp:${config.id}`,
    providerType: 'mcp',
    tool,
  };

  if (options.deferredHandler?.canHandle(descriptor)) {
    return cloneToolDefinition(
      options.deferredHandler.prepareDeferredExecution({ descriptor }).tool,
    );
  }

  if (options.toolRuntimePolicy) {
    return cloneToolDefinition(options.toolRuntimePolicy.annotateToolDefinition(descriptor));
  }

  return cloneToolDefinition(tool);
}

function normalizeListedTools(
  config: McpServerConfig,
  tools: ToolDefinition[],
  options: {
    deferredHandler?: DeferredToolProviderHandler;
    toolRuntimePolicy?: ToolRuntimePolicy;
  } = {},
): GovernedMcpTool[] {
  return tools.map((rawTool) => {
    const governed = governMcpTool(config, rawTool);
    return {
      ...governed,
      tool: prepareDeferredToolDefinition(config, governed.tool, options),
    };
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
  tools: GovernedMcpTool[];
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
      deferredHandler?: DeferredToolProviderHandler;
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
    return catalog.tools.map((entry) => cloneGovernedMcpTool(entry).tool);
  }

  async listToolsWithMetadata(): Promise<McpToolCatalogResult> {
    const capturedAt = Date.now();

    try {
      const connection = await this.connectionManager.getConnection(this.config.id);
      if (!connection || connection.state !== 'connected') {
        return await this.readCachedCatalog(capturedAt);
      }

      const tools = normalizeListedTools(
        this.config,
        connection.getTools(),
        {
          ...(this.options.deferredHandler ? { deferredHandler: this.options.deferredHandler } : {}),
          ...(this.options.toolRuntimePolicy ? { toolRuntimePolicy: this.options.toolRuntimePolicy } : {}),
        },
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
        tools: snapshot.tools.map((tool) => cloneGovernedMcpTool(tool)),
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
        const { outcome } = resolveStructuredToolExecutionOutcome(
          {
            error,
            executionStatus: 'error',
            executionReasonCode: connection?.reconnectRequired
              ? 'mcp_connection_reconnect_required'
              : 'mcp_not_connected',
            ...(connection?.reconnectRequired ? { reconnectRequired: true } : {}),
          },
        );
        return {
          ...(outcome
            ? buildStructuredToolCallErrorResult(error, outcome)
            : { error, executionStatus: 'error' as const, executionReasonCode: 'mcp_not_connected' }),
        };
      }

      // 去除 toolPrefix 还原 MCP 原始工具名
      const rawName = this.stripPrefix(name);

      const result = await connection.callTool(rawName, args);

      if (result.error) {
        const { outcome } = resolveStructuredToolExecutionOutcome(result, {
          fallbackStatus: 'error',
          fallbackReasonCode: 'mcp_remote_error',
          allowLegacyMessageInference: true,
        });

        return {
          ...(outcome
            ? buildStructuredToolCallErrorResult(result.error, outcome)
            : { error: result.error, executionStatus: 'error' as const, executionReasonCode: 'mcp_remote_error' }),
        };
      }

      return { data: result.data };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const { outcome } = resolveStructuredToolExecutionOutcome(
        { error },
        {
          fallbackStatus: 'error',
          fallbackReasonCode: 'mcp_provider_error',
          allowLegacyMessageInference: true,
        },
      );
      return {
        ...(outcome
          ? buildStructuredToolCallErrorResult(error, outcome)
          : { error, executionStatus: 'error' as const, executionReasonCode: 'mcp_provider_error' }),
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
