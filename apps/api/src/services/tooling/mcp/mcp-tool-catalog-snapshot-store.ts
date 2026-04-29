import {
  cloneGovernedMcpTool,
  type GovernedMcpTool,
} from './mcp-tool-metadata-governance.js';

export interface McpToolCatalogSnapshot {
  providerKey: string;
  tools: GovernedMcpTool[];
  capturedAt: number;
}

export interface McpToolCatalogSnapshotStore {
  get(providerKey: string): Promise<McpToolCatalogSnapshot | null>;
  put(providerKey: string, snapshot: McpToolCatalogSnapshot): Promise<void>;
}

function cloneSnapshot(snapshot: McpToolCatalogSnapshot): McpToolCatalogSnapshot {
  return {
    providerKey: snapshot.providerKey,
    capturedAt: snapshot.capturedAt,
    tools: snapshot.tools.map((tool) => cloneGovernedMcpTool(tool)),
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
