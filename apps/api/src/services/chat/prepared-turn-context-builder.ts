import type {
  TurnInput,
  FloorRunType,
  GenerationParams,
  GraphAssistantAgentLoopConfig,
  ToolCallTransportKind,
  TurnConfig,
  TurnRunObserver,
  PromptRunIntent,
} from "@tavern/core";

import type { PromptLiveDebugOptions, ResolvedTurnModels } from "./contracts.js";
import type { GenerationParamsInput } from "../../lib/llm-params.js";
import type { FirstPartyStateContext, PreparedTurnContext, PromptRuntimeContributorOutput } from "./types.js";
import type { PromptRuntimeConversationWindow } from "./prompt-preparation-service.js";
import { PreparedPromptArtifactsBuilder } from "./prepared-prompt-artifacts-builder.js";
import { TurnModelService } from "./turn-model-service.js";
import { TurnToolingService } from "./turn-tooling-service.js";
import { TurnMemoryService } from "./turn-memory-service.js";
import { TurnRunTracker } from "./turn-run-tracker.js";
import { buildPromptRuntimeGovernanceView } from "../prompt-runtime/governance-view-builder.js";
import type { ResolvedFloorGraphBinding } from "../project-floor-graph-binding-service.js";

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
      generationParams?: GenerationParamsInput;
      promptIntent?: PromptRunIntent;
      debugOptions?: PromptLiveDebugOptions;
      promptRuntimeInjections?: import("./contracts.js").RespondRequest["promptRuntimeInjections"];
    };
    executionContext: import("../prompt-runtime-execution.js").PromptRuntimeResolvedContext;
    conversationWindow?: PromptRuntimeConversationWindow;
    resolvedTurnModels: ResolvedTurnModels;
    firstPartyStateContext?: FirstPartyStateContext;
    abortSignal?: AbortSignal;
    onChunk?: (chunk: string) => void;
      onReasoning?: (delta: string) => void;
      onStepNarration?: (narration: { stepIndex: number; text: string; createdAt: number }) => void;
    stream?: boolean;
    agentContributors?: PromptRuntimeContributorOutput[];
    /**
     * 图助手临时对话强制的工具传输覆盖（text_protocol）。
     * 仅图助手路径传入；其他会话不传，保持默认解析。
     */
    toolTransportOverride?: ToolCallTransportKind;
    floorGraphBinding?: ResolvedFloorGraphBinding | null;
    /**
     * 图助手多轮 agent 循环配置（含确认决策回调），适用于 text_protocol 与 native_function_call 两条 transport。
     * 仅图助手路径传入；与 toolTransportOverride 成对出现。
     */
    graphAssistantAgentLoop?: GraphAssistantAgentLoopConfig;
    /** 本回合生成尝试号，透传给 TurnInput，避免多步循环用步号污染 attemptNo。 */
    runAttemptNo?: number;
    /**
     * step 重试：已完成的前缀工具往返（按 stepIndex 升序）。
     *
     * 仅 native_function_call 路径的 step 重试传入：透传给 TurnInput.priorRoundtrips，
     * 让 agent loop 在生成前重建前 N-1 步工具上下文，从第 N 步重启。
     */
    priorRoundtrips?: import("@tavern/core").AgentLoopPriorRoundtrip[];
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
      llmInstanceCapabilities: args.resolvedTurnModels.narrator?.capabilities,
      firstPartyStateContext: args.firstPartyStateContext,
      includeRuntimeTrace: args.request.debugOptions?.includeRuntimeTrace === true,
      baseRuntimeTrace: args.baseRuntimeTrace,
      stream: args.stream,
      floorGraphBinding: args.floorGraphBinding ?? null,
      ...(args.toolTransportOverride ? { toolTransportOverride: args.toolTransportOverride } : {}),
      ...(args.agentContributors ? { agentContributors: args.agentContributors } : {}),
    });
    const inspection = {
      ...artifacts.inspection,
      governance: buildPromptRuntimeGovernanceView({ assembled: artifacts.assembled }),
    };
    await this.turnRunTracker.trackFloorRunPhase(args.floorId, "prompt_assembled");

    const generationParams = artifacts.generationParams;
    const requestedTurnConfig = this.modelService.resolveRequestedTurnConfig(
      args.request.config,
      args.resolvedTurnModels,
    );
    const memoryConsolidationRequested = this.modelService.shouldRequestMemoryConsolidation(requestedTurnConfig);
    const turnConfig = this.modelService.toOrchestratorTurnConfig(requestedTurnConfig);
    const toolRuntime = artifacts.toolRegistry || artifacts.toolPermissions
      ? {
          toolRegistry: artifacts.toolRegistry,
          toolPermissions: artifacts.toolPermissions,
        }
      : await this.toolingService.resolveTurnToolingForTurn({
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
      ...(artifacts.toolTransport ? { toolTransport: artifacts.toolTransport } : {}),
      ...(args.graphAssistantAgentLoop ? { graphAssistantAgentLoop: args.graphAssistantAgentLoop }: {}),
      ...(args.runAttemptNo !== undefined ? { runAttemptNo: args.runAttemptNo } : {}),
      ...(args.priorRoundtrips && args.priorRoundtrips.length > 0
        ? { priorRoundtrips: args.priorRoundtrips }
        : {}),
      runObserver: this.buildTurnRunObserver(args.floorId, args.onReasoning, args.onStepNarration),
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
      ...(artifacts.memoryInjection ? { memoryInjection: artifacts.memoryInjection } : {}),
      memorySummary: artifacts.memorySummary,
      memoryTrace: artifacts.memoryTrace,
      injections: artifacts.injections,
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

  /**
   * 构造本回合的运行观察器。
   *
   * 默认由 turnRunTracker 生产（负责楼层运行快照）。当上层传入 onReasoning 时，
   * 额外叠加一层 onReasoningUpdate 转发，把推理增量下发给流式回调（不影响运行快照）。
   */
  private buildTurnRunObserver(
    floorId: string,
    onReasoning?: (delta: string) => void,
    onStepNarration?: (narration: { stepIndex: number; text: string; createdAt: number }) => void,
  ): TurnRunObserver {
    const baseObserver = this.turnRunTracker.createTurnRunObserver(floorId);
    if (!onReasoning && !onStepNarration) {
      return baseObserver;
    }

    return {
       ...baseObserver,
       ...(onReasoning
         ? {
            onReasoningUpdate: (input) => {
              onReasoning(input.delta);
            },
          }
        : {}),
...(onStepNarration
        ? {
            onStepNarration: (input) => {
              onStepNarration(input);
            },
          }
        : {}),
    };
  }
}
