import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeLlmProfiles(ctx: SmokeContext): Promise<void> {
  const { api, options, runId, runStep, track, addCleanup } = ctx;

  const profile = await runStep("POST /llm-profiles", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/llm-profiles",
      {
        preset_name: `${runId}-profile`,
        provider: "openai",
        model_id: "gpt-test",
        api_key: "sk-fake-smoke",
      },
      [201]
    )
  );
  const profileId = must(profile.body?.data?.id, "Missing llm profile id");
  track("llmProfiles", profileId);
  addCleanup(async () => {
    await api.request("DELETE", `/llm-profiles/${profileId}`, undefined, [200, 404]);
  });

  await runStep("GET /llm-profiles", async () => {
    const res = await api.request<{ data: unknown[] }>("GET", "/llm-profiles", undefined, [200]);
    assert(Array.isArray(res.body?.data) && res.body!.data.length >= 1, "Profile list should have at least 1 item");
  });

  await runStep("GET /llm-profiles/:id", async () => {
    const res = await api.request<{ data: { id: string } }>("GET", `/llm-profiles/${profileId}`, undefined, [200]);
    assert(res.body?.data?.id === profileId, "Profile id mismatch");
  });

  await runStep("PATCH /llm-profiles/:id", () =>
    api.request("PATCH", `/llm-profiles/${profileId}`, { preset_name: `${runId}-profile-updated` }, [200])
  );

  await runStep("POST /llm-profiles/:id/activate", () =>
    api.request("POST", `/llm-profiles/${profileId}/activate`, { scope: "global", instance_slot: "*" }, [200])
  );

  await runStep("GET /llm-profiles/runtime", () =>
    api.request("GET", "/llm-profiles/runtime", undefined, [200])
  );

  if (!options.keepData) {
    await runStep("DELETE /llm-profiles/:id", () =>
      api.request("DELETE", `/llm-profiles/${profileId}`, undefined, [200, 409])
    );
  }

  ctx.shared.llmProfileId = profileId;
}
