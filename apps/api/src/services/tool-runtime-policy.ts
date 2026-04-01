import type {
  ToolDefinition,
} from "@tavern/core";

export interface ToolRuntimePolicyOptions {
  enableDeferredIrreversibleTools?: boolean;
  deferredMcpTools?: string[];
}

const DEFERRED_MCP_RECEIPT_NOTE = "This tool uses deferred execution. When called, it returns only an acceptance receipt with accepted=true, execution_id, job_id, and status='queued'. The final provider result is not available in the same turn.";

function normalizeAllowlistEntry(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.startsWith("mcp:") ? trimmed.slice(4) : trimmed;
  if (!normalized.includes("/")) {
    return null;
  }

  return normalized;
}

function appendDeferredReceiptNote(description: string): string {
  const base = description.trim();
  if (base.includes(DEFERRED_MCP_RECEIPT_NOTE)) {
    return base;
  }

  return base.length > 0
    ? `${base} ${DEFERRED_MCP_RECEIPT_NOTE}`
    : DEFERRED_MCP_RECEIPT_NOTE;
}

export class ToolRuntimePolicy {
  private readonly deferredMcpAllowlist: ReadonlySet<string>;
  private readonly enableDeferredIrreversibleTools: boolean;

  constructor(options: ToolRuntimePolicyOptions = {}) {
    this.enableDeferredIrreversibleTools = options.enableDeferredIrreversibleTools === true;
    this.deferredMcpAllowlist = new Set(
      (options.deferredMcpTools ?? [])
        .map(normalizeAllowlistEntry)
        .filter((entry): entry is string => entry !== null),
    );
  }

  isDeferredIrreversibleToolsEnabled(): boolean {
    return this.enableDeferredIrreversibleTools;
  }

  isDeferredMcpTool(serverId: string, toolName: string): boolean {
    if (!this.enableDeferredIrreversibleTools) {
      return false;
    }

    return this.deferredMcpAllowlist.has(`${serverId}/${toolName}`);
  }

  annotateMcpTool(serverId: string, tool: ToolDefinition): ToolDefinition {
    const deferred = this.isDeferredMcpTool(serverId, tool.name);

    return {
      ...tool,
      asyncCapability: deferred ? "deferred_ok" : "inline_only",
      defaultDeliveryMode: deferred ? "async_job" : "inline",
      resultVisibility: deferred ? "deferred_receipt" : "immediate",
      description: deferred
        ? appendDeferredReceiptNote(tool.description)
        : tool.description,
    };
  }
}
