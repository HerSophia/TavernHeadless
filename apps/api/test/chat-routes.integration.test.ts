import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerChatRoutes } from "../src/routes/chat";
import type { ChatService } from "../src/services/chat-service";

describe("chat routes", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("maps branch fields on /sessions/:id/respond", async () => {
    app = Fastify({ logger: false });

    const respond = vi.fn(async () => ({
      floorId: "floor-1",
      floorNo: 3,
      branchId: "alt",
      generatedText: "hello",
      summaries: [],
      totalUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      finalState: "committed",
    }));

    const chatService = {
      respond,
      regenerate: vi.fn(),
      dryRun: vi.fn(),
      retryFloor: vi.fn(),
      editAndRegenerate: vi.fn(),
    } as unknown as ChatService;

    await registerChatRoutes(app, chatService, { enablePromptDryRun: true, enableSseChat: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond",
      payload: {
        message: "hello",
        branch_id: "alt",
        source_floor_id: "floor-source",
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

    expect(respond).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        branchId: "alt",
        sourceFloorId: "floor-source",
      }),
      {},
      "default-admin"
    );
  });

  it("forwards account context on /sessions/:id/regenerate", async () => {
    app = Fastify({ logger: false });

    const regenerate = vi.fn(async () => ({
      floorId: "floor-r1",
      floorNo: 2,
      previousFloorId: "floor-old",
      generatedText: "regen",
      summaries: [],
      totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finalState: "committed",
    }));

    const chatService = {
      respond: vi.fn(),
      regenerate,
      dryRun: vi.fn(),
      retryFloor: vi.fn(),
      editAndRegenerate: vi.fn(),
    } as unknown as ChatService;

    await registerChatRoutes(app, chatService, { enablePromptDryRun: true, enableSseChat: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/regenerate",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(regenerate).toHaveBeenCalledWith("s1", {}, "default-admin");
  });

  it("handles /floors/:id/retry", async () => {
    app = Fastify({ logger: false });

    const retryFloor = vi.fn(async () => ({
      floorId: "floor-failed",
      floorNo: 4,
      branchId: "main",
      generatedText: "retry ok",
      summaries: ["s"],
      totalUsage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
      finalState: "committed",
    }));

    const chatService = {
      respond: vi.fn(),
      regenerate: vi.fn(),
      dryRun: vi.fn(),
      retryFloor,
      editAndRegenerate: vi.fn(),
    } as unknown as ChatService;

    await registerChatRoutes(app, chatService, { enablePromptDryRun: true, enableSseChat: true });

    const response = await app.inject({
      method: "POST",
      url: "/floors/f1/retry",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(retryFloor).toHaveBeenCalledWith("f1", {}, "default-admin");
  });

  it("handles /messages/:id/edit-and-regenerate", async () => {
    app = Fastify({ logger: false });

    const editAndRegenerate = vi.fn(async () => ({
      floorId: "floor-new",
      floorNo: 5,
      branchId: "edit-1",
      sourceFloorId: "floor-old",
      sourceMessageId: "msg-old",
      generatedText: "edited",
      summaries: [],
      totalUsage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      finalState: "committed",
    }));

    const chatService = {
      respond: vi.fn(),
      regenerate: vi.fn(),
      dryRun: vi.fn(),
      retryFloor: vi.fn(),
      editAndRegenerate,
    } as unknown as ChatService;

    await registerChatRoutes(app, chatService, { enablePromptDryRun: true, enableSseChat: true });

    const response = await app.inject({
      method: "POST",
      url: "/messages/m1/edit-and-regenerate",
      payload: {
        content: "edited user line",
        branch_id: "edit-1",
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

    expect(editAndRegenerate).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({ content: "edited user line", branchId: "edit-1" }),
      "default-admin"
    );
  });
});
