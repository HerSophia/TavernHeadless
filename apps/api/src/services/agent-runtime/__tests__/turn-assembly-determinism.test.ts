import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";

import { presets } from "../../../db/schema.js";
import { createDatabase, type DatabaseConnection } from "../../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../../accounts/constants.js";
import { assemblePrompt, type PromptMode, type SessionPromptInfo } from "../../prompt-assembler.js";

const SAMPLE_PRESET_DATA = {
  prompts: [
    { identifier: "main", name: "Main Prompt", role: "system", content: "You are {{char}} talking to {{user}}." },
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
  openai_max_context: 4096,
  openai_max_tokens: 256,
  temperature: 0.7,
  wi_format: "{0}",
  names_behavior: 0,
};

describe("P9 TurnAssemblyProcessor production wiring + determinism", () => {
  let database: { db: DatabaseConnection["db"]; close: () => void };
  let presetId: string;

  beforeEach(async () => {
    const connection = createDatabase(":memory:");
    database = { db: connection.db, close: () => connection.close() };
    presetId = nanoid();
    const now = Date.now();
    await database.db.insert(presets).values({
      id: presetId,
      name: "P9 Determinism Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    database.close();
  });

  function sessionInfo(promptMode: PromptMode): SessionPromptInfo {
    return {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode,
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };
  }

  function run(promptMode: PromptMode, userMessage = "Continue.") {
    return assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      sessionInfo(promptMode),
      [{ role: "user", content: "Earlier turn." }],
      userMessage,
      new SimpleTokenCounter(),
      undefined,
      { budget: { maxInputTokens: 256, reservedCompletionTokens: 64 } },
    );
  }

  it("routes compat_strict through the prompt_mode processor", async () => {
    const result = await run("compat_strict");
    expect(result.turnAssembly?.processorKind).toBe("prompt_mode");
    expect(result.turnAssembly?.recipeKind).toBe("compat_strict");
    expect(result.turnAssembly?.assemblyInputHash).toMatch(/^sha256:/);
    expect(result.turnAssembly?.governanceSummary.runtime_kind).toBe("chat_turn");
    expect(result.turnAssembly?.governanceSummary.diagnostics).toMatchObject({
      processor_kind: "prompt_mode",
      recipe_kind: "compat_strict",
      enable_inline_agents: false,
      inline_agents_engaged: false,
    });
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("routes compat_plus through the prompt_mode processor", async () => {
    const result = await run("compat_plus");
    expect(result.turnAssembly?.processorKind).toBe("prompt_mode");
    expect(result.turnAssembly?.recipeKind).toBe("compat_plus");
  });

  it("routes native through the composite processor", async () => {
    const result = await run("native");
    expect(result.turnAssembly?.processorKind).toBe("composite");
    expect(result.turnAssembly?.recipeKind).toBe("native_prompt");
    expect(result.turnAssembly?.governanceSummary.diagnostics).toMatchObject({
      processor_kind: "composite",
      recipe_kind: "native_prompt",
    });
  });

  it("is deterministic: identical inputs yield identical hash and identical messages", async () => {
    const first = await run("compat_strict");
    const second = await run("compat_strict");

    expect(first.turnAssembly?.assemblyInputHash).toBe(second.turnAssembly?.assemblyInputHash);
    expect(first.messages).toEqual(second.messages);
  });

  it("changes the assembly input hash when the user message changes", async () => {
    const first = await run("compat_strict", "Continue.");
    const second = await run("compat_strict", "A different request entirely.");
    expect(first.turnAssembly?.assemblyInputHash).not.toBe(second.turnAssembly?.assemblyInputHash);
  });

  it("separates the assembly input hash across prompt modes for the same inputs", async () => {
    const strict = await run("compat_strict");
    const plus = await run("compat_plus");
    const native = await run("native");
    const hashes = new Set([
      strict.turnAssembly?.assemblyInputHash,
      plus.turnAssembly?.assemblyInputHash,
      native.turnAssembly?.assemblyInputHash,
    ]);
    expect(hashes.size).toBe(3);
  });
});
