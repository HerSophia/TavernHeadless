import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { API_BASE, sseResponse, type SseEvent } from "../../test/msw/handlers";
import { streamTempRespond, tempConversationApi } from "./index";

/** 后端响应形态（snake_case），校验 SDK 映射与本层封装。 */
const conversationBody = {
  id: "c1",
  workspace_id: null,
  project_id: "p1",
  source_session_id: null,
  branch_id: "main",
  kind: "temporary",
  title: null,
  purpose: "graph-assistant",
  status: "active",
  retention_policy: "ttl",
  visibility: "client_visible",
  created_at: 0,
  updated_at: 0,
  last_activity_at: 0,
  expires_at: 3600000,
  finalized_at: null,
  discarded_at: null,
  cancelled_at: null,
  cleaned_at: null,
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("tempConversationApi.createFromProject (msw)", () => {
  it("sends purpose + ttl retention policy + 1h ttl seconds and maps the record", async () => {
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`${API_BASE}/projects/p1/temporary-conversations`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: conversationBody }, { status: 201 });
      }),
    );

    const record = await tempConversationApi.createFromProject("p1", "graph-assistant");

    expect(captured).toMatchObject({
      purpose: "graph-assistant",
      retention_policy: "ttl",
      ttl_seconds: 3600,
    });
    expect(record.id).toBe("c1");
    expect(record.status).toBe("active");
    expect(record.retentionPolicy).toBe("ttl");
  });
});

describe("streamTempRespond (msw SSE)", () => {
  it("accumulates chunks, reports start floorNo, and resolves the mapped result", async () => {
    const events: SseEvent[] = [
      { event: "start", data: { floor_id: "f1", floor_no: 1, branch_id: "main" } },
      { event: "chunk", data: { chunk: "Hello" } },
      { event: "chunk", data: { chunk: " graph" } },
      {
        event: "done",
        data: {
          conversation_id: "c1",
          branch_id: "main",
          floor_id: "f1",
          floor_no: 1,
          page_id: "pg1",
          generated_text: "Hello graph",
          summaries: [],
          total_usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        },
      },
    ];
    server.use(http.post(`${API_BASE}/temporary-conversations/c1/respond`, () => sseResponse(events)));

    const chunks: string[] = [];
    let startFloorNo: number | null = null;
    const result = await streamTempRespond({
      conversationId: "c1",
      message: "hi",
      callbacks: {
        onStart: (floorNo) => {
          startFloorNo = floorNo;
        },
        onChunk: (delta) => chunks.push(delta),
      },
    });

    expect(chunks.join("")).toBe("Hello graph");
    expect(startFloorNo).toBe(1);
    expect(result.conversationId).toBe("c1");
    expect(result.pageId).toBe("pg1");
    expect(result.generatedText).toBe("Hello graph");
  });

  it("surfaces stream error events and rejects", async () => {
    const events: SseEvent[] = [
      { event: "start", data: { floor_id: "f1", floor_no: 1, branch_id: "main" } },
      { event: "error", data: { code: "stream_failed", message: "boom" } },
    ];
    server.use(http.post(`${API_BASE}/temporary-conversations/c1/respond`, () => sseResponse(events)));

    const errors: string[] = [];
    await expect(
      streamTempRespond({
        conversationId: "c1",
        message: "hi",
        callbacks: { onError: (message) => errors.push(message) },
      }),
    ).rejects.toThrow();
    expect(errors).toContain("boom");
  });
});
