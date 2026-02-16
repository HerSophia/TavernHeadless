/**
 * Memory Injection Tests
 *
 * 验证摘要注入链路：
 * - PromptAssembler 记忆注入位置
 * - ChatService 带 MemoryStore 的 respond 流程
 * - 禁用记忆时行为不变
 * - 摘要持久化
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { floors, messagePages, messages, sessions } from "../src/db/schema";
import { ChatService } from "../src/services/chat-service";
import {
  SimpleTokenCounter,
  type TurnOrchestrator,
  type TurnOutput,
  type TurnInput,
  type MemoryStore,
} from "@tavern/core";

// ── Mock Setup ────────────────────────────────────────

const MOCK_GENERATED_TEXT = "The memory system is working.";

function createMockOrchestrator(database: DatabaseConnection) {
  return {
    executeTurn: vi.fn(async (input: TurnInput) => {
      await database.db
        .update(floors)
        .set({ state: "committed", updatedAt: Date.now() })
        .where(eq(floors.id, input.floorId));

      return {
        floorId: input.floorId,
        generatedText: MOCK_GENERATED_TEXT,
        rawText: MOCK_GENERATED_TEXT,
        summaries: ["Alice met Bob at the tavern."],
        totalUsage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
        finalState: "committed",
      } satisfies TurnOutput;
    }),
  } as unknown as TurnOrchestrator;
}

function createMockMemoryStore() {
  return {
    prepareInjection: vi.fn(async () => ({
      items: [
        {
          id: "mem-1",
          scope: "chat",
          scopeId: "test",
          type: "summary",
          content: "Alice is a brave adventurer.",
          importance: 0.7,
          confidence: 1,
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      formattedText: "[Memory]\n- (summary) Alice is a brave adventurer.",
      tokenCount: 12,
    })),
    ingestSummaries: vi.fn(async () => []),
    query: vi.fn(async (query: {
      type?: "fact" | "summary" | "open_loop";
    }) => {
      if (query.type === "summary") {
        return [
          {
            id: "summary-1",
            scope: "chat",
            scopeId: "test",
            type: "summary",
            content: "Alice visited the old tower.",
            importance: 0.6,
            confidence: 1,
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ];
      }

      return [];
    }),
  } as unknown as MemoryStore;
}

async function createFloorWithUserMessage(args: {
  database: DatabaseConnection;
  sessionId: string;
  floorNo: number;
  state: "draft" | "generating" | "committed" | "failed";
  branchId?: string;
  content: string;
}) {
  const now = Date.now();
  const floorId = nanoid();
  const pageId = nanoid();
  const messageId = nanoid();

  await args.database.db.insert(floors).values({
    id: floorId,
    sessionId: args.sessionId,
    floorNo: args.floorNo,
    branchId: args.branchId ?? "main",
    parentFloorId: null,
    state: args.state,
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });

  await args.database.db.insert(messagePages).values({
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

  await args.database.db.insert(messages).values({
    id: messageId,
    pageId,
    seq: 0,
    role: "user",
    content: args.content,
    contentFormat: "text",
    tokenCount: args.content.length,
    isHidden: false,
    source: "api",
    createdAt: now,
  });

  return { floorId, messageId };
}

// ── Tests ─────────────────────────────────────────────

describe("Memory Injection", () => {
  let database: DatabaseConnection;
  let sessionId: string;

  beforeEach(async () => {
    database = createDatabase(":memory:");

    sessionId = nanoid();
    const now = Date.now();
    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Memory Test Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("should inject memory summary into prompt when memoryStore is provided", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    await chatService.respond(sessionId, { message: "Hello" });

    // memoryStore.prepareInjection should be called with sessionId
    expect(memoryStore.prepareInjection).toHaveBeenCalledOnce();
    expect(memoryStore.prepareInjection).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        maxTokens: 500,
        selectionMode: "balanced",
        includeTypes: ["open_loop", "fact", "summary"],
        typeOrder: ["open_loop", "fact", "summary"],
      })
    );

    // The prompt should contain the memory summary
    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const memoryMsg = turnInput.messages.find(
      (m: { role: string; content: string }) => m.content.includes("[Memory Summary]")
    );
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg!.role).toBe("system");
    expect(memoryMsg!.content).toContain("Alice is a brave adventurer.");
  });

  it("should place memory summary after the first system message", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    await chatService.respond(sessionId, { message: "Hello" });

    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const msgs = turnInput.messages;

    // messages[0] = default system prompt
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are a helpful assistant.");

    // messages[1] = memory summary (injected)
    expect(msgs[1].role).toBe("system");
    expect(msgs[1].content).toContain("[Memory Summary]");

    // messages[2] = user message
    expect(msgs[2].role).toBe("user");
    expect(msgs[2].content).toBe("Hello");
  });

  it("should persist summaries via ingestSummaries after respond", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    const result = await chatService.respond(sessionId, { message: "Hello" });

    expect(memoryStore.ingestSummaries).toHaveBeenCalledOnce();
    expect(memoryStore.ingestSummaries).toHaveBeenCalledWith(
      ["Alice met Bob at the tavern."],
      "chat",
      sessionId,
      result.floorId
    );
  });

  it("should NOT inject memory when memoryStore is not provided", async () => {
    const orchestrator = createMockOrchestrator(database);
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter()
      // no memoryStore
    );

    await chatService.respond(sessionId, { message: "Hello" });

    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const memoryMsg = turnInput.messages.find(
      (m: { role: string; content: string }) => m.content.includes("[Memory Summary]")
    );
    expect(memoryMsg).toBeUndefined();

    // Only system + user messages
    expect(turnInput.messages.length).toBe(2);
    expect(turnInput.messages[0].role).toBe("system");
    expect(turnInput.messages[1].role).toBe("user");
  });

  it("should gracefully handle memoryStore.prepareInjection failure", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    (memoryStore.prepareInjection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB connection lost")
    );

    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    // Should not throw, just skip memory injection
    const result = await chatService.respond(sessionId, { message: "Hello" });
    expect(result.generatedText).toBe(MOCK_GENERATED_TEXT);

    // No memory message injected
    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const memoryMsg = turnInput.messages.find(
      (m: { role: string; content: string }) => m.content.includes("[Memory Summary]")
    );
    expect(memoryMsg).toBeUndefined();
  });

  it("should gracefully handle ingestSummaries failure", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    (memoryStore.ingestSummaries as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Write failed")
    );

    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    // Should not throw
    const result = await chatService.respond(sessionId, { message: "Hello" });
    expect(result.generatedText).toBe(MOCK_GENERATED_TEXT);
    expect(result.finalState).toBe("committed");
  });

  it("should pass consolidation context when memory consolidation is enabled", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    await chatService.respond(sessionId, {
      message: "Hello",
      config: {
        enableMemoryConsolidation: true,
      },
    });

    expect(memoryStore.query).toHaveBeenCalledTimes(2);

    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.config.enableMemoryConsolidation).toBe(true);
    expect(turnInput.consolidationContext).toBeDefined();
    expect(turnInput.consolidationContext.currentFloorContent).toBe("Hello");
    expect(turnInput.consolidationContext.recentSummaries).toContain("Alice visited the old tower.");
  });

  it("should pass consolidation context in regenerate flow", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    await createFloorWithUserMessage({
      database,
      sessionId,
      floorNo: 1,
      state: "committed",
      content: "Regenerate me",
    });

    await chatService.regenerate(sessionId, {
      config: {
        enableMemoryConsolidation: true,
      },
    });

    expect(memoryStore.query).toHaveBeenCalledTimes(2);
    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.consolidationContext?.currentFloorContent).toBe("Regenerate me");
    expect(turnInput.consolidationContext?.recentSummaries).toContain("Alice visited the old tower.");
  });

  it("should pass consolidation context in retry flow", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    const { floorId } = await createFloorWithUserMessage({
      database,
      sessionId,
      floorNo: 2,
      state: "failed",
      content: "Retry me",
    });

    await chatService.retryFloor(floorId, {
      config: {
        enableMemoryConsolidation: true,
      },
    });

    expect(memoryStore.query).toHaveBeenCalledTimes(2);
    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.consolidationContext?.currentFloorContent).toBe("Retry me");
    expect(turnInput.consolidationContext?.recentSummaries).toContain("Alice visited the old tower.");
  });

  it("should pass consolidation context in edit-and-regenerate flow", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    const { messageId } = await createFloorWithUserMessage({
      database,
      sessionId,
      floorNo: 3,
      state: "committed",
      content: "Original input",
    });

    await chatService.editAndRegenerate(messageId, {
      content: "Edited input",
      branchId: "branch-edit",
      config: {
        enableMemoryConsolidation: true,
      },
    });

    expect(memoryStore.query).toHaveBeenCalledTimes(2);
    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.consolidationContext?.currentFloorContent).toBe("Edited input");
    expect(turnInput.consolidationContext?.recentSummaries).toContain("Alice visited the old tower.");
  });

  it("should skip ingestSummaries when turnOutput has no summaries", async () => {
    const database2 = createDatabase(":memory:");

    // Create orchestrator that returns empty summaries
    const orchestrator = {
      executeTurn: vi.fn(async (input: TurnInput) => {
        await database2.db
          .update(floors)
          .set({ state: "committed", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        return {
          floorId: input.floorId,
          generatedText: MOCK_GENERATED_TEXT,
          rawText: MOCK_GENERATED_TEXT,
          summaries: [],
          totalUsage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
          finalState: "committed",
        } satisfies TurnOutput;
      }),
    } as unknown as TurnOrchestrator;

    const memoryStore = createMockMemoryStore();

    const sid = nanoid();
    await database2.db.insert(sessions).values({
      id: sid,
      title: "No Summary Session",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const chatService = new ChatService(
      database2.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    await chatService.respond(sid, { message: "Hello" });

    // prepareInjection is called, but ingestSummaries is NOT called
    expect(memoryStore.prepareInjection).toHaveBeenCalledOnce();
    expect(memoryStore.ingestSummaries).not.toHaveBeenCalled();

    database2.close();
  });
});
