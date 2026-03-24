import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeTools(ctx: SmokeContext): Promise<void> {
  const { api, options, runId, runStep, track, addCleanup } = ctx;
  const sessionId = must(ctx.shared.sessionId, "smokeTools requires sessionId");
  const pageV2Id = must(ctx.shared.pageV2Id, "smokeTools requires pageV2Id");

  // ── Built-in tools ─────────────────────────────────

  await runStep("GET /tools/builtin", async () => {
    const res = await api.request<{ data: unknown[] }>("GET", "/tools/builtin", undefined, [200]);
    assert(Array.isArray(res.body?.data), "Builtin tools should be an array");
  });

  // ── Tool definitions CRUD ──────────────────────────

  const toolDef = await runStep("POST /tools/definitions", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/tools/definitions",
      {
        name: `${runId}-tool`,
        description: "smoke test tool",
        parameters: { type: "object", properties: {} },
        side_effect_level: "none",
        source: "custom",
        handler_type: "script",
        handler: {},
      },
      [201]
    )
  );
  const toolDefId = must(toolDef.body?.data?.id, "Missing tool definition id");
  track("toolDefinitions", toolDefId);
  addCleanup(async () => {
    await api.request("DELETE", `/tools/definitions/${toolDefId}`, undefined, [200, 404]);
  });

  await runStep("GET /tools/definitions", async () => {
    const res = await api.request<{ data: unknown[] }>("GET", "/tools/definitions", undefined, [200]);
    assert(Array.isArray(res.body?.data) && res.body!.data.length >= 1, "Tool definitions list should have at least 1 item");
  });

  await runStep("GET /tools/definitions/:id", async () => {
    const res = await api.request<{ data: { id: string } }>("GET", `/tools/definitions/${toolDefId}`, undefined, [200]);
    assert(res.body?.data?.id === toolDefId, "Tool definition id mismatch");
  });

  await runStep("PATCH /tools/definitions/:id", () =>
    api.request("PATCH", `/tools/definitions/${toolDefId}`, { description: "updated" }, [200])
  );

  await runStep("PATCH /tools/definitions/:id/toggle (disable)", async () => {
    const res = await api.request<{ data: { enabled: boolean } }>(
      "PATCH", `/tools/definitions/${toolDefId}/toggle`, { enabled: false }, [200]
    );
    assert(res.body?.data?.enabled === false, "Tool should be disabled after toggle");
  });

  await runStep("PATCH /tools/definitions/:id/toggle (enable)", async () => {
    const res = await api.request<{ data: { enabled: boolean } }>(
      "PATCH", `/tools/definitions/${toolDefId}/toggle`, { enabled: true }, [200]
    );
    assert(res.body?.data?.enabled === true, "Tool should be enabled after toggle");
  });

  // ── Session tool permissions ───────────────────────

  await runStep("GET /sessions/:id/tool-permissions", () =>
    api.request("GET", `/sessions/${sessionId}/tool-permissions`, undefined, [200])
  );

  await runStep("PUT /sessions/:id/tool-permissions", () =>
    api.request("PUT", `/sessions/${sessionId}/tool-permissions`, {
      enabled: true,
      max_calls_per_turn: 5,
    }, [200])
  );

  await runStep("PATCH /sessions/:id/tool-permissions", () =>
    api.request("PATCH", `/sessions/${sessionId}/tool-permissions`, {
      allow_irreversible: false,
    }, [200])
  );

  // ── Call records ───────────────────────────────────

  await runStep("GET /tools/call-records", async () => {
    const res = await api.request<{ data: unknown[] }>(
      "GET", `/tools/call-records?page_id=${encodeURIComponent(pageV2Id)}`, undefined, [200]
    );
    assert(Array.isArray(res.body?.data), "Call records should be an array");
  });

  // ── Cleanup ───────────────────────────────────────

  if (!options.keepData) {
    await runStep("DELETE /tools/definitions/:id", () =>
      api.request("DELETE", `/tools/definitions/${toolDefId}`, undefined, [200])
    );
  }
}
