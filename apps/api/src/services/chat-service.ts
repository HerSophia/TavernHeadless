/**
 * Chat Service
 *
 * 封装聊天业务逻辑：
 * - 加载会话历史（Floor → Page → Message）
 * - 创建用户消息（Floor + Page + Message）
 * - 构建 TurnInput
 * - 调用 TurnOrchestrator
 * - 保存助手回复
 * - 重新生成（Regenerate）
 */

import { asc, eq, and, desc, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  assemblePrompt,
  buildPromptSnapshotPreview,
  buildPromptSnapshotRecord,
  type SessionPromptInfo,
  type AssembleDebugInfo,
  type PromptSnapshotPreview,
} from "./prompt-assembler.js";
import type {
  TurnOrchestrator,
  TurnInput,
  TurnExecutionResult,
  ExecutedToolCallRecord,
  TurnConfig,
  TurnRunObserver,
  FloorRunSnapshot,
  FloorRunType,
  ChatMessage,
  GenerationParams,
  InstanceSlot,
  ModelConfig,
  TokenCounter,
  MemoryInjectionOptions,
  MemoryStore,
  ToolPermissions,
  CoreEventMap,
  CoreEventBus,
  ToolExecutionCommitOutcome,
  ToolReplaySafety,
} from "@tavern/core";
import {
  createEventBus,
  evaluateToolReplaySafety,
  evaluateExecutedToolCallReplaySafety,
  FloorNotFoundError,
  FloorStateConflictError,
  FloorStateMachine,
  isAutoReplaySafe,
  LLMTimeoutError,
  ToolReplayBlockedError,
  ToolRegistry,
  UnsupportedToolModeError,
} from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { sessions, floors, messagePages, messages } from "../db/schema.js";
import {
  SessionToolRegistryService,
  SessionToolRegistryServiceError,
} from "./session-tool-registry-service.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../accounts/constants.js";
import { normalizeNonNegativeInt, normalizePositiveInt } from "../lib/utils.js";
import { executeWithRetry, isSqliteBusyError } from "../lib/retry.js";
import { DrizzleFloorRepository } from "../adapters/drizzle-floor-repository.js";
import { ChatHistoryLoader } from "./chat-history-loader.js";
import { ChatMessagePersistence, type PersistedMessageRef } from "./chat-message-persistence.js";
import { DrizzleToolExecutionRepository } from "../adapters/drizzle-tool-execution-repository.js";
import {
  GenerationCoordinatorConflictError,
  GenerationCoordinatorQueueTimeoutError,
  GenerationCoordinatorCancelledError,
  InMemoryGenerationCoordinator,
  type CoordinatorRuntime,
  type GenerationCoordinator,
  type GenerationExecutionMode,
  GenerationGuardService,
} from "./generation-guard-service.js";
import { TurnCommitService, type TurnCommitMemoryReceipt } from "./turn-commit-service.js";
import type { FloorRunService } from "./floor-run-service.js";
import { OwnedMessageRepository, OwnedSessionRepository } from "./owned-resource-repositories.js";

// ── 请求/响应类型 ─────────────────────────────────────

/** /respond 请求体 */
export interface RespondRequest {
  /** 用户消息文本 */
  message: string;
  /** 回合配置覆盖 */
  config?: TurnConfig;
  /** 生成参数覆盖 */
  generationParams?: Partial<GenerationParams>;
  /** 对话分支，默认 main */
  branchId?: string;
  /** 当目标分支尚无楼层时，可指定分叉源楼层 */
  sourceFloorId?: string;
}

/** /respond 响应体 */
export interface RespondResult {
  /** 楼层 ID */
  floorId: string;
  /** 楼层编号 */
  floorNo: number;
  /** 助手回复文本 */
  generatedText: string;
  /** 提取的摘要 */
  summaries: string[];
  /** Token 使用统计 */
  totalUsage: TurnExecutionResult["totalUsage"];
  /** 楼层最终状态 */
  finalState: "committed";
  /** 实际写入的分支 */
  branchId: string;
  /** 记忆提交 / 入队回执（若当前会话启用了记忆持久化） */
  memory?: TurnCommitMemoryReceipt;
}

/** /respond/dry-run 请求体 */
export interface DryRunRequest {
  /** 用户消息文本 */
  message: string;
}

/** /respond/dry-run 响应体 */
export interface DryRunResult {
  /** 编排后的消息 */
  messages: ChatMessage[];
  /** Prompt token 估算 */
  tokenEstimate: number;
  /** 可用于回复的 token 预算 */
  availableForReply: number;
  /** 注入的记忆摘要文本（若有） */
  memorySummary?: string;
  /** 与真实 commit 对齐的 Prompt 快照预览 */
  promptSnapshot: PromptSnapshotPreview;
  /** 组装调试信息 */
  assembly: AssembleDebugInfo & {
    /** 当前用户消息应用 USER_INPUT 正则后的预览 */
    preprocessedUserMessage?: string;
  };
}

/** /regenerate 请求体 */
export interface RegenerateRequest {
  /** 回合配置覆盖（可选） */
  config?: TurnConfig;
  /** 生成参数覆盖（可选） */
  generationParams?: Partial<GenerationParams>;
}

/** /regenerate 响应体 */
export interface RegenerateResult {
  /** 新楼层 ID */
  floorId: string;
  /** 楼层编号 */
  floorNo: number;
  /** 被替代的旧楼层 ID */
  previousFloorId: string;
  /** 新生成的文本 */
  generatedText: string;
  /** 提取的摘要 */
  summaries: string[];
  /** Token 统计 */
  totalUsage: TurnExecutionResult["totalUsage"];
  /** 最终状态 */
  finalState: "committed";
  /** 记忆提交 / 入队回执（若当前会话启用了记忆持久化） */
  memory?: TurnCommitMemoryReceipt;
}

/** /floors/:id/retry 请求体 */
export interface RetryFloorRequest {
  /** 回合配置覆盖（可选） */
  config?: TurnConfig;
  /** 生成参数覆盖（可选） */
  generationParams?: Partial<GenerationParams>;
  /** 显式确认允许重放的历史执行记录 ID 列表 */
  confirmedExecutionIds?: string[];
}

/** /floors/:id/retry 响应体 */
export interface RetryFloorResult {
  /** 重试的楼层 ID */
  floorId: string;
  /** 楼层编号 */
  floorNo: number;
  /** 所属分支 */
  branchId: string;
  /** 生成文本 */
  generatedText: string;
  /** 摘要 */
  summaries: string[];
  /** Token 统计 */
  totalUsage: TurnExecutionResult["totalUsage"];
  /** 最终状态 */
  finalState: "committed";
  /** 记忆提交 / 入队回执（若当前会话启用了记忆持久化） */
  memory?: TurnCommitMemoryReceipt;
}

interface ReplayBlockingExecutionDetail {
  execution_id: string;
  tool_name: string;
  provider_id: string;
  provider_type: string | null;
  side_effect_level: string | null;
  status: string;
  lifecycle_state: string | null;
  replay_safety: ToolReplaySafety;
  reason: string;
  error_message?: string;
}

export interface EditAndRegenerateRequest extends RetryFloorRequest {
  /** 编辑后的用户消息 */
  content: string;
  /** 可选指定分支 ID，不传则自动生成 */
  branchId?: string;
}

export interface EditAndRegenerateResult extends RetryFloorResult {
  sourceFloorId: string;
  sourceMessageId: string;
  /** 记忆提交 / 入队回执（若当前会话启用了记忆持久化） */
  memory?: TurnCommitMemoryReceipt;
}

export interface RespondRuntimeToolEvent {
  executionId: string;
  toolName: string;
  providerId: string;
  providerType?: string;
  sideEffectLevel?: string;
  phase: "start" | "success" | "error" | "denied" | "timeout" | "uncertain" | "blocked";
  message?: string;
  durationMs?: number;
  replaySafety: ToolReplaySafety;
}

export interface RespondRuntimeOptions {
  /**
   * 楼层创建成功后的回调。
   * 可用于在流式模式下尽早告知客户端 floor 信息。
   */
  onStart?: (context: { floorId: string; floorNo: number; branchId: string }) => void;
  /**
   * 流式文本片段回调。
   */
  onChunk?: (chunk: string) => void;
  /**
   * 流式工具执行事件回调。
   */
  onTool?: (event: RespondRuntimeToolEvent) => void;
  /** 流式楼层运行快照回调。 */
  onRun?: (event: FloorRunSnapshot) => void;
  /**
   * 可选：中止信号（如客户端断连）。
   */
  abortSignal?: AbortSignal;
}

export interface ResolvedTurnModel {
  model?: ModelConfig;
  source: "env" | "global_profile" | "session_profile";
  profileId?: string;
  generationParams?: Partial<GenerationParams>;
  enabled?: boolean;
  presetId?: string;
}

export type ResolvedTurnModels = Partial<Record<InstanceSlot, ResolvedTurnModel>>;

type ResolveTurnModelFn = (sessionId: string, accountId: string) => Promise<ResolvedTurnModel | null>;
/**
 * 多 slot 解析函数：返回按 slot 粒度的模型配置。
 * 如果同时提供 resolveTurnModels 和 resolveTurnModel，前者优先。
 */
type ResolveTurnModelsFn = (sessionId: string, accountId: string) => Promise<ResolvedTurnModels>;
type OnTurnModelUsedFn = (model: ResolvedTurnModel, accountId: string) => Promise<void> | void;

export interface TurnExecutionPolicy {
  /**
   * 生成协调模式。
   * Phase 1 默认保持 reject。
   */
  queueMode: GenerationExecutionMode;
  /**
   * queue 模式下的等待超时。
   */
  queueTimeoutMs?: number;
  /**
   * 生成执行默认超时。
   */
  executionTimeoutMs: number;
  /**
   * commit 瞬时锁争用的有限重试策略。
   */
  commitRetry: {
    maxRetries: number;
    baseDelayMs: number;
  };
}

export interface TurnExecutionPolicyOverrides {
  queueMode?: GenerationExecutionMode;
  queueTimeoutMs?: number;
  executionTimeoutMs?: number;
  commitRetry?: Partial<TurnExecutionPolicy["commitRetry"]>;
}

const DEFAULT_TURN_EXECUTION_POLICY: TurnExecutionPolicy = {
  queueMode: "reject",
  queueTimeoutMs: 5_000,
  executionTimeoutMs: 60_000,
  commitRetry: { maxRetries: 2, baseDelayMs: 100 },
};

export interface ChatServiceOptions {
  /**
   * 可选：限制进入 prompt 的历史楼层数（按最近 N 层）。
   * 默认 undefined 表示不限制。
   */
  historyMaxFloors?: number;
  /**
   * 可选：MemoryStore 实例。
   * 提供后在 prompt 编排前检索记忆上下文并注入，
   * 回合完成后持久化摘要提取结果。
   */
  memoryStore?: MemoryStore;
  /**
   * 可选：记忆注入衰减配置。
   * 传入后会在注入候选记忆的排序中启用 decay（更偏向最近更新的条目）。
   */
  memoryInjectionDecay?: MemoryInjectionOptions["decay"];
  /**
   * 可选：默认启用 MemoryConsolidator。
   */
  enableMemoryConsolidationByDefault?: boolean;
  /**
   * 是否启用异步记忆入队主路径。
   * 启用后，回合请求不再同步执行 MemoryConsolidator。
   */
  enableAsyncMemoryIngest?: boolean;
  /**
   * 是否启用 micro / macro 双层摘要注入预算。
   */
  enableDualSummaryInjection?: boolean;
  /**
   * @deprecated 使用 resolveTurnModels 代替。
   * 可选：为当前会话解析本轮使用的模型配置（仅 narrator）。
   */
  resolveTurnModel?: ResolveTurnModelFn;
  /** 可选：外部注入提交服务。 */
  turnCommitService?: TurnCommitService;
  /**
   * 可选：按 slot 粒度为当前会话解析模型配置。
   * 优先于 resolveTurnModel。
   */
  resolveTurnModels?: ResolveTurnModelsFn;
  /**
   * 可选：本轮生成成功后回调（例如更新 profile last_used_at）。
   */
  onTurnModelUsed?: OnTurnModelUsedFn;
  floorRunService?: FloorRunService;
  /**
   * 可选：工具注册表实例。
   * 提供后可在生成时向 LLM 提供可用工具。
   */
  toolRegistry?: ToolRegistry;
  /**
   * 可选：按会话构建运行时工具注册表快照。
   */
  sessionToolRegistryService?: SessionToolRegistryService;
  /**
   * 可选：解析会话的工具权限。默认从 session metadata_json 读取。
   */
  resolveToolPermissions?: (sessionId: string, accountId: string) => Promise<ToolPermissions | null>;
  /**
   * 可选：同一 session / branch 的生成互斥守卫。
   */
  generationGuard?: GenerationGuardService;
  /**
   * 可选：生成协调器。
   * 优先级高于 generationGuard。
   */
  generationCoordinator?: GenerationCoordinator;
  /**
   * 可选：与编排器共享的事件总线。
   */
  eventBus?: CoreEventBus;
  /**
   * 可选：执行策略。
   */
  executionPolicy?: TurnExecutionPolicyOverrides;
}

// ── ChatService ───────────────────────────────────────

export class ChatService {
  private readonly historyMaxFloors?: number;
  private readonly historyLoader: ChatHistoryLoader;
  private readonly messagePersistence: ChatMessagePersistence;
  private readonly memoryStore?: MemoryStore;
  private readonly memoryInjectionDecay?: MemoryInjectionOptions["decay"];
  private readonly enableMemoryConsolidationByDefault: boolean;
  private readonly enableAsyncMemoryIngest: boolean;
  private readonly enableDualSummaryInjection: boolean;
  private readonly resolveTurnModel?: ResolveTurnModelFn;
  private readonly resolveTurnModels?: ResolveTurnModelsFn;
  private readonly onTurnModelUsed?: OnTurnModelUsedFn;
  private readonly toolRegistry?: ToolRegistry;
  private readonly sessionToolRegistryService?: SessionToolRegistryService;
  private readonly floorRunService?: FloorRunService;
  private readonly resolveToolPermissions?: (sessionId: string, accountId: string) => Promise<ToolPermissions | null>;
  private readonly eventBus: CoreEventBus;
  private readonly floorStateMachine: FloorStateMachine;
  private readonly turnCommitService: TurnCommitService;
  private readonly toolExecutionRepository: DrizzleToolExecutionRepository;
  private readonly generationCoordinator: GenerationCoordinator;
  private readonly executionPolicy: TurnExecutionPolicy;

  constructor(
    private readonly db: AppDb,
    private readonly orchestrator: TurnOrchestrator,
    private readonly tokenCounter: TokenCounter,
    options: ChatServiceOptions = {}
  ) {
    this.executionPolicy = resolveTurnExecutionPolicy(options.executionPolicy);
    this.historyMaxFloors = normalizePositiveInt(options.historyMaxFloors);
    this.historyLoader = new ChatHistoryLoader(db, this.historyMaxFloors);
    this.messagePersistence = new ChatMessagePersistence(db, tokenCounter);
    this.memoryStore = options.memoryStore;
    this.memoryInjectionDecay = options.memoryInjectionDecay;
    this.enableMemoryConsolidationByDefault =
      options.enableMemoryConsolidationByDefault === true;
    this.enableAsyncMemoryIngest = options.enableAsyncMemoryIngest === true;
    this.enableDualSummaryInjection = options.enableDualSummaryInjection === true;
    this.resolveTurnModel = options.resolveTurnModel;
    this.resolveTurnModels = options.resolveTurnModels;
    this.onTurnModelUsed = options.onTurnModelUsed;
    this.toolRegistry = options.toolRegistry;
    this.sessionToolRegistryService = options.sessionToolRegistryService;
    this.floorRunService = options.floorRunService;
    this.resolveToolPermissions = options.resolveToolPermissions;
    this.eventBus = options.eventBus ?? createEventBus();
    this.floorStateMachine = new FloorStateMachine(new DrizzleFloorRepository(db), this.eventBus);
    this.toolExecutionRepository = new DrizzleToolExecutionRepository(db);
    this.turnCommitService = options.turnCommitService
      ?? new TurnCommitService(db, this.messagePersistence, this.eventBus, {
        enableAsyncMemoryIngest: this.enableAsyncMemoryIngest,
      });
    this.generationCoordinator = options.generationCoordinator
      ?? options.generationGuard
      ?? new InMemoryGenerationCoordinator();
  }

  /**
   * 执行一次聊天回合。
   *
   * 完整流程：
   * 1. 验证会话存在
   * 2. 加载历史消息 → ChatMessage[]
   * 3. 创建新楼层（draft 状态）
   * 4. 保存用户消息
   * 5. 构建 TurnInput + 调用 Orchestrator
   * 6. 保存助手回复
   * 7. 更新楼层 token 统计
   *
   * @param sessionId - 会话 ID
   * @param request - 请求体
   * @returns 回合结果
   */
  async respond(
    sessionId: string,
    request: RespondRequest,
    runtimeOptions: RespondRuntimeOptions = {},
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID
  ): Promise<RespondResult> {
    // ── 1. 验证会话 ──
    const session = await this.getSession(sessionId, accountId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot respond to an archived session");
    }

    const branchId = normalizeBranchId(request.branchId);

    return this.runWithGenerationCoordinator(
      sessionId,
      branchId,
      runtimeOptions.abortSignal,
      async (generationRuntime) => {
        const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, accountId);
        this.assertNarratorSlotEnabled(resolvedTurnModels);

        // ── 2. 确定分支上下文 + 加载历史 ──
        const branchContext = await this.resolveRespondBranchContext(
          sessionId,
          branchId,
          request.sourceFloorId
        );
        const history = await this.historyLoader.loadHistory(sessionId, branchId, branchContext.nextFloorNo);

        // ── 2b. 记忆检索 ──
        const memorySummary = await this.retrieveMemorySummary(sessionId, accountId);

        // ── 3. 创建新楼层 ──
        const nextFloorNo = branchContext.nextFloorNo;
        const now = Date.now();
        const { floorId, userMessageRef } = this.createDraftFloorWithUserMessage({
          sessionId,
          floorNo: nextFloorNo,
          branchId,
          parentFloorId: branchContext.parentFloorId,
          userMessage: request.message,
          userId: session.userId,
          userSnapshotJson: session.userSnapshotJson,
          now,
        });

        await this.initializeFloorRun(sessionId, floorId, "respond", now);
        runtimeOptions.onStart?.({ floorId, floorNo: nextFloorNo, branchId });
        const unsubscribeRuntimeToolEvents = this.subscribeRuntimeToolEvents(floorId, runtimeOptions);
        const unsubscribeFloorRunEvents = this.subscribeFloorRunEvents(floorId, runtimeOptions);

        try {
          // ── 5. 构建 TurnInput + 执行编排 ──
          const sessionInfo = this.buildSessionPromptInfo(session, resolvedTurnModels);
          const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
          await this.trackFloorRunPhase(floorId, "semantic_resolved");
          await this.trackFloorRunPhase(floorId, "prechecked");
          const maxContextTokensOverride = this.resolveMaxContextTokensOverride(request.generationParams, narratorParams);

          const assembled = await assemblePrompt(
            this.db,
            accountId,
            sessionInfo,
            history,
            request.message,
            this.tokenCounter,
            memorySummary,
            {
              maxContextTokensOverride,
              variableContext: { sessionId, branchId, floorId, pageId: userMessageRef.pageId },
            }
          );
          await this.trackFloorRunPhase(floorId, "prompt_assembled");

          const promptSnapshot = buildPromptSnapshotRecord({
            floorId,
            sessionId,
            snapshot: assembled.promptSnapshot,
          });

          const generationParams = this.buildGenerationParams({
            requestParams: request.generationParams,
            narratorParams,
            availableForReply: assembled.tokenUsage.availableForReply,
            stream: !!runtimeOptions.onChunk,
          });

          const requestedTurnConfig = this.resolveRequestedTurnConfig(request.config, resolvedTurnModels);
          const memoryConsolidationRequested = this.shouldRequestMemoryConsolidation(requestedTurnConfig);
          const turnConfig = this.toOrchestratorTurnConfig(requestedTurnConfig);
          const toolRuntime = await this.resolveTurnToolingForFloor({
            floorId,
            sessionId,
            accountId,
            config: turnConfig,
          });
          const consolidationContext = await this.buildConsolidationContext(
            sessionId,
            accountId,
            request.message,
            turnConfig
          );

          const turnInput: TurnInput = {
            sessionId,
            branchId,
            floorId,
            pageId: userMessageRef.pageId,
            accountId,
            messages: assembled.messages,
            generationParams,
            config: turnConfig,
            consolidationContext,
            preProcess: assembled.preProcess,
            postProcess: assembled.postProcess,
            modelOverrides: this.buildModelOverrides(resolvedTurnModels),
            generationParamsOverrides: this.buildGenerationParamsOverrides(resolvedTurnModels),
            onChunk: runtimeOptions.onChunk,
            abortSignal: runtimeOptions.abortSignal ?? generationRuntime.abortSignal,
            toolRegistry: toolRuntime.toolRegistry,
            runObserver: this.createTurnRunObserver(floorId),
            toolPermissions: toolRuntime.toolPermissions,
          };

          const { execution, commit } = await this.executeTurnAndCommit({
            floorId,
            sessionId,
            branchId,
            accountId,
            turnInput,
            promptSnapshot,
            resolvedTurnModels,
            orchestrationFailureCode: "orchestration_failed",
            orchestrationFailureMessage: "Turn orchestration failed",
            commitFailureMessage: "Turn commit failed",
            memoryConsolidationRequested,
            persistMemory: this.memoryStore !== undefined,
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
          };
        } catch (error) {
          await this.tryMarkRunFailed(floorId, error, "respond_failed");
          throw error;
        } finally {
          unsubscribeRuntimeToolEvents();
          unsubscribeFloorRunEvents();
        }
      }
    );
  }

  /**
   * 执行 Prompt dry-run。
   *
   * 仅做 prompt 组装与调试信息返回，不调用 Orchestrator，
   * 不写入 floor/message 等回合数据。
   */
  async dryRun(
    sessionId: string,
    request: DryRunRequest,
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID
  ): Promise<DryRunResult> {
    const session = await this.getSession(sessionId, accountId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot dry-run in an archived session");
    }

    const history = await this.historyLoader.loadHistory(sessionId);
    const memorySummary = await this.retrieveMemorySummary(sessionId, accountId);
    const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, accountId);
    const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
    const maxContextTokensOverride = normalizePositiveInt(narratorParams?.maxContextTokens);

    const sessionInfo = this.buildSessionPromptInfo(session, resolvedTurnModels);

    const assembled = await assemblePrompt(
      this.db,
      accountId,
      sessionInfo,
      history,
      request.message,
      this.tokenCounter,
      memorySummary,
      {
        includeDebug: true, maxContextTokensOverride, variableContext: { sessionId },
      }
    );

    const preprocessedUserMessage = assembled.preProcess
      ? assembled.preProcess([{ role: "user", content: request.message }])[0]?.content
      : undefined;

    const debug: AssembleDebugInfo = assembled.debug ?? {
      mode: "fallback",
      presetUsed: false,
      worldbookHits: 0,
      regexPreRules: [],
      regexPostRules: [],
      memorySummaryInjected: false,
      reservedVariableCollisions: [],
    };

    return {
      messages: assembled.messages,
      tokenEstimate: assembled.tokenUsage.total,
      availableForReply: assembled.tokenUsage.availableForReply,
      memorySummary,
      promptSnapshot: buildPromptSnapshotPreview(assembled.promptSnapshot),
      assembly: { ...debug, preprocessedUserMessage },
    };
  }

  /**
   * 重新生成最后一轮的 AI 回复。
   *
   * 完整流程：
   * 1. 验证会话存在且未归档
   * 2. 找到最后一个 committed 楼层（main 分支）
   * 3. 提取该楼层的用户消息
   * 4. 加载该楼层之前的历史消息
   * 5. 将旧楼层标记为 superseded（让出 live 唯一约束）
   * 6. 创建新的 draft 楼层（同 floorNo，同 branchId，parentFloorId 指向旧楼层）
   * 7. 保存用户消息到新楼层
   * 8. 构建 TurnInput + 调用 Orchestrator
   * 9. 保存助手回复
   * 10. 更新楼层 token 统计
   *
   * @param sessionId - 会话 ID
   * @param request - 请求体（可选的配置和生成参数覆盖）
   * @returns 重新生成结果
   */
  async regenerate(
    sessionId: string,
    request: RegenerateRequest = {},
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID
  ): Promise<RegenerateResult> {
    // ── 1. 验证会话 ──
    const session = await this.getSession(sessionId, accountId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot regenerate in an archived session");
    }

    return this.runWithGenerationCoordinator(sessionId, "main", undefined, async (generationRuntime) => {
      // ── 2. 找到最后一个 committed 楼层 ──
      const targetFloor = await this.historyLoader.getLastCommittedFloor(sessionId);
      if (!targetFloor) {
        throw new ChatServiceError(
          "no_floor_to_regenerate",
          "No committed floor found to regenerate"
        );
      }

      // ── 3. 提取用户消息 ──
      const existingUserMessage = await this.getUserMessageFromFloor(targetFloor.id);
      if (!existingUserMessage) {
        throw new ChatServiceError(
          "no_user_message",
          `No user message found in floor '${targetFloor.id}'`
        );
      }
      const userMessage = existingUserMessage.content;

      // ── 4. 加载该楼层之前的历史 ──
      const history = await this.historyLoader.loadHistoryBeforeFloor(sessionId, targetFloor.floorNo);

      // ── 4b. 记忆检索 ──
      const memorySummary = await this.retrieveMemorySummary(sessionId, accountId);

      const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, accountId);
      this.assertNarratorSlotEnabled(resolvedTurnModels);

      const newFloorId = nanoid();
      const now = Date.now();
      const { userMessageRef } = this.createDraftFloorWithUserMessage({
        floorId: newFloorId,
        sessionId,
        floorNo: targetFloor.floorNo,
        branchId: targetFloor.branchId,
        parentFloorId: targetFloor.id,
        userMessage,
        userId: session.userId,
        userSnapshotJson: session.userSnapshotJson,
        now,
        prepare: (tx) => {
          tx
            .update(floors)
            .set({
              supersededAt: now,
              supersededByFloorId: newFloorId,
              updatedAt: now,
            })
            .where(eq(floors.id, targetFloor.id))
            .run();
        },
      });

      await this.initializeFloorRun(sessionId, newFloorId, "regenerate_page", now);
      try {
      // ── 8. 构建 TurnInput + 执行编排 ──
      const sessionInfo = this.buildSessionPromptInfo(session, resolvedTurnModels);
      const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
      await this.trackFloorRunPhase(newFloorId, "semantic_resolved");
      await this.trackFloorRunPhase(newFloorId, "prechecked");
      const maxContextTokensOverride = this.resolveMaxContextTokensOverride(request.generationParams, narratorParams);

      const assembled = await assemblePrompt(
        this.db,
        accountId,
        sessionInfo,
        history,
        userMessage,
        this.tokenCounter,
        memorySummary,
        {
          maxContextTokensOverride,
          variableContext: { sessionId, branchId: targetFloor.branchId, floorId: newFloorId, pageId: userMessageRef.pageId },
        }
      );
      await this.trackFloorRunPhase(newFloorId, "prompt_assembled");

      const promptSnapshot = buildPromptSnapshotRecord({
        floorId: newFloorId,
        sessionId,
        snapshot: assembled.promptSnapshot,
      });

      const generationParams = this.buildGenerationParams({
        requestParams: request.generationParams,
        narratorParams,
        availableForReply: assembled.tokenUsage.availableForReply,
      });

      const requestedTurnConfig = this.resolveRequestedTurnConfig(request.config, resolvedTurnModels);
      const memoryConsolidationRequested = this.shouldRequestMemoryConsolidation(requestedTurnConfig);
      const turnConfig = this.toOrchestratorTurnConfig(requestedTurnConfig);
      const toolRuntime = await this.resolveTurnToolingForFloor({
        floorId: newFloorId,
        sessionId,
        accountId,
        config: turnConfig,
      });
      const consolidationContext = await this.buildConsolidationContext(
        sessionId,
        accountId,
        userMessage,
        turnConfig
      );

      const turnInput: TurnInput = {
        sessionId,
        branchId: targetFloor.branchId,
        floorId: newFloorId,
        pageId: userMessageRef.pageId,
        accountId,
        messages: assembled.messages,
        generationParams,
        config: turnConfig,
        consolidationContext,
        preProcess: assembled.preProcess,
        postProcess: assembled.postProcess,
        modelOverrides: this.buildModelOverrides(resolvedTurnModels),
        abortSignal: generationRuntime.abortSignal,
        generationParamsOverrides: this.buildGenerationParamsOverrides(resolvedTurnModels),
        runObserver: this.createTurnRunObserver(newFloorId),
        toolRegistry: toolRuntime.toolRegistry,
        toolPermissions: toolRuntime.toolPermissions,
      };

      const { execution, commit } = await this.executeTurnAndCommit({
        floorId: newFloorId,
        sessionId,
        branchId: targetFloor.branchId,
        accountId,
        turnInput,
        promptSnapshot,
        resolvedTurnModels,
        orchestrationFailureCode: "orchestration_failed",
        orchestrationFailureMessage: "Regeneration orchestration failed",
        commitFailureMessage: "Regeneration commit failed",
        memoryConsolidationRequested,
        persistMemory: this.memoryStore !== undefined,
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
      };
      } catch (error) {
        await this.tryMarkRunFailed(newFloorId, error, "regenerate_failed");
        throw error;
      }
    });

  }

  async retryFloor(
    floorId: string,
    request: RetryFloorRequest = {},
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID
  ): Promise<RetryFloorResult> {
    const [targetFloor] = await this.db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        floorNo: floors.floorNo,
        branchId: floors.branchId,
        state: floors.state,
      })
      .from(floors)
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(floors.id, floorId), eq(sessions.accountId, accountId)))
      .limit(1);

    if (!targetFloor) {
      throw new ChatServiceError("floor_not_found", `Floor '${floorId}' not found`);
    }

    if (targetFloor.state !== "failed") {
      throw new ChatServiceError(
        "invalid_state",
        `Floor '${floorId}' must be in failed state to retry`
      );
    }

    const session = await this.getSession(targetFloor.sessionId, accountId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${targetFloor.sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot retry in an archived session");
    }

    return this.runWithGenerationCoordinator(
      targetFloor.sessionId,
      targetFloor.branchId,
      undefined,
      async (generationRuntime) => {
        await this.assertRetryReplayConfirmed(targetFloor.id, request);

        const userMessageRef = await this.getUserMessageFromFloor(targetFloor.id);
        if (!userMessageRef) {
          throw new ChatServiceError("no_user_message", `No user message found in floor '${floorId}'`);
        }
        const userMessage = userMessageRef.content;

        const history = await this.historyLoader.loadHistoryBeforeFloor(
          targetFloor.sessionId,
          targetFloor.floorNo,
          targetFloor.branchId
        );
        const memorySummary = await this.retrieveMemorySummary(targetFloor.sessionId, accountId);
        const now = Date.now();
        const resolvedTurnModels = await this.resolveTurnModelsForSession(targetFloor.sessionId, accountId);
        this.assertNarratorSlotEnabled(resolvedTurnModels);

        this.db.transaction((tx) => {
          this.messagePersistence.clearOutputForRetry(tx, targetFloor.id);
          tx
            .update(floors)
            .set({ state: "draft", tokenIn: 0, tokenOut: 0, updatedAt: now })
            .where(eq(floors.id, targetFloor.id))
            .run();
        });

        await this.initializeFloorRun(targetFloor.sessionId, targetFloor.id, "retry_turn", now);
        await this.trackFloorRunPhase(targetFloor.id, "semantic_resolved");
        await this.trackFloorRunPhase(targetFloor.id, "prechecked");
        try {

        const sessionInfo = this.buildSessionPromptInfo(session, resolvedTurnModels);
        const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
        const maxContextTokensOverride = this.resolveMaxContextTokensOverride(request.generationParams, narratorParams);

        const assembled = await assemblePrompt(
          this.db,
          accountId,
          sessionInfo,
          history,
          userMessage,
          this.tokenCounter,
          memorySummary,
          {
            maxContextTokensOverride,
            variableContext: {
              sessionId: targetFloor.sessionId,
              branchId: targetFloor.branchId,
              floorId: targetFloor.id,
              pageId: userMessageRef.pageId,
            },
          }
        );
        await this.trackFloorRunPhase(targetFloor.id, "prompt_assembled");

        const promptSnapshot = buildPromptSnapshotRecord({
          floorId: targetFloor.id,
          sessionId: targetFloor.sessionId,
          snapshot: assembled.promptSnapshot,
        });

        const generationParams = this.buildGenerationParams({
          requestParams: request.generationParams,
          narratorParams,
          availableForReply: assembled.tokenUsage.availableForReply,
        });

        const requestedTurnConfig = this.resolveRequestedTurnConfig(request.config, resolvedTurnModels);
        const memoryConsolidationRequested = this.shouldRequestMemoryConsolidation(requestedTurnConfig);
        const turnConfig = this.toOrchestratorTurnConfig(requestedTurnConfig);
        const toolRuntime = await this.resolveTurnToolingForFloor({
          floorId: targetFloor.id,
          sessionId: targetFloor.sessionId,
          accountId,
          config: turnConfig,
        });
        const consolidationContext = await this.buildConsolidationContext(
          targetFloor.sessionId,
          accountId,
          userMessage,
          turnConfig
        );

        const turnInput: TurnInput = {
          sessionId: targetFloor.sessionId,
          branchId: targetFloor.branchId,
          floorId: targetFloor.id,
          pageId: userMessageRef.pageId,
          accountId,
          messages: assembled.messages,
          generationParams,
          config: turnConfig,
          consolidationContext,
          preProcess: assembled.preProcess,
          postProcess: assembled.postProcess,
          modelOverrides: this.buildModelOverrides(resolvedTurnModels),
          generationParamsOverrides: this.buildGenerationParamsOverrides(resolvedTurnModels),
          abortSignal: generationRuntime.abortSignal,
          runObserver: this.createTurnRunObserver(targetFloor.id),
          toolRegistry: toolRuntime.toolRegistry,
          toolPermissions: toolRuntime.toolPermissions,
        };

        const { execution, commit } = await this.executeTurnAndCommit({
          floorId: targetFloor.id,
          sessionId: targetFloor.sessionId,
          branchId: targetFloor.branchId,
          accountId,
          turnInput,
          promptSnapshot,
          resolvedTurnModels,
          orchestrationFailureCode: "orchestration_failed",
          orchestrationFailureMessage: "Retry orchestration failed",
          persistMemory: this.memoryStore !== undefined,
          memoryConsolidationRequested,
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
        };
        } catch (error) {
          await this.tryMarkRunFailed(targetFloor.id, error, "retry_turn_failed");
          throw error;
        }
      }
    );

  }

  async editAndRegenerate(
    messageId: string,
    request: EditAndRegenerateRequest,
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID
  ): Promise<EditAndRegenerateResult> {
    const source = await this.resolveEditableMessage(messageId, accountId);

    const session = await this.getSession(source.sessionId, accountId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${source.sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot edit message in an archived session");
    }

    const newBranchId = request.branchId ? normalizeBranchId(request.branchId) : `branch-${nanoid(8)}`;

    return this.runWithGenerationCoordinator(source.sessionId, newBranchId, undefined, async (generationRuntime) => {
      const [branchExists] = await this.db
        .select({ id: floors.id })
        .from(floors)
        .where(and(eq(floors.sessionId, source.sessionId), eq(floors.branchId, newBranchId)))
        .limit(1);

      if (branchExists) {
        throw new ChatServiceError(
          "branch_exists",
          `Branch '${newBranchId}' already exists in session '${source.sessionId}'`
        );
      }

      const history = await this.historyLoader.loadHistoryBeforeFloor(
        source.sessionId,
        source.floorNo,
        source.branchId
      );

      const now = Date.now();
      const newFloorId = nanoid();
      const { userMessageRef } = this.createDraftFloorWithUserMessage({
        floorId: newFloorId,
        sessionId: source.sessionId,
        floorNo: source.floorNo + 1,
        branchId: newBranchId,
        parentFloorId: source.floorId,
        userMessage: request.content,
        userId: session.userId,
        userSnapshotJson: session.userSnapshotJson,
        now,
      });

      const response = await this.generateForFloor({
        floorId: newFloorId,
        session,
        branchId: newBranchId,
        sessionId: source.sessionId,
        userMessage: request.content,
        userMessageRef,
        history,
        request,
        accountId,
        abortSignal: generationRuntime.abortSignal,
        runType: "edit_and_regenerate",
      });

      return {
        ...response,
        sourceFloorId: source.floorId,
        sourceMessageId: source.messageId,
      };
    });

  }

  // ── 私有方法 ────────────────────────────────────────

  private async runWithGenerationCoordinator<T>(
    sessionId: string,
    branchId: string,
    abortSignal: AbortSignal | undefined,
    task: (runtime: CoordinatorRuntime) => Promise<T>
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

  private async executeTurnAndCommit(args: {
    floorId: string;
    sessionId: string;
    branchId?: string;
    accountId: string;
    turnInput: TurnInput;
    promptSnapshot?: ReturnType<typeof buildPromptSnapshotRecord>;
    resolvedTurnModels: ResolvedTurnModels;
    orchestrationFailureCode: string;
    orchestrationFailureMessage: string;
    persistMemory: boolean;
    memoryConsolidationRequested: boolean;
    commitFailureMessage: string;
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
        await this.tryMarkRunFailed(args.floorId, replayBlockedError, "tool_replay_blocked");
        await this.tryMarkFloorFailed(args.floorId, replayBlockedError);
        throw new ChatServiceError(
          "tool_replay_blocked",
          replayBlockedError.message,
          error,
          {
            blocking_executions: replayBlockedError.blockingExecutions.map((execution) =>
              this.toReplayBlockingExecutionDetailFromBlockedError(execution)),
          },
        );
      }

      const unsupportedToolModeError = findErrorByConstructor(error, UnsupportedToolModeError);
      if (unsupportedToolModeError) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
        await this.tryMarkRunFailed(args.floorId, unsupportedToolModeError, "invalid_tool_mode");
        await this.tryMarkFloorFailed(args.floorId, unsupportedToolModeError);
        throw new ChatServiceError(
          "invalid_tool_mode",
          unsupportedToolModeError.message,
          error,
        );
      }

      const timeoutError = findErrorByConstructor(error, LLMTimeoutError);
      if (timeoutError) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
        await this.tryMarkRunFailed(args.floorId, timeoutError, "generation_timeout");
        await this.tryMarkFloorFailed(args.floorId, timeoutError);
        throw new ChatServiceError(
          "generation_timeout",
          `${args.orchestrationFailureMessage}: ${timeoutError.message}`,
          error
        );
      }

      await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
      await this.tryMarkRunFailed(args.floorId, error, args.orchestrationFailureCode);
      throw new ChatServiceError(
        args.orchestrationFailureCode,
        `${args.orchestrationFailureMessage}: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }

    await this.trackFloorRunPhase(args.floorId, "transaction_prepared");

    const commitInput = {
      accountId: args.accountId,
      floorId: args.floorId,
      sessionId: args.sessionId,
      execution,
      variableCommit: {
        pageId: turnInput.pageId,
      },
      promptSnapshot: args.promptSnapshot,
      toolExecutionRecords: execution.toolExecutionRecords,
      pendingToolJobs: execution.pendingToolJobs,
      memoryCommit: args.persistMemory
        ? {
            enableConsolidation: args.memoryConsolidationRequested,
            summaries: execution.summaries,
            consolidationOutput: execution.consolidationResult?.output,
          }
        : undefined,
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
        }
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
        await this.tryMarkRunFailed(args.floorId, error, "commit_busy");
        await this.tryMarkFloorFailed(args.floorId, error);
        throw new ChatServiceError(
          "commit_busy",
          `${args.commitFailureMessage}: ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }

      if (error instanceof FloorNotFoundError) {
        await this.tryMarkRunFailed(args.floorId, error, "floor_not_found");
        throw new ChatServiceError("floor_not_found", `Floor '${args.floorId}' not found`, error);
      }

      if (error instanceof FloorStateConflictError) {
        await this.tryMarkRunFailed(args.floorId, error, "commit_conflict");
        throw new ChatServiceError("commit_conflict", `${args.commitFailureMessage}: ${error.message}`, error);
      }

      if (!(error instanceof FloorStateConflictError) && !(error instanceof FloorNotFoundError)) {
        await this.tryMarkRunFailed(args.floorId, error, "turn_commit_failed");
        await this.tryMarkFloorFailed(args.floorId, error);
      }

      throw new ChatServiceError(
        "turn_commit_failed",
        `${args.commitFailureMessage}: ${error instanceof Error ? error.message : String(error)}`,
        error
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

    await this.markTurnModelUsed(args.resolvedTurnModels, args.accountId);

    return { execution, commit };
  }

  private async markToolExecutionRunOutcome(
    runId: string,
    outcome: ToolExecutionCommitOutcome,
  ): Promise<void> {
    try {
      await this.toolExecutionRepository.markRunCommitOutcome(runId, outcome);
    } catch {
      // 执行日志本体已经先行落库；失败边界上的归宿更新保持 best-effort，
      // 避免覆盖原始业务错误。
    }
  }

  private async initializeFloorRun(
    sessionId: string,
    floorId: string,
    runType: FloorRunType,
    startedAt = Date.now(),
  ): Promise<void> {
    try {
      await this.floorRunService?.initializeRun({
        sessionId,
        floorId,
        runType,
        startedAt,
      });
    } catch {
      // best-effort run tracking
    }
  }

  private async trackFloorRunPhase(
    floorId: string,
    phase: "input_recorded" | "semantic_resolved" | "prechecked" | "prompt_assembled" | "page_generating" | "candidate_generated" | "verifier_checked" | "transaction_prepared" | "transaction_committed" | "post_commit_scheduled",
    attemptNo?: number,
  ): Promise<void> {
    try {
      await this.floorRunService?.advancePhase(floorId, phase, attemptNo !== undefined ? { attemptNo } : {});
    } catch {
      // best-effort run tracking
    }
  }

  private async trackFloorRunPendingOutput(
    floorId: string,
    input: {
      text: string;
      state: "draft" | "streaming" | "generated" | "failed";
      attemptNo: number;
      force?: boolean;
      error?: string;
    },
  ): Promise<void> {
    try {
      await this.floorRunService?.updatePendingOutput(floorId, input);
    } catch {
      // best-effort run tracking
    }
  }

  private async trackFloorRunVerifier(
    floorId: string,
    input: {
      status: "pending" | "passed" | "warned" | "blocked" | "skipped";
      suggestion?: string;
      issues?: Array<{ description: string; severity: "warning" | "error" }>;
    },
  ): Promise<void> {
    try {
      await this.floorRunService?.updateVerifier(floorId, input);
    } catch {
      // best-effort run tracking
    }
  }

  private createTurnRunObserver(floorId: string): TurnRunObserver {
    return {
      onPhaseChange: ({ phase, attemptNo }) => this.trackFloorRunPhase(floorId, phase, attemptNo),
      onPendingOutputUpdate: (input) => this.trackFloorRunPendingOutput(floorId, input),
      onVerifierResult: (input) => this.trackFloorRunVerifier(floorId, input),
    };
  }

  private async tryMarkRunFailed(floorId: string, error: unknown, code = "floor_run_failed"): Promise<void> {
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    try {
      await this.floorRunService?.markFailed(floorId, { code, message: normalizedError.message });
    } catch {
      // best-effort run tracking
    }
  }

  private async assertRetryReplayConfirmed(
    floorId: string,
    request: RetryFloorRequest,
  ): Promise<void> {
    const blockingExecutions = await this.listReplayBlockingExecutionsForFloor(floorId);
    if (blockingExecutions.length === 0) {
      return;
    }

    const confirmedExecutionIds = new Set(request.confirmedExecutionIds ?? []);
    const missingConfirmations = blockingExecutions.filter(
      (execution) => !confirmedExecutionIds.has(execution.execution_id),
    );

    if (missingConfirmations.length === 0) {
      return;
    }

    throw new ChatServiceError(
      "tool_replay_confirmation_required",
      `Retry requires explicit confirmation for ${missingConfirmations.length} prior tool execution(s).`,
      undefined,
      {
        blocking_executions: blockingExecutions,
      },
    );
  }

  private async listReplayBlockingExecutionsForFloor(
    floorId: string,
  ): Promise<ReplayBlockingExecutionDetail[]> {
    const executionRecords = await this.toolExecutionRepository.findByFloorId(floorId);
    return executionRecords
      .map((record) => this.toReplayBlockingExecutionDetail(record))
      .filter((record): record is ReplayBlockingExecutionDetail => record !== null);
  }

  private toReplayBlockingExecutionDetail(
    record: ExecutedToolCallRecord,
  ): ReplayBlockingExecutionDetail | null {
    const evaluation = evaluateExecutedToolCallReplaySafety(record);
    if (isAutoReplaySafe(evaluation.replaySafety)) {
      return null;
    }

    return {
      execution_id: record.id,
      tool_name: record.toolName,
      provider_id: record.providerId,
      provider_type: record.providerType ?? null,
      side_effect_level: record.sideEffectLevel ?? null,
      status: record.status,
      lifecycle_state: record.lifecycleState ?? null,
      replay_safety: evaluation.replaySafety,
      reason: evaluation.reason,
      ...(record.errorMessage ? { error_message: record.errorMessage } : {}),
    };
  }

  private toReplayBlockingExecutionDetailFromBlockedError(
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

  private async tryMarkFloorFailed(floorId: string, error: unknown): Promise<void> {
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    try {
      await this.floorStateMachine.fail(floorId, normalizedError);
    } catch {
      // 提交失败后的补偿标记是 best-effort，避免覆盖原始错误。
    }
  }

  private async emitBestEffortEvent<K extends keyof CoreEventMap>(
    name: K,
    payload: CoreEventMap[K]
  ): Promise<void> {
    try {
      await this.eventBus.emit(name, payload as never);
    } catch {
      // 观测类事件不应反向影响主流程。
    }
  }

  private subscribeFloorRunEvents(floorId: string, runtimeOptions: RespondRuntimeOptions): () => void {
    if (!runtimeOptions.onRun) {
      return () => {};
    }

    const forward = (event: CoreEventMap["floor.run.updated"] | CoreEventMap["floor.run.completed"] | CoreEventMap["floor.run.failed"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      runtimeOptions.onRun?.(event);
    };

    const handleUpdated = (event: CoreEventMap["floor.run.updated"]) => {
      forward(event);
    };

    const handleCompleted = (event: CoreEventMap["floor.run.completed"]) => {
      forward(event);
    };

    const handleFailed = (event: CoreEventMap["floor.run.failed"]) => {
      forward(event);
    };

    this.eventBus.on("floor.run.updated", handleUpdated);
    this.eventBus.on("floor.run.completed", handleCompleted);
    this.eventBus.on("floor.run.failed", handleFailed);

    return () => {
      this.eventBus.off("floor.run.updated", handleUpdated);
      this.eventBus.off("floor.run.completed", handleCompleted);
      this.eventBus.off("floor.run.failed", handleFailed);
    };
  }

  private subscribeRuntimeToolEvents(floorId: string, runtimeOptions: RespondRuntimeOptions): () => void {
    if (!runtimeOptions.onTool) {
      return () => {};
    }

    const handleStarted = (event: CoreEventMap["tool.call_started"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      runtimeOptions.onTool?.(this.toRespondRuntimeToolEvent({
        executionId: event.executionId,
        toolName: event.toolName,
        providerId: event.providerId,
        providerType: event.providerType,
        sideEffectLevel: event.sideEffectLevel,
        status: "running",
        lifecycleState: "opened",
      }));
    };

    const handleCompleted = (event: CoreEventMap["tool.call_completed"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      runtimeOptions.onTool?.(this.toRespondRuntimeToolEvent({
        executionId: event.executionId,
        toolName: event.toolName,
        providerId: event.providerId,
        providerType: event.providerType,
        sideEffectLevel: event.sideEffectLevel,
        status: event.status,
        lifecycleState: "finished",
        durationMs: event.durationMs,
      }));
    };

    const handleFailed = (event: CoreEventMap["tool.call_failed"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      runtimeOptions.onTool?.(this.toRespondRuntimeToolEvent({
        executionId: event.executionId,
        toolName: event.toolName,
        providerId: event.providerId,
        providerType: event.providerType,
        sideEffectLevel: event.sideEffectLevel,
        status: event.status,
        lifecycleState: "finished",
        message: event.error.message,
        durationMs: event.durationMs,
      }));
    };

    const handleDenied = (event: CoreEventMap["tool.call_denied"]) => {
      if (event.floorId !== floorId) {
        return;
      }

      runtimeOptions.onTool?.(this.toRespondRuntimeToolEvent({
        executionId: event.executionId,
        toolName: event.toolName,
        providerId: event.providerId,
        providerType: event.providerType,
        sideEffectLevel: event.sideEffectLevel,
        status: event.status,
        lifecycleState: "finished",
        message: `Tool call denied: ${event.reason}`,
      }));
    };

    this.eventBus.on("tool.call_started", handleStarted);
    this.eventBus.on("tool.call_completed", handleCompleted);
    this.eventBus.on("tool.call_failed", handleFailed);
    this.eventBus.on("tool.call_denied", handleDenied);

    return () => {
      this.eventBus.off("tool.call_started", handleStarted);
      this.eventBus.off("tool.call_completed", handleCompleted);
      this.eventBus.off("tool.call_failed", handleFailed);
      this.eventBus.off("tool.call_denied", handleDenied);
    };
  }

  private toRespondRuntimeToolEvent(input: {
    executionId: string;
    toolName: string;
    providerId: string;
    providerType?: string;
    sideEffectLevel?: string;
    status: "running" | CoreEventMap["tool.call_completed"]["status"] | CoreEventMap["tool.call_failed"]["status"] | CoreEventMap["tool.call_denied"]["status"];
    lifecycleState: "opened" | "finished";
    message?: string;
    durationMs?: number;
  }): RespondRuntimeToolEvent {
    const evaluation = evaluateToolReplaySafety({
      providerId: input.providerId,
      providerType: input.providerType as ExecutedToolCallRecord["providerType"],
      toolName: input.toolName,
      sideEffectLevel: input.sideEffectLevel as ExecutedToolCallRecord["sideEffectLevel"],
      status: input.status,
      lifecycleState: input.lifecycleState,
    });

    return {
      executionId: input.executionId,
      toolName: input.toolName,
      providerId: input.providerId,
      providerType: input.providerType,
      sideEffectLevel: input.sideEffectLevel,
      phase: input.status === "running" ? "start" : input.status,
      ...(input.message ? { message: input.message } : {}),
      ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}),
      replaySafety: evaluation.replaySafety,
    };
  }

  private async getSession(sessionId: string, accountId: string = DEFAULT_ADMIN_ACCOUNT_ID) {
    return new OwnedSessionRepository(this.db).getById(accountId, sessionId);
  }

  private async resolveEditableMessage(
    messageId: string,
    accountId: string
  ): Promise<{
    messageId: string;
    floorId: string;
    floorNo: number;
    branchId: string;
    sessionId: string;
  }> {
    const row = new OwnedMessageRepository(this.db).getContextById(accountId, messageId);

    if (!row) {
      throw new ChatServiceError("message_not_found", `Message '${messageId}' not found`);
    }

    if (row.role !== "user") {
      throw new ChatServiceError("invalid_message_role", "Only user messages can be edited");
    }

    if (row.pageKind !== "input" || !row.pageIsActive) {
      throw new ChatServiceError(
        "invalid_message_scope",
        "Target message must belong to an active input page"
      );
    }

    if (row.floorState !== "committed") {
      throw new ChatServiceError(
        "invalid_state",
        "Target message must belong to a committed floor"
      );
    }

    return {
      messageId: row.id,
      floorId: row.floorId,
      floorNo: row.floorNo,
      branchId: row.branchId,
      sessionId: row.sessionId,
    };
  }

  private async generateForFloor(args: {
    floorId: string;
    sessionId: string;
    branchId?: string;
    session: typeof sessions.$inferSelect;
    userMessage: string;
    userMessageRef: PersistedMessageRef;
    history: ChatMessage[];
    request: RetryFloorRequest;
    accountId: string;
    abortSignal?: AbortSignal;
    runType: FloorRunType;
  }): Promise<RetryFloorResult> {
    const memorySummary = await this.retrieveMemorySummary(args.sessionId, args.accountId);
    await this.initializeFloorRun(args.sessionId, args.floorId, args.runType);
    try {

    const resolvedTurnModels = await this.resolveTurnModelsForSession(args.sessionId, args.accountId);
    this.assertNarratorSlotEnabled(resolvedTurnModels);
    const sessionInfo = this.buildSessionPromptInfo(args.session, resolvedTurnModels);
    const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
    await this.trackFloorRunPhase(args.floorId, "semantic_resolved");
    await this.trackFloorRunPhase(args.floorId, "prechecked");
    const maxContextTokensOverride = this.resolveMaxContextTokensOverride(args.request.generationParams, narratorParams);

    const assembled = await assemblePrompt(
      this.db,
      args.accountId,
      sessionInfo,
      args.history,
      args.userMessage,
      this.tokenCounter,
      memorySummary,
      {
        maxContextTokensOverride,
        variableContext: {
          sessionId: args.sessionId,
          branchId: args.branchId,
          floorId: args.floorId,
          pageId: args.userMessageRef.pageId,
        },
      }
    );
    await this.trackFloorRunPhase(args.floorId, "prompt_assembled");

    const promptSnapshot = buildPromptSnapshotRecord({
      floorId: args.floorId,
      sessionId: args.sessionId,
      snapshot: assembled.promptSnapshot,
    });

    const generationParams = this.buildGenerationParams({
      requestParams: args.request.generationParams,
      narratorParams,
      availableForReply: assembled.tokenUsage.availableForReply,
    });

    const requestedTurnConfig = this.resolveRequestedTurnConfig(args.request.config, resolvedTurnModels);
    const memoryConsolidationRequested = this.shouldRequestMemoryConsolidation(requestedTurnConfig);
    const turnConfig = this.toOrchestratorTurnConfig(requestedTurnConfig);
    const toolRuntime = await this.resolveTurnToolingForFloor({
      floorId: args.floorId,
      sessionId: args.sessionId,
      accountId: args.accountId,
      config: turnConfig,
    });
    const consolidationContext = await this.buildConsolidationContext(
      args.sessionId,
      args.accountId,
      args.userMessage,
      turnConfig
    );

    const turnInput: TurnInput = {
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.userMessageRef.pageId,
      accountId: args.accountId,
      messages: assembled.messages,
      generationParams,
      config: turnConfig,
      consolidationContext,
      abortSignal: args.abortSignal,
      preProcess: assembled.preProcess,
      postProcess: assembled.postProcess,
      modelOverrides: this.buildModelOverrides(resolvedTurnModels),
      generationParamsOverrides: this.buildGenerationParamsOverrides(resolvedTurnModels),
      toolRegistry: toolRuntime.toolRegistry,
      runObserver: this.createTurnRunObserver(args.floorId),
      toolPermissions: toolRuntime.toolPermissions,
    };

    const { execution, commit } = await this.executeTurnAndCommit({
      floorId: args.floorId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      accountId: args.accountId,
      turnInput,
      promptSnapshot,
      resolvedTurnModels,
      orchestrationFailureCode: "orchestration_failed",
      orchestrationFailureMessage: "Turn orchestration failed",
      commitFailureMessage: "Turn commit failed",
      memoryConsolidationRequested,
      persistMemory: this.memoryStore !== undefined,
    });

    const [floorRow] = await this.db
      .select({ floorNo: floors.floorNo, branchId: floors.branchId })
      .from(floors)
      .where(eq(floors.id, args.floorId))
      .limit(1);

    if (!floorRow) {
      throw new ChatServiceError("floor_not_found", `Floor '${args.floorId}' not found`);
    }

    return {
      floorId: args.floorId,
      floorNo: floorRow.floorNo,
      branchId: floorRow.branchId,
      generatedText: execution.generatedText,
      summaries: execution.summaries,
      totalUsage: commit.usage,
      memory: commit.memory,
      finalState: commit.finalState,
    };
    } catch (error) {
      await this.tryMarkRunFailed(args.floorId, error, "generate_for_floor_failed");
      throw error;
    }
  }

  private createDraftFloorWithUserMessage(args: {
    floorId?: string;
    sessionId: string;
    floorNo: number;
    branchId: string;
    parentFloorId: string | null;
    userMessage: string;
    userId: string | null;
    userSnapshotJson: string | null;
    now: number;
    prepare?: (tx: DbExecutor) => void;
  }): { floorId: string; userMessageRef: PersistedMessageRef } {
    const floorId = args.floorId ?? nanoid();
    const floorMetadataJson = buildFloorMetadataJson(args.userId, args.userSnapshotJson, args.now);

    const userMessageRef = this.db.transaction((tx) => {
      args.prepare?.(tx);

      tx.insert(floors).values({
        id: floorId,
        sessionId: args.sessionId,
        floorNo: args.floorNo,
        branchId: args.branchId,
        parentFloorId: args.parentFloorId,
        state: "draft",
        metadataJson: floorMetadataJson,
        tokenIn: 0,
        tokenOut: 0,
        createdAt: args.now,
        updatedAt: args.now,
      }).run();

      return this.messagePersistence.saveUserMessageWithExecutor(tx, floorId, args.userMessage, args.now);
    });

    return { floorId, userMessageRef };
  }

  private buildSessionPromptInfo(
    session: Pick<
      typeof sessions.$inferSelect,
      | "presetId"
      | "worldbookProfileId"
      | "regexProfileId"
      | "metadataJson"
      | "characterSnapshotJson"
      | "promptMode"
      | "userSnapshotJson"
    >,
    resolvedTurnModels: ResolvedTurnModels,
  ): SessionPromptInfo {
    return {
      presetId: resolvedTurnModels.narrator?.presetId ?? session.presetId,
      worldbookProfileId: session.worldbookProfileId,
      regexProfileId: session.regexProfileId,
      metadataJson: session.metadataJson,
      characterSnapshotJson: session.characterSnapshotJson,
      promptMode: session.promptMode,
      userSnapshotJson: session.userSnapshotJson,
    };
  }

  private isSlotDisabled(models: ResolvedTurnModels, slot: InstanceSlot): boolean {
    return models[slot]?.enabled === false;
  }

  private assertNarratorSlotEnabled(models: ResolvedTurnModels): void {
    if (this.isSlotDisabled(models, "narrator")) {
      throw new ChatServiceError(
        "instance_slot_disabled_required",
        "LLM instance slot 'narrator' is disabled for this session",
      );
    }
  }

  private buildGenerationParams(args: {
    requestParams?: Partial<GenerationParams>;
    narratorParams?: Partial<GenerationParams>;
    availableForReply: number;
    stream?: boolean;
  }): GenerationParams {
    const narratorParams = this.stripMaxContextTokens(args.narratorParams);
    const requestParams = this.stripMaxContextTokens(args.requestParams);
    const timeoutMs = normalizePositiveInt(requestParams?.timeoutMs)
      ?? normalizePositiveInt(narratorParams?.timeoutMs)
      ?? this.executionPolicy.executionTimeoutMs;
    const maxRetries = normalizeNonNegativeInt(requestParams?.maxRetries)
      ?? normalizeNonNegativeInt(narratorParams?.maxRetries);

    return {
      temperature: 0.7,
      maxOutputTokens: args.availableForReply || 1000,
      ...(args.stream !== undefined ? { stream: args.stream } : {}),
      ...narratorParams,
      ...requestParams,
      timeoutMs,
      ...(maxRetries !== undefined ? { maxRetries } : {}),
    };
  }

  private resolveMaxContextTokensOverride(
    requestParams?: Partial<GenerationParams>,
    narratorParams?: Partial<GenerationParams>,
  ): number | undefined {
    return normalizePositiveInt(requestParams?.maxContextTokens)
      ?? normalizePositiveInt(narratorParams?.maxContextTokens);
  }

  /**
   * 从 MemoryStore 检索可注入的记忆上下文。
   * 如果未配置 MemoryStore 或无可用记忆，返回 undefined。
   */
  private async retrieveMemorySummary(
    sessionId: string,
    accountId: string,
  ): Promise<string | undefined> {
    if (!this.memoryStore) return undefined;

    try {
      const injection = await this.memoryStore.prepareInjection(
        sessionId,
        this.enableDualSummaryInjection
          ? {
              accountId,
              maxTokens: 500,
              maxItems: 24,
              minImportance: 0.35,
              includeTypes: ["open_loop", "fact", "summary"],
              strategy: "dual_summary",
              decay: this.memoryInjectionDecay,
            }
          : {
              accountId,
              maxTokens: 500,
              maxItems: 24,
              minImportance: 0.35,
              includeTypes: ["open_loop", "fact", "summary"],
              selectionMode: "balanced",
              typeOrder: ["open_loop", "fact", "summary"],
              typeMaxItems: { open_loop: 6, fact: 10, summary: 8 },
              decay: this.memoryInjectionDecay,
            },
      );

      // 保持向下兼容：上层字段名仍为 memorySummary。
      return injection.formattedText || undefined;
    } catch (error) {
      // 记忆检索失败不应阻断聊天流程
      await this.emitBestEffortEvent("memory.injection_failed", {
        sessionId,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      return undefined;
    }
  }

  /**
   * 解析当前会话的工具权限。
   *
   * 优先级：外部注入的 resolveToolPermissions → session metadata_json → undefined。
   * 如果 ToolRegistry 未配置则直接返回 undefined。
   */
  private async resolveToolPermissionsForSession(
    sessionId: string,
    accountId: string,
  ): Promise<ToolPermissions | undefined> {
    if (!this.toolRegistry && !this.sessionToolRegistryService) return undefined;

    // 外部解析器
    if (this.resolveToolPermissions) {
      const permissions = await this.resolveToolPermissions(sessionId, accountId);
      if (permissions) return permissions;
    }

    // 从 session metadata_json 读取
    try {
      const [session] = await this.db
        .select({ metadataJson: sessions.metadataJson })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (session?.metadataJson) {
        const metadata = JSON.parse(session.metadataJson) as Record<string, unknown>;
        if (metadata.tool_permissions && typeof metadata.tool_permissions === 'object') {
          return metadata.tool_permissions as ToolPermissions;
        }
      }
    } catch {
      // JSON 解析失败时返回 undefined
    }

    return undefined;
  }

  private async resolveTurnToolingForFloor(args: {
    floorId: string;
    sessionId: string;
    accountId: string;
    config?: TurnConfig;
  }): Promise<{ toolRegistry?: ToolRegistry; toolPermissions?: ToolPermissions }> {
    if (args.config?.enableTools !== true) {
      return {};
    }

    try {
      return {
        toolRegistry: await this.resolveToolRegistryForSession(args.sessionId, args.accountId, args.config),
        toolPermissions: await this.resolveToolPermissionsForSession(args.sessionId, args.accountId),
      };
    } catch (error) {
      await this.tryMarkFloorFailed(args.floorId, error);
      throw error;
    }
  }

  private async resolveToolRegistryForSession(
    sessionId: string,
    accountId: string,
    config?: TurnConfig,
  ): Promise<ToolRegistry | undefined> {
    if (config?.enableTools !== true) {
      return undefined;
    }

    if (!this.sessionToolRegistryService) {
      return this.toolRegistry;
    }

    try {
      const runtime = await this.sessionToolRegistryService.buildRuntime(sessionId, accountId);
      return runtime.registry;
    } catch (error) {
      if (error instanceof SessionToolRegistryServiceError) {
        throw new ChatServiceError(error.code, error.message, error);
      }

      throw error;
    }
  }

  private async resolveTurnModelForSession(sessionId: string, accountId: string): Promise<ResolvedTurnModel | undefined> {
    if (!this.resolveTurnModel && !this.resolveTurnModels) {
      return undefined;
    }
    // 如果有多 slot 解析器，取 narrator slot 作为兼容返回
    if (this.resolveTurnModels) {
      const models = await this.resolveTurnModels(sessionId, accountId);
      return models.narrator?.model ? models.narrator : undefined;
    }
    return (await this.resolveTurnModel!(sessionId, accountId)) ?? undefined;
  }

  private async resolveTurnModelsForSession(sessionId: string, accountId: string): Promise<ResolvedTurnModels> {
    if (this.resolveTurnModels) {
      return this.resolveTurnModels(sessionId, accountId);
    }
    // 向后兼容：旧 resolveTurnModel 只解析 narrator
    if (this.resolveTurnModel) {
      const resolved = await this.resolveTurnModel(sessionId, accountId);
      if (resolved) {
        return { narrator: resolved };
      }
    }
    return {};
  }

  private async markTurnModelUsed(model: ResolvedTurnModel | undefined, accountId: string): Promise<void>;
  private async markTurnModelUsed(model: ResolvedTurnModels, accountId: string): Promise<void>;
  private async markTurnModelUsed(
    model: ResolvedTurnModel | ResolvedTurnModels | undefined,
    accountId: string
  ): Promise<void> {
    if (!model || !this.onTurnModelUsed) {
      return;
    }
    try {
      if ('model' in model && 'source' in model) {
        // Single ResolvedTurnModel
        await this.onTurnModelUsed(model as ResolvedTurnModel, accountId);
      } else {
        // ResolvedTurnModels – mark each unique profile
        const seen = new Set<string>();
        for (const resolved of Object.values(model as ResolvedTurnModels)) {
          if (resolved && resolved.enabled !== false && resolved.profileId && !seen.has(resolved.profileId)) {
            seen.add(resolved.profileId);
            await this.onTurnModelUsed(resolved, accountId);
          }
        }
      }
    } catch {
      // 记录 last_used_at 失败不应阻断聊天流程。
    }
  }

  /**
   * 从多 slot 解析结果构建 TurnInput.modelOverrides。
   */
  private buildModelOverrides(
    models: ResolvedTurnModels,
  ): Partial<Record<InstanceSlot, ModelConfig>> | undefined {
    const entries = (Object.entries(models) as [InstanceSlot, ResolvedTurnModel][])
      .filter(([, resolved]) => resolved.model !== undefined);
    if (entries.length === 0) return undefined;

    const overrides: Partial<Record<InstanceSlot, ModelConfig>> = {};
    for (const [slot, resolved] of entries) {
      if (!resolved.model) continue;
      overrides[slot] = resolved.model;
    }
    return overrides;
  }

  private buildGenerationParamsOverrides(
    models: ResolvedTurnModels,
  ): Partial<Record<InstanceSlot, GenerationParams>> | undefined {
    const overrides: Partial<Record<InstanceSlot, GenerationParams>> = {};

    (Object.entries(models) as [InstanceSlot, ResolvedTurnModel][]).forEach(([slot, resolved]) => {
      if (slot === "narrator") {
        return;
      }

      if (resolved.enabled === false) {
        return;
      }

      const params = this.stripMaxContextTokens(resolved.generationParams);
      if (!params || Object.keys(params).length === 0) {
        return;
      }

      overrides[slot] = params;
    });

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  private getSlotGenerationParams(
    models: ResolvedTurnModels,
    slot: InstanceSlot,
  ): Partial<GenerationParams> | undefined {
    if (models[slot]?.enabled === false) {
      return undefined;
    }

    return models[slot]?.generationParams;
  }

  private stripMaxContextTokens(
    params?: Partial<GenerationParams>,
  ): Partial<GenerationParams> | undefined {
    if (!params) {
      return undefined;
    }

    const { maxContextTokens: _, ...rest } = params;
    return rest;
  }

  private resolveRequestedTurnConfig(
    config: TurnConfig | undefined,
    models: ResolvedTurnModels,
  ): TurnConfig | undefined {
    let nextConfig = config;

    if (!this.memoryStore) {
      if (this.isSlotDisabled(models, "director") && nextConfig?.enableDirector) {
        nextConfig = { ...nextConfig, enableDirector: false };
      }
      if (this.isSlotDisabled(models, "verifier") && nextConfig?.enableVerifier) {
        nextConfig = { ...nextConfig, enableVerifier: false };
      }
      return nextConfig;
    }

    if (nextConfig?.enableMemoryConsolidation !== undefined) {
      if (this.isSlotDisabled(models, "director") && nextConfig.enableDirector) {
        nextConfig = { ...nextConfig, enableDirector: false };
      }
      if (this.isSlotDisabled(models, "verifier") && nextConfig.enableVerifier) {
        nextConfig = { ...nextConfig, enableVerifier: false };
      }
      if (this.isSlotDisabled(models, "memory") && nextConfig.enableMemoryConsolidation) {
        nextConfig = { ...nextConfig, enableMemoryConsolidation: false };
      }
      return nextConfig;
    }

    if (!this.enableMemoryConsolidationByDefault) {
      if (this.isSlotDisabled(models, "director") && nextConfig?.enableDirector) {
        nextConfig = { ...nextConfig, enableDirector: false };
      }
      if (this.isSlotDisabled(models, "verifier") && nextConfig?.enableVerifier) {
        nextConfig = { ...nextConfig, enableVerifier: false };
      }
      return nextConfig;
    }

    nextConfig = { ...nextConfig, enableMemoryConsolidation: true };
    if (this.isSlotDisabled(models, "director") && nextConfig.enableDirector) {
      nextConfig.enableDirector = false;
    }
    if (this.isSlotDisabled(models, "verifier") && nextConfig.enableVerifier) {
      nextConfig.enableVerifier = false;
    }
    if (this.isSlotDisabled(models, "memory")) {
      nextConfig.enableMemoryConsolidation = false;
    }

    return nextConfig;
  }

  private shouldRequestMemoryConsolidation(config?: TurnConfig): boolean {
    return config?.enableMemoryConsolidation === true;
  }

  private toOrchestratorTurnConfig(config?: TurnConfig): TurnConfig | undefined {
    if (!this.enableAsyncMemoryIngest || !config?.enableMemoryConsolidation) {
      return config;
    }

    return {
      ...config,
      enableMemoryConsolidation: false,
    };
  }

  private async buildConsolidationContext(
    sessionId: string,
    accountId: string,
    currentFloorContent: string,
    config?: TurnConfig,
  ): Promise<TurnInput["consolidationContext"] | undefined> {
    if (!this.memoryStore) {
      return undefined;
    }

    if (config?.enableMemoryConsolidation !== true) {
      return undefined;
    }

    const normalizedContent = currentFloorContent.trim();
    if (!normalizedContent) {
      return undefined;
    }

    try {
      const [recentSummaryItems, existingFacts] = await Promise.all([
        this.memoryStore.query({
          scope: "chat",
          scopeId: sessionId,
          accountId,
          type: "summary",
          status: "active",
          lifecycleStatus: "active",
          orderBy: "updatedAt",
          orderDir: "desc",
          limit: 20,
        }),
        this.memoryStore.query({
          scope: "chat",
          scopeId: sessionId,
          accountId,
          type: "fact",
          status: "active",
          lifecycleStatus: "active",
          orderBy: "importance",
          orderDir: "desc",
          limit: 50,
        }),
      ]);

      return {
        currentFloorContent: normalizedContent,
        recentSummaries: recentSummaryItems.map((item) => item.content).filter((item) => item.trim().length > 0),
        existingFacts,
      };
    } catch (error) {
      await this.emitBestEffortEvent("memory.consolidation_context_failed", {
        sessionId,
        scope: "chat",
        scopeId: sessionId,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      return undefined;
    }
  }

  /**
   * 从指定楼层中提取用户消息文本。
   * 查找 input page 下的第一条 user 消息。
   */
  private async getUserMessageFromFloor(
    floorId: string
  ): Promise<{ content: string; pageId: string } | null> {
    // 查找 input page
    const [inputPage] = await this.db
      .select({ id: messagePages.id })
      .from(messagePages)
      .where(
        and(
          eq(messagePages.floorId, floorId),
          eq(messagePages.pageKind, "input"),
          eq(messagePages.isActive, true)
        )
      )
      .limit(1);

    if (!inputPage) return null;

    // 查找用户消息
    const [userMsg] = await this.db
      .select({ content: messages.content, pageId: messages.pageId })
      .from(messages)
      .where(
        and(
          eq(messages.pageId, inputPage.id),
          eq(messages.role, "user")
        )
      )
      .orderBy(asc(messages.seq))
      .limit(1);

    if (!userMsg) {
      return null;
    }

    return {
      content: userMsg.content,
      pageId: userMsg.pageId,
    };
  }

  private async resolveRespondBranchContext(
    sessionId: string,
    branchId: string,
    sourceFloorId?: string
  ): Promise<{ nextFloorNo: number; parentFloorId: string | null }> {
    const generatingFloorInBranch = await this.historyLoader.getLatestGeneratingFloorInBranch(sessionId, branchId);

    if (generatingFloorInBranch) {
      throw new ChatServiceError(
        "invalid_state",
        `Branch '${branchId}' already has a generating floor '${generatingFloorInBranch.id}'`
      );
    }

    const lastFloorInBranch = await this.historyLoader.getLatestFloorInBranch(sessionId, branchId);
    const lastCommittedFloorInBranch = await this.historyLoader.getLatestCommittedFloorInBranch(
      sessionId,
      branchId,
    );

    if (lastFloorInBranch) {
      return {
        nextFloorNo: lastFloorInBranch.floorNo + 1,
        parentFloorId: lastCommittedFloorInBranch?.id
          ?? lastFloorInBranch.parentFloorId
          ?? null,
      };
    }

    let sourceFloor: { id: string; floorNo: number } | null = null;

    if (sourceFloorId) {
      const [row] = await this.db
        .select({ id: floors.id, floorNo: floors.floorNo })
        .from(floors)
        .where(
          and(
            eq(floors.id, sourceFloorId),
            eq(floors.sessionId, sessionId),
            eq(floors.state, "committed"),
            isNull(floors.supersededAt)
          )
        )
        .limit(1);

      if (!row) {
        throw new ChatServiceError(
          "source_floor_not_found",
          `Source floor '${sourceFloorId}' was not found in session '${sessionId}'`
        );
      }

      sourceFloor = row;
    } else {
      const [latestMainFloor] = await this.db
        .select({ id: floors.id, floorNo: floors.floorNo })
        .from(floors)
        .where(
          and(
            eq(floors.sessionId, sessionId),
            eq(floors.state, "committed"),
            eq(floors.branchId, "main"),
            isNull(floors.supersededAt)
          )
        )
        .orderBy(desc(floors.floorNo))
        .limit(1);

      sourceFloor = latestMainFloor ?? null;
    }

    return {
      nextFloorNo: (sourceFloor?.floorNo ?? -1) + 1,
      parentFloorId: sourceFloor?.id ?? null,
    };
  }
}

// ── 工具函数 ──────────────────────────────────────────

function buildFloorMetadataJson(
  userId: string | null,
  userSnapshotJson: string | null,
  replacedAt: number
): string | null {
  const snapshotSummary = parseUserSnapshotSummary(userSnapshotJson);
  if (!userId && !snapshotSummary) {
    return null;
  }

  return JSON.stringify({
    user_binding: {
      user_id: userId,
      snapshot_summary: snapshotSummary,
      replaced_at: replacedAt
    }
  });
}

function parseUserSnapshotSummary(userSnapshotJson: string | null): { name: string } | null {
  if (!userSnapshotJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(userSnapshotJson) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    return name ? { name } : null;
  } catch {
    return null;
  }
}

function normalizeBranchId(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    return "main";
  }

  return normalized;
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

function findErrorByConstructor<TError extends Error>(
  error: unknown,
  constructor: abstract new (...args: any[]) => TError,
): TError | undefined {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);

    if (current instanceof constructor) {
      return current;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

// ── 错误类 ────────────────────────────────────────────

export class ChatServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public override readonly cause?: unknown,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ChatServiceError";
  }
}
