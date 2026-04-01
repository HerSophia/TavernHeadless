import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BuiltinToolProvider,
  ToolRegistry,
  type ToolDefinition,
} from "@tavern/core";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type AppDb } from "../../db/client.js";
import { characters, mcpServerConfigs, sessions, toolDefinitions } from "../../db/schema.js";
import { ResourceToolProvider } from "../../tools/resource-tool-provider.js";
import {
  SessionToolRegistryService,
  SessionToolRegistryServiceError,
} from "../session-tool-registry-service.js";
import { ToolRuntimePolicy } from "../tool-runtime-policy.js";

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "mcp_tool",
    description: "A mock MCP tool",
    parameters: { type: "object", properties: {} },
    sideEffectLevel: "irreversible",
    allowedSlots: [],
    source: "mcp",
    ...overrides,
  };
}

function createMockMcpManager(tools: ToolDefinition[]) {
  const connection = {
    state: "connected",
    getTools: vi.fn().mockReturnValue(tools),
    callTool: vi.fn(),
  };

  return {
    getConnection: vi.fn().mockResolvedValue(connection),
  } as any;
}

describe("SessionToolRegistryService", () => {
  let db: AppDb;
  let closeDb: () => void;
  let baseRegistry: ToolRegistry;

  beforeEach(() => {
    const connection = createDatabase(":memory:");
    db = connection.db;
    closeDb = connection.close;

    baseRegistry = new ToolRegistry();
    baseRegistry.register(new BuiltinToolProvider());
    baseRegistry.register(new ResourceToolProvider(db));
  });

  afterEach(() => {
    closeDb();
  });

  async function insertCharacter(id: string) {
    const now = Date.now();
    await db.insert(characters).values({
      id,
      name: `Character ${id}`,
      source: "test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      deletedAt: null,
      revision: 0,
      latestVersionNo: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function insertSession(overrides: Partial<typeof sessions.$inferInsert> = {}) {
    const now = Date.now();
    await db.insert(sessions).values({
      id: "sess-1",
      title: "Runtime Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  async function insertDefinition(overrides: Partial<typeof toolDefinitions.$inferInsert> = {}) {
    const now = Date.now();
    await db.insert(toolDefinitions).values({
      id: `tool-${Math.random().toString(16).slice(2)}`,
      name: "custom_lookup",
      description: "A runtime tool",
      parametersJson: JSON.stringify({ type: "object", properties: {} }),
      sideEffectLevel: "none",
      allowedSlotsJson: JSON.stringify(["narrator"]),
      source: "custom",
      sourceId: null,
      enabled: true,
      handlerType: "script",
      handlerJson: JSON.stringify({ script: "return args" }),
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  async function insertMcpConfig(overrides: Partial<typeof mcpServerConfigs.$inferInsert> = {}) {
    const now = Date.now();
    await db.insert(mcpServerConfigs).values({
      id: "mcp-1",
      name: "Runtime MCP",
      transport: "http",
      configJson: JSON.stringify({ http: { url: "http://localhost:8123" } }),
      toolPrefix: null,
      enabled: 1,
      connectTimeoutMs: 5_000,
      callTimeoutMs: 30_000,
      toolRefreshIntervalMs: 0,
      defaultSideEffectLevel: "irreversible",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  it("builds a session-scoped runtime registry with custom, preset, character, and MCP tools", async () => {
    await insertCharacter("char-1");
    await insertSession({ presetId: "preset-1", characterId: "char-1" });
    await insertDefinition({ name: "custom_lookup", source: "custom", sourceId: null });
    await insertDefinition({ name: "preset_lookup", source: "preset", sourceId: "preset-1" });
    await insertDefinition({ name: "character_lookup", source: "character", sourceId: "char-1" });
    await insertMcpConfig();

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "mcp_lookup" }),
      ]),
    });

    const runtime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
    const allTools = await runtime.registry.listAll();
    const allToolNames = allTools.map((tool) => tool.name);

    expect(allToolNames).toContain("custom_lookup");
    expect(allToolNames).toContain("preset_lookup");
    expect(allToolNames).toContain("character_lookup");
    expect(allToolNames).toContain("mcp_lookup");

    expect(runtime.catalog.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "custom_lookup", source: "custom", availability: "available" }),
        expect.objectContaining({ name: "preset_lookup", source: "preset", availability: "available" }),
        expect.objectContaining({ name: "character_lookup", source: "character", availability: "available" }),
        expect.objectContaining({ name: "mcp_lookup", source: "mcp", availability: "available" }),
      ]),
    );
  });

  it("propagates deferred MCP delivery metadata into the session runtime registry", async () => {
    await insertSession();
    await insertMcpConfig();

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "github_create_issue" }),
      ]),
      toolRuntimePolicy: new ToolRuntimePolicy({
        enableDeferredIrreversibleTools: true,
        deferredMcpTools: ["mcp-1/github_create_issue"],
      }),
    });

    const runtime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
    const tool = (await runtime.registry.listAll()).find((entry) => entry.name === "github_create_issue");
    const catalogEntry = runtime.catalog.tools.find((entry) => entry.name === "github_create_issue");

    expect(tool).toMatchObject({
      asyncCapability: "deferred_ok",
      defaultDeliveryMode: "async_job",
      resultVisibility: "deferred_receipt",
    });
    expect(tool?.description).toContain("acceptance receipt");
    expect(catalogEntry).toMatchObject({
      name: "github_create_issue",
      source: "mcp",
      availability: "available",
      replaySafety: "never_auto_replay",
    });
  });

  it("throws tool_catalog_conflict when a definition-backed tool uses a reserved base name", async () => {
    await insertSession();
    await insertDefinition({ name: "roll_dice", source: "custom", sourceId: null });

    const service = new SessionToolRegistryService(db, { baseRegistry });

    try {
      await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
      expect.unreachable("Expected a tool catalog conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionToolRegistryServiceError);
      expect((error as SessionToolRegistryServiceError).code).toBe("tool_catalog_conflict");

      const details = (error as SessionToolRegistryServiceError).details as {
        conflicts: Array<{ toolName: string; providerIds: string[] }>;
      };
      expect(details.conflicts).toEqual([
        expect.objectContaining({
          toolName: "roll_dice",
          providerIds: ["builtin", `custom:${DEFAULT_ADMIN_ACCOUNT_ID}`],
        }),
      ]);
    }
  });

  it("marks MCP name collisions as conflict and excludes the conflicting MCP tool from the callable registry", async () => {
    await insertSession();
    await insertDefinition({ name: "custom_lookup", source: "custom", sourceId: null });
    await insertMcpConfig();

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "custom_lookup" }),
        makeTool({ name: "mcp_only" }),
      ]),
    });

    const runtime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
    const allTools = await runtime.registry.listAll();
    const customLookupTools = allTools.filter((tool) => tool.name === "custom_lookup");

    expect(customLookupTools).toHaveLength(1);
    expect(allTools.some((tool) => tool.name === "mcp_only")).toBe(true);
    expect(runtime.catalog.conflicts).toEqual([
      expect.objectContaining({
        toolName: "custom_lookup",
        providerIds: [`custom:${DEFAULT_ADMIN_ACCOUNT_ID}`, "mcp:mcp-1"],
      }),
    ]);
    expect(runtime.catalog.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "custom_lookup",
          source: "mcp",
          availability: "conflict",
        }),
        expect.objectContaining({
          name: "mcp_only",
          source: "mcp",
          availability: "available",
        }),
      ]),
    );
  });
});
