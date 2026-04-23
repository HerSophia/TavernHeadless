/**
 * McpToolProviderFactory
 *
 * 统一的 MCP `McpToolProvider` 构造入口。
 *
 * 目的：让以下两条路径复用同一套 provider 装配逻辑，避免策略漂移：
 *
 * 1. session runtime tool catalog 构造（`SessionToolRegistryService`）
 * 2. deferred MCP execute 处理（`McpDeferredToolHandler`）
 *
 * 本工厂只负责 provider 构造本身。它不管理连接生命周期、
 * 不替代 `McpConnectionManager`、也不负责 snapshot 存储实现。
 *
 * 所有调用方都通过该工厂创建 provider，以便未来加入更多 provider
 * 级策略（policy / snapshot / metadata basis 等）时不会出现双路径分叉。
 */

import type { McpServerConfig } from "./types.js";
import type { McpConnectionManager } from "./mcp-connection-manager.js";
import type { McpToolCatalogSnapshotStore } from "./mcp-tool-catalog-snapshot-store.js";
import type { ToolRuntimePolicy } from "../services/tool-runtime-policy.js";
import { McpToolProvider } from "./mcp-tool-provider.js";

export interface McpToolProviderFactoryOptions {
  connectionManager: McpConnectionManager;
  toolRuntimePolicy?: ToolRuntimePolicy;
  snapshotStore?: McpToolCatalogSnapshotStore;
}

/**
 * 构造 `McpToolProvider` 的工厂。
 *
 * 使用方式：
 *
 * ```ts
 * const factory = new McpToolProviderFactory({
 *   connectionManager,
 *   toolRuntimePolicy,
 *   snapshotStore,
 * });
 * const provider = factory.create(serverConfig);
 * ```
 *
 * 对 `snapshotStore` 对 execute path 不是强依赖，但将其统一纳入工厂
 * 可以避免未来出现 catalog path 与 execute path 的语义分叉。
 */
export class McpToolProviderFactory {
  constructor(private readonly options: McpToolProviderFactoryOptions) {}

  create(config: McpServerConfig): McpToolProvider {
    return new McpToolProvider(config, this.options.connectionManager, {
      ...(this.options.toolRuntimePolicy ? { toolRuntimePolicy: this.options.toolRuntimePolicy } : {}),
      ...(this.options.snapshotStore ? { snapshotStore: this.options.snapshotStore } : {}),
    });
  }
}
