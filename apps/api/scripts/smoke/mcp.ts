import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeMcp(ctx: SmokeContext): Promise<void> {
  const { api, options, runId, runStep, track, addCleanup } = ctx;

  // ── MCP Server Config CRUD ─────────────────────────

  const mcpServer = await runStep("POST /mcp/servers (stdio)", () =>
    api.request<{ data: { id: string; name: string; transport: string; enabled: boolean } }>(
      "POST",
      "/mcp/servers",
      {
        name: `${runId}-mcp-stdio`,
        transport: "stdio",
        stdio: { command: "node", args: ["fake-server.js"] },
        tool_prefix: "smoke_",
        connect_timeout_ms: 5000,
        call_timeout_ms: 10000,
        default_side_effect_level: "none",
      },
      [201]
    )
  );
  const mcpServerId = must(mcpServer.body?.data?.id, "Missing MCP server id");
  assert(mcpServer.body?.data?.transport === "stdio", "MCP server transport should be stdio");
  assert(mcpServer.body?.data?.enabled === true, "MCP server should be enabled by default");
  track("mcpServers", mcpServerId);
  addCleanup(async () => {
    await api.request("DELETE", `/mcp/servers/${mcpServerId}`, undefined, [200, 404]);
  });

  const mcpHttpServer = await runStep("POST /mcp/servers (http)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/mcp/servers",
      {
        name: `${runId}-mcp-http`,
        transport: "http",
        http: { url: "http://localhost:19999/mcp" },
        enabled: false,
      },
      [201]
    )
  );
  const mcpHttpServerId = must(mcpHttpServer.body?.data?.id, "Missing MCP http server id");
  track("mcpServers", mcpHttpServerId);
  addCleanup(async () => {
    await api.request("DELETE", `/mcp/servers/${mcpHttpServerId}`, undefined, [200, 404]);
  });

  await runStep("POST /mcp/servers (duplicate name => 409)", () =>
    api.request("POST", "/mcp/servers", {
      name: `${runId}-mcp-stdio`,
      transport: "stdio",
      stdio: { command: "echo" },
    }, [409])
  );

  await runStep("GET /mcp/servers", async () => {
    const res = await api.request<{ data: Array<{ id: string }> }>(
      "GET", "/mcp/servers", undefined, [200]
    );
    assert(
      Array.isArray(res.body?.data) && res.body!.data.length >= 2,
      "MCP server list should have at least 2 items"
    );
  });

  await runStep("GET /mcp/servers/:id", async () => {
    const res = await api.request<{ data: { id: string; name: string } }>(
      "GET", `/mcp/servers/${mcpServerId}`, undefined, [200]
    );
    assert(res.body?.data?.id === mcpServerId, "MCP server id mismatch");
  });

  await runStep("PATCH /mcp/servers/:id", () =>
    api.request("PATCH", `/mcp/servers/${mcpServerId}`, {
      name: `${runId}-mcp-renamed`,
      connect_timeout_ms: 8000,
    }, [200])
  );

  await runStep("PATCH /mcp/servers/:id/toggle (disable)", async () => {
    const res = await api.request<{ data: { enabled: boolean } }>(
      "PATCH", `/mcp/servers/${mcpServerId}/toggle`, { enabled: false }, [200]
    );
    assert(res.body?.data?.enabled === false, "MCP server should be disabled after toggle");
  });

  await runStep("PATCH /mcp/servers/:id/toggle (enable)", async () => {
    const res = await api.request<{ data: { enabled: boolean } }>(
      "PATCH", `/mcp/servers/${mcpServerId}/toggle`, { enabled: true }, [200]
    );
    assert(res.body?.data?.enabled === true, "MCP server should be enabled after toggle");
  });

  // ── MCP Runtime Endpoints ──────────────────────────

  const mcpRuntimeProbe = await api.request<{ data: unknown[] }>(
    "GET", "/mcp/statuses", undefined, [200, 404]
  );
  const mcpRuntimeAvailable = mcpRuntimeProbe.status === 200;

  if (mcpRuntimeAvailable) {
    await runStep("GET /mcp/statuses", async () => {
      assert(Array.isArray(mcpRuntimeProbe.body?.data), "MCP statuses should be an array");
    });

    await runStep("GET /mcp/servers/:id/status", async () => {
      const res = await api.request<{
        data: {
          server_id: string;
          server_name: string;
          transport: string;
          state: string;
          attached: boolean;
          reason: string | null;
        };
      }>("GET", `/mcp/servers/${mcpServerId}/status`, undefined, [200]);

      assert(res.body?.data?.server_id === mcpServerId, "MCP runtime status should return the requested server id");
      assert(res.body?.data?.server_name === `${runId}-mcp-renamed`, "MCP runtime status should reflect the latest config name");
      assert(res.body?.data?.transport === "stdio", "MCP runtime status transport should be stdio");
      assert(res.body?.data?.attached === true, "Enabled MCP server should remain visible in runtime status");
      assert(res.body?.data?.reason === null, "Attached MCP runtime status should not report a detached reason");
      assert(
        ["disconnected", "connecting", "connected", "reconnect_required", "error"].includes(res.body?.data?.state ?? ""),
        "MCP runtime status should expose a known connection state"
      );
    });

    await runStep("GET /mcp/servers/:id/tools", async () => {
      const res = await api.request<
        | { data: unknown[] }
        | { error?: { code?: string; message?: string } }
      >("GET", `/mcp/servers/${mcpServerId}/tools`, undefined, [200, 409, 503]);

      if (res.status === 200) {
        assert(Array.isArray((res.body as { data?: unknown[] } | null)?.data), "Connected MCP server should return a tool list");
        return;
      }

      const errorCode = (res.body as { error?: { code?: string } } | null)?.error?.code;
      assert(
        errorCode === "mcp_runtime_not_attached" || errorCode === "mcp_runtime_unavailable",
        "Unavailable MCP tool listing should return a stable runtime error code"
      );
    });

    await runStep("POST /mcp/servers/:id/disconnect", async () => {
      const res = await api.request<
        | { data: { server_id: string; state: string } }
        | { error?: { code?: string; message?: string } }
      >("POST", `/mcp/servers/${mcpServerId}/disconnect`, undefined, [200, 409]);

      if (res.status === 200) {
        assert((res.body as { data?: { server_id?: string } } | null)?.data?.server_id === mcpServerId, "Disconnect response should reference the requested MCP server");
        return;
      }

      const errorCode = (res.body as { error?: { code?: string } } | null)?.error?.code;
      assert(errorCode === "mcp_runtime_not_attached", "Detached MCP disconnect should return mcp_runtime_not_attached");
    });
  } else {
    console.log("  ⏭  MCP runtime routes not available (ENABLE_MCP != true), skipping runtime steps.");
  }

  // Config 404 tests (always registered)
  await runStep("GET /mcp/servers/nonexistent (config 404)", () =>
    api.request("GET", "/mcp/servers/nonexistent", undefined, [404])
  );
  await runStep("DELETE /mcp/servers/nonexistent (config 404)", () =>
    api.request("DELETE", "/mcp/servers/nonexistent", undefined, [404])
  );

  // ── MCP Cleanup ────────────────────────────────────

  if (!options.keepData) {
    await runStep("DELETE /mcp/servers/:id (http)", () =>
      api.request("DELETE", `/mcp/servers/${mcpHttpServerId}`, undefined, [200])
    );
    await runStep("GET /mcp/servers/:id (deleted => 404)", () =>
      api.request("GET", `/mcp/servers/${mcpHttpServerId}`, undefined, [404])
    );
    await runStep("DELETE /mcp/servers/:id (stdio)", () =>
      api.request("DELETE", `/mcp/servers/${mcpServerId}`, undefined, [200])
    );
  }
}
