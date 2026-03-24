import type { SmokeContext } from "./harness.js";
import { must } from "./harness.js";

export async function smokeMemories(ctx: SmokeContext): Promise<void> {
  const { api, options, runId, runStep, track, addCleanup } = ctx;
  const sessionId = must(ctx.shared.sessionId, "smokeMemories requires sessionId");
  const floorId = must(ctx.shared.floorId, "smokeMemories requires floorId");

  const memoryA = await runStep("POST /memories (A)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/memories",
      {
        scope: "chat",
        scope_id: sessionId,
        type: "fact",
        content: { text: `${runId}-memory-a` },
        source_floor_id: floorId,
        status: "active",
      },
      [201]
    )
  );
  const memoryAId = must(memoryA.body?.data?.id, "Missing memory A id");
  track("memories", memoryAId);
  addCleanup(async () => {
    await api.request("DELETE", `/memories/${memoryAId}`, undefined, [200, 404]);
  });

  const memoryB = await runStep("POST /memories (B)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/memories",
      {
        scope: "chat",
        scope_id: sessionId,
        type: "summary",
        content: { text: `${runId}-memory-b` },
        status: "deprecated",
      },
      [201]
    )
  );
  const memoryBId = must(memoryB.body?.data?.id, "Missing memory B id");
  track("memories", memoryBId);
  addCleanup(async () => {
    await api.request("DELETE", `/memories/${memoryBId}`, undefined, [200, 404]);
  });

  await runStep("PATCH /memories/:id", () =>
    api.request("PATCH", `/memories/${memoryAId}`, { confidence: 0.8 }, [200])
  );
  await runStep("GET /memories", () =>
    api.request(
      "GET",
      `/memories?scope=chat&scope_id=${encodeURIComponent(sessionId)}&type=fact&status=active&source_floor_id=${encodeURIComponent(floorId)}&q=${encodeURIComponent(runId)}&limit=10&offset=0&sort_by=created_at&sort_order=desc`,
      undefined,
      [200]
    )
  );
  await runStep("GET /memories/:id", () => api.request("GET", `/memories/${memoryAId}`, undefined, [200]));
  await runStep("GET /memories/stats", () =>
    api.request("GET", `/memories/stats?scope=chat&scope_id=${encodeURIComponent(sessionId)}`, undefined, [200])
  );

  const edge = await runStep("POST /memory-edges", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/memory-edges",
      {
        from_id: memoryAId,
        to_id: memoryBId,
        relation: "supports",
      },
      [201]
    )
  );
  const edgeId = must(edge.body?.data?.id, "Missing memory edge id");
  track("memoryEdges", edgeId);
  addCleanup(async () => {
    await api.request("DELETE", `/memory-edges/${edgeId}`, undefined, [200, 404]);
  });

  await runStep("GET /memory-edges", () =>
    api.request("GET", `/memory-edges?from_id=${encodeURIComponent(memoryAId)}`, undefined, [200])
  );
  await runStep("GET /memory-edges/:id", () => api.request("GET", `/memory-edges/${edgeId}`, undefined, [200]));

  if (!options.keepData) {
    await runStep("DELETE /memory-edges/:id", () =>
      api.request("DELETE", `/memory-edges/${edgeId}`, undefined, [200])
    );
    await runStep("DELETE /memories/:id (A)", () =>
      api.request("DELETE", `/memories/${memoryAId}`, undefined, [200])
    );
    await runStep("DELETE /memories/:id (B)", () =>
      api.request("DELETE", `/memories/${memoryBId}`, undefined, [200])
    );
  }
}
