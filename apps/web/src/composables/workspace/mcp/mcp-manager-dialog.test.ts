import { effectScope, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceApiMocks = vi.hoisted(() => ({
  connectMcpServer: vi.fn(),
  createMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  disconnectMcpServer: vi.fn(),
  fetchMcpServer: vi.fn(),
  fetchMcpServerStatus: vi.fn(),
  fetchMcpServerTools: vi.fn(),
  fetchMcpServers: vi.fn(),
  fetchMcpStatuses: vi.fn(),
  testMcpServer: vi.fn(),
  toggleMcpServer: vi.fn(),
  updateMcpServer: vi.fn()
}));

vi.mock("../../../lib/workspace-api", () => workspaceApiMocks);

import { useWorkspaceMcpManagerDialog } from "./mcp-manager-dialog";

describe("useWorkspaceMcpManagerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads servers, selects runtime state, and runs runtime actions", async () => {
    const server = {
      callTimeoutMs: 60000,
      connectTimeoutMs: 30000,
      createdAt: 1,
      defaultSideEffectLevel: "sandbox",
      enabled: true,
      http: null,
      id: "mcp-1",
      name: "Filesystem",
      stdio: { command: "node", args: ["server.js"] },
      toolPrefix: "fs",
      toolRefreshIntervalMs: 300000,
      transport: "stdio",
      updatedAt: 2
    };
    const connectedStatus = {
      connectedAt: 10,
      error: null,
      lastTimeoutAt: null,
      reconnectRequired: false,
      serverId: "mcp-1",
      serverName: "Filesystem",
      state: "connected",
      toolCount: 1,
      toolsRefreshedAt: 11,
      transport: "stdio"
    };
    const disconnectedStatus = {
      ...connectedStatus,
      connectedAt: null,
      state: "disconnected",
      toolCount: 0,
      toolsRefreshedAt: null
    };

    workspaceApiMocks.fetchMcpServers.mockResolvedValue({ meta: {}, servers: [server] });
    workspaceApiMocks.fetchMcpStatuses.mockResolvedValue([connectedStatus]);
    workspaceApiMocks.fetchMcpServer.mockResolvedValue(server);
    workspaceApiMocks.fetchMcpServerStatus
      .mockResolvedValueOnce(connectedStatus)
      .mockResolvedValueOnce(connectedStatus)
      .mockResolvedValueOnce(connectedStatus)
      .mockResolvedValueOnce(disconnectedStatus);
    workspaceApiMocks.fetchMcpServerTools
      .mockResolvedValueOnce([{ description: "Read files", name: "fs_read", parameters: {}, sideEffectLevel: "none", source: "mcp" }])
      .mockResolvedValueOnce([{ description: "Read files", name: "fs_read", parameters: {}, sideEffectLevel: "none", source: "mcp" }])
      .mockResolvedValueOnce([{ description: "Read files", name: "fs_read", parameters: {}, sideEffectLevel: "none", source: "mcp" }]);
    workspaceApiMocks.connectMcpServer.mockResolvedValue(connectedStatus);
    workspaceApiMocks.disconnectMcpServer.mockResolvedValue(disconnectedStatus);
    workspaceApiMocks.testMcpServer.mockResolvedValue({ durationMs: 88, error: null, success: true, toolCount: 1 });

    const addEvent = vi.fn();
    const scope = effectScope();
    const state = scope.run(() => useWorkspaceMcpManagerDialog({
      addEvent,
      currentAccount: ref("acc-1"),
      t: (key) => key
    }));

    expect(state).toBeTruthy();

    await state?.openMcpManagerDialog();
    expect(workspaceApiMocks.fetchMcpServers).toHaveBeenCalled();
    expect(state?.mcpManagerDialog.servers).toHaveLength(1);

    await state?.selectMcpServer("mcp-1");
    expect(workspaceApiMocks.fetchMcpServer).toHaveBeenCalledWith("mcp-1", "acc-1");
    expect(state?.mcpManagerDialog.selectedTools).toHaveLength(1);

    await state?.connectSelectedMcpServer();
    expect(workspaceApiMocks.connectMcpServer).toHaveBeenCalledWith("mcp-1", "acc-1");
    expect(addEvent).toHaveBeenCalledWith("events.mcpServerConnected", "success", { server: "Filesystem" });

    await state?.testSelectedMcpServerConfig();
    expect(workspaceApiMocks.testMcpServer).toHaveBeenCalledWith("mcp-1", "acc-1");
    expect(addEvent).toHaveBeenCalledWith("events.mcpServerTestPassed", "success", { duration: 88, toolCount: 1 });

    await state?.disconnectSelectedMcpServer();
    expect(workspaceApiMocks.disconnectMcpServer).toHaveBeenCalledWith("mcp-1", "acc-1");
    expect(addEvent).toHaveBeenCalledWith("events.mcpServerDisconnected", "warn", { server: "Filesystem" });

    scope.stop();
  });

  it("creates, toggles, and deletes a server", async () => {
    const createdServer = {
      callTimeoutMs: 60000,
      connectTimeoutMs: 30000,
      createdAt: 1,
      defaultSideEffectLevel: "sandbox",
      enabled: true,
      http: null,
      id: "mcp-1",
      name: "Filesystem",
      stdio: { command: "node", args: ["server.js"] },
      toolPrefix: "fs",
      toolRefreshIntervalMs: 300000,
      transport: "stdio",
      updatedAt: 2
    };

    workspaceApiMocks.fetchMcpServers
      .mockResolvedValueOnce({ meta: {}, servers: [] })
      .mockResolvedValueOnce({ meta: {}, servers: [createdServer] })
      .mockResolvedValueOnce({ meta: {}, servers: [] });
    workspaceApiMocks.fetchMcpStatuses.mockResolvedValue([]);
    workspaceApiMocks.createMcpServer.mockResolvedValue(createdServer);
    workspaceApiMocks.fetchMcpServer.mockResolvedValue(createdServer);
    workspaceApiMocks.fetchMcpServerStatus.mockResolvedValue({
      connectedAt: null,
      error: null,
      lastTimeoutAt: null,
      reconnectRequired: false,
      serverId: "mcp-1",
      serverName: "Filesystem",
      state: "disconnected",
      toolCount: 0,
      toolsRefreshedAt: null,
      transport: "stdio"
    });
    workspaceApiMocks.toggleMcpServer.mockResolvedValue({ ...createdServer, enabled: false });
    workspaceApiMocks.deleteMcpServer.mockResolvedValue(true);

    const addEvent = vi.fn();
    const scope = effectScope();
    const state = scope.run(() => useWorkspaceMcpManagerDialog({
      addEvent,
      currentAccount: ref("acc-1"),
      t: (key) => key
    }));

    expect(state).toBeTruthy();

    await state?.openMcpManagerDialog();
    state!.mcpManagerDialog.serverDraft.name = "Filesystem";
    state!.mcpManagerDialog.serverDraft.transport = "stdio";
    state!.mcpManagerDialog.serverDraft.stdioCommand = "node";
    state!.mcpManagerDialog.serverDraft.stdioArgsJson = JSON.stringify(["server.js"]);

    await state?.saveMcpServer();

    expect(workspaceApiMocks.createMcpServer).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "acc-1",
      name: "Filesystem",
      transport: "stdio"
    }));
    expect(addEvent).toHaveBeenCalledWith("events.mcpServerCreated", "success", { server: "Filesystem" });

    await state?.toggleMcpServerEnabled("mcp-1", false);
    expect(workspaceApiMocks.toggleMcpServer).toHaveBeenCalledWith("mcp-1", false, "acc-1");

    await state?.deleteMcpServerById("mcp-1");
    expect(workspaceApiMocks.deleteMcpServer).toHaveBeenCalledWith("mcp-1", "acc-1");
    expect(addEvent).toHaveBeenCalledWith("events.mcpServerDeleted", "warn", { server: "Filesystem" });

    scope.stop();
  });
});
