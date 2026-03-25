import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerConfig } from "../types.js";

const sdkMocks = vi.hoisted(() => {
  const connect = vi.fn();
  const listTools = vi.fn();
  const callTool = vi.fn();
  const closeClient = vi.fn();

  const clientCtor = vi.fn().mockImplementation(() => ({
    connect,
    listTools,
    callTool,
    close: closeClient,
  }));

  const stdioTransports: Array<{
    options: Record<string, unknown>;
    onclose?: () => void;
    close: ReturnType<typeof vi.fn>;
  }> = [];

  const httpTransports: Array<{
    url: URL;
    options: Record<string, unknown> | undefined;
    onclose?: () => void;
    close: ReturnType<typeof vi.fn>;
  }> = [];

  const StdioClientTransport = vi.fn().mockImplementation((options: Record<string, unknown>) => {
    const transport = {
      options,
      onclose: undefined as (() => void) | undefined,
      close: vi.fn().mockResolvedValue(undefined),
    };
    stdioTransports.push(transport);
    return transport;
  });

  const StreamableHTTPClientTransport = vi.fn().mockImplementation((url: URL, options?: Record<string, unknown>) => {
    const transport = {
      url,
      options,
      onclose: undefined as (() => void) | undefined,
      close: vi.fn().mockResolvedValue(undefined),
    };
    httpTransports.push(transport);
    return transport;
  });

  return {
    connect,
    listTools,
    callTool,
    closeClient,
    clientCtor,
    StdioClientTransport,
    StreamableHTTPClientTransport,
    stdioTransports,
    httpTransports,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: sdkMocks.clientCtor,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: sdkMocks.StdioClientTransport,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: sdkMocks.StreamableHTTPClientTransport,
}));

import { McpConnection } from "../mcp-connection.js";

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "srv-1",
    name: "Test MCP Server",
    transport: "stdio",
    stdio: {
      command: "node",
      args: ["server.js"],
      env: { NODE_ENV: "test" },
      cwd: "/tmp/mcp",
    },
    enabled: true,
    connectTimeoutMs: 100,
    callTimeoutMs: 100,
    toolRefreshIntervalMs: 0,
    defaultSideEffectLevel: "irreversible",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("McpConnection", () => {
  beforeEach(() => {
    sdkMocks.connect.mockReset().mockResolvedValue(undefined);
    sdkMocks.listTools.mockReset().mockResolvedValue({ tools: [] });
    sdkMocks.callTool.mockReset();
    sdkMocks.closeClient.mockReset().mockResolvedValue(undefined);
    sdkMocks.clientCtor.mockClear();
    sdkMocks.StdioClientTransport.mockClear();
    sdkMocks.StreamableHTTPClientTransport.mockClear();
    sdkMocks.stdioTransports.length = 0;
    sdkMocks.httpTransports.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects to a stdio server, refreshes tools, and applies toolPrefix", async () => {
    const logger = createLogger();
    sdkMocks.listTools.mockResolvedValueOnce({
      tools: [
        {
          name: "list_repos",
          description: "List repositories",
          inputSchema: {
            type: "object",
            properties: {
              owner: {
                type: "string",
                description: "Repository owner",
                enum: ["octo"],
                default: "octo",
              },
            },
            required: ["owner"],
          },
        },
      ],
    });

    const connection = new McpConnection(
      makeConfig({ toolPrefix: "gh_" }),
      logger as never,
    );

    await connection.connect();

    expect(connection.state).toBe("connected");
    expect(connection.connectedAt).toEqual(expect.any(Number));
    expect(connection.toolsRefreshedAt).toEqual(expect.any(Number));
    expect(connection.toolCount).toBe(1);
    expect(connection.getTools()[0]).toMatchObject({
      name: "gh_list_repos",
      description: "List repositories",
      parameters: {
        type: "object",
        required: ["owner"],
        properties: {
          owner: {
            type: "string",
            description: "Repository owner",
            enum: ["octo"],
            default: "octo",
          },
        },
      },
      sideEffectLevel: "irreversible",
      allowedSlots: [],
      source: "mcp",
    });
    expect(sdkMocks.StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "node",
        args: ["server.js"],
        env: { NODE_ENV: "test" },
        cwd: "/tmp/mcp",
        stderr: "pipe",
      }),
    );
    expect(typeof sdkMocks.stdioTransports[0]?.onclose).toBe("function");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "srv-1", serverName: "Test MCP Server", toolCount: 1 }),
      "MCP server connected",
    );
  });

  it("connects to an HTTP server with headers", async () => {
    const connection = new McpConnection(
      makeConfig({
        transport: "http",
        stdio: undefined,
        http: {
          url: "https://mcp.example.com/runtime",
          headers: { authorization: "Bearer test-token" },
        },
      }),
    );

    await connection.connect();

    expect(connection.state).toBe("connected");
    expect(sdkMocks.StreamableHTTPClientTransport).toHaveBeenCalledTimes(1);
    expect(String(sdkMocks.httpTransports[0]?.url)).toBe("https://mcp.example.com/runtime");
    expect(sdkMocks.httpTransports[0]?.options).toEqual({
      requestInit: {
        headers: {
          authorization: "Bearer test-token",
        },
      },
    });
  });

  it("returns early when connect() is called after the connection is already established", async () => {
    const connection = new McpConnection(makeConfig());

    await connection.connect();
    await connection.connect();

    expect(sdkMocks.clientCtor).toHaveBeenCalledTimes(1);
    expect(sdkMocks.connect).toHaveBeenCalledTimes(1);
    expect(sdkMocks.StdioClientTransport).toHaveBeenCalledTimes(1);
  });

  it("marks the connection as error and cleans up transport when connect() times out", async () => {
    vi.useFakeTimers();
    sdkMocks.connect.mockReturnValueOnce(new Promise(() => {}));

    const logger = createLogger();
    const connection = new McpConnection(
      makeConfig({ connectTimeoutMs: 25 }),
      logger as never,
    );

    const pending = connection.connect();
    await vi.advanceTimersByTimeAsync(26);
    await pending;

    expect(connection.state).toBe("error");
    expect(connection.error).toBe("Connection timeout after 25ms");
    expect(sdkMocks.closeClient).toHaveBeenCalledOnce();
    expect(sdkMocks.stdioTransports[0]?.close).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "srv-1",
        serverName: "Test MCP Server",
        error: "Connection timeout after 25ms",
      }),
      "MCP connection failed",
    );
  });

  it("returns early from refreshTools() when the connection is not ready", async () => {
    const connection = new McpConnection(makeConfig());

    await connection.refreshTools();

    expect(sdkMocks.listTools).not.toHaveBeenCalled();
  });

  it("keeps the current cache and logs a warning when refreshTools() fails", async () => {
    const logger = createLogger();
    sdkMocks.listTools.mockResolvedValueOnce({
      tools: [
        {
          name: "existing_tool",
          inputSchema: { type: "object" },
        },
      ],
    });

    const connection = new McpConnection(makeConfig(), logger as never);
    await connection.connect();

    sdkMocks.listTools.mockRejectedValueOnce(new Error("list failed"));

    await expect(connection.refreshTools()).resolves.toBeUndefined();

    expect(connection.toolCount).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "srv-1",
        error: "Error: list failed",
      }),
      "Failed to refresh MCP tools",
    );
  });

  it("returns an error when callTool() is used before connect()", async () => {
    const connection = new McpConnection(makeConfig());

    const result = await connection.callTool("echo", { text: "hello" });

    expect(result.error).toContain('not connected');
  });

  it("extracts text, rich content, and MCP error content from callTool() results", async () => {
    const connection = new McpConnection(makeConfig());
    await connection.connect();

    sdkMocks.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "plain text" }],
    });

    const textResult = await connection.callTool("text_tool", {});
    expect(textResult).toEqual({ data: "plain text" });

    sdkMocks.callTool.mockResolvedValueOnce({
      content: [
        { type: "text", text: "first line" },
        { type: "image", data: "base64-data" },
      ],
    });

    const richResult = await connection.callTool("rich_tool", {});
    expect(richResult.data).toEqual([
      { type: "text", text: "first line" },
      { type: "image", data: "base64-data" },
    ]);

    sdkMocks.callTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "tool failed" }],
    });

    const errorResult = await connection.callTool("error_tool", {});
    expect(errorResult).toEqual({ error: "tool failed" });
  });

  it("returns timeout and thrown errors from callTool()", async () => {
    const connection = new McpConnection(makeConfig({ callTimeoutMs: 50 }));
    await connection.connect();

    vi.useFakeTimers();
    sdkMocks.callTool.mockReturnValueOnce(new Promise(() => {}));

    const timeoutPromise = connection.callTool("slow_tool", {});
    await vi.advanceTimersByTimeAsync(51);
    const timeoutResult = await timeoutPromise;

    expect(timeoutResult).toEqual({ error: "Tool call timeout after 50ms" });

    sdkMocks.callTool.mockRejectedValueOnce(new Error("boom"));

    const errorResult = await connection.callTool("broken_tool", {});
    expect(errorResult).toEqual({ error: "boom" });
  });

  it("disconnect() clears timers, cached tools, and connection state", async () => {
    sdkMocks.listTools.mockResolvedValueOnce({
      tools: [{ name: "cached_tool", inputSchema: { type: "object" } }],
    });

    const connection = new McpConnection(
      makeConfig({ toolRefreshIntervalMs: 1_000 }),
    );

    await connection.connect();
    expect((connection as any).refreshTimer).not.toBeNull();
    expect(connection.toolCount).toBe(1);

    await connection.disconnect();

    expect(connection.state).toBe("disconnected");
    expect(connection.connectedAt).toBeUndefined();
    expect(connection.toolCount).toBe(0);
    expect((connection as any).refreshTimer).toBeNull();
    expect(sdkMocks.closeClient).toHaveBeenCalled();
    expect(sdkMocks.stdioTransports[0]?.onclose).toBeUndefined();
  });

  it("auto-reconnects on the first stdio close and marks the connection as error on the second close", async () => {
    const logger = createLogger();
    sdkMocks.listTools.mockResolvedValue({
      tools: [{ name: "echo", inputSchema: { type: "object" } }],
    });

    const connection = new McpConnection(makeConfig(), logger as never);
    await connection.connect();

    sdkMocks.stdioTransports[0]?.onclose?.();
    await flushAsyncWork();

    expect(connection.state).toBe("connected");
    expect(sdkMocks.connect).toHaveBeenCalledTimes(2);
    expect(sdkMocks.stdioTransports).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "srv-1" }),
      "stdio transport closed unexpectedly, attempting reconnect",
    );

    (connection as any).handleTransportClose();

    expect(connection.state).toBe("error");
    expect(connection.error).toBe("stdio transport closed unexpectedly after retry");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "srv-1" }),
      "stdio transport closed again after auto-retry, marking as error",
    );
  });
});
