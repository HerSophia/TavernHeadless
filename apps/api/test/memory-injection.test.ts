/**
 * Memory Injection Tests
 *
 * 验证摘要注入链路：
 * PromptAssembler 记忆注入位置
 * - ChatService 带 MemoryStore 的 respond 流程
 * - 禁用记忆时行为不变
 * - 摘要持久化
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { buildBranchMemoryScopeId } from "@tavern/shared";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { branchLocalVariableSnapshots, floors, memoryItems, messagePages, messages, sessions } from "../src/db/schema";
import { DrizzleMemoryRepository } from "../src/adapters/drizzle-memory-repository";
import { ChatService } from "../src/services/chat-service";
import type { TurnCommitService } from "../src/services/turn-commit-service";
import {
  createEventBus,
  MemoryStore as CoreMemoryStore,
  SimpleTokenCounter,
  type MemoryStore,
  type TurnOrchestrator,
  type TurnOutput,
  type TurnInput,
} from "@tavern/core";

const MOCK_GENERATED_TEXT = "The memory system is working.";

function createMockOrchestrator(database: DatabaseConnection) {
  return {
    executeTurn: vi.fn(async (input: TurnInput) => {
      await database.db
        .update(floors)
        .set({ state: "generating", updatedAt: Date.now() })
        .where(eq(floors.id, input.floorId));

      return {
        floorId: input.floorId,
        generatedText: MOCK_GENERATED_TEXT,
        rawText: MOCK_GENERATED_TEXT,
        summaries: ["Alice met Bob at the tavern."],
        totalUsage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
        finalState: "generating",
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
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
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

    expect(memoryStore.prepareInjection).toHaveBeenCalledOnce();
    expect(memoryStore.prepareInjection).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        accountId: "default-admin",
        maxTokens: 500,
        selectionMode: "balanced",
        includeTypes: ["open_loop", "fact", "summary"],
        typeOrder: ["open_loop", "fact", "summary"],
        scopeContext: expect.objectContaining({
          accountId: "default-admin",
          sessionId,
          floorId: expect.any(String),
        }),
      })
    );

    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const memoryMsg = turnInput.messages.find(
      (m: { role: string; content: string }) => m.content.includes("[Memory]")
    );
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg!.role).toBe("system");
    expect(memoryMsg!.content).toContain("Alice is a brave adventurer.");
  });

  it("should switch to dual-summary injection when the Phase 4 flag is enabled", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    (memoryStore.prepareInjection as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      formattedText: [
        "[Memory Facts]",
        "- alliance_status: cautious allies",
        "",
        "[Open Loops]",
        "- Can the guide be trusted?",
        "",
        "[Recent Micro Summaries]",
        "- Alice and Bob found the map.",
        "",
        "[Macro Summary]",
        "- Alice entered the city and began tracking the archive.",
      ].join("\n"),
      tokenCount: 40,
    });
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore, enableDualSummaryInjection: true }
    );

    await chatService.respond(sessionId, { message: "Hello" });

    const injectionOptions = (memoryStore.prepareInjection as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(injectionOptions).toEqual(expect.objectContaining({
      strategy: "dual_summary",
      maxTokens: 500,
      maxItems: 24,
      includeTypes: ["open_loop", "fact", "summary"],
      scopeContext: expect.objectContaining({
        accountId: "default-admin",
        sessionId,
        floorId: expect.any(String),
      }),
    }));

    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const memoryMsg = turnInput.messages.find(
      (m: { role: string; content: string }) => m.content.includes("[Memory Facts]")
    );
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg!.content).toContain("[Recent Micro Summaries]");
    expect(memoryMsg!.content).toContain("[Macro Summary]");
  });

  it("should persist summaries via TurnCommitService inside DB transaction", async () => {
    const orchestrator = createMockOrchestrator(database);
    const turnCommitService = {
      commit: vi.fn(async () => ({
        floorId: "f1",
        outputPageId: "p1",
        assistantMessageId: "m1",
        finalState: "committed" as const,
        usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
      })),
    } as unknown as TurnCommitService;

    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore, turnCommitService }
    );

    await chatService.respond(sessionId, {
      message: "Hello",
      config: { enableMemoryConsolidation: false },
    });

    expect(turnCommitService.commit).toHaveBeenCalledOnce();
    expect(turnCommitService.commit).toHaveBeenCalledWith(expect.objectContaining({
      memoryCommit: expect.objectContaining({
        summaries: ["Alice met Bob at the tavern."],
        enableConsolidation: false,
        consolidationOutput: undefined,
      }),
    }));
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

    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are a helpful assistant.");

    expect(msgs[1].role).toBe("system");
    expect(msgs[1].content).toContain("[Memory]");

    expect(msgs[2].role).toBe("user");
    expect(msgs[2].content).toBe("Hello");
  });

  it("should persist summary memories inside the commit boundary after respond", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    const result = await chatService.respond(sessionId, { message: "Hello" });

    const rows = await database.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.sourceFloorId, result.floorId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "branch",
      scopeId: buildBranchMemoryScopeId(sessionId, "main"),
      type: "summary",
      status: "active",
      sourceFloorId: result.floorId,
    });
    expect(JSON.parse(rows[0]!.contentJson)).toBe("Alice met Bob at the tavern.");
    expect(memoryStore.ingestSummaries).not.toHaveBeenCalled();
  });

  it("should NOT inject memory when memoryStore is not provided", async () => {
    const orchestrator = createMockOrchestrator(database);
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter()
    );

    await chatService.respond(sessionId, { message: "Hello" });

    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const memoryMsg = turnInput.messages.find(
      (m: { role: string; content: string }) => m.content.includes("[Memory]")
    );
    expect(memoryMsg).toBeUndefined();

    expect(turnInput.messages.length).toBe(2);
    expect(turnInput.messages[0].role).toBe("system");
    expect(turnInput.messages[1].role).toBe("user");

    const rows = await database.db.select().from(memoryItems);
    expect(rows).toEqual([]);
  });

  it("should gracefully handle memoryStore.prepareInjection failure", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    (memoryStore.prepareInjection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB connection lost")
    );
    const eventBus = createEventBus();
    const injectionFailedHandler = vi.fn();
    eventBus.on("memory.injection_failed", injectionFailedHandler);

    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore, eventBus }
    );

    const result = await chatService.respond(sessionId, { message: "Hello" });
    expect(result.generatedText).toBe(MOCK_GENERATED_TEXT);
    expect(injectionFailedHandler).toHaveBeenCalledOnce();
    expect(injectionFailedHandler).toHaveBeenCalledWith(expect.objectContaining({ sessionId, error: expect.any(Error) }));

    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const memoryMsg = turnInput.messages.find(
      (m: { role: string; content: string }) => m.content.includes("[Memory]")
    );
    expect(memoryMsg).toBeUndefined();

    const rows = await database.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.sourceFloorId, result.floorId));
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.contentJson)).toBe("Alice met Bob at the tavern.");
  });

  it("should persist consolidation memories inside the commit boundary", async () => {
    const orchestrator = {
      executeTurn: vi.fn(async (input: TurnInput) => {
        await database.db
          .update(floors)
          .set({ state: "generating", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        return {
          floorId: input.floorId,
          generatedText: MOCK_GENERATED_TEXT,
          rawText: MOCK_GENERATED_TEXT,
          summaries: ["Alice met Bob at the tavern."],
          totalUsage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
          finalState: "generating",
          consolidationResult: {
            output: {
              turnSummary: "Alice and Bob became allies.",
              factsAdd: [{ key: "relationship", value: "Alice and Bob are allies", scope: "chat" }],
              factsUpdate: [],
              factsDeprecate: [],
            },
            usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          },
        } satisfies TurnOutput;
      }),
    } as unknown as TurnOrchestrator;

    const memoryStore = createMockMemoryStore();

    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    const result = await chatService.respond(sessionId, {
      message: "Hello",
      config: {
        enableMemoryConsolidation: true,
      },
    });

    const rows = await database.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.sourceFloorId, result.floorId));

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => JSON.parse(row.contentJson))).toEqual(expect.arrayContaining([
      "Alice met Bob at the tavern.",
      "Alice and Bob became allies.",
      "relationship: Alice and Bob are allies",
    ]));
    const factRow = rows.find((row) => row.type === "fact");
    expect(factRow?.factKey).toBe("relationship");
  });

  it("should emit memory.consolidation_context_failed and continue when context loading fails", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = createMockMemoryStore();
    (memoryStore.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("summary lookup failed"));
    const eventBus = createEventBus();
    const contextFailedHandler = vi.fn();
    eventBus.on("memory.consolidation_context_failed", contextFailedHandler);

    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore, eventBus }
    );

    const result = await chatService.respond(sessionId, {
      message: "Hello",
      config: {
        enableMemoryConsolidation: true,
      },
    });

    expect(result.generatedText).toBe(MOCK_GENERATED_TEXT);
    expect(contextFailedHandler).toHaveBeenCalledOnce();
    expect(contextFailedHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      error: expect.any(Error),
    }));

    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.consolidationContext).toBeUndefined();
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
      state: "committed",
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

    const { floorId, messageId } = await createFloorWithUserMessage({
      database,
      sessionId,
      floorNo: 3,
      state: "committed",
      content: "Original input",
    });
    await database.db.insert(branchLocalVariableSnapshots).values({
      floorId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      valuesJson: "{}",
      createdAt: Date.now(),
    }).onConflictDoNothing();

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

  it("should expose global chat and floor memory scopes to retry prompt assembly and consolidation context", async () => {
    const orchestrator = createMockOrchestrator(database);
    const memoryStore = new CoreMemoryStore(
      new DrizzleMemoryRepository(database.db),
      createEventBus(),
      new SimpleTokenCounter(),
    );
    const chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    const { floorId } = await createFloorWithUserMessage({
      database,
      sessionId,
      floorNo: 4,
      state: "committed",
      content: "Retry scope visibility",
    });

    await memoryStore.create({
      scope: "global",
      scopeId: "default-admin",
      type: "fact",
      content: "Global reminder",
      importance: 0.9,
      confidence: 1,
      status: "active",
    });
    await memoryStore.create({
      scope: "branch",
      scopeId: buildBranchMemoryScopeId(sessionId, "main"),
      type: "summary",
      content: "Branch summary entry",
      importance: 0.8,
      confidence: 1,
      status: "active",
    });
    await memoryStore.create({
      scope: "floor",
      scopeId: floorId,
      type: "fact",
      content: "Floor-local clue",
      importance: 0.7,
      confidence: 1,
      status: "active",
    });

    await chatService.retryFloor(floorId, { config: { enableMemoryConsolidation: true } });

    const turnInput = (orchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const memoryMsg = turnInput.messages.find((m: { role: string; content: string }) => m.content.includes("[Memory]"));

    expect(memoryMsg?.content).toContain("Global reminder");
    expect(memoryMsg?.content).toContain("Branch summary entry");
    expect(memoryMsg?.content).toContain("Floor-local clue");
    expect(turnInput.consolidationContext?.recentSummaries).toEqual(expect.arrayContaining(["Branch summary entry"]));
    expect(turnInput.consolidationContext?.existingFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "global", content: "Global reminder" }),
      expect.objectContaining({ scope: "floor", content: "Floor-local clue" }),
    ]));
  });

  it("should skip memory writes when turn output has no summaries", async () => {
    const database2 = createDatabase(":memory:");

    const orchestrator = {
      executeTurn: vi.fn(async (input: TurnInput) => {
        await database2.db
          .update(floors)
          .set({ state: "generating", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        return {
          floorId: input.floorId,
          generatedText: MOCK_GENERATED_TEXT,
          rawText: MOCK_GENERATED_TEXT,
          summaries: [],
          totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finalState: "generating",
        } satisfies TurnOutput;
      }),
    } as unknown as TurnOrchestrator;

    const now = Date.now();
    const sessionId2 = nanoid();
    await database2.db.insert(sessions).values({
      id: sessionId2,
      title: "No Summary Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const memoryStore = createMockMemoryStore();
    const chatService = new ChatService(
      database2.db,
      orchestrator,
      new SimpleTokenCounter(),
      { memoryStore }
    );

    const result = await chatService.respond(sessionId2, { message: "Hello" });

    const rows = await database2.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.sourceFloorId, result.floorId));
    expect(rows).toHaveLength(0);

    database2.close();
  });
});
