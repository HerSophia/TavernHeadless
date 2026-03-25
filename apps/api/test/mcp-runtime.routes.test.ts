import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMockState = vi.hoisted(() => {
  const instances = new Map<string, any>();

  class MockMcpConnection {
    config: any;
    state = "disconnected";
    error: string | undefined;
    connectedAt: number | undefined;
    toolsRefreshedAt: number | undefined;
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

vi.mock("../src/mcp/mcp-connection.js", () => ({
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
};

describe("MCP runtime routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    runtimeMockState.instances.clear();
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      enableMcp: true,
    }));
  });

  afterEach(async () => {
    runtimeMockState.instances.clear();
    if (app) {
      await app.close();
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

  it("adds a new server on first connect and exposes status information", async () => {
    const server = await createServer("Runtime Connect Server", "runtime_");

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
    expect(instance.connectCalls).toBe(1);

    const statusRes = await app.inject({
      method: "GET",
      url: `/mcp/servers/${server.id}/status`,
    });

    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json<ItemResponse<McpStatusResponse>>().data.state).toBe("connected");

    const statusesRes = await app.inject({
      method: "GET",
      url: "/mcp/statuses",
    });

    expect(statusesRes.statusCode).toBe(200);
    const statuses = statusesRes.json<ItemResponse<McpStatusResponse[]>>().data;
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.server_id).toBe(server.id);
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
    expect(instance.connectCalls).toBe(2);
    expect(instance.disconnectCalls).toBe(1);

    const disconnectRes = await app.inject({
      method: "POST",
      url: `/mcp/servers/${server.id}/disconnect`,
    });

    expect(disconnectRes.statusCode).toBe(200);
    const disconnected = disconnectRes.json<ItemResponse<McpStatusResponse>>().data;
    expect(disconnected.state).toBe("disconnected");
    expect(disconnected.tool_count).toBe(0);
    expect(instance.disconnectCalls).toBe(2);
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
});
