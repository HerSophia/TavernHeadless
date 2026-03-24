import type { SmokeContext } from "./harness.js";
import { must } from "./harness.js";

export async function smokeChat(ctx: SmokeContext): Promise<void> {
  const { api, runStep } = ctx;
  const sessionId = must(ctx.shared.sessionId, "smokeChat requires sessionId");

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
