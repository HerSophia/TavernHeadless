import type { SmokeContext } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeWorldbookEntries(ctx: SmokeContext): Promise<void> {
  const { api, options, runId, runStep } = ctx;
  const worldbookId = must(ctx.shared.worldbookId, "smokeWorldbookEntries requires worldbookId");
  const base = `/worldbooks/${worldbookId}/entries`;

  const entryA = await runStep("POST /worldbooks/:wid/entries (A)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      base,
      { keys: [`${runId}-key-a`], content: "Entry A" },
      [201]
    )
  );
  const entryAId = must(entryA.body?.data?.id, "Missing worldbook entry A id");

  const entryB = await runStep("POST /worldbooks/:wid/entries (B)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      base,
      { keys: [`${runId}-key-b`], content: "Entry B" },
      [201]
    )
  );
  const entryBId = must(entryB.body?.data?.id, "Missing worldbook entry B id");

  await runStep("GET /worldbooks/:wid/entries", async () => {
    const res = await api.request<{ data: unknown[] }>("GET", base, undefined, [200]);
    assert(Array.isArray(res.body?.data) && res.body!.data.length >= 2, "Entry list should have at least 2 items");
  });

  await runStep("GET /worldbooks/:wid/entries/:id", async () => {
    const res = await api.request<{ data: { id: string } }>("GET", `${base}/${entryAId}`, undefined, [200]);
    assert(res.body?.data?.id === entryAId, "Worldbook entry id mismatch");
  });

  await runStep("PATCH /worldbooks/:wid/entries/:id", () =>
    api.request("PATCH", `${base}/${entryAId}`, { content: "updated" }, [200])
  );

  await runStep("PUT /worldbooks/:wid/entries/batch/reorder", () =>
    api.request("PUT", `${base}/batch/reorder`, {
      items: [
        { id: entryBId, order: 0 },
        { id: entryAId, order: 1 },
      ],
    }, [200])
  );

  await runStep("PATCH /worldbooks/:wid/entries/batch/update", () =>
    api.request("PATCH", `${base}/batch/update`, {
      ids: [entryAId, entryBId],
      fields: { content: "batch-updated" },
    }, [200])
  );

  if (!options.keepData) {
    await runStep("POST /worldbooks/:wid/entries/batch/delete", () =>
      api.request("POST", `${base}/batch/delete`, { ids: [entryAId, entryBId] }, [200])
    );
  }
}
