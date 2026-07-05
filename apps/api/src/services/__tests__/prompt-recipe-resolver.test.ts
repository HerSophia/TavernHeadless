import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";
import type { NodeGraphDocument } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { presets } from "../../db/schema.js";
import { assemblePrompt, type SessionPromptInfo } from "../prompt-assembler.js";
import {
  assertNarratorPresetRefResolvable,
  PROMPT_RECIPE_PRESET_REF_INVALID_CODE,
  PromptRecipePresetRefError,
  resolvePromptRecipe,
  type ResolvedPromptRecipe,
} from "../prompt-recipe-resolver.js";

/**
 * LI11-3 阶段 3a/3b 测试：配方解析层 + assemblePrompt 的 presetRefOverride 等价性，
 * 以及引用有效性校验（无效即阻断）。
 *
 * 覆盖四件事：
 * 1. resolvePromptRecipe 的回退链（节点 config.presetRef → null），纯函数、无 DB；并标注 source。
 * 2. assemblePrompt 的 presetRefOverride：缺省时与现状逐字节一致；override 真正生效；
 *    override 等于 session 默认时逐字节一致（灰度安全基线）。
 * 3. assertNarratorPresetRefResolvable：null ref 直接放行；有效引用放行；无效引用阻断报错。
 * 4. 三路回退链等价性（节点缺省 → slot/session 由上游 turn-model-service 解析进 sessionInfo.presetId）。
 */

function buildPresetData(mainContent: string) {
  return {
    prompts: [
      { identifier: "main", name: "Main Prompt", role: "system", content: mainContent },
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
}

function graphWithNarratorConfig(config: unknown): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "test-graph",
    name: "Test Graph",
    mode: "native_graph",
    nodes: [
      { id: "user_input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      { id: "narrator", type: "narration.narrator", typeVersion: "1", phase: "response", config },
    ],
    edges: [
      { id: "e_user_input_narrator", kind: "data", from: { nodeId: "user_input", port: "text" }, to: { nodeId: "narrator", port: "user_input" } },
    ],
    policies: {},
    permissions: { required: [] },
  } as unknown as NodeGraphDocument;
}

describe("resolvePromptRecipe", () => {
  it("returns no override (session_fallback) when no floor graph is provided", () => {
    expect(resolvePromptRecipe({})).toEqual({
      narratorPresetRef: null,
      source: "session_fallback",
      carrierSource: "preset",
    });
    expect(resolvePromptRecipe({ floorGraph: null })).toEqual({
      narratorPresetRef: null,
      source: "session_fallback",
      carrierSource: "preset",
    });
  });

  it("returns no override when the floor graph has no narrator node", () => {
    const graph = {
      schemaVersion: 2,
      graphId: "g",
      name: "g",
      mode: "native_graph",
      nodes: [{ id: "compose", type: "compose.final_messages", typeVersion: "1", phase: "response" }],
      edges: [],
      policies: {},
      permissions: { required: [] },
    } as unknown as NodeGraphDocument;
    expect(resolvePromptRecipe({ floorGraph: graph })).toEqual({
      narratorPresetRef: null,
      source: "session_fallback",
      carrierSource: "preset",
    });
  });

  it("returns no override when the narrator node has no presetRef config", () => {
    expect(resolvePromptRecipe({ floorGraph: graphWithNarratorConfig(undefined) })).toEqual({
      narratorPresetRef: null,
      source: "session_fallback",
      carrierSource: "preset",
    });
    expect(resolvePromptRecipe({ floorGraph: graphWithNarratorConfig({}) })).toEqual({
      narratorPresetRef: null,
      source: "session_fallback",
      carrierSource: "preset",
    });
  });

  it("reads a valid presetRef from the narrator node config", () => {
    const graph = graphWithNarratorConfig({ presetRef: { presetId: "preset_x", presetVersionId: "pv_1" } });
    expect(resolvePromptRecipe({ floorGraph: graph })).toEqual({
      narratorPresetRef: { presetId: "preset_x", presetVersionId: "pv_1" },
      source: "node_preset_ref",
      carrierSource: "preset",
    });
  });

  it("defaults presetVersionId to null when absent or empty", () => {
    expect(
      resolvePromptRecipe({ floorGraph: graphWithNarratorConfig({ presetRef: { presetId: "preset_x" } }) }),
    ).toEqual({
      narratorPresetRef: { presetId: "preset_x", presetVersionId: null },
      source: "node_preset_ref",
      carrierSource: "preset",
    });
    expect(
      resolvePromptRecipe({
        floorGraph: graphWithNarratorConfig({ presetRef: { presetId: "preset_x",presetVersionId: "" } }),
      }),
    ).toEqual({
      narratorPresetRef: { presetId: "preset_x", presetVersionId: null },
      source: "node_preset_ref",
      carrierSource: "preset",
    });
  });

  it("ignores presetRef with a missing or non-string presetId", () => {
    expect(
      resolvePromptRecipe({ floorGraph: graphWithNarratorConfig({ presetRef: { presetVersionId: "pv_1" } }) }),
    ).toEqual({ narratorPresetRef: null, source: "session_fallback", carrierSource: "preset" });
    expect(
      resolvePromptRecipe({ floorGraph: graphWithNarratorConfig({ presetRef: { presetId: 123 } }) }),
    ).toEqual({ narratorPresetRef: null, source: "session_fallback", carrierSource: "preset" });
  });

  it("defers to NG2-9 (subgraph_deferred) when the carrier source is subgraph (explicit source)", () => {
    // NG2-8 §3.3：显式 source === 'subgraph' + 结构有效 subgraphRef → 不产出预设覆盖。
    const graph = graphWithNarratorConfig({ source: "subgraph", subgraphRef: { graphId: "g_1", versionId: "v_1" } });
    expect(resolvePromptRecipe({ floorGraph: graph })).toEqual({
      narratorPresetRef: null,
      source: "subgraph_deferred",
      carrierSource: "subgraph",
    });
  });

  it("defers to NG2-9 (subgraph_deferred) when the carrier source is inferred from subgraphRef", () => {
    // NG2-7 §3.2：缺省 source + 结构有效 subgraphRef → 推断为 subgraph。
    const graph = graphWithNarratorConfig({ subgraphRef: { graphId: "g_1" } });
    expect(resolvePromptRecipe({ floorGraph: graph })).toEqual({
      narratorPresetRef: null,
      source: "subgraph_deferred",
      carrierSource: "subgraph",
    });
  });

  it("treats an explicit preset source with a presetRef as node_preset_ref", () => {
    const graph = graphWithNarratorConfig({ source: "preset", presetRef: { presetId: "preset_x" } });
    expect(resolvePromptRecipe({ floorGraph: graph })).toEqual({
      narratorPresetRef: { presetId: "preset_x", presetVersionId: null },
      source: "node_preset_ref",
      carrierSource: "preset",
    });
  });
});

describe("assertNarratorPresetRefResolvable (LI11-3 3b reference validity)", () => {
  it("passeswithout probing when there is no node-level override", async () => {
    const recipe: ResolvedPromptRecipe = {
      narratorPresetRef: null,
      source: "session_fallback",
      carrierSource: "preset",
    };
    let probed = false;
    await assertNarratorPresetRefResolvable(recipe, async () => {
      probed = true;
      return true;
    });
    expect(probed).toBe(false);
  });

  it("passes without probing for a subgraph carrier (subgraph_deferred, null override)", async () => {
    const recipe: ResolvedPromptRecipe = {
      narratorPresetRef: null,
      source: "subgraph_deferred",
      carrierSource: "subgraph",
    };
    let probed = false;
    await assertNarratorPresetRefResolvable(recipe, async () => {
      probed = true;
      return true;
    });
    expect(probed).toBe(false);
  });

  it("passes when the referenced preset exists",async () => {
    const recipe: ResolvedPromptRecipe = {
      narratorPresetRef: { presetId: "preset_x", presetVersionId: null},
      source: "node_preset_ref",
      carrierSource: "preset",
    };
    await expect(assertNarratorPresetRefResolvable(recipe, async () => true)).resolves.toBeUndefined();
  });

  it("blocks with PromptRecipePresetRefError when the referenced preset is missing", async () => {
    const recipe: ResolvedPromptRecipe = {
      narratorPresetRef: { presetId: "preset_missing", presetVersionId: null },
      source: "node_preset_ref",
      carrierSource: "preset",
    };
    await expect(assertNarratorPresetRefResolvable(recipe, async () => false)).rejects.toBeInstanceOf(
      PromptRecipePresetRefError,
    );
    try {
      await assertNarratorPresetRefResolvable(recipe, async () => false);
    } catch (error) {
      expect(error).toBeInstanceOf(PromptRecipePresetRefError);
      expect((error as PromptRecipePresetRefError).code).toBe(PROMPT_RECIPE_PRESET_REF_INVALID_CODE);
      expect((error as PromptRecipePresetRefError).presetId).toBe("preset_missing");
    }
  });
});

describe("assemblePrompt presetRefOverride (LI11-3 3a)", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  function makeSession(presetId: string): SessionPromptInfo {
    return {
      presetId,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: JSON.stringify({ name: "Knight" }),
      promptMode: "compat_strict",
      userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    };
  }

  async function insertPreset(presetId: string, mainContent: string) {
    const now = Date.now();
    await database.db.insert(presets).values({
      id: presetId,
      name: `Preset ${presetId}`,
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify(buildPresetData(mainContent)),
      createdAt: now,
      updatedAt: now,
    });
  }

  it("produces byte-identical messages when no override is provided (baseline)", async () => {
    const presetId = nanoid();
    await insertPreset(presetId, "Baseline system prompt.");
    const session = makeSession(presetId);

    const runDefault = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      session,
      [{ role: "user", content: "Earlier turn." }],
      "Continue.",
      new SimpleTokenCounter(),
      undefined,
      {},
    );

    const runOverrideEqual = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      session,
      [{ role: "user", content: "Earlier turn." }],
      "Continue.",
      new SimpleTokenCounter(),
      undefined,
      { presetRefOverride: { presetId, presetVersionId: null } },
    );

    expect(JSON.stringify(runOverrideEqual.messages)).toEqual(JSON.stringify(runDefault.messages));
    expect(runOverrideEqual.promptSnapshot.presetId).toBe(presetId);
  });

  it("applies a different preset when the override points elsewhere", async () => {
    const sessionPresetId = nanoid();
    const overridePresetId = nanoid();
    await insertPreset(sessionPresetId, "SESSION-LEVEL system prompt.");
    await insertPreset(overridePresetId, "OVERRIDE-LEVEL system prompt.");
    const session = makeSession(sessionPresetId);

    const runDefault = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      session,
      [{ role: "user", content: "Earlier turn." }],
      "Continue.",
      new SimpleTokenCounter(),
      undefined,
      {},
    );

    const runOverride = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      session,
      [{ role: "user", content: "Earlier turn." }],
      "Continue.",
      new SimpleTokenCounter(),
      undefined,
      { presetRefOverride: { presetId: overridePresetId, presetVersionId: null } },
    );

    const defaultText = JSON.stringify(runDefault.messages);
    const overrideText = JSON.stringify(runOverride.messages);

    expect(defaultText).toContain("SESSION-LEVEL");
    expect(defaultText).not.toContain("OVERRIDE-LEVEL");
    expect(overrideText).toContain("OVERRIDE-LEVEL");
    expect(overrideText).not.toContain("SESSION-LEVEL");
    expect(runOverride.promptSnapshot.presetId).toBe(overridePresetId);
  });
});
