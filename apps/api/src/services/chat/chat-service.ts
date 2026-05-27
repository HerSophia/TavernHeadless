import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CoreEventBus,
  CoreEventMap,
  ToolExecutionCommitOutcome,
  TurnExecutionResult,
  TurnInput,
  TurnOrchestrator,
} from "@tavern/core";
import {
  createEventBus,
  extractSummaries,
  FloorNotFoundError,
  FloorStateConflictError,
  FloorStateMachine,
  LLMTimeoutError,
  ToolReplayBlockedError,
  UnsupportedToolModeError,
} from "@tavern/core";

import type { AppDb } from "../../db/client.js";
import { resolveAccountIdOrThrow } from "../../accounts/account-context.js";
import { resolvePromptRuntimeExecutionContext, type PromptRuntimeExecutionResult } from "../prompt-runtime-execution.js";
import { executeWithRetry, isSqliteBusyError } from "../../lib/retry.js";
import { normalizeNonNegativeInt, normalizePositiveInt } from "../../lib/utils.js";
import { DrizzleFloorRepository } from "../../adapters/drizzle-floor-repository.js";
import { DrizzleToolExecutionRepository } from "../../adapters/drizzle-tool-execution-repository.js";
import { sessions, floors } from "../../db/schema.js";
import { ChatHistoryLoader } from "../chat-history-loader.js";
import { ChatMessagePersistence } from "../chat-message-persistence.js";
import {
  GenerationCoordinatorCancelledError,
  GenerationCoordinatorConflictError,
  GenerationCoordinatorQueueTimeoutError,
  InMemoryGenerationCoordinator,
  type CoordinatorRuntime,
  type GenerationCoordinator,
} from "../generation-guard-service.js";
import { TurnCommitService } from "../turn-commit-service.js";
import { OwnedSessionRepository } from "../owned-resource-repositories.js";
import {
  BranchLocalVariableSnapshotService,
  isBranchLocalSnapshotMissingError,
} from "../branch-local-variable-snapshot-service.js";
import {
  SessionBranchRegistryService,
  type SessionBranchAssetBindingState,
} from "../variables/host/session-branch-registry-service.js";

import type {
  ChatServiceOptions,
  EditAndRegenerateRequest,
  EditAndRegenerateResult,
  RegenerateRequest,
  RegenerateResult,
  RespondRequest,
  RespondResult,
  RespondRuntimeOptions,
  ResolvedTurnModels,
  RetryFloorRequest,
  RetryFloorResult,
  TurnExecutionPolicy,
  TurnExecutionPolicyOverrides,
} from "./contracts.js";
import { ChatServiceError } from "./errors.js";
import {
  PromptPreparationService,
  type PromptRuntimeConversationInput,
  type PromptRuntimeConversationWindow,
} from "./prompt-preparation-service.js";
import { ReplayGuardService, type ReplayBlockingExecutionDetail } from "./replay-guard-service.js";
import { ChatRuntimeEventBridge } from "./runtime-event-bridge.js";
import { ChatTargetResolver } from "./target-resolver.js";
import { TurnExecutionFacade } from "./turn-execution-facade.js";
import { NaiveTurnStrategy } from "./naive-turn-strategy.js";
import { ChatTurnWorkflowRunner } from "./turn-workflow-runner.js";
import { TurnModelService } from "./turn-model-service.js";
import { TurnToolingService } from "./turn-tooling-service.js";
import { TurnMemoryService } from "./turn-memory-service.js";
import { TurnSessionStateService } from "./turn-session-state-service.js";
import { TurnRunTracker } from "./turn-run-tracker.js";
import { FirstPartyStateContextService } from "./first-party-state-context-service.js";
import { RegexInputService } from "./regex-input-service.js";
import { DraftFloorService } from "./draft-floor-service.js";
import { PreparedPromptArtifactsBuilder } from "./prepared-prompt-artifacts-builder.js";
import { PreparedTurnContextBuilder } from "./prepared-turn-context-builder.js";
import { DryRunService } from "./dry-run-service.js";
import { PromptRuntimePreviewService } from "./prompt-runtime-preview-service.js";
import { PreparedTurnInspectionService } from "../prompt-runtime/prepared-turn-inspection-service.js";
import { findErrorByConstructor } from "./shared/error-utils.js";
import { normalizeBranchId } from "./shared/branch.js";
import { buildLivePromptRuntimeRequestPolicy } from "./shared/request-policy.js";
import {
  buildPromptRuntimeRegexTrace,
  buildRegexSubstitutionContext,
  executePromptRuntimeRegexPhase,
  listRuntimeRegexReservedPlacements,
  mergePromptRuntimeRegexTrace,
  PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE,
} from "../prompt-runtime/regex/index.js";
import type { FirstPartyStateContext } from "./types.js";

export * from "./contracts.js";
export { ChatServiceError } from "./errors.js";

const DEFAULT_TURN_EXECUTION_POLICY: TurnExecutionPolicy = {
  queueMode: "reject",
  queueTimeoutMs: 5_000,
  executionTimeoutMs: 60_000,
  commitRetry: { maxRetries: 2, baseDelayMs: 100 },
};

export class ChatService {
  private readonly historyLoader: ChatHistoryLoader;
  private readonly messagePersistence: ChatMessagePersistence;
  private readonly eventBus: CoreEventBus;
  private readonly floorStateMachine: FloorStateMachine;
  private readonly turnCommitService: TurnCommitService;
  private readonly toolExecutionRepository: DrizzleToolExecutionRepository;
  private readonly generationCoordinator: GenerationCoordinator;
  private readonly executionPolicy: TurnExecutionPolicy;
  private readonly accountContext: {
    accountMode?: ChatServiceOptions["accountMode"];
    defaultAccountId?: string;
  };
  private readonly memoryStoreEnabled: boolean;

  private readonly targetResolver: ChatTargetResolver;
  private readonly replayGuardService: ReplayGuardService;
  private readonly promptPreparationService: PromptPreparationService;
  private readonly runtimeEventBridge: ChatRuntimeEventBridge;
  private readonly turnExecutionFacade: TurnExecutionFacade;
  private readonly naiveTurnStrategy: NaiveTurnStrategy;
  private readonly turnWorkflowRunner: ChatTurnWorkflowRunner;
  private readonly modelService: TurnModelService;
  private readonly toolingService: TurnToolingService;
  private readonly memoryService: TurnMemoryService;
  private readonly turnSessionStateService: TurnSessionStateService;
  private readonly turnRunTracker: TurnRunTracker;
  private readonly firstPartyStateContextService: FirstPartyStateContextService;
  private readonly regexInputService: RegexInputService;
  private readonly draftFloorService: DraftFloorService;
  private readonly preparedPromptArtifactsBuilder: PreparedPromptArtifactsBuilder;
  private readonly preparedTurnContextBuilder: PreparedTurnContextBuilder;
  private readonly dryRunService: DryRunService;
  private readonly promptRuntimePreviewService: PromptRuntimePreviewService;
  private readonly preparedTurnInspectionService: PreparedTurnInspectionService;

  constructor(
    private readonly db: AppDb,
    private readonly orchestrator: TurnOrchestrator,
    private readonly tokenCounter: import("@tavern/core").TokenCounter,
    options: ChatServiceOptions = {},
  ) {
    this.executionPolicy = resolveTurnExecutionPolicy(options.executionPolicy);
    this.historyLoader = new ChatHistoryLoader(db, normalizePositiveInt(options.historyMaxFloors));
    this.messagePersistence = new ChatMessagePersistence(db, tokenCounter);
    this.eventBus = options.eventBus ?? createEventBus();
    this.floorStateMachine = new FloorStateMachine(new DrizzleFloorRepository(db), this.eventBus);
    this.toolExecutionRepository = new DrizzleToolExecutionRepository(db);
    this.turnCommitService = options.turnCommitService
      ?? new TurnCommitService(db, this.messagePersistence, this.eventBus, {
        enableAsyncMemoryIngest: options.enableAsyncMemoryIngest === true,
        accountMode: options.accountMode,
        defaultAccountId: options.defaultAccountId,
        sessionStateService: options.sessionStateService,
        projectEventLiveHub: options.projectEventLiveHub,
        toolRuntimeJobBridge: options.toolRuntimeJobBridge,
      });
    this.generationCoordinator = options.generationCoordinator
      ?? options.generationGuard
      ?? new InMemoryGenerationCoordinator();
    this.accountContext = {
      accountMode: options.accountMode,
      defaultAccountId: options.defaultAccountId,
    };
    this.memoryStoreEnabled = options.memoryStore !== undefined;

    const createError = (code: string, message: string, cause?: unknown, details?: unknown) => (
      new ChatServiceError(code, message, cause, details)
    );

    this.targetResolver = new ChatTargetResolver(db, this.historyLoader, createError);
    this.replayGuardService = new ReplayGuardService(
      this.toolExecutionRepository,
      createError,
      options.firstPartyGameStateService,
    );
    this.promptPreparationService = new PromptPreparationService(db, tokenCounter, this.historyLoader);
    this.runtimeEventBridge = new ChatRuntimeEventBridge(this.eventBus);
    this.turnRunTracker = new TurnRunTracker(db, this.floorStateMachine, options.floorRunService);
    this.modelService = new TurnModelService({
      resolveTurnModel: options.resolveTurnModel,
      resolveTurnModels: options.resolveTurnModels,
      onTurnModelUsed: options.onTurnModelUsed,
      defaultNarratorProviderType: options.defaultNarratorProviderType,
      enableMemoryConsolidationByDefault: options.enableMemoryConsolidationByDefault === true,
      enableAsyncMemoryIngest: options.enableAsyncMemoryIngest === true,
      memoryStoreEnabled: this.memoryStoreEnabled,
      executionTimeoutMs: this.executionPolicy.executionTimeoutMs,
    });
    this.toolingService = new TurnToolingService(db, createError, {
      toolRegistry: options.toolRegistry,
      sessionToolRegistryService: options.sessionToolRegistryService,
      resolveToolPermissions: options.resolveToolPermissions,
      resolveEffectiveToolPolicy: options.resolveEffectiveToolPolicy,
    });
    this.memoryService = new TurnMemoryService({
      memoryStore: options.memoryStore,
      memoryInjectionDecay: options.memoryInjectionDecay,
      enableDualSummaryInjection: options.enableDualSummaryInjection === true,
      emitBestEffortEvent: (name, payload) => this.emitBestEffortEvent(name, payload),
    });
    this.turnSessionStateService = new TurnSessionStateService(options.sessionStateService, createError);
    this.firstPartyStateContextService = new FirstPartyStateContextService(
      options.firstPartyGameStateService,
      createError,
    );
    this.regexInputService = new RegexInputService(db, this.messagePersistence);
    this.draftFloorService = new DraftFloorService(db, this.messagePersistence);
    this.preparedPromptArtifactsBuilder = new PreparedPromptArtifactsBuilder(
      db,
      tokenCounter,
      this.promptPreparationService,
      this.modelService,
      this.memoryService,
      this.regexInputService,
      this.firstPartyStateContextService,
    );
    this.preparedTurnContextBuilder = new PreparedTurnContextBuilder(
      this.preparedPromptArtifactsBuilder,
      this.modelService,
      this.toolingService,
      this.memoryService,
      this.turnRunTracker,
    );
    this.dryRunService = new DryRunService(
      db,
      tokenCounter,
      this.promptPreparationService,
      this.modelService,
      this.regexInputService,
      this.preparedPromptArtifactsBuilder,
    );
    this.promptRuntimePreviewService = new PromptRuntimePreviewService(
      db,
      this.targetResolver,
      this.promptPreparationService,
      this.modelService,
      this.memoryService,
    );
    this.preparedTurnInspectionService = new PreparedTurnInspectionService(
      db,
      this.targetResolver,
      this.modelService,
      this.turnSessionStateService,
      this.firstPartyStateContextService,
      this.preparedPromptArtifactsBuilder,
    );
    this.turnExecutionFacade = new TurnExecutionFacade((args) => this.performTurnExecutionAndCommit(args));
    this.naiveTurnStrategy = new NaiveTurnStrategy(this.turnExecutionFacade);
    this.turnWorkflowRunner = new ChatTurnWorkflowRunner(this.naiveTurnStrategy);
  }

  async respond(
    sessionId: string,
    request: RespondRequest,
    runtimeOptions: RespondRuntimeOptions = {},
    accountId?: string,
  ): Promise<RespondResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    await this.requireActiveSession(sessionId, resolvedAccountId, "Cannot respond to an archived session");
    this.turnSessionStateService.assertTurnSessionStateWritesAvailable(request.sessionStateWrites);

    const branchId = normalizeBranchId(request.branchId);

    return this.withGenerationCoordinator(
      sessionId,
      branchId,
      runtimeOptions.abortSignal,
      async (generationRuntime) => {
        const session = await this.requireActiveSession(sessionId, resolvedAccountId, "Cannot respond to an archived session");
        const resolvedTurnModels = await this.modelService.resolveTurnModelsForSession(sessionId, resolvedAccountId);
        this.modelService.assertNarratorSlotEnabled(resolvedTurnModels);

        const branchContext = await this.targetResolver.resolveRespondBranchContext(
          sessionId,
          branchId,
          request.sourceFloorId,
          resolvedAccountId,
        );
        const firstPartyStateContext = this.firstPartyStateContextService.loadFirstPartyStateContext({
          accountId: resolvedAccountId,
          sessionId,
          branchId,
          sourceFloorId: branchContext.inheritanceSource?.floorId ?? null,
          expectedSourceBranchId: branchContext.inheritanceSource?.branchId ?? null,
          resolutionMode: branchContext.inheritanceSource ? "source_floor" : "current_effective",
        });
        const executionContext = resolvePromptRuntimeExecutionContext({
          sessionId,
          metadataJson: session.metadataJson,
          branchId,
          branchExists: branchContext.branchExists,
          historySourceBranchId: branchContext.historySourceBranchId,
          historySourceMode: branchContext.historySourceMode,
          sourceFloorId: branchContext.inheritanceSource?.floorId ?? request.sourceFloorId ?? null,
          request: buildLivePromptRuntimeRequestPolicy(request),
        });

        const nextFloorNo = branchContext.nextFloorNo;
        const now = Date.now();
        const floorId = nanoid();
        const sessionInfo = this.buildSessionPromptInfo(
          session,
          resolvedTurnModels,
          firstPartyStateContext,
          branchContext.assetBinding,
        );

        let userMessageRef: import("../chat-message-persistence.js").PersistedMessageRef;
        try {
          ({ userMessageRef } = this.draftFloorService.createDraftFloorWithUserMessage({
            floorId,
            accountId: resolvedAccountId,
            sessionId,
            floorNo: nextFloorNo,
            branchId,
            parentFloorId: branchContext.parentFloorId,
            userMessage: request.message,
            userId: session.userId,
            userSnapshotJson: session.userSnapshotJson,
            now,
            sourceFloorId: branchContext.inheritanceSource?.floorId,
            sourceBranchId: branchContext.inheritanceSource?.branchId,
            afterCreate: branchContext.inheritanceSource
              ? (tx) => {
                  new BranchLocalVariableSnapshotService(tx).materializeFromSourceFloor({
                    accountId: resolvedAccountId,
                    sessionId,
                    sourceFloorId: branchContext.inheritanceSource!.floorId,
                    sourceBranchId: branchContext.inheritanceSource!.branchId,
                    targetBranchId: branchId,
                    createdAt: now,
                  });
                }
              : undefined,
          }));
        } catch (error) {
          this.rethrowBranchLocalSnapshotError(error);
        }

        await this.turnRunTracker.initializeFloorRun(sessionId, floorId, "respond", now);
        let persistedUserMessage: Awaited<ReturnType<RegexInputService["applyPersistedUserInputRegex"]>>;
        try {
          persistedUserMessage = await this.regexInputService.applyPersistedUserInputRegex({
            accountId: resolvedAccountId,
            sessionId,
            branchId,
            floorId,
            pageId: userMessageRef.pageId,
            session,
            sessionInfo,
            rawUserMessage: request.message,
            regexChannel: "persist",
            persistedMessageId: userMessageRef.messageId,
          });
        } catch (error) {
          await this.turnRunTracker.failRunAndFloorBestEffort(floorId, error, "respond_input_regex_failed");
          throw error;
        }

        let conversationWindow: PromptRuntimeConversationWindow;
        try {
          conversationWindow = await this.loadLiveConversationWindow({
            sessionId,
            branchId: branchContext.historySourceBranchId,
            beforeFloorNo: branchContext.nextFloorNo,
            visibility: executionContext.resolvedPolicy.visibility,
            sourceSelection: executionContext.effectivePolicy?.sourceSelection,
            currentInput: {
              content: persistedUserMessage.text,
              floorId,
              floorNo: nextFloorNo,
              pageId: userMessageRef.pageId,
              pageNo: 0,
              messageId: userMessageRef.messageId,
              seq: 0,
            },
          });
        } catch (error) {
          await this.turnRunTracker.failRunAndFloorBestEffort(floorId, error, "respond_conversation_shape_failed");
          throw error;
        }

        runtimeOptions.onStart?.({ floorId, floorNo: nextFloorNo, branchId });
        const unsubscribeRuntimeToolEvents = this.runtimeEventBridge.subscribeRuntimeToolEvents(floorId, runtimeOptions);
        const unsubscribeFloorRunEvents = this.runtimeEventBridge.subscribeFloorRunEvents(floorId, runtimeOptions);

        try {
          const { prepared, execution, commit } = await this.runPreparedFloorGeneration({
            mode: "respond",
            runType: "respond",
            sessionId,
            branchId,
            floorId,
            pageId: userMessageRef.pageId,
            pageMessageId: userMessageRef.messageId,
            accountId: resolvedAccountId,
            session,
            sessionInfo,
            userMessage: conversationWindow.effectiveUserMessage!,
            rawUserMessage: request.message,
            baseRuntimeTrace: persistedUserMessage.runtimeTrace ? { regex: persistedUserMessage.runtimeTrace } : undefined,
            request,
            executionContext,
            conversationWindow,
            resolvedTurnModels,
            firstPartyStateContext,
            abortSignal: runtimeOptions.abortSignal ?? generationRuntime.abortSignal,
            onChunk: runtimeOptions.onChunk,
            stream: !!runtimeOptions.onChunk,
            orchestrationFailureCode: "orchestration_failed",
            orchestrationFailureMessage: "Turn orchestration failed",
            commitFailureMessage: "Turn commit failed",
          });

          return {
            floorId,
            floorNo: nextFloorNo,
            generatedText: execution.generatedText,
            summaries: execution.summaries,
            totalUsage: commit.usage,
            finalState: commit.finalState,
            branchId,
            memory: commit.memory,
            promptSnapshot: prepared.promptDebug.promptSnapshot,
            runtimeTrace: prepared.promptDebug.runtimeTrace,
          };
        } catch (error) {
          await this.turnRunTracker.failRunAndFloorBestEffort(floorId, error, "respond_failed");
          throw error;
        } finally {
          unsubscribeRuntimeToolEvents();
          unsubscribeFloorRunEvents();
        }
      },
    );
  }

  async dryRun(
    sessionId: string,
    request: import("./contracts.js").DryRunRequest,
    accountId?: string,
  ): Promise<import("./contracts.js").DryRunResult> {
    return this.dryRunService.run(sessionId, request, this.resolveAccountId(accountId));
  }

  async previewPromptRuntimeText(
    sessionId: string,
    request: import("./contracts.js").PromptRuntimePreviewRequest,
    accountId?: string,
  ): Promise<import("./contracts.js").PromptRuntimePreviewResult> {
    return this.promptRuntimePreviewService.run(sessionId, request, this.resolveAccountId(accountId));
  }

  async inspectPromptRuntime(
    sessionId: string,
    request: import("../prompt-runtime/types.js").PromptRuntimeInspectRequest,
    accountId?: string,
  ): Promise<import("../prompt-runtime/types.js").PromptRuntimeInspectResult> {
    return this.preparedTurnInspectionService.inspect(sessionId, request, this.resolveAccountId(accountId));
  }

  async regenerate(
    sessionId: string,
    request: RegenerateRequest = {},
    accountId?: string,
  ): Promise<RegenerateResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    await this.requireActiveSession(sessionId, resolvedAccountId, "Cannot regenerate in an archived session");
    this.turnSessionStateService.assertTurnSessionStateWritesAvailable(request.sessionStateWrites);
    const initialTargetFloor = await this.targetResolver.requireRegenerationTarget(sessionId);

    return this.withGenerationCoordinator(sessionId, "main", undefined, async (generationRuntime: CoordinatorRuntime) => {
      const session = await this.requireActiveSession(sessionId, resolvedAccountId, "Cannot regenerate in an archived session");
      const targetFloor = await this.targetResolver.revalidateRegenerationTarget(sessionId, initialTargetFloor.id);
      await this.replayGuardService.assertReplayConfirmedForFloor({
        floorId: targetFloor.id,
        sessionId,
        accountId: resolvedAccountId,
        confirmedExecutionIds: request.confirmedExecutionIds,
        confirmedSessionStateMutationIds: request.confirmedSessionStateMutationIds,
        actionLabel: "Regeneration",
      });

      const executionContext = resolvePromptRuntimeExecutionContext({
        sessionId,
        metadataJson: session.metadataJson,
        branchId: targetFloor.branchId,
        branchExists: true,
        historySourceBranchId: targetFloor.branchId,
        historySourceMode: "existing_branch",
        request: buildLivePromptRuntimeRequestPolicy(request),
      });
      const firstPartyStateContext = this.firstPartyStateContextService.loadFirstPartyStateContext({
        accountId: resolvedAccountId,
        sessionId,
        branchId: targetFloor.branchId,
        sourceFloorId: targetFloor.parentFloorId,
        expectedSourceBranchId: targetFloor.branchId,
        resolutionMode: "source_floor",
      });

      const replayInput = await this.draftFloorService.getEffectiveConversationInputFromFloor(targetFloor.id);
      if (!replayInput) {
        throw new ChatServiceError("no_user_message", `No user message found in floor '${targetFloor.id}'`);
      }
      const conversationWindow = await this.loadLiveConversationWindow({
        sessionId,
        branchId: targetFloor.branchId,
        beforeFloorNo: targetFloor.floorNo,
        visibility: executionContext.resolvedPolicy.visibility,
        sourceSelection: executionContext.effectivePolicy?.sourceSelection,
        currentInput: replayInput.currentInput,
        effectiveUserMessageOverride: replayInput.snapshot.effectiveText,
      });
      const resolvedTurnModels = await this.modelService.resolveTurnModelsForSession(sessionId, resolvedAccountId);
      this.modelService.assertNarratorSlotEnabled(resolvedTurnModels);
      const sessionInfo = this.buildSessionPromptInfo(
        session,
        resolvedTurnModels,
        firstPartyStateContext,
        this.getSessionBranchAssetBinding(resolvedAccountId, sessionId, targetFloor.branchId),
      );

      const newFloorId = nanoid();
      const now = Date.now();
      const prepareSupersedeSourceFloor = (tx: Parameters<Exclude<Parameters<DraftFloorService["createDraftFloorWithUserMessage"]>[0]["prepare"], undefined>>[0]) => {
        tx
          .update(floors)
          .set({
            supersededAt: now,
            // 这里只需要先把源楼层移出 live 唯一索引窗口，
            // 让同 floor_no / branch_id 的新 draft floor 能落库。
            //
            // 一些历史数据库文件给 `floor.superseded_by_floor_id`
            // 保留了自引用外键；如果这里提前写入尚未插入的新 floor id，
            // 会直接触发 SQLITE_CONSTRAINT_FOREIGNKEY。
            //
            // 因此占位阶段只写 `superseded_at`，真正的 replacement floor id
            // 留到 commit 时再补齐。
            supersededByFloorId: null,
            updatedAt: now,
          })
          .where(eq(floors.id, targetFloor.id))
          .run();
      };
      const userMessageRef = replayInput.currentInput
        ? this.draftFloorService.createDraftFloorWithUserMessage({
            floorId: newFloorId,
            accountId: resolvedAccountId,
            sessionId,
            floorNo: targetFloor.floorNo,
            branchId: targetFloor.branchId,
            parentFloorId: targetFloor.id,
            userMessage: replayInput.currentInput.content,
            userId: session.userId,
            userSnapshotJson: session.userSnapshotJson,
            now,
            prepare: prepareSupersedeSourceFloor,
          }).userMessageRef
        : (this.draftFloorService.createDraftResponseFloor({
            floorId: newFloorId,
            accountId: resolvedAccountId,
            sessionId,
            floorNo: targetFloor.floorNo,
            branchId: targetFloor.branchId,
            parentFloorId: targetFloor.id,
            userId: session.userId,
            userSnapshotJson: session.userSnapshotJson,
            now,
            prepare: prepareSupersedeSourceFloor,
          }), undefined);

      await this.turnRunTracker.initializeFloorRun(sessionId, newFloorId, "regenerate_page", now);
      try {
        const { prepared, execution, commit } = await this.runPreparedFloorGeneration({
          mode: "regenerate",
          runType: "regenerate_page",
          sessionId,
          branchId: targetFloor.branchId,
          floorId: newFloorId,
          pageId: userMessageRef?.pageId,
          pageMessageId: userMessageRef?.messageId,
          accountId: resolvedAccountId,
          session,
          sessionInfo,
          userMessage: conversationWindow.effectiveUserMessage!,
          request: { ...request, promptIntent: "regenerate" },
          executionContext,
          conversationWindow,
          resolvedTurnModels,
          firstPartyStateContext,
          abortSignal: generationRuntime.abortSignal,
          stream: false,
          orchestrationFailureCode: "orchestration_failed",
          orchestrationFailureMessage: "Regeneration orchestration failed",
          commitFailureMessage: "Regeneration commit failed",
          supersedeSourceFloor: { floorId: targetFloor.id },
        });

        return {
          floorId: newFloorId,
          floorNo: targetFloor.floorNo,
          previousFloorId: targetFloor.id,
          generatedText: execution.generatedText,
          summaries: execution.summaries,
          totalUsage: commit.usage,
          finalState: commit.finalState,
          memory: commit.memory,
          promptSnapshot: prepared.promptDebug.promptSnapshot,
          runtimeTrace: prepared.promptDebug.runtimeTrace,
        };
      } catch (error) {
        await this.turnRunTracker.failRunAndFloorBestEffort(newFloorId, error, "regenerate_failed", {
          restoreSupersededSourceFloor: targetFloor.id,
        });
        throw error;
      }
    });
  }

  async retryFloor(
    floorId: string,
    request: RetryFloorRequest = {},
    accountId?: string,
  ): Promise<RetryFloorResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    const initialTargetFloor = this.targetResolver.requireRetryTargetFloor(floorId, resolvedAccountId);
    this.turnSessionStateService.assertTurnSessionStateWritesAvailable(request.sessionStateWrites);
    await this.requireActiveSession(initialTargetFloor.sessionId, resolvedAccountId, "Cannot retry in an archived session");

    return this.withGenerationCoordinator(
      initialTargetFloor.sessionId,
      initialTargetFloor.branchId,
      undefined,
      async (generationRuntime) => {
        const targetFloor = await this.targetResolver.revalidateRetryTargetFloor(floorId, resolvedAccountId, initialTargetFloor);
        const session = await this.requireActiveSession(targetFloor.sessionId, resolvedAccountId, "Cannot retry in an archived session");
        await this.replayGuardService.assertRetryReplayConfirmed({
          floorId: targetFloor.id,
          sessionId: targetFloor.sessionId,
          accountId: resolvedAccountId,
          request,
        });

        const executionContext = resolvePromptRuntimeExecutionContext({
          sessionId: targetFloor.sessionId,
          metadataJson: session.metadataJson,
          branchId: targetFloor.branchId,
          branchExists: true,
          historySourceBranchId: targetFloor.branchId,
          historySourceMode: "existing_branch",
          request: buildLivePromptRuntimeRequestPolicy(request),
        });
        const firstPartyStateContext = this.firstPartyStateContextService.loadFirstPartyStateContext({
          accountId: resolvedAccountId,
          sessionId: targetFloor.sessionId,
          branchId: targetFloor.branchId,
          sourceFloorId: targetFloor.parentFloorId,
          expectedSourceBranchId: targetFloor.branchId,
          resolutionMode: "source_floor",
        });

        const replayInput = await this.draftFloorService.getEffectiveConversationInputFromFloor(targetFloor.id);
        if (!replayInput) {
          throw new ChatServiceError("no_user_message", `No user message found in floor '${floorId}'`);
        }
        const conversationWindow = await this.loadLiveConversationWindow({
          sessionId: targetFloor.sessionId,
          branchId: targetFloor.branchId,
          beforeFloorNo: targetFloor.floorNo,
          visibility: executionContext.resolvedPolicy.visibility,
          sourceSelection: executionContext.effectivePolicy?.sourceSelection,
          currentInput: replayInput.currentInput,
          effectiveUserMessageOverride: replayInput.snapshot.effectiveText,
        });
        const resolvedTurnModels = await this.modelService.resolveTurnModelsForSession(targetFloor.sessionId, resolvedAccountId);
        this.modelService.assertNarratorSlotEnabled(resolvedTurnModels);
        const sessionInfo = this.buildSessionPromptInfo(
          session,
          resolvedTurnModels,
          firstPartyStateContext,
          this.getSessionBranchAssetBinding(resolvedAccountId, targetFloor.sessionId, targetFloor.branchId),
        );

        const now = Date.now();
        this.db.transaction((tx) => {
          this.messagePersistence.clearOutputForRetry(tx, targetFloor.id);
          tx
            .update(floors)
            .set({ state: "draft", tokenIn: 0, tokenOut: 0, updatedAt: now })
            .where(eq(floors.id, targetFloor.id))
            .run();
        });

        await this.turnRunTracker.initializeFloorRun(targetFloor.sessionId, targetFloor.id, "retry_turn", now);
        try {
          const { prepared, execution, commit } = await this.runPreparedFloorGeneration({
            mode: "retry_floor",
            runType: "retry_turn",
            sessionId: targetFloor.sessionId,
            branchId: targetFloor.branchId,
            floorId: targetFloor.id,
            pageId: replayInput.currentInput?.pageId,
            pageMessageId: replayInput.currentInput?.messageId,
            accountId: resolvedAccountId,
            session,
            sessionInfo,
            userMessage: conversationWindow.effectiveUserMessage!,
            request,
            executionContext,
            conversationWindow,
            resolvedTurnModels,
            firstPartyStateContext,
            abortSignal: generationRuntime.abortSignal,
            stream: false,
            orchestrationFailureCode: "orchestration_failed",
            orchestrationFailureMessage: "Retry orchestration failed",
            commitFailureMessage: "Retry commit failed",
          });

          return {
            floorId: targetFloor.id,
            floorNo: targetFloor.floorNo,
            branchId: targetFloor.branchId,
            generatedText: execution.generatedText,
            summaries: execution.summaries,
            totalUsage: commit.usage,
            memory: commit.memory,
            finalState: commit.finalState,
            promptSnapshot: prepared.promptDebug.promptSnapshot,
            runtimeTrace: prepared.promptDebug.runtimeTrace,
          };
        } catch (error) {
          await this.turnRunTracker.failRunAndFloorBestEffort(targetFloor.id, error, "retry_turn_failed");
          throw error;
        }
      },
    );
  }

  async editAndRegenerate(
    messageId: string,
    request: EditAndRegenerateRequest,
    accountId?: string,
  ): Promise<EditAndRegenerateResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    const initialSource = this.targetResolver.resolveEditableMessage(messageId, resolvedAccountId);
    this.turnSessionStateService.assertTurnSessionStateWritesAvailable(request.sessionStateWrites);
    await this.requireActiveSession(initialSource.sessionId, resolvedAccountId, "Cannot edit message in an archived session");

    const newBranchId = request.branchId ? normalizeBranchId(request.branchId) : `branch-${nanoid(8)}`;

    return this.withGenerationCoordinator(initialSource.sessionId, newBranchId, undefined, async (generationRuntime: CoordinatorRuntime) => {
      const source = this.targetResolver.revalidateEditableMessageTarget(messageId, resolvedAccountId, initialSource);
      const session = await this.requireActiveSession(source.sessionId, resolvedAccountId, "Cannot edit message in an archived session");
      const [branchExists] = await this.db
        .select({ id: floors.id })
        .from(floors)
        .where(and(eq(floors.sessionId, source.sessionId), eq(floors.branchId, newBranchId)))
        .limit(1);

      if (branchExists) {
        throw new ChatServiceError(
          "branch_exists",
          `Branch '${newBranchId}' already exists in session '${source.sessionId}'`,
        );
      }

      await this.replayGuardService.assertReplayConfirmedForFloor({
        floorId: source.floorId,
        sessionId: source.sessionId,
        accountId: resolvedAccountId,
        confirmedExecutionIds: request.confirmedExecutionIds,
        confirmedSessionStateMutationIds: request.confirmedSessionStateMutationIds,
        actionLabel: "Edit-and-regenerate",
      });

      const executionContext = resolvePromptRuntimeExecutionContext({
        sessionId: source.sessionId,
        metadataJson: session.metadataJson,
        branchId: newBranchId,
        branchExists: false,
        historySourceBranchId: source.branchId,
        historySourceMode: "source_floor_branch",
        sourceFloorId: source.floorId,
        request: buildLivePromptRuntimeRequestPolicy(request),
      });
      const firstPartyStateContext = this.firstPartyStateContextService.loadFirstPartyStateContext({
        accountId: resolvedAccountId,
        sessionId: source.sessionId,
        branchId: newBranchId,
        sourceFloorId: source.floorId,
        expectedSourceBranchId: source.branchId,
        resolutionMode: "source_floor",
      });

      const now = Date.now();
      const newFloorId = nanoid();
      const resolvedTurnModels = await this.modelService.resolveTurnModelsForSession(source.sessionId, resolvedAccountId);
      this.modelService.assertNarratorSlotEnabled(resolvedTurnModels);
      const sessionInfo = this.buildSessionPromptInfo(session, resolvedTurnModels, firstPartyStateContext);

      let userMessageRef: import("../chat-message-persistence.js").PersistedMessageRef;
      try {
        ({ userMessageRef } = this.draftFloorService.createDraftFloorWithUserMessage({
          floorId: newFloorId,
          accountId: resolvedAccountId,
          sessionId: source.sessionId,
          floorNo: source.floorNo + 1,
          branchId: newBranchId,
          parentFloorId: source.floorId,
          userMessage: request.content,
          userId: session.userId,
          userSnapshotJson: session.userSnapshotJson,
          now,
          sourceFloorId: source.floorId,
          sourceBranchId: source.branchId,
          afterCreate: (tx) => {
            new BranchLocalVariableSnapshotService(tx).materializeFromSourceFloor({
              accountId: resolvedAccountId,
              sessionId: source.sessionId,
              sourceFloorId: source.floorId,
              sourceBranchId: source.branchId,
              targetBranchId: newBranchId,
              createdAt: now,
            });
          },
        }));
      } catch (error) {
        this.rethrowBranchLocalSnapshotError(error);
      }

      const persistedUserMessage = await this.regexInputService.applyPersistedUserInputRegex({
        accountId: resolvedAccountId,
        sessionId: source.sessionId,
        branchId: newBranchId,
        floorId: newFloorId,
        pageId: userMessageRef.pageId,
        session,
        sessionInfo,
        rawUserMessage: request.content,
        persistedMessageId: userMessageRef.messageId,
        regexChannel: "edit",
      });

      let conversationWindow: PromptRuntimeConversationWindow;
      try {
        conversationWindow = await this.loadLiveConversationWindow({
          sessionId: source.sessionId,
          branchId: source.branchId,
          beforeFloorNo: source.floorNo,
          visibility: executionContext.resolvedPolicy.visibility,
          sourceSelection: executionContext.effectivePolicy?.sourceSelection,
          currentInput: {
            content: persistedUserMessage.text,
            floorId: newFloorId,
            floorNo: source.floorNo + 1,
            pageId: userMessageRef.pageId,
            pageNo: 0,
            messageId: userMessageRef.messageId,
            seq: 0,
          },
        });
      } catch (error) {
        await this.turnRunTracker.failRunAndFloorBestEffort(newFloorId, error, "edit_and_regenerate_conversation_shape_failed");
        throw error;
      }

      await this.turnRunTracker.initializeFloorRun(source.sessionId, newFloorId, "edit_and_regenerate", now);
      try {
        const { prepared, execution, commit } = await this.runPreparedFloorGeneration({
          mode: "edit_and_regenerate",
          runType: "edit_and_regenerate",
          sessionId: source.sessionId,
          branchId: newBranchId,
          floorId: newFloorId,
          pageId: userMessageRef.pageId,
          pageMessageId: userMessageRef.messageId,
          accountId: resolvedAccountId,
          session,
          sessionInfo,
          userMessage: conversationWindow.effectiveUserMessage!,
          rawUserMessage: request.content,
          baseRuntimeTrace: persistedUserMessage.runtimeTrace ? { regex: persistedUserMessage.runtimeTrace } : undefined,
          request,
          executionContext,
          conversationWindow,
          resolvedTurnModels,
          firstPartyStateContext,
          abortSignal: generationRuntime.abortSignal,
          stream: false,
          orchestrationFailureCode: "orchestration_failed",
          orchestrationFailureMessage: "Turn orchestration failed",
          commitFailureMessage: "Turn commit failed",
        });

        return {
          floorId: newFloorId,
          floorNo: source.floorNo + 1,
          branchId: newBranchId,
          generatedText: execution.generatedText,
          summaries: execution.summaries,
          totalUsage: commit.usage,
          memory: commit.memory,
          finalState: commit.finalState,
          promptSnapshot: prepared.promptDebug.promptSnapshot,
          runtimeTrace: prepared.promptDebug.runtimeTrace,
          sourceFloorId: source.floorId,
          sourceMessageId: source.messageId,
        };
      } catch (error) {
        await this.turnRunTracker.failRunAndFloorBestEffort(newFloorId, error, "edit_and_regenerate_failed");
        throw error;
      }
    });
  }

  private async respondFromConversationTail(args: {
    sessionId: string;
    request: {
      branchId?: string;
      sourceFloorId?: string;
      config?: import("@tavern/core").TurnConfig;
      generationParams?: Partial<import("@tavern/core").GenerationParams>;
      promptIntent?: import("@tavern/core").PromptRunIntent;
      debugOptions?: import("./contracts.js").PromptLiveDebugOptions;
      sessionStateWrites?: import("./contracts.js").TurnSessionStateWriteRequest[];
      structure?: RespondRequest["structure"];
      delivery?: RespondRequest["delivery"];
    };
    runtimeOptions?: RespondRuntimeOptions;
    accountId: string;
  }): Promise<RespondResult> {
    this.turnSessionStateService.assertTurnSessionStateWritesAvailable(args.request.sessionStateWrites);
    const branchId = normalizeBranchId(args.request.branchId);

    return this.withGenerationCoordinator(
      args.sessionId,
      branchId,
      args.runtimeOptions?.abortSignal,
      async (generationRuntime) => {
        const session = await this.requireActiveSession(args.sessionId, args.accountId, "Cannot respond to an archived session");
        const resolvedTurnModels = await this.modelService.resolveTurnModelsForSession(args.sessionId, args.accountId);
        this.modelService.assertNarratorSlotEnabled(resolvedTurnModels);

        const branchContext = await this.targetResolver.resolveRespondBranchContext(
          args.sessionId,
          branchId,
          args.request.sourceFloorId,
          args.accountId,
        );
        const firstPartyStateContext = this.firstPartyStateContextService.loadFirstPartyStateContext({
          accountId: args.accountId,
          sessionId: args.sessionId,
          branchId,
          sourceFloorId: branchContext.inheritanceSource?.floorId ?? null,
          expectedSourceBranchId: branchContext.inheritanceSource?.branchId ?? null,
          resolutionMode: branchContext.inheritanceSource ? "source_floor" : "current_effective",
        });
        const executionContext = resolvePromptRuntimeExecutionContext({
          sessionId: args.sessionId,
          metadataJson: session.metadataJson,
          branchId,
          branchExists: branchContext.branchExists,
          historySourceBranchId: branchContext.historySourceBranchId,
          historySourceMode: branchContext.historySourceMode,
          sourceFloorId: branchContext.inheritanceSource?.floorId ?? args.request.sourceFloorId ?? null,
          request: buildLivePromptRuntimeRequestPolicy(args.request),
        });
        const conversationWindow = await this.loadLiveConversationWindow({
          sessionId: args.sessionId,
          branchId: branchContext.historySourceBranchId,
          beforeFloorNo: branchContext.nextFloorNo,
          visibility: executionContext.resolvedPolicy.visibility,
          sourceSelection: executionContext.effectivePolicy?.sourceSelection,
        });

        const nextFloorNo = branchContext.nextFloorNo;
        const now = Date.now();
        const floorId = nanoid();
        const sessionInfo = this.buildSessionPromptInfo(
          session,
          resolvedTurnModels,
          firstPartyStateContext,
          branchContext.assetBinding,
        );

        try {
          this.draftFloorService.createDraftResponseFloor({
            floorId,
            accountId: args.accountId,
            sessionId: args.sessionId,
            floorNo: nextFloorNo,
            branchId,
            parentFloorId: branchContext.parentFloorId,
            userId: session.userId,
            userSnapshotJson: session.userSnapshotJson,
            now,
            sourceFloorId: branchContext.inheritanceSource?.floorId,
            sourceBranchId: branchContext.inheritanceSource?.branchId,
            afterCreate: branchContext.inheritanceSource
              ? (tx) => {
                  new BranchLocalVariableSnapshotService(tx).materializeFromSourceFloor({
                    accountId: args.accountId,
                    sessionId: args.sessionId,
                    sourceFloorId: branchContext.inheritanceSource!.floorId,
                    sourceBranchId: branchContext.inheritanceSource!.branchId,
                    targetBranchId: branchId,
                    createdAt: now,
                  });
                }
              : undefined,
          });
        } catch (error) {
          this.rethrowBranchLocalSnapshotError(error);
        }

        await this.turnRunTracker.initializeFloorRun(args.sessionId, floorId, "respond", now);

        args.runtimeOptions?.onStart?.({ floorId, floorNo: nextFloorNo, branchId });
        const unsubscribeRuntimeToolEvents = this.runtimeEventBridge.subscribeRuntimeToolEvents(floorId, args.runtimeOptions ?? {});
        const unsubscribeFloorRunEvents = this.runtimeEventBridge.subscribeFloorRunEvents(floorId, args.runtimeOptions ?? {});

        try {
          const { prepared, execution, commit } = await this.runPreparedFloorGeneration({
            mode: "respond",
            runType: "respond",
            sessionId: args.sessionId,
            branchId,
            floorId,
            accountId: args.accountId,
            session,
            sessionInfo,
            userMessage: conversationWindow.effectiveUserMessage!,
            request: args.request,
            executionContext,
            conversationWindow,
            resolvedTurnModels,
            firstPartyStateContext,
            abortSignal: args.runtimeOptions?.abortSignal ?? generationRuntime.abortSignal,
            onChunk: args.runtimeOptions?.onChunk,
            stream: !!args.runtimeOptions?.onChunk,
            orchestrationFailureCode: "orchestration_failed",
            orchestrationFailureMessage: "Turn orchestration failed",
            commitFailureMessage: "Turn commit failed",
          });

          return {
            floorId,
            floorNo: nextFloorNo,
            generatedText: execution.generatedText,
            summaries: execution.summaries,
            totalUsage: commit.usage,
            finalState: commit.finalState,
            branchId,
            memory: commit.memory,
            promptSnapshot: prepared.promptDebug.promptSnapshot,
            runtimeTrace: prepared.promptDebug.runtimeTrace,
          };
        } catch (error) {
          await this.turnRunTracker.failRunAndFloorBestEffort(floorId, error, "respond_from_conversation_tail_failed");
          throw error;
        } finally {
          unsubscribeRuntimeToolEvents();
          unsubscribeFloorRunEvents();
        }
      },
    );
  }

  private async loadLiveConversationWindow(args: {
    sessionId: string;
    branchId: string;
    beforeFloorNo?: number;
    visibility: import("../chat-history-loader.js").PromptVisibilityPolicy;
    sourceSelection?: import("../prompt-assembler.js").PromptSourceSelectionPolicy;
    currentInput?: PromptRuntimeConversationInput;
    effectiveUserMessageOverride?: string;
  }): Promise<PromptRuntimeConversationWindow> {
    const conversationWindow = await this.promptPreparationService.loadPromptRuntimeConversationWindow(args);
    if (conversationWindow.historyNormalization.violations.length > 0) {
      throw new ChatServiceError(
        "adjacent_assistant_floors",
        "Cannot execute prompt runtime when consecutive assistant floors are present in the visible history.",
      );
    }

    const effectiveUserMessage = args.effectiveUserMessageOverride ?? conversationWindow.effectiveUserMessage;
    if (!effectiveUserMessage) {
      throw new ChatServiceError(
        "missing_effective_user_tail",
        "Prompt runtime execution requires a trailing effective user turn.",
      );
    }

    return {
      ...conversationWindow,
      effectiveUserMessage,
    };
  }

  private async withGenerationCoordinator<T>(
    sessionId: string,
    branchId: string,
    abortSignal: AbortSignal | undefined,
    task: (runtime: CoordinatorRuntime) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.generationCoordinator.execute({
        sessionId,
        branchId,
        abortSignal,
        mode: this.executionPolicy.queueMode,
        timeoutMs: this.executionPolicy.queueTimeoutMs,
        task,
      });
    } catch (error) {
      if (error instanceof GenerationCoordinatorConflictError) {
        throw new ChatServiceError("generation_conflict", error.message, error);
      }

      if (error instanceof GenerationCoordinatorQueueTimeoutError) {
        throw new ChatServiceError("generation_queue_timeout", error.message, error);
      }

      if (error instanceof GenerationCoordinatorCancelledError) {
        throw new ChatServiceError("generation_cancelled", error.message, error);
      }

      throw error;
    }
  }

  private async runPreparedFloorGeneration(args: {
    mode: "respond" | "regenerate" | "retry_floor" | "edit_and_regenerate";
    runType: "respond" | "regenerate_page" | "retry_turn" | "edit_and_regenerate";
    sessionId: string;
    branchId?: string;
    floorId: string;
    pageId?: string;
    pageMessageId?: string;
    accountId: string;
    session: typeof sessions.$inferSelect;
    sessionInfo?: import("../prompt-assembler.js").SessionPromptInfo;
    userMessage: string;
    rawUserMessage?: string;
    baseRuntimeTrace?: import("../prompt-assembler.js").PromptRuntimeTrace;
    request: {
      config?: import("@tavern/core").TurnConfig;
      generationParams?: Partial<import("@tavern/core").GenerationParams>;
      promptIntent?: import("@tavern/core").PromptRunIntent;
      debugOptions?: import("./contracts.js").PromptLiveDebugOptions;
      sessionStateWrites?: import("./contracts.js").TurnSessionStateWriteRequest[];
      sessionStateOperationLog?: import("../../session-state/session-state-operation-log.js").SessionStateOperationLogContext;
      turnOperationLog?: import("../turn-commit-service.js").TurnCommitOperationLogContext;
    };
    executionContext: import("../prompt-runtime-execution.js").PromptRuntimeResolvedContext;
    conversationWindow?: PromptRuntimeConversationWindow;
    resolvedTurnModels: ResolvedTurnModels;
    firstPartyStateContext?: FirstPartyStateContext;
    abortSignal?: AbortSignal;
    onChunk?: (chunk: string) => void;
    stream?: boolean;
    orchestrationFailureCode: string;
    orchestrationFailureMessage: string;
    commitFailureMessage: string;
    supersedeSourceFloor?: { floorId: string };
  }): Promise<{
    prepared: import("./types.js").PreparedTurnContext;
    execution: TurnExecutionResult;
    commit: Awaited<ReturnType<TurnCommitService["commit"]>>;
  }> {
    await this.turnRunTracker.trackFloorRunPhase(args.floorId, "semantic_resolved");
    await this.turnRunTracker.trackFloorRunPhase(args.floorId, "prechecked");

    const prepared = await this.preparedTurnContextBuilder.prepare({
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
      userMessage: args.userMessage,
      rawUserMessage: args.rawUserMessage,
      baseRuntimeTrace: args.baseRuntimeTrace,
      request: args.request,
      executionContext: args.executionContext,
      conversationWindow: args.conversationWindow,
      resolvedTurnModels: args.resolvedTurnModels,
      firstPartyStateContext: args.firstPartyStateContext,
      abortSignal: args.abortSignal,
      onChunk: args.onChunk,
      stream: args.stream,
    });
    const { execution, commit } = await this.turnWorkflowRunner.runPreparedTurnWorkflow({
      floorId: args.floorId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      accountId: args.accountId,
      turnInput: prepared.turnInput,
      promptSnapshot: prepared.promptDebug.promptSnapshotRecord,
      promptRuntimeInspection: prepared.promptDebug.inspection,
      macroStagedMutations: prepared.assembled.runtimeTraceSeed.macroStagedMutations,
      sessionStateWrites: args.request.sessionStateWrites,
      sessionStateOperationLog: args.request.sessionStateOperationLog,
      turnOperationLog: args.request.turnOperationLog,
      resolvedTurnModels: prepared.resolvedTurnModels,
      runType: args.runType,
      orchestrationFailureCode: args.orchestrationFailureCode,
      orchestrationFailureMessage: args.orchestrationFailureMessage,
      commitFailureMessage: args.commitFailureMessage,
      memoryConsolidationRequested: prepared.memoryConsolidationRequested,
      persistMemory: this.memoryStoreEnabled,
      conversationInputSnapshot: prepared.conversationInputSnapshot,
      supersedeSourceFloor: args.supersedeSourceFloor,
    });

    if (prepared.promptDebug.runtimeTrace) {
      prepared.promptDebug.runtimeTrace = this.augmentRuntimeTraceWithAiOutputRegex({
        runtimeTrace: prepared.promptDebug.runtimeTrace,
        execution,
        scripts: prepared.assembled.promptSnapshot.regexProfile?.scripts ?? [],
        variables: prepared.assembled.promptSnapshot.variables,
      }) ?? prepared.promptDebug.runtimeTrace;
    }

    return { prepared, execution, commit };
  }

  private augmentRuntimeTraceWithAiOutputRegex(args: {
    runtimeTrace: import("../prompt-assembler.js").PromptRuntimeTrace;
    execution: TurnExecutionResult;
    scripts: import("@tavern/adapters-sillytavern").STRegexScript[];
    variables: Record<string, unknown>;
  }): import("../prompt-assembler.js").PromptRuntimeTrace | undefined {
    if (args.scripts.length === 0) {
      return args.runtimeTrace;
    }

    const cleanedOutput = extractSummaries(args.execution.rawText).cleanedText;
    const aiOutputPhase = executePromptRuntimeRegexPhase({
      phaseId: "persist.ai_output",
      text: cleanedOutput,
      scripts: args.scripts,
      depth: 0,
      substitutionContext: buildRegexSubstitutionContext(args.variables),
    });
    const aiOutputTrace = buildPromptRuntimeRegexTrace({
      userInputRules: args.runtimeTrace.regex?.userInputRules ?? [],
      aiOutputRules: args.runtimeTrace.regex?.aiOutputRules ?? [],
      ...(args.runtimeTrace.regex?.preprocessedUserMessage !== undefined ? { preprocessedUserMessage: args.runtimeTrace.regex.preprocessedUserMessage } : {}),
      phases: [aiOutputPhase],
      reservedPlacements: listRuntimeRegexReservedPlacements(args.scripts),
      substitutionMode: PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE,
    });
    const mergedRegex = mergePromptRuntimeRegexTrace(args.runtimeTrace.regex, aiOutputTrace);

    return mergedRegex
      ? { ...args.runtimeTrace, regex: mergedRegex }
      : args.runtimeTrace;
  }

  private async performTurnExecutionAndCommit(args: {
    floorId: string;
    sessionId: string;
    branchId?: string;
    accountId: string;
    turnInput: TurnInput;
    promptSnapshot?: NonNullable<PromptRuntimeExecutionResult["promptSnapshotRecord"]>;
    promptRuntimeInspection?: import("../prompt-runtime-control-service.js").PromptRuntimeInspectionResult;
    macroStagedMutations?: import("../st-macros/index.js").StMacroStagedMutation[];
    sessionStateWrites?: import("./contracts.js").TurnSessionStateWriteRequest[];
    sessionStateOperationLog?: import("../../session-state/session-state-operation-log.js").SessionStateOperationLogContext;
    turnOperationLog?: import("../turn-commit-service.js").TurnCommitOperationLogContext;
    resolvedTurnModels: ResolvedTurnModels;
    orchestrationFailureCode: string;
    orchestrationFailureMessage: string;
    persistMemory: boolean;
    runType: import("@tavern/core").FloorRunType;
    memoryConsolidationRequested: boolean;
    commitFailureMessage: string;
    conversationInputSnapshot?: import("./shared/metadata.js").FloorConversationInputSnapshot;
    supersedeSourceFloor?: { floorId: string };
  }): Promise<{
    execution: TurnExecutionResult;
    commit: Awaited<ReturnType<TurnCommitService["commit"]>>;
  }> {
    const turnInput: TurnInput = args.turnInput.toolExecutionRunId
      ? args.turnInput
      : {
          ...args.turnInput,
          toolExecutionRunId: nanoid(),
        };
    const toolExecutionRunId = turnInput.toolExecutionRunId!;
    let execution: TurnExecutionResult;

    try {
      execution = await this.orchestrator.executeTurn(turnInput);
    } catch (error) {
      const replayBlockedError = findErrorByConstructor(error, ToolReplayBlockedError);
      if (replayBlockedError) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "replay_blocked");
        await this.turnRunTracker.failRunAndFloorBestEffort(args.floorId, replayBlockedError, "tool_replay_blocked");
        throw new ChatServiceError(
          "tool_replay_blocked",
          replayBlockedError.message,
          error,
          {
            blocking_executions: replayBlockedError.blockingExecutions.map((execution) =>
              toReplayBlockingExecutionDetailFromBlockedError(execution)),
          },
        );
      }

      const unsupportedToolModeError = findErrorByConstructor(error, UnsupportedToolModeError);
      if (unsupportedToolModeError) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
        await this.turnRunTracker.failRunAndFloorBestEffort(args.floorId, unsupportedToolModeError, "invalid_tool_mode");
        throw new ChatServiceError("invalid_tool_mode", unsupportedToolModeError.message, error);
      }

      const timeoutError = findErrorByConstructor(error, LLMTimeoutError);
      if (timeoutError) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
        await this.turnRunTracker.failRunAndFloorBestEffort(args.floorId, timeoutError, "generation_timeout");
        throw new ChatServiceError(
          "generation_timeout",
          `${args.orchestrationFailureMessage}: ${timeoutError.message}`,
          error,
        );
      }

      await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
      await this.turnRunTracker.failRunAndFloorBestEffort(args.floorId, error, args.orchestrationFailureCode);
      throw new ChatServiceError(
        args.orchestrationFailureCode,
        `${args.orchestrationFailureMessage}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    try {
      this.firstPartyStateContextService.stageExecutionState({
        accountId: args.accountId,
        sessionId: args.sessionId,
        branchId: args.branchId ?? "main",
        floorId: args.floorId,
        runType: args.runType,
        execution,
        promptSnapshot: args.promptSnapshot,
      });
      this.turnSessionStateService.stageTurnBoundSessionStateWrites({
        accountId: args.accountId,
        sessionId: args.sessionId,
        branchId: args.branchId ?? "main",
        floorId: args.floorId,
        sourcePageId: null,
        writes: args.sessionStateWrites,
        operationLog: args.sessionStateOperationLog,
      });
    } catch (error) {
      this.turnSessionStateService.discardStagedSessionStateBestEffort(
        args.accountId,
        args.sessionId,
        args.floorId,
        "session_state_stage_failed",
      );
      await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
      await this.turnRunTracker.failRunAndFloorBestEffort(args.floorId, error, "session_state_stage_failed");
      if (error instanceof ChatServiceError) {
        throw error;
      }
      throw new ChatServiceError(
        "session_state_stage_failed",
        `Failed to stage session state: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    await this.turnRunTracker.trackFloorRunPhase(args.floorId, "transaction_prepared");

    const commitInput = {
      accountId: args.accountId,
      floorId: args.floorId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      execution,
      runId: toolExecutionRunId,
      operationLog: args.turnOperationLog,
      variableCommit: {
        pageId: turnInput.pageId,
        rerouteToSessionState: (execution.bufferedVariableMutations ?? []).some((mutation) => mutation.source?.targetSurface === "session_state"),
        actorClientId: null,
      },
      promptSnapshot: args.promptSnapshot,
      promptRuntimeInspection: args.promptRuntimeInspection,
      toolExecutionRecords: execution.toolExecutionRecords,
      pendingToolJobs: execution.pendingToolJobs,
      macroStagedMutations: args.macroStagedMutations,
      memoryCommit: args.persistMemory
        ? {
            enableConsolidation: args.memoryConsolidationRequested,
            summaries: execution.summaries,
            consolidationOutput: execution.consolidationResult?.output,
          }
        : undefined,
      conversationInputSnapshot: args.conversationInputSnapshot,
      ...(args.supersedeSourceFloor ? { supersedeSourceFloor: args.supersedeSourceFloor } : {}),
    };

    let commit: Awaited<ReturnType<TurnCommitService["commit"]>>;
    let commitAttemptCount = 0;
    try {
      commit = await executeWithRetry(
        async (attempt) => {
          commitAttemptCount = attempt;
          return this.turnCommitService.commit(commitInput);
        },
        this.executionPolicy.commitRetry,
        {
          shouldRetry: isSqliteBusyError,
          onRetry: async ({ attempt, error, delayMs }) => {
            await this.emitBestEffortEvent("commit.retry", {
              sessionId: args.sessionId,
              branchId: args.branchId,
              floorId: args.floorId,
              attempt,
              backoffMs: delayMs,
              message: error instanceof Error ? error.message : String(error),
            });
          },
        },
      );
    } catch (error) {
      await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
      if (isSqliteBusyError(error)) {
        await this.emitBestEffortEvent("commit.busy", {
          sessionId: args.sessionId,
          branchId: args.branchId,
          floorId: args.floorId,
          attempts: Math.max(commitAttemptCount, 1),
          message: error instanceof Error ? error.message : String(error),
        });
        this.turnSessionStateService.discardStagedSessionStateBestEffort(
          args.accountId,
          args.sessionId,
          args.floorId,
          "commit_busy",
        );
        await this.turnRunTracker.failRunAndFloorBestEffort(args.floorId, error, "commit_busy");
        throw new ChatServiceError(
          "commit_busy",
          `${args.commitFailureMessage}: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }

      this.turnSessionStateService.discardStagedSessionStateBestEffort(
        args.accountId,
        args.sessionId,
        args.floorId,
        error instanceof FloorStateConflictError
          ? "commit_conflict"
          : error instanceof FloorNotFoundError
            ? "floor_not_found"
            : "turn_commit_failed",
      );

      if (error instanceof FloorNotFoundError) {
        await this.turnRunTracker.tryMarkRunFailed(args.floorId, error, "floor_not_found");
        throw new ChatServiceError("floor_not_found", `Floor '${args.floorId}' not found`, error);
      }

      if (error instanceof FloorStateConflictError) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
        await this.turnRunTracker.tryMarkRunFailed(args.floorId, error, "commit_conflict");
        throw new ChatServiceError("commit_conflict", `${args.commitFailureMessage}: ${error.message}`, error);
      }

      await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
      await this.turnRunTracker.failRunAndFloorBestEffort(args.floorId, error, "turn_commit_failed");
      throw new ChatServiceError(
        "turn_commit_failed",
        `${args.commitFailureMessage}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    if (commitAttemptCount > 1) {
      await this.emitBestEffortEvent("commit.succeeded_after_retry", {
        sessionId: args.sessionId,
        branchId: args.branchId,
        floorId: args.floorId,
        attempts: commitAttemptCount,
      });
    }

    await this.modelService.markTurnModelUsed(args.resolvedTurnModels, args.accountId);

    return { execution, commit };
  }

  private async markToolExecutionRunOutcome(
    runId: string,
    outcome: ToolExecutionCommitOutcome,
  ): Promise<void> {
    try {
      await this.toolExecutionRepository.markRunCommitOutcome(runId, outcome);
    } catch {
      // 执行日志本体已经先行落库；失败边界上的归宿更新保持 best-effort。
    }
  }

  private async emitBestEffortEvent<K extends keyof CoreEventMap>(
    name: K,
    payload: CoreEventMap[K],
  ): Promise<void> {
    try {
      await this.eventBus.emit(name, payload as never);
    } catch {
      // 观测类事件不应反向影响主流程。
    }
  }

  private resolveAccountId(accountId?: string): string {
    return resolveAccountIdOrThrow(accountId, this.accountContext);
  }

  private async getSession(sessionId: string, accountId: string) {
    return new OwnedSessionRepository(this.db).getById(accountId, sessionId);
  }

  private buildSessionPromptInfo(
    session: Parameters<TurnModelService["buildSessionPromptInfo"]>[0],
    resolvedTurnModels: ResolvedTurnModels,
    firstPartyStateContext?: FirstPartyStateContext,
    branchAssetBinding?: SessionBranchAssetBindingState | null,
  ) {
    return this.modelService.buildSessionPromptInfo(
      session,
      resolvedTurnModels,
      firstPartyStateContext,
      branchAssetBinding,
    );
  }

  private getSessionBranchAssetBinding(
    accountId: string,
    sessionId: string,
    branchId: string,
  ): SessionBranchAssetBindingState | null {
    return new SessionBranchRegistryService(this.db).get(accountId, sessionId, branchId)?.assetBinding ?? null;
  }

  private async assertRetryReplayConfirmed(input: {
    floorId: string;
    sessionId: string;
    accountId: string;
    request: RetryFloorRequest;
  }): Promise<void> {
    await this.replayGuardService.assertRetryReplayConfirmed(input);
  }

  private async requireActiveSession(
    sessionId: string,
    accountId: string,
    archivedMessage: string,
  ): Promise<typeof sessions.$inferSelect> {
    const session = await this.getSession(sessionId, accountId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", archivedMessage);
    }

    return session;
  }

  private rethrowBranchLocalSnapshotError(error: unknown): never {
    if (isBranchLocalSnapshotMissingError(error)) {
      throw new ChatServiceError("branch_local_snapshot_missing", error.message, error, error.details);
    }

    throw error;
  }
}

function resolveTurnExecutionPolicy(policy?: TurnExecutionPolicyOverrides): TurnExecutionPolicy {
  return {
    queueMode: policy?.queueMode ?? DEFAULT_TURN_EXECUTION_POLICY.queueMode,
    queueTimeoutMs: normalizePositiveInt(policy?.queueTimeoutMs)
      ?? DEFAULT_TURN_EXECUTION_POLICY.queueTimeoutMs,
    executionTimeoutMs: normalizePositiveInt(policy?.executionTimeoutMs)
      ?? DEFAULT_TURN_EXECUTION_POLICY.executionTimeoutMs,
    commitRetry: {
      maxRetries: normalizeNonNegativeInt(policy?.commitRetry?.maxRetries)
        ?? DEFAULT_TURN_EXECUTION_POLICY.commitRetry.maxRetries,
      baseDelayMs: normalizePositiveInt(policy?.commitRetry?.baseDelayMs)
        ?? DEFAULT_TURN_EXECUTION_POLICY.commitRetry.baseDelayMs,
    },
  };
}

function toReplayBlockingExecutionDetailFromBlockedError(
  execution: ToolReplayBlockedError["blockingExecutions"][number],
): ReplayBlockingExecutionDetail {
  return {
    execution_id: execution.executionId,
    tool_name: execution.toolName,
    provider_id: execution.providerId,
    provider_type: execution.providerType ?? null,
    side_effect_level: execution.sideEffectLevel ?? null,
    status: execution.status,
    lifecycle_state: execution.lifecycleState ?? null,
    replay_safety: execution.replaySafety,
    reason: execution.reason,
  };
}
