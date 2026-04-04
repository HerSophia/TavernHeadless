import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { SimpleTokenCounter } from "@tavern/core";
import { buildBranchVariableScopeId } from "@tavern/shared";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { floors, messagePages, presets, regexProfiles, sessions, variables, worldbookEntries, worldbooks } from "../../db/schema.js";
import { assemblePrompt, type SessionPromptInfo } from "../prompt-assembler.js";

const SAMPLE_PRESET_DATA = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "Mood {{mood}}, score {{score}}, char {{char}}, user {{user}}.",
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

const SAMPLE_COMPAT_WORLDINFO_PRESET_DATA = {
  ...SAMPLE_PRESET_DATA,
  prompts: [
    { identifier: "main", name: "Main Prompt", role: "system", content: "Stay in character.", enabled: true },
    { identifier: "worldInfoBefore", name: "World Info Before", marker: true, enabled: true },
    { identifier: "chatHistory", name: "Chat History", marker: true, enabled: true },
    { identifier: "jailbreak", name: "Jailbreak", role: "system", content: "Be creative.", enabled: true },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "worldInfoBefore", enabled: true },
        { identifier: "chatHistory", enabled: true },
        { identifier: "jailbreak", enabled: true },
      ],
    },
  ],
};

const SAMPLE_WORLD_INFO_REGEX_DATA = [
  {
    id: "regex-world-info",
    scriptName: "World Info Rule",
    findRegex: "/OOC/g",
    replaceString: "IC",
    trimStrings: [],
    placement: [5],
    disabled: false,
    substituteRegex: 0,
    minDepth: 0,
    maxDepth: 0,
  },
  {
    id: "regex-user-input",
    scriptName: "User Input Rule",
    findRegex: "/hello/g",
    replaceString: "greetings",
    trimStrings: [],
    placement: [1],
    disabled: false,
    promptOnly: true,
    substituteRegex: 0,
    minDepth: 0,
    maxDepth: 0,
  },
  {
    id: "regex-ai-output",
    scriptName: "AI Output Rule",
    findRegex: "/hero/g",
    replaceString: "knight",
    trimStrings: [],
    placement: [2],
    disabled: false,
    substituteRegex: 0,
    minDepth: 0,
    maxDepth: 0,
  },
];

describe("assemblePrompt", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  async function seedWorldInfoRegexScenario(args: {
    presetData: Record<string, unknown>;
    promptMode: SessionPromptInfo["promptMode"];
    regexScripts?: unknown[];
    worldbookContent?: string;
  }): Promise<SessionPromptInfo> {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();
    const regexProfileId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "World Info Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(args.presetData),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Worldbook A",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({ scanDepth: 3, recursive: false }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 7,
      comment: "Sword Lore",
      content: args.worldbookContent ?? "Ancient OOC lore",
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
      name: "Regex A",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(args.regexScripts ?? SAMPLE_WORLD_INFO_REGEX_DATA),
      createdAt: now,
      updatedAt: now,
    });

    return {
      presetId,
      worldbookProfileId: worldbookId,
      regexProfileId,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: args.promptMode,
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };
  }

  it("injects resolved persisted variables into prompt templates and preserves reserved aliases", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const presetId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Variable Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 0,
      branchId: "main",
      parentFloorId: null,
      state: "draft",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

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

    await database.db.insert(presets).values({
      id: presetId,
      name: "Prompt Variable Preset",
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(variables).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "global",
        scopeId: "global",
        key: "mood",
        valueJson: JSON.stringify("calm"),
        updatedAt: now,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "mood",
        valueJson: JSON.stringify("stormy"),
        updatedAt: now + 1,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        key: "mood",
        valueJson: JSON.stringify("tense"),
        updatedAt: now + 1,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "floor",
        scopeId: floorId,
        key: "score",
        valueJson: JSON.stringify(3),
        updatedAt: now + 2,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "page",
        scopeId: pageId,
        key: "score",
        valueJson: JSON.stringify(7),
        updatedAt: now + 3,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "page",
        scopeId: pageId,
        key: "char",
        valueJson: JSON.stringify("PersistedChar"),
        updatedAt: now + 4,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "page",
        scopeId: pageId,
        key: "user",
        valueJson: JSON.stringify("PersistedUser"),
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
      "Advance the scene.",
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
        variableContext: { sessionId, branchId: "main", floorId, pageId },
      }
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("Mood stormy, score 7, char Knight, user Traveler.");
    expect(assembled.promptSnapshot.variables).toMatchObject({
      mood: "stormy",
      score: 7,
      char: "Knight",
      user: "Traveler",
    });
    expect(assembled.debug?.reservedVariableCollisions).toEqual(["char", "user"]);
  });

  it("applies WORLD_INFO regex rules to injected worldbook content in native mode and preserves user/ai regex behavior", async () => {
    const sessionInfo = await seedWorldInfoRegexScenario({
      presetData: SAMPLE_PRESET_DATA,
      promptMode: "native",
    });

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "hello sword",
      new SimpleTokenCounter(),
    );

    expect(assembled.messages.some((message) => message.content.includes("Ancient IC lore"))).toBe(true);
    expect(assembled.messages.some((message) => message.content.includes("Ancient OOC lore"))).toBe(false);
    expect(assembled.preProcess).toBeDefined();
    expect(assembled.preProcess?.([{ role: "user", content: "hello sword" }])).toEqual([
      { role: "user", content: "greetings sword" },
    ]);
    expect(assembled.postProcess).toBeDefined();
    expect(assembled.postProcess?.("hero arrives")).toBe("knight arrives");
  });

  it("wires substituteRegex into USER_INPUT, AI_OUTPUT and WORLD_INFO prompt processing", async () => {
    const sessionInfo = await seedWorldInfoRegexScenario({
      presetData: SAMPLE_PRESET_DATA,
      promptMode: "native",
      worldbookContent: "Ancient Knight lore",
      regexScripts: [
        {
          id: "regex-world-info-substitute",
          scriptName: "World Info Substitute",
          findRegex: "/{{char}}/g",
          replaceString: "Guardian",
          trimStrings: [],
          placement: [5],
          disabled: false,
          substituteRegex: 1,
          minDepth: 0,
          maxDepth: 0,
        },
        {
          id: "regex-user-input-substitute",
          scriptName: "User Input Substitute",
          findRegex: "/{{user}}/g",
          replaceString: "friend",
          trimStrings: [],
          placement: [1],
          promptOnly: true,
          disabled: false,
          substituteRegex: 1,
          minDepth: 0,
          maxDepth: 0,
        },
        {
          id: "regex-ai-output-substitute",
          scriptName: "AI Output Substitute",
          findRegex: "/{{char}}/g",
          replaceString: "champion",
          trimStrings: [],
          placement: [2],
          promptOnly: true,
          disabled: false,
          substituteRegex: 1,
          minDepth: 0,
          maxDepth: 0,
        },
      ],
    });

    const assembled = await assemblePrompt(database.db, DEFAULT_ADMIN_ACCOUNT_ID, sessionInfo, [], "Traveler sword", new SimpleTokenCounter());
    expect(assembled.messages.some((message) => message.content.includes("Ancient Guardian lore"))).toBe(true);
    expect(assembled.preProcess?.([{ role: "user", content: "Traveler sword" }])).toEqual([{ role: "user", content: "friend sword" }]);
    expect(assembled.preProcess?.([{ role: "assistant", content: "Knight arrives" }])).toEqual([{ role: "assistant", content: "champion arrives" }]);
  });

  it("applies WORLD_INFO regex rules to injected worldbook content in compat mode", async () => {
    const sessionInfo = await seedWorldInfoRegexScenario({
      presetData: SAMPLE_COMPAT_WORLDINFO_PRESET_DATA,
      promptMode: "compat_strict",
    });

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "hello sword",
      new SimpleTokenCounter(),
    );

    expect(assembled.messages.some((message) => message.content.includes("Ancient IC lore"))).toBe(true);
    expect(assembled.messages.some((message) => message.content.includes("Ancient OOC lore"))).toBe(false);
  });

  it("passes recursive worldbook settings into triggerWorldBook and activates chained entries", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Recursive Worldbook Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_COMPAT_WORLDINFO_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Recursive Worldbook",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({ scanDepth: 3, recursive: true, maxRecursionSteps: 3 }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values([
      {
        id: nanoid(),
        worldbookId,
        uid: 10,
        comment: "Dragon Seed",
        content: "phoenix sigil",
        keysJson: JSON.stringify(["dragon"]),
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
      },
      {
        id: nanoid(),
        worldbookId,
        uid: 11,
        comment: "Phoenix Lore",
        content: "Recursive lore block",
        keysJson: JSON.stringify(["phoenix"]),
        keysSecondaryJson: JSON.stringify([]),
        selective: false,
        selectiveLogic: 0,
        constant: false,
        position: 0,
        order: 200,
        depth: 4,
        role: 0,
        disable: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: worldbookId,
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
      "dragon",
      new SimpleTokenCounter(),
    );

    expect(assembled.messages.some((message) => message.content.includes("phoenix sigil"))).toBe(true);
    expect(assembled.messages.some((message) => message.content.includes("Recursive lore block"))).toBe(true);
    expect(assembled.promptSnapshot.worldbookActivatedEntryUids).toEqual([10, 11]);
  });

  it("passes scenario scan source into triggerWorldBook when entry opts in", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Scenario Scan Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_COMPAT_WORLDINFO_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Scenario Scan Worldbook",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({ scanDepth: 3, recursive: false }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 20,
      comment: "Scenario Lore",
      content: "Observatory scenario lore",
      keysJson: JSON.stringify(["observatory"]),
      keysSecondaryJson: JSON.stringify([]),
      selective: false,
      selectiveLogic: 0,
      constant: false,
      position: 0,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
      extraJson: JSON.stringify({ extensions: { match_scenario: true } }),
      createdAt: now,
      updatedAt: now,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: worldbookId,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight", scenario: "An observatory above the clouds." }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "hello",
      new SimpleTokenCounter(),
    );

    expect(assembled.messages.some((message) => message.content.includes("Observatory scenario lore"))).toBe(true);
    expect(assembled.promptSnapshot.worldbookActivatedEntryUids).toEqual([20]);
  });

  it("injects characterBook entries in compat mode without bound session worldbook", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Character Book Compat Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_COMPAT_WORLDINFO_PRESET_DATA),
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
        characterBook: {
          entries: [
            {
              keys: ["lantern"],
              content: "Character book lore",
              enabled: true,
              insertion_order: 150,
              selective: false,
            },
          ],
          scanDepth: 3,
        },
      }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "lantern",
      new SimpleTokenCounter(),
    );

    expect(assembled.messages.some((message) => message.content.includes("Character book lore"))).toBe(true);
    expect(assembled.promptSnapshot.worldbookActivatedEntryUids).toHaveLength(1);
    expect(assembled.promptSnapshot.worldbookActivatedEntryUids[0]).toBeLessThan(0);
  });

  it("stacks characterBook with bound session worldbook in native mode", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Character Book Native Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Session Worldbook",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({ scanDepth: 3, recursive: false }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 50,
      comment: "Session Lore",
      content: "Session worldbook lore",
      keysJson: JSON.stringify(["dragon"]),
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

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: worldbookId,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({
        name: "Knight",
        characterBook: {
          entries: [
            {
              keys: ["dragon"],
              content: "Character book lore",
              enabled: true,
              insertion_order: 120,
              selective: false,
            },
          ],
          scanDepth: 3,
        },
      }),
      promptMode: "native",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "dragon",
      new SimpleTokenCounter(),
    );

    expect(assembled.messages.some((message) => message.content.includes("Session worldbook lore"))).toBe(true);
    expect(assembled.messages.some((message) => message.content.includes("Character book lore"))).toBe(true);
    expect(assembled.promptSnapshot.worldbookActivatedEntryUids).toHaveLength(2);
    expect(assembled.promptSnapshot.worldbookActivatedEntryUids.some((uid) => uid < 0)).toBe(true);
  });


  it("preserves atDepth worldbook entries in native mode", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Native Depth Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Native Depth Worldbook",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({ scanDepth: 3, recursive: false }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 30,
      comment: "Depth Lore",
      content: "Deep native lore",
      keysJson: JSON.stringify(["dragon"]),
      keysSecondaryJson: JSON.stringify([]),
      selective: false,
      selectiveLogic: 0,
      constant: false,
      position: 4,
      order: 100,
      depth: 2,
      role: 1,
      disable: false,
      createdAt: now,
      updatedAt: now,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: worldbookId,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "native",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo,
      [],
      "dragon",
      new SimpleTokenCounter(),
    );

    expect(assembled.messages.some((message) => message.content.includes("Deep native lore"))).toBe(true);
    expect(assembled.promptSnapshot.worldbookActivatedEntryUids).toEqual([30]);
  });

  it("does not auto-inject outlet worldbook entries into prompt messages", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Outlet Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_COMPAT_WORLDINFO_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Outlet Worldbook",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({ scanDepth: 3, recursive: false }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 40,
      comment: "Outlet Lore",
      content: "Hidden outlet lore",
      keysJson: JSON.stringify(["dragon"]),
      keysSecondaryJson: JSON.stringify([]),
      selective: false,
      selectiveLogic: 0,
      constant: false,
      position: 7,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
      outletName: "LoreOutlet",
      createdAt: now,
      updatedAt: now,
    });

    const sessionInfo: SessionPromptInfo = {
      presetId,
      worldbookProfileId: worldbookId,
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
      "dragon",
      new SimpleTokenCounter(),
    );

    expect(assembled.messages.some((message) => message.content.includes("Hidden outlet lore"))).toBe(false);
    expect(assembled.promptSnapshot.worldbookActivatedEntryUids).toEqual([40]);
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
    });
  });

  it("injects character prompt overrides in native mode", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Native Character Prompt Override Preset",
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
        systemPrompt: "Native character system prompt.",
        postHistoryInstructions: "Native character post-history instructions.",
      }),
      promptMode: "native",
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

    expect(assembled.messages[1]).toMatchObject({ role: "system", content: "Native character system prompt." });
    expect(assembled.messages.at(-1)).toMatchObject({ role: "system", content: "Native character post-history instructions." });
  });

});
