import type {
  RuntimeToolEnvelope,
  ToolCallResult,
  ToolExecutionContext,
} from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { McpToolProvider } from "../mcp/mcp-tool-provider.js";
import type { McpConnectionManager } from "../mcp/mcp-connection-manager.js";
import { McpService } from "./mcp-service.js";

export interface ToolAsyncHandler {
  readonly providerType: RuntimeToolEnvelope["providerType"];
  execute(envelope: RuntimeToolEnvelope): Promise<ToolCallResult>;
}

export class ToolAsyncHandlerRegistry {
  private readonly handlers = new Map<RuntimeToolEnvelope["providerType"], ToolAsyncHandler>();

  register(handler: ToolAsyncHandler): void {
    if (this.handlers.has(handler.providerType)) {
      throw new Error(`Tool async handler already registered for provider type: ${handler.providerType}`);
    }

    this.handlers.set(handler.providerType, handler);
  }

  find(providerType: RuntimeToolEnvelope["providerType"]): ToolAsyncHandler | undefined {
    return this.handlers.get(providerType);
  }
}

function parseMcpProviderId(providerId: string): string | null {
  return providerId.startsWith("mcp:") && providerId.length > 4
    ? providerId.slice(4)
    : null;
}

function toToolExecutionContext(envelope: RuntimeToolEnvelope): ToolExecutionContext {
  return {
    sessionId: envelope.sessionId,
    ...(envelope.accountId ? { accountId: envelope.accountId } : {}),
    floorId: envelope.floorId,
    ...(envelope.pageId ? { pageId: envelope.pageId } : {}),
    callerSlot: envelope.callerSlot,
    variableContext: {
      sessionId: envelope.sessionId,
      ...(envelope.accountId ? { accountId: envelope.accountId } : {}),
      floorId: envelope.floorId,
      ...(envelope.pageId ? { pageId: envelope.pageId } : {}),
    },
  };
}

export class McpDeferredToolHandler implements ToolAsyncHandler {
  readonly providerType = "mcp" as const;

  private readonly mcpService: McpService;

  constructor(
    db: AppDb,
    private readonly manager: McpConnectionManager,
  ) {
    this.mcpService = new McpService(db);
  }

  async execute(envelope: RuntimeToolEnvelope): Promise<ToolCallResult> {
    if (!envelope.accountId) {
      return {
        error: "Deferred MCP tool execution requires accountId",
        executionStatus: "error",
      };
    }

    const serverId = parseMcpProviderId(envelope.providerId);
    if (!serverId) {
      return {
        error: `Invalid deferred MCP provider id '${envelope.providerId}'`,
        executionStatus: "error",
      };
    }

    try {
      const config = await this.mcpService.getConfigEntity(serverId, envelope.accountId);
      if (!config || !config.enabled) {
        return {
          error: `MCP server '${serverId}' is unavailable for deferred execution`,
          executionStatus: "error",
        };
      }

      if (!this.manager.hasServer(serverId)) {
        await this.manager.addServer(config);
      }

      const provider = new McpToolProvider(config, this.manager);
      return await provider.executeTool(
        envelope.toolName,
        envelope.args,
        toToolExecutionContext(envelope),
      );
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        executionStatus: "error",
      };
    }
  }
}

export interface CreateDefaultToolAsyncHandlerRegistryOptions {
  mcpManager?: McpConnectionManager;
}

export function createDefaultToolAsyncHandlerRegistry(
  db: AppDb,
  options: CreateDefaultToolAsyncHandlerRegistryOptions = {},
): ToolAsyncHandlerRegistry {
  const registry = new ToolAsyncHandlerRegistry();

  if (options.mcpManager) {
    registry.register(new McpDeferredToolHandler(db, options.mcpManager));
  }

  return registry;
}
