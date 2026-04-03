import { describe, expect, it, vi } from "vitest";

import { buildAccountHeaders, createTavernClient, TavernApiError } from "../index.js";

describe("createTavernClient", () => {
  it("merges authorization headers with the legacy account compatibility header", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const client = createTavernClient({
      baseUrl: "http://localhost:3000",
      fetchImpl,
      getHeaders: () => ({ authorization: "Bearer token" }),
    });

    await client.get("/health", {
      headers: buildAccountHeaders("acc-1"),
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = init?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("x-account-id")).toBe("acc-1");
  });

  it("parses respond stream events and returns final result", async () => {
    const stream = [
      "event: start\n",
      'data: {"floor_id":"floor-1","floor_no":3}\n\n',
      "event: chunk\n",
      'data: {"chunk":"Hello"}\n\n',
      "event: summary\n",
      'data: {"summaries":["one"]}\n\n',
      "event: done\n",
      'data: {"branch_id":"branch-1","final_state":"committed","floor_id":"floor-1","floor_no":3,"generated_text":"Hello","summaries":["one","two"],"total_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15},"memory":{"mode":"async","status":"queued","job_id":"memory-job:ingest_turn:floor-1"}}\n\n',
    ].join("");

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }),
    );

    const client = createTavernClient({
      baseUrl: "http://localhost:3000",
      fetchImpl,
    });

    const chunks: string[] = [];
    const summaries: string[][] = [];

    const result = await client.sessions.respondStream({
      message: "hi",
      onChunk: (payload) => chunks.push(payload.chunk),
      onSummary: (payload) => summaries.push(payload.summaries),
      sessionId: "session-1",
    });

    expect(chunks).toEqual(["Hello"]);
    expect(summaries).toEqual([["one"]]);
    expect(result.branchId).toBe("branch-1");
    expect(result.finalState).toBe("committed");
    expect(result.generatedText).toBe("Hello");
    expect(result.memory).toEqual({
      jobId: "memory-job:ingest_turn:floor-1",
      mode: "async",
      status: "queued",
    });
    expect(result.summaries).toEqual(["one", "two"]);
    expect(result.totalTokens).toBe(15);
  });

  it("mounts the Batch 2 content resources", () => {
    const client = createTavernClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: vi.fn<typeof fetch>(),
    });

    expect(client.branches).toBeDefined();
    expect(typeof client.branches.remove).toBe("function");

    expect(client.pages).toBeDefined();
    expect(typeof client.pages.list).toBe("function");
    expect(typeof client.pages.activate).toBe("function");

    expect(client.presetEntries).toBeDefined();
    expect(typeof client.presetEntries.list).toBe("function");
    expect(typeof client.presetEntries.batchUpdate).toBe("function");

    expect(client.regexProfiles).toBeDefined();
    expect(typeof client.regexProfiles.list).toBe("function");
    expect(typeof client.regexProfiles.remove).toBe("function");

    expect(client.worldbookEntries).toBeDefined();
    expect(typeof client.worldbookEntries.list).toBe("function");
    expect(typeof client.worldbookEntries.batchReorder).toBe("function");

    expect(client.accounts).toBeDefined();
    expect(typeof client.accounts.list).toBe("function");

    expect(client.variables).toBeDefined();
    expect(typeof client.variables.upsertMany).toBe("function");

    expect(client.memories).toBeDefined();
    expect(typeof client.memories.getStats).toBe("function");
    expect(typeof client.memories.batchDelete).toBe("function");

    expect(client.memoryJobs).toBeDefined();
    expect(typeof client.memoryJobs.list).toBe("function");
    expect(typeof client.memoryJobs.retry).toBe("function");

    expect(client.memoryEdges).toBeDefined();
    expect(typeof client.memoryEdges.list).toBe("function");

    expect(client.memoryScopes).toBeDefined();
    expect(typeof client.memoryScopes.compact).toBe("function");

    expect(client.chatTransferJobs).toBeDefined();
    expect(typeof client.chatTransferJobs.list).toBe("function");
    expect(typeof client.chatTransferJobs.downloadFile).toBe("function");

    expect(client.exports).toBeDefined();
    expect(typeof client.exports.chat).toBe("function");
    expect(typeof client.exports.chatJob).toBe("function");
    expect(typeof client.exports.character).toBe("function");

    expect(client.imports).toBeDefined();
    expect(typeof client.imports.chatJob).toBe("function");

    expect(client.tools).toBeDefined();
    expect(typeof client.tools.listBuiltin).toBe("function");
    expect(typeof client.tools.listCallRecords).toBe("function");

    expect(client.mcp).toBeDefined();
    expect(typeof client.mcp.listServers).toBe("function");
    expect(typeof client.mcp.testServer).toBe("function");
  });

  it("throws TavernApiError for non-ok JSON response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "boom", message: "broken" } }), {
        headers: { "content-type": "application/json" },
        status: 500,
      }),
    );

    const client = createTavernClient({
      baseUrl: "http://localhost:3000",
      fetchImpl,
    });

    await expect(
      client.sessions.respond({
        message: "hi",
        sessionId: "session-1",
      }),
    ).rejects.toBeInstanceOf(TavernApiError);
  });
});
