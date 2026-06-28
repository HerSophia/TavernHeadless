import type {
  PromptRuntimeClientInjectionInput,
  PromptRuntimeInjectionBuilderInput,
} from "../prompt-runtime-injection-types.js";
import type { RegexExecutionChannel } from "@tavern/adapters-sillytavern";
import type {
  ChatMessage,
  FloorRunType,
  GenerationParams,
  PromptRunIntent,
  PromptRuntimeToolTransportTrace,
  ToolCallTransportKind,
  ToolDefinition,
  TurnConfig,
} from "@tavern/core";

import {
  assemblePrompt,
  type PromptRuntimeTrace,
  type SessionPromptInfo,
} from "../prompt-assembler.js";
import {
  readNativePromptBridgeWorkspaceDefault,
  resolveNativePromptBridgeDecision,
} from "../agent-runtime/native-prompt-bridge.js";
import {
  readCompatPromptBridgeWorkspaceDefault,
  resolveCompatPromptBridgeDecision,
} from "../agent-runtime/compat-prompt-bridge.js";
import {
  buildPromptRuntimeExecutionResult,
  type PromptRuntimeResolvedContext,
} from "../prompt-runtime-execution.js";
import type {
  PromptHistoryMessageEntry,
  PromptVisibilityTrace,
} from "../chat-history-loader.js";
import type { AppDb } from "../../db/client.js";
import type { LlmInstanceCapabilities } from "../../lib/llm-capabilities.js";
import type { GenerationParamsInput } from "../../lib/llm-params.js";
import type { PromptRuntimeDiagnostic } from "../prompt-runtime-control-service.js";
import { PromptRuntimeInjectionService } from "../prompt-runtime/injection-service.js";
import { buildPromptRuntimeMemoryTrace } from "../memory/shared/index.js";

import type { PromptLiveDebugOptions, ResolvedTurnModels } from "./contracts.js";
import type {
  FirstPartyStateContext,
  PreparedPromptArtifacts,
  PreparedPromptArtifactsMode,
  PreparedPromptArtifactsPhaseTraceEntry,
  PromptRuntimeContributorOutput,
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
import { TurnToolingService } from "./turn-tooling-service.js";
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
import { PromptRuntimeInjectionContributorBuilder } from "./prompt-runtime-injection-contributor-builder.js";
import {
  ToolCallTransportResolver,
  readToolCallTransportOverride,
} from "./tool-call-transport-resolver.js";

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
  generationParams?: GenerationParamsInput;
  promptIntent?: PromptRunIntent;
  debugOptions?: PromptLiveDebugOptions;
  promptRuntimeInjections?: PromptRuntimeClientInjectionInput[];
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
  stream?: boolean;
  toolTransportOverride?: ToolCallTransportKind;
  llmInstanceCapabilities?: LlmInstanceCapabilities;
  /**
   * R1 Agent Runtime aggregator 产出的额外 contributor。默认 undefined。
   * 仅在 inline_mvp 打开时由上层传入；compat_strict 不会渲染它们。
   */
  agentContributors?: PromptRuntimeContributorOutput[];
}

export interface PreparedPromptArtifactsBuilderOptions {
  enablePersistentInjections?: boolean;
  /**
   * I3 阶段5：是否把 inline Agent 产出的 contributor 改走 prompt runtime injection 通路。
   * 默认 false：保持原有 contributor 渲染路径，行为不变。
   * true：agentContributors 转为 agent_injection 走注入通路，获得 placement / 排序 / trace，
   * 且不再进入 contributor 渲染路径，避免两条管线重复注入。
   */
  routeAgentContributorsAsInjections?: boolean;
}

export class PreparedPromptArtifactsBuilder {
  private readonly contributorRunner = new PromptRuntimeContributorRunner();
  private readonly injectionContributorBuilder = new PromptRuntimeInjectionContributorBuilder();
  private readonly toolTransportResolver = new ToolCallTransportResolver();

  constructor(
    private readonly db: AppDb,
    private readonly tokenCounter: import("@tavern/core").TokenCounter,
    private readonly promptPreparationService: PromptPreparationService,
    private readonly modelService: TurnModelService,
    private readonly memoryService: TurnMemoryService,
    private readonly regexInputService: RegexInputService,
    private readonly firstPartyStateContextService: FirstPartyStateContextService,
    private readonly turnToolingService: TurnToolingService,
    private readonly options: PreparedPromptArtifactsBuilderOptions = {},
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
    const turnConfig = this.modelService.toOrchestratorTurnConfig(requestedTurnConfig);
    const toolRuntime = await this.turnToolingService.resolveTurnToolingForTurn({
      sessionId: args.sessionId,
      accountId: args.accountId,
      config: turnConfig,
    });
    const narratorTools: ToolDefinition[] = toolRuntime.toolRegistry && toolRuntime.toolPermissions
      ? await toolRuntime.toolRegistry.listForSlot("narrator", toolRuntime.toolPermissions)
      : [];
    const toolTransportSelection = this.toolTransportResolver.resolve({
      sessionId: args.sessionId,
      branchId: args.branchId,
      promptMode,
      explicitTransport: args.toolTransportOverride ?? readToolCallTransportOverride(args.session.metadataJson),
      toolsEnabled: turnConfig?.enableTools === true
        && toolRuntime.toolRegistry !== undefined
        && toolRuntime.toolPermissions?.enabled === true,
      capabilities: args.llmInstanceCapabilities,
    });
    const toolChoiceApplied = toolTransportSelection.transport === "native_function_call"
      && narratorTools.length > 0
      ? args.llmInstanceCapabilities?.supportsToolChoice === true
      : undefined;
    const streamingToolCallUnsupported = args.stream === true
      && toolTransportSelection.transport === "native_function_call"
      && narratorTools.length > 0
      && args.llmInstanceCapabilities?.supportsStreamingToolCall === false;
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

    const persistentInjectionInputs: PromptRuntimeInjectionBuilderInput[] = this.options.enablePersistentInjections === false
      ? []
      : new PromptRuntimeInjectionService(this.db).listPersistentInputsForPrompt(
          args.sessionId,
          args.branchId ?? "main",
          args.accountId,
        );
    const requestInjectionInputs: PromptRuntimeInjectionBuilderInput[] = (args.request.promptRuntimeInjections ?? []).map((injection) => ({
      ...injection,
      scope: injection.scope ?? "request",
    }));

    // I3 阶段5：开启 routeAgentContributorsAsInjections 后，agentContributors 改走 injection 通路，
    // 不再进入 contributor 渲染通路，避免两条管线重复注入。
    const renderAgentContributors =
      this.options.routeAgentContributorsAsInjections !== true && args.agentContributors !== undefined;
    const contributors = this.contributorRunner.resolve({
      promptMode,
      memorySummary: effectiveMemorySummary,
 memoryTrace,
      firstPartyStateContext: args.firstPartyStateContext,
      transport: toolTransportSelection.transport,
      toolsForSlot: narratorTools,
      tokenCounter: this.tokenCounter,
      ...(renderAgentContributors ? { agentContributors: args.agentContributors } : {}),
    }).contributors;
    const injectionBuild = this.injectionContributorBuilder.build({
      promptMode,
      tokenCounter: this.tokenCounter,
      injections: [
        ...persistentInjectionInputs,
        ...requestInjectionInputs,
        ...(this.options.routeAgentContributorsAsInjections === true
          ? mapAgentContributorsToInjectionInputs(args.agentContributors, promptMode)
          : []),
      ],
    });
    const contributorRenderables = [
      ...buildPromptRuntimeContributorRenderablesForAssembly(
        contributors,
        promptMode,
      ),
      ...injectionBuild.renderables,
    ];
    preparePhaseTrace.push({
      phase: "injection",
      detail: {
        requestedCount: requestInjectionInputs.length,
        persistentCount: persistentInjectionInputs.length,
        appliedCount: injectionBuild.appliedCount ?? injectionBuild.items.filter((item) => item.applied).length,
        notAppliedCount: injectionBuild.rejectedCount ?? injectionBuild.items.filter((item) => !item.applied).length,
        tokenCount: injectionBuild.tokenCount ?? 0,
        budgetGroup: injectionBuild.budgetGroup,
      },
    });
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
        contributors: contributorRenderables,
        injectionItems: injectionBuild.items,
        historyFloorNos: buildHistoryFloorNos(conversationState),
        sourceSelection: args.executionContext.effectivePolicy?.sourceSelection,
        memoryRuntimeTrace,
        // NG2-BRIDGE：native 主链承载灰度（Workspace 默认经 env）。缺省 composite + shadow off，零回归。
        nativePromptBridge: resolveNativePromptBridgeDecision({
          workspace: readNativePromptBridgeWorkspaceDefault(),
        }),
        // CG11：compat 主链承载灰度（Workspace 默认经 env）。缺省 prompt_mode + shadow off，零回归。
        compatPromptBridge: resolveCompatPromptBridgeDecision({
          workspace: readCompatPromptBridgeWorkspaceDefault(),
        }),
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

    const toolListContributor = contributors.find((contributor) => contributor.kind === "tool_list");
    const toolListTokenCount = readToolListContributorTokenCount(toolListContributor?.payload);
    const toolTransport: PromptRuntimeToolTransportTrace = {
      selection: toolTransportSelection,
      toolList: {
        injected: Boolean(toolListContributor),
        ...(toolListContributor ? { contributorId: toolListContributor.id } : {}),
        ...(toolListContributor
          ? { placementMode: promptMode === "compat_strict" ? "strict_fixed" as const : "contributor_chain" as const }
          : {}),
        toolCount: narratorTools.length,
        ...(toolListTokenCount !== undefined ? { tokenCount: toolListTokenCount } : {}),
        ...(toolListContributor ? { budgetGroup: "tool_list" } : {}),
      },
      ...(toolChoiceApplied !== undefined ? { toolChoiceApplied } : {}),
      ...(streamingToolCallUnsupported ? { streamingToolCallUnsupported: true } : {}),
    };

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
    const inspectionWithToolTransport = {
      ...inspection,
      toolTransport,
    };
    if (args.mode === "inspect") {
      preparePhaseTrace.push({
        phase: "inspect",
        detail: {
          diagnosticsCount: inspectionWithToolTransport.diagnostics.length,
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
        inspection: inspectionWithToolTransport,
        assembled,
        materialized,
        visibilityTrace: conversationState.visibilityTrace,
        ...(baseRuntimeTrace ? { baseRuntimeTrace } : {}),
        toolTransport,
      },
    });

    const generationParamsResult = this.modelService.buildGenerationParamsResult({
      requestParams: args.request.generationParams,
      narratorParams,
      narratorParamOrigins: this.modelService.getSlotGenerationParamOrigins(args.resolvedTurnModels, "narrator"),
      capabilities: args.llmInstanceCapabilities,
      availableForReply: execution.availableForReply ?? 0,
      stream: streamingToolCallUnsupported ? false : args.stream,
    });
    const runtimeTrace = execution.runtimeTrace
      ? {
          ...execution.runtimeTrace,
          generationParamsResolution: generationParamsResult.resolution,
        }
      : undefined;

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
      injections: inspectionWithToolTransport.injections
        ?? assembled.runtimeTraceSeed.injectionItems
        ?? injectionBuild.items,
      resolvedTurnModels: args.resolvedTurnModels,
      assembled,
      materialized,
      conversationInputSnapshot,
      historyNormalization: conversationState.historyNormalization,
      inspection: inspectionWithToolTransport,
      tokenEstimate: execution.tokenEstimate ?? 0,
      availableForReply: execution.availableForReply ?? 0,
      preprocessedUserMessage: execution.preprocessedUserMessage,
      promptSnapshot: execution.promptSnapshotPreview,
      promptSnapshotRecord: execution.promptSnapshotRecord,
      runtimeTrace,
      toolTransport,
      toolTransportSelection,
      toolRegistry: toolRuntime.toolRegistry,
      toolPermissions: toolRuntime.toolPermissions,
      generationParams: generationParamsResult.params,
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


/**
 * I3：构造与历史消息等长的楼层编号序列，供楼层相对位置 injection 解析。
 *
 * conversationState.history 与 selectedTurns 的历史部分一一对应（selectedTurns 去掉末尾 user turn
 * 即 historyTurns）。每个 turn 取 floorRange.end 作为代表楼层编号；turn 无楼层信息时为 null。
 */
/**
 * I3 阶段5：把 inline Agent 产出的 contributor 改写为 agent_injection 注入输入。
 *
 * - 仅取有 promptRenderable 的 contributor（title/content），空渲染跳过。
 * - 默认 placement 为 after_contributor_block（仅 native 可用），非 native 回退 after_history；
 *   mode 不开放时由 resolver 给出 placement_not_available_in_mode 跟踪，不静默吞掉。
 * - sourceChain.agentTypeId 记录 contributor.sourceKind 作为来源追踪，不伪造 runId。
 */
function mapAgentContributorsToInjectionInputs(
  agentContributors: PromptRuntimeContributorOutput[] | undefined,
  promptMode: string,
): PromptRuntimeInjectionBuilderInput[] {
  const contributors = agentContributors ?? [];
  if (contributors.length === 0) {
    return [];
  }
  const placement = promptMode === "native" ? "after_contributor_block" : "after_history";
  const inputs: PromptRuntimeInjectionBuilderInput[] = [];
  for (const contributor of contributors) {
    const renderable = contributor.promptRenderable;
    if (!renderable) {
      continue;
    }
    inputs.push({
      sourceKind: "agent_injection",
      title: renderable.title,
      content: renderable.content,
      placement,
      scope: "request",
      sourceChain: { agentTypeId: contributor.sourceKind },
    });
 }
  return inputs;
}

function readToolListContributorTokenCount(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const tokenCount = (payload as { tokenCount?: unknown }).tokenCount;
  return typeof tokenCount === "number" ? tokenCount : undefined;
}

function buildHistoryFloorNos(
  conversationState: PromptRuntimeConversationWindow,
): Array<number | null> {
  return conversationState.history.map((_message, index) => {
    const turn = conversationState.selectedTurns[index];
    return turn?.floorRange?.end ?? null;
  });
}
