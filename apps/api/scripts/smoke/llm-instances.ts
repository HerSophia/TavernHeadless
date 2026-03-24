import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeLlmInstances(ctx: SmokeContext): Promise<void> {
  const { api, options, runStep, track, addCleanup } = ctx;
  const profileId = must(ctx.shared.llmProfileId, "smokeLlmInstances requires llmProfileId");

  await runStep("PUT /llm-instances/narrator", () =>
    api.request(
      "PUT",
      "/llm-instances/narrator",
      { scope: "global", preset_id: profileId },
      [200, 201]
    )
  );
  track("llmInstances", "narrator");
  addCleanup(async () => {
    await api.request("DELETE", "/llm-instances/narrator?scope=global", undefined, [200, 404]);
  });

  await runStep("GET /llm-instances", async () => {
    const res = await api.request<{ data: unknown[] }>("GET", "/llm-instances", undefined, [200]);
    assert(Array.isArray(res.body?.data), "Instance list should be an array");
  });

  await runStep("GET /llm-instances/narrator", () =>
    api.request("GET", "/llm-instances/narrator", undefined, [200])
  );

  await runStep("GET /llm-instances/resolved", () =>
    api.request("GET", "/llm-instances/resolved", undefined, [200])
  );

  if (!options.keepData) {
    await runStep("DELETE /llm-instances/narrator", () =>
      api.request("DELETE", "/llm-instances/narrator?scope=global", undefined, [200])
    );
  }
}
