import type { CoreEventBus } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { McpToolProviderFactory } from "../mcp/mcp-tool-provider-factory.js";
import type { McpConnectionManager } from "../mcp/mcp-connection-manager.js";
import {
  createDefaultToolAsyncHandlerRegistry,
  type ToolAsyncHandlerRegistry,
} from "./tool-async-handler-registry.js";
import {
  createToolRuntimeJobBridge,
  type ToolRuntimeJobBridge,
} from "./tool-runtime-job-bridge.js";
import { ToolRuntimePolicy } from "./tool-runtime-policy.js";
import { ToolWorker, type ToolWorkerLogger } from "./tool-worker.js";

export interface DefaultToolRuntimeOptions {
  eventBus?: CoreEventBus;
  mcpManager?: McpConnectionManager;
  enableDeferredIrreversibleTools?: boolean;
  deferredMcpTools?: string[];
  now?: () => number;
  logger?: ToolWorkerLogger;
}

export interface DefaultToolRuntimeComponents {
  policy: ToolRuntimePolicy;
  bridge: ToolRuntimeJobBridge;
  handlerRegistry: ToolAsyncHandlerRegistry;
  mcpToolProviderFactory?: McpToolProviderFactory;
  worker?: ToolWorker;
}

export function createDefaultToolRuntimeComponents(
  db: AppDb,
  options: DefaultToolRuntimeOptions = {},
): DefaultToolRuntimeComponents {
  const policy = new ToolRuntimePolicy({
    enableDeferredIrreversibleTools: options.enableDeferredIrreversibleTools,
    deferredMcpTools: options.deferredMcpTools,
  });
  const bridge = createToolRuntimeJobBridge(db, {
    eventBus: options.eventBus,
  });

  const mcpToolProviderFactory = options.mcpManager
    ? new McpToolProviderFactory({
        connectionManager: options.mcpManager,
        toolRuntimePolicy: policy,
      })
    : undefined;

  const handlerRegistry = createDefaultToolAsyncHandlerRegistry(db, {
    mcpManager: options.mcpManager,
    toolRuntimePolicy: policy,
    ...(mcpToolProviderFactory ? { mcpToolProviderFactory } : {}),
  });

  const worker = options.enableDeferredIrreversibleTools === true && options.mcpManager
    ? new ToolWorker(db, handlerRegistry, {
        eventBus: options.eventBus,
        now: options.now,
        logger: options.logger,
      })
    : undefined;

  return {
    policy,
    bridge,
    handlerRegistry,
    ...(mcpToolProviderFactory ? { mcpToolProviderFactory } : {}),
    ...(worker ? { worker } : {}),
  };
}
