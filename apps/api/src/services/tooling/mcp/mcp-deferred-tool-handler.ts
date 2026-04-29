import type {
  RuntimeToolEnvelope,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
} from "@tavern/core";

import type { AppDb } from "../../../db/client.js";
import type {
  DeferredHandlerTarget,
  DeferredPreparationResult,
  DeferredToolExecutionInput,
  DeferredToolProviderHandler,
} from "../runtime/deferred-tool-provider-handler.js";
import type { ToolRuntimePolicy } from "../runtime/tool-runtime-policy.js";
import type { McpConnectionManager } from "./mcp-connection-manager.js";
import { McpService } from "./mcp-service.js";
import { McpToolProvider } from "./mcp-tool-provider.js";
import type { McpToolProviderFactory } from "./mcp-tool-provider-factory.js";

function parseMcpProviderId(providerId: string): string | null {
  return providerId.startsWith("mcp:") && providerId.length > 4
    ? providerId.slice(4)
    : null;
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

function toToolExecutionContext(envelope: RuntimeToolEnvelope): ToolExecutionContext {
  return {
    sessionId: envelope.sessionId,
    ...(envelope.accountId ? { accountId: envelope.accountId } : {}),
    ...(envelope.branchId ? { branchId: envelope.branchId } : {}),
    floorId: envelope.floorId,
    ...(envelope.pageId ? { pageId: envelope.pageId } : {}),
    callerSlot: envelope.callerSlot,
    variableContext: {
      sessionId: envelope.sessionId,
      ...(envelope.accountId ? { accountId: envelope.accountId } : {}),
      ...(envelope.branchId ? { branchId: envelope.branchId } : {}),
      floorId: envelope.floorId,
      ...(envelope.pageId ? { pageId: envelope.pageId } : {}),
    },
  };
}

export interface McpDeferredToolHandlerOptions {
  toolRuntimePolicy?: ToolRuntimePolicy;
  providerFactory?: McpToolProviderFactory;
}

export class McpDeferredToolHandler implements DeferredToolProviderHandler {
  readonly providerType = "mcp" as const;

  private readonly mcpService: McpService;

  constructor(
    db: AppDb,
    private readonly manager: McpConnectionManager,
    private readonly options: McpDeferredToolHandlerOptions = {},
  ) {
    this.mcpService = new McpService(db);
  }

  canHandle(target: DeferredHandlerTarget): boolean {
    return target.providerType === this.providerType;
  }

  prepareDeferredExecution(
    input: DeferredToolExecutionInput,
  ): DeferredPreparationResult {
    const tool = this.options.toolRuntimePolicy
      ? this.options.toolRuntimePolicy.annotateToolDefinition(input.descriptor)
      : cloneToolDefinition(input.descriptor.tool);

    return {
      tool: cloneToolDefinition(tool),
    };
  }

  async executeDeferredJob(envelope: RuntimeToolEnvelope): Promise<ToolCallResult> {
    if (!envelope.accountId) {
      return {
        error: "Deferred MCP tool execution requires accountId",
        executionStatus: "error",
        executionReasonCode: "mcp_account_required",
      };
    }

    const serverId = parseMcpProviderId(envelope.providerId);
    if (!serverId) {
      return {
        error: `Invalid deferred MCP provider id '${envelope.providerId}'`,
        executionStatus: "error",
        executionReasonCode: "mcp_invalid_provider_id",
      };
    }

    try {
      const config = await this.mcpService.getConfigEntity(serverId, envelope.accountId);
      if (!config || !config.enabled) {
        return {
          error: `MCP server '${serverId}' is unavailable for deferred execution`,
          executionStatus: "error",
          executionReasonCode: "mcp_server_unavailable",
        };
      }

      if (!this.manager.hasServer(serverId)) {
        await this.manager.addServer(config);
      }

      const provider = this.options.providerFactory
        ? this.options.providerFactory.create(config)
        : new McpToolProvider(config, this.manager, {
            ...(this.options.toolRuntimePolicy ? { toolRuntimePolicy: this.options.toolRuntimePolicy } : {}),
            deferredHandler: this,
          });

      return await provider.executeTool(
        envelope.toolName,
        envelope.args,
        toToolExecutionContext(envelope),
      );
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        executionStatus: "error",
        executionReasonCode: "mcp_provider_error",
      };
    }
  }

  async execute(envelope: RuntimeToolEnvelope): Promise<ToolCallResult> {
    return await this.executeDeferredJob(envelope);
  }

  recoverDeferredJob() {
    return { handled: false } as const;
  }
}
