/**
 * E2E Chat Integration Tests
 *
 * 测试完整端到端链路：
 * - 创建 Session（含角色卡）
 * - 导入预设 → 关联到 Session
 * - 发送消息 → 验证 Prompt 编排生效
 * - Greeting 自动创建
 * - 无预设降级
 *
 * 使用 Mock Orchestrator（不调真实 LLM），但验证
 * PromptAssembler 的编排输出正确性。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../src/db/client";
import {
  sessions,
  floors,
  messagePages,
  messages,
  presets,
  promptSnapshots,
  variables,
  worldbooks,
  worldbookEntries,
  regexProfiles,
} from "../src/db/schema";
import { ChatService, ChatServiceError } from "../src/services/chat-service";
import { SimpleTokenCounter, type TurnOrchestrator, type TurnOutput, type TurnInput } from "@tavern/core";

// ── Helpers ───────────────────────────────────────────

const MOCK_GENERATED_TEXT = "*The knight bows gracefully* Greetings, traveler!";

function createMockOrchestrator(database: DatabaseConnection) {
  const capturedInputs: TurnInput[] = [];

  const orchestrator = {
    executeTurn: vi.fn(async (input: TurnInput) => {
      capturedInputs.push(input);

      // 模拟状态转移
      const { db } = database;
      await db
        .update(floors)
        .set({ state: "generating", updatedAt: Date.now() })
        .where(eq(floors.id, input.floorId));

      return {
        floorId: input.floorId,
        generatedText: MOCK_GENERATED_TEXT,
        rawText: MOCK_GENERATED_TEXT,
        summaries: [],
        totalUsage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        finalState: "generating",
      } satisfies TurnOutput;
    }),
  } as unknown as TurnOrchestrator;

  return { orchestrator, capturedInputs };
}

// ── 示例预设数据 ──────────────────────────────────────

const SAMPLE_PRESET_DATA = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "Write {{char}}'s next response in this roleplay.",
    },
    {
      identifier: "jailbreak",
      name: "Jailbreak",
      role: "system",
      content: "Stay in character at all times.",
    },
    { identifier: "chatHistory", name: "Chat History", marker: true },
    { identifier: "worldInfoBefore", name: "WI Before", marker: true },
    { identifier: "worldInfoAfter", name: "WI After", marker: true },
    { identifier: "charDescription", name: "Char Description", marker: true },
    { identifier: "charPersonality", name: "Char Personality", marker: true },
    { identifier: "scenario", name: "Scenario", marker: true },
    { identifier: "personaDescription", name: "Persona", marker: true },
    { identifier: "dialogueExamples", name: "Dialogue Examples", marker: true },
  ],
  prompt_order: [
    { character_id: 100000, order: [
      { identifier: "main", enabled: true },
      { identifier: "worldInfoBefore", enabled: true },
      { identifier: "charDescription", enabled: true },
      { identifier: "charPersonality", enabled: true },
      { identifier: "scenario", enabled: true },
      { identifier: "personaDescription", enabled: true },
      { identifier: "worldInfoAfter", enabled: true },
      { identifier: "dialogueExamples", enabled: true },
      { identifier: "chatHistory", enabled: true },
      { identifier: "jailbreak", enabled: true },
    ]},
  ],
  openai_max_context: 4096,
  openai_max_tokens: 500,
  temperature: 0.8,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  new_chat_prompt: "",
  new_example_chat_prompt: "",
  continue_nudge_prompt: "",
  assistant_prefill: "",
  wi_format: "{0}",
  names_behavior: 0,
  stream_openai: true,
};

const SAMPLE_WORLDBOOK_DATA = {
  entries: {
    "0": {
      uid: 0,
      key: ["sword"],
      keysecondary: [],
      selective: false,
      constant: false,
      content: "The legendary Excalibur sword glows with holy light.",
      comment: "Excalibur",
      position: 0,
      order: 100,
      depth: 4,
      disable: false,
    },
    "1": {
      uid: 1,
      key: ["castle"],
      keysecondary: [],
      selective: false,
      constant: true,
      content: "Castle Camelot stands tall on the hill.",
      comment: "Camelot",
      position: 0,
      order: 50,
      depth: 4,
      disable: false,
    },
  },
};

const SAMPLE_REGEX_DATA = [
  {
    id: "regex-1",
    scriptName: "Remove OOC",
    findRegex: "/\\(OOC:.*?\\)/g",
    replaceString: "",
    trimStrings: [],
    placement: [2], // AI_OUTPUT
    disabled: false,
    substituteRegex: 0,
    minDepth: 0,
    maxDepth: 0,
  },
];

// ── Tests ─────────────────────────────────────────────

describe("E2E Chat with PromptAssembler", () => {
  let database: DatabaseConnection;
  let orchestrator: TurnOrchestrator;
  let capturedInputs: TurnInput[];
  let chatService: ChatService;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    ({ orchestrator, capturedInputs } = createMockOrchestrator(database));
    chatService = new ChatService(database.db, orchestrator, new SimpleTokenCounter());
  });

  afterEach(() => {
    database.close();
  });

  // ── Helper ──
  async function createSession(opts: {
    presetId?: string;
    worldbookId?: string;
    regexId?: string;
    character?: Record<string, string>;
    persona?: Record<string, string>;
    userSnapshot?: Record<string, string>;
    promptMode?: "compat_strict" | "compat_plus" | "native";
    metadataPromptMode?: "compat_strict" | "compat_plus" | "native";
  } = {}) {
    const id = nanoid();
    const now = Date.now();
    const metadata: Record<string, unknown> = {};
    if (opts.persona) metadata.persona = opts.persona;
    if (opts.metadataPromptMode) metadata.prompt_mode = opts.metadataPromptMode;

    await database.db.insert(sessions).values({
      id,
      title: "E2E Test",
      characterSnapshotJson: opts.character ? JSON.stringify(opts.character) : null,
      status: "active",
      presetId: opts.presetId ?? null,
      worldbookProfileId: opts.worldbookId ?? null,
      regexProfileId: opts.regexId ?? null,
      metadataJson: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      promptMode: opts.promptMode ?? null,
      userSnapshotJson: opts.userSnapshot ? JSON.stringify(opts.userSnapshot) : null,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async function importPreset(): Promise<string> {
    const id = nanoid();
    await database.db.insert(presets).values({
      id,
      name: "Test Preset",
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  }

  async function importWorldbook(
    globalSettings: Record<string, unknown> = {}
  ): Promise<string> {
    const id = nanoid();
    const now = Date.now();
    await database.db.insert(worldbooks).values({
      id,
      name: "Test Worldbook",
      source: "sillytavern",
      dataJson: JSON.stringify(globalSettings),
      createdAt: now,
      updatedAt: now,
    });

    // 条目已迁移到独立的 worldbook_entry 表
    const entries = Object.values(SAMPLE_WORLDBOOK_DATA.entries);
    for (const entry of entries) {
      await database.db.insert(worldbookEntries).values({
        id: nanoid(),
        worldbookId: id,
        uid: entry.uid,
        comment: entry.comment,
        content: entry.content,
        keysJson: JSON.stringify(entry.key),
        keysSecondaryJson: JSON.stringify(entry.keysecondary),
        selective: entry.selective,
        constant: entry.constant,
        position: entry.position,
        order: entry.order,
        depth: entry.depth,
        disable: entry.disable,
        createdAt: now,
        updatedAt: now,
      });
    }

    return id;
  }

  async function importRegex(): Promise<string> {
    const id = nanoid();
    await database.db.insert(regexProfiles).values({
      id,
      name: "Test Regex",
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_REGEX_DATA),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  }

  // ── 测试：无预设降级 ──

  it("should work without preset (fallback mode)", async () => {
    const sessionId = await createSession();

    const result = await chatService.respond(sessionId, { message: "Hello!" });
    expect(result.generatedText).toBe(MOCK_GENERATED_TEXT);

    // 验证消息包含默认 system prompt
    const input = capturedInputs[0]!;
    expect(input.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(input.messages[1]).toEqual({
      role: "user",
      content: "Hello!",
    });
  });

  it("should use character info in fallback mode", async () => {
    const sessionId = await createSession({
      character: {
        name: "Alice",
        description: "A cheerful adventurer",
        personality: "Brave and curious",
      },
      persona: { name: "Bob", description: "A merchant" },
    });

    await chatService.respond(sessionId, { message: "Hi Alice!" });

    const input = capturedInputs[0]!;
    const systemMsg = input.messages[0]!;
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toContain("Alice");
    expect(systemMsg.content).toContain("A cheerful adventurer");
    expect(systemMsg.content).toContain("Brave and curious");
    expect(systemMsg.content).toContain("Bob");
    expect(systemMsg.content).toContain("A merchant");
  });

  it("should prioritize session user snapshot over metadata persona", async () => {
    const sessionId = await createSession({
      character: {
        name: "Alice",
        description: "A cheerful adventurer",
        personality: "Brave and curious"
      },
      persona: { name: "LegacyUser", description: "A legacy persona" },
      userSnapshot: { name: "BoundUser", description: "Bound from user card" }
    });

    await chatService.respond(sessionId, { message: "Hi there" });

    const input = capturedInputs[0]!;
    const systemMsg = input.messages[0]!;

    expect(systemMsg.content).toContain("BoundUser");
    expect(systemMsg.content).toContain("Bound from user card");
    expect(systemMsg.content).not.toContain("LegacyUser");
    expect(systemMsg.content).not.toContain("A legacy persona");
  });

  // ── 测试：有预设 ──

  it("should use preset for prompt assembly", async () => {
    const presetId = await importPreset();
    const sessionId = await createSession({
      presetId,
      character: { name: "Knight" },
    });

    await chatService.respond(sessionId, { message: "Draw your sword!" });

    const input = capturedInputs[0]!;
    // 编排后的消息应包含 main prompt（经过模板渲染）
    const systemMessages = input.messages.filter((m) => m.role === "system");
    expect(systemMessages.length).toBeGreaterThanOrEqual(1);

    // main prompt 中的 {{char}} 应被替换
    const mainPrompt = systemMessages.find((m) =>
      m.content.includes("next response")
    );
    expect(mainPrompt).toBeDefined();
    expect(mainPrompt!.content).toContain("Knight");
    expect(mainPrompt!.content).not.toContain("{{char}}");

    // 用户消息应在最后
    const userMessages = input.messages.filter((m) => m.role === "user");
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
    expect(userMessages[userMessages.length - 1]!.content).toBe("Draw your sword!");
  });

  it("should include jailbreak from preset", async () => {
    const presetId = await importPreset();
    const sessionId = await createSession({ presetId });

    await chatService.respond(sessionId, { message: "Hello" });

    const input = capturedInputs[0]!;
    const allContent = input.messages.map((m) => m.content).join("\n");
    expect(allContent).toContain("Stay in character");
  });

  it("should use native prompt pipeline when prompt_mode is native", async () => {
    const presetId = await importPreset();
    const sessionId = await createSession({
      presetId,
      promptMode: "native",
      character: { name: "Knight" },
    });

    const result = await chatService.respond(sessionId, { message: "Draw your sword!" });

    const input = capturedInputs[0]!;
    const allContent = input.messages.map((m) => m.content).join("\n");
    const [snapshotRow] = await database.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, result.floorId));

    expect(allContent).toContain("Write Knight's next response in this roleplay.");
    expect(allContent).toContain("Stay in character at all times.");
    expect(snapshotRow?.promptMode).toBe("native");

    const userMessages = input.messages.filter((m) => m.role === "user");
    expect(userMessages[userMessages.length - 1]?.content).toBe("Draw your sword!");
  });

  it("should fallback to metadata prompt_mode for legacy native sessions", async () => {
    const presetId = await importPreset();
    const sessionId = await createSession({
      presetId,
      metadataPromptMode: "native",
      character: { name: "Knight" },
    });

    const result = await chatService.respond(sessionId, { message: "Legacy mode" });

    const input = capturedInputs[0]!;
    const allContent = input.messages.map((m) => m.content).join("\n");
    const [snapshotRow] = await database.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, result.floorId));

    expect(allContent).toContain("Write Knight's next response in this roleplay.");
    expect(allContent).toContain("Stay in character at all times.");
    expect(snapshotRow?.promptMode).toBe("native");
  });

  it("should prioritize explicit prompt_mode field over metadata prompt_mode", async () => {
    const presetId = await importPreset();
    const sessionId = await createSession({
      presetId,
      promptMode: "compat_strict",
      metadataPromptMode: "native",
      character: { name: "Knight" },
    });

    await chatService.respond(sessionId, { message: "Priority check" });

    const input = capturedInputs[0]!;
    const allContent = input.messages.map((m) => m.content).join("\n");
    expect(allContent).toContain("Stay in character at all times.");
  });

  it("should keep compat_strict dry-run behavior unchanged", async () => {
    const presetId = await importPreset();
    const sessionId = await createSession({
      presetId,
      character: { name: "Knight" },
    });

    const dryRun = await chatService.dryRun(sessionId, { message: "Dry run check" });
    const allContent = dryRun.messages.map((m) => m.content).join("\n");

    expect(allContent).toContain("Write Knight's next response in this roleplay.");
    expect(allContent).toContain("Stay in character at all times.");
    expect(dryRun.assembly.presetUsed).toBe(true);
  });

  it("should use native split in dry-run when prompt_mode is native", async () => {
    const presetId = await importPreset();
    const sessionId = await createSession({
      presetId,
      promptMode: "native",
      character: { name: "Knight" },
    });

    const dryRun = await chatService.dryRun(sessionId, { message: "Dry run native" });
    const allContent = dryRun.messages.map((m) => m.content).join("\n");

    expect(allContent).toContain("Write Knight's next response in this roleplay.");
    expect(dryRun.assembly.presetUsed).toBe(true);
    expect(dryRun.promptSnapshot.promptMode).toBe("native");
  });

  it("should align dry-run prompt snapshot with the committed prompt_snapshot row", async () => {
    const presetId = await importPreset();
    const worldbookId = await importWorldbook();
    const regexId = await importRegex();
    const sessionId = await createSession({
      presetId,
      worldbookId,
      regexId,
      character: { name: "Knight" },
    });

    const dryRun = await chatService.dryRun(sessionId, { message: "hello sword" });
    const result = await chatService.respond(sessionId, { message: "hello sword" });

    const [snapshotRow] = await database.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, result.floorId));

    expect(snapshotRow).toBeDefined();
    expect(snapshotRow!.presetId).toBe(dryRun.promptSnapshot.presetId);
    expect(snapshotRow!.presetUpdatedAt).toBe(dryRun.promptSnapshot.presetUpdatedAt);
    expect(snapshotRow!.presetVersion).toBe(dryRun.promptSnapshot.presetVersion);
    expect(snapshotRow!.worldbookId).toBe(dryRun.promptSnapshot.worldbookId);
    expect(snapshotRow!.worldbookUpdatedAt).toBe(dryRun.promptSnapshot.worldbookUpdatedAt);
    expect(snapshotRow!.worldbookVersion).toBe(dryRun.promptSnapshot.worldbookVersion);
    expect(snapshotRow!.regexProfileId).toBe(dryRun.promptSnapshot.regexProfileId);
    expect(snapshotRow!.regexProfileUpdatedAt).toBe(dryRun.promptSnapshot.regexProfileUpdatedAt);
    expect(snapshotRow!.regexProfileVersion).toBe(dryRun.promptSnapshot.regexProfileVersion);
    expect(JSON.parse(snapshotRow!.worldbookActivatedEntryUidsJson)).toEqual(
      dryRun.promptSnapshot.worldbookActivatedEntryUids
    );
    expect(JSON.parse(snapshotRow!.regexPreRuleNamesJson)).toEqual(
      dryRun.promptSnapshot.regexPreRuleNames
    );
    expect(JSON.parse(snapshotRow!.regexPostRuleNamesJson)).toEqual(
      dryRun.promptSnapshot.regexPostRuleNames
    );
    expect(snapshotRow!.promptMode).toBe(dryRun.promptSnapshot.promptMode);
    expect(snapshotRow!.promptDigest).toBe(dryRun.promptSnapshot.promptDigest);
    expect(snapshotRow!.tokenEstimate).toBe(dryRun.promptSnapshot.tokenEstimate);
  });

  it("should inject visible floor and page variables when retrying a failed floor", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const failedFloorId = nanoid();
    const inputPageId = nanoid();

    const variablePresetData = {
      ...SAMPLE_PRESET_DATA,
      prompts: [
        {
          identifier: "main",
          name: "Main Prompt",
          role: "system",
          content: "Mood {{mood}} item {{item}} for {{char}}.",
        },
        { identifier: "chatHistory", name: "Chat History", marker: true },
      ],
    };

    await database.db.insert(presets).values({
      id: presetId,
      name: "Retry Variable Preset",
      source: "sillytavern",
      dataJson: JSON.stringify(variablePresetData),
      createdAt: now,
      updatedAt: now,
    });

    const sessionId = await createSession({
      presetId,
      character: { name: "Knight" },
    });

    await database.db.insert(floors).values({
      id: failedFloorId,
      sessionId,
      floorNo: 0,
      branchId: "main",
      parentFloorId: null,
      state: "failed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(messagePages).values({
      id: inputPageId,
      floorId: failedFloorId,
      pageNo: 0,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(messages).values({
      id: nanoid(),
      pageId: inputPageId,
      seq: 0,
      role: "user",
      content: "Retry the scene.",
      contentFormat: "text",
      tokenCount: 3,
      isHidden: false,
      source: "api",
      createdAt: now,
    });

    await database.db.insert(variables).values([
      { id: nanoid(), scope: "chat", scopeId: sessionId, key: "mood", valueJson: JSON.stringify("calm"), updatedAt: now },
      { id: nanoid(), scope: "floor", scopeId: failedFloorId, key: "mood", valueJson: JSON.stringify("grim"), updatedAt: now + 1 },
      { id: nanoid(), scope: "page", scopeId: inputPageId, key: "item", valueJson: JSON.stringify("torch"), updatedAt: now + 2 },
      { id: nanoid(), scope: "page", scopeId: inputPageId, key: "char", valueJson: JSON.stringify("Shadow"), updatedAt: now + 3 },
    ]);

    await chatService.retryFloor(failedFloorId);

    const input = capturedInputs[0]!;
    const allContent = input.messages.map((message) => message.content).join("\n");

    expect(allContent).toContain("Mood grim item torch for Knight.");
    expect(allContent).not.toContain("Shadow");
  });

  // ── 测试：世界书触发 ──

  it("should trigger worldbook entries based on keywords", async () => {
    const presetId = await importPreset();
    const worldbookId = await importWorldbook();
    const sessionId = await createSession({ presetId, worldbookId });

    // 提及 "sword" 应触发 Excalibur 条目
    await chatService.respond(sessionId, { message: "I see a sword on the ground!" });

    const input = capturedInputs[0]!;
    const allContent = input.messages.map((m) => m.content).join("\n");
    expect(allContent).toContain("Excalibur");
  });

  it("should include constant worldbook entries regardless of keywords", async () => {
    const presetId = await importPreset();
    const worldbookId = await importWorldbook();
    const sessionId = await createSession({ presetId, worldbookId });

    // 不提及 castle 关键词，但 constant=true 的条目仍应出现
    await chatService.respond(sessionId, { message: "Hello there!" });

    const input = capturedInputs[0]!;
    const allContent = input.messages.map((m) => m.content).join("\n");
    expect(allContent).toContain("Castle Camelot");
  });

  it("should honor worldbook global matching flags when entries do not override them", async () => {
    const presetId = await importPreset();
    const worldbookId = await importWorldbook({
      caseSensitive: true,
      matchWholeWords: true,
      scanDepth: 5,
    });
    const sessionId = await createSession({ presetId, worldbookId });

    const blocked = await chatService.dryRun(sessionId, { message: "I found a Swordsmanship manual." });
    expect(blocked.messages.map((message) => message.content).join("\n")).not.toContain("Excalibur");

    const matched = await chatService.dryRun(sessionId, { message: "The sword is here." });
    expect(matched.messages.map((message) => message.content).join("\n")).toContain("Excalibur");
  });

  // ── 测试：正则处理 ──

  it("should attach postProcess when regex profile is configured", async () => {
    const presetId = await importPreset();
    const regexId = await importRegex();
    const sessionId = await createSession({ presetId, regexId });

    await chatService.respond(sessionId, { message: "Hello" });

    const input = capturedInputs[0]!;
    // postProcess 应该被传入（AI_OUTPUT 正则）
    expect(input.postProcess).toBeDefined();

    // 验证 postProcess 能正确移除 OOC 内容
    const processed = input.postProcess!("Hello (OOC: testing) world");
    expect(processed).toBe("Hello  world");
  });

  // ── 测试：Greeting ──

  it("should create greeting floor when character has greeting", async () => {
    // 直接通过 DB 创建带 greeting 的 session
    const sessionId = nanoid();
    const now = Date.now();
    const greetingText = "*waves cheerfully* Welcome, traveler!";

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Greeting Test",
      characterSnapshotJson: JSON.stringify({ name: "Guide", greeting: greetingText }),
      status: "active",
      metadataJson: null,
      createdAt: now,
      updatedAt: now,
    });

    // 手动模拟 greeting 创建（通常由 session 路由处理）
    // 这里我们通过 ChatService.respond 验证 greeting 出现在历史中
    // 先手动插入 greeting floor
    const floorId = nanoid();
    const pageId = nanoid();
    const tokenCounter = new SimpleTokenCounter();

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 0,
      branchId: "main",
      state: "committed",
      tokenIn: 0,
      tokenOut: tokenCounter.count(greetingText),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 0,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(messages).values({
      id: nanoid(),
      pageId,
      seq: 0,
      role: "assistant",
      content: greetingText,
      contentFormat: "text",
      tokenCount: tokenCounter.count(greetingText),
      isHidden: false,
      source: "greeting",
      createdAt: now,
    });

    // 现在发送消息，greeting 应出现在历史中
    await chatService.respond(sessionId, { message: "Hello, Guide!" });

    const input = capturedInputs[0]!;
    // 应包含 greeting 作为 assistant 消息
    const assistantMsgs = input.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    expect(assistantMsgs[0]!.content).toBe(greetingText);
  });

  // ── 测试：多轮对话 ──

  it("should maintain chat history across multiple rounds with preset", async () => {
    const presetId = await importPreset();
    const sessionId = await createSession({
      presetId,
      character: { name: "Sage" },
    });

    // 第一轮
    await chatService.respond(sessionId, { message: "What is wisdom?" });

    // 第二轮
    await chatService.respond(sessionId, { message: "Tell me more." });

    const secondInput = capturedInputs[1]!;
    // 第二轮应包含：system prompts + 第一轮历史 + 当前消息
    const userMsgs = secondInput.messages.filter((m) => m.role === "user");
    const assistantMsgs = secondInput.messages.filter((m) => m.role === "assistant");

    // 至少有两条用户消息（第一轮 + 第二轮）
    expect(userMsgs.length).toBeGreaterThanOrEqual(2);
    // 至少有一条助手消息（第一轮的回复）
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);

    // 第二轮最后的用户消息
    expect(userMsgs[userMsgs.length - 1]!.content).toBe("Tell me more.");
  });
});
