import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerChatRoutes } from "../src/routes/chat";
import { ChatServiceError, type ChatService } from "../src/services/chat-service";

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

describe("chat routes", () => {
  let app: FastifyInstance;

  async function mountChatRoutes(
    chatService: ChatServiceStub,
    options: { enablePromptDryRun?: boolean; enableSseChat?: boolean } = {}
  ) {
    app = Fastify({ logger: false });
    await registerChatRoutes(
      app,
      chatService as unknown as ChatService,
      { enablePromptDryRun: true, enableSseChat: true, ...options }
    );
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  it("maps branch fields and generation params on /sessions/:id/respond", async () => {
    const chatService = createChatService({
      respond: vi.fn(async () => ({
        floorId: "floor-1",
        floorNo: 3,
        branchId: "alt",
        generatedText: "hello",
        summaries: [],
        totalUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        finalState: "committed",
      })),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond",
      payload: {
        message: "hello",
        branch_id: "alt",
        source_floor_id: "floor-source",
        config: {
          enableDirector: true,
          enableVerifier: false,
          enableMemoryConsolidation: true,
          verifierFailStrategy: "warn",
          maxRetries: 2,
        },
        generation_params: {
          temperature: 0.7,
          max_output_tokens: 256,
          top_p: 0.9,
          top_k: 40,
          frequency_penalty: 0.1,
          presence_penalty: 0.2,
          stop_sequences: ["<END>"],
          stream: true,
          reasoning_effort: "high",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        floor_id: "floor-1",
        floor_no: 3,
        branch_id: "alt",
        generated_text: "hello",
        summaries: [],
        total_usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        final_state: "committed",
      },
    });

    expect(chatService.respond).toHaveBeenCalledWith(
      "s1",
      {
        message: "hello",
        config: {
          enableDirector: true,
          enableVerifier: false,
          enableMemoryConsolidation: true,
          verifierFailStrategy: "warn",
          maxRetries: 2,
        },
        generationParams: {
          temperature: 0.7,
          maxOutputTokens: 256,
          topP: 0.9,
          topK: 40,
          frequencyPenalty: 0.1,
          presencePenalty: 0.2,
          stopSequences: ["<END>"],
          stream: true,
          reasoningEffort: "high",
        },
        branchId: "alt",
        sourceFloorId: "floor-source",
      },
      {},
      "default-admin"
    );
  });


  it.each([
    {
      name: "session_archived",
      code: "session_archived",
      message: "Cannot respond to an archived session",
      statusCode: 409,
      errorCode: "session_archived",
    },
    {
      name: "invalid_message_scope",
      code: "invalid_message_scope",
      message: "Message scope is invalid",
      statusCode: 400,
      errorCode: "invalid_message_scope",
    },
    {
      name: "profile_disabled",
      code: "profile_disabled",
      message: "Profile is disabled",
      statusCode: 409,
      errorCode: "profile_disabled",
    },
    {
      name: "secret_unavailable",
      code: "secret_unavailable",
      message: "Secret is unavailable",
      statusCode: 503,
      errorCode: "secret_unavailable",
    },
    {
      name: "orchestration_failed",
      code: "orchestration_failed",
      message: "Turn orchestration failed",
      statusCode: 500,
      errorCode: "orchestration_failed",
    },
  ])("maps %s errors on /sessions/:id/respond", async ({ code, message, statusCode, errorCode }) => {
    const chatService = createChatService({
      respond: vi.fn(async () => {
        throw new ChatServiceError(code, message);
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(statusCode);
    expect(response.json<{ error: { code: string; message: string } }>()).toEqual({
      error: {
        code: errorCode,
        message,
      },
    });
  });

  it("returns 500 when /sessions/:id/respond raises an unexpected error", async () => {
    const chatService = createChatService({
      respond: vi.fn(async () => {
        throw new Error("unexpected failure");
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(500);
  });

  it("forwards account context on /sessions/:id/regenerate with an omitted body", async () => {
    const chatService = createChatService({
      regenerate: vi.fn(async () => ({
        floorId: "floor-r1",
        floorNo: 2,
        previousFloorId: "floor-old",
        generatedText: "regen",
        summaries: [],
        totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finalState: "committed",
      })),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/regenerate",
    });

    expect(response.statusCode).toBe(200);
    expect(chatService.regenerate).toHaveBeenCalledWith("s1", {}, "default-admin");
  });

  it("maps generation params and errors on /sessions/:id/regenerate", async () => {
    const chatService = createChatService({
      regenerate: vi.fn(async () => {
        throw new ChatServiceError("no_floor_to_regenerate", "No floor available to regenerate");
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/regenerate",
      payload: {
        generation_params: {
          temperature: 0.5,
          max_output_tokens: 64,
          top_p: 0.8,
          top_k: 20,
          frequency_penalty: 0.4,
          presence_penalty: 0.3,
          stop_sequences: ["STOP"],
          stream: true,
          reasoning_effort: "low",
        },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("no_floor_to_regenerate");
    expect(chatService.regenerate).toHaveBeenCalledWith(
      "s1",
      {
        config: undefined,
        generationParams: {
          temperature: 0.5,
          maxOutputTokens: 64,
          topP: 0.8,
          topK: 20,
          frequencyPenalty: 0.4,
          presencePenalty: 0.3,
          stopSequences: ["STOP"],
          stream: true,
          reasoningEffort: "low",
        },
      },
      "default-admin"
    );
  });

  it("handles /floors/:id/retry with an omitted body", async () => {
    const chatService = createChatService({
      retryFloor: vi.fn(async () => ({
        floorId: "floor-failed",
        floorNo: 4,
        branchId: "main",
        generatedText: "retry ok",
        summaries: ["s"],
        totalUsage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
        finalState: "committed",
      })),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/floors/f1/retry",
    });

    expect(response.statusCode).toBe(200);
    expect(chatService.retryFloor).toHaveBeenCalledWith("f1", {}, "default-admin");
  });

  it("maps generation params and invalid_state on /floors/:id/retry", async () => {
    const chatService = createChatService({
      retryFloor: vi.fn(async () => {
        throw new ChatServiceError("invalid_state", "Floor is not failed");
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/floors/f1/retry",
      payload: {
        generation_params: {
          temperature: 0.6,
          max_output_tokens: 32,
          top_p: 0.7,
          top_k: 10,
          frequency_penalty: 0.2,
          presence_penalty: 0.1,
          stop_sequences: ["END"],
          stream: false,
          reasoning_effort: "medium",
        },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("invalid_state");
    expect(chatService.retryFloor).toHaveBeenCalledWith(
      "f1",
      {
        config: undefined,
        generationParams: {
          temperature: 0.6,
          maxOutputTokens: 32,
          topP: 0.7,
          topK: 10,
          frequencyPenalty: 0.2,
          presencePenalty: 0.1,
          stopSequences: ["END"],
          stream: false,
          reasoningEffort: "medium",
        },
      },
      "default-admin"
    );
  });

  it("handles /messages/:id/edit-and-regenerate with mapped generation params", async () => {
    const chatService = createChatService({
      editAndRegenerate: vi.fn(async () => ({
        floorId: "floor-new",
        floorNo: 5,
        branchId: "edit-1",
        sourceFloorId: "floor-old",
        sourceMessageId: "msg-old",
        generatedText: "edited",
        summaries: [],
        totalUsage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
        finalState: "committed",
      })),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/messages/m1/edit-and-regenerate",
      payload: {
        content: "edited user line",
        branch_id: "edit-1",
        generation_params: {
          temperature: 0.4,
          max_output_tokens: 48,
          top_p: 0.95,
          top_k: 30,
          frequency_penalty: 0.05,
          presence_penalty: 0.15,
          stop_sequences: ["HALT"],
          stream: true,
          reasoning_effort: "high",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        floor_id: "floor-new",
        floor_no: 5,
        branch_id: "edit-1",
        source_floor_id: "floor-old",
        source_message_id: "msg-old",
        generated_text: "edited",
        summaries: [],
        total_usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        final_state: "committed",
      },
    });

    expect(chatService.editAndRegenerate).toHaveBeenCalledWith(
      "m1",
      {
        content: "edited user line",
        branchId: "edit-1",
        config: undefined,
        generationParams: {
          temperature: 0.4,
          maxOutputTokens: 48,
          topP: 0.95,
          topK: 30,
          frequencyPenalty: 0.05,
          presencePenalty: 0.15,
          stopSequences: ["HALT"],
          stream: true,
          reasoningEffort: "high",
        },
      },
      "default-admin"
    );
  });

  it("maps message_not_found on /messages/:id/edit-and-regenerate", async () => {
    const chatService = createChatService({
      editAndRegenerate: vi.fn(async () => {
        throw new ChatServiceError("message_not_found", "Message not found");
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/messages/m1/edit-and-regenerate",
      payload: {
        content: "edited user line",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string; message: string } }>()).toEqual({
      error: {
        code: "message_not_found",
        message: "Message not found",
      },
    });
  });
});
