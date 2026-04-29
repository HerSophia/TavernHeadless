import { describe, expect, it } from "vitest";

import { createPromptAssetManifest, stableStringifyPromptAssetManifest } from "../manifest.js";
import { createPromptAssetRef } from "../provenance.js";

describe("Prompt Asset manifest", () => {
  it("sorts assets and declarations for stable serialization", () => {
    const preset = createPromptAssetRef({ kind: "preset", assetId: "preset-1", version: 3, origin: "imported_preset" });
    const character = createPromptAssetRef({ kind: "character", assetId: "char-1", version: "v1", origin: "session_binding" });

    const manifest = createPromptAssetManifest({
      generatedAt: 1710000000000,
      assets: [preset, character],
      declarations: [
        { id: "z", ref: preset, part: "preset_graph", runtimeActive: true },
        { id: "a", ref: character, part: "character_profile", runtimeActive: true },
      ],
    });

    expect(manifest.assets.map((asset) => asset.kind)).toEqual(["character", "preset"]);
    expect(manifest.declarations.map((declaration) => declaration.id)).toEqual(["a", "z"]);
    expect(stableStringifyPromptAssetManifest(manifest)).toContain('"declarations"');
  });
});
