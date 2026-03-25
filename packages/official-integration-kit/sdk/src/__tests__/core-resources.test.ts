import { describe, expect, it, vi } from "vitest";

import { createTavernClient, TavernApiError } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk core resources", () => {
  it("reads health fields from a valid payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        database: "ok",
        service: "up",
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.health.get()).resolves.toEqual({
      database: "ok",
      service: "up",
    });
  });

  it("returns null health fields for malformed payloads", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        database: 1,
        service: null,
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.health.get()).resolves.toEqual({
      database: null,
      service: null,
    });
  });

  it("creates sessions with only defined fields and returns null when data is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.create({
        accountId: "acc-1",
      }),
    ).resolves.toBeNull();

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe("http://localhost:3000/sessions");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });

  it("lists sessions with default query and filters invalid rows", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          {
            character_binding: {
              snapshot_summary: {
                has_greeting: true,
                name: "Seraphina",
              },
            },
            created_at: 10,
            id: "session-1",
            status: "active",
            title: "Session A",
            updated_at: 11,
            user_binding: {
              snapshot_summary: {
                name: "Alice",
              },
            },
            worldbook_profile_id: null,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.sessions.list({ accountId: "acc-1" });

    expect(result).toEqual([
      {
        characterBinding: {
          snapshotSummary: {
            hasGreeting: true,
            name: "Seraphina",
          },
        },
        createdAt: 10,
        id: "session-1",
        status: "active",
        title: "Session A",
        updatedAt: 11,
        userBinding: {
          snapshotSummary: {
            name: "Alice",
          },
        },
        worldbookProfileId: null,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);

    expect(requestUrl.pathname).toBe("/sessions");
    expect(requestUrl.searchParams.get("limit")).toBe("50");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
    expect(requestUrl.searchParams.get("sort_by")).toBe("updated_at");
    expect(requestUrl.searchParams.get("sort_order")).toBe("desc");
  });

  it("maps respond payloads and generation params while defaulting missing usage to zero", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-1",
          floor_id: "floor-1",
          floor_no: 3,
          generated_text: "Hello",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.sessions.respond({
      accountId: "acc-1",
      generationParams: {
        frequencyPenalty: 0.1,
        maxOutputTokens: 128,
        presencePenalty: 0.2,
        stopSequences: ["END"],
        stream: true,
        temperature: 0.8,
        topK: 20,
        topP: 0.9,
      },
      message: "hello",
      sessionId: "session-1",
    });

    expect(result).toEqual({
      branchId: "branch-1",
      floorId: "floor-1",
      floorNo: 3,
      generatedText: "Hello",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalUsage: {},
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/sessions/session-1/respond");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      generation_params: {
        frequency_penalty: 0.1,
        max_output_tokens: 128,
        presence_penalty: 0.2,
        stop_sequences: ["END"],
        stream: true,
        temperature: 0.8,
        top_k: 20,
        top_p: 0.9,
      },
      message: "hello",
    }));
  });

  it("throws TavernApiError when respond payload misses required floor metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          generated_text: "Hello",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.respond({
        message: "hello",
        sessionId: "session-1",
      }),
    ).rejects.toBeInstanceOf(TavernApiError);
  });

  it("forwards respondStream callbacks and signal and returns the final mapped result", async () => {
    const stream = [
      "event: start\n",
      'data: {"branch_id":"branch-1","floor_id":"floor-1","floor_no":2}\n\n',
      "event: chunk\n",
      'data: {"chunk":"Hello"}\n\n',
      "event: summary\n",
      'data: {"summaries":["sum-1"]}\n\n',
      "event: done\n",
      'data: {"floor_id":"floor-1","floor_no":2,"generated_text":"Hello","total_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}\n\n',
    ].join("");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });
    const controller = new AbortController();
    const events: string[] = [];
    const chunks: string[] = [];
    const summaries: string[][] = [];
    const starts: Array<{ branchId?: string; floorId?: string; floorNo?: number }> = [];

    const result = await client.sessions.respondStream({
      message: "hello",
      onChunk: (payload) => chunks.push(payload.chunk),
      onEvent: (event) => events.push(event.type),
      onStart: (payload) => starts.push(payload),
      onSummary: (payload) => summaries.push(payload.summaries),
      sessionId: "session-1",
      signal: controller.signal,
    });

    expect(starts).toEqual([
      {
        branchId: "branch-1",
        floorId: "floor-1",
        floorNo: 2,
      },
    ]);
    expect(chunks).toEqual(["Hello"]);
    expect(summaries).toEqual([["sum-1"]]);
    expect(events).toEqual(["start", "chunk", "summary", "done"]);
    expect(result).toEqual({
      floorId: "floor-1",
      floorNo: 2,
      generatedText: "Hello",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      totalUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.signal).toBe(controller.signal);
  });

  it("maps timeline payloads with default query and filtered nested records", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "main",
          floors: [
            null,
            {
              active_page: {
                id: "page-1",
                messages: [
                  null,
                  {
                    content: "hello",
                    content_format: "markdown",
                    id: "msg-1",
                    role: "assistant",
                    seq: 1,
                  },
                ],
                page_kind: "main",
                page_no: 1,
                version: 2,
              },
              created_at: 100,
              floor_no: 1,
              id: "floor-1",
              page_count: 1,
              state: "completed",
              token_in: 5,
              token_out: 7,
            },
            {
              active_page: null,
              created_at: 101,
              floor_no: 2,
              id: "floor-2",
              page_count: 0,
              state: "completed",
              token_in: 0,
              token_out: 0,
            },
          ],
          session_id: "session-1",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.sessions.timeline({
      accountId: "acc-1",
      sessionId: "session-1",
    });

    expect(result).toEqual({
      branchId: "main",
      floors: [
        {
          activePage: {
            id: "page-1",
            messages: [
              {
                content: "hello",
                contentFormat: "markdown",
                id: "msg-1",
                role: "assistant",
                seq: 1,
              },
            ],
            pageKind: "main",
            pageNo: 1,
            version: 2,
          },
          createdAt: 100,
          floorNo: 1,
          id: "floor-1",
          pageCount: 1,
          state: "completed",
          tokenIn: 5,
          tokenOut: 7,
        },
        {
          activePage: null,
          createdAt: 101,
          floorNo: 2,
          id: "floor-2",
          pageCount: 0,
          state: "completed",
          tokenIn: 0,
          tokenOut: 0,
        },
      ],
      sessionId: "session-1",
    });

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);

    expect(requestUrl.pathname).toBe("/sessions/session-1/timeline");
    expect(requestUrl.searchParams.get("branch_id")).toBe("main");
    expect(requestUrl.searchParams.get("limit")).toBe("200");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
  });

  it("updates sessions with compacted bodies and returns false for non-200 success statuses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.update({
        sessionId: "session-1",
        title: "Renamed",
      }),
    ).resolves.toBe(false);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe("http://localhost:3000/sessions/session-1");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ title: "Renamed" }));
  });

  it("returns boolean delete results for sessions", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.remove({ sessionId: "session-1" })).resolves.toBe(true);
    await expect(client.sessions.remove({ sessionId: "session-2" })).resolves.toBe(false);
  });

  it("updates messages and returns null when the data payload is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.update({
        content: "Edited",
        messageId: "msg-1",
      }),
    ).resolves.toBeNull();

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe("http://localhost:3000/messages/msg-1");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ content: "Edited" }));
  });

  it("returns boolean delete results for messages", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.messages.remove({ messageId: "msg-1" })).resolves.toBe(true);
    await expect(client.messages.remove({ messageId: "msg-2" })).resolves.toBe(false);
  });

  it("maps edit-and-regenerate results and defaults missing usage to zero", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-2",
          floor_id: "floor-2",
          floor_no: 4,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.editAndRegenerate({
        content: "Rewrite",
        messageId: "msg-1",
      }),
    ).resolves.toEqual({
      branchId: "branch-2",
      floorId: "floor-2",
      floorNo: 4,
      totalTokens: 0,
      totalUsage: {},
    });
  });

  it("throws TavernApiError when edit-and-regenerate payload is invalid", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-2",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.editAndRegenerate({
        content: "Rewrite",
        messageId: "msg-1",
      }),
    ).rejects.toBeInstanceOf(TavernApiError);
  });

  it("maps floor retry results and posts an empty body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          floor_id: "floor-3",
          floor_no: 5,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.floors.retry({ floorId: "floor-3" })).resolves.toEqual({
      branchId: undefined,
      floorId: "floor-3",
      floorNo: 5,
      totalTokens: 0,
      totalUsage: {},
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/floors/floor-3/retry");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({}));
  });

  it("throws TavernApiError when floor retry payload is invalid", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-3",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.floors.retry({ floorId: "floor-3" })).rejects.toBeInstanceOf(TavernApiError);
  });
});
