import type { RegexExecutionChannel } from "@tavern/adapters-sillytavern";
import type {
  ChatMessage,
  FloorRunType,
  GenerationParams,
  PromptRunIntent,
  TurnConfig,
} from "@tavern/core";

import {
  assemblePrompt,
  type PromptRuntimeTrace,
  type SessionPromptInfo,
} from "../prompt-assembler.js";
import {
  buildPromptRuntimeExecutionResult,
  type PromptRuntimeResolvedContext,
} from "../prompt-runtime-execution.js";
import type {
  PromptHistoryMessageEntry,
  PromptVisibilityTrace,
} from "../chat-history-loader.js";
import type { AppDb } from "../../db/client.js";
import type { PromptRuntimeDiagnostic } from "../prompt-runtime-control-service.js";
import { buildPromptRuntimeMemoryTrace } from "../memory/shared/index.js";

import type { PromptLiveDebugOptions, ResolvedTurnModels } from "./contracts.js";
import type {
  FirstPartyStateContext,
  PreparedPromptArtifacts,
  PreparedPromptArtifactsMode,
} from "./types.js";
import {
  PromptPreparationService,
  type PromptRuntimeConversationWindow,
} from "./prompt-preparation-service.js";
import { TurnModelService } from "./turn-model-service.js";
import { TurnMemoryService } from "./turn-memory-service.js";
import {
  RegexInputService,
  type PersistedUserInputRegexResult,
} from "./regex-input-service.js";
import { FirstPartyStateContextService } from "./first-party-state-context-service.js";
import { buildConversationHistoryWindow } from "./conversation-history-normalizer.js";
import {
  buildConversationInputSnapshot as buildFloorConversationInputSnapshot,
  type FloorConversationInputSnapshot,
} from "./shared/metadata.js";

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
  pageMessageId?: string;
  accountId: string;
  session: PreparedPromptArtifactsSessionShape;
  sessionInfo?: SessionPromptInfo;
  rawUserMessage: string;
  preprocessedUserMessage?: string;
  regexChannel?: RegexExecutionChannel;
  request: PreparedPromptArtifactsRequestShape;
  executionContext: PromptRuntimeResolvedContext;
  conversationWindow?: PromptRuntimeConversationWindow;
  history?: ChatMessage[];
  visibilityTrace?: PromptVisibilityTrace;
  historyLoad?: PreparedPromptArtifactsHistoryLoad;
  resolvedTurnModels: ResolvedTurnModels;
  firstPartyStateContext?: FirstPartyStateContext;
  extraDiagnostics?: PromptRuntimeDiagnostic[];
  includeRuntimeTrace?: boolean;
  baseRuntimeTrace?: PromptRuntimeTrace;
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

    const userMessageState = args.preprocessedUserMessage !== undefined
      ? {
          text: args.preprocessedUserMessage,
          runtimeTrace: args.baseRuntimeTrace?.regex,
        }
      : await this.resolveUserMessage({
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
    const preprocessedUserMessage = userMessageState.text;
    const baseRuntimeTrace = args.baseRuntimeTrace
      ?? (userMessageState.runtimeTrace ? { regex: userMessageState.runtimeTrace } : undefined);

    const conversationState = args.conversationWindow ?? await this.resolveConversationArtifacts({
      sessionId: args.sessionId,
      executionContext: args.executionContext,
      history: args.history,
      visibilityTrace: args.visibilityTrace,
      historyLoad: args.historyLoad,
      currentUserMessage: preprocessedUserMessage,
    });
    const effectiveUserMessage = conversationState.effectiveUserMessage ?? preprocessedUserMessage;
    const conversationInputSnapshot = this.buildConversationInputSnapshot({
      conversationState,
      effectiveUserMessage,
      currentInputPageId: args.pageId,
      currentInputMessageId: args.pageMessageId,
    });

    const narratorParams = this.modelService.getSlotGenerationParams(args.resolvedTurnModels, "narrator");
    const assistantPrefillStrategy = this.modelService.resolveNarratorAssistantPrefillStrategy(args.resolvedTurnModels);
    const requestedTurnConfig = this.modelService.resolveRequestedTurnConfig(
      args.request.config,
      args.resolvedTurnModels,
    );
    const memoryWritePolicy = this.modelService.resolveMemoryWritePolicy(requestedTurnConfig);
    const memoryInjection = args.executionContext.resolvedPolicy.sourceSelection.memory.enabled === false
      ? undefined
      : await this.memoryService.retrieveMemoryInjection(
          args.sessionId,
          args.accountId,
          args.floorId,
          args.branchId,
        );
    const effectiveMemorySummary = memoryInjection?.memorySummary;
    const memoryRuntimeTrace = {
      ...memoryWritePolicy,
      ...(memoryInjection?.memoryTrace ?? {}),
      ...(!memoryInjection ? { strategy: "none" as const } : {}),
    };
    const memoryTrace = buildPromptRuntimeMemoryTrace({
      summaryInjected: Boolean(effectiveMemorySummary),
      memoryTrace: memoryRuntimeTrace,
    });
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
      conversationState.history,
      effectiveUserMessage,
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
        memoryRuntimeTrace,
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
      history: conversationState.history,
      visibilityTrace: conversationState.visibilityTrace,
      memorySummary: effectiveMemorySummary,
      assembled,
      memoryTrace,
      historyNormalization: conversationState.historyNormalization,
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
      userMessage: effectiveUserMessage,
      floorId: args.floorId,
      sessionId: args.floorId ? args.sessionId : undefined,
      includeRuntimeTrace: args.includeRuntimeTrace ?? true,
      artifacts: {
        inspection,
        assembled,
        materialized,
        visibilityTrace: conversationState.visibilityTrace,
        ...(baseRuntimeTrace ? { baseRuntimeTrace } : {}),
      },
    });

    const generationParams = this.modelService.buildGenerationParams({
      requestParams: args.request.generationParams,
      narratorParams,
      availableForReply: execution.availableForReply ?? 0,
    });
    const turnConfig = this.modelService.toOrchestratorTurnConfig(requestedTurnConfig);

    return {
      mode: args.mode,
      runType: args.runType,
      sessionId: args.sessionId,
      branchId: args.branchId,
      accountId: args.accountId,
      userMessage: effectiveUserMessage,
      rawUserMessage: args.rawUserMessage,
      executionContext: args.executionContext,
      history: conversationState.history,
      visibilityTrace: conversationState.visibilityTrace,
      memorySummary: effectiveMemorySummary,
      resolvedTurnModels: args.resolvedTurnModels,
      assembled,
      materialized,
      conversationInputSnapshot,
      historyNormalization: conversationState.historyNormalization,
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
  }): Promise<PersistedUserInputRegexResult> {
    if (!args.regexChannel) {
      return { text: args.rawUserMessage };
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

  private async resolveConversationArtifacts(args: {
    sessionId: string;
    executionContext: PromptRuntimeResolvedContext;
    history?: ChatMessage[];
    visibilityTrace?: PromptVisibilityTrace;
    historyLoad?: PreparedPromptArtifactsHistoryLoad;
    currentUserMessage?: string;
  }): Promise<PromptRuntimeConversationWindow> {
    if (args.history) {
      return buildLegacyConversationWindow({
        history: args.history,
        visibilityTrace: args.visibilityTrace,
        sourceSelection: args.executionContext.effectivePolicy?.sourceSelection,
        currentUserMessage: args.currentUserMessage,
      });
    }

    if (args.historyLoad) {
      return this.promptPreparationService.loadPromptRuntimeConversationWindow({
        sessionId: args.sessionId,
        branchId: args.historyLoad.branchId,
        beforeFloorNo: args.historyLoad.beforeFloorNo,
        visibility: args.executionContext.resolvedPolicy.visibility,
        sourceSelection: args.executionContext.effectivePolicy?.sourceSelection,
        ...(args.currentUserMessage !== undefined
          ? {
              currentInput: {
                content: args.currentUserMessage,
              },
            }
          : {}),
      });
    }

    return buildLegacyConversationWindow({
      history: [],
      visibilityTrace: args.visibilityTrace,
      sourceSelection: args.executionContext.effectivePolicy?.sourceSelection,
      currentUserMessage: args.currentUserMessage,
    });
  }

  private buildConversationInputSnapshot(args: {
    conversationState: PromptRuntimeConversationWindow;
    effectiveUserMessage: string;
    currentInputPageId?: string;
    currentInputMessageId?: string;
  }): FloorConversationInputSnapshot | undefined {
    const trailingTurn = args.conversationState.selectedTurns[args.conversationState.selectedTurns.length - 1];
    if (!trailingTurn || trailingTurn.role !== "user") {
      return undefined;
    }

    return buildFloorConversationInputSnapshot({
      effectiveText: args.effectiveUserMessage,
      sourceTurn: trailingTurn,
      currentInputPageId: args.currentInputPageId,
      currentInputMessageId: args.currentInputMessageId,
    });
  }
}

function buildLegacyConversationWindow(args: {
  history: ChatMessage[];
  visibilityTrace?: PromptVisibilityTrace;
  sourceSelection?: import("../prompt-assembler.js").PromptSourceSelectionPolicy;
  currentUserMessage?: string;
}): PromptRuntimeConversationWindow {
  const entries: PromptHistoryMessageEntry[] = args.history.map((message, index) => ({
    floorId: null,
    floorNo: null,
    pageId: null,
    pageNo: null,
    messageId: null,
    seq: index,
    role: message.role,
    content: message.content,
  }));

  if (args.currentUserMessage !== undefined) {
    entries.push({
      floorId: null,
      floorNo: null,
      pageId: null,
      pageNo: null,
      messageId: null,
      seq: entries.length,
      role: "user",
      content: args.currentUserMessage,
      fromCurrentInput: true,
    });
  }

  const maxSelectedTurns = resolveHistoryMaxTurns(args.sourceSelection);
  const window = buildConversationHistoryWindow({
    entries,
    ...(maxSelectedTurns !== undefined ? { maxSelectedTurns } : {}),
  });

  return {
    ...window,
    visibilityTrace: args.visibilityTrace ?? { filteredFloorNos: [] },
  };
}

function resolveHistoryMaxTurns(
  sourceSelection?: import("../prompt-assembler.js").PromptSourceSelectionPolicy,
): number | undefined {
  const mode = sourceSelection?.history?.mode;
  if (mode === "full") {
    return undefined;
  }

  const value = sourceSelection?.history?.maxMessages;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }

  return value;
}
