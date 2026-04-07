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

  const toolDefinitionCreateResult = await runStep("POST /tools/definitions", async () => {
    const res = await api.request<
      | { data: { id: string } }
      | { error?: { code?: string; message?: string } }
    >(
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
      [201, 403]
    );

    if (res.status === 201) {
      return {
        created: true as const,
        id: must((res.body as { data?: { id?: string } } | null)?.data?.id, "Missing tool definition id")
      };
    }

    const errorCode = (res.body as { error?: { code?: string } } | null)?.error?.code;
    assert(errorCode === "tool_script_handler_disabled", "Disabled script handler should return tool_script_handler_disabled");
    return {
      created: false as const,
      id: null,
    };
  });

  const toolDefId = toolDefinitionCreateResult.created ? toolDefinitionCreateResult.id : null;
  if (toolDefId) {
    track("toolDefinitions", toolDefId);
    addCleanup(async () => {
      await api.request("DELETE", `/tools/definitions/${toolDefId}`, undefined, [200, 404]);
    });
  }

  await runStep("GET /tools/definitions", async () => {
    const res = await api.request<{ data: unknown[] }>("GET", "/tools/definitions", undefined, [200]);
    assert(Array.isArray(res.body?.data), "Tool definitions list should be an array");
  });

  if (toolDefId) {
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
  } else {
    console.log("  ⏭  Script handler definitions are disabled by server policy, skipping custom tool CRUD steps.");
  }

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

  if (!options.keepData && toolDefId) {
    await runStep("DELETE /tools/definitions/:id", () =>
      api.request("DELETE", `/tools/definitions/${toolDefId}`, undefined, [200])
    );
  }
}
