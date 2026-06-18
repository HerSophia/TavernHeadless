import { describe, expect, it } from "vitest";
import { SimpleTokenCounter } from "@tavern/core";

import {
  buildPromptRuntimeExecutionResult,
  buildPromptRuntimeExecutionTrace,
  buildPromptRuntimePreviewTrace,
  mergeToolResultBudgetTrace,
  resolvePromptRuntimeExecutionContext,
} from "../prompt-runtime-execution.js";
import type { AssembleResult, MaterializePromptRuntimeMessagesResult } from "../prompt-assembler.js";
import type { PromptRuntimeInspectionResult } from "../prompt-runtime-control-service.js";


function createInspectionResult(
  overrides: Partial<PromptRuntimeInspectionResult> = {},
): PromptRuntimeInspectionResult {
  return {
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
    ...overrides,
  };
}

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
        historyNormalization: {
          rawEntryCount: 3,
          effectiveTurnCount: 2,
          selectedTurnCount: 2,
          trailingUserSourceFloorIds: ["floor-2"],
          mergedUserGroups: [],
          violations: [],
        },
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
      historyNormalization: {
        rawEntryCount: 3,
        effectiveTurnCount: 2,
        selectedTurnCount: 2,
        trailingUserSourceFloorIds: ["floor-2"],
        mergedUserGroups: [],
        violations: [],
      },
    });
  });

  it("prefers inspection injections over the assembled runtime trace seed", () => {
    const inspectionInjections = [{
      requestIndex: 0,
      sourceKind: "client_injection",
      visibility: "client" as const,
      scope: "request" as const,
      placementRequested: "before_history",
      orderRequested: 30,
      title: "Inspection trace",
      contentLength: 16,
      applied: true,
      placementResolved: "history.before",
    }];
    const assembledInjections = [{
      requestIndex: 1,
      sourceKind: "client_injection",
      visibility: "client" as const,
      scope: "request" as const,
      placementRequested: "before_history",
      orderRequested: 30,
      title: "Assembled seed",
      contentLength: 14,
      applied: true,
      placementResolved: "history.before",
    }];

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
        excludedSources: [],
        sectionStats: [],
        limitations: [],
        injections: inspectionInjections,
      },
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
          injectionItems: assembledInjections,
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
    });

    expect(trace?.injection).toEqual({
      items: inspectionInjections,
      requestedCount: 1,
      appliedCount: 1,
      rejectedCount: 0,
    });
  });

  it("summarizes injection token usage into runtime trace", () => {
    const trace = buildPromptRuntimeExecutionTrace({
      inspection: createInspectionResult({
        injections: [
          {
            requestIndex: 0,
            sourceKind: "client_injection",
            visibility: "client" as const,
            scope: "request" as const,
            placementRequested: "before_history",
            orderRequested: 30,
            title: "Tokenized",
            contentLength: 16,
            tokenCount: 7,
            budgetGroup: "injection",
            applied: true,
            placementResolved: "history.before",
          },
          {
            requestIndex: 1,
            sourceKind: "client_injection",
            visibility: "client" as const,
            scope: "request" as const,
            placementRequested: "before_history",
            orderRequested: 30,
            title: "Rejected",
            contentLength: 16,
            tokenCount: 9,
            budgetGroup: "injection",
            applied: false,
            notAppliedReason: "scope_quota_exceeded",
            placementResolved: "history.before",
          },
        ],
      }),
    });

    expect(trace?.injection).toEqual({
      items: expect.any(Array),
      requestedCount: 2,
      appliedCount: 1,
      rejectedCount: 1,
      tokenCount: 7,
      budgetGroup: "injection",
    });
  });

  it("includes toolTransport in the execution trace when present on inspection", () => {
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
        excludedSources: [],
        sectionStats: [],
        toolTransport: {
          selection: {
            transport: "text_protocol",
            reasonCode: "explicit_override",
          },
          toolList: {
            injected: true,
            contributorId: "builtin:tool_list",
            placementMode: "contributor_chain",
            toolCount: 2,
            tokenCount: 96,
            budgetGroup: "tool_list",
          },
          toolResult: {
            writtenBack: true,
            blockCount: 1,
            tokenCount: 128,
            budgetGroup: "tool_result",
          },
        },
        limitations: [],
      },
    });

    expect(trace?.toolTransport).toEqual({
      selection: {
        transport: "text_protocol",
        reasonCode: "explicit_override",
      },
      toolList: {
        injected: true,
        contributorId: "builtin:tool_list",
        placementMode: "contributor_chain",
        toolCount: 2,
        tokenCount: 96,
        budgetGroup: "tool_list",
      },
      toolResult: {
        writtenBack: true,
        blockCount: 1,
        tokenCount: 128,
        budgetGroup: "tool_result",
      },
    });
  });

  it("merges written-back tool result tokens into the runtime budget trace", () => {
    const trace = mergeToolResultBudgetTrace({
      budgets: {
        byGroup: [
          { group: "history", tokenCount: 20 },
          { group: "tool_result", tokenCount: 10 },
        ],
      },
    }, {
      selection: {
        transport: "text_protocol",
        reasonCode: "explicit_override",
      },
      toolResult: {
        writtenBack: true,
        blockCount: 1,
        tokenCount: 5,
        budgetGroup: "tool_result",
      },
    });

    expect(trace.budgets?.byGroup).toEqual([
      { group: "history", tokenCount: 20 },
      { group: "tool_result", tokenCount: 15 },
    ]);
  });

  it("adds a tool result budget group when no prior budget entry exists", () => {
    const trace = mergeToolResultBudgetTrace({}, {
      selection: {
        transport: "text_protocol",
        reasonCode: "explicit_override",
      },
      toolResult: {
        writtenBack: true,
        blockCount: 1,
        tokenCount: 8,
        budgetGroup: "tool_result",
      },
    });

    expect(trace.budgets?.byGroup).toEqual([
      { group: "tool_result", tokenCount: 8 },
    ]);
  });

  it("does not add tool result budget entries when no result was written back", () => {
    const trace = mergeToolResultBudgetTrace({}, {
      selection: {
        transport: "text_protocol",
        reasonCode: "explicit_override",
      },
      toolResult: {
        writtenBack: false,
        blockCount: 0,
        tokenCount: 0,
        budgetGroup: "tool_result",
      },
    });

    expect(trace.budgets).toBeUndefined();
  });

  it("projects toolTransport into preview traces", () => {
    expect(buildPromptRuntimePreviewTrace({
      toolTransport: {
        selection: {
          transport: "text_protocol",
          reasonCode: "explicit_override",
        },
      },
    })).toEqual({
      toolTransport: {
        selection: {
          transport: "text_protocol",
          reasonCode: "explicit_override",
        },
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
        characterId: null,
        characterVersionId: null,
        characterImportedFormat: null,
        characterContentHash: null,
        worldbookActivatedEntryUids: [],
        worldbookActivatedEntries: [],
        regexPreRuleNames: [],
        regexPostRuleNames: [],
        promptMode: "compat_strict",
        assetManifestDigest: null,
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
