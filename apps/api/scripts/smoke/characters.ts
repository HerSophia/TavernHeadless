import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeCharacters(ctx: SmokeContext): Promise<void> {
  const { api, runId, runStep } = ctx;
  const characterId = must(ctx.shared.characterId, "smokeCharacters requires characterId");
  const originalVersionId = must(ctx.shared.characterVersionId, "smokeCharacters requires characterVersionId");

  await runStep("GET /characters", async () => {
    const res = await api.request<{ data: unknown[] }>("GET", "/characters", undefined, [200]);
    assert(Array.isArray(res.body?.data) && res.body!.data.length >= 1, "Character list should have at least 1 item");
  });

  await runStep("GET /characters/:id", async () => {
    const res = await api.request<{ data: { id: string; latest_version: unknown } }>(
      "GET", `/characters/${characterId}`, undefined, [200]
    );
    assert(res.body?.data?.id === characterId, "Character id mismatch");
    assert(res.body?.data?.latest_version !== undefined, "Character should have latest_version");
  });

  await runStep("GET /characters/:id/versions", async () => {
    const res = await api.request<{ data: unknown[] }>(
      "GET", `/characters/${characterId}/versions`, undefined, [200]
    );
    assert(Array.isArray(res.body?.data) && res.body!.data.length >= 1, "Version list should have at least 1 item");
  });

  const newVersion = await runStep("POST /characters/:id/versions", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      `/characters/${characterId}/versions`,
      { snapshot: { name: `${runId}-char-v2` } },
      [201]
    )
  );
  must(newVersion.body?.data?.id, "Missing new character version id");

  await runStep("POST /characters/:id/versions/:vid/rollback", () =>
    api.request(
      "POST",
      `/characters/${characterId}/versions/${originalVersionId}/rollback`,
      undefined,
      [200, 201]
    )
  );

  // Soft-delete then restore
  await runStep("DELETE /characters/:id (soft)", () =>
    api.request("DELETE", `/characters/${characterId}`, undefined, [200])
  );

  await runStep("POST /characters/:id/restore", () =>
    api.request("POST", `/characters/${characterId}/restore`, undefined, [200])
  );
}
