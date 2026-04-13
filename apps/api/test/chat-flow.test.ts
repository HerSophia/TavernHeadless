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
import { sessions, floors, messagePages, messages, presets, promptRuntimeExplainSnapshots, promptSnapshots, regexProfiles, toolExecutionRecords, variables } from "../src/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants";
import { nanoid } from "nanoid";
import { buildBranchVariableScopeId } from "@tavern/shared";

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

import { ChatService, ChatServiceError, type RespondRuntimeToolEvent } from "../src/services/chat-service";
import {
  GenerationCoordinatorCancelledError,
  type GenerationCoordinator,
  type GenerationCoordinatorExecutionInput,
} from "../src/services/generation-guard-service";
import {
  createEventBus,
  LLMTimeoutError,
  SimpleTokenCounter,
  ToolReplayBlockedError,
  ToolRegistry,
  TurnError,
  type TurnOrchestrator,
  type ToolDefinition,
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

  function createRecordingGenerationCoordinator(
    calls: Array<{ sessionId: string; branchId: string; mode: "reject" | "queue"; timeoutMs?: number }>,
  ): GenerationCoordinator {
    return {
      async execute<T>(input: GenerationCoordinatorExecutionInput<T>): Promise<T> {
        calls.push({
          sessionId: input.sessionId,
          branchId: input.branchId,
          mode: input.mode,
          timeoutMs: input.timeoutMs,
        });

        return input.task({
          requestId: "test-request",
          acquiredAt: Date.now(),
          abortSignal: new AbortController().signal,
        });
      },
    };
  }

  function createMutatingGenerationCoordinator(
    mutate: (input: GenerationCoordinatorExecutionInput<unknown>) => Promise<void> | void,
  ): GenerationCoordinator {
    return {
      async execute<T>(input: GenerationCoordinatorExecutionInput<T>): Promise<T> {
        await mutate(input as GenerationCoordinatorExecutionInput<unknown>);
        return input.task({
          requestId: "test-request",
          acquiredAt: Date.now(),
          abortSignal: new AbortController().signal,
        });
      },
    };
  }

  beforeEach(async () => {
    database = createDatabase(":memory:");

    // 创建 mock orchestrator
    mockOrchestrator = {
      executeTurn: vi.fn(async (input) => {
        // 模拟状态转移：直接更新 DB 中的 floor state
        // 实际的 TurnOrchestrator 会通过 FloorStateMachine 做，
        // 但这里我们 mock 整个 orchestrator，只需返回结果
        const { db } = database;
        const now = Date.now();
        const executionRecord = {
          id: `tec-${input.floorId}`,
          runId: input.toolExecutionRunId ?? `run-${input.floorId}`,
          floorId: input.floorId,
          pageId: input.pageId,
          callerSlot: "narrator",
          providerId: "builtin",
          providerType: "builtin",
          toolName: "roll_dice",
          argsJson: JSON.stringify({ sides: 20 }),
          resultJson: JSON.stringify({ total: 12 }),
          status: "success",
          lifecycleState: "finished",
          commitOutcome: "pending",
          sideEffectLevel: "none",
          durationMs: 5,
          startedAt: now,
          finishedAt: now + 5,
          attemptNo: 1,
          createdAt: now,
        } as const;

        await db
          .update(floors)
          .set({ state: "generating", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        await db
          .insert(toolExecutionRecords)
          .values(executionRecord)
          .onConflictDoNothing()
          .run();

        return {
          ...MOCK_TURN_OUTPUT,
          floorId: input.floorId,
          toolExecutionRecords: [executionRecord],
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
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
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

  it("applies assistant prefill as a temporary trailing assistant message during send", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prefill Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        prompts: [
          { identifier: "main", name: "Main Prompt", role: "system", content: "Stay in character." },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
        prompt_order: [
          {
            character_id: 100000,
            order: [
              { identifier: "main", enabled: true },
              { identifier: "chatHistory", enabled: true },
            ],
          },
        ],
        openai_max_context: 2048,
        openai_max_tokens: 300,
        temperature: 0.7,
        top_p: 1,
        top_k: 0,
        min_p: 0,
        frequency_penalty: 0,
        presence_penalty: 0,
        repetition_penalty: 1,
        new_chat_prompt: "",
        new_example_chat_prompt: "",
        continue_nudge_prompt: "",
        assistant_prefill: "Knight:",
        wi_format: "{0}",
        names_behavior: 0,
        stream_openai: true,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.update(sessions).set({ presetId, characterSnapshotJson: JSON.stringify({ name: "Knight" }), updatedAt: now }).where(eq(sessions.id, sessionId));

    await chatService.respond(sessionId, { message: "Hello, brave knight!" });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.messages[turnInput.messages.length - 1]).toEqual({ role: "user", content: "Hello, brave knight!" });

    const outputPages = await database.db.select().from(messagePages).where(eq(messagePages.pageKind, "output"));
    const [assistantMsg] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.pageId, outputPages[0]!.id));

    expect(assistantMsg?.content).toBe(MOCK_GENERATED_TEXT);
  });

  it("keeps assistant prefill fallback on the live send path for continue intent", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Continue Prefill Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        prompts: [
          { identifier: "main", name: "Main Prompt", role: "system", content: "Stay in character." },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
        prompt_order: [
          {
            character_id: 100000,
            order: [
              { identifier: "main", enabled: true },
              { identifier: "chatHistory", enabled: true },
            ],
          },
        ],
        openai_max_context: 2048,
        openai_max_tokens: 300,
        temperature: 0.7,
        top_p: 1,
        top_k: 0,
        min_p: 0,
        frequency_penalty: 0,
        presence_penalty: 0,
        repetition_penalty: 1,
        new_chat_prompt: "",
        new_example_chat_prompt: "",
        continue_nudge_prompt: "",
        assistant_prefill: "Knight:",
        wi_format: "{0}",
        names_behavior: 0,
        stream_openai: true,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({ presetId, characterSnapshotJson: JSON.stringify({ name: "Knight" }), updatedAt: now })
      .where(eq(sessions.id, sessionId));

    await chatService.respond(sessionId, { message: "Continue the scene.", promptIntent: "continue" });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.messages[turnInput.messages.length - 1]).toEqual({ role: "assistant", content: "Knight:" });
    expect(turnInput.messages[turnInput.messages.length - 2]).toEqual({ role: "user", content: "Continue the scene." });

    const outputPages = await database.db.select().from(messagePages).where(eq(messagePages.pageKind, "output"));
    const [assistantMsg] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.pageId, outputPages[0]!.id));

    expect(assistantMsg?.content).toBe(MOCK_GENERATED_TEXT);
  });

  it("suppresses assistant prefill on the live send path when respond delivery requires last user", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Continue Prefill With Delivery Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        prompts: [
          { identifier: "main", name: "Main Prompt", role: "system", content: "Stay in character." },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
        prompt_order: [
          {
            character_id: 100000,
            order: [
              { identifier: "main", enabled: true },
              { identifier: "chatHistory", enabled: true },
            ],
          },
        ],
        openai_max_context: 2048,
        openai_max_tokens: 300,
        temperature: 0.7,
        top_p: 1,
        top_k: 0,
        min_p: 0,
        frequency_penalty: 0,
        presence_penalty: 0,
        repetition_penalty: 1,
        new_chat_prompt: "",
        new_example_chat_prompt: "",
        continue_nudge_prompt: "",
        assistant_prefill: "Knight:",
        wi_format: "{0}",
        names_behavior: 0,
        stream_openai: true,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({ presetId, characterSnapshotJson: JSON.stringify({ name: "Knight" }), updatedAt: now })
      .where(eq(sessions.id, sessionId));

    await chatService.respond(sessionId, {
      message: "Continue the scene.",
      promptIntent: "continue",
      delivery: { requireLastUser: true },
    });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.messages[turnInput.messages.length - 1]).toEqual({ role: "user", content: "Continue the scene." });
    expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "assistant" && message.content === "Knight:")).toBe(false);

    const outputPages = await database.db.select().from(messagePages).where(eq(messagePages.pageKind, "output"));
    const [assistantMsg] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.pageId, outputPages[0]!.id));

    expect(assistantMsg?.content).toBe(MOCK_GENERATED_TEXT);
  });

  it("rewrites assistant history on the live send path when respond structure sets no_assistant", async () => {
    await chatService.respond(sessionId, { message: "First turn" });

    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

    await chatService.respond(sessionId, {
      message: "Second turn",
      structure: { mode: "no_assistant" },
    });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
    expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content === MOCK_GENERATED_TEXT)).toBe(true);
  });
  it("applies session prompt runtime structure policy on the live respond path when request override is absent", async () => {
    await chatService.respond(sessionId, { message: "First turn" });

    await database.db
      .update(sessions)
      .set({
        metadataJson: JSON.stringify({
          prompt_runtime: {
            policy: {
              structure: {
                mode: "no_assistant",
              },
            },
          },
        }),
        updatedAt: Date.now(),
      })
      .where(eq(sessions.id, sessionId));

    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

    await chatService.respond(sessionId, {
      message: "Second turn",
    });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
    expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content === MOCK_GENERATED_TEXT)).toBe(true);
  });

  it("applies branch prompt runtime policy overlay on the live respond path for a materialized branch", async () => {
    await chatService.respond(sessionId, { message: "First turn" });

    await database.db
      .update(sessions)
      .set({
        metadataJson: JSON.stringify({
          prompt_runtime: {
            branchPolicies: {
              "alt-branch": {
                delivery: {
                  noAssistant: true,
                },
              },
            },
          },
        }),
        updatedAt: Date.now(),
      })
      .where(eq(sessions.id, sessionId));

    const now = Date.now();
    await database.db.insert(floors).values({
      id: nanoid(),
      sessionId,
      floorNo: 1,
      branchId: "alt-branch",
      parentFloorId: null,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();
    await chatService.respond(sessionId, { message: "Branch turn", branchId: "alt-branch" });
    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
  });

  it("lets request delivery override session prompt runtime delivery defaults on respond", async () => {
    await chatService.respond(sessionId, { message: "First turn" });

    await database.db
      .update(sessions)
      .set({
        metadataJson: JSON.stringify({
          prompt_runtime: {
            policy: {
              delivery: {
                noAssistant: true,
              },
            },
          },
        }),
        updatedAt: Date.now(),
      })
      .where(eq(sessions.id, sessionId));

    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

    await chatService.respond(sessionId, {
      message: "Second turn",
      delivery: { noAssistant: false },
    });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "assistant" && message.content === MOCK_GENERATED_TEXT)).toBe(true);
  });



  it("keeps live prompt debug payload disabled by default", async () => {
    const result = await chatService.respond(sessionId, { message: "Hello without debug" });

    expect(result.promptSnapshot).toBeUndefined();
    expect(result.runtimeTrace).toBeUndefined();
  });

  it("returns live prompt snapshot and runtime trace when respond debug options are enabled", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Live Debug Prompt Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        prompts: [
          { identifier: "main", name: "Main Prompt", role: "system", content: "Stay in character." },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
        prompt_order: [
          {
            character_id: 100000,
            order: [
              { identifier: "main", enabled: true },
              { identifier: "chatHistory", enabled: true },
            ],
          },
        ],
        openai_max_context: 2048,
        openai_max_tokens: 300,
        temperature: 0.7,
        top_p: 1,
        top_k: 0,
        min_p: 0,
        frequency_penalty: 0,
        presence_penalty: 0,
        repetition_penalty: 1,
        new_chat_prompt: "",
        new_example_chat_prompt: "",
        continue_nudge_prompt: "",
        assistant_prefill: "Knight:",
        wi_format: "{0}",
        names_behavior: 0,
        stream_openai: true,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({ presetId, characterSnapshotJson: JSON.stringify({ name: "Knight" }), updatedAt: now })
      .where(eq(sessions.id, sessionId));

    await chatService.respond(sessionId, { message: "First turn" });

    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

    const result = await chatService.respond(sessionId, {
      message: "Continue the scene.",
      promptIntent: "continue",
      structure: { mode: "no_assistant" },
      delivery: { requireLastUser: true },
      debugOptions: {
        includePromptSnapshot: true,
        includeRuntimeTrace: true,
      },
    });

    expect(result.promptSnapshot).toBeDefined();
    expect(result.promptSnapshot?.promptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.promptSnapshot?.tokenEstimate).toBeGreaterThan(0);
    expect(result.runtimeTrace?.visibility).toBeUndefined();
    expect(result.runtimeTrace?.worldbook?.matches).toBeUndefined();
    expect(result.runtimeTrace?.structure).toMatchObject({
      mode: "no_assistant",
    });
    expect(result.runtimeTrace?.structure?.assistantRewriteCount).toBeGreaterThan(0);
    expect(result.runtimeTrace?.delivery).toMatchObject({
      assistantPrefillRequested: true,
      assistantPrefillApplied: false,
      requireLastUser: true,
    });

    const [snapshotRow] = await database.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, result.floorId));

    expect(snapshotRow?.promptDigest).toBe(result.promptSnapshot?.promptDigest);
    expect(snapshotRow?.tokenEstimate).toBe(result.promptSnapshot?.tokenEstimate);
  });

  it("should forward runtime tool events during respond", async () => {
    const eventBus = createEventBus();
    const tokenCounter = new SimpleTokenCounter();
    chatService = new ChatService(database.db, mockOrchestrator, tokenCounter, { eventBus });

    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockImplementationOnce(async (input) => {
      await database.db
        .update(floors)
        .set({ state: "generating", updatedAt: Date.now() })
        .where(eq(floors.id, input.floorId));

      await eventBus.emit("tool.call_started", {
        floorId: input.floorId,
        pageId: input.pageId,
        callerSlot: "narrator",
        executionId: "exec-1",
        providerId: "builtin",
        providerType: "builtin",
        sideEffectLevel: "sandbox",
        toolName: "set_variable",
        args: { key: "mood", value: "steady" },
      });

      await eventBus.emit("tool.call_completed", {
        floorId: input.floorId,
        pageId: input.pageId,
        callerSlot: "narrator",
        executionId: "exec-1",
        providerId: "builtin",
        providerType: "builtin",
        sideEffectLevel: "sandbox",
        toolName: "set_variable",
        result: { ok: true },
        status: "success",
        durationMs: 7,
      });

      return {
        ...MOCK_TURN_OUTPUT,
        floorId: input.floorId,
      };
    });

    const toolEvents: RespondRuntimeToolEvent[] = [];
    await chatService.respond(sessionId, { message: "Observe tool events" }, { onTool: (event) => toolEvents.push(event) });

    expect(toolEvents).toEqual([
      expect.objectContaining({ executionId: "exec-1", phase: "start", replaySafety: "uncertain" }),
      expect.objectContaining({ executionId: "exec-1", phase: "success", durationMs: 7, replaySafety: "safe" }),
    ]);
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

  it("should finalize tool_execution_record commit outcome after respond", async () => {
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
    expect(toolExecutionRow!.lifecycleState).toBe("finished");
    expect(toolExecutionRow!.commitOutcome).toBe("committed");
  });

  it("should persist prompt_snapshot inside the commit boundary after respond", async () => {
    const result = await chatService.respond(sessionId, { message: "Snapshot boundary" });

    const [snapshotRow] = await database.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, result.floorId));
    const [inspectionSnapshotRow] = await database.db
      .select()
      .from(promptRuntimeExplainSnapshots)
      .where(eq(promptRuntimeExplainSnapshots.floorId, result.floorId));

    expect(snapshotRow).toBeDefined();
    expect(snapshotRow!.sessionId).toBe(sessionId);
    expect(snapshotRow!.presetId).toBeNull();
    expect(snapshotRow!.promptMode).toBe("compat_strict");
    expect(snapshotRow!.promptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshotRow!.tokenEstimate).toBeGreaterThan(0);
    expect(inspectionSnapshotRow).toBeDefined();
    expect(inspectionSnapshotRow!.sessionId).toBe(sessionId);
    expect(inspectionSnapshotRow!.floorId).toBe(result.floorId);
    expect(inspectionSnapshotRow!.snapshotVersion).toBe(1);
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
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
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
    for (let i = 0; i < 200 && !enteredGeneration; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(enteredGeneration).toBe(true);

    await expect(service.respond(sessionId, { message: "Second message" })).rejects.toMatchObject({
      code: "generation_conflict",
    });

    releaseGeneration?.();
    await expect(firstPromise).resolves.toMatchObject({ generatedText: MOCK_GENERATED_TEXT });
    expect(blockingOrchestrator.executeTurn).toHaveBeenCalledTimes(1);
  });

  it("should prefer the session-scoped runtime tool registry over the static fallback registry", async () => {
    const makeTool = (name: string): ToolDefinition => ({
      name,
      description: `${name} description`,
      parameters: { type: "object", properties: {} },
      sideEffectLevel: "none",
      allowedSlots: ["narrator"],
      source: "preset",
    });

    const baseRegistry = new ToolRegistry();
    baseRegistry.register({
      id: "base-provider",
      type: "builtin",
      listTools: vi.fn(async () => [makeTool("base_only_tool")]),
      executeTool: vi.fn(async () => ({ data: "base" })),
    });

    const runtimeRegistry = new ToolRegistry();
    runtimeRegistry.register({
      id: "runtime-provider",
      type: "preset",
      listTools: vi.fn(async () => [makeTool("runtime_only_tool")]),
      executeTool: vi.fn(async () => ({ data: "runtime" })),
    });

    const sessionToolRegistryService = {
      buildRuntime: vi.fn(async () => ({
        registry: runtimeRegistry,
        catalog: {
          sessionId,
          generatedAt: Date.now(),
          tools: [],
          conflicts: [],
        },
      })),
    } as any;

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      toolRegistry: baseRegistry,
      sessionToolRegistryService,
      resolveToolPermissions: async () => ({ enabled: true }),
    });

    await service.respond(sessionId, {
      message: "Use runtime tools",
      config: { enableTools: true, toolMode: "inline" },
    });

    const turnInput = (mockOrchestrator.executeTurn as any).mock.calls.at(-1)[0];
    const toolNames = (await turnInput.toolRegistry.listAll()).map((tool: ToolDefinition) => tool.name);
    expect(toolNames).toContain("runtime_only_tool");
    expect(toolNames).not.toContain("base_only_tool");
    expect(sessionToolRegistryService.buildRuntime).toHaveBeenCalledWith(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("should use reject coordinator mode by default", async () => {
    const calls: Array<{ sessionId: string; branchId: string; mode: "reject" | "queue"; timeoutMs?: number }> = [];
    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      generationCoordinator: createRecordingGenerationCoordinator(calls),
    });

    await service.respond(sessionId, { message: "Default coordinator mode" });

    expect(calls).toEqual([
      expect.objectContaining({ sessionId, branchId: "main", mode: "reject", timeoutMs: 5_000 }),
    ]);
  });

  it("should pass configured queue mode and queue timeout to the generation coordinator", async () => {
    const calls: Array<{ sessionId: string; branchId: string; mode: "reject" | "queue"; timeoutMs?: number }> = [];
    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      generationCoordinator: createRecordingGenerationCoordinator(calls),
      executionPolicy: { queueMode: "queue", queueTimeoutMs: 1_234 },
    });

    await service.respond(sessionId, { message: "Queued coordinator mode", branchId: "alt-branch" });

    expect(calls).toEqual([
      expect.objectContaining({ sessionId, branchId: "alt-branch", mode: "queue", timeoutMs: 1_234 }),
    ]);
  });

  it("should pass caller abort signal to the generation coordinator and map queued cancellation", async () => {
    const abortController = new AbortController();
    const calls: AbortSignal[] = [];
    const generationCoordinator: GenerationCoordinator = {
      async execute<T>(input: GenerationCoordinatorExecutionInput<T>): Promise<T> {
        calls.push(input.abortSignal!);
        throw new GenerationCoordinatorCancelledError(input.sessionId, input.branchId);
      },
    };

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      generationCoordinator,
    });

    await expect(
      service.respond(sessionId, { message: "Cancelled while queued" }, { abortSignal: abortController.signal }),
    ).rejects.toMatchObject({
      code: "generation_cancelled",
    });

    expect(calls).toEqual([abortController.signal]);
  });

  it("should revalidate session status after generation handoff", async () => {
    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      generationCoordinator: createMutatingGenerationCoordinator(async () => {
        await database.db
          .update(sessions)
          .set({ status: "archived", updatedAt: Date.now() })
          .where(eq(sessions.id, sessionId));
      }),
    });

    await expect(service.respond(sessionId, { message: "Queued message" })).rejects.toMatchObject({
      code: "session_archived",
    });
    expect(mockOrchestrator.executeTurn).not.toHaveBeenCalled();
  });

  it("should reject regenerate when the latest floor changes while queued", async () => {
    const initial = await chatService.respond(sessionId, { message: "seed" });
    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      generationCoordinator: createMutatingGenerationCoordinator(async () => {
        const now = Date.now();
        await database.db.insert(floors).values({
          id: nanoid(),
          sessionId,
          floorNo: initial.floorNo + 1,
          branchId: "main",
          parentFloorId: initial.floorId,
          state: "committed",
          tokenIn: 0,
          tokenOut: 0,
          createdAt: now,
          updatedAt: now,
        });
      }),
    });

    await expect(service.regenerate(sessionId)).rejects.toMatchObject({
      code: "generation_target_stale",
    });
    expect(mockOrchestrator.executeTurn).not.toHaveBeenCalled();
  });

  it("should reject retry when the target floor changes while queued", async () => {
    const initial = await chatService.respond(sessionId, { message: "seed" });
    await database.db
      .update(floors)
      .set({ state: "committed", updatedAt: Date.now() })
      .where(eq(floors.id, initial.floorId));
    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      generationCoordinator: createMutatingGenerationCoordinator(async () => {
        await database.db
          .update(floors)
          .set({ branchId: "alt", updatedAt: Date.now() })
          .where(eq(floors.id, initial.floorId));
      }),
    });

    await expect(service.retryFloor(initial.floorId)).rejects.toMatchObject({
      code: "generation_target_stale",
    });
    expect(mockOrchestrator.executeTurn).not.toHaveBeenCalled();
  });

  it("should reject edit-and-regenerate when the source context changes while queued", async () => {
    const initial = await chatService.respond(sessionId, { message: "seed" });
    const [inputPage] = await database.db
      .select({ id: messagePages.id })
      .from(messagePages)
      .where(and(eq(messagePages.floorId, initial.floorId), eq(messagePages.pageKind, "input")));
    const [sourceMessage] = await database.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.pageId, inputPage!.id), eq(messages.role, "user")));
    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      generationCoordinator: createMutatingGenerationCoordinator(async () => {
        await database.db
          .update(floors)
          .set({ floorNo: initial.floorNo + 10, updatedAt: Date.now() })
          .where(eq(floors.id, initial.floorId));
      }),
    });

    await expect(service.editAndRegenerate(sourceMessage!.id, { content: "edited" })).rejects.toMatchObject({
      code: "generation_target_stale",
    });
    expect(mockOrchestrator.executeTurn).not.toHaveBeenCalled();
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

  it("should reject respond before creating a draft floor when narrator slot is explicitly disabled", async () => {
    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      resolveTurnModels: vi.fn().mockResolvedValue({
        narrator: {
          source: "env",
          enabled: false,
        },
      }),
    });

    await expect(
      service.respond(sessionId, { message: "Narrator disabled" })
    ).rejects.toMatchObject({ code: "instance_slot_disabled_required" });

    expect(mockOrchestrator.executeTurn).not.toHaveBeenCalled();

    const floorRows = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    expect(floorRows).toHaveLength(0);
  });

  it("should apply narrator preset override from runtime resolution into the committed prompt snapshot", async () => {
    const now = Date.now();
    const basePresetId = "preset-base";
    const overridePresetId = "preset-override";

    await database.db.insert(presets).values([
      {
        id: basePresetId,
        name: "Base Preset",
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        dataJson: "{}",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: overridePresetId,
        name: "Override Preset",
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        dataJson: "{}",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await database.db
      .update(sessions)
      .set({ presetId: basePresetId, updatedAt: now + 1 })
      .where(eq(sessions.id, sessionId));

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      resolveTurnModels: vi.fn().mockResolvedValue({
        narrator: {
          source: "env",
          enabled: true,
          presetId: overridePresetId,
          generationParams: { temperature: 0.55 },
        },
      }),
    });

    const result = await service.respond(sessionId, { message: "Use preset override" });

    const [snapshotRow] = await database.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, result.floorId));

    expect(snapshotRow).toBeDefined();
    expect(snapshotRow!.presetId).toBe(overridePresetId);

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.generationParams.temperature).toBe(0.55);
  });

  it("should force disabled director verifier and memory instance slots out of the effective turn config", async () => {
    const memoryStore = {
      prepareInjection: vi.fn().mockResolvedValue({ formattedText: "", items: [], tokenCount: 0 }),
    } as any;

    const service = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter(), {
      memoryStore,
      enableMemoryConsolidationByDefault: true,
      resolveTurnModels: vi.fn().mockResolvedValue({
        director: { source: "env", enabled: false },
        verifier: { source: "env", enabled: false },
        memory: { source: "env", enabled: false },
      }),
    });

    await service.respond(sessionId, {
      message: "Skip disabled subflows",
      config: {
        enableDirector: true,
        enableVerifier: true,
      },
    });

    const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(turnInput.config).toEqual({
      enableDirector: false,
      enableVerifier: false,
      enableMemoryConsolidation: false,
    });
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

  it("maps replay-blocked verifier retries and marks the run outcome accordingly", async () => {
    (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockImplementationOnce(async (input) => {
      const now = Date.now();
      const executionId = `replay-blocked-${input.floorId}`;

      await database.db
        .insert(toolExecutionRecords)
        .values({
          id: executionId,
          runId: input.toolExecutionRunId ?? `replay-blocked-run-${input.floorId}`,
          floorId: input.floorId,
          pageId: input.pageId ?? null,
          callerSlot: "narrator",
          providerId: "resource",
          providerType: "builtin",
          toolName: "create_character",
          argsJson: JSON.stringify({ name: "Alice" }),
          resultJson: JSON.stringify({ created: true }),
          status: "success",
          lifecycleState: "finished",
          commitOutcome: "pending",
          sideEffectLevel: "irreversible",
          durationMs: 5,
          startedAt: now,
          finishedAt: now + 5,
          attemptNo: 1,
          createdAt: now,
        })
        .run();

      throw new TurnError(
        "Verifier retry blocked because replaying tool executions would be unsafe: create_character (never_auto_replay)",
        "verifier",
        new ToolReplayBlockedError([
          {
            executionId,
            toolName: "create_character",
            providerId: "resource",
            providerType: "builtin",
            sideEffectLevel: "irreversible",
            status: "success",
            lifecycleState: "finished",
            replaySafety: "never_auto_replay",
            reason: "irreversible_side_effect",
          },
        ]),
      );
    });

    await expect(chatService.respond(sessionId, { message: "Replay block me" })).rejects.toMatchObject({
      code: "tool_replay_blocked",
      details: {
        blocking_executions: [
          expect.objectContaining({
            tool_name: "create_character",
            provider_id: "resource",
            replay_safety: "never_auto_replay",
          }),
        ],
      },
    });

    const [floor] = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    const [toolExecutionRow] = await database.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.floorId, floor!.id));
    expect(floor?.state).toBe("failed");
    expect(toolExecutionRow?.commitOutcome).toBe("replay_blocked");
  });

  it("should throw commit_conflict when the floor is no longer generating before commit", async () => {
    const conflictingOrchestrator = {
      executeTurn: vi.fn(async (input) => {
        const now = Date.now();

        await database.db
          .update(floors)
          .set({ state: "committed", updatedAt: Date.now() })
          .where(eq(floors.id, input.floorId));

        await database.db
          .insert(toolExecutionRecords)
          .values({
            id: `conflict-tec-${input.floorId}`,
            runId: input.toolExecutionRunId ?? `conflict-run-${input.floorId}`,
            floorId: input.floorId,
            pageId: input.pageId ?? null,
            callerSlot: "narrator",
            providerId: "builtin",
            providerType: "builtin",
            toolName: "roll_dice",
            argsJson: JSON.stringify({ sides: 20 }),
            resultJson: JSON.stringify({ total: 12 }),
            status: "success",
            lifecycleState: "finished",
            commitOutcome: "pending",
            sideEffectLevel: "none",
            durationMs: 5,
            startedAt: now,
            finishedAt: now + 5,
            attemptNo: 1,
            createdAt: now,
          })
          .run();

        return {
          ...MOCK_TURN_OUTPUT,
          floorId: input.floorId,
          toolExecutionRecords: [],
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

    const [toolExecutionRow] = await database.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.floorId, floor!.id));
    expect(toolExecutionRow).toBeDefined();
    expect(toolExecutionRow!.status).toBe("success");
    expect(toolExecutionRow!.commitOutcome).toBe("discarded");
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
    const [inspectionSnapshotRow] = await database.db
      .select()
      .from(promptRuntimeExplainSnapshots)
      .where(eq(promptRuntimeExplainSnapshots.floorId, floor!.id));
    expect(inspectionSnapshotRow).toBeUndefined();



    const [toolExecutionRow] = await database.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.floorId, floor!.id));
    expect(toolExecutionRow).toBeDefined();
    expect(toolExecutionRow!.commitOutcome).toBe("discarded");
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

  it("should preview macro mutations without creating floors or persisted writes", async () => {
    const result = await chatService.previewPromptRuntimeText(sessionId, {
      text: "{{setvar::mood::steady}}{{getvar::mood}}",
    });

    expect(result.text).toBe("steady");
    expect(result.runtimeTrace.macro?.mutationPreview).toEqual([
      { kind: "set", scope: "branch", key: "mood", value: "steady" },
    ]);
    expect(result.runtimeTrace.macro?.stagedMutations).toEqual([]);

    const floorRows = await database.db.select().from(floors);
    const promptSnapshotRows = await database.db.select().from(promptSnapshots);
    const variableRows = await database.db
      .select()
      .from(variables)
      .where(and(
        eq(variables.scopeId, buildBranchVariableScopeId(sessionId, "main")),
        eq(variables.key, "mood"),
      ));

    expect(floorRows).toHaveLength(0);
    expect(promptSnapshotRows).toHaveLength(0);
    expect(variableRows).toHaveLength(0);
  });

  it("should respect visibility when previewing recent message macros", async () => {
    await chatService.respond(sessionId, { message: "First visible line" });
    await chatService.respond(sessionId, { message: "Second hidden line" });

    const fullPreview = await chatService.previewPromptRuntimeText(sessionId, {
      text: "{{lastUserMessage}}",
    });
    const filteredPreview = await chatService.previewPromptRuntimeText(sessionId, {
      text: "{{lastUserMessage}}",
      visibility: {
        mode: "allow_all_except_hidden",
        hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 1 }],
      },
    });

    expect(fullPreview.text).toBe("Second hidden line");
    expect(filteredPreview.text).toBe("First visible line");
    expect(filteredPreview.runtimeTrace.visibility?.filteredFloorNos).toEqual([1]);
  });

  it("should fail preview on a new branch when the source floor snapshot is missing", async () => {
    const sourceFloorId = nanoid();
    const now = Date.now();

    await database.db.insert(floors).values({
      id: sourceFloorId,
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

    await expect(
      chatService.previewPromptRuntimeText(sessionId, {
        text: "{{getvar::mood}}",
        branchId: "alt-preview",
        sourceFloorId,
      }),
    ).rejects.toMatchObject({ code: "branch_local_snapshot_missing" });
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

    it("should apply delivery noAssistant on regenerate send path", async () => {
      await chatService.respond(sessionId, { message: "First turn" });
      await chatService.respond(sessionId, { message: "Second turn" });

      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

      await chatService.regenerate(sessionId, {
        delivery: { noAssistant: true },
      });

      const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(turnInput.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
      expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content === MOCK_GENERATED_TEXT)).toBe(true);
    });
    it("applies session prompt runtime delivery policy on regenerate when request override is absent", async () => {
      await chatService.respond(sessionId, { message: "First turn" });
      await chatService.respond(sessionId, { message: "Second turn" });

      await database.db
        .update(sessions)
        .set({
          metadataJson: JSON.stringify({
            prompt_runtime: {
              policy: {
                delivery: {
                  noAssistant: true,
                },
              },
            },
          }),
          updatedAt: Date.now(),
        })
        .where(eq(sessions.id, sessionId));

      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

      await chatService.regenerate(sessionId);

      const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(turnInput.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
      expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content === MOCK_GENERATED_TEXT)).toBe(true);
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

    it("should mark old floor as superseded without changing branchId", async () => {
      const respondResult = await chatService.respond(sessionId, { message: "Hello" });
      const regenResult = await chatService.regenerate(sessionId);

      const [oldFloor] = await database.db
        .select()
        .from(floors)
        .where(eq(floors.id, respondResult.floorId));

      expect(oldFloor).toBeDefined();
      expect(oldFloor!.branchId).toBe("main");
      expect(oldFloor!.supersededAt).toBeTypeOf("number");
      expect(oldFloor!.supersededByFloorId).toBe(regenResult.floorId);
      expect(oldFloor!.state).toBe("committed");
    });

    it("should continue the main branch from the regenerated live floor", async () => {
      await chatService.respond(sessionId, { message: "First" });
      await chatService.respond(sessionId, { message: "Second" });

      const regeneratedText = "Regenerated second reply";
      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (input: any) => {
          await database.db
            .update(floors)
            .set({ state: "generating", updatedAt: Date.now() })
            .where(eq(floors.id, input.floorId));

          return {
            ...MOCK_TURN_OUTPUT,
            floorId: input.floorId,
            generatedText: regeneratedText,
            rawText: regeneratedText,
          };
        }
      );

      const regenResult = await chatService.regenerate(sessionId);
      const continued = await chatService.respond(sessionId, { message: "Third" });

      expect(continued.floorNo).toBe(2);
      const continuedTurnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[3]![0];
      expect(continuedTurnInput.messages).toEqual([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "First" },
        { role: "assistant", content: MOCK_GENERATED_TEXT },
        { role: "user", content: "Second" },
        { role: "assistant", content: regeneratedText },
        { role: "user", content: "Third" },
      ]);

      const [continuedFloor] = await database.db.select().from(floors).where(eq(floors.id, continued.floorId));
      expect(continuedFloor!.parentFloorId).toBe(regenResult.floorId);
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

    it("should load history from the source branch when a new branch forks from a non-main floor", async () => {
      const root = await chatService.respond(sessionId, { message: "Root" });
      await chatService.respond(sessionId, { message: "Main continues" });
      await chatService.respond(sessionId, {
        message: "Alt timeline",
        branchId: "alt-1",
        sourceFloorId: root.floorId,
      });
      const altFollowup = await chatService.respond(sessionId, {
        message: "Alt followup",
        branchId: "alt-1",
      });

      const nestedBranch = await chatService.respond(sessionId, {
        message: "Nested branch",
        branchId: "alt-2",
        sourceFloorId: altFollowup.floorId,
      });

      const orchestratorCalls = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls;
      const nestedCall = orchestratorCalls[orchestratorCalls.length - 1]![0];
      const userMessages = nestedCall.messages.filter((msg: { role: string }) => msg.role === "user");

      expect(nestedBranch.branchId).toBe("alt-2");
      expect(userMessages.map((msg: { content: string }) => msg.content)).toEqual([
        "Root",
        "Alt timeline",
        "Alt followup",
        "Nested branch",
      ]);
    });

    it("should preview history from the source branch when the target branch is not yet materialized", async () => {
      const root = await chatService.respond(sessionId, { message: "Root" });
      await chatService.respond(sessionId, { message: "Main continues" });
      await chatService.respond(sessionId, {
        message: "Alt timeline",
        branchId: "alt-1",
        sourceFloorId: root.floorId,
      });
      const altFollowup = await chatService.respond(sessionId, {
        message: "Alt followup",
        branchId: "alt-1",
      });

      const preview = await chatService.previewPromptRuntimeText(sessionId, {
        text: "{{lastUserMessage}}",
        branchId: "alt-2",
        sourceFloorId: altFollowup.floorId,
      });

      expect(preview.text).toBe("Alt followup");
    });

    it("should fail respond when the source floor snapshot is missing", async () => {
      const sourceFloorId = nanoid();
      const now = Date.now();

      await database.db.insert(floors).values({
        id: sourceFloorId,
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

      await expect(
        chatService.respond(sessionId, {
          message: "Alt timeline",
          branchId: "alt-missing-snapshot",
          sourceFloorId,
        }),
      ).rejects.toMatchObject({ code: "branch_local_snapshot_missing" });

      const branchedFloors = await database.db
        .select({ id: floors.id })
        .from(floors)
        .where(and(eq(floors.sessionId, sessionId), eq(floors.branchId, "alt-missing-snapshot")));

      expect(branchedFloors).toHaveLength(0);
      expect(mockOrchestrator.executeTurn).not.toHaveBeenCalled();
    });

    it("should materialize source floor local values when respond opens a new branch", async () => {
      const now = Date.now();
      await database.db.insert(variables).values({
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        key: "mood",
        valueJson: JSON.stringify("before-respond-branch"),
        updatedAt: now,
      });

      const root = await chatService.respond(sessionId, { message: "Root" });

      await database.db
        .update(variables)
        .set({ valueJson: JSON.stringify("after-respond-branch"), updatedAt: now + 10 })
        .where(and(
          eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(variables.scope, "chat"),
          eq(variables.scopeId, sessionId),
          eq(variables.key, "mood"),
        ));

      const branchResult = await chatService.respond(sessionId, {
        message: "Alt timeline",
        branchId: "alt-local",
        sourceFloorId: root.floorId,
      });

      const [branchedMood] = await database.db
        .select({ valueJson: variables.valueJson })
        .from(variables)
        .where(and(eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID), eq(variables.scope, "branch"), eq(variables.scopeId, buildBranchVariableScopeId(sessionId, "alt-local")), eq(variables.key, "mood")));

      expect(branchResult.branchId).toBe("alt-local");
      expect(branchedMood && JSON.parse(branchedMood.valueJson)).toBe("before-respond-branch");
    });

    it("should continue from the latest committed branch floor when the branch tip is failed", async () => {
      const root = await chatService.respond(sessionId, { message: "Root" });
      const branchResult = await chatService.respond(sessionId, {
        message: "Alt timeline",
        branchId: "alt-1",
        sourceFloorId: root.floorId,
      });

      const failedFloorId = nanoid();
      const now = Date.now();
      await database.db.insert(floors).values({
        id: failedFloorId,
        sessionId,
        floorNo: branchResult.floorNo + 1,
        branchId: "alt-1",
        parentFloorId: branchResult.floorId,
        state: "failed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now,
        updatedAt: now,
      });

      const continued = await chatService.respond(sessionId, {
        message: "Alt after failure",
        branchId: "alt-1",
      });

      expect(continued.branchId).toBe("alt-1");
      expect(continued.floorNo).toBe(branchResult.floorNo + 2);

      const [continuedFloor] = await database.db
        .select()
        .from(floors)
        .where(eq(floors.id, continued.floorId));

      expect(continuedFloor).toBeDefined();
      expect(continuedFloor!.parentFloorId).toBe(branchResult.floorId);

      const continuedCall = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[2]![0];
      const userMessages = continuedCall.messages.filter((msg: { role: string }) => msg.role === "user");
      expect(userMessages.map((msg: { content: string }) => msg.content)).toEqual([
        "Root",
        "Alt timeline",
        "Alt after failure",
      ]);
    });

    it("should reject respond when the branch already has a generating floor", async () => {
      const root = await chatService.respond(sessionId, { message: "Root" });
      const now = Date.now();

      await database.db.insert(floors).values({
        id: nanoid(),
        sessionId,
        floorNo: 1,
        branchId: "alt-1",
        parentFloorId: root.floorId,
        state: "generating",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now,
        updatedAt: now,
      });

      await expect(chatService.respond(sessionId, { message: "Blocked", branchId: "alt-1" })).rejects.toMatchObject({
        code: "invalid_state",
      });
      expect(mockOrchestrator.executeTurn).toHaveBeenCalledTimes(1);
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
        .set({ state: "committed", updatedAt: Date.now() })
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

    it("should apply delivery noAssistant on retryFloor send path", async () => {
      await chatService.respond(sessionId, { message: "First turn" });
      const retriedTurn = await chatService.respond(sessionId, { message: "Retry delivery seed" });

      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

      await chatService.retryFloor(retriedTurn.floorId, {
        delivery: { noAssistant: true },
      });

      const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(turnInput.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
      expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content === MOCK_GENERATED_TEXT)).toBe(true);
    });

    it("applies session prompt runtime delivery policy on retryFloor when request override is absent", async () => {
      await chatService.respond(sessionId, { message: "First turn" });
      const retriedTurn = await chatService.respond(sessionId, { message: "Retry delivery seed" });

      await database.db
        .update(sessions)
        .set({
          metadataJson: JSON.stringify({
            prompt_runtime: {
              policy: {
                delivery: {
                  noAssistant: true,
                },
              },
            },
          }),
          updatedAt: Date.now(),
        })
        .where(eq(sessions.id, sessionId));

      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

      await chatService.retryFloor(retriedTurn.floorId);

      const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(turnInput.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
      expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content === MOCK_GENERATED_TEXT)).toBe(true);
    });


    it("requires explicit confirmation before retrying a floor with unsafe prior tool executions", async () => {
      const baseTurn = await chatService.respond(sessionId, { message: "Retry guard" });
      const now = Date.now();
      const blockingExecutionId = nanoid();

      await database.db
        .update(floors)
        .set({ state: "committed", updatedAt: now })
        .where(eq(floors.id, baseTurn.floorId));

      await database.db
        .insert(toolExecutionRecords)
        .values({
          id: blockingExecutionId,
          runId: `retry-unsafe-run-${baseTurn.floorId}`,
          floorId: baseTurn.floorId,
          callerSlot: "narrator",
          providerId: "resource",
          providerType: "builtin",
          toolName: "create_character",
          argsJson: JSON.stringify({ name: "Alice" }),
          resultJson: JSON.stringify({ created: true }),
          status: "success",
          lifecycleState: "finished",
          commitOutcome: "discarded",
          sideEffectLevel: "irreversible",
          durationMs: 8,
          startedAt: now,
          finishedAt: now + 8,
          attemptNo: 1,
          createdAt: now,
        })
        .run();

      await expect(chatService.retryFloor(baseTurn.floorId)).rejects.toMatchObject({
        code: "tool_replay_confirmation_required",
        details: {
          blocking_executions: [
            expect.objectContaining({
              execution_id: blockingExecutionId,
              tool_name: "create_character",
              replay_safety: "never_auto_replay",
            }),
          ],
        },
      });
    });

    it("allows retry once the caller confirms all blocking execution ids", async () => {
      const baseTurn = await chatService.respond(sessionId, { message: "Retry confirm" });
      const now = Date.now();
      const blockingExecutionId = nanoid();

      await database.db
        .update(floors)
        .set({ state: "committed", updatedAt: now })
        .where(eq(floors.id, baseTurn.floorId));

      await database.db
        .insert(toolExecutionRecords)
        .values({
          id: blockingExecutionId,
          runId: `retry-confirm-run-${baseTurn.floorId}`,
          floorId: baseTurn.floorId,
          callerSlot: "narrator",
          providerId: "resource",
          providerType: "builtin",
          toolName: "create_character",
          argsJson: JSON.stringify({ name: "Alice" }),
          resultJson: JSON.stringify({ created: true }),
          status: "success",
          lifecycleState: "finished",
          commitOutcome: "discarded",
          sideEffectLevel: "irreversible",
          durationMs: 8,
          startedAt: now,
          finishedAt: now + 8,
          attemptNo: 1,
          createdAt: now,
        })
        .run();

      const retryResult = await chatService.retryFloor(baseTurn.floorId, {
        confirmedExecutionIds: [blockingExecutionId],
      });

      expect(retryResult.floorId).toBe(baseTurn.floorId);
      expect(retryResult.finalState).toBe("committed");
    });

    it("should use the same generating commit boundary during retryFloor", async () => {
      const baseTurn = await chatService.respond(sessionId, { message: "Retry seed" });

      await database.db
        .update(floors)
        .set({ state: "committed", updatedAt: Date.now() })
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

    it("should fail editAndRegenerate when the source floor snapshot is missing", async () => {
      const now = Date.now();
      const sourceFloorId = nanoid();
      const inputPageId = nanoid();
      const sourceMessageId = nanoid();
      const mainBranchScopeId = buildBranchVariableScopeId(sessionId, "main");

      await database.db.insert(floors).values({
        id: sourceFloorId,
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
      await database.db.insert(messagePages).values({
        id: inputPageId,
        floorId: sourceFloorId,
        pageNo: 0,
        pageKind: "input",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: now,
        updatedAt: now,
      });
      await database.db.insert(messages).values({
        id: sourceMessageId,
        pageId: inputPageId,
        seq: 0,
        role: "user",
        content: "Legacy editable line",
        contentFormat: "text",
        tokenCount: "Legacy editable line".length,
        isHidden: false,
        source: "api",
        createdAt: now,
      });
      await database.db.insert(variables).values([
        {
          id: nanoid(),
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          scope: "chat",
          scopeId: sessionId,
          key: "chat_seed",
          valueJson: JSON.stringify("legacy-chat"),
          updatedAt: now,
        },
        {
          id: nanoid(),
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          scope: "branch",
          scopeId: mainBranchScopeId,
          key: "branch_seed",
          valueJson: JSON.stringify({ hp: 95 }),
          updatedAt: now + 1,
        },
      ]);

      await expect(
        chatService.editAndRegenerate(sourceMessageId, {
          content: "Legacy edited line",
          branchId: "legacy-fallback",
        }),
      ).rejects.toMatchObject({ code: "branch_local_snapshot_missing" });

      const targetScopeId = buildBranchVariableScopeId(sessionId, "legacy-fallback");
      const inheritedRows = await database.db
        .select({ key: variables.key, valueJson: variables.valueJson })
        .from(variables)
        .where(and(
          eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(variables.scope, "branch"),
          eq(variables.scopeId, targetScopeId),
        ))
        .orderBy(asc(variables.key));

      expect(inheritedRows).toEqual([]);
    });

    it("should branch from the source floor snapshot instead of current chat values", async () => {
      const now = Date.now();
      await database.db.insert(variables).values({
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        key: "mood",
        valueJson: JSON.stringify("before-branch"),
        updatedAt: now,
      });

      const baseTurn = await chatService.respond(sessionId, { message: "Original snapshot line" });

      await database.db
        .update(variables)
        .set({ valueJson: JSON.stringify("after-branch"), updatedAt: now + 10 })
        .where(and(eq(variables.scope, "chat"), eq(variables.scopeId, sessionId), eq(variables.key, "mood")));

      const [inputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, baseTurn.floorId), eq(messagePages.pageKind, "input")));
      const [sourceMessage] = await database.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.pageId, inputPage!.id), eq(messages.role, "user")));

      await chatService.editAndRegenerate(sourceMessage!.id, {
        content: "Edited from snapshot",
        branchId: "snapshot-branch",
      });

      const [branchedMood] = await database.db
        .select({ valueJson: variables.valueJson })
        .from(variables)
        .where(and(
          eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(variables.scope, "branch"),
          eq(variables.scopeId, buildBranchVariableScopeId(sessionId, "snapshot-branch")),
          eq(variables.key, "mood"),
        ));

      expect(branchedMood && JSON.parse(branchedMood.valueJson)).toBe("before-branch");
    });

    it("should inherit structured branch values into a new branch and keep them isolated", async () => {
      const now = Date.now();
      const mainBranchScopeId = buildBranchVariableScopeId(sessionId, "main");
      await database.db.insert(variables).values({
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: mainBranchScopeId,
        key: "资产",
        valueJson: JSON.stringify({ 金币: 3, 银币: 5 }),
        updatedAt: now,
      });

      const baseTurn = await chatService.respond(sessionId, { message: "Original structured line" });

      const [inputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, baseTurn.floorId), eq(messagePages.pageKind, "input")));
      const [sourceMessage] = await database.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.pageId, inputPage!.id), eq(messages.role, "user")));

      await chatService.editAndRegenerate(sourceMessage!.id, {
        content: "Edited structured line",
        branchId: "structured-branch",
      });

      const targetScopeId = buildBranchVariableScopeId(sessionId, "structured-branch");
      let [targetVariable] = await database.db
        .select({ valueJson: variables.valueJson })
        .from(variables)
        .where(and(
          eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(variables.scope, "branch"),
          eq(variables.scopeId, targetScopeId),
          eq(variables.key, "资产"),
        ));

      expect(targetVariable && JSON.parse(targetVariable.valueJson)).toEqual({ 金币: 3, 银币: 5 });

      await database.db
        .update(variables)
        .set({ valueJson: JSON.stringify({ 金币: 99 }), updatedAt: now + 10 })
        .where(and(
          eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(variables.scope, "branch"),
          eq(variables.scopeId, mainBranchScopeId),
          eq(variables.key, "资产"),
        ));

      [targetVariable] = await database.db
        .select({ valueJson: variables.valueJson })
        .from(variables)
        .where(and(
          eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(variables.scope, "branch"),
          eq(variables.scopeId, targetScopeId),
          eq(variables.key, "资产"),
        ));

      expect(targetVariable && JSON.parse(targetVariable.valueJson)).toEqual({ 金币: 3, 银币: 5 });
    });

    it("should apply delivery noAssistant on editAndRegenerate send path", async () => {
      await chatService.respond(sessionId, { message: "First turn" });
      const editableTurn = await chatService.respond(sessionId, { message: "Editable user line" });

      const [inputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, editableTurn.floorId), eq(messagePages.pageKind, "input")));

      const [sourceMessage] = await database.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.pageId, inputPage!.id), eq(messages.role, "user")));

      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

      await chatService.editAndRegenerate(sourceMessage!.id, {
        content: "Edited without assistant",
        branchId: "edit-no-assistant",
        delivery: { noAssistant: true },
      });

      const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(turnInput.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
      expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content === MOCK_GENERATED_TEXT)).toBe(true);
    });

    it("applies session prompt runtime delivery policy on editAndRegenerate when request override is absent", async () => {
      await chatService.respond(sessionId, { message: "First turn" });
      const editableTurn = await chatService.respond(sessionId, { message: "Editable user line" });

      await database.db
        .update(sessions)
        .set({
          metadataJson: JSON.stringify({
            prompt_runtime: {
              policy: {
                delivery: {
                  noAssistant: true,
                },
              },
            },
          }),
          updatedAt: Date.now(),
        })
        .where(eq(sessions.id, sessionId));

      const [inputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, editableTurn.floorId), eq(messagePages.pageKind, "input")));

      const [sourceMessage] = await database.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.pageId, inputPage!.id), eq(messages.role, "user")));

      (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mockClear();

      await chatService.editAndRegenerate(sourceMessage!.id, {
        content: "Edited without assistant",
        branchId: "edit-session-no-assistant",
      });

      const turnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(turnInput.messages.some((message: { role: string }) => message.role === "assistant")).toBe(false);
      expect(turnInput.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content === MOCK_GENERATED_TEXT)).toBe(true);
    });


    it("should switch USER_INPUT regex execution to the edit channel during editAndRegenerate", async () => {
      const regexProfileId = nanoid();
      const now = Date.now();

      await database.db.insert(regexProfiles).values({
        id: regexProfileId,
        name: "Edit Regex",
        source: "sillytavern",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        dataJson: JSON.stringify([
          {
            id: "regex-edit-channel",
            scriptName: "Edit Channel Rule",
            findRegex: "/draft/g",
            replaceString: "persisted",
            trimStrings: [],
            placement: [1],
            disabled: false,
            substituteRegex: 0,
            minDepth: 0,
            maxDepth: 0,
          },
        ]),
        createdAt: now,
        updatedAt: now,
      });

      await database.db.update(sessions).set({ regexProfileId, updatedAt: now }).where(eq(sessions.id, sessionId));

      const baseTurn = await chatService.respond(sessionId, { message: "draft" });

      const [baseInputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, baseTurn.floorId), eq(messagePages.pageKind, "input")));

      const [sourceMessage] = await database.db
        .select({ id: messages.id, content: messages.content })
        .from(messages)
        .where(and(eq(messages.pageId, baseInputPage!.id), eq(messages.role, "user")));

      expect(sourceMessage?.content).toBe("persisted");

      const editedResult = await chatService.editAndRegenerate(sourceMessage!.id, {
        content: "draft",
        branchId: "edit-regex",
      });

      const [newInputPage] = await database.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(and(eq(messagePages.floorId, editedResult.floorId), eq(messagePages.pageKind, "input")));

      const [editedUserMessage] = await database.db
        .select({ content: messages.content })
        .from(messages)
        .where(and(eq(messages.pageId, newInputPage!.id), eq(messages.role, "user")));

      expect(editedUserMessage?.content).toBe("draft");
      const editTurnInput = (mockOrchestrator.executeTurn as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(editTurnInput?.messages.some((message: { role: string; content: string }) => message.role === "user" && message.content === "draft")).toBe(true);
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

      const branchedVariables = await database.db
        .select()
        .from(variables)
        .where(and(
          eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
          eq(variables.scope, "branch"),
          eq(variables.scopeId, buildBranchVariableScopeId(sessionId, "edit-broken")),
        ));
      expect(branchedVariables).toHaveLength(0);
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
