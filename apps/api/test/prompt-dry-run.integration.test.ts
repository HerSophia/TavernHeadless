import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { registerChatRoutes } from "../src/routes/chat";
import { ChatService, ChatServiceError, type ChatService as ChatServiceType, type DryRunResult } from "../src/services/chat-service";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import {
  accounts,
  floors,
  messagePages,
  messages as messageTable,
  presets,
  promptSnapshots,
  regexProfiles,
  sessions,
  worldbookEntries,
  variables,
  worldbooks,
} from "../src/db/schema";
import { SimpleTokenCounter, type TurnOrchestrator } from "@tavern/core";
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth";

interface ChatServiceStub {
  respond: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
  dryRun: ReturnType<typeof vi.fn>;
  retryFloor: ReturnType<typeof vi.fn>;
  editAndRegenerate: ReturnType<typeof vi.fn>;
}

function createRouteChatService(overrides: Partial<ChatServiceStub> = {}): ChatServiceStub {
  return {
    respond: vi.fn(),
    regenerate: vi.fn(),
    dryRun: vi.fn(),
    retryFloor: vi.fn(),
    editAndRegenerate: vi.fn(),
    ...overrides,
  };
}

const SAMPLE_PRESET_DATA = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "Write {{char}}'s next response.",
    },
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
  assistant_prefill: "",
  wi_format: "{0}",
  names_behavior: 0,
  stream_openai: true,
};

const SAMPLE_REGEX_DATA = [
  {
    id: "regex-1",
    scriptName: "Input Rule",
    findRegex: "/hello/g",
    replaceString: "HELLO",
    trimStrings: [],
    placement: [1],
    disabled: false,
    substituteRegex: 0,
    minDepth: 0,
    maxDepth: 0,
  },
];

describe("POST /sessions/:id/respond/dry-run", () => {
  let app: FastifyInstance;

  async function mountChatRoutes(
    chatService: ChatServiceStub,
    options: { enablePromptDryRun?: boolean; enableSseChat?: boolean } = {}
  ) {
    app = Fastify({ logger: false });
    await registerDevelopmentTestAuth(app);
    await registerChatRoutes(
      app,
      chatService as unknown as ChatServiceType,
      { enablePromptDryRun: true, enableSseChat: false, ...options }
    );
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  it("returns 404 when dry-run endpoint is disabled", async () => {
    const chatService = createRouteChatService();

    await mountChatRoutes(chatService, { enablePromptDryRun: false });

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
    const result: DryRunResult = {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hello" },
      ],
      tokenEstimate: 42,
      availableForReply: 1000,
      memorySummary: "[Memory] hello",
      promptSnapshot: {
        presetId: "preset-1",
        presetUpdatedAt: 1710000000000,
        presetVersion: 3,
        worldbookId: "worldbook-1",
        worldbookUpdatedAt: 1710000001000,
        worldbookVersion: 5,
        regexProfileId: "regex-1",
        regexProfileUpdatedAt: 1710000002000,
        regexProfileVersion: 2,
        worldbookActivatedEntryUids: [7],
        regexPreRuleNames: ["Input Rule"],
        regexPostRuleNames: [],
        promptMode: "compat_strict",
        promptDigest: "digest-1",
        tokenEstimate: 42,
      },
      assembly: {
        mode: "fallback",
        promptIntent: "continue",
        assistantPrefillApplied: true,
        assistantPrefillStrategy: "assistant_message_fallback",
        presetUsed: false,
        selectedPromptOrderCharacterId: 100000,
        ignoredPromptOrderCharacterIds: [200001],
        worldbookHits: 0,
        regexPreRules: ["Input Rule"],
        regexPostRules: [],
        memorySummaryInjected: true,
        reservedVariableCollisions: [],
        unsupportedPresetFields: [],
        ignoredPresetFields: ["top_level.openai_model"],
        unresolvedPresetMarkers: ["customMarker"],
        presetWarnings: [
          "检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。",
        ],
        continueNudgeApplied: true,
        continueNudgeText: "[Continue]",
        namesBehaviorApplied: "always",
        triggerFilteredEntryIds: ["quietPrompt"],
        inChatInsertedEntryIds: ["continueHint"],
        preprocessedUserMessage: "hello",
      },
    };

    const chatService = createRouteChatService({
      dryRun: vi.fn(async () => result),
    });

    await mountChatRoutes(chatService, { enablePromptDryRun: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/dry-run",
      payload: { message: "hello", prompt_intent: "continue" },
    });

    expect(response.statusCode).toBe(200);
    expect(chatService.dryRun).toHaveBeenCalledOnce();
    expect(chatService.dryRun).toHaveBeenCalledWith("s1", { message: "hello", promptIntent: "continue" }, "default-admin");

    const body = response.json() as { data: Record<string, unknown> };
    expect(body.data.token_estimate).toBe(42);
    expect(body.data.available_for_reply).toBe(1000);
    expect(body.data.memory_summary).toBe("[Memory] hello");
    expect(body.data.messages).toEqual(result.messages);
    expect(body.data.prompt_snapshot).toEqual({
      preset_id: "preset-1",
      preset_updated_at: 1710000000000,
      preset_version: 3,
      worldbook_id: "worldbook-1",
      worldbook_updated_at: 1710000001000,
      worldbook_version: 5,
      regex_profile_id: "regex-1",
      regex_profile_updated_at: 1710000002000,
      regex_profile_version: 2,
      worldbook_activated_entry_uids: [7],
      regex_pre_rule_names: ["Input Rule"],
      regex_post_rule_names: [],
      prompt_mode: "compat_strict",
      prompt_digest: "digest-1",
      token_estimate: 42,
    });
    expect(body.data.assembly).toEqual({
      mode: "fallback",
      prompt_intent: "continue",
      assistant_prefill_applied: true,
      assistant_prefill_strategy: "assistant_message_fallback",
      preset_used: false,
      worldbook_hits: 0,
      selected_prompt_order_character_id: 100000,
      ignored_prompt_order_character_ids: [200001],
      regex_pre_rules: ["Input Rule"],
      regex_post_rules: [],
      memory_summary_injected: true,
      reserved_variable_collisions: [],
      unsupported_preset_fields: [],
      ignored_preset_fields: ["top_level.openai_model"],
      unresolved_preset_markers: ["customMarker"],
      preset_warnings: ["检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。"],
      continue_nudge_applied: true,
      continue_nudge_text: "[Continue]",
      names_behavior_applied: "always",
      trigger_filtered_entry_ids: ["quietPrompt"],
      in_chat_inserted_entry_ids: ["continueHint"],
      preprocessed_user_message: "hello",
    });
  });

  it("returns null for optional debug fields when they are absent", async () => {
    const result: DryRunResult = {
      messages: [{ role: "user", content: "hello" }],
      tokenEstimate: 12,
      availableForReply: 256,
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
        regexPostRuleNames: ["Output Rule"],
        promptMode: "compat_strict",
        promptDigest: "digest-2",
        tokenEstimate: 12,
      },
      assembly: {
        mode: "preset",
        promptIntent: "normal",
        assistantPrefillApplied: false,
        assistantPrefillStrategy: "none",
        presetUsed: true,
        selectedPromptOrderCharacterId: null,
        ignoredPromptOrderCharacterIds: [],
        worldbookHits: 1,
        regexPreRules: [],
        regexPostRules: ["Output Rule"],
        memorySummaryInjected: false,
        reservedVariableCollisions: [],
        unsupportedPresetFields: [],
        ignoredPresetFields: [],
        unresolvedPresetMarkers: [],
        presetWarnings: [],
        continueNudgeApplied: false,
        continueNudgeText: undefined,
        namesBehaviorApplied: "off",
        triggerFilteredEntryIds: [],
        inChatInsertedEntryIds: [],
      },
    };

    const chatService = createRouteChatService({
      dryRun: vi.fn(async () => result),
    });

    await mountChatRoutes(chatService, { enablePromptDryRun: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/dry-run",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        messages: [{ role: "user", content: "hello" }],
        token_estimate: 12,
        available_for_reply: 256,
        memory_summary: null,
        prompt_snapshot: {
          preset_id: null,
          preset_updated_at: null,
          preset_version: null,
          worldbook_id: null,
          worldbook_updated_at: null,
          worldbook_version: null,
          regex_profile_id: null,
          regex_profile_updated_at: null,
          regex_profile_version: null,
          worldbook_activated_entry_uids: [],
          regex_pre_rule_names: [],
          regex_post_rule_names: ["Output Rule"],
          prompt_mode: "compat_strict",
          prompt_digest: "digest-2",
          token_estimate: 12,
        },
        assembly: {
          mode: "preset",
          prompt_intent: "normal",
          assistant_prefill_applied: false,
          assistant_prefill_strategy: "none",
          preset_used: true,
          selected_prompt_order_character_id: null,
          ignored_prompt_order_character_ids: [],
          worldbook_hits: 1,
          regex_pre_rules: [],
          regex_post_rules: ["Output Rule"],
          memory_summary_injected: false,
          reserved_variable_collisions: [],
          unsupported_preset_fields: [],
          ignored_preset_fields: [],
          unresolved_preset_markers: [],
          preset_warnings: [],
          continue_nudge_applied: false,
          continue_nudge_text: null,
          names_behavior_applied: "off",
          trigger_filtered_entry_ids: [],
          in_chat_inserted_entry_ids: [],
          preprocessed_user_message: null,
        },
      },
    });
  });

  it("maps chat service errors when enabled", async () => {
    const chatService = createRouteChatService({
      dryRun: vi.fn(async () => {
        throw new ChatServiceError("session_archived", "Cannot dry-run in an archived session");
      }),
    });

    await mountChatRoutes(chatService, { enablePromptDryRun: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/dry-run",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "session_archived",
        message: "Cannot dry-run in an archived session",
      },
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
    const promptSnapshotsBefore = await database.db.select().from(promptSnapshots);

    const result = await chatService.dryRun(sessionId, { message: "hello dry run" });

    expect(result.messages[result.messages.length - 1]?.content).toBe("hello dry run");
    expect(result.tokenEstimate).toBeGreaterThan(0);
    expect(result.promptSnapshot.presetId).toBeNull();
    expect(result.promptSnapshot.worldbookActivatedEntryUids).toEqual([]);
    expect(result.promptSnapshot.promptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(mockOrchestrator.executeTurn).not.toHaveBeenCalled();

    const floorsAfter = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    const messagesAfter = await database.db.select().from(messageTable);
    const promptSnapshotsAfter = await database.db.select().from(promptSnapshots);

    expect(floorsAfter).toEqual(floorsBefore);
    expect(messagesAfter).toEqual(messagesBefore);
    expect(promptSnapshotsAfter).toEqual(promptSnapshotsBefore);
  });

  it("returns prompt snapshot preview for loaded resources without persisting prompt_snapshot rows", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();
    const regexProfileId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Preset",
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Dry Run Worldbook",
      source: "sillytavern",
      dataJson: JSON.stringify({ scanDepth: 3 }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 7,
      comment: "Sword",
      content: "A blessed sword rests in the shrine.",
      keysJson: JSON.stringify(["sword"]),
      keysSecondaryJson: JSON.stringify([]),
      selective: false,
      selectiveLogic: 0,
      constant: false,
      position: 0,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(regexProfiles).values({
      id: regexProfileId,
      name: "Dry Run Regex",
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_REGEX_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        worldbookProfileId: worldbookId,
        regexProfileId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, { message: "hello sword" });

    expect(result.promptSnapshot).toMatchObject({
      presetId,
      presetUpdatedAt: now,
      presetVersion: 1,
      worldbookId,
      worldbookUpdatedAt: now,
      worldbookVersion: 1,
      regexProfileId,
      regexProfileUpdatedAt: now,
      regexProfileVersion: 1,
      worldbookActivatedEntryUids: [7],
      regexPreRuleNames: ["Input Rule"],
      regexPostRuleNames: [],
      promptMode: "compat_strict",
      tokenEstimate: result.tokenEstimate,
    });
    expect(result.promptSnapshot.promptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await database.db.select().from(promptSnapshots)).toEqual([]);
  });

  it("reports assistant prefill runtime semantics without materializing it into dry-run message history", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Prefill Preset",
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        assistant_prefill: "Knight:",
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, { message: "hello prefill" });
    const visibleTokenCounter = new SimpleTokenCounter();
    const visibleTokenEstimate = result.messages.reduce((sum, message) => sum + visibleTokenCounter.count(message.content), 0);

    expect(result.messages.some((message) => message.role === "assistant" && message.content === "Knight:")).toBe(false);
    expect(result.messages.some((message) => message.role === "user" && message.content.includes("hello prefill"))).toBe(true);
    expect(result.assembly.assistantPrefillApplied).toBe(true);
    expect(result.assembly.assistantPrefillStrategy).toBe("assistant_message_fallback");
    expect(result.assembly.unsupportedPresetFields).not.toContain("assistant_prefill");
    expect(result.tokenEstimate).toBeGreaterThan(visibleTokenEstimate);
    expect(result.promptSnapshot.tokenEstimate).toBe(result.tokenEstimate);
  });

  it("injects persisted visible variables into dry-run prompt assembly and reports reserved alias collisions", async () => {
    const now = Date.now();
    const presetId = nanoid();

    const variablePresetData = {
      ...SAMPLE_PRESET_DATA,
      prompts: [
        {
          identifier: "main",
          name: "Main Prompt",
          role: "system",
          content: "Mood {{mood}} for {{char}} and {{user}}.",
        },
        { identifier: "chatHistory", name: "Chat History", marker: true },
      ],
    };

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Variable Preset",
      source: "sillytavern",
      dataJson: JSON.stringify(variablePresetData),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        userSnapshotJson: JSON.stringify({ name: "Traveler" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    await database.db.insert(variables).values([
      { id: nanoid(), scope: "global", scopeId: "global", key: "mood", valueJson: JSON.stringify("calm"), updatedAt: now },
      { id: nanoid(), scope: "chat", scopeId: sessionId, key: "mood", valueJson: JSON.stringify("focused"), updatedAt: now + 1 },
      { id: nanoid(), scope: "global", scopeId: "global", key: "char", valueJson: JSON.stringify("Shadow"), updatedAt: now + 2 },
      { id: nanoid(), scope: "global", scopeId: "global", key: "user", valueJson: JSON.stringify("Stranger"), updatedAt: now + 3 },
    ]);

    const result = await chatService.dryRun(sessionId, { message: "hello variables" });
    const allContent = result.messages.map((message) => message.content).join("\n");

    expect(allContent).toContain("Mood focused for Knight and Traveler.");
    expect(result.assembly.reservedVariableCollisions).toEqual(["char", "user"]);
  });

  it("does not load prompt resources owned by another account", async () => {
    const now = Date.now();
    const otherAccountId = "acc-other";
    const presetId = nanoid();
    const worldbookId = nanoid();
    const regexProfileId = nanoid();

    await database.db.insert(accounts).values({
      id: otherAccountId,
      name: "Other Account",
      role: "user",
      status: "active",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Foreign Preset",
      source: "sillytavern",
      accountId: otherAccountId,
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Foreign Worldbook",
      source: "sillytavern",
      accountId: otherAccountId,
      dataJson: JSON.stringify({}),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 9,
      comment: "Foreign entry",
      content: "Hidden foreign lore.",
      keysJson: JSON.stringify(["foreign"]),
      keysSecondaryJson: JSON.stringify([]),
      selective: false,
      selectiveLogic: 0,
      constant: true,
      position: 0,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(regexProfiles).values({
      id: regexProfileId,
      name: "Foreign Regex",
      source: "sillytavern",
      accountId: otherAccountId,
      dataJson: JSON.stringify(SAMPLE_REGEX_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        worldbookProfileId: worldbookId,
        regexProfileId,
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, { message: "hello foreign" });

    expect(result.messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
    expect(result.promptSnapshot).toMatchObject({
      presetId: null,
      worldbookId: null,
      regexProfileId: null,
      worldbookActivatedEntryUids: [],
      regexPreRuleNames: [],
      regexPostRuleNames: [],
    });
  });
});
