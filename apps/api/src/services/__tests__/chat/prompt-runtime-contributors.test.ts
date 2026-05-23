import { describe, expect, it } from "vitest";

import {
  buildFirstPartyStateProjectionRenderable,
  buildPromptRuntimeContributorView,
  buildPromptRuntimeContributorViews,
  isContributorModeEnabled,
  resolvePreparedPromptArtifactsPromptMode,
} from "../../chat/prompt-runtime-contributors.js";
import type { PromptRuntimeContributorOutput } from "../../chat/types.js";

describe("prompt-runtime-contributors", () => {
  it("resolves effective prompt mode from session prompt mode and metadata", () => {
    expect(resolvePreparedPromptArtifactsPromptMode({
      mode: "inspect",
      session: {
        promptMode: "native",
        metadataJson: JSON.stringify({ prompt_mode: "compat_plus" }),
      },
    })).toBe("native");

    expect(resolvePreparedPromptArtifactsPromptMode({
      mode: "inspect",
      session: {
        promptMode: null,
        metadataJson: JSON.stringify({ prompt_mode: "compat_plus" }),
      },
    })).toBe("compat_plus");
  });

  it("enables contributors only in compat_plus and native", () => {
    expect(isContributorModeEnabled("compat_strict")).toBe(false);
    expect(isContributorModeEnabled("compat_plus")).toBe(true);
    expect(isContributorModeEnabled("native")).toBe(true);
  });

  it("builds state projection renderable only when managed state is present", () => {
    expect(buildFirstPartyStateProjectionRenderable({ scene: null, world: null })).toBeUndefined();

    expect(buildFirstPartyStateProjectionRenderable({
      scene: {
        source: "source_floor_snapshot",
        present: true,
        floorId: "floor-1",
        updatedAt: 1,
        schemaVersion: 2,
        scene: {
          generatedText: "Scene body",
          summaries: ["Summary A"],
        },
      } as never,
      world: {
        source: "source_floor_snapshot",
        present: true,
        floorId: "floor-1",
        updatedAt: 2,
        schemaVersion: 3,
        world: {
          worldbookId: "wb-1",
          worldbookVersion: 7,
          summaryLines: ["World line"],
        },
      } as never,
    })).toEqual({
      title: "Managed state projection",
      content: [
        "Scene source: source_floor_snapshot",
        "Scene floor_id: floor-1",
        "Scene updated_at: 1",
        "Scene schema_version: 2",
        "Scene generated_text:",
        "Scene body",
        "Scene summaries:",
        "- Summary A",
        "World source: source_floor_snapshot",
        "World floor_id: floor-1",
        "World updated_at: 2",
        "World schema_version: 3",
        "World worldbook_id: wb-1",
        "World worldbook_version: 7",
        "World summaries:",
        "- World line",
      ].join("\n"),
    });
  });

  it("projects contributor outputs to stable public views", () => {
    const contributor: PromptRuntimeContributorOutput = {
      id: "builtin:memory_projection",
      kind: "memory_projection",
      sourceKind: "memory",
      modeScope: "compat_plus",
      payload: { hidden: true },
      promptRenderable: {
        title: "Memory summary",
        content: "Remember this.",
      },
      trace: {
        deterministic: true,
        cacheScope: "floor",
      },
    };

    expect(buildPromptRuntimeContributorView(contributor)).toEqual({
      id: "builtin:memory_projection",
      kind: "memory_projection",
      sourceKind: "memory",
      modeScope: "compat_plus",
      promptRenderable: {
        title: "Memory summary",
        content: "Remember this.",
      },
      deterministic: true,
      cacheScope: "floor",
    });
    expect(buildPromptRuntimeContributorViews([contributor])).toHaveLength(1);
  });
});
