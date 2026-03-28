import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { SimpleTokenCounter } from "@tavern/core";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { floors, messagePages, presets, sessions, variables } from "../../db/schema.js";
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

describe("assemblePrompt", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
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
        variableContext: { sessionId, floorId, pageId },
      }
    );

    const systemMessage = assembled.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("Mood tense, score 7, char Knight, user Traveler.");
    expect(assembled.promptSnapshot.variables).toMatchObject({
      mood: "tense",
      score: 7,
      char: "Knight",
      user: "Traveler",
    });
    expect(assembled.debug?.reservedVariableCollisions).toEqual(["char", "user"]);
  });
});
