import type { RegexExecutionChannel } from "@tavern/adapters-sillytavern";
import type {
  ChatMessage,
  FloorRunType,
  GenerationParams,
  PromptRunIntent,
  TurnConfig,
} from "@tavern/core";

import { assemblePrompt, type SessionPromptInfo } from "../prompt-assembler.js";
import {
  buildPromptRuntimeExecutionResult,
  type PromptRuntimeResolvedContext,
} from "../prompt-runtime-execution.js";
import type { PromptVisibilityTrace } from "../chat-history-loader.js";
import type { AppDb } from "../../db/client.js";
import type { PromptRuntimeDiagnostic } from "../prompt-runtime-control-service.js";

import type { PromptLiveDebugOptions, ResolvedTurnModels } from "./contracts.js";
import type {
  FirstPartyStateContext,
  PreparedPromptArtifacts,
  PreparedPromptArtifactsMode,
} from "./types.js";
import { PromptPreparationService } from "./prompt-preparation-service.js";
import { TurnModelService } from "./turn-model-service.js";
import { TurnMemoryService } from "./turn-memory-service.js";
import { RegexInputService } from "./regex-input-service.js";
import { FirstPartyStateContextService } from "./first-party-state-context-service.js";

interface PreparedPromptArtifactsSessionShape {
  presetId: string | null;
  worldbookProfileId: string | null;
  regexProfileId: string | null;
  metadataJson: string | null;
  characterSnapshotJson: string | null;
  promptMode: SessionPromptInfo["promptMode"];
  userSnapshotJson: string | null;
}

interface PreparedPromptArtifactsRequestShape {
  config?: TurnConfig;
  generationParams?: Partial<GenerationParams>;
  promptIntent?: PromptRunIntent;
  debugOptions?: PromptLiveDebugOptions;
}

interface PreparedPromptArtifactsHistoryLoad {
  branchId: string;
  beforeFloorNo?: number;
}

export interface PreparePromptArtifactsArgs {
  mode: PreparedPromptArtifactsMode;
  runType: FloorRunType | "inspect";
  sessionId: string;
  branchId?: string;
  floorId?: string;
  pageId?: string;
  accountId: string;
  session: PreparedPromptArtifactsSessionShape;
  sessionInfo?: SessionPromptInfo;
  rawUserMessage: string;
  preprocessedUserMessage?: string;
  regexChannel?: RegexExecutionChannel;
  request: PreparedPromptArtifactsRequestShape;
  executionContext: PromptRuntimeResolvedContext;
  history?: ChatMessage[];
  visibilityTrace?: PromptVisibilityTrace;
  historyLoad?: PreparedPromptArtifactsHistoryLoad;
  resolvedTurnModels: ResolvedTurnModels;
  firstPartyStateContext?: FirstPartyStateContext;
  extraDiagnostics?: PromptRuntimeDiagnostic[];
  includeRuntimeTrace?: boolean;
}

export class PreparedPromptArtifactsBuilder {
  constructor(
    private readonly db: AppDb,
    private readonly tokenCounter: import("@tavern/core").TokenCounter,
    private readonly promptPreparationService: PromptPreparationService,
    private readonly modelService: TurnModelService,
    private readonly memoryService: TurnMemoryService,
    private readonly regexInputService: RegexInputService,
    private readonly firstPartyStateContextService: FirstPartyStateContextService,
  ) {}

  async prepare(args: PreparePromptArtifactsArgs): Promise<PreparedPromptArtifacts> {
    const sessionInfo = args.sessionInfo ?? this.modelService.buildSessionPromptInfo(
      args.session,
      args.resolvedTurnModels,
      args.firstPartyStateContext,
    );

    const preprocessedUserMessage = args.preprocessedUserMessage
      ?? await this.resolveUserMessage({
        accountId: args.accountId,
        sessionId: args.sessionId,
        branchId: args.branchId,
        floorId: args.floorId,
        pageId: args.pageId,
        rawUserMessage: args.rawUserMessage,
        regexChannel: args.regexChannel,
        session: args.session,
        sessionInfo,
      });

    const historyState = await this.resolveHistoryArtifacts({
      sessionId: args.sessionId,
      executionContext: args.executionContext,
      history: args.history,
      visibilityTrace: args.visibilityTrace,
      historyLoad: args.historyLoad,
    });

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

    const assembled = await assemblePrompt(
      this.db,
      args.accountId,
      sessionInfo,
      historyState.history,
      preprocessedUserMessage,
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
        includeDebug: true,
        runKind: args.runType === "inspect"
          ? "respond"
          : this.modelService.resolvePromptRunKind(args.runType),
        includeWorldbookMatchTrace: args.request.debugOptions?.includeWorldbookMatches === true,
        assistantPrefillStrategy,
        budget: args.executionContext.effectivePolicy?.budget,
        sourceSelection: args.executionContext.effectivePolicy?.sourceSelection,
      },
    );

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
      history: historyState.history,
      visibilityTrace: historyState.visibilityTrace,
      memorySummary: effectiveMemorySummary,
      assembled,
      worldbookHitCount: assembled.runtimeTraceSeed.worldbookHits,
      extraDiagnostics: [
        ...this.firstPartyStateContextService.buildFirstPartyStateDiagnostics(
          args.firstPartyStateContext,
          "assemble",
        ),
        ...(args.extraDiagnostics ?? []),
      ],
    });

    const execution = buildPromptRuntimeExecutionResult({
      tokenCounter: this.tokenCounter,
      userMessage: preprocessedUserMessage,
      floorId: args.floorId,
      sessionId: args.floorId ? args.sessionId : undefined,
      includeRuntimeTrace: args.includeRuntimeTrace ?? true,
      artifacts: {
        inspection,
        assembled,
        materialized,
        visibilityTrace: historyState.visibilityTrace,
      },
    });

    const generationParams = this.modelService.buildGenerationParams({
      requestParams: args.request.generationParams,
      narratorParams,
      availableForReply: execution.availableForReply ?? 0,
    });
    const requestedTurnConfig = this.modelService.resolveRequestedTurnConfig(
      args.request.config,
      args.resolvedTurnModels,
    );
    const turnConfig = this.modelService.toOrchestratorTurnConfig(requestedTurnConfig);

    return {
      mode: args.mode,
      runType: args.runType,
      sessionId: args.sessionId,
      branchId: args.branchId,
      accountId: args.accountId,
      userMessage: preprocessedUserMessage,
      rawUserMessage: args.rawUserMessage,
      executionContext: args.executionContext,
      history: historyState.history,
      visibilityTrace: historyState.visibilityTrace,
      memorySummary: effectiveMemorySummary,
      resolvedTurnModels: args.resolvedTurnModels,
      assembled,
      materialized,
      inspection,
      tokenEstimate: execution.tokenEstimate ?? 0,
      availableForReply: execution.availableForReply ?? 0,
      preprocessedUserMessage: execution.preprocessedUserMessage,
      promptSnapshot: execution.promptSnapshotPreview,
      promptSnapshotRecord: execution.promptSnapshotRecord,
      runtimeTrace: execution.runtimeTrace,
      generationParams,
      requestedTurnConfig,
      turnConfig,
    };
  }

  private async resolveUserMessage(args: {
    accountId: string;
    sessionId: string;
    branchId?: string;
    floorId?: string;
    pageId?: string;
    rawUserMessage: string;
    regexChannel?: RegexExecutionChannel;
    session: PreparedPromptArtifactsSessionShape;
    sessionInfo: SessionPromptInfo;
  }): Promise<string> {
    if (!args.regexChannel) {
      return args.rawUserMessage;
    }

    return this.regexInputService.applyPersistedUserInputRegex({
      accountId: args.accountId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.pageId,
      session: args.session,
      sessionInfo: args.sessionInfo,
      rawUserMessage: args.rawUserMessage,
      regexChannel: args.regexChannel,
    });
  }

  private async resolveHistoryArtifacts(args: {
    sessionId: string;
    executionContext: PromptRuntimeResolvedContext;
    history?: ChatMessage[];
    visibilityTrace?: PromptVisibilityTrace;
    historyLoad?: PreparedPromptArtifactsHistoryLoad;
  }): Promise<{ history: ChatMessage[]; visibilityTrace?: PromptVisibilityTrace }> {
    if (args.history) {
      return {
        history: this.promptPreparationService.applyPromptRuntimeHistorySourceSelection(
          args.history,
          args.executionContext.effectivePolicy?.sourceSelection,
        ),
        visibilityTrace: args.visibilityTrace,
      };
    }

    if (!args.historyLoad) {
      return {
        history: [],
        visibilityTrace: args.visibilityTrace,
      };
    }

    const loaded = await this.promptPreparationService.loadPromptRuntimeHistoryWindow({
      sessionId: args.sessionId,
      branchId: args.historyLoad.branchId,
      beforeFloorNo: args.historyLoad.beforeFloorNo,
      visibility: args.executionContext.resolvedPolicy.visibility,
      sourceSelection: args.executionContext.effectivePolicy?.sourceSelection,
    });

    return {
      history: loaded.history,
      visibilityTrace: loaded.visibilityTrace,
    };
  }
}
