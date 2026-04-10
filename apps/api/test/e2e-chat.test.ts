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
import { eq, asc, and } from "drizzle-orm";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
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
import { buildBranchVariableScopeId } from "@tavern/shared";

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
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
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
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
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
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
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
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
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
    expect(systemMsg.content).toContain("A cheerful adventurer");
    expect(systemMsg.content).toContain("Brave and curious");
    expect(systemMsg.content).toContain("A merchant");
    expect(systemMsg.content).not.toContain("BoundUser");
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

    expect(systemMsg.content).not.toContain("LegacyUser");
    expect(systemMsg.content).toContain("Bound from user card");
    expect(systemMsg.content).not.toContain("LegacyUser");
    expect(systemMsg.content).not.toContain("A legacy persona");
  });

  // ── 测试：有预设 ──

  it("should use preset for prompt assembly", async () => {
    const presetId = await importPreset();
    const sessionId = await createSession({
      presetId,
      character: {
        name: "Sir Galahad",
        description: "A noble knight of the Round Table.",
        personality: "Honorable and brave.",
      },
      persona: {
        name: "Traveler",
        description: "A wanderer seeking shelter.",
      },
    });

    const result = await chatService.respond(sessionId, { message: "Tell me of this place." });
    expect(result.generatedText).toBe(MOCK_GENERATED_TEXT);

    const input = capturedInputs[0]!;
    expect(input.messages.some((message) =>
      message.role === "system" && message.content.includes("Write Sir Galahad's next response in this roleplay.")
    )).toBe(true);
    expect(input.messages.some((message) =>
      message.role === "system" && message.content.includes("Stay in character at all times.")
    )).toBe(true);
  });

  it("should inject worldbook and regex resources into prompt assembly", async () => {
    const presetId = await importPreset();
    const worldbookId = await importWorldbook();
    const regexId = await importRegex();
    const sessionId = await createSession({
      presetId,
      worldbookId,
      regexId,
      character: {
        name: "Sir Galahad",
        description: "A noble knight of the Round Table.",
        personality: "Honorable and brave.",
      },
      persona: {
        name: "Traveler",
        description: "A wanderer seeking shelter.",
      },
    });

    await chatService.respond(sessionId, { message: "Tell me about the castle and sword." });

    const input = capturedInputs[0]!;
    expect(input.messages.some((message) => message.content.includes("Castle Camelot stands tall on the hill."))).toBe(true);
    expect(input.messages.some((message) => message.content.includes("The legendary Excalibur sword glows with holy light."))).toBe(true);
  });

  it("commits staged macro mutations in respond flow", async () => {
    const presetId = nanoid();
    const now = Date.now();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Macro Respond Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{setvar::mood::happy}}{{setglobalvar::world_rule::magic has a price}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionId = await createSession({
      presetId,
      character: { name: "Knight" },
      userSnapshot: { name: "Traveler" },
      promptMode: "compat_strict",
    });

    const result = await chatService.respond(sessionId, { message: "Advance." });
    expect(result.finalState).toBe("committed");
    expect(result.branchId).toBe("main");

    const [snapshot] = await database.db.select().from(promptSnapshots).where(eq(promptSnapshots.floorId, result.floorId));
    expect(snapshot).toBeTruthy();
  });

  it("commits staged macro mutations in regenerate flow", async () => {
    const presetId = nanoid();
    const now = Date.now();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Macro Regenerate Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{setvar::regen_flag::yes}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionId = await createSession({
      presetId,
      character: { name: "Knight" },
      userSnapshot: { name: "Traveler" },
      promptMode: "compat_strict",
    });

    const initial = await chatService.respond(sessionId, { message: "First turn." });
    const regenerated = await chatService.regenerate(sessionId);

    expect(regenerated.finalState).toBe("committed");

    expect(regenerated.previousFloorId).toBe(initial.floorId);
  });

  it("commits staged macro mutations in retry flow", async () => {
    const presetId = nanoid();
    const now = Date.now();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Macro Retry Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{setvar::retry_flag::done}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionId = await createSession({
      presetId,
      character: { name: "Knight" },
      userSnapshot: { name: "Traveler" },
      promptMode: "compat_strict",
    });

    const initial = await chatService.respond(sessionId, { message: "Retry me." });
    const retried = await chatService.retryFloor(initial.floorId);
    expect(retried.floorId).toBe(initial.floorId);
    expect(retried.finalState).toBe("committed");
  });

  it("commits staged macro mutations in editAndRegenerate flow", async () => {
    const presetId = nanoid();
    const now = Date.now();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Macro Edit Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{setvar::edited_flag::branch-edit}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionId = await createSession({
      presetId,
      character: { name: "Knight" },
      userSnapshot: { name: "Traveler" },
      promptMode: "compat_strict",
    });

    const initial = await chatService.respond(sessionId, { message: "Original." });

    const inputPages = await database.db.select().from(messagePages).where(and(
      eq(messagePages.floorId, initial.floorId),
      eq(messagePages.pageKind, "input"),
      eq(messagePages.isActive, true),
    ));
    const inputPage = inputPages[0];
    expect(inputPage).toBeTruthy();

    const inputMessages = await database.db.select().from(messages).where(eq(messages.pageId, inputPage!.id)).orderBy(asc(messages.seq));
    const sourceMessage = inputMessages.find((message) => message.role === "user");
    expect(sourceMessage).toBeTruthy();

    const edited = await chatService.editAndRegenerate(sourceMessage!.id, {
      content: "Edited.",
      branchId: "branch-edit",
    });

    expect(edited.sourceFloorId).toBe(initial.floorId);
    expect(edited.branchId).toBe("branch-edit");
  });

  it("does not persist staged macro mutations when orchestration fails", async () => {
    const presetId = nanoid();
    const now = Date.now();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Macro Failure Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{setvar::failed_flag::should-not-persist}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const failingOrchestrator = {
      executeTurn: vi.fn(async (_input: TurnInput) => {
        throw new Error("mock orchestration failure");
      }),
    } as unknown as TurnOrchestrator;
    const failingChatService = new ChatService(database.db, failingOrchestrator, new SimpleTokenCounter());

    const sessionId = await createSession({
      presetId,
      character: { name: "Knight" },
      userSnapshot: { name: "Traveler" },
      promptMode: "compat_strict",
    });

    await expect(failingChatService.respond(sessionId, { message: "Fail." })).rejects.toBeInstanceOf(ChatServiceError);

    const branchVariables = await database.db.select().from(variables).where(and(
      eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
      eq(variables.scope, "branch"),
      eq(variables.scopeId, buildBranchVariableScopeId(sessionId, "main")),
      eq(variables.key, "failed_flag"),
    ));
    expect(branchVariables).toHaveLength(0);
  });

  // ── 测试：异常与边界 ──

  it("should throw session_not_found for missing session", async () => {
    await expect(chatService.respond("missing-session", { message: "Hello" }))
      .rejects.toThrow(ChatServiceError);

    await expect(chatService.respond("missing-session", { message: "Hello" }))
      .rejects.toMatchObject({ code: "session_not_found" });
  });

  it("should reject archived session", async () => {
    const sessionId = nanoid();
    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Archived Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "archived",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await expect(chatService.respond(sessionId, { message: "Hello" }))
      .rejects.toMatchObject({ code: "session_archived" });
  });
});
