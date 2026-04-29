import { describe, it, expect, vi, beforeEach } from "vitest";

import { McpConnectionManager } from "../../services/tooling/mcp/mcp-connection-manager.js";
import type { McpServerConfig } from "../../services/tooling/mcp/types.js";

// ── Mock McpConnection ─────────────────────────────────

const mockConnectFn = vi.fn().mockResolvedValue(undefined);
const mockDisconnectFn = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/tooling/mcp/mcp-connection.js", () => ({
  McpConnection: vi.fn().mockImplementation((config: McpServerConfig) => ({
    config,
    state: "disconnected",
    toolCount: 0,
    connectedAt: undefined,
    toolsRefreshedAt: undefined,
    reconnectRequired: false,
    lastTimeoutAt: undefined,
    error: undefined,
    connect: mockConnectFn,
    disconnect: mockDisconnectFn,
    getTools: vi.fn().mockReturnValue([]),
  })),
}));

// ── helpers ──────────────────────────────────────────────

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "srv-1",
    name: "Test Server",
    transport: "stdio",
    enabled: true,
    connectTimeoutMs: 5000,
    callTimeoutMs: 30000,
    toolRefreshIntervalMs: 0,
    defaultSideEffectLevel: "irreversible",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stdio: { command: "node", args: ["server.js"] },
    ...overrides,
  };
}

// ── tests ───────────────────────────────────────────────

describe("McpConnectionManager", () => {
  let manager: McpConnectionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new McpConnectionManager();
  });

  // ── initialize ─────────────────────────────────────

  describe("initialize", () => {
    it("creates connections for all configs and connects stdio servers", async () => {
      const configs = [
        makeConfig({ id: "s1", transport: "stdio" }),
        makeConfig({ id: "s2", transport: "http", http: { url: "http://localhost:8080" } }),
      ];

      await manager.initialize(configs);

      // s1 (stdio) 应调用 connect，s2 (http) 不应
      expect(mockConnectFn).toHaveBeenCalledTimes(1);
      expect(manager.hasServer("s1")).toBe(true);
      expect(manager.hasServer("s2")).toBe(true);
    });

    it("does not throw when stdio connect fails", async () => {
      mockConnectFn.mockRejectedValueOnce(new Error("spawn failed"));

      const configs = [makeConfig({ id: "s1", transport: "stdio" })];

      // 不应抛出异常
      await expect(manager.initialize(configs)).resolves.toBeUndefined();
      expect(manager.hasServer("s1")).toBe(true);
    });
  });

  // ── getConnection ──────────────────────────────────

  describe("getConnection", () => {
    it("returns existing connection by id", async () => {
      await manager.initialize([makeConfig({ id: "s1" })]);
      const conn = await manager.getConnection("s1");
      expect(conn).toBeDefined();
      expect(conn!.config.id).toBe("s1");
    });

    it("returns null for non-existent server", async () => {
      const conn = await manager.getConnection("does-not-exist");
      expect(conn).toBeNull();
    });

    it("shares the same in-flight connect attempt for concurrent first HTTP access", async () => {
      let resolveConnect: (() => void) | undefined;
      mockConnectFn.mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveConnect = resolve;
      }));

      await manager.initialize([makeConfig({ id: "h1", transport: "http", http: { url: "http://localhost:8080" } })]);

      const first = manager.getConnection("h1");
      const second = manager.getConnection("h1");
      expect(mockConnectFn).toHaveBeenCalledTimes(1);

      resolveConnect?.();
      await expect(Promise.all([first, second])).resolves.toEqual([expect.any(Object), expect.any(Object)]);
    });
  });

  // ── getConnectionSync ──────────────────────────────

  describe("getConnectionSync", () => {
    it("returns connection without triggering auto-connect", async () => {
      await manager.initialize([makeConfig({ id: "s1" })]);
      vi.clearAllMocks();

      const conn = manager.getConnectionSync("s1");
      expect(conn).toBeDefined();
      // 不应触发额外的 connect
      expect(mockConnectFn).not.toHaveBeenCalled();
    });

    it("returns null for non-existent server", () => {
      expect(manager.getConnectionSync("nope")).toBeNull();
    });
  });

  // ── addServer ──────────────────────────────────────

  describe("addServer", () => {
    it("adds a new stdio server and connects", async () => {
      await manager.addServer(makeConfig({ id: "new-s", transport: "stdio" }));

      expect(manager.hasServer("new-s")).toBe(true);
      expect(mockConnectFn).toHaveBeenCalledTimes(1);
    });

    it("replaces existing server with same id", async () => {
      await manager.initialize([makeConfig({ id: "s1" })]);
      vi.clearAllMocks();

      await manager.addServer(makeConfig({ id: "s1", name: "Replacement" }));

      // 应先 disconnect 旧连接，再 connect 新连接
      expect(mockDisconnectFn).toHaveBeenCalledTimes(1);
      expect(mockConnectFn).toHaveBeenCalledTimes(1);
    });

    it("does not auto-connect http server", async () => {
      await manager.addServer(
        makeConfig({ id: "h1", transport: "http", http: { url: "http://localhost:8080" } }),
      );

      expect(manager.hasServer("h1")).toBe(true);
      expect(mockConnectFn).not.toHaveBeenCalled();
    });
  });

  // ── removeServer ───────────────────────────────────

  describe("removeServer", () => {
    it("disconnects and removes the connection", async () => {
      await manager.initialize([makeConfig({ id: "s1" })]);
      vi.clearAllMocks();

      await manager.removeServer("s1");

      expect(mockDisconnectFn).toHaveBeenCalledOnce();
      expect(manager.hasServer("s1")).toBe(false);
    });

    it("does nothing for non-existent server", async () => {
      await expect(manager.removeServer("nope")).resolves.toBeUndefined();
    });
  });

  // ── reconnect ─────────────────────────────────────

  describe("reconnect", () => {
    it("disconnects then connects the same connection", async () => {
      await manager.initialize([makeConfig({ id: "s1" })]);
      vi.clearAllMocks();

      await manager.reconnect("s1");

      expect(mockDisconnectFn).toHaveBeenCalledOnce();
      expect(mockConnectFn).toHaveBeenCalledOnce();
    });

    it("throws for non-existent server", async () => {
      await expect(manager.reconnect("nope")).rejects.toThrow("not found");
    });
  });

  // ── shutdown ──────────────────────────────────────

  describe("shutdown", () => {
    it("disconnects all connections and clears the map", async () => {
      await manager.initialize([
        makeConfig({ id: "s1" }),
        makeConfig({ id: "s2" }),
      ]);
      vi.clearAllMocks();

      await manager.shutdown();

      expect(mockDisconnectFn).toHaveBeenCalledTimes(2);
      expect(manager.hasServer("s1")).toBe(false);
      expect(manager.hasServer("s2")).toBe(false);
    });
  });

  // ── getStatuses / getStatus ─────────────────────────

  describe("getStatuses", () => {
    it("returns status for all connections", async () => {
      await manager.initialize([
        makeConfig({ id: "s1", name: "Server 1" }),
        makeConfig({ id: "s2", name: "Server 2" }),
      ]);

      const statuses = manager.getStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses.map((s) => s.serverId)).toContain("s1");
      expect(statuses.map((s) => s.serverId)).toContain("s2");
    });

    it("getStatus returns null for non-existent server", () => {
      expect(manager.getStatus("nope")).toBeNull();
    });

    it("getStatus returns status for existing server", async () => {
      await manager.initialize([makeConfig({ id: "s1", name: "Test" })]);

      const status = manager.getStatus("s1");
      expect(status).toBeDefined();
      expect(status!.serverName).toBe("Test");
      expect(status!.transport).toBe("stdio");
    });

    it("reconnects a timed-out connection on the next access", async () => {
      await manager.initialize([makeConfig({ id: "s1", name: "Reconnect Required Server" })]);
      const connection = manager.getConnectionSync("s1") as any;
      connection.state = "reconnect_required";
      connection.reconnectRequired = true;
      connection.lastTimeoutAt = 123_456;
      connection.error = "Tool call timeout after 30000ms; execution outcome is uncertain; reconnect required";

      vi.clearAllMocks();

      await manager.getConnection("s1");

      expect(mockConnectFn).toHaveBeenCalledOnce();
    });

    it("surfaces reconnect-required timeout metadata in status", async () => {
      await manager.initialize([makeConfig({ id: "s1", name: "Reconnect Required Server" })]);
      const connection = manager.getConnectionSync("s1") as any;
      const timeoutAt = 456_789;
      connection.state = "reconnect_required";
      connection.reconnectRequired = true;
      connection.lastTimeoutAt = timeoutAt;
      connection.error = "uncertain timeout";

      expect(manager.getStatus("s1")).toMatchObject({
        state: "reconnect_required",
        reconnectRequired: true,
        lastTimeoutAt: timeoutAt,
        error: "uncertain timeout",
      });
    });
  });
});
