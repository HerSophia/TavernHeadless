import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeChat(ctx: SmokeContext): Promise<void> {
  const { api, runStep } = ctx;
  const sessionId = must(ctx.shared.sessionId, "smokeChat requires sessionId");

  await runStep("GET /prompt-runtime/capabilities", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>("GET", "/prompt-runtime/capabilities", undefined, [200]);
    const data = response.body?.data;
    const macro = data?.macro as Record<string, unknown> | undefined;
    const unsupportedValue = data?.unsupported;

    assert(Boolean(data), "Prompt Runtime capabilities response is missing data");
    assert(macro?.built_in_read_only_values_persistable === false, "Prompt Runtime capabilities must keep built-in read-only macro values non-persistable");
    assert(macro?.st_compatibility_snapshots_persistable === false, "Prompt Runtime capabilities must keep ST compatibility snapshots non-persistable");
    assert(macro?.run_kind_persistable === false, "Prompt Runtime capabilities must keep run_kind non-persistable");
    if (!Array.isArray(unsupportedValue)) {
      throw new Error("Prompt Runtime capabilities must expose unsupported routes");
    }

    assert(unsupportedValue.includes("/sessions/:id/prompt-runtime/macros"), "Prompt Runtime capabilities must declare the macros route as unsupported");
  });

  await runStep("GET /sessions/:id/prompt-runtime", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>("GET", `/sessions/${sessionId}/prompt-runtime`, undefined, [200]);
    const data = response.body?.data;

    assert(Boolean(data), "Prompt Runtime session state response is missing data");
    assert(typeof data?.policy === "object" && data.policy !== null, "Prompt Runtime session state must expose policy");
    assert(typeof data?.assets === "object" && data.assets !== null, "Prompt Runtime session state must expose assets");
  });

  await runStep("PATCH /sessions/:id/prompt-runtime/policy", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>(
      "PATCH",
      `/sessions/${sessionId}/prompt-runtime/policy`,
      { delivery: { require_last_user: true } },
      [200]
    );
    const data = response.body?.data;
    const persistentPolicy = data?.persistent_policy as Record<string, unknown> | undefined;
    const resolvedPolicy = data?.resolved_policy as Record<string, unknown> | undefined;
    const persistentDelivery = persistentPolicy?.delivery as Record<string, unknown> | undefined;
    const resolvedDelivery = resolvedPolicy?.delivery as Record<string, unknown> | undefined;

    assert(persistentDelivery?.require_last_user === true, "Prompt Runtime policy patch must persist require_last_user");
    assert(resolvedDelivery?.require_last_user === true, "Prompt Runtime policy patch must update resolved require_last_user");
  });

  await runStep("GET /sessions/:id/prompt-runtime (after patch)", async () => {
    const response = await api.request<{ data?: Record<string, unknown> }>("GET", `/sessions/${sessionId}/prompt-runtime`, undefined, [200]);
    const persistentPolicy = response.body?.data?.persistent_policy as Record<string, unknown> | undefined;
    const persistentDelivery = persistentPolicy?.delivery as Record<string, unknown> | undefined;

    assert(persistentDelivery?.require_last_user === true, "Prompt Runtime session state must reflect the patched delivery policy");
  });

  // Probe dry-run route. It may return various status codes depending on
  // server configuration (LLM keys, preset binding, etc.). Any response
  // other than 404 proves the route is registered and reachable.
  const probe = await api.request(
    "POST",
    `/sessions/${sessionId}/respond/dry-run`,
    {},
    [200, 400, 404, 422, 500, 503]
  );

  if (probe.status === 404) {
    console.log("  \u23ed  dry-run route not available (ENABLE_PROMPT_DRY_RUN != true), skipping.");
  } else {
    await runStep("POST /sessions/:id/respond/dry-run (probe)", async () => {
      // Route is reachable — status already validated above.
    });
  }
}
