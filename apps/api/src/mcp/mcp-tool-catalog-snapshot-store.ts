import type { ToolDefinition } from "@tavern/core";

export interface McpToolCatalogSnapshot {
  providerKey: string;
  tools: ToolDefinition[];
  capturedAt: number;
}

export interface McpToolCatalogSnapshotStore {
  get(providerKey: string): Promise<McpToolCatalogSnapshot | null>;
  put(providerKey: string, snapshot: McpToolCatalogSnapshot): Promise<void>;
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

function cloneSnapshot(snapshot: McpToolCatalogSnapshot): McpToolCatalogSnapshot {
  return {
    providerKey: snapshot.providerKey,
    capturedAt: snapshot.capturedAt,
    tools: snapshot.tools.map((tool) => cloneToolDefinition(tool)),
  };
}

export class InMemoryMcpToolCatalogSnapshotStore implements McpToolCatalogSnapshotStore {
  private readonly snapshots = new Map<string, McpToolCatalogSnapshot>();

  async get(providerKey: string): Promise<McpToolCatalogSnapshot | null> {
    const normalizedKey = providerKey.trim();
    if (!normalizedKey) {
      return null;
    }

    const snapshot = this.snapshots.get(normalizedKey);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  async put(providerKey: string, snapshot: McpToolCatalogSnapshot): Promise<void> {
    const normalizedKey = providerKey.trim();
    if (!normalizedKey) {
      return;
    }

    this.snapshots.set(normalizedKey, cloneSnapshot({
      ...snapshot,
      providerKey: normalizedKey,
    }));
  }
}
