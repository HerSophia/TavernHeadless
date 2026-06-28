import { describe, expect, it } from "vitest";

import type { LlmProfile, LlmRuntimeSlot } from "../../../lib/models/profiles";
import type { LlmResolvedInstanceSlot } from "../../../lib/models/instances";
import { mapResolvedSlots } from "./map-resolved";

function profile(overrides: Partial<LlmProfile>): LlmProfile {
  return {
    apiKeyMasked: "••••abcd",
    apiKeyName: null,
    baseUrl: null,
    createdAt: 0,
    id: "p1",
    lastUsedAt: null,
    modelId: "gpt-4o",
    presetName: "Primary",
    provider: "openai",
    status: "active",
    updatedAt: 0,
    ...overrides,
  };
}

function slot(overrides: Partial<LlmResolvedInstanceSlot>): LlmResolvedInstanceSlot {
  return {
    slot: "narrator",
    source: "global_config",
    scope: "global",
    configId: "ic1",
    presetId: null,
    modelIdOverride: null,
    enabled: true,
    params: null,
    capabilities: {
      supportsFunctionCall: true,
      supportsToolChoice: false,
      supportsStreamingToolCall: false,
      unsupportedGenerationParams: [],
    },
    ...overrides,
  };
}

function runtimeSlot(overrides: Partial<LlmRuntimeSlot>): LlmRuntimeSlot {
  return {
    modelId: "gpt-4o",
    params: null,
    presetName: "Primary",
    profileId: "p1",
    provider: "openai",
    scope: "global",
    slot: "narrator",
    source: "global_profile",
    ...overrides,
  };
}

describe("mapResolvedSlots (LI11: profile from binding/runtime)", () => {
  it("always returns the four role slots in order", () => {
    const rows = mapResolvedSlots([], [], []);
    expect(rows.map((row) => row.slot)).toEqual(["narrator", "director", "verifier", "memory"]);
    expect(rows.every((row) => row.source === "default")).toBe(true);
    expect(rows.every((row) => row.profileId === null)).toBe(true);
  });

  it("derives the profile from profile binding (runtime), not from instance preset_id", () => {
    const rows = mapResolvedSlots(
      // 实例侧的 preset_id 是「提示词预设覆盖」，绝不应被当成 Profile id。
      [slot({ slot: "narrator", presetId: "preset_xyz" })],
      [runtimeSlot({ slot: "narrator", profileId: "p1", presetName: "Primary", source: "global_profile" })],
      [profile({ id: "p1", presetName: "Primary" })],
    );
    const narrator = rows.find((row) => row.slot === "narrator")!;
    expect(narrator.profileId).toBe("p1");
    expect(narrator.profileName).toBe("Primary");
    expect(narrator.profileSource).toBe("global_profile");
    // 实例侧的 source 仍来自 resolved（实例配置来源）。
    expect(narrator.source).toBe("global_config");
  });

  it("does not treat instance preset_id as a profile id (no binding → no profile)", () => {
    const rows = mapResolvedSlots(
      [slot({ slot: "director", presetId: "preset_abc" })],
      [],
      [profile({ id: "preset_abc", presetName: "WRONG" })],
    );
    const director = rows.find((row) => row.slot === "director")!;
    expect(director.profileId).toBeNull();
    expect(director.profileName).toBeNull();
  });

  it("falls back to the profiles list for the name when runtime lacks presetName", () => {
    const rows = mapResolvedSlots(
      [slot({ slot: "memory" })],
      [runtimeSlot({ slot: "memory", profileId: "p9", presetName: null })],
      [profile({ id: "p9", presetName: "Memory Model" })],
    );
    const memory = rows.find((row) => row.slot === "memory")!;
    expect(memory.profileId).toBe("p9");
    expect(memory.profileName).toBe("Memory Model");
  });

  it("uses model override when present, else the bound profile's model", () => {
    const rows = mapResolvedSlots(
      [
        slot({
          slot: "verifier",
          modelIdOverride: "gpt-4o-mini",
          params: { temperature: 0.5, max_output_tokens: 512 },
          source: "session_config",
          scope: "session",
        }),
      ],
      [runtimeSlot({ slot: "verifier", profileId: "p1", modelId: "gpt-4o" })],
      [],
    );
    const verifier = rows.find((row) => row.slot === "verifier")!;
    expect(verifier.modelId).toBe("gpt-4o-mini");
    expect(verifier.temperature).toBe(0.5);
    expect(verifier.maxOutputTokens).toBe(512);
    expect(verifier.source).toBe("session_config");
    expect(verifier.scope).toBe("session");
  });

  it("shows the bound profile's model when there is no instance override", () => {
    const rows = mapResolvedSlots(
      [slot({ slot: "narrator", modelIdOverride: null })],
      [runtimeSlot({ slot: "narrator", modelId: "claude-3-5" })],
      [],
    );
    const narrator = rows.find((row) => row.slot === "narrator")!;
    expect(narrator.modelId).toBe("claude-3-5");
  });
});
