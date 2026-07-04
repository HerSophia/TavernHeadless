import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  SimpleTokenCounter,
  type TurnExecutionResult,
  type TurnInput,
  type TurnOrchestrator,
} from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { floors, presets, regexProfiles, sessionBranches, sessions, toolExecutionRecords, worldbooks } from "../../db/schema.js";
import { ChatService } from "../chat/chat-service.js";
import { FloorRunService } from "../floor-run-service.js";
import { TemporaryConversationService } from "../temporary-conversation-service.js";
import { GraphAssistantPromptConfigService } from "../graph-assistant-prompt-config-service.js";
import { SessionBranchRegistryService } from "../variables/host/session-branch-registry-service.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";

const promptAssemblerMocks = vi.hoisted(() => ({
  assemblePrompt: vi.fn(),
}));

vi.mock("../prompt-assembler.js", async () => {
  const actual = await vi.importActual<typeof import("../prompt-assembler.js")>("../prompt-assembler.js");
  return {
    ...actual,
    assemblePrompt: promptAssemblerMocks.assemblePrompt,
  };
});

describe("TemporaryConversationService", () => {
  let database: DatabaseConnection;
  let chatService: ChatService;
  let temporaryConversationService: TemporaryConversationService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    promptAssemblerMocks.assemblePrompt.mockReset();
    promptAssemblerMocks.assemblePrompt.mockImplementation(async (_db, _accountId, _sessionInfo, history, userMessage) => ({
      messages: [
        ...history,
        { role: "user", content: userMessage },
      ],
      sendDirectives: {},
      promptSnapshot: {
        presetId: null,
        presetUpdatedAt: null,
        presetVersion: null,
        worldbookId: null,
        worldbookUpdatedAt: null,
        worldbookVersion: null,
        regexProfileId: null,
        regexProfileUpdatedAt: null,
        regexProfileVersion: null,
        worldbookActivatedEntryUids: [],
        regexPreRuleNames: [],
        regexPostRuleNames: [],
        promptMode: "native" as const,
        promptDigest: "temporary-conversation-test",
        tokenEstimate: 0,
        createdAt: 1_736_200_000_000,
      },
      tokenUsage: {
        total: 4,
        availableForReply: 96,
        byGroup: {},
        bySection: [],
        prunedByGroup: {},
        allocator: {
          trimReasons: [],
          estimatedByGroup: {},
          allocatedByGroup: {},
        },
      },
      runtimeTraceSeed: {
        worldbookHits: 0,
        macroStagedMutations: [],
      },
    }));

    chatService = new ChatService(
      database.db,
      createMockTurnOrchestrator(),
      new SimpleTokenCounter(),
      {
        resolveTurnModels: async () => ({
          narrator: {
            source: "env",
            generationParams: { maxOutputTokens: 128 },
          },
        }),
        floorRunService: new FloorRunService(database.db),
      },
    );

    temporaryConversationService = new TemporaryConversationService(database.db, chatService, {
      tokenCounter: new SimpleTokenCounter(),
    });
  });

  afterEach(() => {
    database.close();
  });

  it("creates a temporary session snapshot, appends staged messages, responds, and reads transcript", async () => {
    const source = await seedSourceSession(database, Date.now());

    const handle = await temporaryConversationService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "utility",
    });

    expect(handle.kind).toBe("temporary");
    expect(handle.status).toBe("active");
    expect(handle.sourceSessionId).toBe(source.sessionId);

    const [temporarySession] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, handle.conversationId));

    expect(temporarySession).toMatchObject({
      id: handle.conversationId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      kind: "temporary",
      purpose: "utility",
      temporarySourceSessionId: source.sessionId,
      retentionPolicy: "delete_on_finalize",
      visibility: "internal",
      presetId: source.presetId,
      regexProfileId: source.regexProfileId,
      worldbookProfileId: source.worldbookProfileId,
      promptMode: "native",
    });
    expect(temporarySession?.temporarySnapshotDigest).toMatch(/^sha256:/);
    expect(JSON.parse(temporarySession!.metadataJson ?? "{}")).toMatchObject({
      tool_permissions: {
        allow_irreversible: false,
      },
      prompt_runtime_policy: {
        sourceSelection: {
          history: {
            maxMessages: 12,
          },
        },
      },
    });

    const [temporaryBranch] = await database.db
      .select()
      .from(sessionBranches)
      .where(eq(sessionBranches.sessionId, handle.conversationId));
    expect(temporaryBranch).toMatchObject({
      branchId: "main",
      sourceBranchId: "main",
      assetBindingPresetId: source.branchBinding.presetId,
      assetBindingWorldbookProfileId: source.branchBinding.worldbookProfileId,
      assetBindingRegexProfileId: source.branchBinding.regexProfileId,
      assetBindingDeepBinding: true,
    });

    const firstMessage = await temporaryConversationService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "system",
      content: "Keep answers short.",
    });
    await temporaryConversationService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "user",
      content: "What is the next step?",
    });

    const result = await temporaryConversationService.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });

    expect(result.conversationId).toBe(handle.conversationId);
    expect(result.floorId).toBe(firstMessage.floorId);
    expect(result.pageId).toBeTruthy();
    expect(result.text).toContain("reply:What is the next step?");
    expect(result.usage).toEqual({
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });
    expect(result.finishReason).toBe("assistant_message_committed");
    expect(result.warnings).toEqual([]);

    const transcript = await temporaryConversationService.readTranscript({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });

    expect(transcript.floors).toHaveLength(1);
    expect(transcript.floors[0]).toMatchObject({
      id: firstMessage.floorId,
      state: "committed",
    });
    expect(transcript.floors[0]?.pages[0]?.pageKind).toBe("mixed");
    expect(transcript.floors[0]?.pages[0]?.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "system", content: "Keep answers short." },
      { role: "user", content: "What is the next step?" },
    ]);
    expect(transcript.floors[0]?.pages[1]?.messages[0]?.content).toContain("reply:What is the next step?");

    const [committedFloor] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.id, firstMessage.floorId));
    expect(committedFloor?.state).toBe("committed");
  });
  it("readTranscript 只带出当前一次生成的工具执行（旧输出页版本的执行不混入 step 视图）", async () => {
    // 回归 step 重试展示错位：楼层可能留有多次生成（旧 run = 被新消息页取代的版本，新 run = 当前生成）的
    // 工具执行。若按 floorId 全量带出，旧版本页的工具步会与新生成的工具步按 started_at 混排，让用户误以为
    // 重试是在原步之后追加/替换。这里断言只带出「当前生成」（最后一条已提交执行的 run_id）的执行。
    const source = await seedSourceSession(database, Date.now());
    const handle = await temporaryConversationService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "snapshot",
    });
    await temporaryConversationService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "user",
      content: "What is the next step?",
    });
    const result = await temporaryConversationService.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });
    const floorId = result.floorId;

    const base = Date.now();
    await database.db.insert(toolExecutionRecords).values([
      // 旧 run（被新消息页取代的版本）：find_by_name + 两次 get，started_at 更早。
      { id: "exec_old_1", runId: "run_old", floorId, callerSlot: "narrator", providerId: "builtin", toolName: "graph.find_by_name", status: "success", commitOutcome: "committed", startedAt: base, generationStepNo: 1, createdAt: base },
      { id: "exec_old_2", runId: "run_old", floorId, callerSlot: "narrator", providerId: "builtin", toolName: "graph.get", status: "success", commitOutcome: "committed", startedAt: base + 10, generationStepNo: 2, createdAt: base + 10 },
      { id: "exec_old_3", runId: "run_old", floorId, callerSlot: "narrator", providerId: "builtin", toolName: "graph.get", status: "success", commitOutcome: "committed", startedAt: base + 20, generationStepNo: 3, createdAt: base + 20 },
      // 新 run（当前生成）：只有一次 get，started_at 更晚。
      { id: "exec_new_1", runId: "run_new", floorId, callerSlot: "narrator", providerId: "builtin", toolName: "graph.get", status: "success", commitOutcome: "committed", startedAt: base + 100, generationStepNo: 2, createdAt: base + 100 },
    ]);

    const transcript = await temporaryConversationService.readTranscript({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });
    const floor = transcript.floors.find((item) => item.id === floorId);
    // 只保留新 run 的执行；旧 run 的三条不再混入。
    expect(floor?.toolExecutions.map((exec) => exec.id)).toEqual(["exec_new_1"]);
  });



  it("keeps the temporary snapshot stable after the source session changes", async () => {
    const now = Date.now();
    const source = await seedSourceSession(database, now);
    const handle = await temporaryConversationService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "snapshot",
    });

    await database.db.update(sessions).set({
      metadataJson: JSON.stringify({ tool_permissions: { allow_irreversible: true }, changed: true }),
      presetId: "preset-changed",
      updatedAt: now + 5_000,
    }).where(eq(sessions.id, source.sessionId));

    const [temporarySession] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, handle.conversationId));

    expect(temporarySession?.presetId).toBe(source.presetId);
    expect(JSON.parse(temporarySession?.metadataJson ?? "{}")).not.toMatchObject({ changed: true });
    expect(JSON.parse(temporarySession?.metadataJson ?? "{}")).toMatchObject({
      tool_permissions: {
        allow_irreversible: false,
      },
    });
  });

  it("derives warnings and finishReason from runtime trace semantics", async () => {
    const source = await seedSourceSession(database, Date.now());
    const stubChatService = {
      respondFromPreparedDraftFloor: vi.fn(async () => ({
        floorId: "floor_stub_1",
        floorNo: 1,
        generatedText: "stub reply",
        summaries: [],
        totalUsage: {
          promptTokens: 3,
          completionTokens: 4,
          totalTokens: 7,
        },
        finalState: "committed" as const,
        branchId: "main",
        outputPageId: "page_stub_output_1",
        assistantMessageId: "msg_stub_output_1",
        runtimeTrace: {
          preset: {
            selectedPromptOrderCharacterId: null,
            ignoredPromptOrderCharacterIds: [],
            unsupportedFields: [],
            ignoredFields: [],
            unresolvedMarkers: [],
            warnings: ["trace-warning"],
            triggerFilteredEntryIds: [],
            inChatInsertedEntryIds: [],
            continueNudgeApplied: false,
          },
          macro: {
            warnings: [{ code: "macro_warning", message: "macro warning" }],
            usedNames: [],
            mutationPreview: [],
            stagedMutations: [],
            traces: [],
          },
          delivery: {
            assistantPrefillRequested: false,
            assistantPrefillApplied: false,
            assistantPrefillStrategy: "none",
            allowAssistantPrefill: true,
            requireLastUser: false,
            noAssistant: true,
            lastMessageRole: "user",
            endsWithUser: true,
            degraded: true,
            degradeReasons: ["no_assistant_override"],
          },
        },
      })),
    } as unknown as ChatService;
    const semanticService = new TemporaryConversationService(database.db, stubChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const handle = await semanticService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "warning-check",
    });

    await semanticService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "user",
      content: "Explain the next step.",
    });

    const result = await semanticService.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      delivery: {
        noAssistant: true,
      },
    });

    expect(result.finishReason).toBe("delivery_degraded");
    expect(result.finishReason).not.toBe(result.finalState);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "preset:trace-warning",
      "macro:macro_warning",
      "delivery:no_assistant_override",
    ]));
  });

  it("forces NodeGraph tools and injects one-time guidance for graph-assistant conversations", async () => {
   const source = await seedSourceSession(database, Date.now());
    let capturedConfig: unknown;
    const stubChatService = {
      respondFromPreparedDraftFloor: vi.fn(async (args: { request:{ config?: unknown } }) => {
        capturedConfig = args.request.config;
        return {
          floorId: "floor_ga_1",
          floorNo: 1,
          generatedText: "ok",
          summaries: [],
          totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    finalState: "committed" as const,
          branchId: "main",
          outputPageId: "page_ga_1",
          assistantMessageId: "msg_ga_1",
        };
      }),
    } as unknown as ChatService;
    const gaService = new TemporaryConversationService(database.db, stubChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const handle = await gaService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "graph-assistant",
    });

    await gaService.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      inputMessage: { role: "user", content: "Build a graph for me." },
    });

    // 图助手会话强制启用工具。
    expect((capturedConfig as { enableTools?: boolean } | undefined)?.enableTools).toBe(true);

    // 首次 respond 注入一条 system 引导消息。
    const transcript = await gaService.readTranscript({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId:handle.conversationId,
    });
    const guidanceMessages = transcript.floors
      .flatMap((floor) => floor.pages)
      .flatMap((page) => page.messages)
      .filter((message) => message.role === "system" && message.content.includes("NodeGraph"));
    expect(guidanceMessages).toHaveLength(1);

    // 幂等：再次触发注入不会重复写入引导。
    const [row] = await database.db.select().from(sessions).where(eq(sessions.id, handle.conversationId));
    await (gaService as unknown as {
      maybeInjectGraphAssistantGuidance: (s: typeof row, b: string) => Promise<void>;
    }).maybeInjectGraphAssistantGuidance(row, "main");
    const transcriptAfter = await gaService.readTranscript({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });
    const guidanceAfter = transcriptAfter.floors
      .flatMap((floor) => floor.pages)
      .flatMap((page) => page.messages)
      .filter((message)=> message.role === "system" && message.content.includes("NodeGraph"));
    expect(guidanceAfter).toHaveLength(1);
  });

  it("does not force tools or inject guidance for non graph-assistant conversations", async () => {
    const source = await seedSourceSession(database, Date.now());
    let capturedConfig: unknown;
    const stubChatService = {
      respondFromPreparedDraftFloor: vi.fn(async (args: { request: { config?: unknown } }) => {
        capturedConfig = args.request.config;
        return {
          floorId: "floor_plain_1",
       floorNo: 1,
          generatedText: "ok",
          summaries: [],
          totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finalState: "committed" as const,
          branchId: "main",
          outputPageId: "page_plain_1",
          assistantMessageId: "msg_plain_1",
        };
      }),
    } as unknown as ChatService;
    const plainService = new TemporaryConversationService(database.db, stubChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const handle = await plainService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "utility",
    });

    await plainService.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      inputMessage: { role: "user", content: "Hello." },
    });

    // 非图助手会话不强制启用工具。
    expect((capturedConfig as { enableTools?: boolean } | undefined)?.enableTools).not.toBe(true);

    const transcript = await plainService.readTranscript({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });
    const guidanceMessages = transcript.floors
      .flatMap((floor) => floor.pages)
      .flatMap((page) => page.messages)
      .filter((message) => message.role === "system" && message.content.includes("NodeGraph"));
    expect(guidanceMessages).toHaveLength(0);
 });

  it("injects the project's custom static prompt (override) on first respond", async () => {
    const project = createTestProject(database.db, { accountId: DEFAULT_ADMIN_ACCOUNT_ID });
    new GraphAssistantPromptConfigService(database.db).upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      staticMode: "override",
      staticText: "只读图查看助手，不要改图。",
    });

    const stubChatService = {
      respondFromPreparedDraftFloor: vi.fn(async () => ({
        floorId: "floor_ga_override",
        floorNo: 1,
        generatedText: "ok",
     summaries: [],
        totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finalState: "committed" as const,
        branchId: "main",
        outputPageId: "page_ga_override",
        assistantMessageId: "msg_ga_override",
      })),
    } as unknown as ChatService;
    const gaService = new TemporaryConversationService(database.db, stubChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const handle = await gaService.createFromProject({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
      purpose: "graph-assistant",
    });

    await gaService.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      inputMessage: { role: "user", content: "hi" },
    });

    const transcript = await gaService.readTranscript({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });
    const systemMessages = transcript.floors
      .flatMap((floor) => floor.pages)
      .flatMap((page) => page.messages)
      .filter((message) => message.role === "system");
    // override 模式：注入自定义文本，不再含内置默认的 NodeGraph 引导。
    expect(systemMessages.some((message) => message.content === "只读图查看助手，不要改图。")).toBe(true);
    expect(systemMessages.some((message) => message.content.includes("NodeGraph"))).toBe(false);
  });

  it("enables tool permissions in metadata for graph-assistant conversations", async () => {
    const project = createTestProject(database.db, { accountId: DEFAULT_ADMIN_ACCOUNT_ID });
    const gaService = new TemporaryConversationService(database.db, {} as unknown as ChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const handle = await gaService.createFromProject({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
      purpose: "graph-assistant",
    });

    const [stored] = await database.db
      .select({ metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(eq(sessions.id, handle.conversationId))
      .limit(1);
    // 图助手会话必须强制启用工具，否则 transport 会因 tools_disabled 退化为 none。
    expect(JSON.parse(stored?.metadataJson ?? "{}")).toMatchObject({
      tool_permissions: { enabled: true, allow_irreversible: false },
    });
  });


  it("wraps dynamicContext into a request-scope client injection on respond", async () => {
    const source = await seedSourceSession(database, Date.now());
    let capturedInjections: unknown;
    const stubChatService = {
      respondFromPreparedDraftFloor: vi.fn(async (args: { request: { promptRuntimeInjections?: unknown } }) => {
        capturedInjections = args.request.promptRuntimeInjections;
        return {
          floorId: "floor_dyn_1",
          floorNo: 1,
          generatedText: "ok",
          summaries: [],
          totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finalState: "committed" as const,
          branchId: "main",
          outputPageId: "page_dyn_1",
          assistantMessageId: "msg_dyn_1",
        };
      }),
    } as unknown as ChatService;
    const service = new TemporaryConversationService(database.db, stubChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const handle = await service.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "utility",
    });

    await service.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      inputMessage: { role: "user", content: "Hello." },
      dynamicContext: "当前画布：3 个节点，2 条连线。",
    });

    const injections = capturedInjections as Array<{
      sourceKind?: string;
      content?: string;
     placement?: string;
      scope?: string;
    }> | undefined;
 expect(injections).toHaveLength(1);
    expect(injections?.[0]?.sourceKind).toBe("client_injection");
    expect(injections?.[0]?.content).toBe("当前画布：3 个节点，2 条连线。");
    expect(injections?.[0]?.placement).toBe("before_current_user_input");
    expect(injections?.[0]?.scope).toBe("request");
  });

  it("omits the dynamic-context injection when dynamicContext is absent or blank", async () => {
    const source = await seedSourceSession(database, Date.now());
    let capturedInjections: unknown = "untouched";
    const stubChatService = {
      respondFromPreparedDraftFloor: vi.fn(async (args: { request: { promptRuntimeInjections?: unknown } }) => {
        capturedInjections = args.request.promptRuntimeInjections;
        return {
          floorId: "floor_dyn_2",
          floorNo: 1,
          generatedText: "ok",
          summaries: [],
          totalUsage: { promptTokens: 1,completionTokens: 1, totalTokens: 2 },
          finalState: "committed" as const,
          branchId: "main",
          outputPageId: "page_dyn_2",
     assistantMessageId: "msg_dyn_2",
        };
      }),
    } as unknown as ChatService;
  const service = new TemporaryConversationService(database.db, stubChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const handle = await service.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "utility",
    });

    await service.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      inputMessage: { role: "user", content: "Hello." },
      dynamicContext: "   ",
    });

    expect(capturedInjections).toBeUndefined();
  });

  it("persists and exposes reasoning text on the committed transcript floor", async() => {
    const reasoningChatService = new ChatService(
      database.db,
      createMockTurnOrchestrator({ emitReasoning: true }),
      new SimpleTokenCounter(),
      {
        resolveTurnModels: async () => ({
          narrator: {
            source: "env",
            generationParams: { maxOutputTokens: 128 },
          },
        }),
        floorRunService: new FloorRunService(database.db),
      },
    );
    const reasoningService = new TemporaryConversationService(database.db, reasoningChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const source = await seedSourceSession(database, Date.now());
    const handle = await reasoningService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "utility",
    });
    await reasoningService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "user",
      content: "hi",
    });

    await reasoningService.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      generationParams: { reasoningEffort: "medium" },
    });

    const transcript = await reasoningService.readTranscript({
 accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });
    expect(transcript.floors).toHaveLength(1);
    expect(transcript.floors[0]?.reasoningText).toBe("think:hi");
  });

  it("streams reasoning chunks ahead of the result", async () => {
    const reasoningChatService = new ChatService(
      database.db,
      createMockTurnOrchestrator({ emitReasoning: true }),
      new SimpleTokenCounter(),
      {
        resolveTurnModels: async () => ({
          narrator: {
            source: "env",
            generationParams: { maxOutputTokens: 128 },
          },
        }),
        floorRunService: new FloorRunService(database.db),
      },
    );
    const reasoningService = new TemporaryConversationService(database.db, reasoningChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const source = await seedSourceSession(database, Date.now());
    const handle = await reasoningService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "utility",
    });
    await reasoningService.appendMessage({
      accountId:DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "user",
      content: "hi",
    });

    const reasoningDeltas: string[] = [];
    let sawResult = false;
    for await (const chunk of reasoningService.stream({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      generationParams: { reasoningEffort: "high" },
    })) {
      if (chunk.type === "reasoning") {
        reasoningDeltas.push(chunk.text);
      }
      if (chunk.type === "result") {
        sawResult = true;
      }
    }

    expect(reasoningDeltas).toEqual(["think:", "hi"]);
    expect(sawResult).toBe(true);
  });

  it("streams step narration chunks ahead of the result", async () => {
    const narrationChatService = new ChatService(
      database.db,
      createMockTurnOrchestrator({ emitStepNarration: true }),
      new SimpleTokenCounter(),
      {
        resolveTurnModels: async () => ({
          narrator: {
            source: "env",
            generationParams: { maxOutputTokens: 128 },
          },
        }),
        floorRunService: new FloorRunService(database.db),
      },
    );
    const narrationService = new TemporaryConversationService(database.db, narrationChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const source = await seedSourceSession(database, Date.now());
    const handle = await narrationService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
purpose: "utility",
    });
    await narrationService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "user",
      content: "hi",
    });

    const narrationChunks: { stepIndex: number; text: string }[] = [];
    let sawResult = false;
    for await (const chunk of narrationService.stream({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    })) {
      if (chunk.type === "narration") {
        narrationChunks.push({ stepIndex: chunk.stepIndex, text: chunk.text });
      }
      if (chunk.type === "result") {
        sawResult = true;
      }
    }

    expect(narrationChunks).toEqual([
      { stepIndex: 0, text: "first step narration" },
      { stepIndex: 1, text: "second step narration" },
    ]);
    expect(sawResult).toBe(true);
  });

});

function createMockTurnOrchestrator(options?: {
  emitReasoning?: boolean;
  emitStepNarration?: boolean;
}): TurnOrchestrator {
  return {
    executeTurn: vi.fn(async (input: TurnInput) => {
      const userMessage = input.messages[input.messages.length -1]?.content ?? "";
      if (options?.emitReasoning) {
        // 模拟流式 reasoning delta 经运行观察器上送
        await input.runObserver?.onReasoningUpdate?.({
          delta: "think:",
          text: "think:",
          attemptNo: 1,
        });
        await input.runObserver?.onReasoningUpdate?.({
          delta: userMessage,
          text: `think:${userMessage}`,
          attemptNo: 1,
        });
      }
      if (options?.emitStepNarration) {
        // 模拟 native 多步循环的中间叙述经运行观察器上送
        await input.runObserver?.onStepNarration?.({
          stepIndex: 0,
          text: "first step narration",
          createdAt: Date.now(),
        });
        await input.runObserver?.onStepNarration?.({
          stepIndex: 1,
          text: "second step narration",
          createdAt: Date.now(),
        });
      }
      return createTurnExecution(floorId(input), userMessage, options?.emitReasoning ?? false);
    }),
  } as unknown as TurnOrchestrator;

  function floorId(input: TurnInput): string {
    return input.floorId;
  }
}

function createTurnExecution(floorId: string, userMessage: string, emitReasoning = false): TurnExecutionResult {
  return {
    floorId,
    finalState: "generating",
    generatedText: `reply:${userMessage}`,
    rawText: `reply:${userMessage}`,
    summaries: [],
    totalUsage: {
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    },
    ...(emitReasoning ? { reasoningText: `think:${userMessage}` } : {}),
  };
}

async function seedSourceSession(
  database: DatabaseConnection,
  now: number,
): Promise<{
  sessionId: string;
  presetId: string;
  regexProfileId: string;
  worldbookProfileId: string;
  branchBinding: {
    presetId: string;
    worldbookProfileId: string;
    regexProfileId: string;
  };
}> {
  const sessionId = nanoid();
  const presetId = `preset-${sessionId}`;
  const regexProfileId = `regex-${sessionId}`;
  const worldbookProfileId = `world-${sessionId}`;
  const branchBinding = {
    presetId: `branch-preset-${sessionId}`,
    worldbookProfileId: `branch-world-${sessionId}`,
    regexProfileId: `branch-regex-${sessionId}`,
  };

  await database.db.insert(presets).values([
    {
      id: presetId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `preset ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: branchBinding.presetId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `branch preset ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.db.insert(regexProfiles).values([
    {
      id: regexProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `regex ${sessionId}`,
      source: "test",
      dataJson: "[]",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: branchBinding.regexProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `branch regex ${sessionId}`,
      source: "test",
      dataJson: "[]",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.db.insert(worldbooks).values([
    {
      id: worldbookProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `world ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: branchBinding.worldbookProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `branch world ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Narrative Session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    presetId,
    regexProfileId,
    worldbookProfileId,
    deepBinding: false,
    promptMode: "native",
    metadataJson: JSON.stringify({
      tool_permissions: {
        allow_irreversible: true,
      },
      prompt_runtime_policy: {
        sourceSelection: {
          history: {
            maxMessages: 12,
          },
        },
      },
    }),
    createdAt: now,
    updatedAt: now,
  });

  new SessionBranchRegistryService(database.db).ensure({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId,
    branchId: "main",
    assetBinding: {
      presetId: branchBinding.presetId,
      presetVersionId: null,
      worldbookProfileId: branchBinding.worldbookProfileId,
      worldbookVersionId: null,
      regexProfileId: branchBinding.regexProfileId,
      regexProfileVersionId: null,
      deepBinding: true,
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    sessionId,
    presetId,
    regexProfileId,
    worldbookProfileId,
    branchBinding,
  };
}
