import { rmSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalMasterKey = process.env.APP_SECRETS_MASTER_KEY;

const runtimeMockState = vi.hoisted(() => {
  const instances = new Map<string, any>();

  class MockMcpConnection {
    config: any;
    state = "disconnected";
    error: string | undefined;
    connectedAt: number | undefined;
    toolsRefreshedAt: number | undefined;
    reconnectRequired = false;
    lastTimeoutAt: number | undefined;
    connectCalls = 0;
    disconnectCalls = 0;
    private tools: Array<Record<string, unknown>> = [];

    constructor(config: any) {
      this.config = config;
      instances.set(config.id, this);
    }

    get toolCount(): number {
      return this.tools.length;
    }

    async connect(): Promise<void> {
      this.connectCalls += 1;
      this.state = "connected";
      this.error = undefined;
      this.connectedAt = Date.now();
      this.toolsRefreshedAt = Date.now();
      this.reconnectRequired = false;
      this.lastTimeoutAt = undefined;
      this.tools = [
        {
          name: `${this.config.toolPrefix ?? ""}echo`,
          description: "Mock MCP tool",
          parameters: { type: "object", properties: {} },
          sideEffectLevel: this.config.defaultSideEffectLevel,
          allowedSlots: [],
          source: "mcp",
        },
      ];
    }

    async disconnect(): Promise<void> {
      this.disconnectCalls += 1;
      this.state = "disconnected";
      this.connectedAt = undefined;
      this.reconnectRequired = false;
      this.lastTimeoutAt = undefined;
      this.tools = [];
    }

    getTools(): Array<Record<string, unknown>> {
      return this.tools;
    }
  }

  return {
    instances,
    MockMcpConnection,
  };
});

vi.mock("../src/services/tooling/mcp/mcp-connection.js", () => ({
  McpConnection: runtimeMockState.MockMcpConnection,
}));

import { buildApp } from "../src/app";

type ItemResponse<T> = { data: T };
type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type McpServerResponse = {
  id: string;
  live_status: {
    attached: boolean;
    connected_at: number | null;
    error: string | null;
    last_timeout_at: number | null;
    reason: "disabled" | "manager_unavailable" | "not_attached" | null;
    reconnect_required: boolean;
    state: string;
    tool_count: number;
    tools_refreshed_at: number | null;
  };
  name: string;
};

type McpStatusResponse = {
  server_id: string;
  server_name: string;
  transport: string;
  state: string;
  tool_count: number;
  connected_at: number | null;
  tools_refreshed_at: number | null;
  error: string | null;
  reconnect_required: boolean;
  last_timeout_at: number | null;
};

describe("MCP runtime routes", () => {
  let app: FastifyInstance;
  let persistedDatabasePath: string | null;

  beforeEach(async () => {
    runtimeMockState.instances.clear();
    persistedDatabasePath = null;
    delete process.env.APP_SECRETS_MASTER_KEY;
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      orchestration: {
        providers: [
          {
            id: "test-provider",
            type: "openai-compatible",
            apiKey: "sk-test",
          },
        ],
        defaultModel: {
          providerId: "test-provider",
          modelId: "gpt-4o-mini",
        },
      },
      enableMcp: true,
    }));
  });

  afterEach(async () => {
    if (originalMasterKey === undefined) {
      delete process.env.APP_SECRETS_MASTER_KEY;
    } else {
      process.env.APP_SECRETS_MASTER_KEY = originalMasterKey;
    }

    runtimeMockState.instances.clear();
    if (app) {
      await app.close();
    }

    if (persistedDatabasePath) {
      rmSync(persistedDatabasePath, { force: true });
      persistedDatabasePath = null;
    }
  });

  async function createServer(name: string, toolPrefix = "demo_") {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name,
        transport: "stdio",
        stdio: {
          command: "node",
          args: ["server.js"],
        },
        tool_prefix: toolPrefix,
      },
    });

    expect(res.statusCode).toBe(201);
    return res.json<ItemResponse<McpServerResponse>>().data;
  }

  async function createSession(title = "MCP Runtime Session") {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title },
    });

    expect(res.statusCode).toBe(201);
    return res.json<ItemResponse<{ id: string }>>().data.id;
  }

  it("creates a server and keeps config/live status synchronized", async () => {
    const server = await createServer("Runtime Connect Server", "runtime_");
    expect(server.live_status).toMatchObject({ attached: true, state: "connected", reason: null, tool_count: 1 });

    const createdInstance = runtimeMockState.instances.get(server.id);
    expect(createdInstance?.connectCalls).toBe(1);

    const connectRes = await app.inject({
      method: "POST",
      url: `/mcp/servers/${server.id}/connect`,
    });

    expect(connectRes.statusCode).toBe(200);
    const status = connectRes.json<ItemResponse<McpStatusResponse>>().data;
    expect(status.server_id).toBe(server.id);
    expect(status.state).toBe("connected");
    expect(status.tool_count).toBe(1);

    const instance = runtimeMockState.instances.get(server.id);
    expect(instance).toBeDefined();
    expect(instance.connectCalls).toBe(2);

    const detailRes = await app.inject({ method: "GET", url: `/mcp/servers/${server.id}` });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json<ItemResponse<McpServerResponse>>().data.live_status).toMatchObject({ attached: true, state: "connected", tool_count: 1 });

    const statusRes = await app.inject({ method: "GET", url: `/mcp/servers/${server.id}/status` });

    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json<ItemResponse<McpStatusResponse>>().data).toMatchObject({ state: "connected", attached: true, reason: null });

    const statusesRes = await app.inject({
      method: "GET",
      url: "/mcp/statuses",
    });

    expect(statusesRes.statusCode).toBe(200);
    const statuses = statusesRes.json<ItemResponse<McpStatusResponse[]>>().data;
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.server_id).toBe(server.id);
  });

  it("surfaces reconnect-required timeout metadata in runtime status responses", async () => {
    const server = await createServer("Runtime Timeout Server", "timeout_");

    const connectRes = await app.inject({
      method: "POST",
      url: `/mcp/servers/${server.id}/connect`,
    });
    expect(connectRes.statusCode).toBe(200);

    const instance = runtimeMockState.instances.get(server.id);
    expect(instance).toBeDefined();

    instance.state = "reconnect_required";
    instance.reconnectRequired = true;
    instance.lastTimeoutAt = 123_456;
    instance.error = "Tool call timeout after 30000ms; execution outcome is uncertain; reconnect required";

    const statusRes = await app.inject({ method: "GET", url: `/mcp/servers/${server.id}/status` });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json<ItemResponse<McpStatusResponse>>().data).toMatchObject({
      server_id: server.id,
      state: "reconnect_required",
      reconnect_required: true,
      last_timeout_at: 123_456,
    });
  });

  it("reconnects an existing server and supports explicit disconnect", async () => {
    const server = await createServer("Runtime Reconnect Server");

    const firstConnect = await app.inject({
      method: "POST",
      url: `/mcp/servers/${server.id}/connect`,
    });
    expect(firstConnect.statusCode).toBe(200);

    const secondConnect = await app.inject({
      method: "POST",
      url: `/mcp/servers/${server.id}/connect`,
    });

    expect(secondConnect.statusCode).toBe(200);
    const instance = runtimeMockState.instances.get(server.id);
    expect(instance.connectCalls).toBe(3);
    expect(instance.disconnectCalls).toBe(2);

    const disconnectRes = await app.inject({
      method: "POST",
      url: `/mcp/servers/${server.id}/disconnect`,
    });

    expect(disconnectRes.statusCode).toBe(200);
    const disconnected = disconnectRes.json<ItemResponse<McpStatusResponse>>().data;
    expect(disconnected.state).toBe("disconnected");
    expect(disconnected.tool_count).toBe(0);
    expect(instance.disconnectCalls).toBe(3);
  });

  it("lists tools for a connected server and covers the 404 runtime branches", async () => {
    const server = await createServer("Runtime Tools Server", "runtime_");

    const connectRes = await app.inject({
      method: "POST",
      url: `/mcp/servers/${server.id}/connect`,
    });
    expect(connectRes.statusCode).toBe(200);

    const toolsRes = await app.inject({
      method: "GET",
      url: `/mcp/servers/${server.id}/tools`,
    });

    expect(toolsRes.statusCode).toBe(200);
    const tools = (toolsRes.json() as ItemResponse<Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      side_effect_level: string;
      source: string;
    }>>).data;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "runtime_echo",
      description: "Mock MCP tool",
      side_effect_level: "irreversible",
      source: "mcp",
    });
    expect(tools[0]?.parameters).toEqual(expect.any(Object));

    const missingStatus = await app.inject({
      method: "GET",
      url: "/mcp/servers/missing-server/status",
    });
    expect(missingStatus.statusCode).toBe(404);
    expect(missingStatus.json<ErrorResponse>().error.code).toBe("not_found");

    const missingConnect = await app.inject({
      method: "POST",
      url: "/mcp/servers/missing-server/connect",
    });
    expect(missingConnect.statusCode).toBe(404);
    expect(missingConnect.json<ErrorResponse>().error.code).toBe("not_found");

    const missingDisconnect = await app.inject({
      method: "POST",
      url: "/mcp/servers/missing-server/disconnect",
    });
    expect(missingDisconnect.statusCode).toBe(404);
    expect(missingDisconnect.json<ErrorResponse>().error.code).toBe("not_found");

    const missingTools = await app.inject({
      method: "GET",
      url: "/mcp/servers/missing-server/tools",
    });
    expect(missingTools.statusCode).toBe(404);
    expect(missingTools.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("tests a server configuration and returns 404 when the config is missing", async () => {
    const server = await createServer("Runtime Test Server");

    const testRes = await app.inject({
      method: "POST",
      url: `/mcp/servers/${server.id}/test`,
    });

    expect(testRes.statusCode).toBe(200);
    expect(
      testRes.json<ItemResponse<{ success: boolean; tool_count: number; error: string | null }>>().data,
    ).toMatchObject({
      success: true,
      tool_count: 1,
      error: null,
    });

    const missingTestRes = await app.inject({
      method: "POST",
      url: "/mcp/servers/missing-server/test",
    });

    expect(missingTestRes.statusCode).toBe(404);
    expect(missingTestRes.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("keeps secret-backed servers visible in error state when runtime decryption fails after restart", async () => {
    await app.close();
    persistedDatabasePath = `data/test-mcp-runtime-secret-${Date.now()}.db`;

    process.env.APP_SECRETS_MASTER_KEY = "correct-master-key";
    ({ app } = await buildApp({
      databasePath: persistedDatabasePath,
      logger: false,
      enableMcp: true,
    }));

    const createRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Secret Runtime Server",
        transport: "stdio",
        stdio: {
          command: "node",
          env: {
            API_TOKEN: "token12345678",
          },
        },
      },
    });
    expect(createRes.statusCode).toBe(201);
    const server = createRes.json<ItemResponse<McpServerResponse>>().data;

    await app.close();

    process.env.APP_SECRETS_MASTER_KEY = "wrong-master-key";
    ({ app } = await buildApp({
      databasePath: persistedDatabasePath,
      logger: false,
      enableMcp: true,
    }));

    const statusesRes = await app.inject({ method: "GET", url: "/mcp/statuses" });
    expect(statusesRes.statusCode).toBe(200);
    expect(statusesRes.json<ItemResponse<McpStatusResponse[]>>().data).toEqual([
      expect.objectContaining({
        server_id: server.id,
        state: "error",
        error: expect.stringContaining("Stored MCP secret cannot be decrypted for server \"Secret Runtime Server\""),
      }),
    ]);

    const statusRes = await app.inject({ method: "GET", url: `/mcp/servers/${server.id}/status` });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json<ItemResponse<McpStatusResponse>>().data).toMatchObject({ server_id: server.id, state: "error" });
  });

  it("syncs create, update, toggle, and delete changes into runtime tools and session runtime catalog", async () => {
    const sessionId = await createSession();
    const server = await createServer("Runtime Sync Server", "sync_");

    const initialCatalog = await app.inject({ method: "GET", url: `/sessions/${sessionId}/tools/runtime` });
    expect(initialCatalog.statusCode).toBe(200);
    expect(
      initialCatalog
        .json<{ data: { tools: Array<{ name: string; source: string }> } }>()
        .data.tools
        .filter((tool) => tool.source === "mcp")
        .map((tool) => tool.name),
    ).toContain("sync_echo");

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/mcp/servers/${server.id}`,
      payload: { tool_prefix: "updated_" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json<ItemResponse<McpServerResponse>>().data.live_status).toMatchObject({ attached: true, state: "connected" });

    const toolsAfterUpdate = await app.inject({ method: "GET", url: `/mcp/servers/${server.id}/tools` });
    expect(toolsAfterUpdate.statusCode).toBe(200);
    expect((toolsAfterUpdate.json() as ItemResponse<Array<{ name: string }>>).data.map((tool) => tool.name)).toEqual(["updated_echo"]);

    const catalogAfterUpdate = await app.inject({ method: "GET", url: `/sessions/${sessionId}/tools/runtime` });
    expect(catalogAfterUpdate.statusCode).toBe(200);
    expect(
      catalogAfterUpdate
        .json<{ data: { tools: Array<{ name: string; source: string }> } }>()
        .data.tools
        .filter((tool) => tool.source === "mcp")
        .map((tool) => tool.name),
    ).toContain("updated_echo");

    const disableRes = await app.inject({
      method: "PATCH",
      url: `/mcp/servers/${server.id}/toggle`,
      payload: { enabled: false },
    });
    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json<ItemResponse<McpServerResponse>>().data.live_status).toMatchObject({ attached: false, reason: "disabled", state: "disconnected" });

    const disabledToolsRes = await app.inject({ method: "GET", url: `/mcp/servers/${server.id}/tools` });
    expect(disabledToolsRes.statusCode).toBe(409);
    expect(disabledToolsRes.json<ErrorResponse>().error.code).toBe("mcp_server_disabled");

    const catalogAfterDisable = await app.inject({ method: "GET", url: `/sessions/${sessionId}/tools/runtime` });
    expect(catalogAfterDisable.statusCode).toBe(200);
    expect(
      catalogAfterDisable
        .json<{ data: { tools: Array<{ name: string; source: string }> } }>()
        .data.tools
        .filter((tool) => tool.source === "mcp"),
    ).toEqual([]);

    const enableRes = await app.inject({
      method: "PATCH",
      url: `/mcp/servers/${server.id}/toggle`,
      payload: { enabled: true },
    });
    expect(enableRes.statusCode).toBe(200);
    expect(enableRes.json<ItemResponse<McpServerResponse>>().data.live_status).toMatchObject({ attached: true, state: "connected", reason: null });

    const deleteRes = await app.inject({ method: "DELETE", url: `/mcp/servers/${server.id}` });
    expect(deleteRes.statusCode).toBe(200);

    const catalogAfterDelete = await app.inject({ method: "GET", url: `/sessions/${sessionId}/tools/runtime` });
    expect(catalogAfterDelete.statusCode).toBe(200);
    expect(
      catalogAfterDelete
        .json<{ data: { tools: Array<{ name: string; source: string }> } }>()
        .data.tools
        .filter((tool) => tool.source === "mcp"),
    ).toEqual([]);
  });
});
