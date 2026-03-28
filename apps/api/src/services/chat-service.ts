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

import { asc, eq, and, desc } from "drizzle-orm";
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
  TurnConfig,
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
} from "@tavern/core";
import {
  createEventBus,
  FloorNotFoundError,
  FloorStateConflictError,
  FloorStateMachine,
  LLMTimeoutError,
  ToolRegistry,
} from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { sessions, floors, messagePages, messages } from "../db/schema.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../accounts/constants.js";
import { normalizeNonNegativeInt, normalizePositiveInt } from "../lib/utils.js";
import { executeWithRetry, isSqliteBusyError } from "../lib/retry.js";
import { DrizzleFloorRepository } from "../adapters/drizzle-floor-repository.js";
import { ChatHistoryLoader } from "./chat-history-loader.js";
import { ChatMessagePersistence, type PersistedMessageRef } from "./chat-message-persistence.js";
import {
  GenerationCoordinatorConflictError,
  GenerationCoordinatorQueueTimeoutError,
  InMemoryGenerationCoordinator,
  type CoordinatorRuntime,
  type GenerationCoordinator,
  type GenerationExecutionMode,
  GenerationGuardService,
} from "./generation-guard-service.js";
import { TurnCommitService } from "./turn-commit-service.js";

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
}

/** /floors/:id/retry 请求体 */
export interface RetryFloorRequest {
  /** 回合配置覆盖（可选） */
  config?: TurnConfig;
  /** 生成参数覆盖（可选） */
  generationParams?: Partial<GenerationParams>;
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
   * 可选：中止信号（如客户端断连）。
   */
  abortSignal?: AbortSignal;
}

export interface ResolvedTurnModel {
  model: ModelConfig;
  source: "env" | "global_profile" | "session_profile";
  profileId?: string;
  generationParams?: Partial<GenerationParams>;
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
   * @deprecated 使用 resolveTurnModels 代替。
   * 可选：为当前会话解析本轮使用的模型配置（仅 narrator）。
   */
  resolveTurnModel?: ResolveTurnModelFn;
  /**
   * 可选：按 slot 粒度为当前会话解析模型配置。
   * 优先于 resolveTurnModel。
   */
  resolveTurnModels?: ResolveTurnModelsFn;
  /**
   * 可选：本轮生成成功后回调（例如更新 profile last_used_at）。
   */
  onTurnModelUsed?: OnTurnModelUsedFn;
  /**
   * 可选：工具注册表实例。
   * 提供后可在生成时向 LLM 提供可用工具。
   */
  toolRegistry?: ToolRegistry;
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
  private readonly resolveTurnModel?: ResolveTurnModelFn;
  private readonly resolveTurnModels?: ResolveTurnModelsFn;
  private readonly onTurnModelUsed?: OnTurnModelUsedFn;
  private readonly toolRegistry?: ToolRegistry;
  private readonly resolveToolPermissions?: (sessionId: string, accountId: string) => Promise<ToolPermissions | null>;
  private readonly eventBus: CoreEventBus;
  private readonly floorStateMachine: FloorStateMachine;
  private readonly turnCommitService: TurnCommitService;
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
    this.resolveTurnModel = options.resolveTurnModel;
    this.resolveTurnModels = options.resolveTurnModels;
    this.onTurnModelUsed = options.onTurnModelUsed;
    this.toolRegistry = options.toolRegistry;
    this.resolveToolPermissions = options.resolveToolPermissions;
    this.eventBus = options.eventBus ?? createEventBus();
    this.floorStateMachine = new FloorStateMachine(new DrizzleFloorRepository(db), this.eventBus);
    this.turnCommitService = new TurnCommitService(db, this.messagePersistence, this.eventBus);
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

    return this.runWithGenerationCoordinator(sessionId, branchId, async (generationRuntime) => {
      // ── 2. 确定分支上下文 + 加载历史 ──
      const branchContext = await this.resolveRespondBranchContext(
        sessionId,
        branchId,
        request.sourceFloorId
      );
      const history = await this.historyLoader.loadHistory(sessionId, branchId, branchContext.nextFloorNo);

      // ── 2b. 记忆检索 ──
      const memorySummary = await this.retrieveMemorySummary(sessionId);

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

      runtimeOptions.onStart?.({ floorId, floorNo: nextFloorNo, branchId });

      // ── 5. 构建 TurnInput + 执行编排 ──
      const sessionInfo: SessionPromptInfo = {
        presetId: session.presetId,
        worldbookProfileId: session.worldbookProfileId,
        regexProfileId: session.regexProfileId,
        metadataJson: session.metadataJson,
        characterSnapshotJson: session.characterSnapshotJson,
        promptMode: session.promptMode,
        userSnapshotJson: session.userSnapshotJson,
      };

      const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, accountId);
      const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
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
          variableContext: { sessionId, floorId, pageId: userMessageRef.pageId },
        }
      );

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

      const turnConfig = this.resolveTurnConfig(request.config);
      const consolidationContext = await this.buildConsolidationContext(
        sessionId,
        request.message,
        turnConfig
      );

      const turnInput: TurnInput = {
        sessionId,
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
        toolRegistry: this.toolRegistry,
        toolPermissions: await this.resolveToolPermissionsForSession(sessionId, accountId),
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
      };
    });
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
    const memorySummary = await this.retrieveMemorySummary(sessionId);
    const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, accountId);
    const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
    const maxContextTokensOverride = normalizePositiveInt(narratorParams?.maxContextTokens);

    const sessionInfo: SessionPromptInfo = {
      presetId: session.presetId,
      worldbookProfileId: session.worldbookProfileId,
      regexProfileId: session.regexProfileId,
      metadataJson: session.metadataJson,
      characterSnapshotJson: session.characterSnapshotJson,
      promptMode: session.promptMode,
      userSnapshotJson: session.userSnapshotJson,
    };

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
   * 5. 将旧楼层的 branchId 改为 "superseded-{id}"（让出唯一约束）
   * 6. 创建新的 draft 楼层（同 floorNo，main 分支，parentFloorId 指向旧楼层）
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

    return this.runWithGenerationCoordinator(sessionId, "main", async (generationRuntime) => {
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
      const memorySummary = await this.retrieveMemorySummary(sessionId);

      const newFloorId = nanoid();
      const now = Date.now();
      const { userMessageRef } = this.createDraftFloorWithUserMessage({
        floorId: newFloorId,
        sessionId,
        floorNo: targetFloor.floorNo,
        branchId: "main",
        parentFloorId: targetFloor.id,
        userMessage,
        userId: session.userId,
        userSnapshotJson: session.userSnapshotJson,
        now,
        prepare: (tx) => {
          tx
            .update(floors)
            .set({ branchId: `superseded-${targetFloor.id}`, updatedAt: now })
            .where(eq(floors.id, targetFloor.id))
            .run();
        },
      });

      // ── 8. 构建 TurnInput + 执行编排 ──
      const sessionInfo: SessionPromptInfo = {
        presetId: session.presetId,
        worldbookProfileId: session.worldbookProfileId,
        regexProfileId: session.regexProfileId,
        metadataJson: session.metadataJson,
        characterSnapshotJson: session.characterSnapshotJson,
        promptMode: session.promptMode,
        userSnapshotJson: session.userSnapshotJson,
      };

      const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, accountId);
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
          variableContext: { sessionId, floorId: newFloorId, pageId: userMessageRef.pageId },
        }
      );

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

      const turnConfig = this.resolveTurnConfig(request.config);
      const consolidationContext = await this.buildConsolidationContext(
        sessionId,
        userMessage,
        turnConfig
      );

      const turnInput: TurnInput = {
        sessionId,
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
        toolRegistry: this.toolRegistry,
        toolPermissions: await this.resolveToolPermissionsForSession(sessionId, accountId),
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
      };
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

    return this.runWithGenerationCoordinator(targetFloor.sessionId, targetFloor.branchId, async (generationRuntime) => {
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
      const memorySummary = await this.retrieveMemorySummary(targetFloor.sessionId);
      const now = Date.now();

      this.db.transaction((tx) => {
        this.messagePersistence.clearOutputForRetry(tx, targetFloor.id);
        tx
          .update(floors)
          .set({ state: "draft", tokenIn: 0, tokenOut: 0, updatedAt: now })
          .where(eq(floors.id, targetFloor.id))
          .run();
      });

      const sessionInfo: SessionPromptInfo = {
        presetId: session.presetId,
        worldbookProfileId: session.worldbookProfileId,
        regexProfileId: session.regexProfileId,
        metadataJson: session.metadataJson,
        characterSnapshotJson: session.characterSnapshotJson,
        promptMode: session.promptMode,
        userSnapshotJson: session.userSnapshotJson,
      };

      const resolvedTurnModels = await this.resolveTurnModelsForSession(targetFloor.sessionId, accountId);
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
            floorId: targetFloor.id,
            pageId: userMessageRef.pageId,
          },
        }
      );

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

      const turnConfig = this.resolveTurnConfig(request.config);
      const consolidationContext = await this.buildConsolidationContext(
        targetFloor.sessionId,
        userMessage,
        turnConfig
      );

      const turnInput: TurnInput = {
        sessionId: targetFloor.sessionId,
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
        toolRegistry: this.toolRegistry,
        toolPermissions: await this.resolveToolPermissionsForSession(targetFloor.sessionId, accountId),
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
        commitFailureMessage: "Retry commit failed",
      });

      return {
        floorId: targetFloor.id,
        floorNo: targetFloor.floorNo,
        branchId: targetFloor.branchId,
        generatedText: execution.generatedText,
        summaries: execution.summaries,
        totalUsage: commit.usage,
        finalState: commit.finalState,
      };
    });

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

    return this.runWithGenerationCoordinator(source.sessionId, newBranchId, async (generationRuntime) => {
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
    task: (runtime: CoordinatorRuntime) => Promise<T>
  ): Promise<T> {
    try {
      return await this.generationCoordinator.execute({
        sessionId,
        branchId,
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
    commitFailureMessage: string;
  }): Promise<{
    execution: TurnExecutionResult;
    commit: Awaited<ReturnType<TurnCommitService["commit"]>>;
  }> {
    let execution: TurnExecutionResult;

    try {
      execution = await this.orchestrator.executeTurn(args.turnInput);
    } catch (error) {
      const timeoutError = findErrorByConstructor(error, LLMTimeoutError);
      if (timeoutError) {
        await this.tryMarkFloorFailed(args.floorId, timeoutError);
        throw new ChatServiceError(
          "generation_timeout",
          `${args.orchestrationFailureMessage}: ${timeoutError.message}`,
          error
        );
      }

      throw new ChatServiceError(
        args.orchestrationFailureCode,
        `${args.orchestrationFailureMessage}: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }

    const commitInput = {
      floorId: args.floorId,
      sessionId: args.sessionId,
      execution,
      variableCommit: {
        pageId: args.turnInput.pageId,
      },
      promptSnapshot: args.promptSnapshot,
      toolExecutionRecords: execution.toolExecutionRecords,
      memoryCommit: args.persistMemory
        ? {
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
      if (isSqliteBusyError(error)) {
        await this.emitBestEffortEvent("commit.busy", {
          sessionId: args.sessionId,
          branchId: args.branchId,
          floorId: args.floorId,
          attempts: Math.max(commitAttemptCount, 1),
          message: error instanceof Error ? error.message : String(error),
        });
        await this.tryMarkFloorFailed(args.floorId, error);
        throw new ChatServiceError(
          "commit_busy",
          `${args.commitFailureMessage}: ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }

      if (error instanceof FloorNotFoundError) {
        throw new ChatServiceError("floor_not_found", `Floor '${args.floorId}' not found`, error);
      }

      if (error instanceof FloorStateConflictError) {
        throw new ChatServiceError("commit_conflict", `${args.commitFailureMessage}: ${error.message}`, error);
      }

      if (!(error instanceof FloorStateConflictError) && !(error instanceof FloorNotFoundError)) {
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

  private async getSession(sessionId: string, accountId: string = DEFAULT_ADMIN_ACCOUNT_ID) {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)));
    return row ?? null;
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
    const [row] = await this.db
      .select({
        messageId: messages.id,
        role: messages.role,
        pageKind: messagePages.pageKind,
        pageIsActive: messagePages.isActive,
        floorId: floors.id,
        floorNo: floors.floorNo,
        floorState: floors.state,
        branchId: floors.branchId,
        sessionId: floors.sessionId,
      })
      .from(messages)
      .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(messages.id, messageId), eq(sessions.accountId, accountId)))
      .limit(1);

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
      messageId: row.messageId,
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
  }): Promise<RetryFloorResult> {
    const memorySummary = await this.retrieveMemorySummary(args.sessionId);

    const sessionInfo: SessionPromptInfo = {
      presetId: args.session.presetId,
      worldbookProfileId: args.session.worldbookProfileId,
      regexProfileId: args.session.regexProfileId,
      metadataJson: args.session.metadataJson,
      characterSnapshotJson: args.session.characterSnapshotJson,
      promptMode: args.session.promptMode,
      userSnapshotJson: args.session.userSnapshotJson,
    };

    const resolvedTurnModels = await this.resolveTurnModelsForSession(args.sessionId, args.accountId);
    const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
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
          floorId: args.floorId,
          pageId: args.userMessageRef.pageId,
        },
      }
    );

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

    const turnConfig = this.resolveTurnConfig(args.request.config);
    const consolidationContext = await this.buildConsolidationContext(
      args.sessionId,
      args.userMessage,
      turnConfig
    );

    const turnInput: TurnInput = {
      sessionId: args.sessionId,
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
      toolRegistry: this.toolRegistry,
      toolPermissions: await this.resolveToolPermissionsForSession(args.sessionId, args.accountId),
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
      finalState: commit.finalState,
    };
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
    sessionId: string
  ): Promise<string | undefined> {
    if (!this.memoryStore) return undefined;

    try {
      const injection = await this.memoryStore.prepareInjection(sessionId, {
        maxTokens: 500,
        maxItems: 24,
        minImportance: 0.35,
        includeTypes: ["open_loop", "fact", "summary"],
        selectionMode: "balanced",
        typeOrder: ["open_loop", "fact", "summary"],
        typeMaxItems: { open_loop: 6, fact: 10, summary: 8 },
        decay: this.memoryInjectionDecay,
      });

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
    if (!this.toolRegistry) return undefined;

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

  private async resolveTurnModelForSession(sessionId: string, accountId: string): Promise<ResolvedTurnModel | undefined> {
    if (!this.resolveTurnModel && !this.resolveTurnModels) {
      return undefined;
    }
    // 如果有多 slot 解析器，取 narrator slot 作为兼容返回
    if (this.resolveTurnModels) {
      const models = await this.resolveTurnModels(sessionId, accountId);
      return models.narrator;
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
          if (resolved && resolved.profileId && !seen.has(resolved.profileId)) {
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
    const entries = Object.entries(models) as [InstanceSlot, ResolvedTurnModel][];
    if (entries.length === 0) return undefined;
    const overrides: Partial<Record<InstanceSlot, ModelConfig>> = {};
    for (const [slot, resolved] of entries) {
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

  private resolveTurnConfig(config?: TurnConfig): TurnConfig | undefined {
    if (!this.memoryStore) {
      return config;
    }

    if (config?.enableMemoryConsolidation !== undefined) {
      return config;
    }

    if (!this.enableMemoryConsolidationByDefault) {
      return config;
    }

    return {
      ...config,
      enableMemoryConsolidation: true,
    };
  }

  private async buildConsolidationContext(
    sessionId: string,
    currentFloorContent: string,
    config?: TurnConfig
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
          type: "summary",
          status: "active",
          orderBy: "updatedAt",
          orderDir: "desc",
          limit: 20,
        }),
        this.memoryStore.query({
          scope: "chat",
          scopeId: sessionId,
          type: "fact",
          status: "active",
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
    const lastFloorInBranch = await this.historyLoader.getLatestFloorInBranch(sessionId, branchId);

    if (lastFloorInBranch) {
      return {
        nextFloorNo: lastFloorInBranch.floorNo + 1,
        parentFloorId: lastFloorInBranch.id,
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
            eq(floors.state, "committed")
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
            eq(floors.branchId, "main")
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
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "ChatServiceError";
  }
}
