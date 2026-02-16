import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerChatRoutes } from "../src/routes/chat";
import { ChatServiceError, type ChatService, type RespondResult } from "../src/services/chat-service";

describe("POST /sessions/:id/respond/stream", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  it("returns 404 when stream endpoint is disabled", async () => {
    app = Fastify({ logger: false });

    const chatService = {
      respond: vi.fn(),
      regenerate: vi.fn(),
    } as unknown as ChatService;

    await registerChatRoutes(app, chatService, { enableSseChat: false });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "not_found",
        message: "Stream endpoint is disabled",
      },
    });
  });

  it("streams start/chunk/summary/done events when enabled", async () => {
    app = Fastify({ logger: false });

    const result: RespondResult = {
      floorId: "floor-1",
      floorNo: 3,
      branchId: "main",
      generatedText: "Hello world",
      summaries: ["short summary"],
      totalUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      finalState: "committed",
    };

    const respond = vi.fn(async (_sessionId: string, _request: unknown, runtimeOptions?: unknown) => {
      const runtime = runtimeOptions as {
        onStart?: (context: { floorId: string; floorNo: number }) => void;
        onChunk?: (chunk: string) => void;
      };

      runtime.onStart?.({ floorId: result.floorId, floorNo: result.floorNo });
      runtime.onChunk?.("Hello ");
      runtime.onChunk?.("world");
      return result;
    });

    const chatService = {
      respond,
      regenerate: vi.fn(),
    } as unknown as ChatService;

    await registerChatRoutes(app, chatService, { enableSseChat: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");

    const body = response.body;
    expect(body).toContain("event: start");
    expect(body).toContain('"floor_id":"floor-1"');
    expect(body).toContain('"branch_id":"main"');
    expect(body).toContain("event: chunk");
    expect(body).toContain('"chunk":"Hello "');
    expect(body).toContain('"chunk":"world"');
    expect(body).toContain("event: summary");
    expect(body).toContain('"summaries":["short summary"]');
    expect(body).toContain("event: done");
    expect(body).toContain('"generated_text":"Hello world"');
  });

  it("streams error event when chat service fails", async () => {
    app = Fastify({ logger: false });

    const chatService = {
      respond: vi.fn(async () => {
        throw new ChatServiceError("session_not_found", "Session 's1' not found");
      }),
      regenerate: vi.fn(),
    } as unknown as ChatService;

    await registerChatRoutes(app, chatService, { enableSseChat: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: error");
    expect(response.body).toContain('"code":"not_found"');
    expect(response.body).toContain('"message":"Session');
  });
});
