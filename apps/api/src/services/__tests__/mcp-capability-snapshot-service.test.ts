import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolDefinition } from "@tavern/core";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type AppDb } from "../../db/client.js";
import { mcpServerConfigs, projectMcpBindings, sessions } from "../../db/schema.js";
import {
  createTestProject,
  createTestWorkspace,
  ensureTestDefaultWorkspace,
} from "../../__tests__/helpers/workspace-project.js";
import { McpCapabilitySnapshotService } from "../tooling/mcp/mcp-capability-snapshot-service.js";
import { InMemoryMcpToolCatalogSnapshotStore } from "../tooling/mcp/mcp-tool-catalog-snapshot-store.js";

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "mcp_lookup",
    description: "A mock MCP tool",
    parameters: { type: "object", properties: {} },
    sideEffectLevel: "irreversible",
    allowedSlots: [],
    source: "mcp",
    ...overrides,
  };
}

function makeConnection(tools: ToolDefinition[]) {
  return {
    state: "connected",
    getTools: vi.fn().mockReturnValue(tools),
    callTool: vi.fn(),
  };
}

function createMockManager(options: {
  hasServer?: boolean;
  getConnectionResults?: Array<ReturnType<typeof makeConnection> | Error>;
  reconnectRequired?: boolean;
}) {
  const getConnection = vi.fn();
  for (const result of options.getConnectionResults ?? []) {
    if (result instanceof Error) {
      getConnection.mockRejectedValueOnce(result);
      continue;
    }

    getConnection.mockResolvedValueOnce(result);
  }

  return {
    hasServer: vi.fn().mockImplementation(() => options.hasServer ?? true),
    getStatus: vi.fn().mockImplementation((serverId: string) => ({
      serverId,
      serverName: "Runtime MCP",
      transport: "http",
      state: "connected",
      toolCount: 0,
      reconnectRequired: options.reconnectRequired ?? false,
    })),
    getConnection,
  } as any;
}

describe("McpCapabilitySnapshotService", () => {
  let db: AppDb;
  let closeDb: () => void;
  let defaultWorkspaceId: string;

  beforeEach(() => {
    const connection = createDatabase(":memory:");
    db = connection.db;
    closeDb = connection.close;
    defaultWorkspaceId = ensureTestDefaultWorkspace(db, DEFAULT_ADMIN_ACCOUNT_ID).workspaceId;
  });

  afterEach(() => {
    closeDb();
  });

  async function insertMcpConfig(overrides: Partial<typeof mcpServerConfigs.$inferInsert> = {}) {
    const now = Date.now();
    await db.insert(mcpServerConfigs).values({
      id: "mcp-1",
      name: "Runtime MCP",
      accountId: overrides.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: overrides.workspaceId ?? defaultWorkspaceId,
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

  async function insertProjectBinding(input: {
    projectId: string;
    workspaceId: string;
    status?: "enabled" | "disabled";
    allowedTools?: string[];
    configOverrideJson?: Record<string, unknown>;
  }) {
    const now = Date.now();
    await db.insert(projectMcpBindings).values({
      id: `pmb_${Math.random().toString(16).slice(2)}`,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      mcpServerId: "mcp-1",
      status: input.status ?? "enabled",
      allowedToolsJson: JSON.stringify(input.allowedTools ?? []),
      configOverrideJson: JSON.stringify(input.configOverrideJson ?? {}),
      createdAt: now,
      updatedAt: now,
    });
  }

  it("builds a live project-scoped snapshot with binding-filtered tools", async () => {
    const project = createTestProject(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-capability-live",
    });
    await insertMcpConfig();
    await insertProjectBinding({
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      allowedTools: ["mcp_lookup"],
      configOverrideJson: { timeout_ms: 1000 },
    });

    const service = new McpCapabilitySnapshotService(
      db,
      createMockManager({
        hasServer: true,
        getConnectionResults: [
          makeConnection([
            makeTool({ name: "mcp_lookup", sideEffectLevel: "sandbox", asyncCapability: "deferred_ok", resultVisibility: "deferred_receipt" }),
            makeTool({ name: "mcp_other" }),
          ]),
        ],
      }),
      { snapshotStore: new InMemoryMcpToolCatalogSnapshotStore() },
    );

    const snapshot = await service.snapshotForProject({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
    });

    expect(snapshot.scope).toBe("project");
    expect(snapshot.projectId).toBe(project.projectId);
    expect(snapshot.servers).toHaveLength(1);
    expect(snapshot.servers[0]).toMatchObject({
      serverId: "mcp-1",
      state: "live",
      toolCount: 1,
      binding: {
        scope: "project_binding",
        status: "enabled",
        allowedToolsMode: "allow_list",
        allowedTools: ["mcp_lookup"],
        configOverrideJson: { timeout_ms: 1000 },
      },
      tools: {
        integrationState: "integrated",
        source: "live",
        items: [
          {
            name: "mcp_lookup",
            sideEffectLevel: "sandbox",
            asyncCapability: "deferred_ok",
            resultVisibility: "deferred_receipt",
          },
        ],
      },
      prompts: { integrationState: "not_integrated" },
      resources: { integrationState: "not_integrated" },
    });
  });

  it("marks disabled project bindings as disabled without runtime tools", async () => {
    const project = createTestProject(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-capability-disabled",
    });
    await insertMcpConfig();
    await insertProjectBinding({
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      status: "disabled",
      allowedTools: ["mcp_lookup"],
    });

    const service = new McpCapabilitySnapshotService(
      db,
      createMockManager({ hasServer: true }),
    );

    const snapshot = await service.snapshotForProject({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
    });

    expect(snapshot.servers[0]).toMatchObject({
      state: "disabled",
      toolCount: 0,
      tools: { integrationState: "integrated", source: null, items: [] },
    });
  });

  it("marks enabled servers as not_attached when runtime manager has not attached them", async () => {
    const project = createTestProject(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-capability-detached",
    });
    await insertMcpConfig();
    await insertProjectBinding({
      projectId: project.projectId,
      workspaceId: project.workspaceId,
    });

    const service = new McpCapabilitySnapshotService(
      db,
      createMockManager({ hasServer: false }),
    );

    const snapshot = await service.snapshotForProject({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
    });

    expect(snapshot.servers[0]).toMatchObject({
      state: "not_attached",
      toolCount: 0,
      tools: { integrationState: "integrated", source: null, items: [] },
    });
  });

  it("falls back to cached tools for legacy session snapshots after a live read", async () => {
    createTestWorkspace(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: defaultWorkspaceId,
      isDefault: true,
    });
    const now = Date.now();
    await db.insert(sessions).values({
      id: "sess-capability-legacy",
      title: "Legacy Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      projectId: null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await insertMcpConfig();

    const manager = createMockManager({
      hasServer: true,
      getConnectionResults: [
        makeConnection([makeTool({ name: "mcp_lookup" })]),
        new Error("mcp unavailable"),
      ],
    });
    const snapshotStore = new InMemoryMcpToolCatalogSnapshotStore();
    const service = new McpCapabilitySnapshotService(db, manager, { snapshotStore });

    const liveSnapshot = await service.snapshotForSession({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: "sess-capability-legacy",
    });
    const cachedSnapshot = await service.snapshotForSession({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: "sess-capability-legacy",
    });

    expect(liveSnapshot.servers[0]).toMatchObject({
      state: "live",
      binding: null,
      tools: {
        integrationState: "integrated",
        source: "live",
        items: [
          { name: "mcp_lookup" },
        ],
      },
    });
    expect(cachedSnapshot.servers[0]).toMatchObject({
      state: "cached",
      binding: null,
      tools: {
        integrationState: "integrated",
        source: "cached",
        items: [
          { name: "mcp_lookup" },
        ],
      },
    });
  });
});
