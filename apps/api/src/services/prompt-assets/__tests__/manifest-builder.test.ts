import { describe, expect, it } from "vitest";

import { WI_LOGIC, WI_POSITION, WI_ROLE } from "@tavern/adapters-sillytavern";

import { buildPromptAssetManifestForAssembly } from "../manifest-builder.js";

describe("buildPromptAssetManifestForAssembly", () => {
  it("declares preset, character, session worldbook, character book and regex assets", () => {
    const result = buildPromptAssetManifestForAssembly({
      generatedAt: 1710000000000,
      preset: {
        id: "preset-1",
        updatedAt: 1710000000000,
        version: 3,
        preset: {
          prompts: [],
          promptOrder: ["main", "chatHistory"],
          maxContext: 4096,
          maxTokens: 512,
          temperature: 1,
          topP: 1,
          topK: 0,
          minP: 0,
          frequencyPenalty: 0,
          presencePenalty: 0,
          repetitionPenalty: 1,
          newChatPrompt: "",
          newExampleChatPrompt: "",
          continueNudgePrompt: "",
          assistantPrefill: "",
          wiFormat: "{0}",
          namesBehavior: 0,
          stream: true,
        },
      },
      worldbook: {
        id: "worldbook-1",
        updatedAt: 1710000001000,
        version: 5,
        worldbook: {
          name: "Campfire Worldbook",
          entries: [{
            uid: 7,
            key: ["campfire"],
            keysecondary: [],
            selective: false,
            selectiveLogic: WI_LOGIC.AND_ANY,
            constant: false,
            content: "Campfire lore",
            comment: "Campfire",
            position: WI_POSITION.BEFORE,
            order: 100,
            depth: 4,
            role: WI_ROLE.SYSTEM,
            disable: false,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
          }],
          scanDepth: 4,
          caseSensitive: false,
          matchWholeWords: false,
          recursive: false,
          maxRecursionSteps: 0,
        },
      },
      regexProfile: {
        id: "regex-1",
        updatedAt: 1710000002000,
        version: 2,
        scripts: [],
      },
      character: {
        name: "Hero",
        description: "A hero.",
        systemPrompt: "Stay in character.",
        postHistoryInstructions: "Continue naturally.",
        groupOnlyGreetings: ["Group hello"],
        characterBook: { entries: [] },
      },
      characterId: "char-1",
      characterVersionId: "charver-1",
      characterContentHash: "char-hash-1",
    });

    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest.assets.map((asset) => asset.assetScopeId)).toEqual(expect.arrayContaining([
      "preset:preset-1:3",
      "character:char-1:charver-1",
      "worldbook:worldbook-1:5",
      "worldbook:character:char-1:charver-1:book",
      "regex_profile:regex-1:2",
    ]));
    expect(result.manifest.declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ part: "character_greetings", runtimeActive: false }),
      expect.objectContaining({ part: "character_book_ref", runtimeActive: true }),
      expect.objectContaining({ part: "worldbook_entries", runtimeActive: true }),
    ]));
  });

  it("keeps digest stable when only generatedAt changes", () => {
    const base = buildPromptAssetManifestForAssembly({
      generatedAt: 1,
      preset: null,
      worldbook: null,
      regexProfile: null,
      character: { name: "Hero" },
      characterId: "char-1",
      characterVersionId: "v1",
    });
    const next = buildPromptAssetManifestForAssembly({
      generatedAt: 2,
      preset: null,
      worldbook: null,
      regexProfile: null,
      character: { name: "Hero" },
      characterId: "char-1",
      characterVersionId: "v1",
    });

    expect(next.digest).toBe(base.digest);
  });
});
