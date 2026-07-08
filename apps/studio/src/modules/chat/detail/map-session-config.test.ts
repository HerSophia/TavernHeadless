import { describe, expect, it } from "vitest";

import { mapSessionConfigView } from "./map-session-config";
import type { SessionDetail, SessionEffectiveConfigView, SessionScopeResult } from "../../../lib/chat";

function detail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "s1",
    title: "Session 1",
    status: "active",
    createdAt: 100,
    updatedAt: 200,
    modelProvider: "openai",
    modelName: "gpt-4o",
    modelParams: { temperature: 0.7, top_p: 0.9 },
    presetId: "preset-1",
    presetVersionId: "preset-v1",
    promptMode: "native",
    worldbookProfileId: "wb-1",
    worldbookVersionId: "wb-v1",
    regexProfileId: "rx-1",
    regexProfileVersionId: "rx-v1",
    deepBinding: true,
    metadata: null,
    characterBinding: {
      characterId: "c1",
      characterVersionId: "c1-v1",
      snapshotSummary: { hasGreeting: true, name: "Alice" },
      syncPolicy: "pin",
    },
    userBinding: {
      userId: "u1",
      snapshotSummary: { name: "Bob" },
    },
    ...over,
  } as SessionDetail;
}

function effective(over: Partial<SessionEffectiveConfigView> = {}): SessionEffectiveConfigView {
  return {
    projectId: "p1",
    workspaceId: "w1",
    sessionId: "s1",
    llmProfile: { source: "session", profileId: "llm-1", override: { temperature: 0.5 } },
    sessionOverrides: { llmProfile: null },
    toolPolicies: { overrides: [] },
    mcp: { source: "workspace", bindings: [] },
    toolTransport: {
      available: ["native_function_call"],
      selected: "native_function_call",
      reasonCode: "model_supports_function_call",
      capabilities: {
        supportsFunctionCall: true,
        supportsToolChoice: true,
        supportsStreamingToolCall: false,
      },
    },
    ...over,
  } as SessionEffectiveConfigView;
}

const scope: SessionScopeResult = { sessionId: "s1", workspaceId: "w1", projectId: "p1" };

describe("mapSessionConfigView", () => {
  it("shapes a full detail + effective + scope into grouped view", () => {
    const view = mapSessionConfigView(detail(), effective(), scope);

    expect(view.basic).toEqual({
      title: "Session 1",
      status: "active",
      createdAt: 100,
      updatedAt: 200,
      promptMode: "native",
      deepBinding: true,
      toolPresetKey: null,
    });
    expect(view.model).toEqual({
      provider: "openai",
      name: "gpt-4o",
      paramsSummary: { count: 2, keys: ["temperature", "top_p"] },
    });
    expect(view.assets).toEqual({
      presetId: "preset-1",
      presetVersionId: "preset-v1",
      worldbookProfileId: "wb-1",
      worldbookVersionId: "wb-v1",
      regexProfileId: "rx-1",
      regexProfileVersionId: "rx-v1",
    });
    expect(view.identity.character).toEqual({
      name: "Alice",
      hasGreeting: true,
      syncPolicy: "pin",
      characterId: "c1",
      versionId: "c1-v1",
    });
    expect(view.identity.user).toEqual({ name: "Bob", userId: "u1" });
    expect(view.effective).toEqual({
      llmProfileSource: "session",
      llmProfileId: "llm-1",
      llmProfileOverridden: true,
      toolTransportSelected: "native_function_call",
      toolTransportAvailable: ["native_function_call"],
      capabilities: {
        supportsFunctionCall: true,
        supportsToolChoice: true,
        supportsStreamingToolCall: false,
      },
    });
    expect(view.scope).toEqual({ workspaceId: "w1", projectId: "p1" });
  });

  it("returns null effective/scope groups when the enhancements are missing", () => {
    const view = mapSessionConfigView(detail());

    expect(view.effective).toBeNull();
    expect(view.scope).toBeNull();
    // 主体（detail）分组仍完整。
    expect(view.basic.title).toBe("Session 1");
    expect(view.model.name).toBe("gpt-4o");
  });

  it("normalizes null/empty string fields to null placeholders", () => {
    const view = mapSessionConfigView(
      detail({
        title: "   ",
        modelProvider: null,
        modelName: "",
        presetId: null,
        presetVersionId: null,
        promptMode: null,
        worldbookProfileId: null,
        worldbookVersionId: null,
        regexProfileId: null,
        regexProfileVersionId: null,
      }),
    );

    expect(view.basic.title).toBeNull();
    expect(view.basic.promptMode).toBeNull();
    expect(view.model.provider).toBeNull();
    expect(view.model.name).toBeNull();
    expect(view.assets).toEqual({
      presetId: null,
      presetVersionId: null,
      worldbookProfileId: null,
      worldbookVersionId: null,
      regexProfileId: null,
      regexProfileVersionId: null,
    });
  });

  it("summarizes modelParams and handles null / empty object", () => {
    expect(mapSessionConfigView(detail({ modelParams: null })).model.paramsSummary).toBeNull();
    expect(mapSessionConfigView(detail({ modelParams: {} })).model.paramsSummary).toEqual({
      count: 0,
      keys: [],
    });
    // 非对象（数组 / 原始值）不产出摘要。
    expect(mapSessionConfigView(detail({ modelParams: [1, 2, 3] })).model.paramsSummary).toBeNull();
    expect(mapSessionConfigView(detail({ modelParams: "raw" })).model.paramsSummary).toBeNull();
  });

  it("caps modelParams keys to the first eight", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 12; i += 1) {
      many[`k${i}`] = i;
    }
    const summary = mapSessionConfigView(detail({ modelParams: many })).model.paramsSummary;

    expect(summary?.count).toBe(12);
    expect(summary?.keys).toHaveLength(8);
    expect(summary?.keys[0]).toBe("k0");
  });

  it("returns null identity groups when bindings are missing", () => {
    const view = mapSessionConfigView(detail({ characterBinding: null, userBinding: null }));

    expect(view.identity.character).toBeNull();
    expect(view.identity.user).toBeNull();
  });

  it("handles character/user bindings without snapshot summaries", () => {
    const view = mapSessionConfigView(
      detail({
        characterBinding: {
          characterId: "c1",
          characterVersionId: null,
          snapshotSummary: null,
          syncPolicy: "manual",
        },
        userBinding: { userId: "u1", snapshotSummary: null },
      }),
    );

    expect(view.identity.character).toEqual({
      name: null,
      hasGreeting: null,
      syncPolicy: "manual",
      characterId: "c1",
      versionId: null,
    });
    expect(view.identity.user).toEqual({ name: null, userId: "u1" });
  });

  it("maps toolPresetKey and normalizes blank to null", () => {
    expect(mapSessionConfigView(detail({ toolPresetKey: "asset-management" })).basic.toolPresetKey).toBe(
      "asset-management",
    );
    expect(mapSessionConfigView(detail({ toolPresetKey: "  " })).basic.toolPresetKey).toBeNull();
    expect(mapSessionConfigView(detail()).basic.toolPresetKey).toBeNull();
  });

  it("marks llmProfileOverridden false when override is null", () => {
    const view = mapSessionConfigView(
      detail(),
      effective({
        llmProfile: { source: "workspace", profileId: null, override: null },
      }),
    );

    expect(view.effective?.llmProfileOverridden).toBe(false);
    expect(view.effective?.llmProfileId).toBeNull();
    expect(view.effective?.llmProfileSource).toBe("workspace");
  });
});
