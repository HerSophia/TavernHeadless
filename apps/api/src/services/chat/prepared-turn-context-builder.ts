import type {
  TurnInput,
  FloorRunType,
  GenerationParams,
  TurnConfig,
  PromptRunIntent,
} from "@tavern/core";

import type { PromptLiveDebugOptions, ResolvedTurnModels } from "./contracts.js";
import type { FirstPartyStateContext, PreparedTurnContext } from "./types.js";
import type { PromptRuntimeConversationWindow } from "./prompt-preparation-service.js";
import { PreparedPromptArtifactsBuilder } from "./prepared-prompt-artifacts-builder.js";
import { TurnModelService } from "./turn-model-service.js";
import { TurnToolingService } from "./turn-tooling-service.js";
import { TurnMemoryService } from "./turn-memory-service.js";
import { TurnRunTracker } from "./turn-run-tracker.js";
import { buildPromptRuntimeGovernanceView } from "../prompt-runtime/governance-view-builder.js";

export class PreparedTurnContextBuilder {
  constructor(
    private readonly preparedPromptArtifactsBuilder: PreparedPromptArtifactsBuilder,
    private readonly modelService: TurnModelService,
    private readonly toolingService: TurnToolingService,
    private readonly memoryService: TurnMemoryService,
    private readonly turnRunTracker: TurnRunTracker,
  ) {}

  async prepare(args: {
    mode: PreparedTurnContext["mode"];
    runType: FloorRunType;
    sessionId: string;
    branchId?: string;
    floorId: string;
    pageId?: string;
    pageMessageId?: string;
    accountId: string;
    session: {
      presetId: string | null;
      worldbookProfileId: string | null;
      regexProfileId: string | null;
      metadataJson: string | null;
      characterSnapshotJson: string | null;
      promptMode: import("../prompt-assembler.js").SessionPromptInfo["promptMode"];
      userSnapshotJson: string | null;
    };
    sessionInfo?: import("../prompt-assembler.js").SessionPromptInfo;
    userMessage: string;
    rawUserMessage?: string;
    baseRuntimeTrace?: import("../prompt-assembler.js").PromptRuntimeTrace;
    request: {
      config?: TurnConfig;
      generationParams?: Partial<GenerationParams>;
      promptIntent?: PromptRunIntent;
      debugOptions?: PromptLiveDebugOptions;
    };
    executionContext: import("../prompt-runtime-execution.js").PromptRuntimeResolvedContext;
    conversationWindow?: PromptRuntimeConversationWindow;
    resolvedTurnModels: ResolvedTurnModels;
    firstPartyStateContext?: FirstPartyStateContext;
    abortSignal?: AbortSignal;
    onChunk?: (chunk: string) => void;
    stream?: boolean;
  }): Promise<PreparedTurnContext> {
    const artifacts = await this.preparedPromptArtifactsBuilder.prepare({
      mode: args.mode,
      runType: args.runType,
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.pageId,
      pageMessageId: args.pageMessageId,
      accountId: args.accountId,
      session: args.session,
      sessionInfo: args.sessionInfo,
      rawUserMessage: args.rawUserMessage ?? args.userMessage,
      preprocessedUserMessage: args.userMessage,
      request: args.request,
      executionContext: args.executionContext,
      conversationWindow: args.conversationWindow,
      resolvedTurnModels: args.resolvedTurnModels,
      firstPartyStateContext: args.firstPartyStateContext,
      includeRuntimeTrace: args.request.debugOptions?.includeRuntimeTrace === true,
      baseRuntimeTrace: args.baseRuntimeTrace,
    });
    const inspection = {
      ...artifacts.inspection,
      governance: buildPromptRuntimeGovernanceView({ assembled: artifacts.assembled }),
    };
    await this.turnRunTracker.trackFloorRunPhase(args.floorId, "prompt_assembled");

    const generationParams = this.modelService.buildGenerationParams({
      requestParams: args.request.generationParams,
      narratorParams: this.modelService.getSlotGenerationParams(args.resolvedTurnModels, "narrator"),
      availableForReply: artifacts.availableForReply,
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
      ...(args.pageId ? { pageId: args.pageId } : {}),
      accountId: args.accountId,
      messages: artifacts.materialized.messages,
      generationParams,
      config: turnConfig,
      consolidationContext,
      preProcess: artifacts.assembled.preProcess,
      postProcess: artifacts.assembled.postProcess,
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
      ...(args.pageId ? { pageId: args.pageId } : {}),
      accountId: args.accountId,
      userMessage: artifacts.userMessage,
      executionContext: artifacts.executionContext,
      history: artifacts.history,
      visibilityTrace: artifacts.visibilityTrace,
      memorySummary: artifacts.memorySummary,
      resolvedTurnModels: artifacts.resolvedTurnModels,
      assembled: artifacts.assembled,
      materialized: artifacts.materialized,
      conversationInputSnapshot: artifacts.conversationInputSnapshot,
      historyNormalization: artifacts.historyNormalization,
      inspection,
      promptDebug: {
        availableForReply: artifacts.availableForReply,
        inspection,
        promptSnapshotRecord: artifacts.promptSnapshotRecord!,
        ...(args.request.debugOptions?.includePromptSnapshot === true && artifacts.promptSnapshot
          ? { promptSnapshot: artifacts.promptSnapshot }
          : {}),
        ...(artifacts.runtimeTrace ? { runtimeTrace: artifacts.runtimeTrace } : {}),
      },
      generationParams,
      requestedTurnConfig,
      turnConfig,
      memoryConsolidationRequested,
      turnInput,
    };
  }
}
