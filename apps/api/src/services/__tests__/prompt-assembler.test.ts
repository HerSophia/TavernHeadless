import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { buildBranchVariableScopeId } from "@tavern/shared";

import { presets, messagePages, variables, floors, sessions } from "../../db/schema.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import {
  assemblePrompt,
  buildPromptAssemblyCompat,
  buildPromptRuntimeTrace,
  materializePromptRuntimeMessages,
  resolveEffectivePromptBudget,
  type AssembleDebugInfo,
  type PromptRuntimeTrace,
  type SessionPromptInfo,
} from "../prompt-assembler.js";
import { SimpleTokenCounter } from "@tavern/core";

function createAssemblyDebugFixture(overrides: Partial<AssembleDebugInfo> = {}): AssembleDebugInfo {
  return {
    mode: "fallback",
    promptIntent: "normal",
    assistantPrefillApplied: false,
    assistantPrefillStrategy: "none",
    presetUsed: false,
    worldbookHits: 0,
    regexPreRules: ["debug-pre"],
    regexPostRules: ["debug-post"],
    memorySummaryInjected: false,
    reservedVariableCollisions: ["char"],
    selectedPromptOrderCharacterId: null,
    ignoredPromptOrderCharacterIds: [],
    unsupportedPresetFields: ["assistant_prefill"],
    ignoredPresetFields: [],
    unresolvedPresetMarkers: ["debug-marker"],
    presetWarnings: ["debug-warning"],
    continueNudgeApplied: false,
    continueNudgeText: undefined,
    namesBehaviorApplied: "off",
    triggerFilteredEntryIds: [],
    inChatInsertedEntryIds: [],
    ...overrides,
  };
}

const SAMPLE_PRESET_DATA = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "Mood {{mood}}, score {{score}}, char {{char}}, user {{user}}.",
    },
    {
      identifier: "chatHistory",
      name: "Chat History",
      marker: true,
    },
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
  openai_max_context: 4096,
  openai_max_tokens: 256,
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  new_chat_prompt: "",
  new_example_chat_prompt: "",
  continue_nudge_prompt: "Continue the response.",
  assistant_prefill: "Prefill fragment",
  wi_format: "{0}",
  names_behavior: 0,
  stream_openai: true,
};

describe("assemblePrompt", () => {
  let database: { db: DatabaseConnection["db"]; close: () => void };

  beforeEach(() => {
    const connection = createDatabase(":memory:");
    database = {
      db: connection.db,
      close: () => connection.close(),
    };
  });

  afterEach(() => {
    database.close();
  });

  it("prefers explicit prompt runtime budget over narrator and preset defaults", () => {
    expect(resolveEffectivePromptBudget({
      budget: {
        maxInputTokens: 2048,
        reservedCompletionTokens: 512,
      },
      maxContextTokensOverride: 4096,
      maxOutputTokensOverride: 1024,
      defaultMaxContextTokens: 8192,
      defaultReservedCompletionTokens: 256,
    })).toEqual({
      maxInputTokens: 2048,
      reservedCompletionTokens: 512,
    });
  });

  it("falls back to legacy maxContext and maxOutput defaults when budget policy is absent", () => {
    expect(resolveEffectivePromptBudget({
      maxContextTokensOverride: 4096,
      maxOutputTokensOverride: 1024,
    })).toEqual({
      maxInputTokens: 3072,
      reservedCompletionTokens: 1024,
    });
  });

  it("prefers runtimeTrace-backed facts when projecting dry-run assembly compat", () => {
    const debug = createAssemblyDebugFixture();
    const runtimeTrace: PromptRuntimeTrace = {
      ...buildPromptRuntimeTrace({
        traceSeed: createAssemblyDebugFixture({
          assistantPrefillApplied: true,
          assistantPrefillStrategy: "transcript_append",
          worldbookHits: 2,
          regexPreRules: ["trace-pre"],
          regexPostRules: ["trace-post"],
          memorySummaryInjected: true,
          selectedPromptOrderCharacterId: 100000,
          ignoredPromptOrderCharacterIds: [200001],
          unsupportedPresetFields: [],
          ignoredPresetFields: ["top_level.openai_model"],
          unresolvedPresetMarkers: ["trace-marker"],
          presetWarnings: ["trace-warning"],
          continueNudgeApplied: true,
          continueNudgeText: "[Continue]",
          namesBehaviorApplied: "always",
          triggerFilteredEntryIds: ["quietPrompt"],
          inChatInsertedEntryIds: ["continueHint"],
          worldbookMatches: [],
        }),
        preprocessedUserMessage: "from-trace",
      }),
      delivery: {
        assistantPrefillRequested: true,
        assistantPrefillApplied: true,
        assistantPrefillStrategy: "transcript_append",
        allowAssistantPrefill: true,
        requireLastUser: true,
        noAssistant: false,
        lastMessageRole: "user",
        endsWithUser: true,
        degraded: false,
        degradeReasons: [],
      },
    };

    expect(buildPromptAssemblyCompat({
      compatSeed: debug,
      traceSeed: debug,
      runtimeTrace,
      preprocessedUserMessage: "from-debug",
    })).toMatchObject({
      mode: "fallback",
      promptIntent: "normal",
      presetUsed: false,
      reservedVariableCollisions: ["char"],
      assistantPrefillApplied: true,
      assistantPrefillStrategy: "transcript_append",
      worldbookHits: 2,
      regexPreRules: ["trace-pre"],
      regexPostRules: ["trace-post"],
      preprocessedUserMessage: "from-trace",
      memorySummaryInjected: true,
      selectedPromptOrderCharacterId: 100000,
      ignoredPromptOrderCharacterIds: [200001],
      unsupportedPresetFields: [],
      ignoredPresetFields: ["top_level.openai_model"],
      unresolvedPresetMarkers: ["trace-marker"],
      presetWarnings: ["trace-warning"],
      continueNudgeApplied: true,
      continueNudgeText: "[Continue]",
      namesBehaviorApplied: "always",
      triggerFilteredEntryIds: ["quietPrompt"],
      inChatInsertedEntryIds: ["continueHint"],
      worldbookMatches: [],
    });
  });

  it("falls back to compat seed and runtime trace seed when runtimeTrace is absent", () => {
    const debug = createAssemblyDebugFixture({
      mode: "preset",
      promptIntent: "continue",
      assistantPrefillApplied: true,
      assistantPrefillStrategy: "assistant_message_fallback",
      presetUsed: true,
      worldbookHits: 1,
      continueNudgeApplied: true,
      continueNudgeText: "[Continue]",
      namesBehaviorApplied: "always",
      triggerFilteredEntryIds: ["quietPrompt"],
      inChatInsertedEntryIds: ["continueHint"],
      worldbookMatches: [],
    });

    expect(buildPromptAssemblyCompat({
      compatSeed: debug,
      traceSeed: debug,
      preprocessedUserMessage: "from-seed",
    })).toMatchObject({
      mode: "preset",
      promptIntent: "continue",
      assistantPrefillApplied: true,
      assistantPrefillStrategy: "assistant_message_fallback",
      presetUsed: true,
      worldbookHits: 1,
      regexPreRules: ["debug-pre"],
      regexPostRules: ["debug-post"],
      memorySummaryInjected: false,
      reservedVariableCollisions: ["char"],
      preprocessedUserMessage: "from-seed",
      worldbookMatches: [],
    });
  });

  it("keeps allocator disabled when only aggregate prompt budget totals are provided", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Aggregate Budget Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [{ role: "user", content: "Earlier turn." }],
      "Continue.",
      new SimpleTokenCounter(),
      undefined,
      {
        budget: { maxInputTokens: 64, reservedCompletionTokens: 16 },
      },
    );

    expect(assembled.tokenUsage.byGroup).toMatchObject({ history: expect.any(Number) });
    expect(assembled.tokenUsage.allocator).toBeUndefined();
  });

  it("injects resolved persisted variables into prompt templates and preserves reserved aliases", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const presetId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Variable Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "input",
      isActive: true,
      checksum: null,
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Variable Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now + 3,
      updatedAt: now + 3,
    });

    await database.db.insert(variables).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "global",
        scopeId: "global",
        key: "mood",
        valueJson: JSON.stringify("calm"),
        updatedAt: now + 4,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        key: "mood",
        valueJson: JSON.stringify("focused"),
        updatedAt: now + 5,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "mood",
        valueJson: JSON.stringify("stormy"),
        updatedAt: now + 6,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "floor",
        scopeId: floorId,
        key: "score",
        valueJson: JSON.stringify(7),
        updatedAt: now + 7,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "page",
        scopeId: pageId,
        key: "score",
        valueJson: JSON.stringify(7),
        updatedAt: now + 8,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "page",
        scopeId: pageId,
        key: "char",
        valueJson: JSON.stringify("PersistedChar"),
        updatedAt: now + 9,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "page",
        scopeId: pageId,
        key: "user",
        valueJson: JSON.stringify("PersistedUser"),
        updatedAt: now + 10,
      },
    ]);

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance the scene.",
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
        variableContext: { sessionId, branchId: "main", floorId, pageId },
      },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("Mood stormy, score 7, char Knight, user Traveler.");
    expect(assembled.promptSnapshot.variables).toMatchObject({
      mood: "stormy",
      score: "7",
      char: "Knight",
      user: "Traveler",
    });
    expect(assembled.debug).toMatchObject({
      promptIntent: "normal",
      reservedVariableCollisions: ["char", "user"],
      selectedPromptOrderCharacterId: null,
      ignoredPromptOrderCharacterIds: [],
    });
    expect(assembled.runtimeTraceSeed).toMatchObject({
      selectedPromptOrderCharacterId: null,
      ignoredPromptOrderCharacterIds: [],
      unsupportedPresetFields: [],
    });
    expect(assembled.debug?.macroWarnings?.some((warning) => warning.code === "macro_unknown")).toBe(false);
    expect(assembled.debug?.macroUsedNames).toEqual(expect.arrayContaining(["mood", "score", "char", "user"]));
    expect(assembled.runtimeTraceSeed?.macroUsedNames).toEqual(expect.arrayContaining(["mood", "score", "char", "user"]));
    expect(assembled.debug?.unsupportedPresetFields).toEqual([]);
  });

  it("injects character system prompt and post-history instructions in compat mode", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Character Prompt Override Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({
        name: "Knight",
        description: "A sworn guardian.",
        systemPrompt: "Character system prompt.",
        postHistoryInstructions: "Character post-history instructions.",
        creatorNotes: "Creator notes.",
        characterBook: { entries: [] },
        extensions: { source_app: "vitest" },
      }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Hello",
      new SimpleTokenCounter(),
    );

    expect(assembled.messages[1]).toMatchObject({ role: "system", content: "Character system prompt." });
    expect(assembled.messages.at(-2)).toMatchObject({ role: "user", content: "Hello" });
    expect(assembled.messages.at(-1)).toMatchObject({ role: "system", content: "Character post-history instructions." });
    expect(assembled.promptSnapshot.character).toMatchObject({
      creatorNotes: "Creator notes.",
      characterBook: { entries: [] },
      extensions: { source_app: "vitest" },
      systemPrompt: "Character system prompt.",
    });
  });

  it("resolves getvar and getglobalvar in macro runtime", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const presetId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt VariableGetter Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "input",
      isActive: true,
      checksum: null,
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Getter Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "Mood {{getvar::mood}}, world {{getglobalvar::world}}, localWorld {{getvar::world}}, globalMood {{getglobalvar::mood}}.",
          },
          {
            identifier: "chatHistory",
            name: "Chat History",
            marker: true,
          },
        ],
      }),
      createdAt: now + 3,
      updatedAt: now + 3,
    });

    await database.db.insert(variables).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "mood",
        valueJson: JSON.stringify("stormy"),
        updatedAt: now + 4,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "global",
        scopeId: "global",
        key: "world",
        valueJson: JSON.stringify("earth"),
        updatedAt: now + 5,
      },
    ]);

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
   };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
        variableContext: { sessionId, branchId: "main", floorId, pageId },
      },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("Mood stormy, world earth");
    expect(systemMessage?.content).toContain("localWorld ");
    expect(systemMessage?.content).toContain("globalMood .");
    expect(assembled.debug?.macroUsedNames).toEqual(expect.arrayContaining(["getvar", "getglobalvar"]));
    expect(assembled.debug?.macroWarnings?.some((warning) => warning.code === "macro_unknown")).toBe(false);
  });

  it("reads structured variable paths during prompt assembly", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const presetId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Structured Path Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "input",
      isActive: true,
      checksum: null,
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Structured Path Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "gold {{getvar::资产.金币}}, silver {{.资产.银币}}, balance {{$账户.余额}}, has {{hasvar::资产.金币}}, missing {{hasvar::资产.铜币}}.",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now + 3,
      updatedAt: now + 3,
    });

    await database.db.insert(variables).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "资产",
        valueJson: JSON.stringify({ 金币: 3, 银币: 5 }),
        updatedAt: now + 4,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "global",
        scopeId: "global",
        key: "账户",
        valueJson: JSON.stringify({ 余额: 100 }),
        updatedAt: now + 5,
      },
    ]);

    const assembled = await assemblePrompt(database.db, DEFAULT_ADMIN_ACCOUNT_ID, {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    }, [], "Advance.", new SimpleTokenCounter(), undefined, {
      includeDebug: true,
      variableContext: { sessionId, branchId: "main", floorId, pageId },
    });

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("gold 3, silver 5, balance 100, has true, missing false.");
    expect(assembled.debug?.macroWarnings?.some((warning) => warning.code === "macro_parse_failed")).toBe(false);
  });

  it("resolves if blocks with getvar condition", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const presetId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt If Macro Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "input",
      isActive: true,
      checksum: null,
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt If Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{if {{getvar::flag}}}}Visible{{else}}Hidden{{/if}}",
          },
          {
            identifier: "chatHistory",
            name: "Chat History",
            marker: true,
          },
        ],
      }),
      createdAt: now + 3,
      updatedAt: now + 3,
    });

    await database.db.insert(variables).values({
      id: nanoid(),
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "branch",
      scopeId: buildBranchVariableScopeId(sessionId, "main"),
      key: "flag",
      valueJson: JSON.stringify("true"),
      updatedAt: now + 4,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
        variableContext: { sessionId, branchId: "main", floorId, pageId },
      },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("Visible");
    expect(systemMessage?.content).not.toContain("Hidden");
    expect(assembled.debug?.macroUsedNames).toEqual(expect.arrayContaining(["if", "getvar"]));
  });

  it("evaluates richer if conditions in prompt assembly", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const presetId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Rich If Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "input",
      isActive: true,
      checksum: null,
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Rich If Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{if ({{getvar::score}} >= 80) and not ({{getvar::rank}} == banned)}}Qualified{{else}}Rejected{{/if}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now + 3,
      updatedAt: now + 3,
    });

    await database.db.insert(variables).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "score",
        valueJson: JSON.stringify(90),
        updatedAt: now + 4,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "rank",
        valueJson: JSON.stringify("knight"),
        updatedAt: now + 5,
      },
    ]);

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
        variableContext: { sessionId, branchId: "main", floorId, pageId },
      },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("Qualified");
    expect(systemMessage?.content).not.toContain("Rejected");
    expect(assembled.debug?.macroUsedNames).toEqual(expect.arrayContaining(["if", "getvar"]));
  });

  it("resolves .name and $name shorthand reads", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const presetId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Shorthand Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "input",
      isActive: true,
      checksum: null,
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Shorthand Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "Mood {{.mood}}, world {{$world}}, localWorld {{.world}}, globalMood {{$mood}}.",
          },
          {
            identifier: "chatHistory",
            name: "Chat History",
            marker: true,
          },
        ],
      }),
      createdAt: now + 3,
      updatedAt: now + 3,
    });

    await database.db.insert(variables).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "mood",
        valueJson: JSON.stringify("stormy"),
        updatedAt: now + 4,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "global",
        scopeId: "global",
        key: "world",
        valueJson: JSON.stringify("earth"),
        updatedAt: now + 5,
      },
    ]);

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
        variableContext: { sessionId, branchId: "main", floorId, pageId },
      },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("Mood stormy, world earth");
    expect(systemMessage?.content).toContain("localWorld ");
    expect(systemMessage?.content).toContain("globalMood .");
    expect(assembled.debug?.macroUsedNames).toEqual(expect.arrayContaining([".mood", "$world"]));
  });

  it("collects mutation preview for setvar in dry run", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Setvar Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{setvar::mood::happy}}{{getvar::mood}}",
          },
          {
            identifier: "chatHistory",
            name: "Chat History",
            marker: true,
          },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionId = nanoid();
    const floorId = nanoid();
    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Setvar Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    await database.db.insert(floors).values({ id: floorId, sessionId, floorNo: 1, branchId: "main", parentFloorId: null, state: "committed", tokenIn: 0, tokenOut: 0, createdAt: now + 2, updatedAt: now + 2 });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
        variableContext: { sessionId, branchId: "main", floorId },
      },
    );

    expect(assembled.runtimeTraceSeed.macroMutationPreview).toEqual([
      { kind: "set", scope: "branch", key: "mood", value: "happy" },
    ]);
    expect(assembled.runtimeTraceSeed.macroStagedMutations).toEqual([
      { kind: "set", scope: "branch", key: "mood", value: "happy", sourceMacro: "setvar" },
    ]);
    expect(assembled.debug?.macroMutationPreview).toEqual([
      { kind: "set", scope: "branch", key: "mood", value: "happy" },
    ]);
    expect(assembled.debug?.macroStagedMutations).toEqual([
      { kind: "set", scope: "branch", key: "mood", value: "happy", sourceMacro: "setvar" },
    ]);
    expect(assembled.promptSnapshot).not.toHaveProperty("macroMutationPreview");
    expect(assembled.promptSnapshot).not.toHaveProperty("macroStagedMutations");
    expect(assembled.promptSnapshot).not.toHaveProperty("macroWarnings");
    expect(assembled.debug?.macroWarnings?.some((warning) => warning.code === "macro_preview_side_effect_suppressed")).toBe(true);
  });

  it("keeps macro commit facts outside prompt snapshot when debug output is disabled", async () => {
    const now = Date.now();
    const presetId = nanoid();
    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Macro Commit Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          { identifier: "main", name: "Main Prompt", role: "system", content: "{{setvar::mood::steady}}{{getvar::mood}}" },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });
    const sessionId = nanoid();
    const floorId = nanoid();
    await database.db.insert(sessions).values({ id: sessionId, title: "Prompt Macro Commit Session", accountId: DEFAULT_ADMIN_ACCOUNT_ID, status: "active", createdAt: now + 1, updatedAt: now + 1 });
    await database.db.insert(floors).values({ id: floorId, sessionId, floorNo: 1, branchId: "main", parentFloorId: null, state: "committed", tokenIn: 0, tokenOut: 0, createdAt: now + 2, updatedAt: now + 2 });
    const assembled = await assemblePrompt(database.db, DEFAULT_ADMIN_ACCOUNT_ID, { presetId, worldbookProfileId: null, regexProfileId: null, metadataJson: null, characterSnapshotJson: JSON.stringify({ name: "Knight" }), promptMode: "compat_strict", userSnapshotJson: JSON.stringify({ name: "Traveler" }) }, [], "Advance.", new SimpleTokenCounter(), undefined, { variableContext: { sessionId, branchId: "main", floorId } });

    expect(assembled.debug).toBeUndefined();
    expect(assembled.assemblyCompatSeed).toMatchObject({
      mode: "preset",
      promptIntent: "normal",
      presetUsed: true,
      reservedVariableCollisions: [],
    });
    expect(assembled.runtimeTraceSeed.macroStagedMutations).toEqual([
      { kind: "set", scope: "branch", key: "mood", value: "steady", sourceMacro: "setvar" },
    ]);
    expect(assembled.promptSnapshot).not.toHaveProperty("macroStagedMutations");
  });

  it("collects root object mutation preview for nested setvar in dry run", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const sessionId = nanoid();
    const floorId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Structured Setvar Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{setvar::资产.金币::3}}{{getvar::资产.金币}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Structured Setvar Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    const assembled = await assemblePrompt(database.db, DEFAULT_ADMIN_ACCOUNT_ID, {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    }, [], "Advance.", new SimpleTokenCounter(), undefined, {
      includeDebug: true,
      variableContext: { sessionId, branchId: "main", floorId },
    });

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("3");
    expect(assembled.debug?.macroMutationPreview).toEqual([
      { kind: "set", scope: "branch", key: "资产", value: { 金币: "3" } },
    ]);
    expect(assembled.debug?.macroStagedMutations).toEqual([
      { kind: "set", scope: "branch", key: "资产", value: { 金币: "3" }, sourceMacro: "setvar" },
    ]);
    expect(assembled.debug?.macroWarnings?.some((warning) => warning.code === "macro_preview_side_effect_suppressed")).toBe(true);
  });

  it("collects mutation preview for add/inc/dec/delete macros", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const presetId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Mutate Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "input",
      isActive: true,
      checksum: null,
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Mutate Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{addvar::count::2}}{{incvar::count}}{{decvar::count}}{{deletevar::count}}{{addglobalvar::gold::5}}{{incglobalvar::gold}}{{decglobalvar::gold}}{{deleteglobalvar::gold}}",
          },
          {
            identifier: "chatHistory",
            name: "Chat History",
            marker: true,
          },
        ],
      }),
      createdAt: now + 3,
      updatedAt: now + 3,
    });

    await database.db.insert(variables).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "count",
        valueJson: JSON.stringify("1"),
        updatedAt: now + 4,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "global",
        scopeId: "global",
        key: "gold",
        valueJson: JSON.stringify("10"),
        updatedAt: now + 5,
      },
    ]);

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
        variableContext: { sessionId, branchId: "main", floorId, pageId },
      },
    );

    expect(assembled.debug?.macroMutationPreview).toEqual([
      { kind: "set", scope: "branch", key: "count", value: "3" },
      { kind: "set", scope: "branch", key: "count", value: "4" },
      { kind: "set", scope: "branch", key: "count", value: "3" },
      { kind: "delete", scope: "branch", key: "count" },
      { kind: "set", scope: "global", key: "gold", value: "15" },
      { kind: "set", scope: "global", key: "gold", value: "16" },
      { kind: "set", scope: "global", key: "gold", value: "15" },
      { kind: "delete", scope: "global", key: "gold" },
    ]);
    expect(assembled.debug?.macroWarnings?.filter((warning) => warning.code === "macro_preview_side_effect_suppressed")).toHaveLength(8);
  });

  it("resolves core readonly macro values with explicit priority order", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Readonly Macro Value Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: [
              "system={{systemPrompt}}",
              "persona={{persona}}",
              "defaultSystem={{defaultSystemPrompt}}",
              "charAuthors={{charAuthorsNote}}",
              "authors={{authorsNote}}",
              "defaultAuthors={{defaultAuthorsNote}}",
              "charPrompt={{charPrompt}}",
              "charInstruction={{charInstruction}}",
              "charDepth={{charDepthPrompt}}",
              "examples={{mesExamples}}",
              "examplesRaw={{mesExamplesRaw}}",
              "userName={{userName}}",
              "assistantName={{assistantName}}",
              "runKind={{runKind}}",
              "promptMode={{promptMode}}",
              "isodate={{isodate}}",
              "isotime={{isotime}}",
              "isotimeAgain={{isotime}}",
              "model={{model}}",
              "lastGen={{lastGenerationType}}",
            ].join(" | "),
          },
          {
            identifier: "chatHistory",
            name: "Chat History",
            marker: true,
          },
          {
            identifier: "jailbreak",
            name: "Jailbreak",
            role: "system",
            content: "Author note from preset",
          },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: JSON.stringify({
        model: "session-model-name",
        systemPrompt: "System from metadata",
        authorsNote: "Author note from metadata",
      }),
      characterSnapshotJson: JSON.stringify({
        name: "Knight",
        systemPrompt: "System from character",
        postHistoryInstructions: "Depth instruction",
        description: "Character description",
        personality: "Character personality",
        scenario: "Character scenario",
        creatorNotes: "Author note from character",
        exampleDialogue: "Example dialogue block",
      }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
      },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("system=System from metadata");
    expect(systemMessage?.content).toContain("persona=");
    expect(systemMessage?.content).toContain("defaultSystem=You are a helpful assistant.");
    expect(systemMessage?.content).toContain("charAuthors=Author note from character");
    expect(systemMessage?.content).toContain("authors=Author note from metadata");
    expect(systemMessage?.content).toContain("defaultAuthors=");
    expect(systemMessage?.content).toContain("charPrompt=System from character");
    expect(systemMessage?.content).toContain("charInstruction=Depth instruction");
    expect(systemMessage?.content).toContain("charDepth=Depth instruction");
    expect(systemMessage?.content).toContain("examples=Example dialogue block");
    expect(systemMessage?.content).toContain("examplesRaw=Example dialogue block");
    expect(systemMessage?.content).toContain("userName=Traveler");
    expect(systemMessage?.content).toContain("assistantName=Knight");
    expect(systemMessage?.content).toContain("runKind=dry_run");
    expect(systemMessage?.content).toContain("promptMode=compat_strict");
    expect(systemMessage?.content).toMatch(/isodate=\d{4}-\d{2}-\d{2}/);
    expect(systemMessage?.content).toMatch(/isotime=(\d{2}:\d{2}) \| isotimeAgain=\1/);
    expect(systemMessage?.content).toContain("model=session-model-name");
    expect(systemMessage?.content).toContain("lastGen=dry_run");
    expect(assembled.debug?.macroWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "macro_value_missing", macroName: "defaultAuthorsNote" })]));
  });

  it("does not let ordinary variables override readonly macro values", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const presetId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Readonly Collision Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "input",
      isActive: true,
      checksum: null,
      createdAt: now + 2,
      updatedAt: now + 2,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Readonly Collision Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "readonly={{systemPrompt}} | local={{getvar::systemPrompt}} | lastGen={{lastGenerationType}} | localGen={{getvar::lastGenerationType}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now + 3,
      updatedAt: now + 3,
    });

    await database.db.insert(variables).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "systemPrompt",
        valueJson: JSON.stringify("Shadow system"),
        updatedAt: now + 4,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "lastGenerationType",
        valueJson: JSON.stringify("shadow-run"),
        updatedAt: now + 5,
      },
    ]);

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      {
        presetId,
        worldbookProfileId: null,
        regexProfileId: null,
        metadataJson: JSON.stringify({ systemPrompt: "Actual system" }),
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        promptMode: "compat_strict",
        userSnapshotJson: JSON.stringify({ name: "Traveler" }),
      },
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      { includeDebug: true, runKind: "dry_run", variableContext: { sessionId, branchId: "main", floorId, pageId } },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("readonly=Actual system");
    expect(systemMessage?.content).toContain("local=Shadow system");
    expect(systemMessage?.content).toContain("lastGen=dry_run");
    expect(systemMessage?.content).toContain("localGen=shadow-run");
    expect(assembled.debug?.macroWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_readonly_name_conflict", macroName: "systemPrompt" }),
      expect.objectContaining({ code: "macro_readonly_name_conflict", macroName: "lastGenerationType" }),
    ]));
  });

  it("falls back to preset sources when metadata and character values are missing", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Readonly Macro Preset Fallback",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        new_chat_prompt: "Persona from preset",
        continue_nudge_prompt: "Continue nudge from preset",
        assistant_prefill: "Assistant prefill from preset",
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: [
              "system={{systemPrompt}}",
              "persona={{persona}}",
              "authors={{authorsNote}}",
              "charPrompt={{charPrompt}}",
              "charInstruction={{charInstruction}}",
              "charDepth={{charDepthPrompt}}",
            ].join(" | "),
          },
          {
            identifier: "chatHistory",
            name: "Chat History",
            marker: true,
          },
          {
            identifier: "jailbreak",
            name: "Jailbreak",
            role: "system",
            content: "Author note from preset",
          },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      { includeDebug: true },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("persona=Persona from preset");
    expect(systemMessage?.content).toContain("authors=Author note from preset");
    expect(systemMessage?.content).toContain("charInstruction=Continue nudge from preset");
    expect(systemMessage?.content).toContain("charInstruction=Continue nudge from preset");
    expect(systemMessage?.content).toContain("charDepth=Continue nudge from preset");
    expect(assembled.debug?.macroWarnings?.some((warning) => warning.macroName === "systemPrompt")).toBe(false);
  });

  it("emits macro_value_missing warnings for missing readonly macro values", async () => {
    const sessionInfo: SessionPromptInfo = {
      presetId: null,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "Advance.",
      new SimpleTokenCounter(),
      undefined,
      { includeDebug: true },
    );

    expect(assembled.debug?.macroWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_value_missing", macroName: "systemPrompt" }),
      expect.objectContaining({ code: "macro_value_missing", macroName: "charPrompt" }),
      expect.objectContaining({ code: "macro_value_missing", macroName: "charInstruction" }),
      expect.objectContaining({ code: "macro_value_missing", macroName: "charDepthPrompt" }),
      expect.objectContaining({ code: "macro_value_missing", macroName: "mesExamples" }),
      expect.objectContaining({ code: "macro_value_missing", macroName: "mesExamplesRaw" }),
      expect.objectContaining({ code: "macro_value_missing", macroName: "authorsNote" }),
      expect.objectContaining({ code: "macro_value_missing", macroName: "defaultAuthorsNote" }),
      expect.objectContaining({ code: "macro_value_missing", macroName: "model" }),
    ]));
  });

  it("recent message macros include current user input during dry run", async () => {
    const presetId = nanoid();
    const now = Date.now();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Recent Message Dry Run Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "last={{lastMessage}} | user={{lastUserMessage}} | char={{lastCharMessage}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [
        { role: "assistant", content: "Committed assistant reply." },
      ],
      "Current dry-run user input.",
      new SimpleTokenCounter(),
      undefined,
      { includeDebug: true },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("last=Current dry-run user input.");
    expect(systemMessage?.content).toContain("user=Current dry-run user input.");
    expect(systemMessage?.content).toContain("char=Committed assistant reply.");
  });

  it("recent char message macro does not include uncommitted assistant output", async () => {
    const sessionInfo: SessionPromptInfo = {
      presetId: null,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [{ role: "assistant", content: "Committed assistant reply." }],
      "Current request user input.",
      new SimpleTokenCounter(),
    );

    expect(assembled.promptSnapshot.variables.lastCharMessage).toBe("Committed assistant reply.");
    expect(assembled.promptSnapshot.variables.lastMessage).toBe("Current request user input.");
  });

  it("recent message macros ignore system messages and respond run kind maps to respond", async () => {
    const sessionInfo: SessionPromptInfo = {
      presetId: null,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [{ role: "system", content: "Visible system note." }, { role: "assistant", content: "Committed assistant reply." }],
      "Current request user input.",
      new SimpleTokenCounter(),
    );

    expect(assembled.promptSnapshot.variables.lastMessage).toBe("Current request user input.");
    expect(assembled.promptSnapshot.variables.lastUserMessage).toBe("Current request user input.");
    expect(assembled.promptSnapshot.variables.lastCharMessage).toBe("Committed assistant reply.");
    expect(assembled.promptSnapshot.variables.lastGenerationType).toBe("respond");
  });

  it("recent message macros consume committed history only when no current user input is present", async () => {
    const presetId = nanoid();
    const now = Date.now();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Recent Message Committed History Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "last={{lastMessage}} | user={{lastUserMessage}} | char={{lastCharMessage}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [
        { role: "user", content: "Committed user input." },
        { role: "system", content: "Committed system note." },
        { role: "assistant", content: "Committed assistant reply." },
      ],
      "",
      new SimpleTokenCounter(),
      undefined,
      { includeDebug: true },
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("last=Committed assistant reply.");
    expect(systemMessage?.content).toContain("user=Committed user input.");
    expect(systemMessage?.content).toContain("char=Committed assistant reply.");
  });
});

describe("materializePromptRuntimeMessages", () => {
  it("keeps current message shape in default mode", () => {
    const result = materializePromptRuntimeMessages({
      messages: [
        { role: "system", content: "System rules." },
        { role: "user", content: "Hello." },
      ],
      sendDirectives: {},
      assistantPrefillStrategy: "none",
      structurePolicy: { mode: "default" },
      materializeAssistantPrefillFallback: false,
    });

    expect(result.messages).toEqual([
      { role: "system", content: "System rules." },
      { role: "user", content: "Hello." },
    ]);
    expect(result.structureTrace).toEqual({ mode: "default", mergeAdjacentSameRole: false, assistantRewriteCount: 0, tailAssistantDetected: false });
    expect(result.deliveryTrace).toEqual({ assistantPrefillRequested: false, assistantPrefillApplied: false, assistantPrefillStrategy: "none", allowAssistantPrefill: true, requireLastUser: false, noAssistant: false, lastMessageRole: "user", endsWithUser: true, degraded: false, degradeReasons: [] });
  });

  it("rewrites assistant history to system and suppresses assistant fallback prefill in no_assistant mode", () => {
    const result = materializePromptRuntimeMessages({
      messages: [
        { role: "system", content: "System rules." },
        { role: "user", content: "Hello." },
        { role: "assistant", content: "Reply." },
      ],
      sendDirectives: { assistantPrefill: "Prefill fragment" },
      assistantPrefillStrategy: "assistant_message_fallback",
      structurePolicy: { mode: "no_assistant" },
    });

    expect(result.messages).toEqual([
      { role: "system", content: "System rules." },
      { role: "user", content: "Hello." },
      { role: "system", content: "Reply." },
    ]);
    expect(result.structureTrace).toEqual({ mode: "no_assistant", mergeAdjacentSameRole: false, assistantRewriteCount: 1, assistantRewriteStrategy: "to_system", tailAssistantDetected: false });
    expect(result.assistantPrefillApplied).toBe(false);
    expect(result.assistantPrefillStrategy).toBe("none");
    expect(result.deliveryTrace).toEqual({ assistantPrefillRequested: true, assistantPrefillApplied: false, assistantPrefillStrategy: "none", allowAssistantPrefill: true, requireLastUser: false, noAssistant: false, lastMessageRole: "user", endsWithUser: true, degraded: false, degradeReasons: [] });
  });

  it("merges adjacent same-role messages and reports tail assistant in strict_alternating mode", () => {
    const result = materializePromptRuntimeMessages({
      messages: [
        { role: "system", content: "System rules." },
        { role: "user", content: "First question." },
        { role: "user", content: "Second question." },
        { role: "assistant", content: "Final reply." },
      ],
      sendDirectives: {},
      assistantPrefillStrategy: "none",
      structurePolicy: { mode: "strict_alternating" },
      materializeAssistantPrefillFallback: false,
    });

    expect(result.messages).toEqual([{ role: "system", content: "System rules." }, { role: "user", content: "First question.\n\nSecond question." }, { role: "assistant", content: "Final reply." }]);
    expect(result.structureTrace).toEqual({ mode: "strict_alternating", mergeAdjacentSameRole: true, assistantRewriteCount: 0, tailAssistantDetected: true });
    expect(result.deliveryTrace).toEqual({ assistantPrefillRequested: false, assistantPrefillApplied: false, assistantPrefillStrategy: "none", allowAssistantPrefill: true, requireLastUser: false, noAssistant: false, lastMessageRole: "assistant", endsWithUser: false, degraded: false, degradeReasons: [] });
  });

  it("suppresses assistant fallback prefill when require_last_user is enabled", () => {
    const result = materializePromptRuntimeMessages({
      messages: [{ role: "user", content: "Hello." }],
      sendDirectives: { assistantPrefill: "Prefill fragment" },
      assistantPrefillStrategy: "assistant_message_fallback",
      deliveryPolicy: { requireLastUser: true },
    });

    expect(result.messages).toEqual([{ role: "user", content: "Hello." }]);
    expect(result.deliveryTrace).toEqual({ assistantPrefillRequested: true, assistantPrefillApplied: false, assistantPrefillStrategy: "none", allowAssistantPrefill: true, requireLastUser: true, noAssistant: false, lastMessageRole: "user", endsWithUser: true, degraded: true, degradeReasons: ["require_last_user"] });
  });

  it("suppresses assistant prefill when allow_assistant_prefill is disabled", () => {
    const result = materializePromptRuntimeMessages({
      messages: [{ role: "user", content: "Hello." }],
      sendDirectives: { assistantPrefill: "Prefill fragment" },
      assistantPrefillStrategy: "assistant_message_fallback",
      deliveryPolicy: { allowAssistantPrefill: false },
    });

    expect(result.messages).toEqual([{ role: "user", content: "Hello." }]);
    expect(result.deliveryTrace).toEqual({ assistantPrefillRequested: true, assistantPrefillApplied: false, assistantPrefillStrategy: "none", allowAssistantPrefill: false, requireLastUser: false, noAssistant: false, lastMessageRole: "user", endsWithUser: true, degraded: true, degradeReasons: ["assistant_prefill_disabled"] });
  });

  it("lets delivery no_assistant override ordinary structure preference", () => {
    const result = materializePromptRuntimeMessages({
      messages: [{ role: "user", content: "Hello." }, { role: "assistant", content: "Reply." }],
      sendDirectives: { assistantPrefill: "Prefill fragment" },
      assistantPrefillStrategy: "assistant_message_fallback",
      structurePolicy: { mode: "strict_alternating" },
      deliveryPolicy: { noAssistant: true },
    });

    expect(result.messages).toEqual([{ role: "user", content: "Hello." }, { role: "system", content: "Reply." }]);
    expect(result.structureTrace).toEqual({ mode: "no_assistant", mergeAdjacentSameRole: true, assistantRewriteCount: 1, assistantRewriteStrategy: "to_system", tailAssistantDetected: false });
    expect(result.deliveryTrace).toEqual({ assistantPrefillRequested: true, assistantPrefillApplied: false, assistantPrefillStrategy: "none", allowAssistantPrefill: true, requireLastUser: false, noAssistant: true, lastMessageRole: "user", endsWithUser: true, degraded: true, degradeReasons: ["no_assistant_override"] });
  });

  it("transcriptizes conversation messages and assistant prefill in flattened mode", () => {
    const result = materializePromptRuntimeMessages({
      messages: [
        { role: "system", content: "System rules." },
        { role: "user", content: "Hello." },
        { role: "assistant", content: "Reply." },
      ],
      sendDirectives: { assistantPrefill: "Prefill fragment" },
      assistantPrefillStrategy: "unsupported",
      structurePolicy: { mode: "flattened" },
      deliveryPolicy: { requireLastUser: true },
      materializeAssistantPrefillFallback: false,
    });

    expect(result.messages).toEqual([
      { role: "system", content: "System rules." },
      { role: "user", content: "User: Hello.\nAssistant: Reply.\nAssistant: Prefill fragment" },
    ]);
    expect(result.structureTrace).toEqual({ mode: "flattened", mergeAdjacentSameRole: false, assistantRewriteCount: 0, tailAssistantDetected: false, transcriptized: true, transcriptMessageCount: 3, assistantPrefillTranscriptized: true });
    expect(result.deliveryTrace).toEqual({ assistantPrefillRequested: true, assistantPrefillApplied: true, assistantPrefillStrategy: "transcript_append", allowAssistantPrefill: true, requireLastUser: true, noAssistant: false, lastMessageRole: "user", endsWithUser: true, degraded: false, degradeReasons: [] });
  });

  it("keeps flattened mode compatible with delivery no_assistant", () => {
    const result = materializePromptRuntimeMessages({
      messages: [{ role: "user", content: "Hello." }, { role: "assistant", content: "Reply." }],
      sendDirectives: { assistantPrefill: "Prefill fragment" },
      assistantPrefillStrategy: "assistant_message_fallback",
      structurePolicy: { mode: "flattened" },
      deliveryPolicy: { noAssistant: true },
    });

    expect(result.messages).toEqual([
      { role: "user", content: "User: Hello.\nAssistant: Reply.\nAssistant: Prefill fragment" },
    ]);
    expect(result.structureTrace).toEqual({ mode: "flattened", mergeAdjacentSameRole: false, assistantRewriteCount: 0, tailAssistantDetected: false, transcriptized: true, transcriptMessageCount: 3, assistantPrefillTranscriptized: true });
    expect(result.deliveryTrace).toEqual({ assistantPrefillRequested: true, assistantPrefillApplied: true, assistantPrefillStrategy: "transcript_append", allowAssistantPrefill: true, requireLastUser: false, noAssistant: true, lastMessageRole: "user", endsWithUser: true, degraded: false, degradeReasons: [] });
  });
});
