import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimpleTokenCounter } from "@tavern/core";

import type { PromptRuntimeInspectionResult } from "../prompt-runtime-control-service.js";

const promptAssemblerMocks = vi.hoisted(() => ({
  assemblePrompt: vi.fn(),
}));

const promptRuntimeExecutionMocks = vi.hoisted(() => ({
  buildPromptRuntimeExecutionResult: vi.fn(),
}));

vi.mock("../prompt-assembler.js", async () => {
  const actual = await vi.importActual<typeof import("../prompt-assembler.js")>("../prompt-assembler.js");
  return {
    ...actual,
    assemblePrompt: promptAssemblerMocks.assemblePrompt,
  };
});

vi.mock("../prompt-runtime-execution.js", async () => {
  const actual = await vi.importActual<typeof import("../prompt-runtime-execution.js")>("../prompt-runtime-execution.js");
  return {
    ...actual,
    buildPromptRuntimeExecutionResult: promptRuntimeExecutionMocks.buildPromptRuntimeExecutionResult,
  };
});

import { PreparedPromptArtifactsBuilder } from "../chat/prepared-prompt-artifacts-builder.js";

describe("PreparedPromptArtifactsBuilder injections", () => {
  const validRequestInjection = {
    sourceKind: "client_injection" as const,
    title: "History guard",
    content: "Keep the north pass in focus.",
    placement: "before_history",
  };

  let promptPreparationService: {
    materializeTurnPromptMessages: ReturnType<typeof vi.fn>;
    buildPromptRuntimeInspection: ReturnType<typeof vi.fn>;
  };
  let modelService: {
    getSlotGenerationParams: ReturnType<typeof vi.fn>;
    resolveNarratorAssistantPrefillStrategy: ReturnType<typeof vi.fn>;
    resolveRequestedTurnConfig: ReturnType<typeof vi.fn>;
    toOrchestratorTurnConfig: ReturnType<typeof vi.fn>;
    resolveMemoryWritePolicy: ReturnType<typeof vi.fn>;
    resolveMaxContextTokensOverride: ReturnType<typeof vi.fn>;
    resolveMaxOutputTokensOverride: ReturnType<typeof vi.fn>;
    buildGenerationParamsResult: ReturnType<typeof vi.fn>;
    getSlotGenerationParamOrigins: ReturnType<typeof vi.fn>;
    resolvePromptRunKind: ReturnType<typeof vi.fn>;
  };
  let memoryService: {
    retrieveMemoryInjection: ReturnType<typeof vi.fn>;
  };
  let firstPartyStateContextService: {
    buildFirstPartyStateDiagnostics: ReturnType<typeof vi.fn>;
  };
  let turnToolingService: {
    resolveTurnToolingForTurn: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    promptAssemblerMocks.assemblePrompt.mockReset();
    promptAssemblerMocks.assemblePrompt.mockImplementation(async (_db, _accountId, _sessionInfo, _history, _userMessage, _tokenCounter, _memorySummary, options) => (
      createAssembledResult(options?.injectionItems)
    ));

    promptRuntimeExecutionMocks.buildPromptRuntimeExecutionResult.mockReset();
    promptRuntimeExecutionMocks.buildPromptRuntimeExecutionResult.mockReturnValue({
      tokenEstimate: 21,
      availableForReply: 13,
      preprocessedUserMessage: "Processed input",
    });

    promptPreparationService = {
      materializeTurnPromptMessages: vi.fn(() => ({
        messages: [{ role: "system", content: "Materialized prompt" }],
      })),
      buildPromptRuntimeInspection: vi.fn(async ({
        injections,
      }: {
        injections?: PromptRuntimeInspectionResult["injections"];
      }) => createInspectionResult({
        ...(injections ? { injections } : {}),
      })),
    };

    modelService = {
      getSlotGenerationParams: vi.fn(() => undefined),
      resolveNarratorAssistantPrefillStrategy: vi.fn(() => "none"),
      resolveRequestedTurnConfig: vi.fn(() => undefined),
      toOrchestratorTurnConfig: vi.fn(() => undefined),
      resolveMemoryWritePolicy: vi.fn(() => ({
        runtimeMode: "disabled",
        requestedWrite: false,
        effectiveWrite: false,
      })),
      resolveMaxContextTokensOverride: vi.fn(() => undefined),
      resolveMaxOutputTokensOverride: vi.fn(() => undefined),
      buildGenerationParamsResult: vi.fn(() => ({
        params: { maxOutputTokens: 13 },
        resolution: [],
      })),
      getSlotGenerationParamOrigins: vi.fn(() => ({})),
      resolvePromptRunKind: vi.fn(() => "respond"),
    };

    memoryService = {
      retrieveMemoryInjection: vi.fn(async () => undefined),
    };

    firstPartyStateContextService = {
      buildFirstPartyStateDiagnostics: vi.fn(() => []),
    };

    turnToolingService = {
      resolveTurnToolingForTurn: vi.fn(async () => ({})),
    };
  });

  it("records the injection phase and forwards request injections into assemblePrompt", async () => {
    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
    });

    const result = await builder.prepare(createPrepareArgs({
      request: {
        promptRuntimeInjections: [validRequestInjection],
      },
    }));

    expect(result.preparePhaseTrace).toContainEqual({
      phase: "injection",
      detail: {
        requestedCount: 1,
        appliedCount: 1,
        notAppliedCount: 0,
      },
    });

    const assembleOptions = promptAssemblerMocks.assemblePrompt.mock.calls[0]?.[7];
    expect(assembleOptions).toMatchObject({
      contributors: [
        {
          sourceKind: "client_injection",
          title: "History guard",
          content: "Keep the north pass in focus.",
          internalPlacementKey: "history.before",
          requestedPlacement: "before_history",
          requestedOrder: 100,
          requestIndex: 0,
          scope: "request",
        },
      ],
      injectionItems: [
        {
          placementRequested: "before_history",
          placementResolved: "history.before",
          title: "History guard",
          applied: true,
        },
      ],
    });
    expect(result.injections).toMatchObject([
      {
        placementRequested: "before_history",
        placementResolved: "history.before",
        title: "History guard",
        applied: true,
      },
    ]);
  });

  it.each([
    {
      label: "prefers inspection injections over assembled runtime trace seed",
      inspectionInjections: [createInjectionTraceItem("Inspection trace", "history.before")],
      assembledInjections: [createInjectionTraceItem("Assembled seed", "history.before")],
      expectedTitle: "Inspection trace",
    },
    {
      label: "falls back to assembled runtime trace seed when inspection omits injections",
      inspectionInjections: undefined,
      assembledInjections: [createInjectionTraceItem("Assembled seed", "history.before")],
      expectedTitle: "Assembled seed",
    },
    {
      label: "falls back to request build items when neither inspection nor assembled seed expose injections",
      inspectionInjections: undefined,
      assembledInjections: undefined,
      expectedTitle: "History guard",
    },
  ])("resolves injection fallback order: $label", async ({ inspectionInjections, assembledInjections, expectedTitle }) => {
    promptAssemblerMocks.assemblePrompt.mockResolvedValueOnce(createAssembledResult(assembledInjections));
    promptPreparationService.buildPromptRuntimeInspection.mockResolvedValueOnce(createInspectionResult({
      ...(inspectionInjections ? { injections: inspectionInjections } : {}),
    }));

    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
    });

    const result = await builder.prepare(createPrepareArgs({
      request: {
        promptRuntimeInjections: [validRequestInjection],
      },
    }));

    expect(result.injections).toHaveLength(1);
    expect(result.injections[0]?.title).toBe(expectedTitle);
  });
});

function createBuilder(args: {
  promptPreparationService: {
    materializeTurnPromptMessages: ReturnType<typeof vi.fn>;
    buildPromptRuntimeInspection: ReturnType<typeof vi.fn>;
  };
  modelService: {
    getSlotGenerationParams: ReturnType<typeof vi.fn>;
    resolveNarratorAssistantPrefillStrategy: ReturnType<typeof vi.fn>;
    resolveRequestedTurnConfig: ReturnType<typeof vi.fn>;
    toOrchestratorTurnConfig: ReturnType<typeof vi.fn>;
    resolveMemoryWritePolicy: ReturnType<typeof vi.fn>;
    resolveMaxContextTokensOverride: ReturnType<typeof vi.fn>;
    resolveMaxOutputTokensOverride: ReturnType<typeof vi.fn>;
    buildGenerationParamsResult: ReturnType<typeof vi.fn>;
    getSlotGenerationParamOrigins: ReturnType<typeof vi.fn>;
    resolvePromptRunKind: ReturnType<typeof vi.fn>;
  };
  memoryService: {
    retrieveMemoryInjection: ReturnType<typeof vi.fn>;
  };
  firstPartyStateContextService: {
    buildFirstPartyStateDiagnostics: ReturnType<typeof vi.fn>;
  };
  turnToolingService: {
    resolveTurnToolingForTurn: ReturnType<typeof vi.fn>;
  };
}): PreparedPromptArtifactsBuilder {
  return new PreparedPromptArtifactsBuilder(
    {} as never,
    new SimpleTokenCounter(),
    args.promptPreparationService as never,
    args.modelService as never,
    args.memoryService as never,
    {
      applyPersistedUserInputRegex: vi.fn(),
    } as never,
    args.firstPartyStateContextService as never,
    args.turnToolingService as never,
  );
}

function createPrepareArgs(overrides: {
  request?: {
    promptRuntimeInjections?: Array<{
      sourceKind: "client_injection";
      title: string;
      content: string;
      placement: string;
    }>;
  };
} = {}) {
  const session = {
    presetId: "preset-1",
    worldbookProfileId: null,
    regexProfileId: null,
    metadataJson: null,
    characterSnapshotJson: JSON.stringify({ name: "Knight" }),
    promptMode: "compat_strict" as const,
    userSnapshotJson: JSON.stringify({ name: "Traveler" }),
  };

  return {
    mode: "respond" as const,
    runType: "respond" as never,
    sessionId: "session-1",
    branchId: "main",
    accountId: "default-admin",
    session,
    sessionInfo: { ...session },
    rawUserMessage: "Raw input",
    preprocessedUserMessage: "Processed input",
    request: overrides.request ?? {},
    executionContext: createExecutionContext() as never,
    conversationWindow: createConversationWindow(),
    resolvedTurnModels: {},
  };
}

function createConversationWindow() {
  return {
    history: [],
    effectiveTurns: [],
    selectedTurns: [],
    effectiveUserMessage: "Processed input",
    visibilityTrace: { filteredFloorNos: [] },
    historyNormalization: {
      rawEntryCount: 0,
      effectiveTurnCount: 0,
      selectedTurnCount: 0,
      trailingUserSourceFloorIds: [],
      mergedUserGroups: [],
      violations: [],
    },
  };
}

function createExecutionContext() {
  return {
    scope: {
      sessionId: "session-1",
      targetBranchId: "main",
      branchExists: true,
      sourceFloorId: null,
      historySourceBranchId: "main",
      historySourceMode: "existing_branch",
    },
    sessionPolicyWarnings: [],
    branchPolicyWarnings: [],
    effectivePolicy: {
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
      budget: {},
      visibility: { mode: "allow_all_except_hidden" },
      sourceSelection: {
        history: { mode: "full" },
        memory: { enabled: true },
        worldbook: { enabled: true },
        examples: { enabled: true },
      },
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
  };
}

function createAssembledResult(injectionItems?: unknown[]) {
  return {
    messages: [{ role: "system", content: "Assembled prompt" }],
    sendDirectives: {},
    tokenUsage: {
      total: 21,
      availableForReply: 13,
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
      ...(injectionItems ? { injectionItems } : {}),
    },
  } as never;
}

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
  } as PromptRuntimeInspectionResult;
}

function createInjectionTraceItem(title: string, placementResolved: string) {
  return {
    requestIndex: 0,
    sourceKind: "client_injection",
    scope: "request" as const,
    placementRequested: "before_history",
    orderRequested: 100,
    title,
    contentLength: title.length,
    applied: true,
    placementResolved,
  };
}
