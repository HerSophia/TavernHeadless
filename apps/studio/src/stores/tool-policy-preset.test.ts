import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { presetApi } = vi.hoisted(() => ({
  presetApi: {
    list: vi.fn(),
    getDetail: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../lib/tool-policy-preset-api", () => ({
  toolPolicyPresetApi: presetApi,
}));

import { useToolPolicyPresetStore } from "./tool-policy-preset";
import type {
  ToolPolicyDecision,
  ToolPolicyPresetDetail,
  ToolPolicyPresetSummary,
} from "../lib/tool-policy-preset-api";

function summary(overrides: Partial<ToolPolicyPresetSummary>): ToolPolicyPresetSummary {
  return {
    preset_key: "regular-chat",
    kind: "builtin",
    display_name: "Regular Chat",
    customized: false,
    enabled_count: 0,
    auto_count: 0,
    confirm_count: 0,
    ...overrides,
  };
}

function detail(
  presetKey: string,
  enabledTools: string[],
  decisions: Record<string, ToolPolicyDecision> = {},
): ToolPolicyPresetDetail {
  const enabled = new Set(enabledTools);
  const tools = [
    { name: "create_character", category: "character" as const, side: "irreversible" as const },
    { name: "list_characters", category: "character" as const, side: "none" as const },
  ].map((t) => ({
    tool_name: t.name,
    category: t.category,
    side_effect_level: t.side,
    description: "",
    enabled: enabled.has(t.name),
    default_decision: t.side === "irreversible" ? ("confirm" as const) : ("auto" as const),
    decision:
      decisions[t.name] ?? (t.side === "irreversible" ? ("confirm" as const) : ("auto" as const)),
    source: decisions[t.name] ? ("override" as const) : ("default" as const),
  }));
  return {
    ...summary({ preset_key: presetKey }),
    enabled_count: enabledTools.length,
    config: { enabled_tools: enabledTools, decisions },
    tools,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  presetApi.list.mockResolvedValue({ tool_catalog: [], presets: [] });
  presetApi.getDetail.mockResolvedValue(detail("regular-chat", []));
  presetApi.update.mockResolvedValue(detail("regular-chat", []));
  presetApi.reset.mockResolvedValue(detail("regular-chat", []));
  presetApi.create.mockResolvedValue(detail("my-preset", []));
  presetApi.remove.mockResolvedValue({ ok: true });
});

describe("tool policy preset store", () => {
  it("loads presets + catalog and auto-selects the first preset", async () => {
    presetApi.list.mockResolvedValue({
      tool_catalog: [
        { tool_name: "create_character", category: "character", side_effect_level: "irreversible", description: "" },
      ],
      presets: [summary({ preset_key: "regular-chat" }), summary({ preset_key: "asset-management" })],
    });
    presetApi.getDetail.mockResolvedValue(detail("regular-chat", []));
    const store = useToolPolicyPresetStore();
    await store.load("p1");
    expect(store.projectId).toBe("p1");
    expect(store.presets).toHaveLength(2);
    expect(store.toolCatalog).toHaveLength(1);
    expect(store.selectedKey).toBe("regular-chat");
    expect(presetApi.getDetail).toHaveBeenCalledWith("p1", "regular-chat");
  });

  it("ignores load when project id is empty", async () => {
    const store = useToolPolicyPresetStore();
    await store.load("");
    expect(presetApi.list).not.toHaveBeenCalled();
  });

  it("enables a tool by merging into the current config", async () => {
    presetApi.list.mockResolvedValue({ tool_catalog: [], presets: [summary({ preset_key: "regular-chat" })] });
    presetApi.getDetail.mockResolvedValue(detail("regular-chat", []));
    presetApi.update.mockResolvedValue(detail("regular-chat", ["list_characters"]));
    const store = useToolPolicyPresetStore();
    await store.load("p1");
    await store.setToolEnabled("list_characters", true);
    expect(presetApi.update).toHaveBeenCalledWith(
      "p1",
      "regular-chat",
      expect.objectContaining({ enabled_tools: ["list_characters"] }),
    );
    expect(store.detail?.tools.find((t) => t.tool_name === "list_characters")?.enabled).toBe(true);
  });

  it("sets a single tool decision", async () => {
    presetApi.list.mockResolvedValue({ tool_catalog: [], presets: [summary({ preset_key: "asset-management" })] });
    presetApi.getDetail.mockResolvedValue(detail("asset-management", ["create_character"]));
    presetApi.update.mockResolvedValue(
      detail("asset-management", ["create_character"], { create_character: "auto" }),
    );
    const store = useToolPolicyPresetStore();
    await store.load("p1");
    await store.setToolDecision("create_character", "auto");
    expect(presetApi.update).toHaveBeenCalledWith(
      "p1",
      "asset-management",
      expect.objectContaining({ decisions: { create_character: "auto" } }),
    );
  });

  it("resets the selected preset", async () => {
    presetApi.list.mockResolvedValue({ tool_catalog: [], presets: [summary({ preset_key: "regular-chat" })] });
    const store = useToolPolicyPresetStore();
    await store.load("p1");
    await store.resetPreset();
    expect(presetApi.reset).toHaveBeenCalledWith("p1", "regular-chat");
  });

  it("creates a custom preset then reloads and selects it", async () => {
    presetApi.list
      .mockResolvedValueOnce({ tool_catalog: [], presets: [summary({ preset_key: "regular-chat" })] })
      .mockResolvedValueOnce({
        tool_catalog: [],
        presets: [
          summary({ preset_key: "regular-chat" }),
          summary({ preset_key: "my-preset", kind: "custom", customized: true }),
        ],
      });
    presetApi.create.mockResolvedValue(detail("my-preset", []));
    presetApi.getDetail.mockResolvedValue(detail("my-preset", []));
    const store = useToolPolicyPresetStore();
    await store.load("p1");
    await store.createCustomPreset({ presetKey: "my-preset", displayName: "My Preset" });
    expect(presetApi.create).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ preset_key: "my-preset", display_name: "My Preset" }),
    );
    expect(store.selectedKey).toBe("my-preset");
  });

  it("deletes a custom preset then reloads", async () => {
    presetApi.list.mockResolvedValue({ tool_catalog: [], presets: [summary({ preset_key: "regular-chat" })] });
    const store = useToolPolicyPresetStore();
    await store.load("p1");
    await store.deleteCustomPreset("my-preset");
    expect(presetApi.remove).toHaveBeenCalledWith("p1", "my-preset");
    expect(presetApi.list).toHaveBeenCalledTimes(2);
  });

  it("captures and rethrows update errors", async () => {
    presetApi.list.mockResolvedValue({ tool_catalog: [], presets: [summary({ preset_key: "regular-chat" })] });
    presetApi.update.mockRejectedValue(new Error("denied"));
    const store = useToolPolicyPresetStore();
    await store.load("p1");
    await expect(store.setToolEnabled("list_characters", true)).rejects.toThrow("denied");
    expect(store.error).toBe("denied");
    expect(store.saving).toBe(false);
  });
});
