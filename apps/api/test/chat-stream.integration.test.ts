import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerChatRoutes } from "../src/routes/chat";
import { ChatServiceError, type ChatService, type RespondResult } from "../src/services/chat-service";

interface ChatServiceStub {
  respond: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
  dryRun: ReturnType<typeof vi.fn>;
  retryFloor: ReturnType<typeof vi.fn>;
  editAndRegenerate: ReturnType<typeof vi.fn>;
}

function createChatService(overrides: Partial<ChatServiceStub> = {}): ChatServiceStub {
  return {
    respond: vi.fn(),
    regenerate: vi.fn(),
    dryRun: vi.fn(),
    retryFloor: vi.fn(),
    editAndRegenerate: vi.fn(),
    ...overrides,
  };
}

describe("POST /sessions/:id/respond/stream", () => {
  let app: FastifyInstance;

  async function mountChatRoutes(
    chatService: ChatServiceStub,
    options: { enableSseChat?: boolean; enablePromptDryRun?: boolean } = {}
  ) {
    app = Fastify({ logger: false });
    await registerChatRoutes(
      app,
      chatService as unknown as ChatService,
      { enableSseChat: true, enablePromptDryRun: true, ...options }
    );
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  it("returns 404 when stream endpoint is disabled", async () => {
    const chatService = createChatService();

    await mountChatRoutes(chatService, { enableSseChat: false });

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


  it("streams start/chunk/summary/done events when enabled and maps generation params", async () => {
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

    const chatService = createChatService({
      respond: vi.fn(async (_sessionId: string, request: unknown, runtimeOptions?: unknown, accountId?: string) => {
        expect(request).toEqual({
          message: "hello",
          config: undefined,
          generationParams: {
            temperature: 0.6,
            maxOutputTokens: 128,
            topP: 0.85,
            topK: 25,
            frequencyPenalty: 0.3,
            presencePenalty: 0.4,
            stopSequences: ["DONE"],
            stream: true,
            reasoningEffort: "medium",
          },
          branchId: "main",
          sourceFloorId: "floor-source",
        });
        expect(accountId).toBe("default-admin");

        const runtime = runtimeOptions as {
          onStart?: (context: { floorId: string; floorNo: number; branchId: string }) => void;
          onRun?: (payload: Record<string, unknown>) => void;
          onChunk?: (chunk: string) => void;
          abortSignal?: AbortSignal;
        };

        expect(runtime.abortSignal).toBeInstanceOf(AbortSignal);
        runtime.onStart?.({ floorId: result.floorId, floorNo: result.floorNo, branchId: result.branchId });
        runtime.onRun?.({
          floorId: result.floorId,
          runId: "run-1",
          runType: "respond",
          status: "running",
          phase: "page_generating",
          publicPhase: "generating",
          phaseSeq: 2,
          attemptNo: 1,
          startedAt: 100,
          updatedAt: 110,
        });
        runtime.onChunk?.("Hello ");
        runtime.onChunk?.("world");
        return result;
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: {
        message: "hello",
        branch_id: "main",
        source_floor_id: "floor-source",
        generation_params: {
          temperature: 0.6,
          max_output_tokens: 128,
          top_p: 0.85,
          top_k: 25,
          frequency_penalty: 0.3,
          presence_penalty: 0.4,
          stop_sequences: ["DONE"],
          stream: true,
          reasoning_effort: "medium",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");

    const body = response.body;
    expect(body).toContain("event: start");
    expect(body).toContain('"floor_id":"floor-1"');
    expect(body).toContain('"branch_id":"main"');
    expect(body).toContain("event: run");
    expect(body).toContain('"run_id":"run-1"');
    expect(body).toContain("event: chunk");
    expect(body).toContain('"chunk":"Hello "');
    expect(body).toContain('"chunk":"world"');
    expect(body).toContain("event: summary");
    expect(body).toContain('"summaries":["short summary"]');
    expect(body).toContain("event: done");
    expect(body).toContain('"generated_text":"Hello world"');
  });

  it("streams error event when chat service fails", async () => {
    const chatService = createChatService({
      respond: vi.fn(async () => {
        throw new ChatServiceError("session_not_found", "Session 's1' not found");
      }),
    });

    await mountChatRoutes(chatService);

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

  it("streams internal_error event for unexpected failures", async () => {
    const chatService = createChatService({
      respond: vi.fn(async () => {
        throw new Error("unexpected stream failure");
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: error");
    expect(response.body).toContain('"code":"internal_error"');
    expect(response.body).toContain('"message":"unexpected stream failure"');
  });
});
