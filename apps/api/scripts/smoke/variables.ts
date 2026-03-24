import type { SmokeContext } from "./harness.js";
import { must } from "./harness.js";

export async function smokeVariables(ctx: SmokeContext): Promise<void> {
  const { api, options, runId, runStep, track, addCleanup } = ctx;
  const sessionId = must(ctx.shared.sessionId, "smokeVariables requires sessionId");

  const variable = await runStep("PUT /variables (create)", () =>
    api.request<{ data: { id: string } }>(
      "PUT",
      "/variables",
      {
        scope: "chat",
        scope_id: sessionId,
        key: `${runId}.mood`,
        value: "happy",
      },
      [201]
    )
  );
  const variableId = must(variable.body?.data?.id, "Missing variable id");
  track("variables", variableId);
  addCleanup(async () => {
    await api.request("DELETE", `/variables/${variableId}`, undefined, [200, 404]);
  });

  await runStep("PUT /variables (update)", () =>
    api.request(
      "PUT",
      "/variables",
      {
        scope: "chat",
        scope_id: sessionId,
        key: `${runId}.mood`,
        value: "excited",
      },
      [200]
    )
  );
  await runStep("GET /variables", () =>
    api.request("GET", `/variables?scope=chat&scope_id=${encodeURIComponent(sessionId)}`, undefined, [200])
  );
  await runStep("GET /variables/:id", () => api.request("GET", `/variables/${variableId}`, undefined, [200]));

  if (!options.keepData) {
    await runStep("DELETE /variables/:id", () =>
      api.request("DELETE", `/variables/${variableId}`, undefined, [200])
    );
  }
}
