/**
 * Chat Flow Integration Tests
 *
 * 测试 POST /sessions/:id/respond 和 /regenerate 全链路：
 * - 真实 DB（:memory:）
 * - Mock LLM（通过自定义 Provider Factory）
 * - 验证数据落库正确性
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";
import type { OrchestrationConfig } from "../src/services/orchestration-factory";
import type { ProviderConfig, ProviderFactory } from "@tavern/core";

// ── Mock LLM Setup ────────────────────────────────────

/**
 * 创建一个 Mock Provider Factory，返回固定文本的 LanguageModel。
 *
 * 这里不需要真正的 Vercel AI SDK LanguageModel，
 * 而是通过注册自定义工厂 + 拦截 ProviderRegistry 来实现。
 *
 * 但由于 ProviderRegistry 调用真实的 SDK factory，
 * 我们需要直接 mock LLMService 层面的行为。
 *
 * 更实际的方案：我们自己构建 buildApp 所需的 orchestration config，
 * 使用一个始终返回固定文本的 mock provider。
 */

// 由于 ProviderRegistry 需要真实 @ai-sdk/* 包，
// 而我们测试环境不一定安装了它们，
// 我们采用更底层的方式：直接 mock 整个 orchestration，
// 只测试路由层 + ChatService 的 DB 逻辑。

import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { sessions, floors, messagePages, messages, promptSnapshots, toolExecutionRecords, variables } from "../src/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { nanoid } from "nanoid";

// ── 辅助函数 ──────────────────────────────────────────

type ItemResponse<T> = { data: T };

interface RespondResponse {
  floor_id: string;
  floor_no: number;
  generated_text: string;
  summaries: string[];
  total_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  final_state: string;
}

// ── Tests ─────────────────────────────────────────────

describe("POST /sessions/:id/respond", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection;

  beforeEach(async () => {
    // 我们不使用 orchestration 配置（需要真实 LLM），
    // 而是直接 mock ChatService 并手动注册路由。
    // 但为了真正测试集成链路，我们使用一个轻量方案：
    // 直接通过 buildApp（无 orchestration）+ inject 测试路由注册逻辑。
    //
    // 更好的方案：测试 ChatService 类本身。
    database = createDatabase(":memory:");
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe("route registration (without orchestration)", () => {
    it("should return 404 when chat routes are not enabled", async () => {
      // 先创建一个 session
      const createRes = await app.inject({
        method: "POST",
        url: "/sessions",
        payload: { title: "Test Session" },
      });
      const sessionId = (createRes.json() as ItemResponse<{ id: string }>).data.id;

      // 尝试调用 /respond（未启用 orchestration）
      const res = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/respond`,
        payload: { message: "Hello" },
      });

      // 路由不存在，Fastify 返回 404
      expect(res.statusCode).toBe(404);
    });
  });
});

// ── ChatService 单元测试 ──────────────────────────────

import { ChatService, ChatServiceError } from "../src/services/chat-service";
import {
  createEventBus,
  LLMTimeoutError,
  SimpleTokenCounter,
  type TurnOrchestrator,
  type TurnOutput,
} from "@tavern/core";

describe("ChatService", () => {
  let database: DatabaseConnection;
  let mockOrchestrator: TurnOrchestrator;
  let chatService: ChatService;
  let sessionId: string;

  const MOCK_GENERATED_TEXT = "Once upon a time, there was a brave knight.";
  const MOCK_TURN_OUTPUT: TurnOutput = {
    floorId: "", // will be filled by orchestrator
    generatedText: MOCK_GENERATED_TEXT,
    rawText: MOCK_GENERATED_TEXT,
    summaries: ["A brave knight appeared."],
    totalUsage: {
      promptTokens: 50,
      completionTokens: 20,
      totalTokens: 70,
    },
    finalState: "generating",
  };

  beforeEach(async () => {
    database = createDatabase(":memory:");

    // 创建 mock orchestrator
    mockOrchestrator = {
      executeTurn: vi.fn(async (input) => {
        // 模拟状态转移：直接更新 DB 中的 floor state
        // 实际的 TurnOrchestrator 会通过 FloorStateMachine 做，
        // 但这里我们 mock 整个 orchestrator，只需返回结果
        const { db } = database;
        const { floors } = await import("../src/db/schema");
        const { eq } = await import("drizzle-orm");

        await db
          .update(floors)
          .set({ state: "generating", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        return {
          ...MOCK_TURN_OUTPUT,
          floorId: input.floorId,
          toolExecutionRecords: [
            {
              id: `tec-${input.floorId}`,
              runId: `run-${input.floorId}`,
              floorId: input.floorId,
              pageId: input.pageId,
              callerSlot: "narrator",
              providerId: "builtin",
              toolName: "roll_dice",
              argsJson: JSON.stringify({ sides: 20 }),
              resultJson: JSON.stringify({ total: 12 }),
              status: "success",
              durationMs: 5,
              createdAt: Date.now(),
            },
          ],
        };
      }),
    } as unknown as TurnOrchestrator;

    const tokenCounter = new SimpleTokenCounter();
    chatService = new ChatService(database.db, mockOrchestrator, tokenCounter);

    // 创建测试会话
    sessionId = nanoid();
    const now = Date.now();
    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Test Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    database.close();
  });

  // ── respond 测试 ────────────────────────────────────

  it("should create floor, save user message, call orchestrator, and save assistant message", async () => {
    const result = await chatService.respond(sessionId, {
      message: "Hello, brave knight!",
    });

    // 验证返回值
    expect(result.floorId).toBeDefined();
    expect(result.floorNo).toBe(0);
    expect(result.generatedText).toBe(MOCK_GENERATED_TEXT);
    expect(result.summaries).toEqual(["A brave knight appeared."]);
    expect(result.totalUsage.totalTokens).toBe(70);
    expect(result.finalState).toBe("committed");
    expect(result.branchId).toBe("main");

    // 验证 orchestrator 被调用
    expect(mockOrchestrator.executeTurn).toHaveBeenCalledOnce();
    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.sessionId).toBe(sessionId);
    expect(turnInput.floorId).toBe(result.floorId);
    // 无预设时会插入默认 system prompt
    expect(turnInput.messages[0]).toEqual(
      { role: "system", content: "You are a helpful assistant." }
    );
    expect(turnInput.messages[1]).toEqual(
      { role: "user", content: "Hello, brave knight!" }
    );

    // 验证 DB 中的 floor
    const [floor] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.id, result.floorId));
    expect(floor).toBeDefined();
    expect(floor!.sessionId).toBe(sessionId);
    expect(floor!.floorNo).toBe(0);
    expect(floor!.state).toBe("committed");
    expect(floor!.tokenIn).toBe(50);
    expect(floor!.tokenOut).toBe(20);

    // 验证 DB 中的用户消息
    const allPages = await database.db
      .select()
      .from(messagePages)
      .where(eq(messagePages.floorId, result.floorId));
    expect(allPages.length).toBe(2); // input page + output page

    const inputPage = allPages.find((p) => p.pageKind === "input");
    expect(inputPage).toBeDefined();

    const [userMsg] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.pageId, inputPage!.id));
    expect(userMsg).toBeDefined();
    expect(userMsg!.role).toBe("user");
    expect(userMsg!.content).toBe("Hello, brave knight!");
    expect(turnInput.pageId).toBe(inputPage!.id);

    // 验证 DB 中的助手消息
    const outputPage = allPages.find((p) => p.pageKind === "output");
    expect(outputPage).toBeDefined();

    const [assistantMsg] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.pageId, outputPage!.id));
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.role).toBe("assistant");
    expect(assistantMsg!.content).toBe(MOCK_GENERATED_TEXT);
    expect(assistantMsg!.source).toBe("narrator");
  });

  it("should pass a generating execution result into the commit service", async () => {
    const commitSpy = vi.spyOn((chatService as any).turnCommitService, "commit");

    await chatService.respond(sessionId, { message: "Commit boundary" });

    expect(commitSpy).toHaveBeenCalledOnce();
    expect(commitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        variableCommit: { pageId: expect.any(String) },
        promptSnapshot: expect.objectContaining({
          sessionId,
          promptMode: "compat_strict",
          presetId: null,
        }),
        toolExecutionRecords: [
          expect.objectContaining({
            floorId: expect.any(String),
            providerId: "builtin",
            toolName: "roll_dice",
            status: "success",
          }),
        ],
        execution: expect.objectContaining({
          finalState: "generating",
          generatedText: MOCK_GENERATED_TEXT,
          toolExecutionRecords: [
            expect.objectContaining({
              providerId: "builtin",
              toolName: "roll_dice",
            }),
          ],
        }),
      })
    );
  });

  it("should persist tool_execution_record inside the commit boundary after respond", async () => {
    const result = await chatService.respond(sessionId, { message: "Record boundary" });

    const [toolExecutionRow] = await database.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.floorId, result.floorId));

    expect(toolExecutionRow).toBeDefined();
    expect(toolExecutionRow!.floorId).toBe(result.floorId);
    expect(toolExecutionRow!.pageId).not.toBeNull();
    expect(toolExecutionRow!.providerId).toBe("builtin");
    expect(toolExecutionRow!.toolName).toBe("roll_dice");
    expect(toolExecutionRow!.status).toBe("success");
  });

  it("should persist prompt_snapshot inside the commit boundary after respond", async () => {
    const result = await chatService.respond(sessionId, { message: "Snapshot boundary" });

    const [snapshotRow] = await database.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, result.floorId));

    expect(snapshotRow).toBeDefined();
    expect(snapshotRow!.sessionId).toBe(sessionId);
    expect(snapshotRow!.presetId).toBeNull();
    expect(snapshotRow!.promptMode).toBe("compat_strict");
    expect(snapshotRow!.promptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshotRow!.tokenEstimate).toBeGreaterThan(0);
  });

  it("should promote page variables to floor inside the commit boundary after respond", async () => {
    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (input) => {
        await database.db
          .update(floors)
          .set({ state: "generating", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        await database.db.insert(variables).values({
          id: nanoid(),
          scope: "page",
          scopeId: input.pageId!,
          key: "mood",
          valueJson: JSON.stringify("focused"),
          updatedAt: Date.now(),
        });

        return {
          ...MOCK_TURN_OUTPUT,
          floorId: input.floorId,
        };
      }
    );

    const result = await chatService.respond(sessionId, { message: "Promote mood" });

    const [floorVariable] = await database.db
      .select()
      .from(variables)
      .where(
        and(
          eq(variables.scope, "floor"),
          eq(variables.scopeId, result.floorId),
          eq(variables.key, "mood")
        )
      );

    expect(floorVariable).toBeDefined();
    expect(JSON.parse(floorVariable!.valueJson)).toBe("focused");
  });

  it("should reject concurrent respond calls on the same session branch", async () => {
    let releaseGeneration: (() => void) | undefined;
    let enteredGeneration = false;

    const blockingOrchestrator = {
      executeTurn: vi.fn(async (input) => {
        enteredGeneration = true;

        await new Promise<void>((resolve) => {
          releaseGeneration = resolve;
        });

        await database.db
          .update(floors)
          .set({ state: "generating", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        return {
          ...MOCK_TURN_OUTPUT,
          floorId: input.floorId,
        };
      }),
    } as unknown as TurnOrchestrator;

    const service = new ChatService(database.db, blockingOrchestrator, new SimpleTokenCounter());

    const firstPromise = service.respond(sessionId, { message: "First message" });
    for (let i = 0; i < 50 && !enteredGeneration; i += 1) {
      await Promise.resolve();
    }

    await expect(service.respond(sessionId, { message: "Second message" })).rejects.toMatchObject({
      code: "generation_conflict",
    });

    releaseGeneration?.();
    await expect(firstPromise).resolves.toMatchObject({ generatedText: MOCK_GENERATED_TEXT });
    expect(blockingOrchestrator.executeTurn).toHaveBeenCalledTimes(1);
  });

  it("should resolve per-turn model override and mark profile as used", async () => {
    const resolvedModel = {
      model: { providerId: "llm-profile-p1", modelId: "gpt-4o-mini" },
      source: "session_profile" as const,
      profileId: "p1",
    };
    const resolveTurnModel = vi.fn().mockResolvedValue(resolvedModel);
    const onTurnModelUsed = vi.fn().mockResolvedValue(undefined);

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      resolveTurnModel,
      onTurnModelUsed,
    });

    await service.respond(sessionId, { message: "Use profile model" });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.modelOverrides).toEqual({ narrator: resolvedModel.model });
    expect(resolveTurnModel).toHaveBeenCalledWith(sessionId, "default-admin");
    expect(onTurnModelUsed).toHaveBeenCalledWith(resolvedModel, "default-admin");
  });

  it("should fallback to orchestrator default model when runtime resolver returns null", async () => {
    const resolveTurnModel = vi.fn().mockResolvedValue(null);
    const onTurnModelUsed = vi.fn().mockResolvedValue(undefined);

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      resolveTurnModel,
      onTurnModelUsed,
    });

    await service.respond(sessionId, { message: "Use fallback model" });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.modelOverrides).toBeUndefined();
    expect(onTurnModelUsed).not.toHaveBeenCalled();
  });

  it("should reject cross-account respond access", async () => {
    await expect(
      chatService.respond(
        sessionId,
        { message: "cross-account" },
        {},
        "acc-other"
      )
    ).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("should reject cross-account regenerate access", async () => {
    await chatService.respond(sessionId, { message: "seed" });

    await expect(
      chatService.regenerate(
        sessionId,
        {},
        "acc-other"
      )
    ).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("should reject cross-account retryFloor access", async () => {
    const result = await chatService.respond(sessionId, { message: "seed" });

    await database.db
      .update(floors)
      .set({ state: "failed", updatedAt: Date.now() })
      .where(eq(floors.id, result.floorId));

    await expect(
      chatService.retryFloor(
        result.floorId,
        {},
        "acc-other"
      )
    ).rejects.toMatchObject({ code: "floor_not_found" });
  });

  it("should reject cross-account edit-and-regenerate access", async () => {
    const result = await chatService.respond(sessionId, { message: "seed" });

    const [inputPage] = await database.db
      .select({ id: messagePages.id })
      .from(messagePages)
      .where(and(eq(messagePages.floorId, result.floorId), eq(messagePages.pageKind, "input")));

    const [sourceMessage] = await database.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.pageId, inputPage!.id), eq(messages.role, "user")));

    await expect(
      chatService.editAndRegenerate(sourceMessage!.id, { content: "edited" }, "acc-other")
    ).rejects.toMatchObject({ code: "message_not_found" });
  });

  it("should increment floor_no for multiple rounds", async () => {
    const result1 = await chatService.respond(sessionId, { message: "First message" });
    expect(result1.floorNo).toBe(0);

    const result2 = await chatService.respond(sessionId, { message: "Second message" });
    expect(result2.floorNo).toBe(1);

    const result3 = await chatService.respond(sessionId, { message: "Third message" });
    expect(result3.floorNo).toBe(2);
  });

  it("should include committed history in subsequent messages", async () => {
    // 第一轮
    await chatService.respond(sessionId, { message: "Hello" });

    // 第二轮
    await chatService.respond(sessionId, { message: "How are you?" });

    // 验证第二轮的 turnInput 包含历史
    const calls = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);

    const secondTurnInput = calls[1]![0];
    // 第二轮应包含：
    // [0] system: 默认 system prompt
    // [1] user: "Hello" (来自第一轮 committed 历史)
    // [2] assistant: "Once upon a time..." (来自第一轮 committed 历史)
    // [3] user: "How are you?" (当前用户输入)
    expect(secondTurnInput.messages.length).toBe(4);
    expect(secondTurnInput.messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
    expect(secondTurnInput.messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(secondTurnInput.messages[2]).toEqual({ role: "assistant", content: MOCK_GENERATED_TEXT });
    expect(secondTurnInput.messages[3]).toEqual({ role: "user", content: "How are you?" });
  });

  it("should optionally limit history to recent floors", async () => {
    const limitedChatService = new ChatService(
      database.db,
      mockOrchestrator,
      new SimpleTokenCounter(),
      { historyMaxFloors: 1 }
    );

    await limitedChatService.respond(sessionId, { message: "First" });
    await limitedChatService.respond(sessionId, { message: "Second" });
    await limitedChatService.respond(sessionId, { message: "Third" });

    const calls = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);

    const thirdTurnInput = calls[2]![0];
    expect(thirdTurnInput.messages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Second" },
      { role: "assistant", content: MOCK_GENERATED_TEXT },
      { role: "user", content: "Third" },
    ]);
  });

  it("should throw session_not_found for non-existent session", async () => {
    await expect(
      chatService.respond("non-existent-session", { message: "Hello" })
    ).rejects.toThrow(ChatServiceError);

    try {
      await chatService.respond("non-existent-session", { message: "Hello" });
    } catch (error) {
      expect(error).toBeInstanceOf(ChatServiceError);
      expect((error as ChatServiceError).code).toBe("session_not_found");
    }
  });

  it("should throw session_archived for archived session", async () => {
    // 归档会话
    await database.db
      .update(sessions)
      .set({ status: "archived" })
      .where(eq(sessions.id, sessionId));

    await expect(
      chatService.respond(sessionId, { message: "Hello" })
    ).rejects.toThrow(ChatServiceError);

    try {
      await chatService.respond(sessionId, { message: "Hello" });
    } catch (error) {
      expect(error).toBeInstanceOf(ChatServiceError);
      expect((error as ChatServiceError).code).toBe("session_archived");
    }
  });

  it("should throw orchestration_failed when orchestrator fails", async () => {
    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("LLM timeout")
    );

    await expect(
      chatService.respond(sessionId, { message: "Hello" })
    ).rejects.toThrow(ChatServiceError);

    try {
      await chatService.respond(sessionId, { message: "Hello" });
    } catch (error) {
      expect(error).toBeInstanceOf(ChatServiceError);
      expect((error as ChatServiceError).code).toBe("orchestration_failed");
    }
  });

  it("should map LLM timeout to generation_timeout and mark the floor failed", async () => {
    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new LLMTimeoutError(1_234)
    );

    await expect(chatService.respond(sessionId, { message: "Hello" })).rejects.toMatchObject({
      code: "generation_timeout",
    });

    const [floor] = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    expect(floor?.state).toBe("failed");
  });

  it("should throw commit_conflict when the floor is no longer generating before commit", async () => {
    const conflictingOrchestrator = {
      executeTurn: vi.fn(async (input) => {
        await database.db
          .update(floors)
          .set({ state: "committed", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        return {
          ...MOCK_TURN_OUTPUT,
          floorId: input.floorId,
        };
      }),
    } as unknown as TurnOrchestrator;

    const service = new ChatService(database.db, conflictingOrchestrator, new SimpleTokenCounter());

    await expect(service.respond(sessionId, { message: "Conflict me" })).rejects.toMatchObject({
      code: "commit_conflict",
    });

    const [floor] = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    expect(floor?.state).toBe("committed");

    const pages = await database.db.select().from(messagePages).where(eq(messagePages.floorId, floor!.id));
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageKind).toBe("input");
  });

  it("should mark the floor failed when commit persistence fails unexpectedly", async () => {
    const commitSpy = vi
      .spyOn((chatService as any).turnCommitService, "commit")
      .mockRejectedValueOnce(new Error("sqlite busy"));

    await expect(chatService.respond(sessionId, { message: "Commit failure" })).rejects.toMatchObject({
      code: "turn_commit_failed",
    });

    expect(commitSpy).toHaveBeenCalledOnce();

    const [floor] = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    expect(floor?.state).toBe("failed");

    const pages = await database.db.select().from(messagePages).where(eq(messagePages.floorId, floor!.id));
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageKind).toBe("input");
  });

  it("should retry commit on SQLITE_BUSY and eventually succeed", async () => {
    const eventBus = createEventBus();
    const retryHandler = vi.fn();
    const succeededAfterRetryHandler = vi.fn();
    eventBus.on("commit.retry", retryHandler);
    eventBus.on("commit.succeeded_after_retry", succeededAfterRetryHandler);

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      eventBus,
      executionPolicy: {
        commitRetry: { maxRetries: 1, baseDelayMs: 1 },
      },
    });

    const turnCommitService = (service as any).turnCommitService;
    const originalCommit = turnCommitService.commit.bind(turnCommitService);
    const busyError = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    const commitSpy = vi.spyOn(turnCommitService, "commit")
      .mockImplementationOnce(async () => {
        throw busyError;
      })
      .mockImplementation(async (input) => originalCommit(input));

    const result = await service.respond(sessionId, { message: "Retry commit" });

    expect(result.finalState).toBe("committed");
    expect(commitSpy).toHaveBeenCalledTimes(2);

    const [floor] = await database.db.select().from(floors).where(eq(floors.id, result.floorId));

    expect(floor?.state).toBe("committed");
    expect(retryHandler).toHaveBeenCalledOnce();
    expect(retryHandler.mock.calls[0]?.[0]).toMatchObject({
      sessionId,
      branchId: result.branchId,
      floorId: result.floorId,
      attempt: 1,
      backoffMs: 1,
      message: "database is locked",
    });
    expect(succeededAfterRetryHandler).toHaveBeenCalledOnce();
    expect(succeededAfterRetryHandler.mock.calls[0]?.[0]).toMatchObject({
      sessionId,
      branchId: result.branchId,
      floorId: result.floorId,
      attempts: 2,
    });
  });

  it("should return commit_busy after SQLITE_BUSY retries are exhausted", async () => {
    const eventBus = createEventBus();
    const retryHandler = vi.fn();
    const commitBusyHandler = vi.fn();
    eventBus.on("commit.retry", retryHandler);
    eventBus.on("commit.busy", commitBusyHandler);

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      eventBus,
      executionPolicy: {
        commitRetry: { maxRetries: 1, baseDelayMs: 1 },
      },
    });

    const busyError = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    const commitSpy = vi.spyOn((service as any).turnCommitService, "commit").mockRejectedValue(busyError);

    await expect(service.respond(sessionId, { message: "Busy commit" })).rejects.toMatchObject({
      code: "commit_busy",
    });

    expect(commitSpy).toHaveBeenCalledTimes(2);

    const [floor] = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    expect(floor?.state).toBe("failed");

    const pages = await database.db.select().from(messagePages).where(eq(messagePages.floorId, floor!.id));

    expect(retryHandler).toHaveBeenCalledOnce();
    expect(retryHandler.mock.calls[0]?.[0]).toMatchObject({
      sessionId,
      branchId: floor?.branchId,
      floorId: floor?.id,
      attempt: 1,
      backoffMs: 1,
      message: "database is locked",
    });
    expect(commitBusyHandler).toHaveBeenCalledOnce();
    expect(commitBusyHandler.mock.calls[0]?.[0]).toMatchObject({
      sessionId,
      branchId: floor?.branchId,
      floorId: floor?.id,
      attempts: 2,
      message: "database is locked",
    });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageKind).toBe("input");
  });


  it("should pass generation params to orchestrator", async () => {
    await chatService.respond(sessionId, {
      message: "Hello",
      generationParams: {
        temperature: 0.9,
        maxOutputTokens: 2000,
      },
    });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.generationParams.temperature).toBe(0.9);
    expect(turnInput.generationParams.maxOutputTokens).toBe(2000);
  });

  it("should pass turn config to orchestrator", async () => {
    await chatService.respond(sessionId, {
      message: "Hello",
      config: {
        enableDirector: true,
        enableVerifier: true,
        verifierFailStrategy: "retry",
        maxRetries: 2,
      },
    });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.config).toEqual({
      enableDirector: true,
      enableVerifier: true,
      verifierFailStrategy: "retry",
      maxRetries: 2,
    });
  });

  it("should use default generation params when not specified", async () => {
    await chatService.respond(sessionId, { message: "Hello" });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const tokenCounter = new SimpleTokenCounter();
    const expectedPromptTokens = turnInput.messages.reduce(
      (sum: number, message: { content: string }) => sum + tokenCounter.count(message.content),
      0
    );

    expect(turnInput.generationParams.temperature).toBe(0.7);
    expect(turnInput.generationParams.maxOutputTokens).toBe(1000 - expectedPromptTokens);
    expect(turnInput.generationParams.stream).toBe(false);
  });

  it("should apply server default timeoutMs when not specified", async () => {
    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      executionPolicy: {
        executionTimeoutMs: 45_000,
      },
    });

    await service.respond(sessionId, { message: "Timeout default" });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.generationParams.timeoutMs).toBe(45_000);
  });

  it("should preserve narrator timeoutMs and maxRetries over server defaults", async () => {
    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      executionPolicy: {
        executionTimeoutMs: 45_000,
      },
      resolveTurnModels: vi.fn().mockResolvedValue({
        narrator: {
          model: { providerId: "llm-profile-p1", modelId: "gpt-4o-mini" },
          source: "session_profile",
          profileId: "p1",
          generationParams: { timeoutMs: 30_000, maxRetries: 4, temperature: 0.4 },
        },
      }),
    });

    await service.respond(sessionId, { message: "Profile timeout" });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.generationParams.timeoutMs).toBe(30_000);
    expect(turnInput.generationParams.maxRetries).toBe(4);
    expect(turnInput.generationParams.temperature).toBe(0.4);
  });

  it("should prefer request timeoutMs and maxRetries over narrator params", async () => {
    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      executionPolicy: {
        executionTimeoutMs: 45_000,
      },
      resolveTurnModels: vi.fn().mockResolvedValue({
        narrator: {
          model: { providerId: "llm-profile-p1", modelId: "gpt-4o-mini" },
          source: "session_profile",
          profileId: "p1",
          generationParams: { timeoutMs: 30_000, maxRetries: 4 },
        },
      }),
    });

    await service.respond(sessionId, {
      message: "Request timeout",
      generationParams: { timeoutMs: 12_000, maxRetries: 1 },
    });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.generationParams.timeoutMs).toBe(12_000);
    expect(turnInput.generationParams.maxRetries).toBe(1);
  });

  // ── regenerate 测试 ─────────────────────────────────

  describe("regenerate", () => {
    it("should create new floor with same floorNo and new AI response", async () => {
      // 先完成一轮 respond
      const respondResult = await chatService.respond(sessionId, {
        message: "Hello, brave knight!",
      });
      expect(respondResult.floorNo).toBe(0);

      // 重新生成（使用不同的 mock 输出）
      const REGEN_TEXT = "The knight drew his sword with determination.";
      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (input: any) => {
          await database.db
            .update(floors)
            .set({ state: "generating", updatedAt: Date.now() })
            .where(eq(floors.id, input.floorId));

          return {
            ...MOCK_TURN_OUTPUT,
            floorId: input.floorId,
            generatedText: REGEN_TEXT,
            rawText: REGEN_TEXT,
          };
        }
      );

      const regenResult = await chatService.regenerate(sessionId);

      // 验证返回值
      expect(regenResult.floorId).toBeDefined();
      expect(regenResult.floorId).not.toBe(respondResult.floorId);
      expect(regenResult.floorNo).toBe(0); // 同 floorNo
      expect(regenResult.previousFloorId).toBe(respondResult.floorId);
      expect(regenResult.generatedText).toBe(REGEN_TEXT);
    });

    it("should use the same generating commit boundary during regenerate", async () => {
      await chatService.respond(sessionId, { message: "Seed for regenerate" });

      const commitSpy = vi.spyOn((chatService as any).turnCommitService, "commit");
      const regenResult = await chatService.regenerate(sessionId);

      expect(commitSpy).toHaveBeenCalledOnce();
      expect(commitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          floorId: regenResult.floorId,
          sessionId,
          variableCommit: { pageId: expect.any(String) },
          promptSnapshot: expect.objectContaining({
            floorId: regenResult.floorId,
            sessionId,
            promptMode: "compat_strict",
          }),
          toolExecutionRecords: [
            expect.objectContaining({
              floorId: regenResult.floorId,
              providerId: "builtin",
              toolName: "roll_dice",
              status: "success",
            }),
          ],
          execution: expect.objectContaining({ floorId: regenResult.floorId, finalState: "generating" }),
        })
      );
    });

    it("should reuse the original user message", async () => {
      await chatService.respond(sessionId, { message: "Hello, brave knight!" });

      await chatService.regenerate(sessionId);

      // 验证第二次调用（regenerate）的 TurnInput 包含原始用户消息
      const calls = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(2);

      const regenTurnInput = calls[1]![0];
      // regenerate 时历史为空（floorNo=0 之前没有楼层），
      // 所以只有系统提示 + 当前用户消息
      expect(regenTurnInput.messages.length).toBe(2);
      expect(regenTurnInput.messages[0]).toEqual(
        { role: "system", content: "You are a helpful assistant." }
      );
      expect(regenTurnInput.messages[1]).toEqual(
        { role: "user", content: "Hello, brave knight!" }
      );
    });

    it("should not include the superseded floor in history", async () => {
      // 第一轮
      await chatService.respond(sessionId, { message: "First" });
      // 第二轮
      await chatService.respond(sessionId, { message: "Second" });

      // regenerate 第二轮
      await chatService.regenerate(sessionId);

      const calls = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls;
      const regenTurnInput = calls[2]![0];

      // 历史应只包含第一轮（floorNo=0），不包含被 superseded 的第二轮
      // messages = [system, 第一轮 user, 第一轮 assistant, 当前 user("Second")]
      expect(regenTurnInput.messages.length).toBe(4);
      expect(regenTurnInput.messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
      expect(regenTurnInput.messages[1]).toEqual({ role: "user", content: "First" });
      expect(regenTurnInput.messages[2]).toEqual({ role: "assistant", content: MOCK_GENERATED_TEXT });
      expect(regenTurnInput.messages[3]).toEqual({ role: "user", content: "Second" });
    });

    it("should set parentFloorId on the new floor", async () => {
      const respondResult = await chatService.respond(sessionId, { message: "Hello" });
      const regenResult = await chatService.regenerate(sessionId);

      // 验证 DB 中新楼层的 parentFloorId
      const [newFloor] = await database.db
        .select()
        .from(floors)
        .where(eq(floors.id, regenResult.floorId));

      expect(newFloor).toBeDefined();
      expect(newFloor!.parentFloorId).toBe(respondResult.floorId);
      expect(newFloor!.branchId).toBe("main");
    });

    it("should move old floor to superseded branch", async () => {
      const respondResult = await chatService.respond(sessionId, { message: "Hello" });
      await chatService.regenerate(sessionId);

      // 验证旧楼层的 branchId 已变更
      const [oldFloor] = await database.db
        .select()
        .from(floors)
        .where(eq(floors.id, respondResult.floorId));

      expect(oldFloor).toBeDefined();
      expect(oldFloor!.branchId).toBe(`superseded-${respondResult.floorId}`);
      expect(oldFloor!.state).toBe("committed"); // 旧楼层状态不变
    });

    it("should throw no_floor_to_regenerate for empty session", async () => {
      await expect(
        chatService.regenerate(sessionId)
      ).rejects.toThrow(ChatServiceError);

      try {
        await chatService.regenerate(sessionId);
      } catch (error) {
        expect(error).toBeInstanceOf(ChatServiceError);
        expect((error as ChatServiceError).code).toBe("no_floor_to_regenerate");
      }
    });

    it("should throw session_not_found for non-existent session", async () => {
      await expect(
        chatService.regenerate("non-existent-session")
      ).rejects.toThrow(ChatServiceError);

      try {
        await chatService.regenerate("non-existent-session");
      } catch (error) {
        expect(error).toBeInstanceOf(ChatServiceError);
        expect((error as ChatServiceError).code).toBe("session_not_found");
      }
    });

    it("should throw session_archived for archived session", async () => {
      await database.db
        .update(sessions)
        .set({ status: "archived" })
        .where(eq(sessions.id, sessionId));

      await expect(
        chatService.regenerate(sessionId)
      ).rejects.toThrow(ChatServiceError);

      try {
        await chatService.regenerate(sessionId);
      } catch (error) {
        expect(error).toBeInstanceOf(ChatServiceError);
        expect((error as ChatServiceError).code).toBe("session_archived");
      }
    });
  });

  describe("branching and recovery", () => {
    it("should support respond on a non-main branch with source floor", async () => {
      const root = await chatService.respond(sessionId, { message: "Root" });
      await chatService.respond(sessionId, { message: "Main continues" });

      const branchResult = await chatService.respond(sessionId, {
        message: "Alt timeline",
        branchId: "alt-1",
        sourceFloorId: root.floorId,
      });

      expect(branchResult.branchId).toBe("alt-1");
      expect(branchResult.floorNo).toBe(1);

      const branchCall = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[2]![0];
      const userMessages = branchCall.messages.filter((msg: { role: string }) => msg.role === "user");
      expect(userMessages.map((msg: { content: string }) => msg.content)).toEqual(["Root", "Alt timeline"]);
    });

    it("should retry a failed floor in place", async () => {
      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("transient"));

      await expect(chatService.respond(sessionId, { message: "Will fail" })).rejects.toThrow(ChatServiceError);

      const [draftFloor] = await database.db
        .select()
        .from(floors)
        .where(eq(floors.sessionId, sessionId));

      expect(draftFloor).toBeDefined();

      await database.db
        .update(floors)
        .set({ state: "failed", updatedAt: Date.now() })
        .where(eq(floors.id, draftFloor!.id));

      const retryResult = await chatService.retryFloor(draftFloor!.id);
      expect(retryResult.floorId).toBe(draftFloor!.id);
      expect(retryResult.branchId).toBe("main");
      expect(retryResult.finalState).toBe("committed");

      const pages = await database.db
        .select()
        .from(messagePages)
        .where(eq(messagePages.floorId, draftFloor!.id));
      expect(pages.some((page) => page.pageKind === "output")).toBe(true);
    });

    it("should use the same generating commit boundary during retryFloor", async () => {
      const baseTurn = await chatService.respond(sessionId, { message: "Retry seed" });

      await database.db
        .update(floors)
        .set({ state: "failed", updatedAt: Date.now() })
        .where(eq(floors.id, baseTurn.floorId));

      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockImplementationOnce(async (input) => {
        await database.db
          .update(floors)
          .set({ state: "generating", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        return {
          ...MOCK_TURN_OUTPUT,
          floorId: input.floorId,
          toolExecutionRecords: [
            {
              id: nanoid(),
              runId: `retry-run-${input.floorId}`,
              floorId: input.floorId,
              pageId: input.pageId,
              callerSlot: "narrator",
              providerId: "builtin",
              toolName: "roll_dice",
              argsJson: JSON.stringify({ sides: 20 }),
              resultJson: JSON.stringify({ total: 12 }),
              status: "success",
              durationMs: 5,
              createdAt: Date.now(),
            },
          ],
        };
      });

      const commitSpy = vi.spyOn((chatService as any).turnCommitService, "commit");
      const retryResult = await chatService.retryFloor(baseTurn.floorId);

      expect(retryResult.floorId).toBe(baseTurn.floorId);
      expect(commitSpy).toHaveBeenCalledOnce();
      expect(commitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          floorId: baseTurn.floorId,
          sessionId,
          variableCommit: { pageId: expect.any(String) },
          promptSnapshot: expect.objectContaining({
            floorId: baseTurn.floorId,
            sessionId,
            promptMode: "compat_strict",
          }),
          toolExecutionRecords: [
            expect.objectContaining({
              floorId: baseTurn.floorId,
              providerId: "builtin",
              toolName: "roll_dice",
              status: "success",
            }),
          ],
          execution: expect.objectContaining({ floorId: baseTurn.floorId, finalState: "generating" }),
        })
      );
    });

    it("should edit user message and regenerate into a new branch", async () => {
      const baseTurn = await chatService.respond(sessionId, { message: "Original user line" });

      const [inputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, baseTurn.floorId), eq(messagePages.pageKind, "input")));

      const [sourceMessage] = await database.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.pageId, inputPage!.id), eq(messages.role, "user")));

      const editedResult = await chatService.editAndRegenerate(sourceMessage!.id, {
        content: "Edited user line",
        branchId: "edit-branch",
      });

      expect(editedResult.branchId).toBe("edit-branch");
      expect(editedResult.sourceFloorId).toBe(baseTurn.floorId);
      expect(editedResult.sourceMessageId).toBe(sourceMessage!.id);

      const [newFloor] = await database.db
        .select()
        .from(floors)
        .where(eq(floors.id, editedResult.floorId));
      expect(newFloor?.parentFloorId).toBe(baseTurn.floorId);

      const [newInputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, editedResult.floorId), eq(messagePages.pageKind, "input")));

      const [editedUserMessage] = await database.db
        .select({ content: messages.content })
        .from(messages)
        .where(and(eq(messages.pageId, newInputPage!.id), eq(messages.role, "user")));

      expect(editedUserMessage?.content).toBe("Edited user line");
    });

    it("should not leave an orphan draft floor when editAndRegenerate front-half write fails", async () => {
      const baseTurn = await chatService.respond(sessionId, { message: "Editable seed" });

      const [inputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, baseTurn.floorId), eq(messagePages.pageKind, "input")));

      const [sourceMessage] = await database.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.pageId, inputPage!.id), eq(messages.role, "user")));

      vi.spyOn((chatService as any).messagePersistence, "saveUserMessageWithExecutor").mockImplementationOnce(() => {
        throw new Error("input page write failed");
      });

      await expect(chatService.editAndRegenerate(sourceMessage!.id, {
        content: "Edited broken line",
        branchId: "edit-broken",
      })).rejects.toThrow("input page write failed");

      const branchedFloors = await database.db
        .select()
        .from(floors)
        .where(and(eq(floors.sessionId, sessionId), eq(floors.branchId, "edit-broken")));

      expect(branchedFloors).toHaveLength(0);
    });

    it("should use the same generating commit boundary during editAndRegenerate", async () => {
      const baseTurn = await chatService.respond(sessionId, { message: "Editable seed" });

      const [inputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, baseTurn.floorId), eq(messagePages.pageKind, "input")));

      const [sourceMessage] = await database.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.pageId, inputPage!.id), eq(messages.role, "user")));

      const commitSpy = vi.spyOn((chatService as any).turnCommitService, "commit");
      const editedResult = await chatService.editAndRegenerate(sourceMessage!.id, {
        content: "Edited boundary line",
        branchId: "edit-boundary",
      });

      expect(commitSpy).toHaveBeenCalledOnce();
      expect(commitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          floorId: editedResult.floorId,
          sessionId,
          variableCommit: { pageId: expect.any(String) },
          promptSnapshot: expect.objectContaining({
            floorId: editedResult.floorId,
            sessionId,
            promptMode: "compat_strict",
          }),
          toolExecutionRecords: [
            expect.objectContaining({
              floorId: editedResult.floorId,
              providerId: "builtin",
              toolName: "roll_dice",
              status: "success",
            }),
          ],
          execution: expect.objectContaining({ floorId: editedResult.floorId, finalState: "generating" }),
        })
      );
    });
  });
});
