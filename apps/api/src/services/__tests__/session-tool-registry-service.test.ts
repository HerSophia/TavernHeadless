import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BuiltinToolProvider,
  ToolRegistry,
  type ToolDefinition,
} from "@tavern/core";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type AppDb } from "../../db/client.js";
import { characters, mcpServerConfigs, projectMcpBindings, sessions, toolDefinitions } from "../../db/schema.js";
import { ResourceToolProvider } from "../../tools/resource-tool-provider.js";
import {
  SessionToolRegistryService,
  SessionToolRegistryServiceError,
} from "../session-tool-registry-service.js";
import { ToolRuntimePolicy } from "../tool-runtime-policy.js";
import {
  createTestProject,
  createTestSessionWithScope,
  createTestWorkspace,
  ensureTestDefaultWorkspace,
} from "../../__tests__/helpers/workspace-project.js";

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
  let defaultWorkspaceId: string;

  beforeEach(() => {
    const connection = createDatabase(":memory:");
    db = connection.db;
    closeDb = connection.close;
    defaultWorkspaceId = ensureTestDefaultWorkspace(db, DEFAULT_ADMIN_ACCOUNT_ID).workspaceId;

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
      workspaceId: defaultWorkspaceId,
      status: "active",
      deletedAt: null,
      revision: 0,
      latestVersionNo: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function insertSession(overrides: Partial<typeof sessions.$inferInsert> = {}) {
    const { id: overrideId, title: overrideTitle, accountId: overrideAccountId, workspaceId: overrideWorkspaceId, projectId: _projectId, ...values } = overrides;
    return createTestSessionWithScope(db, {
      id: overrideId ?? "sess-1",
      title: overrideTitle ?? "Runtime Session",
      accountId: overrideAccountId ?? DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: overrideWorkspaceId ?? defaultWorkspaceId,
      projectId: _projectId ?? undefined,
      values,
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
      workspaceId: defaultWorkspaceId,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  async function insertMcpConfig(overrides: Partial<typeof mcpServerConfigs.$inferInsert> = {}) {
    const now = Date.now();
    const values: typeof mcpServerConfigs.$inferInsert = {
      id: "mcp-1",
      name: "Runtime MCP",
      accountId: overrides.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: overrides.workspaceId ?? defaultWorkspaceId,
      transport: "http" as const,
      configJson: JSON.stringify({ http: { url: "http://localhost:8123" } }),
      toolPrefix: null,
      enabled: 1,
      connectTimeoutMs: 5_000,
      callTimeoutMs: 30_000,
      toolRefreshIntervalMs: 0,
      defaultSideEffectLevel: "irreversible" as const,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };

    await db.insert(mcpServerConfigs).values(values);
  }

  async function insertProjectBinding(input: {
    projectId: string;
    workspaceId: string;
    status?: "enabled" | "disabled";
    allowedTools?: string[];
    mcpServerId?: string;
  }) {
    const now = Date.now();
    await db.insert(projectMcpBindings).values({
      id: `pmb_${Math.random().toString(16).slice(2)}`,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      mcpServerId: input.mcpServerId ?? "mcp-1",
      status: input.status ?? "enabled",
      allowedToolsJson: JSON.stringify(input.allowedTools ?? []),
      configOverrideJson: JSON.stringify({}),
      createdAt: now,
      updatedAt: now,
    });
  }

  it("builds a session-scoped runtime registry with custom, preset, character, and MCP tools", async () => {
    await insertCharacter("char-1");
    const session = await insertSession({ presetId: "preset-1", characterId: "char-1" });
    await insertDefinition({ name: "custom_lookup", source: "custom", sourceId: null });
    await insertDefinition({ name: "preset_lookup", source: "preset", sourceId: "preset-1" });
    await insertDefinition({ name: "character_lookup", source: "character", sourceId: "char-1" });
    await insertMcpConfig();
    await insertProjectBinding({
      projectId: session.projectId,
      workspaceId: session.workspaceId,
    });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "mcp_lookup" }),
      ]),
      enableUnsafeScriptHandler: true,
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
        expect.objectContaining({ name: "custom_lookup", source: "custom", availability: "available", sideEffectLevelBasis: "tool_declared" }),
        expect.objectContaining({ name: "preset_lookup", source: "preset", availability: "available", parameterSchemaBasis: "tool_declared" }),
        expect.objectContaining({ name: "character_lookup", source: "character", availability: "available", allowedSlotsBasis: "tool_declared" }),
        expect.objectContaining({ name: "mcp_lookup", source: "mcp", availability: "available", catalogSource: "live", sideEffectLevelBasis: "server_default", allowedSlotsBasis: "platform_default", parameterSchemaBasis: "shallow_schema_projection", replaySafetyBasis: "inferred_from_execution_policy", exposure: { scope: "project_binding", serverState: "enabled", allowedToolsMode: "all", allowedTools: [] } }),
      ]),
    );
  });

  it("loads only tool definitions from the session Workspace", async () => {
    const otherWorkspace = createTestWorkspace(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "ws-other-runtime-tools",
      isDefault: false,
    });
    await insertSession();
    await insertDefinition({ name: "same_workspace_tool", workspaceId: defaultWorkspaceId });
    await insertDefinition({ name: "other_workspace_tool", workspaceId: otherWorkspace.workspaceId });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([]),
      enableUnsafeScriptHandler: true,
    });

    const runtime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
    const toolNames = (await runtime.registry.listAll()).map((tool) => tool.name);

    expect(toolNames).toContain("same_workspace_tool");
    expect(toolNames).not.toContain("other_workspace_tool");
  });

  it("propagates deferred MCP delivery metadata into the session runtime registry", async () => {
    const session = await insertSession();
    await insertMcpConfig();
    await insertProjectBinding({
      projectId: session.projectId,
      workspaceId: session.workspaceId,
    });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "github_create_issue" }),
      ]),
      toolRuntimePolicy: new ToolRuntimePolicy({
        enableDeferredIrreversibleTools: true,
        deferredToolAllowlist: ["mcp-1/github_create_issue"],
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
      asyncCapability: "deferred_ok",
      defaultDeliveryMode: "async_job",
      resultVisibility: "deferred_receipt",
      availability: "available",
      replaySafety: "never_auto_replay",
    });
  });

  it("applies MCP metadata overrides and exposes basis detail in the runtime catalog", async () => {
    const session = await insertSession();
    await insertMcpConfig({
      configJson: JSON.stringify({
        http: { url: "http://localhost:8123" },
        metadataOverrides: [{
          toolName: "mcp_lookup",
          sideEffectLevel: "sandbox",
          allowedSlots: ["narrator"],
          parameterSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
          replaySafety: "never_auto_replay",
        }],
      }),
      defaultSideEffectLevel: "none",
    });
    await insertProjectBinding({
      projectId: session.projectId,
      workspaceId: session.workspaceId,
    });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "mcp_lookup", sideEffectLevel: "none" }),
      ]),
      enableUnsafeScriptHandler: true,
    });

    const runtime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
    const entry = runtime.catalog.tools.find((tool) => tool.name === "mcp_lookup");

    expect(entry).toMatchObject({
      name: "mcp_lookup",
      source: "mcp",
      availability: "available",
      sideEffectLevel: "sandbox",
      sideEffectLevelBasis: "account_override",
      allowedSlots: ["narrator"],
      allowedSlotsBasis: "account_override",
      parameterSchemaBasis: "account_override",
      replaySafety: "never_auto_replay",
      replaySafetyBasis: "account_override",
      metadataBasisDetail: {
        sideEffectLevel: { basis: "account_override", scope: "tool" },
        allowedSlots: { basis: "account_override", scope: "tool" },
        parameterSchema: { basis: "account_override", scope: "local" },
        replaySafety: { basis: "account_override", scope: "local" },
      },
    });
  });

  it("falls back to cached MCP tools and marks the catalog source when live listing fails", async () => {
    const session = await insertSession();
    await insertMcpConfig();
    await insertProjectBinding({
      projectId: session.projectId,
      workspaceId: session.workspaceId,
    });

    const liveConnection = {
      state: "connected",
      getTools: vi.fn().mockReturnValue([makeTool({ name: "mcp_lookup" })]),
      callTool: vi.fn(),
    };
    const manager = {
      getConnection: vi
        .fn()
        .mockResolvedValueOnce(liveConnection)
        .mockRejectedValueOnce(new Error("mcp unavailable")),
    } as any;

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: manager,
      enableUnsafeScriptHandler: true,
    });

    const liveRuntime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
    expect(liveRuntime.catalog.tools.find((entry) => entry.name === "mcp_lookup")).toMatchObject({
      name: "mcp_lookup",
      source: "mcp",
      availability: "available",
      catalogSource: "live",
    });

    const cachedRuntime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
    expect((await cachedRuntime.registry.listAll()).some((entry) => entry.name === "mcp_lookup")).toBe(true);
    expect(cachedRuntime.catalog.tools.find((entry) => entry.name === "mcp_lookup")).toMatchObject({
      name: "mcp_lookup",
      source: "mcp",
      availability: "available",
      catalogSource: "cached",
    });
  });

  it("reports catalog source as unavailable when live listing fails and there is no snapshot", async () => {
    const session = await insertSession();
    await insertMcpConfig();
    await insertProjectBinding({
      projectId: session.projectId,
      workspaceId: session.workspaceId,
    });

    const manager = {
      getConnection: vi.fn().mockRejectedValue(new Error("mcp unavailable")),
    } as any;

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: manager,
      enableUnsafeScriptHandler: true,
    });

    const runtime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);

    expect(runtime.catalog.tools.some((entry) => entry.source === "mcp")).toBe(false);
    expect((await runtime.registry.listAll()).some((entry) => entry.source === "mcp")).toBe(false);
  });

  it("filters project-scoped MCP tools by binding status and allowedTools", async () => {
    const project = createTestProject(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-runtime-mcp-filter",
    });
    createTestSessionWithScope(db, {
      id: "sess-project-mcp-filter",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
      workspaceId: project.workspaceId,
    });
    await insertMcpConfig();
    await insertProjectBinding({
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      allowedTools: ["mcp_lookup"],
    });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "mcp_lookup" }),
        makeTool({ name: "mcp_other" }),
      ]),
      enableUnsafeScriptHandler: true,
    });

    const runtime = await service.buildRuntime("sess-project-mcp-filter", DEFAULT_ADMIN_ACCOUNT_ID);
    const allToolNames = (await runtime.registry.listAll()).map((tool) => tool.name);

    expect(allToolNames).toContain("mcp_lookup");
    expect(allToolNames).not.toContain("mcp_other");
    expect(runtime.catalog.tools.map((entry) => entry.name)).not.toContain("mcp_other");
    expect(runtime.catalog.tools.find((entry) => entry.name === "mcp_lookup")).toMatchObject({
      exposure: {
        scope: "project_binding",
        serverState: "enabled",
        allowedToolsMode: "allow_list",
        allowedTools: ["mcp_lookup"],
      },
    });
    expect(runtime.catalog.tools.some((entry) => entry.name === "mcp_other")).toBe(false);
  });

  it("hides all MCP tools for a project-scoped session when binding is disabled", async () => {
    const project = createTestProject(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-runtime-mcp-disabled",
    });
    createTestSessionWithScope(db, {
      id: "sess-project-mcp-disabled",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
      workspaceId: project.workspaceId,
    });
    await insertMcpConfig();
    await insertProjectBinding({
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      status: "disabled",
      allowedTools: ["mcp_lookup"],
    });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "mcp_lookup" }),
      ]),
      enableUnsafeScriptHandler: true,
    });

    const runtime = await service.buildRuntime("sess-project-mcp-disabled", DEFAULT_ADMIN_ACCOUNT_ID);

    expect(runtime.catalog.tools.some((entry) => entry.source === "mcp")).toBe(false);
    expect((await runtime.registry.listAll()).some((entry) => entry.source === "mcp")).toBe(false);
  });

  it("keeps legacy MCP exposure for sessions without project scope bindings", async () => {
    createTestWorkspace(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: defaultWorkspaceId,
      isDefault: true,
    });
    const now = Date.now();
    await db.insert(sessions).values({
      id: "sess-legacy-no-project",
      title: "Legacy Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      projectId: null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await insertMcpConfig();

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "mcp_lookup" }),
      ]),
      enableUnsafeScriptHandler: true,
    });

    const runtime = await service.buildRuntime("sess-legacy-no-project", DEFAULT_ADMIN_ACCOUNT_ID);

    expect((await runtime.registry.listAll()).some((entry) => entry.name === "mcp_lookup")).toBe(true);
    expect(runtime.catalog.tools.find((entry) => entry.name === "mcp_lookup")).toMatchObject({
      exposure: {
        scope: "legacy",
        serverState: "enabled",
        allowedToolsMode: "all",
        allowedTools: [],
      },
    });
  });

  it("throws tool_catalog_conflict when a definition-backed tool uses a reserved base name", async () => {
    await insertSession();
    await insertDefinition({ name: "roll_dice", source: "custom", sourceId: null });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      enableUnsafeScriptHandler: true,
    });

    try {
      await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
      expect.unreachable("Expected a tool catalog conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionToolRegistryServiceError);
      expect((error as SessionToolRegistryServiceError).code).toBe("tool_catalog_conflict");
    }
  });

  it("marks script definitions unavailable when unsafe execution is disabled", async () => {
    await insertSession();
    await insertDefinition({ name: "custom_lookup", source: "custom", sourceId: null });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      enableUnsafeScriptHandler: false,
    });

    const runtime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
    const allTools = await runtime.registry.listAll();

    expect(allTools.some((tool) => tool.name === "custom_lookup")).toBe(false);
    expect(runtime.catalog.tools.find((tool) => tool.name === "custom_lookup")).toMatchObject({
      name: "custom_lookup",
      availability: "unavailable",
      availabilityReason: expect.stringContaining("ENABLE_UNSAFE_SCRIPT_HANDLER=true"),
    });
  });

  it("throws when the session is not found", async () => {
    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      enableUnsafeScriptHandler: true,
    });

    await expect(service.buildRuntime("missing-session", DEFAULT_ADMIN_ACCOUNT_ID)).rejects.toMatchObject({
      code: "session_not_found",
    });
  });

  it("filters MCP configs by session workspace", async () => {
    const otherWorkspace = createTestWorkspace(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "ws-mcp-other",
      isDefault: false,
    });

    const session = await insertSession();
    await insertMcpConfig({ id: "mcp-default", name: "Default Workspace MCP", workspaceId: defaultWorkspaceId });
    await insertProjectBinding({
      projectId: session.projectId,
      workspaceId: session.workspaceId,
      mcpServerId: "mcp-default",
    });
    await insertMcpConfig({ id: "mcp-other", name: "Other Workspace MCP", workspaceId: otherWorkspace.workspaceId });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      mcpManager: createMockMcpManager([
        makeTool({ name: "mcp_lookup" }),
      ]),
      enableUnsafeScriptHandler: true,
    });

    const runtime = await service.buildRuntime("sess-1", DEFAULT_ADMIN_ACCOUNT_ID);
    const allTools = await runtime.registry.listAll();
    const mcpTools = allTools.filter((tool) => tool.source === "mcp");

    expect(mcpTools).toHaveLength(1);
    expect(runtime.catalog.tools.filter((tool) => tool.source === "mcp")).toHaveLength(1);
    expect(runtime.catalog.tools.find((tool) => tool.source === "mcp")).toMatchObject({
      providerId: "mcp:mcp-default",
    });
  });

  it("does not expose workspace-global custom tools inside other workspaces", async () => {
    const otherWorkspace = createTestWorkspace(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "ws-runtime-other",
      isDefault: false,
    });
    const project = createTestProject(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: otherWorkspace.workspaceId,
      id: "proj-runtime-other",
    });
    createTestSessionWithScope(db, {
      id: "sess-runtime-other",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: otherWorkspace.workspaceId,
      projectId: project.projectId,
    });
    await insertDefinition({ name: "default_workspace_tool", workspaceId: defaultWorkspaceId, source: "custom", sourceId: null });
    await insertDefinition({ name: "other_workspace_tool", workspaceId: otherWorkspace.workspaceId, source: "custom", sourceId: null });

    const service = new SessionToolRegistryService(db, {
      baseRegistry,
      enableUnsafeScriptHandler: true,
    });

    const runtime = await service.buildRuntime("sess-runtime-other", DEFAULT_ADMIN_ACCOUNT_ID);
    const allTools = await runtime.registry.listAll();
    const toolNames = allTools.map((tool) => tool.name);

    expect(toolNames).toContain("other_workspace_tool");
    expect(toolNames).not.toContain("default_workspace_tool");
    expect(runtime.catalog.tools.find((tool) => tool.name === "other_workspace_tool")).toMatchObject({
      source: "custom",
      availability: "available",
    });
    expect(runtime.catalog.tools.some((tool) => tool.name === "default_workspace_tool")).toBe(false);
  });
});
