import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { registerChatRoutes } from "../src/routes/chat";
import { ChatService, type ChatService as ChatServiceType, type DryRunResult } from "../src/services/chat-service";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { sessions, floors, messagePages, messages as messageTable } from "../src/db/schema";
import { SimpleTokenCounter, type TurnOrchestrator } from "@tavern/core";

describe("POST /sessions/:id/respond/dry-run", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  it("returns 404 when dry-run endpoint is disabled", async () => {
    app = Fastify({ logger: false });

    const chatService = {
      respond: vi.fn(),
      regenerate: vi.fn(),
      dryRun: vi.fn(),
    } as unknown as ChatServiceType;

    await registerChatRoutes(app, chatService, { enablePromptDryRun: false });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/dry-run",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "not_found",
        message: "Dry-run endpoint is disabled",
      },
    });
  });

  it("returns assembled prompt debug payload when enabled", async () => {
    app = Fastify({ logger: false });

    const result: DryRunResult = {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hello" },
      ],
      tokenEstimate: 42,
      availableForReply: 1000,
      memorySummary: "[Memory] hello",
      assembly: {
        mode: "fallback",
        presetUsed: false,
        worldbookHits: 0,
        regexPreRules: ["Input Rule"],
        regexPostRules: [],
        memorySummaryInjected: true,
        preprocessedUserMessage: "hello",
      },
    };

    const dryRun = vi.fn(async () => result);

    const chatService = {
      respond: vi.fn(),
      regenerate: vi.fn(),
      dryRun,
    } as unknown as ChatServiceType;

    await registerChatRoutes(app, chatService, { enablePromptDryRun: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/dry-run",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(dryRun).toHaveBeenCalledOnce();
    expect(dryRun).toHaveBeenCalledWith("s1", { message: "hello" }, "default-admin");

    const body = response.json() as { data: Record<string, unknown> };
    expect(body.data.token_estimate).toBe(42);
    expect(body.data.available_for_reply).toBe(1000);
    expect(body.data.memory_summary).toBe("[Memory] hello");
    expect(body.data.messages).toEqual(result.messages);
    expect(body.data.assembly).toEqual({
      mode: "fallback",
      preset_used: false,
      worldbook_hits: 0,
      regex_pre_rules: ["Input Rule"],
      regex_post_rules: [],
      memory_summary_injected: true,
      preprocessed_user_message: "hello",
    });
  });
});

describe("ChatService.dryRun", () => {
  let database: DatabaseConnection;
  let chatService: ChatService;
  let sessionId: string;
  let mockOrchestrator: TurnOrchestrator;

  beforeEach(async () => {
    database = createDatabase(":memory:");

    mockOrchestrator = {
      executeTurn: vi.fn(async () => {
        throw new Error("executeTurn should not be called in dry-run");
      }),
    } as unknown as TurnOrchestrator;

    chatService = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter());

    sessionId = nanoid();
    const now = Date.now();
    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Dry Run Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const floorId = nanoid();
    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 0,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    const pageId = nanoid();
    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 0,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(messageTable).values({
      id: nanoid(),
      pageId,
      seq: 0,
      role: "user",
      content: "history",
      contentFormat: "text",
      tokenCount: 1,
      isHidden: false,
      source: "api",
      createdAt: now,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("does not call orchestrator and does not write floor/message side effects", async () => {
    const floorsBefore = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    const messagesBefore = await database.db.select().from(messageTable);

    const result = await chatService.dryRun(sessionId, { message: "hello dry run" });

    expect(result.messages[result.messages.length - 1]?.content).toBe("hello dry run");
    expect(result.tokenEstimate).toBeGreaterThan(0);
    expect(mockOrchestrator.executeTurn).not.toHaveBeenCalled();

    const floorsAfter = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    const messagesAfter = await database.db.select().from(messageTable);

    expect(floorsAfter).toEqual(floorsBefore);
    expect(messagesAfter).toEqual(messagesBefore);
  });
});
