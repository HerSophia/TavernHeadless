import { createHash } from "node:crypto";

import {
  createPromptAssetDeclaration,
  createPromptAssetManifest,
  createPromptAssetRef,
  stableStringifyPromptAssetManifest,
  type PromptAssetDeclaration,
  type PromptAssetManifest,
  type PromptAssetRef,
} from "@tavern/core";

import type { SessionCharacterSnapshot } from "../../lib/character-snapshot.js";
import type {
  LoadedPromptPreset,
  LoadedPromptRegexProfile,
  LoadedPromptWorldbook,
} from "../prompt-resource-loader.js";

import { buildCharacterBookAssetScopeId, buildSessionWorldbookAssetScopeId } from "./worldbook/identity.js";

export interface PromptAssetManifestBuildInput {
  generatedAt: number;
  preset: LoadedPromptPreset | null;
  worldbook: LoadedPromptWorldbook | null;
  regexProfile: LoadedPromptRegexProfile | null;
  character?: SessionCharacterSnapshot;
  characterId?: string | null;
  characterVersionId?: string | null;
  characterContentHash?: string | null;
}

export interface PromptAssetManifestBuildResult {
  manifest: PromptAssetManifest;
  digest: string;
}

function pushAsset(target: PromptAssetRef[], asset: PromptAssetRef): PromptAssetRef {
  target.push(asset);
  return asset;
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function buildDigest(manifest: PromptAssetManifest): string {
  return createHash("sha256")
    .update(stableStringifyPromptAssetManifest({ ...manifest, generatedAt: 0 }))
    .digest("hex");
}

export function buildPromptAssetManifestForAssembly(
  input: PromptAssetManifestBuildInput,
): PromptAssetManifestBuildResult {
  const assets: PromptAssetRef[] = [];
  const declarations: PromptAssetDeclaration[] = [];

  if (input.preset) {
    const ref = pushAsset(assets, createPromptAssetRef({
      kind: "preset",
      assetId: input.preset.id,
      version: input.preset.version,
      assetScopeId: `preset:${input.preset.id}:${input.preset.version}`,
      origin: "imported_preset",
    }));
    declarations.push(createPromptAssetDeclaration({
      id: `${ref.assetScopeId}:graph`,
      ref,
      part: "preset_graph",
      runtimeActive: true,
      binding: { promptOrder: [...input.preset.preset.promptOrder] },
    }));
  }

  if (input.character) {
    const characterId = input.characterId ?? "unbound";
    const characterVersionId = input.characterVersionId ?? input.characterContentHash ?? "snapshot";
    const ref = pushAsset(assets, createPromptAssetRef({
      kind: "character",
      assetId: characterId,
      version: characterVersionId,
      assetScopeId: `character:${characterId}:${characterVersionId}`,
      name: input.character.name,
      origin: "session_binding",
    }));

    const profileParts = [input.character.description, input.character.personality, input.character.scenario]
      .filter(hasText);
    declarations.push(createPromptAssetDeclaration({
      id: `${ref.assetScopeId}:profile`,
      ref,
      part: "character_profile",
      runtimeActive: profileParts.length > 0,
      metadata: {
        hasDescription: hasText(input.character.description),
        hasPersonality: hasText(input.character.personality),
        hasScenario: hasText(input.character.scenario),
      },
    }));

    declarations.push(createPromptAssetDeclaration({
      id: `${ref.assetScopeId}:system_prompt`,
      ref,
      part: "character_system_prompt",
      runtimeActive: hasText(input.character.systemPrompt),
    }));
    declarations.push(createPromptAssetDeclaration({
      id: `${ref.assetScopeId}:post_history_instructions`,
      ref,
      part: "character_post_history_instructions",
      runtimeActive: hasText(input.character.postHistoryInstructions),
    }));
    declarations.push(createPromptAssetDeclaration({
      id: `${ref.assetScopeId}:greetings`,
      ref,
      part: "character_greetings",
      runtimeActive: false,
      metadata: {
        primaryGreeting: hasText(input.character.primaryGreeting),
        alternateGreetingCount: input.character.alternateGreetings?.length ?? 0,
        groupOnlyGreetingCount: input.character.groupOnlyGreetings?.length ?? 0,
        note: "greetings are stored for session initialization/export and are not a prompt runtime source in this phase",
      },
    }));
    declarations.push(createPromptAssetDeclaration({
      id: `${ref.assetScopeId}:metadata`,
      ref,
      part: "character_metadata",
      runtimeActive: false,
      metadata: {
        importedFormat: input.character.importedFormat ?? null,
        contentHash: input.characterContentHash ?? null,
      },
    }));

    if (input.character.characterBook !== undefined && input.character.characterBook !== null) {
      const characterBookRef = pushAsset(assets, createPromptAssetRef({
        kind: "worldbook",
        assetId: `character:${characterId}:book`,
        version: characterVersionId,
        assetScopeId: buildCharacterBookAssetScopeId(input.characterId, input.characterVersionId),
        name: `${input.character.name} character book`,
        origin: "character_embedded",
      }));
      declarations.push(createPromptAssetDeclaration({
        id: `${ref.assetScopeId}:character_book_ref`,
        ref,
        part: "character_book_ref",
        runtimeActive: true,
        binding: { assetScopeId: characterBookRef.assetScopeId },
      }));
      declarations.push(createPromptAssetDeclaration({
        id: `${characterBookRef.assetScopeId}:entries`,
        ref: characterBookRef,
        part: "worldbook_entries",
        runtimeActive: true,
        metadata: { origin: "character_embedded" },
      }));
    }
  }

  if (input.worldbook) {
    const ref = pushAsset(assets, createPromptAssetRef({
      kind: "worldbook",
      assetId: input.worldbook.id,
      version: input.worldbook.version,
      assetScopeId: buildSessionWorldbookAssetScopeId(input.worldbook),
      name: input.worldbook.worldbook.name,
      origin: "session_binding",
    }));
    declarations.push(createPromptAssetDeclaration({
      id: `${ref.assetScopeId}:entries`,
      ref,
      part: "worldbook_entries",
      runtimeActive: true,
      metadata: { entryCount: input.worldbook.worldbook.entries.length },
    }));
  }

  if (input.regexProfile) {
    const ref = pushAsset(assets, createPromptAssetRef({
      kind: "regex_profile",
      assetId: input.regexProfile.id,
      version: input.regexProfile.version,
      assetScopeId: `regex_profile:${input.regexProfile.id}:${input.regexProfile.version}`,
      origin: "runtime_profile",
    }));
    declarations.push(createPromptAssetDeclaration({
      id: `${ref.assetScopeId}:scripts`,
      ref,
      part: "regex_scripts",
      runtimeActive: input.regexProfile.scripts.length > 0,
      metadata: { scriptCount: input.regexProfile.scripts.length },
    }));
  }

  const manifest = createPromptAssetManifest({
    generatedAt: input.generatedAt,
    assets,
    declarations,
  });

  return {
    manifest,
    digest: buildDigest(manifest),
  };
}
