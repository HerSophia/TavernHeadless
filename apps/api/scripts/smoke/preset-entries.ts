import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokePresetEntries(ctx: SmokeContext): Promise<void> {
  const { api, runId, runStep } = ctx;
  const presetId = must(ctx.shared.presetId, "smokePresetEntries requires presetId");
  const base = `/presets/${presetId}/entries`;
  const identifier = `${runId}-entry`.replace(/[^a-zA-Z0-9_-]/g, "-");

  await runStep("GET /presets/:pid/entries", async () => {
    const res = await api.request<{ data: { entries: unknown[] } }>("GET", base, undefined, [200]);
    assert(Array.isArray(res.body?.data?.entries), "Preset entries should be an array");
  });

  await runStep("POST /presets/:pid/entries", () =>
    api.request(
      "POST",
      base,
      {
        identifier,
        name: "Smoke Entry",
        role: "system",
        content: "smoke test entry",
      },
      [201]
    )
  );

  await runStep("GET /presets/:pid/entries/:identifier", async () => {
    const res = await api.request<{ data: { identifier: string } }>(
      "GET", `${base}/${identifier}`, undefined, [200]
    );
    assert(res.body?.data?.identifier === identifier, "Preset entry identifier mismatch");
  });

  await runStep("PATCH /presets/:pid/entries/:identifier", () =>
    api.request("PATCH", `${base}/${identifier}`, { content: "updated" }, [200])
  );

  await runStep("PUT /presets/:pid/entries/reorder", async () => {
    // Get current entries to build reorder list
    const list = await api.request<{ data: { entries: Array<{ identifier: string }> } }>("GET", base, undefined, [200]);
    const identifiers = (list.body?.data?.entries ?? []).map((e) => e.identifier);
    await api.request("PUT", `${base}/reorder`, { identifiers }, [200]);
  });

  await runStep("DELETE /presets/:pid/entries/:identifier", () =>
    api.request("DELETE", `${base}/${identifier}`, undefined, [200])
  );
}
