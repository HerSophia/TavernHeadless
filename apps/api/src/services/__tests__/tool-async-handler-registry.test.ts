import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeToolEnvelope } from "@tavern/core";

import { createDatabase, type AppDb } from "../../db/client.js";
import { McpToolProviderFactory } from "../../mcp/mcp-tool-provider-factory.js";
import type { McpConnectionManager } from "../../mcp/mcp-connection-manager.js";
import { McpDeferredToolHandler } from "../tool-async-handler-registry.js";
import { mcpServerConfigs } from "../../db/schema.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";

function makeEnvelope(overrides: Partial<RuntimeToolEnvelope> = {}): RuntimeToolEnvelope {
  return {
    executionId: "exec-1",
    runId: "run-1",
    sessionId: "sess-1",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    floorId: "floor-1",
    callerSlot: "narrator",
    providerId: "mcp:srv-1",
    providerType: "mcp",
    toolName: "tool",
    args: {},
    sideEffectLevel: "irreversible",
    deliveryMode: "async_job",
    asyncCapability: "deferred_ok",
    resultVisibility: "deferred_receipt",
    acceptedAt: 0,
    ...overrides,
  };
}

describe("McpDeferredToolHandler", () => {
  let db: AppDb;
  let closeDb: () => void;

  beforeEach(() => {
    const connection = createDatabase(":memory:");
    db = connection.db;
    closeDb = connection.close;
  });

  afterEach(() => {
    closeDb();
  });

  async function insertServerConfig() {
    const now = Date.now();
    await db.insert(mcpServerConfigs).values({
      id: "srv-1",
      name: "Deferred MCP",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      transport: "http" as const,
      configJson: JSON.stringify({ http: { url: "http://localhost:9123" } }),
      toolPrefix: null,
      enabled: 1,
      connectTimeoutMs: 5_000,
      callTimeoutMs: 30_000,
      toolRefreshIntervalMs: 0,
      defaultSideEffectLevel: "irreversible" as const,
      createdAt: now,
      updatedAt: now,
    });
  }

  it("uses the provided factory to construct the provider and preserves structured status", async () => {
    await insertServerConfig();

    const manager = {
      hasServer: vi.fn().mockReturnValue(true),
      addServer: vi.fn(),
      getConnection: vi.fn().mockResolvedValue(null),
    } as unknown as McpConnectionManager;

    const factory = new McpToolProviderFactory({
      connectionManager: manager,
    });
    const createSpy = vi.spyOn(factory, "create");

    const handler = new McpDeferredToolHandler(db, manager, {
      providerFactory: factory,
    });

    const result = await handler.execute(makeEnvelope());

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(result.executionStatus).toBe("error");
    expect(result.executionReasonCode).toBe("mcp_not_connected");
  });

  it("returns structured reason codes when account context is missing", async () => {
    const manager = {
      hasServer: vi.fn(),
      addServer: vi.fn(),
      getConnection: vi.fn(),
    } as unknown as McpConnectionManager;

    const handler = new McpDeferredToolHandler(db, manager);

    const result = await handler.execute(makeEnvelope({ accountId: undefined }));

    expect(result.executionReasonCode).toBe("mcp_account_required");
  });
});
