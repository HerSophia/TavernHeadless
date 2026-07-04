import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimpleTokenCounter, type NodeGraphDocument } from "@tavern/core";

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
        persistentCount: 0,
        appliedCount: 1,
        notAppliedCount: 0,
        tokenCount: expect.any(Number),
        budgetGroup: "injection",
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

  it("forwards floor graph binding presetRef into assemblePrompt and records prompt recipe trace", async () => {
    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
      db: createPresetLookupDb(["preset-node"]),
    });
    const floorGraph = createFloorGraphWithPresetRef("preset-node", "preset-version-1");

    const result = await builder.prepare({
      ...createPrepareArgs(),
      floorGraphBinding: {
        source: "project",
        kind: "native",
        graphId: "ngraph_bound",
        graphVersionId: "ngver_bound",
        document: floorGraph,
      },
    } as never);

    const assembleOptions = promptAssemblerMocks.assemblePrompt.mock.calls.at(-1)?.[7];
    expect(assembleOptions?.presetRefOverride).toEqual({
      presetId: "preset-node",
      presetVersionId: "preset-version-1",
    });
    expect(result.preparePhaseTrace).toContainEqual({
      phase: "prompt_recipe",
      detail: {
        source: "node_preset_ref",
        hasNodePresetRef: true,
        floorGraphBinding: {
          source: "project",
          kind: "native",
          graphId: "ngraph_bound",
          graphVersionId: "ngver_bound",
          fallbackReason: null,
        },
      },
    });
  });

  it("keeps session fallback and records not_bound when no floor graph binding is present", async () => {
    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
    });

    const result = await builder.prepare(createPrepareArgs());

    const assembleOptions = promptAssemblerMocks.assemblePrompt.mock.calls.at(-1)?.[7];
    expect(assembleOptions?.presetRefOverride).toBeNull();
    expect(result.preparePhaseTrace).toContainEqual({
      phase: "prompt_recipe",
      detail: {
        source: "session_fallback",
        hasNodePresetRef: false,
        floorGraphBinding: {
          source: "none",
          kind: null,
          graphId: null,
          graphVersionId: null,
          fallbackReason: "not_bound",
        },
      },
    });
  });

  it("keeps session fallback when the bound floor graph has no presetRef", async () => {
    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
    });

    await builder.prepare({
      ...createPrepareArgs(),
      floorGraphBinding: {
        source: "project",
        kind: "compat",
        graphId: "ngraph_bound_no_ref",
        graphVersionId: "ngver_bound_no_ref",
        document: createFloorGraphWithPresetRef(null, null),
      },
    } as never);

    const assembleOptions = promptAssemblerMocks.assemblePrompt.mock.calls.at(-1)?.[7];
    expect(assembleOptions?.presetRefOverride).toBeNull();
  });

  it("keeps tool_list contributors available in compat_strict and marks strict_fixed placement", async () => {
    modelService.resolveRequestedTurnConfig.mockReturnValueOnce({ enableTools: true });
    modelService.toOrchestratorTurnConfig.mockReturnValueOnce({ enableTools: true });
    turnToolingService.resolveTurnToolingForTurn.mockResolvedValueOnce({
      toolRegistry: {
        listForSlot: vi.fn(async () => [createNarratorTool()]),
      },
      toolPermissions: { enabled: true },
    });

    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
    });

    const result = await builder.prepare({
      ...createPrepareArgs(),
      llmInstanceCapabilities: {
        supportsFunctionCall: false,
        supportsToolChoice: false,
        supportsStreamingToolCall: false,
        unsupportedGenerationParams: [],
      },
    } as never);

    const assembleOptions = promptAssemblerMocks.assemblePrompt.mock.calls.at(-1)?.[7];
    expect(assembleOptions?.contributors).toContainEqual(expect.objectContaining({
      sourceKind: "tool_list",
      title: "Tool list",
    }));
    expect(result.toolTransport).toMatchObject({
      selection: {
        transport: "text_protocol",
        reasonCode: "instance_not_supports_function_call",
      },
      toolList: {
        injected: true,
        contributorId: "builtin:tool_list",
        placementMode: "strict_fixed",
        toolCount: 1,
        tokenCount: expect.any(Number),
        budgetGroup: "tool_list",
      },
    });
  });

  it("forwards agent contributors into contributor resolution", async () => {
    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
    });

    await builder.prepare({
      ...createPrepareArgs(),
      session: {
        ...createPrepareArgs().session,
        promptMode: "compat_plus",
      },
      sessionInfo: {
        ...createPrepareArgs().sessionInfo,
        promptMode: "compat_plus",
      },
      agentContributors: [
        {
          id: "agent:director",
          kind: "director_hint",
          sourceKind: "director_hint",
          modeScope: "compat_plus",
          payload: { intent: "stay focused" },
          promptRenderable: {
            title: "Director hint",
            content: "Intent: stay focused",
          },
          trace: {
            deterministic: true,
            cacheScope: "floor",
          },
        },
      ],
    } as never);

    const assembleOptions = promptAssemblerMocks.assemblePrompt.mock.calls.at(-1)?.[7];
    expect(assembleOptions?.contributors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Director hint",
          content: "Intent: stay focused",
        }),
      ]),
    );
  });

  it("does not inject agent contributors into compat_strict by default", async () => {
    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
    });

    await builder.prepare({
      ...createPrepareArgs(),
      agentContributors: [
        {
          id: "agent:director",
          kind: "director_hint",
          sourceKind: "director_hint",
          modeScope: "compat_plus",
          payload: { intent: "stay focused" },
          promptRenderable: {
            title: "Director hint",
            content: "Intent: stay focused",
          },
          trace: {
            deterministic: true,
            cacheScope: "floor",
          },
        },
      ],
    } as never);

    const contributors = promptAssemblerMocks.assemblePrompt.mock.calls.at(-1)?.[7]?.contributors ?? [];
    expect(contributors.some((contributor: { sourceKind?: string }) => contributor.sourceKind === "director_hint")).toBe(false);
  });
  it("routes agent contributors through the injection pipeline as agent_injection when enabled", async () => {
    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
      routeAgentContributorsAsInjections: true,
    });

    await builder.prepare({
      ...createPrepareArgs(),
      session: {
        ...createPrepareArgs().session,
        promptMode: "native",
      },
      sessionInfo: {
        ...createPrepareArgs().sessionInfo,
        promptMode: "native",
      },
      agentContributors: [
        {
          id: "agent:director",
          kind: "director_hint",
          sourceKind: "director_hint",
          modeScope: "native",
          payload: { intent: "stay focused" },
          promptRenderable: {
            title: "Director hint",
            content: "Intent: stay focused",
          },
          trace: {
            deterministic: true,
            cacheScope: "floor",
          },
        },
      ],
    } as never);

    const assembleOptions = promptAssemblerMocks.assemblePrompt.mock.calls.at(-1)?.[7];
    // 不再走 contributor 渲染通路，避免双管线重复注入。
    const contributors = assembleOptions?.contributors ?? [];
    expect(contributors.some((contributor: { sourceKind?: string }) => contributor.sourceKind === "director_hint")).toBe(false);
    // 改走 injection 通路，获得 agent_injection 来源与 placement 解析。
    const injectionItems= assembleOptions?.injectionItems ?? [];
    const agentItem = injectionItems.find((item: { sourceKind?: string }) => item.sourceKind === "agent_injection");
    expect(agentItem).toBeDefined();
    expect(agentItem?.title).toBe("Director hint");
    expect(agentItem?.placementRequested).toBe("after_contributor_block");
    expect(agentItem?.sourceChain?.agentTypeId).toBe("director_hint");
  });

  it("falls back to after_history placement for agent injections outside native mode", async () => {
    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
      routeAgentContributorsAsInjections: true,
    });

    await builder.prepare({
      ...createPrepareArgs(),
      session: {
    ...createPrepareArgs().session,
        promptMode: "compat_plus",
      },
      sessionInfo: {
        ...createPrepareArgs().sessionInfo,
        promptMode: "compat_plus",
      },
      agentContributors: [
        {
          id: "agent:director",
          kind: "director_hint",
          sourceKind: "director_hint",
          modeScope: "compat_plus",
          payload: { intent: "stay focused" },
          promptRenderable: {
            title: "Director hint",
            content: "Intent: stay focused",
          },
          trace: {
      deterministic: true,
            cacheScope: "floor",
          },
        },
      ],
    } as never);

    const assembleOptions= promptAssemblerMocks.assemblePrompt.mock.calls.at(-1)?.[7];
    const injectionItems = assembleOptions?.injectionItems ?? [];
    const agentItem = injectionItems.find((item: { sourceKind?: string }) => item.sourceKind ==="agent_injection");
    expect(agentItem).toBeDefined();
    expect(agentItem?.placementRequested).toBe("after_history");
    expect(agentItem?.applied).toBe(true);
  });



  it("records native tool choice application and disables stream when streaming tool calls are unsupported", async () => {
    modelService.resolveRequestedTurnConfig.mockReturnValueOnce({ enableTools: true });
    modelService.toOrchestratorTurnConfig.mockReturnValueOnce({ enableTools: true });
    turnToolingService.resolveTurnToolingForTurn.mockResolvedValueOnce({
      toolRegistry: {
        listForSlot: vi.fn(async () => [createNarratorTool()]),
      },
      toolPermissions: { enabled: true },
    });

    const builder = createBuilder({
      promptPreparationService,
      modelService,
      memoryService,
      firstPartyStateContextService,
      turnToolingService,
    });

    const baseArgs = createPrepareArgs();
    const result = await builder.prepare({
      ...baseArgs,
      session: {
        ...baseArgs.session,
        promptMode: "native",
      },
      sessionInfo: {
        ...baseArgs.sessionInfo,
        promptMode: "native",
      },
      stream: true,
      llmInstanceCapabilities: {
        supportsFunctionCall: true,
        supportsToolChoice: true,
        supportsStreamingToolCall: false,
        unsupportedGenerationParams: [],
      },
    } as never);

    const generationParamsArgs = modelService.buildGenerationParamsResult.mock.calls.at(-1)?.[0];
    expect(generationParamsArgs).toMatchObject({ stream: false });
    expect(result.toolTransport).toMatchObject({
      selection: {
        transport: "native_function_call",
        reasonCode: "default_native_function_call",
      },
      toolChoiceApplied: true,
      streamingToolCallUnsupported: true,
      // native 模式下注入反幻觉协议说明 contributor（与 text_protocol 对称），
      // 因此 toolList.injected 为 true；native 不输出 <tool_list> 清单，只注入说明文本。
      toolList: {
        injected: true,
        toolCount: 1,
      },
    });
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
  routeAgentContributorsAsInjections?: boolean;
  db?: unknown;
}): PreparedPromptArtifactsBuilder {
  return new PreparedPromptArtifactsBuilder(
    (args.db ?? {}) as never,
    new SimpleTokenCounter(),
    args.promptPreparationService as never,
    args.modelService as never,
    args.memoryService as never,
    {
      applyPersistedUserInputRegex: vi.fn(),
        } as never,
    args.firstPartyStateContextService as never,
    args.turnToolingService as never,
    {
      enablePersistentInjections: false,
      ...(args.routeAgentContributorsAsInjections === true
        ? { routeAgentContributorsAsInjections: true }
        : {}),
    },
  );
}

function createPresetLookupDb(existingPresetIds: string[]) {
  const presetIds = new Set(existingPresetIds);
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => {
            const first = [...presetIds][0];
            return first ? { id: first } : undefined;
          },
        }),
      }),
    }),
  };
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

function createFloorGraphWithPresetRef(
  presetId: string | null,
  presetVersionId: string | null,
): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "ngraph_bound",
    name: "Bound Floor Graph",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "user_input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      {
        id: "narrator",
        type: "narration.narrator",
        typeVersion: "1",
        phase: "response",
        config: presetId
          ? { presetRef: { presetId, presetVersionId } }
          : {},
      },
    ],
    edges: [
      { id: "e_user_input_narrator", kind: "data", from: { nodeId: "user_input", port: "text" }, to: { nodeId: "narrator", port: "user_input" } },
    ],
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
    visibility: "client" as const,
    scope: "request" as const,
    placementRequested: "before_history",
    orderRequested: 100,
    title,
    contentLength: title.length,
    applied: true,
    placementResolved,
  };
}

function createNarratorTool(name = "roll_dice") {
  return {
    name,
    description: `${name} description`,
    parameters: {
      type: "object" as const,
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
    },
    sideEffectLevel: "none" as const,
    allowedSlots: [],
    source: "builtin" as const,
  };
}
