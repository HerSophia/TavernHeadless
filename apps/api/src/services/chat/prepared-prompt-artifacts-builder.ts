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
  PreparedPromptArtifactsPhaseTraceEntry,
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
import {
  PromptRuntimeContributorRunner,
} from "./prompt-runtime-contributor-runner.js";
import {
  buildPromptRuntimeContributorRenderablesForAssembly,
  resolvePreparedPromptArtifactsPromptMode,
} from "./prompt-runtime-contributors.js";

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
  runType: FloorRunType | "inspect" | "dry_run";
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
  private readonly contributorRunner = new PromptRuntimeContributorRunner();

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
    const preparePhaseTrace: PreparedPromptArtifactsPhaseTraceEntry[] = [];
    const sessionInfo = args.sessionInfo ?? this.modelService.buildSessionPromptInfo(
      args.session,
      args.resolvedTurnModels,
      args.firstPartyStateContext,
    );
    const promptMode = resolvePreparedPromptArtifactsPromptMode({
      mode: args.mode,
      session: args.session,
    });

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
    preparePhaseTrace.push({
      phase: "conversation_resolve",
      detail: {
        historyCount: conversationState.history.length,
        selectedTurnCount: conversationState.historyNormalization.selectedTurnCount,
        effectiveTurnCount: conversationState.historyNormalization.effectiveTurnCount,
      },
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
    const structuredMemoryInjection = memoryInjection?.injection;
    const memoryRuntimeTrace = {
      ...memoryWritePolicy,
      ...(memoryInjection?.memoryTrace ?? {}),
      ...(!memoryInjection ? { strategy: "none" as const } : {}),
    };
    const memoryTrace = buildPromptRuntimeMemoryTrace({
      summaryInjected: Boolean(effectiveMemorySummary),
      memoryTrace: memoryRuntimeTrace,
    });
    preparePhaseTrace.push({
      phase: "source_resolve",
      detail: {
        memorySummaryInjected: Boolean(effectiveMemorySummary),
        historyCount: conversationState.history.length,
      },
    });

    const contributors = this.contributorRunner.resolve({
      promptMode,
      memorySummary: effectiveMemorySummary,
      memoryTrace,
      firstPartyStateContext: args.firstPartyStateContext,
    }).contributors;
    preparePhaseTrace.push({
      phase: "pre_response",
      detail: {
        contributorCount: contributors.length,
        contributorKinds: contributors.map((contributor) => contributor.kind),
      },
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
        contributors: buildPromptRuntimeContributorRenderablesForAssembly(
          contributors,
          promptMode,
        ),
        sourceSelection: args.executionContext.effectivePolicy?.sourceSelection,
        memoryRuntimeTrace,
      },
    );
    preparePhaseTrace.push({
      phase: "assemble",
      detail: {
        messageCount: assembled.messages.length,
        tokenEstimate: assembled.tokenUsage.total,
      },
    });

    const materialized = this.promptPreparationService.materializeTurnPromptMessages(
      assembled.messages,
      assembled.sendDirectives,
      assistantPrefillStrategy,
      args.executionContext.effectivePolicy?.structure,
      args.executionContext.effectivePolicy?.delivery,
    );
    preparePhaseTrace.push({
      phase: "materialize",
      detail: {
        messageCount: materialized.messages.length,
      },
    });

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
    if (args.mode === "inspect") {
      preparePhaseTrace.push({
        phase: "inspect",
        detail: {
          diagnosticsCount: inspection.diagnostics.length,
        },
      });
    }

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
      promptMode,
      userMessage: effectiveUserMessage,
      rawUserMessage: args.rawUserMessage,
      executionContext: args.executionContext,
      conversation: conversationState,
      history: conversationState.history,
      visibilityTrace: conversationState.visibilityTrace,
      ...(structuredMemoryInjection ? { memoryInjection: structuredMemoryInjection } : {}),
      memorySummary: effectiveMemorySummary,
      memoryTrace,
      contributors,
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
      preparePhaseTrace,
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
