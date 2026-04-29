import type { ToolDefinition } from "@tavern/core";

import type { RuntimeToolDescriptor } from "./deferred-tool-provider-handler.js";

export interface ToolRuntimePolicyOptions {
  enableDeferredIrreversibleTools?: boolean;
  deferredToolAllowlist?: string[];
}

const DEFERRED_TOOL_RECEIPT_NOTE = "This tool uses deferred execution. When called, it returns only an acceptance receipt with accepted=true, execution_id, job_id, and status='queued'. The final provider result is not available in the same turn.";

function normalizeAllowlistEntry(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const separatorIndex = trimmed.lastIndexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }

  const providerRef = trimmed.slice(0, separatorIndex).trim();
  const toolName = trimmed.slice(separatorIndex + 1).trim();
  if (providerRef.length === 0 || toolName.length === 0) {
    return null;
  }

  return providerRef.includes(":")
    ? `${providerRef}/${toolName}`
    : `mcp:${providerRef}/${toolName}`;
}

function normalizeProviderReference(
  providerType: string,
  providerId: string,
): { canonical: string; legacy?: string } {
  const canonical = providerId.startsWith(`${providerType}:`)
    ? providerId
    : `${providerType}:${providerId}`;

  if (providerType === "mcp") {
    return {
      canonical,
      legacy: canonical.startsWith("mcp:") ? canonical.slice(4) : canonical,
    };
  }

  return { canonical };
}

function buildDeferredToolAllowlistKeys(descriptor: RuntimeToolDescriptor): string[] {
  const providerRef = normalizeProviderReference(
    descriptor.providerType,
    descriptor.providerId,
  );
  const keys = [`${providerRef.canonical}/${descriptor.tool.name}`];

  if (providerRef.legacy && providerRef.legacy !== providerRef.canonical) {
    keys.push(`${providerRef.legacy}/${descriptor.tool.name}`);
  }

  return keys;
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

function appendDeferredReceiptNote(description: string): string {
  const base = description.trim();
  if (base.includes(DEFERRED_TOOL_RECEIPT_NOTE)) {
    return base;
  }

  return base.length > 0
    ? `${base} ${DEFERRED_TOOL_RECEIPT_NOTE}`
    : DEFERRED_TOOL_RECEIPT_NOTE;
}

export class ToolRuntimePolicy {
  private readonly deferredToolAllowlist: ReadonlySet<string>;
  private readonly enableDeferredIrreversibleTools: boolean;

  constructor(options: ToolRuntimePolicyOptions = {}) {
    this.enableDeferredIrreversibleTools = options.enableDeferredIrreversibleTools === true;
    this.deferredToolAllowlist = new Set(
      (options.deferredToolAllowlist ?? [])
        .map(normalizeAllowlistEntry)
        .filter((entry): entry is string => entry !== null),
    );
  }

  isDeferredIrreversibleToolsEnabled(): boolean {
    return this.enableDeferredIrreversibleTools;
  }

  isDeferredToolAllowed(descriptor: RuntimeToolDescriptor): boolean {
    if (!this.enableDeferredIrreversibleTools) {
      return false;
    }

    if (descriptor.tool.sideEffectLevel !== "irreversible") {
      return false;
    }

    return buildDeferredToolAllowlistKeys(descriptor)
      .some((entry) => this.deferredToolAllowlist.has(entry));
  }

  annotateToolDefinition(descriptor: RuntimeToolDescriptor): ToolDefinition {
    const deferred = this.isDeferredToolAllowed(descriptor);
    const tool = cloneToolDefinition(descriptor.tool);

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
