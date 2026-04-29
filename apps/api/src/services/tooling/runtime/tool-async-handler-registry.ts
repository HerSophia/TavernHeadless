import type {
  RuntimeToolEnvelope,
  ToolCallResult,
  ToolDefinition,
} from "@tavern/core";

import type {
  DeferredHandlerTarget,
  DeferredToolExecutionInput,
  DeferredToolProviderHandler,
} from "./deferred-tool-provider-handler.js";

export interface ToolAsyncHandler {
  readonly providerType: RuntimeToolEnvelope["providerType"];
  execute(envelope: RuntimeToolEnvelope): Promise<ToolCallResult>;
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

function isDeferredToolProviderHandler(
  handler: ToolAsyncHandler | DeferredToolProviderHandler,
): handler is DeferredToolProviderHandler {
  return "executeDeferredJob" in handler
    && typeof handler.executeDeferredJob === "function";
}

function toDeferredToolProviderHandler(
  handler: ToolAsyncHandler | DeferredToolProviderHandler,
): DeferredToolProviderHandler {
  if (isDeferredToolProviderHandler(handler)) {
    return handler;
  }

  return {
    providerType: handler.providerType,
    canHandle(target) {
      return target.providerType === handler.providerType;
    },
    prepareDeferredExecution(input: DeferredToolExecutionInput) {
      return {
        tool: cloneToolDefinition(input.descriptor.tool),
      };
    },
    async executeDeferredJob(job) {
      return await handler.execute(job as RuntimeToolEnvelope<Record<string, unknown>, unknown>);
    },
  };
}

export class ToolAsyncHandlerRegistry {
  private readonly handlers: DeferredToolProviderHandler[] = [];

  register(handler: ToolAsyncHandler | DeferredToolProviderHandler): void {
    const normalized = toDeferredToolProviderHandler(handler);

    if (
      normalized.providerType
      && this.handlers.some((entry) => entry.providerType === normalized.providerType)
    ) {
      throw new Error(`Tool async handler already registered for provider type: ${normalized.providerType}`);
    }

    this.handlers.push(normalized);
  }

  hasHandlers(): boolean {
    return this.handlers.length > 0;
  }

  find(
    target: DeferredHandlerTarget | RuntimeToolEnvelope["providerType"],
  ): DeferredToolProviderHandler | undefined {
    if (typeof target === "string") {
      return this.handlers.find((handler) => handler.providerType === target);
    }

    return this.handlers.find((handler) => handler.canHandle(target));
  }
}

export interface CreateDefaultToolAsyncHandlerRegistryOptions {
  handlers?: Array<ToolAsyncHandler | DeferredToolProviderHandler>;
}

export function createDefaultToolAsyncHandlerRegistry(
  options: CreateDefaultToolAsyncHandlerRegistryOptions = {},
): ToolAsyncHandlerRegistry {
  const registry = new ToolAsyncHandlerRegistry();

  for (const handler of options.handlers ?? []) {
    registry.register(handler);
  }

  return registry;
}

export { McpDeferredToolHandler } from "../mcp/mcp-deferred-tool-handler.js";
