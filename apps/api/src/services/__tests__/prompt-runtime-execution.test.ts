import { describe, expect, it } from "vitest";
import { SimpleTokenCounter } from "@tavern/core";

import {
  buildPromptRuntimeExecutionResult,
  buildPromptRuntimeExecutionTrace,
  buildPromptRuntimePreviewTrace,
  resolvePromptRuntimeExecutionContext,
} from "../prompt-runtime-execution.js";
import type { AssembleResult, MaterializePromptRuntimeMessagesResult } from "../prompt-assembler.js";
import type { PromptRuntimeInspectionResult } from "../prompt-runtime-control-service.js";

describe("prompt-runtime-execution", () => {
  it("resolves session, branch, and request policy layers into effective context", () => {
    const context = resolvePromptRuntimeExecutionContext({
      sessionId: "session-1",
      metadataJson: JSON.stringify({
        prompt_runtime: {
          policy: {
            structure: {
              mode: "strict_alternating",
            },
            delivery: {
              requireLastUser: true,
            },
          },
          branchPolicies: {
            alt: {
              delivery: {
                noAssistant: true,
              },
            },
          },
        },
      }),
      branchId: "alt",
      branchExists: true,
      historySourceBranchId: "alt",
      historySourceMode: "existing_branch",
      sourceFloorId: "floor-1",
      request: {
        budget: {
          maxInputTokens: 1024,
        },
        visibility: {
          mode: "deny_all_except_visible",
          visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
        },
      },
    });

    expect(context.scope).toEqual({
      sessionId: "session-1",
      targetBranchId: "alt",
      branchExists: true,
      sourceFloorId: "floor-1",
      historySourceBranchId: "alt",
      historySourceMode: "existing_branch",
    });
    expect(context.effectivePolicy).toEqual({
      structure: {
        mode: "strict_alternating",
      },
      delivery: {
        requireLastUser: true,
        noAssistant: true,
      },
      budget: {
        maxInputTokens: 1024,
      },
      visibility: {
        mode: "deny_all_except_visible",
        visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
      },
    });
    expect(context.resolvedPolicy.delivery).toEqual({
      allowAssistantPrefill: true,
      requireLastUser: true,
      noAssistant: true,
    });
    expect(context.resolvedPolicy.structure.mode).toBe("no_assistant");
    expect(context.resolvedPolicy.visibility).toEqual({
      mode: "deny_all_except_visible",
      visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
    });
  });

  it("merges preview macro trace with visibility and excluded source trace", () => {
    const trace = buildPromptRuntimeExecutionTrace({
      inspection: {
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
        excludedSources: [{
          source: "history",
          reason: "visibility_filtered",
          detail: "filtered",
        }],
        sectionStats: [],
        limitations: [],
      },
      visibilityTrace: {
        hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
        filteredFloorNos: [1, 2],
      },
      baseRuntimeTrace: {
        macro: {
          warnings: [],
          usedNames: ["lastUserMessage"],
          mutationPreview: [],
          stagedMutations: [],
          traces: [],
        },
      },
    });

    expect(trace).toEqual({
      macro: {
        warnings: [],
        usedNames: ["lastUserMessage"],
        mutationPreview: [],
        stagedMutations: [],
        traces: [],
      },
      sourceSelection: {
        excludedSources: [{
          source: "history",
          reason: "visibility_filtered",
          detail: "filtered",
        }],
      },
      visibility: {
        hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
        filteredFloorNos: [1, 2],
      },
    });
  });

  it("projects preview runtime trace down to macro, visibility, and source selection", () => {
    const trace = buildPromptRuntimePreviewTrace({
      macro: {
        warnings: [],
        usedNames: ["lastUserMessage"],
        mutationPreview: [],
        stagedMutations: [],
        traces: [],
      },
      sourceSelection: {
        excludedSources: [{
          source: "history",
          reason: "visibility_filtered",
        }],
      },
      visibility: {
        filteredFloorNos: [1, 2],
      },
      structure: {
        mode: "flattened",
        mergeAdjacentSameRole: false,
        assistantRewriteCount: 0,
        tailAssistantDetected: false,
      },
      delivery: {
        assistantPrefillRequested: false,
        assistantPrefillApplied: false,
        allowAssistantPrefill: true,
        requireLastUser: false,
        noAssistant: false,
        lastMessageRole: null,
        endsWithUser: false,
        degraded: false,
        degradeReasons: [],
      },
    });

    expect(trace).toEqual({
      macro: {
        warnings: [],
        usedNames: ["lastUserMessage"],
        mutationPreview: [],
        stagedMutations: [],
        traces: [],
      },
      sourceSelection: {
        excludedSources: [{
          source: "history",
          reason: "visibility_filtered",
        }],
      },
      visibility: {
        filteredFloorNos: [1, 2],
      },
    });
  });

  it("derives top-level usage summary and prompt snapshot preview from one execution projection path", () => {
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
    const assembled: AssembleResult = {
      messages: [{ role: "system", content: "old prompt" }],
      sendDirectives: {},
      tokenUsage: {
        total: 12,
        availableForReply: 8,
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
        worldbookId: null,
        worldbookUpdatedAt: null,
        worldbookVersion: null,
        regexProfileId: null,
        regexProfileUpdatedAt: null,
        regexProfileVersion: null,
        worldbookActivatedEntryUids: [],
        regexPreRuleNames: [],
        regexPostRuleNames: [],
        promptMode: "compat_strict",
        promptDigest: "old-digest",
        tokenEstimate: 1,
        createdAt: 123,
        preset: null,
        worldbook: null,
        regexProfile: null,
        metadata: {},
        variables: {},
      },
    };
    const materialized: MaterializePromptRuntimeMessagesResult = {
      messages: [{ role: "system", content: "alpha" }, { role: "user", content: "beta beta" }],
      deliveryTrace: {
        assistantPrefillRequested: false,
        assistantPrefillApplied: false,
        assistantPrefillStrategy: "none",
        allowAssistantPrefill: true,
        requireLastUser: false,
        noAssistant: false,
        lastMessageRole: "user",
        endsWithUser: true,
        degraded: false,
        degradeReasons: [],
      },
      assistantPrefillApplied: false,
      assistantPrefillStrategy: "none",
    };
    const tokenCounter = new SimpleTokenCounter();
    const expectedTokenEstimate = materialized.messages.reduce((sum, message) => sum + tokenCounter.count(message.content), 0);

    const result = buildPromptRuntimeExecutionResult({
      tokenCounter,
      userMessage: "hello",
      floorId: "floor-1",
      sessionId: "session-1",
      artifacts: {
        inspection,
        assembled,
        materialized,
      },
    });

    expect(result.tokenEstimate).toBe(expectedTokenEstimate);
    expect(result.availableForReply).toBe(20 - expectedTokenEstimate);
    expect(result.promptSnapshotPreview?.tokenEstimate).toBe(result.tokenEstimate);
    expect(result.promptSnapshotRecord?.tokenEstimate).toBe(result.tokenEstimate);
    expect(result.promptSnapshotPreview?.promptDigest).toBe(result.promptSnapshotRecord?.promptDigest);
    expect(result.promptSnapshotPreview?.promptDigest).not.toBe("old-digest");
    expect(assembled.promptSnapshot.promptDigest).toBe("old-digest");
    expect(assembled.promptSnapshot.tokenEstimate).toBe(1);
  });
});
