import { describe, expect, it } from "vitest";

import {
  buildPromptRuntimeExecutionTrace,
} from "../prompt-runtime-execution.js";
import type { PromptRuntimeInspectionResult } from "../prompt-runtime-control-service.js";

describe("prompt-runtime execution trace phase additions", () => {
  it("keeps execution trace backward compatible when contributor data is absent", () => {
    const inspection: PromptRuntimeInspectionResult = {
      scope: {
        sessionId: "session-1",
        targetBranchId: "main",
        branchExists: true,
        sourceFloorId: null,
        historySourceBranchId: "main",
        historySourceMode: "existing_branch",
      },
      assets: {
        preset: null,
        characterCard: null,
        worldbook: null,
        regexProfile: null,
      },
      resolvedPolicy: {
        structure: {
          mode: "default",
          mergeAdjacentSameRole: true,
          preserveSystemMessages: true,
        },
        delivery: {
          allowAssistantPrefill: true,
          requireLastUser: false,
          noAssistant: false,
        },
        debug: {
          includePromptSnapshot: false,
          includeRuntimeTrace: false,
          includeWorldbookMatches: false,
        },
        budget: {},
        visibility: { mode: "allow_all_except_hidden" },
        sourceSelection: {
          history: { mode: "full" },
          memory: { enabled: true },
          worldbook: { enabled: true },
          examples: { enabled: true },
        },
      },
      sourceMap: {},
      diagnostics: [],
      trimReasons: [],
      excludedSources: [],
      sectionStats: [],
      limitations: [],
    };

    const trace = buildPromptRuntimeExecutionTrace({
      inspection,
      assembled: {
        messages: [],
        sendDirectives: {},
        tokenUsage: {
          total: 10,
          availableForReply: 4,
        },
        runtimeTraceSeed: {
          worldbookHits: 0,
          regexPreRules: [],
          regexPostRules: [],
          memorySummaryInjected: false,
          selectedPromptOrderCharacterId: null,
          ignoredPromptOrderCharacterIds: [],
          unsupportedPresetFields: [],
          ignoredPresetFields: [],
          unresolvedPresetMarkers: [],
          presetWarnings: [],
          continueNudgeApplied: false,
          namesBehaviorApplied: "off",
          triggerFilteredEntryIds: [],
          inChatInsertedEntryIds: [],
        },
        assemblyCompatSeed: {
          mode: "fallback",
          promptIntent: "normal",
          assistantPrefillApplied: false,
          assistantPrefillStrategy: "none",
          presetUsed: false,
          reservedVariableCollisions: [],
        },
        promptSnapshot: {
          presetId: null,
          presetUpdatedAt: null,
          presetVersion: null,
          presetVersionId: null,
          presetContentHash: null,
          worldbookId: null,
          worldbookUpdatedAt: null,
          worldbookVersion: null,
          worldbookVersionId: null,
          worldbookContentHash: null,
          regexProfileId: null,
          regexProfileUpdatedAt: null,
          regexProfileVersion: null,
          regexProfileVersionId: null,
          regexProfileContentHash: null,
          characterId: null,
          characterVersionId: null,
          characterImportedFormat: null,
          characterContentHash: null,
          worldbookActivatedEntryUids: [],
          worldbookActivatedEntries: [],
          regexPreRuleNames: [],
          regexPostRuleNames: [],
          promptMode: "compat_strict",
          assetManifestDigest: "digest",
          promptDigest: "digest",
          tokenEstimate: 10,
          createdAt: 1,
        },
      } as never,
      materialized: {
        messages: [],
      } as never,
    });

    expect(trace?.historyNormalization).toBeUndefined();
    expect(trace?.sourceSelection).toBeUndefined();
  });
});
