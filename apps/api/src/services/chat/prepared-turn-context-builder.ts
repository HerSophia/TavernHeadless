import {
  assemblePrompt,
  type SessionPromptInfo,
} from "../prompt-assembler.js";
import type { PromptVisibilityTrace } from "../chat-history-loader.js";
import type { PromptRuntimeResolvedContext } from "../prompt-runtime-execution.js";
import type { TurnInput, FloorRunType, GenerationParams, TurnConfig, PromptRunIntent } from "@tavern/core";

import type { AppDb } from "../../db/client.js";
import type { PromptLiveDebugOptions, ResolvedTurnModels } from "./contracts.js";
import type { FirstPartyStateContext, PreparedTurnContext, ChatWorkflowMode } from "./types.js";
import { PromptPreparationService } from "./prompt-preparation-service.js";
import { TurnModelService } from "./turn-model-service.js";
import { TurnToolingService } from "./turn-tooling-service.js";
import { TurnMemoryService } from "./turn-memory-service.js";
import { TurnRunTracker } from "./turn-run-tracker.js";
import { FirstPartyStateContextService } from "./first-party-state-context-service.js";

export class PreparedTurnContextBuilder {
  constructor(
    private readonly db: AppDb,
    private readonly tokenCounter: import("@tavern/core").TokenCounter,
    private readonly promptPreparationService: PromptPreparationService,
    private readonly modelService: TurnModelService,
    private readonly toolingService: TurnToolingService,
    private readonly memoryService: TurnMemoryService,
    private readonly turnRunTracker: TurnRunTracker,
    private readonly firstPartyStateContextService: FirstPartyStateContextService,
  ) {}

  async prepare(args: {
    mode: ChatWorkflowMode;
    runType: FloorRunType;
    sessionId: string;
    branchId?: string;
    floorId: string;
    pageId: string;
    accountId: string;
    session: {
      presetId: string | null;
      worldbookProfileId: string | null;
      regexProfileId: string | null;
      metadataJson: string | null;
      characterSnapshotJson: string | null;
      promptMode: SessionPromptInfo["promptMode"];
      userSnapshotJson: string | null;
    };
    sessionInfo?: SessionPromptInfo;
    userMessage: string;
    request: {
      config?: TurnConfig;
      generationParams?: Partial<GenerationParams>;
      promptIntent?: PromptRunIntent;
      debugOptions?: PromptLiveDebugOptions;
    };
    executionContext: PromptRuntimeResolvedContext;
    history: import("@tavern/core").ChatMessage[];
    visibilityTrace?: PromptVisibilityTrace;
    resolvedTurnModels: ResolvedTurnModels;
    firstPartyStateContext?: FirstPartyStateContext;
    abortSignal?: AbortSignal;
    onChunk?: (chunk: string) => void;
    stream?: boolean;
  }): Promise<PreparedTurnContext> {
    const history = this.promptPreparationService.applyPromptRuntimeHistorySourceSelection(
      args.history,
      args.executionContext.effectivePolicy?.sourceSelection,
    );
    const sessionInfo = args.sessionInfo ?? this.modelService.buildSessionPromptInfo(
      args.session,
      args.resolvedTurnModels,
      args.firstPartyStateContext,
    );
    const memorySummary = await this.memoryService.retrieveMemorySummary(
      args.sessionId,
      args.accountId,
      args.floorId,
      args.branchId,
    );
    const effectiveMemorySummary = args.executionContext.resolvedPolicy.sourceSelection.memory.enabled === false
      ? undefined
      : memorySummary;
    const narratorParams = this.modelService.getSlotGenerationParams(args.resolvedTurnModels, "narrator");
    const assistantPrefillStrategy = this.modelService.resolveNarratorAssistantPrefillStrategy(args.resolvedTurnModels);
    const maxContextTokensOverride = this.modelService.resolveMaxContextTokensOverride(
      args.request.generationParams,
      narratorParams,
    );
    const maxOutputTokensOverride = this.modelService.resolveMaxOutputTokensOverride(
      args.request.generationParams,
      narratorParams,
    );
    const includeRuntimeTrace = args.request.debugOptions?.includeRuntimeTrace === true;

    const assembled = await assemblePrompt(
      this.db,
      args.accountId,
      sessionInfo,
      history,
      args.userMessage,
      this.tokenCounter,
      effectiveMemorySummary,
      {
        maxContextTokensOverride,
        maxOutputTokensOverride,
        variableContext: {
          sessionId: args.sessionId,
          branchId: args.branchId,
          floorId: args.floorId,
          pageId: args.pageId,
        },
        intent: args.request.promptIntent,
        includeDebug: includeRuntimeTrace,
        runKind: this.modelService.resolvePromptRunKind(args.runType),
        includeWorldbookMatchTrace: includeRuntimeTrace && args.request.debugOptions?.includeWorldbookMatches === true,
        assistantPrefillStrategy,
        budget: args.executionContext.effectivePolicy?.budget,
        sourceSelection: args.executionContext.effectivePolicy?.sourceSelection,
      },
    );
    await this.turnRunTracker.trackFloorRunPhase(args.floorId, "prompt_assembled");

    const materialized = this.promptPreparationService.materializeTurnPromptMessages(
      assembled.messages,
      assembled.sendDirectives,
      assistantPrefillStrategy,
      args.executionContext.effectivePolicy?.structure,
      args.executionContext.effectivePolicy?.delivery,
    );
    const inspection = await this.promptPreparationService.buildPromptRuntimeInspection({
      accountId: args.accountId,
      context: args.executionContext,
      phase: "assemble",
      history,
      visibilityTrace: args.visibilityTrace,
      memorySummary: effectiveMemorySummary,
      assembled,
      worldbookHitCount: assembled.runtimeTraceSeed.worldbookHits,
      extraDiagnostics: this.firstPartyStateContextService.buildFirstPartyStateDiagnostics(
        args.firstPartyStateContext,
        "assemble",
      ),
    });
    const promptDebug = this.promptPreparationService.buildLivePromptDebugArtifacts({
      floorId: args.floorId,
      sessionId: args.sessionId,
      userMessage: args.userMessage,
      assembled,
      materialized,
      inspection,
      visibilityTrace: args.visibilityTrace,
      debugOptions: args.request.debugOptions,
    });

    const generationParams = this.modelService.buildGenerationParams({
      requestParams: args.request.generationParams,
      narratorParams,
      availableForReply: promptDebug.availableForReply,
      stream: args.stream,
    });
    const requestedTurnConfig = this.modelService.resolveRequestedTurnConfig(
      args.request.config,
      args.resolvedTurnModels,
    );
    const memoryConsolidationRequested = this.modelService.shouldRequestMemoryConsolidation(requestedTurnConfig);
    const turnConfig = this.modelService.toOrchestratorTurnConfig(requestedTurnConfig);
    const toolRuntime = await this.toolingService.resolveTurnToolingForTurn({
      sessionId: args.sessionId,
      accountId: args.accountId,
      config: turnConfig,
    });
    const consolidationContext = await this.memoryService.buildConsolidationContext(
      args.sessionId,
      args.accountId,
      args.floorId,
      args.branchId,
      args.userMessage,
      requestedTurnConfig?.enableMemoryConsolidation,
    );

    const turnInput: TurnInput = {
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.pageId,
      accountId: args.accountId,
      messages: materialized.messages,
      generationParams,
      config: turnConfig,
      consolidationContext,
      preProcess: assembled.preProcess,
      postProcess: assembled.postProcess,
      modelOverrides: this.modelService.buildModelOverrides(args.resolvedTurnModels),
      generationParamsOverrides: this.modelService.buildGenerationParamsOverrides(args.resolvedTurnModels),
      toolRegistry: toolRuntime.toolRegistry,
      toolPermissions: toolRuntime.toolPermissions,
      runObserver: this.turnRunTracker.createTurnRunObserver(args.floorId),
      ...(args.onChunk ? { onChunk: args.onChunk } : {}),
      ...(args.abortSignal ? { abortSignal: args.abortSignal } : {}),
    };

    return {
      mode: args.mode,
      runType: args.runType,
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.pageId,
      accountId: args.accountId,
      userMessage: args.userMessage,
      executionContext: args.executionContext,
      history,
      visibilityTrace: args.visibilityTrace,
      memorySummary: effectiveMemorySummary,
      resolvedTurnModels: args.resolvedTurnModels,
      assembled,
      materialized,
      inspection,
      promptDebug,
      generationParams,
      requestedTurnConfig,
      turnConfig,
      memoryConsolidationRequested,
      turnInput,
    };
  }
}
