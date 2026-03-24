import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeUsers(ctx: SmokeContext): Promise<void> {
  const { api, options, runId, runStep, track, addCleanup } = ctx;

  const userA = await runStep("POST /users (A)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/users",
      { snapshot: { name: `${runId}-user-a` } },
      [201]
    )
  );
  const userAId = must(userA.body?.data?.id, "Missing user A id");
  track("users", userAId);
  addCleanup(async () => {
    await api.request("DELETE", `/users/${userAId}`, undefined, [200, 404]);
  });

  const userB = await runStep("POST /users (B)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/users",
      { snapshot: { name: `${runId}-user-b` } },
      [201]
    )
  );
  const userBId = must(userB.body?.data?.id, "Missing user B id");
  track("users", userBId);
  addCleanup(async () => {
    await api.request("DELETE", `/users/${userBId}`, undefined, [200, 404]);
  });

  await runStep("GET /users", async () => {
    const res = await api.request<{ data: unknown[] }>("GET", "/users", undefined, [200]);
    assert(Array.isArray(res.body?.data) && res.body!.data.length >= 2, "User list should have at least 2 items");
  });

  await runStep("GET /users/:id", async () => {
    const res = await api.request<{ data: { id: string } }>("GET", `/users/${userAId}`, undefined, [200]);
    assert(res.body?.data?.id === userAId, "User id mismatch");
  });

  await runStep("PATCH /users/:id", () =>
    api.request("PATCH", `/users/${userAId}`, { snapshot: { name: `${runId}-renamed` } }, [200])
  );

  await runStep("PATCH /users/batch/status", () =>
    api.request("PATCH", "/users/batch/status", { ids: [userAId, userBId], status: "disabled" }, [200])
  );

  if (!options.keepData) {
    await runStep("POST /users/batch/delete", () =>
      api.request("POST", "/users/batch/delete", { ids: [userAId, userBId] }, [200])
    );
  }
}
