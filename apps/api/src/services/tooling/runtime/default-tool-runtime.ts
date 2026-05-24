import type { CoreEventBus } from "@tavern/core";

import type { AppDb } from "../../../db/client.js";
import type { McpConnectionManager } from "../mcp/mcp-connection-manager.js";
import { McpDeferredToolHandler } from "../mcp/mcp-deferred-tool-handler.js";
import {
  createDefaultToolAsyncHandlerRegistry,
  type ToolAsyncHandler,
  type ToolAsyncHandlerRegistry,
} from "./tool-async-handler-registry.js";
import type { DeferredToolProviderHandler } from "./deferred-tool-provider-handler.js";
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
  deferredToolAllowlist?: string[];
  deferredHandlers?: Array<ToolAsyncHandler | DeferredToolProviderHandler>;
  now?: () => number;
  logger?: ToolWorkerLogger;
}

export interface DefaultToolRuntimeComponents {
  policy: ToolRuntimePolicy;
  bridge: ToolRuntimeJobBridge;
  handlerRegistry: ToolAsyncHandlerRegistry;
  worker?: ToolWorker;
}

export function createDefaultToolRuntimeComponents(
  db: AppDb,
  options: DefaultToolRuntimeOptions = {},
): DefaultToolRuntimeComponents {
  const policy = new ToolRuntimePolicy({
    enableDeferredIrreversibleTools: options.enableDeferredIrreversibleTools,
    deferredToolAllowlist: options.deferredToolAllowlist,
  });
  const bridge = createToolRuntimeJobBridge(db, {
    eventBus: options.eventBus,
    toolRuntimePolicy: policy,
  });
  const handlerRegistry = createDefaultToolAsyncHandlerRegistry({
    handlers: options.deferredHandlers,
  });

  if (options.mcpManager) {
    const mcpDeferredHandler = new McpDeferredToolHandler(db, options.mcpManager, {
      toolRuntimePolicy: policy,
    });
    handlerRegistry.register(mcpDeferredHandler);
  }

  const worker = policy.isDeferredIrreversibleToolsEnabled() && handlerRegistry.hasHandlers()
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
    ...(worker ? { worker } : {}),
  };
}
