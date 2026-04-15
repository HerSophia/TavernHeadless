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
  buildPromptAssemblyCompat,
  createRegexMacroSubstituter,
  materializePromptRuntimeMessages,
  previewPromptMacroText,
  resolveEffectivePromptBudget,
  type AssembleResult,
  type AssistantPrefillExecutionStrategy,
  type PromptAssemblyCompat,
  type SessionPromptInfo,
  type PromptMacroRunKind,
  type MaterializePromptRuntimeMessagesResult,
  type PromptSendDirectives,
  type PromptBudgetPolicy,
  type PromptDeliveryPolicy,
  type PromptTrimReason,
  type PromptRuntimeTrace,
  type PromptSourceExclusionReason,
  type PromptSourceSelectionPolicy,
  type PromptStructurePolicy,
  type PromptSnapshotPreview,
} from "./prompt-assembler.js";
import type { PromptVisibilityPolicy, PromptVisibilityTrace } from "./chat-history-loader.js";
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
  ProviderType,
  ToolPermissions,
  CoreEventMap,
  CoreEventBus,
  ToolExecutionCommitOutcome,
  ToolReplaySafety,
} from "@tavern/core";
import {
  createEventBus,
  type PromptRunIntent,
  evaluateToolReplaySafety,
  evaluateExecutedToolCallReplaySafety,
  FloorNotFoundError,
  FloorStateConflictError,
  FloorStateMachine,
  isAutoReplaySafe,
  LLMTimeoutError,
  MemoryScopeResolver,
  resolvePromptRuntimeBudgetGroupExclusionSource,
  resolvePromptRuntimeBudgetGroupTraceLabel,
  ToolReplayBlockedError,
  ToolRegistry,
  UnsupportedToolModeError,
} from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  applyRegexScripts,
  REGEX_PLACEMENT,
  type RegexExecutionChannel,
} from "@tavern/adapters-sillytavern";
import { sessions, floors, messagePages, messages } from "../db/schema.js";
import {
  SessionToolRegistryService,
  SessionToolRegistryServiceError,
} from "./session-tool-registry-service.js";
import type { AccountContextOptions } from "../accounts/account-context.js";
import { resolveAccountIdOrThrow } from "../accounts/account-context.js";
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
import { OwnedFloorRepository, OwnedMessageRepository, OwnedSessionRepository } from "./owned-resource-repositories.js";
import { PromptResourceLoader } from "./prompt-resource-loader.js";
import type { StMacroJsonValue, StMacroStagedMutation } from "./st-macros/index.js";
import { resolveAssistantPrefillStrategy } from "../lib/llm-provider-discovery.js";
import { VariableService } from "./variable-service.js";
import {
  PromptRuntimeControlService,
  buildPromptRuntimeDiagnostics,
  buildPromptRuntimeSourceMap,
  buildPromptRuntimeWarnings,
  buildResolvedPromptRuntimePolicy,
  mergePromptRuntimePersistentPolicies,
  PROMPT_RUNTIME_LIMITATIONS,
  readPromptRuntimeBranchPersistentPolicy,
  readPromptRuntimePersistentPolicy,
} from "./prompt-runtime-control-service.js";
import type {
  PromptRuntimeDiagnostic,
  PromptRuntimeDiagnosticPhase,
  PromptRuntimeHistorySourceMode,
  PromptRuntimeInspectionResult,
  PromptRuntimePersistentPolicy,
  PromptRuntimeSectionStat,
  PromptRuntimeScopeRef,
  PromptRuntimeSourceMap,
  ResolvedPromptRuntimePolicy,
} from "./prompt-runtime-control-service.js";
import {
  buildPromptRuntimeExecutionResult,
  buildPromptRuntimeExecutionTrace,
  buildPromptRuntimePreviewTrace,
  resolvePromptRuntimeExecutionContext,
} from "./prompt-runtime-execution.js";
import type { PromptRuntimeExecutionResult, PromptRuntimePreviewTrace, PromptRuntimeResolvedContext } from "./prompt-runtime-execution.js";
import {
  BranchLocalSnapshotMissingError,
  BranchLocalVariableSnapshotService,
} from "./branch-local-variable-snapshot-service.js";
import type { SessionStateService } from "../session-state/session-state-service.js";
import type { FirstPartyGameStateConsumer } from "../session-state/session-state-first-party-consumer.js";

// ── 请求/响应类型 ─────────────────────────────────────

export interface PromptLiveDebugOptions {
  includePromptSnapshot?: boolean;
  includeRuntimeTrace?: boolean;
  includeWorldbookMatches?: boolean;
}

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
  /** 当前 prompt 运行意图 */
  promptIntent?: PromptRunIntent;
  /** 消息结构覆盖 */
  structure?: PromptStructurePolicy;
  /** 发送约束覆盖 */
  delivery?: PromptDeliveryPolicy;
  /** live 调试返回选项 */
  debugOptions?: PromptLiveDebugOptions;
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
  /** 可选的 prompt 快照预览 */
  promptSnapshot?: PromptSnapshotPreview;
  /** 可选的 prompt runtime trace */
  runtimeTrace?: PromptRuntimeTrace;
}

/** /respond/dry-run 请求体 */
export interface DryRunDebugOptions {
  /** 是否返回世界书命中详情 */
  includeWorldbookMatches?: boolean;
}

export interface DryRunRequest {
  /** 用户消息文本 */
  message: string;
  /** 当前 prompt 运行意图 */
  promptIntent?: PromptRunIntent;
  /** dry-run 调试选项 */
  debugOptions?: DryRunDebugOptions;
  /** dry-run 历史可见性覆盖 */
  visibility?: PromptVisibilityPolicy;
  /** dry-run 消息结构覆盖 */
  structure?: PromptStructurePolicy;
  /** dry-run 发送约束覆盖 */
  delivery?: PromptDeliveryPolicy;
  /** dry-run Prompt 预算覆盖 */
  budget?: PromptBudgetPolicy;
  /** dry-run Prompt 来源选择覆盖 */
  sourceSelection?: PromptSourceSelectionPolicy;
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
  /** 组装调试信息兼容层 */
  assembly: PromptAssemblyCompat;
  /** Prompt Runtime 运行轨迹（第一版增量输出） */
  runtimeTrace?: PromptRuntimeTrace;
}

export interface PromptRuntimePreviewRequest {
  text: string;
  branchId?: string;
  sourceFloorId?: string;
  visibility?: PromptVisibilityPolicy;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  budget?: PromptBudgetPolicy;
  sourceSelection?: PromptSourceSelectionPolicy;
}

export interface PromptRuntimePreviewResult {
  scope: PromptRuntimeScopeRef;
  policy: ResolvedPromptRuntimePolicy;
  sourceMap?: PromptRuntimeSourceMap;
  diagnostics: PromptRuntimeDiagnostic[];
  limitations: string[];
  text: string;
  runtimeTrace: PromptRuntimePreviewTrace;
}

/** /regenerate 请求体 */
export interface RegenerateRequest {
  /** 回合配置覆盖（可选） */
  config?: TurnConfig;
  /** 生成参数覆盖（可选） */
  generationParams?: Partial<GenerationParams>;
  /** 消息结构覆盖 */
  structure?: PromptStructurePolicy;
  /** 发送约束覆盖 */
  delivery?: PromptDeliveryPolicy;
  /** live 调试返回选项 */
  debugOptions?: PromptLiveDebugOptions;
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
  /** 可选的 prompt 快照预览 */
  promptSnapshot?: PromptSnapshotPreview;
  /** 可选的 prompt runtime trace */
  runtimeTrace?: PromptRuntimeTrace;
}

/** /floors/:id/retry 请求体 */
export interface RetryFloorRequest {
  /** 回合配置覆盖（可选） */
  config?: TurnConfig;
  /** 生成参数覆盖（可选） */
  generationParams?: Partial<GenerationParams>;
  /** 消息结构覆盖 */
  structure?: PromptStructurePolicy;
  /** 发送约束覆盖 */
  delivery?: PromptDeliveryPolicy;

  /** live 调试返回选项 */
  debugOptions?: PromptLiveDebugOptions;

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
  /** 可选的 prompt 快照预览 */
  promptSnapshot?: PromptSnapshotPreview;
  /** 可选的 prompt runtime trace */
  runtimeTrace?: PromptRuntimeTrace;
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
  providerType?: ProviderType;
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
  sessionStateService?: SessionStateService;
  firstPartyGameStateConsumer?: FirstPartyGameStateConsumer;
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
  /**
   * narrator 默认 provider 类型。
   */
  defaultNarratorProviderType?: ProviderType;
  accountMode?: AccountContextOptions["accountMode"];
  defaultAccountId?: string;
}

// ── ChatService ───────────────────────────────────────

export class ChatService {
  private readonly historyMaxFloors?: number;
  private readonly historyLoader: ChatHistoryLoader;
  private readonly messagePersistence: ChatMessagePersistence;
  private readonly memoryStore?: MemoryStore;
  private readonly memoryScopeResolver = new MemoryScopeResolver();
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
  private readonly sessionStateService?: SessionStateService;
  private readonly firstPartyGameStateConsumer?: FirstPartyGameStateConsumer;
  private readonly defaultNarratorProviderType?: ProviderType;
  private readonly accountContext: AccountContextOptions;

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
        accountMode: options.accountMode,
        defaultAccountId: options.defaultAccountId,
        sessionStateService: options.sessionStateService,
      });
    this.sessionStateService = options.sessionStateService;
    this.firstPartyGameStateConsumer = options.firstPartyGameStateConsumer;
    this.generationCoordinator = options.generationCoordinator
      ?? options.generationGuard
      ?? new InMemoryGenerationCoordinator();
    this.defaultNarratorProviderType = options.defaultNarratorProviderType;
    this.accountContext = {
      accountMode: options.accountMode,
      defaultAccountId: options.defaultAccountId,
    };
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
    accountId?: string,
  ): Promise<RespondResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    await this.requireActiveSession(sessionId, resolvedAccountId, "Cannot respond to an archived session");

    const branchId = normalizeBranchId(request.branchId);

    return this.withGenerationCoordinator(
      sessionId,
      branchId,
      runtimeOptions.abortSignal,
      async (generationRuntime) => {
        const session = await this.requireActiveSession(sessionId, resolvedAccountId, "Cannot respond to an archived session");
        const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, resolvedAccountId);
        this.assertNarratorSlotEnabled(resolvedTurnModels);
        const sessionInfo = this.buildSessionPromptInfo(session, resolvedTurnModels);

        // ── 2. 确定分支上下文 + 加载历史 ──
        const branchContext = await this.resolveRespondBranchContext(
          sessionId,
          branchId,
          request.sourceFloorId
        );
        const liveRequestPolicy = this.buildPromptRuntimeRequestPolicy(request);
        const executionContext = resolvePromptRuntimeExecutionContext({
          sessionId,
          metadataJson: session.metadataJson,
          branchId,
          branchExists: branchContext.branchExists,
          historySourceBranchId: branchContext.historySourceBranchId,
          historySourceMode: branchContext.historySourceMode,
          sourceFloorId: request.sourceFloorId ?? null,
          request: liveRequestPolicy,
        });
        const { history, visibilityTrace } = await this.loadPromptRuntimeHistoryWindow({
          sessionId,
          branchId: branchContext.historySourceBranchId,
          beforeFloorNo: branchContext.nextFloorNo,
          visibility: executionContext.resolvedPolicy.visibility,
          sourceSelection: executionContext.effectivePolicy?.sourceSelection,
        });

        // ── 3. 创建新楼层 ──
        const nextFloorNo = branchContext.nextFloorNo;
        const now = Date.now();
        const floorId = nanoid();

        // ── 2b. 记忆检索 ──
        const memorySummary = await this.retrieveMemorySummary(sessionId, resolvedAccountId, floorId, branchId);
        const effectiveMemorySummary = executionContext.resolvedPolicy.sourceSelection.memory.enabled === false ? undefined : memorySummary;
        let userMessageRef: PersistedMessageRef;
        try {
          ({ userMessageRef } = this.createDraftFloorWithUserMessage({
            floorId,
            sessionId,
            floorNo: nextFloorNo,
            branchId,
            parentFloorId: branchContext.parentFloorId,
            userMessage: request.message,
            userId: session.userId,
            userSnapshotJson: session.userSnapshotJson,
            now,
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

        await this.initializeFloorRun(sessionId, floorId, "respond", now);
        const persistedUserMessage = await this.applyPersistedUserInputRegex({
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

        runtimeOptions.onStart?.({ floorId, floorNo: nextFloorNo, branchId });
        const unsubscribeRuntimeToolEvents = this.subscribeRuntimeToolEvents(floorId, runtimeOptions);
        const unsubscribeFloorRunEvents = this.subscribeFloorRunEvents(floorId, runtimeOptions);

        try {
          // ── 5. 构建 TurnInput + 执行编排 ──
          const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
          await this.trackFloorRunPhase(floorId, "semantic_resolved");
          await this.trackFloorRunPhase(floorId, "prechecked");
          const assistantPrefillStrategy = this.resolveNarratorAssistantPrefillStrategy(resolvedTurnModels);
          const includeRuntimeTrace = request.debugOptions?.includeRuntimeTrace === true;
          const maxContextTokensOverride = this.resolveMaxContextTokensOverride(request.generationParams, narratorParams);
          const maxOutputTokensOverride = this.resolveMaxOutputTokensOverride(request.generationParams, narratorParams);

          const assembled = await assemblePrompt(
            this.db,
            resolvedAccountId,
            sessionInfo,
            history,
            persistedUserMessage,
            this.tokenCounter,
            effectiveMemorySummary,
            {
              maxContextTokensOverride,
              maxOutputTokensOverride,
              variableContext: { sessionId, branchId, floorId, pageId: userMessageRef.pageId },
              intent: request.promptIntent,
              includeDebug: includeRuntimeTrace,
              runKind: this.resolvePromptRunKind("respond"),
              includeWorldbookMatchTrace: includeRuntimeTrace && request.debugOptions?.includeWorldbookMatches === true,
              assistantPrefillStrategy,
              budget: executionContext.effectivePolicy?.budget,
              sourceSelection: executionContext.effectivePolicy?.sourceSelection,
            }
          );
          await this.trackFloorRunPhase(floorId, "prompt_assembled");

          const materialized = this.materializeTurnPromptMessages(
            assembled.messages,
            assembled.sendDirectives,
            assistantPrefillStrategy,
            executionContext.effectivePolicy?.structure,
            executionContext.effectivePolicy?.delivery,
          );
          const inspection = await this.buildPromptRuntimeInspection({
            accountId: resolvedAccountId,
            context: executionContext,
            phase: "assemble",
            history,
            visibilityTrace,
            memorySummary: effectiveMemorySummary,
            assembled,
            worldbookHitCount: assembled.runtimeTraceSeed.worldbookHits,
          });
          const promptDebug = this.buildLivePromptDebugArtifacts({
            floorId,
            sessionId,
            userMessage: persistedUserMessage,
            assembled,
            materialized,
            inspection,
            visibilityTrace,
            debugOptions: request.debugOptions,
          });

          const generationParams = this.buildGenerationParams({
            requestParams: request.generationParams,
            narratorParams,
            availableForReply: promptDebug.availableForReply,
            stream: !!runtimeOptions.onChunk,
          });

          const requestedTurnConfig = this.resolveRequestedTurnConfig(request.config, resolvedTurnModels);
          const memoryConsolidationRequested = this.shouldRequestMemoryConsolidation(requestedTurnConfig);
          const turnConfig = this.toOrchestratorTurnConfig(requestedTurnConfig);
          const toolRuntime = await this.resolveTurnToolingForFloor({
            floorId,
            sessionId,
            accountId: resolvedAccountId,
            config: turnConfig,
          });
          const consolidationContext = await this.buildConsolidationContext(
            sessionId,
            resolvedAccountId,
            floorId,
            branchId,
            persistedUserMessage,
            turnConfig
          );

          const turnInput: TurnInput = {
            sessionId,
            branchId,
            floorId,
            pageId: userMessageRef.pageId,
            accountId: resolvedAccountId,
            messages: materialized.messages,
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
            accountId: resolvedAccountId,
            turnInput,
            promptSnapshot: promptDebug.promptSnapshotRecord,
            promptRuntimeInspection: promptDebug.inspection,
            macroStagedMutations: assembled.runtimeTraceSeed.macroStagedMutations,
            runType: "respond",
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
            promptSnapshot: promptDebug.promptSnapshot,
            runtimeTrace: promptDebug.runtimeTrace,
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
    accountId?: string,
  ): Promise<DryRunResult> {
    accountId = this.resolveAccountId(accountId);
    const session = await this.getSession(sessionId, accountId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot dry-run in an archived session");
    }

    const executionContext = resolvePromptRuntimeExecutionContext({
      sessionId,
      metadataJson: session.metadataJson,
      branchId: "main",
      branchExists: true,
      historySourceBranchId: "main",
      historySourceMode: "existing_branch",
      request,
    });
    const history = this.applyPromptRuntimeHistorySourceSelection(
      await this.historyLoader.loadHistory(sessionId, "main", undefined, executionContext.resolvedPolicy.visibility),
      executionContext.effectivePolicy?.sourceSelection,
    );
    const visibilityTrace = await this.historyLoader.previewVisibility(sessionId, "main", undefined, executionContext.resolvedPolicy.visibility);
    const memorySummary = await this.retrieveMemorySummary(sessionId, accountId, undefined, "main");
    const effectiveMemorySummary = executionContext.resolvedPolicy.sourceSelection.memory.enabled === false ? undefined : memorySummary;
    const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, accountId);
    const assistantPrefillStrategy = this.resolveNarratorAssistantPrefillStrategy(resolvedTurnModels);
    const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
    const maxContextTokensOverride = normalizePositiveInt(narratorParams?.maxContextTokens);
    const maxOutputTokensOverride = normalizePositiveInt(narratorParams?.maxOutputTokens);

    const sessionInfo = this.buildSessionPromptInfo(session, resolvedTurnModels);
    const persistedUserMessage = await this.applyPersistedUserInputRegex({
      accountId,
      sessionId,
      session,
      sessionInfo,
      rawUserMessage: request.message,
      regexChannel: "persist",
    });

    const assembled = await assemblePrompt(
      this.db,
      accountId,
      sessionInfo,
      history,
      persistedUserMessage,
      this.tokenCounter,
      effectiveMemorySummary,
      {
        includeDebug: true, maxContextTokensOverride, maxOutputTokensOverride, variableContext: { sessionId, branchId: "main" },
        intent: request.promptIntent,
        runKind: this.resolvePromptRunKind("dry_run"),
        includeWorldbookMatchTrace: request.debugOptions?.includeWorldbookMatches,
        assistantPrefillStrategy,
        budget: executionContext.effectivePolicy?.budget,
        sourceSelection: executionContext.effectivePolicy?.sourceSelection,
      }
    );

    const materialized = materializePromptRuntimeMessages({
      messages: assembled.messages,
      sendDirectives: assembled.sendDirectives,
      assistantPrefillStrategy,
      structurePolicy: executionContext.effectivePolicy?.structure,
      deliveryPolicy: executionContext.effectivePolicy?.delivery,
      materializeAssistantPrefillFallback: false,
    });

    const inspection = await this.buildPromptRuntimeInspection({
      accountId,
      context: executionContext,
      phase: "dry_run",
      history,
      visibilityTrace,
      memorySummary: effectiveMemorySummary,
      assembled,
      worldbookHitCount: assembled.runtimeTraceSeed.worldbookHits,
    });
    const execution = buildPromptRuntimeExecutionResult({
      tokenCounter: this.tokenCounter,
      userMessage: persistedUserMessage,
      includeRuntimeTrace: true,
      artifacts: {
        inspection,
        assembled,
        materialized,
        visibilityTrace,
      },
    });

    return {
      messages: materialized.messages,
      tokenEstimate: execution.tokenEstimate!,
      availableForReply: execution.availableForReply!,
      memorySummary: effectiveMemorySummary,
      promptSnapshot: execution.promptSnapshotPreview!,
      assembly: buildPromptAssemblyCompat({
        compatSeed: assembled.assemblyCompatSeed,
        traceSeed: assembled.runtimeTraceSeed,
        runtimeTrace: execution.runtimeTrace,
        preprocessedUserMessage: execution.preprocessedUserMessage,
      }),
      runtimeTrace: execution.runtimeTrace,
    };
  }

  async previewPromptRuntimeText(
    sessionId: string,
    request: PromptRuntimePreviewRequest,
    accountId?: string,
  ): Promise<PromptRuntimePreviewResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    const session = await this.getSession(sessionId, resolvedAccountId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot preview prompt runtime in an archived session");
    }

    const branchId = normalizeBranchId(request.branchId);
    const branchContext = await this.resolveRespondBranchContext(sessionId, branchId, request.sourceFloorId);
    const executionContext = resolvePromptRuntimeExecutionContext({
      sessionId,
      metadataJson: session.metadataJson,
      branchId,
      branchExists: branchContext.branchExists,
      historySourceBranchId: branchContext.historySourceBranchId,
      historySourceMode: branchContext.historySourceMode,
      sourceFloorId: request.sourceFloorId ?? null,
      request,
    });
    const visibilityTrace = await this.historyLoader.previewVisibility(
      sessionId,
      branchContext.historySourceBranchId,
      branchContext.nextFloorNo,
      executionContext.resolvedPolicy.visibility,
    );
    const memorySummary = await this.retrieveMemorySummary(sessionId, resolvedAccountId, undefined, branchId);
    const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, resolvedAccountId);
    const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
    const effectivePreviewBudget = resolveEffectivePromptBudget({
      budget: executionContext.effectivePolicy?.budget,
      maxContextTokensOverride: narratorParams?.maxContextTokens,
      maxOutputTokensOverride: narratorParams?.maxOutputTokens,
    });
    const sessionInfo = this.buildSessionPromptInfo(session, resolvedTurnModels);
    let variableState: Awaited<ReturnType<ChatService["resolvePromptRuntimePreviewVariables"]>>;
    const history = this.applyPromptRuntimeHistorySourceSelection(
      await this.historyLoader.loadHistory(
        sessionId,
        branchContext.historySourceBranchId,
        branchContext.nextFloorNo,
        executionContext.resolvedPolicy.visibility,
      ),
      executionContext.resolvedPolicy.sourceSelection,
    );
    try {
      variableState = await this.resolvePromptRuntimePreviewVariables({
        accountId: resolvedAccountId,
        sessionId,
        branchId,
        branchExists: branchContext.branchExists,
        inheritanceSource: branchContext.inheritanceSource,
      });
    } catch (error) {
      this.rethrowBranchLocalSnapshotError(error);
    }

    const effectivePreviewMemorySummary = executionContext.resolvedPolicy.sourceSelection.memory.enabled ? memorySummary : undefined;
    const previewMaxPrompt = effectivePreviewBudget.maxInputTokens;
    const preview = previewPromptMacroText({
      session: sessionInfo,
      text: request.text,
      chatHistory: history.filter((message): message is { role: "user" | "assistant"; content: string } => (
        message.role === "user" || message.role === "assistant"
      )),
      ordinaryVariables: variableState.ordinaryVariables,
      localValues: variableState.localValues,
      globalValues: variableState.globalValues,
      memorySummary: effectivePreviewMemorySummary,
      maxPrompt: previewMaxPrompt,
      runKind: "dry_run",
    });

    const inspection = await this.buildPromptRuntimeInspection({
      accountId: resolvedAccountId,
      context: executionContext,
      phase: "preview",
      history,
      visibilityTrace,
      memorySummary: effectivePreviewMemorySummary,
      extraDiagnostics: branchContext.branchExists
        ? []
        : [{
            code: "unmaterialized_branch_preview",
            message: `Preview targeted unmaterialized branch '${branchId}'. Branch policy overlay is unavailable until the branch is materialized.`,
            severity: "info",
            source: "branch",
            phase: "preview",
          } satisfies PromptRuntimeDiagnostic],
    });
    const runtimeTrace = buildPromptRuntimePreviewTrace(
      buildPromptRuntimeExecutionTrace({
        inspection,
        visibilityTrace,
        baseRuntimeTrace: preview.runtimeTrace,
      }) ?? preview.runtimeTrace,
    );

    return {
      scope: inspection.scope,
      policy: executionContext.resolvedPolicy,
      sourceMap: inspection.sourceMap,
      diagnostics: inspection.diagnostics,
      limitations: inspection.limitations,
      text: preview.text,
      runtimeTrace,
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
    accountId?: string,
  ): Promise<RegenerateResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    await this.requireActiveSession(sessionId, resolvedAccountId, "Cannot regenerate in an archived session");
    const initialTargetFloor = await this.requireRegenerationTarget(sessionId);

    return this.withGenerationCoordinator(sessionId, "main", undefined, async (generationRuntime: CoordinatorRuntime) => {
      const session = await this.requireActiveSession(sessionId, resolvedAccountId, "Cannot regenerate in an archived session");
      const targetFloor = await this.revalidateRegenerationTarget(sessionId, initialTargetFloor.id);
      const liveRequestPolicy = this.buildPromptRuntimeRequestPolicy(request);
      const executionContext = resolvePromptRuntimeExecutionContext({
        sessionId,
        metadataJson: session.metadataJson,
        branchId: targetFloor.branchId,
        branchExists: true,
        historySourceBranchId: targetFloor.branchId,
        historySourceMode: "existing_branch",
        request: liveRequestPolicy,
      });

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
      const { history, visibilityTrace } = await this.loadPromptRuntimeHistoryWindow({
        sessionId,
        branchId: targetFloor.branchId,
        beforeFloorNo: targetFloor.floorNo,
        visibility: executionContext.resolvedPolicy.visibility,
        sourceSelection: executionContext.effectivePolicy?.sourceSelection,
      });

      const resolvedTurnModels = await this.resolveTurnModelsForSession(sessionId, resolvedAccountId);
      this.assertNarratorSlotEnabled(resolvedTurnModels);

      const newFloorId = nanoid();
      const now = Date.now();

      // ── 4b. 记忆检索 ──
      const memorySummary = await this.retrieveMemorySummary(sessionId, resolvedAccountId, newFloorId, targetFloor.branchId);
      const effectiveMemorySummary = executionContext.resolvedPolicy.sourceSelection.memory.enabled === false ? undefined : memorySummary;
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
      const includeRuntimeTrace = request.debugOptions?.includeRuntimeTrace === true;
      const assistantPrefillStrategy = this.resolveNarratorAssistantPrefillStrategy(resolvedTurnModels);
      const maxContextTokensOverride = this.resolveMaxContextTokensOverride(request.generationParams, narratorParams);
      const maxOutputTokensOverride = this.resolveMaxOutputTokensOverride(request.generationParams, narratorParams);

      const assembled = await assemblePrompt(
        this.db,
        resolvedAccountId,
        sessionInfo,
        history,
        userMessage,
        this.tokenCounter,
        effectiveMemorySummary,
        {
          maxContextTokensOverride,
          maxOutputTokensOverride,
          variableContext: { sessionId, branchId: targetFloor.branchId, floorId: newFloorId, pageId: userMessageRef.pageId },
          includeDebug: includeRuntimeTrace,
          includeWorldbookMatchTrace: includeRuntimeTrace && request.debugOptions?.includeWorldbookMatches === true,
          runKind: this.resolvePromptRunKind("regenerate_page"),
          intent: "regenerate",
          budget: executionContext.effectivePolicy?.budget,
          sourceSelection: executionContext.effectivePolicy?.sourceSelection,
          assistantPrefillStrategy,
        }
      );
      await this.trackFloorRunPhase(newFloorId, "prompt_assembled");

      const materialized = this.materializeTurnPromptMessages(
        assembled.messages,
        assembled.sendDirectives,
        assistantPrefillStrategy,
        executionContext.effectivePolicy?.structure,
        executionContext.effectivePolicy?.delivery,
      );
      const inspection = await this.buildPromptRuntimeInspection({
        accountId: resolvedAccountId,
        context: executionContext,
        phase: "assemble",
        history,
        visibilityTrace,
        memorySummary: effectiveMemorySummary,
        assembled,
        worldbookHitCount: assembled.runtimeTraceSeed.worldbookHits,
      });
      const promptDebug = this.buildLivePromptDebugArtifacts({
        floorId: newFloorId,
        sessionId,
        userMessage,
        assembled,
        materialized,
        inspection,
        visibilityTrace,
        debugOptions: request.debugOptions,
      });

      const generationParams = this.buildGenerationParams({
        requestParams: request.generationParams,
        narratorParams,
        availableForReply: promptDebug.availableForReply,
      });

      const requestedTurnConfig = this.resolveRequestedTurnConfig(request.config, resolvedTurnModels);
      const memoryConsolidationRequested = this.shouldRequestMemoryConsolidation(requestedTurnConfig);
      const turnConfig = this.toOrchestratorTurnConfig(requestedTurnConfig);
      const toolRuntime = await this.resolveTurnToolingForFloor({
        floorId: newFloorId,
        sessionId,
        accountId: resolvedAccountId,
        config: turnConfig,
      });
      const consolidationContext = await this.buildConsolidationContext(
        sessionId,
        resolvedAccountId,
        newFloorId,
        targetFloor.branchId,
        userMessage,
        turnConfig
      );

      const turnInput: TurnInput = {
        sessionId,
        branchId: targetFloor.branchId,
        floorId: newFloorId,
        pageId: userMessageRef.pageId,
        accountId: resolvedAccountId,
        messages: materialized.messages,
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
        accountId: resolvedAccountId,
        turnInput,
        promptSnapshot: promptDebug.promptSnapshotRecord,
        promptRuntimeInspection: promptDebug.inspection,
        macroStagedMutations: assembled.runtimeTraceSeed.macroStagedMutations,
        resolvedTurnModels,
        runType: "regenerate_page",
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
        promptSnapshot: promptDebug.promptSnapshot,
        runtimeTrace: promptDebug.runtimeTrace,
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
    accountId?: string,
  ): Promise<RetryFloorResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    const initialTargetFloor = await this.requireRetryTargetFloor(floorId, resolvedAccountId);
    await this.requireActiveSession(initialTargetFloor.sessionId, resolvedAccountId, "Cannot retry in an archived session");

    return this.withGenerationCoordinator(
      initialTargetFloor.sessionId,
      initialTargetFloor.branchId,
      undefined,
      async (generationRuntime) => {
        const targetFloor = await this.revalidateRetryTargetFloor(floorId, resolvedAccountId, initialTargetFloor);
        const session = await this.requireActiveSession(targetFloor.sessionId, resolvedAccountId, "Cannot retry in an archived session");
        await this.assertRetryReplayConfirmed(targetFloor.id, request);
        const liveRequestPolicy = this.buildPromptRuntimeRequestPolicy(request);
        const executionContext = resolvePromptRuntimeExecutionContext({
          sessionId: targetFloor.sessionId,
          metadataJson: session.metadataJson,
          branchId: targetFloor.branchId,
          branchExists: true,
          historySourceBranchId: targetFloor.branchId,
          historySourceMode: "existing_branch",
          request: liveRequestPolicy,
        });

        const userMessageRef = await this.getUserMessageFromFloor(targetFloor.id);
        if (!userMessageRef) {
          throw new ChatServiceError("no_user_message", `No user message found in floor '${floorId}'`);
        }
        const userMessage = userMessageRef.content;

        const { history, visibilityTrace } = await this.loadPromptRuntimeHistoryWindow({
          sessionId: targetFloor.sessionId,
          branchId: targetFloor.branchId,
          beforeFloorNo: targetFloor.floorNo,
          visibility: executionContext.resolvedPolicy.visibility,
          sourceSelection: executionContext.effectivePolicy?.sourceSelection,
        });
        const memorySummary = await this.retrieveMemorySummary(targetFloor.sessionId, resolvedAccountId, targetFloor.id, targetFloor.branchId);
        const effectiveMemorySummary = executionContext.resolvedPolicy.sourceSelection.memory.enabled === false ? undefined : memorySummary;
        const now = Date.now();
        const resolvedTurnModels = await this.resolveTurnModelsForSession(targetFloor.sessionId, resolvedAccountId);
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
        const includeRuntimeTrace = request.debugOptions?.includeRuntimeTrace === true;
        const assistantPrefillStrategy = this.resolveNarratorAssistantPrefillStrategy(resolvedTurnModels);
        const maxContextTokensOverride = this.resolveMaxContextTokensOverride(request.generationParams, narratorParams);
        const maxOutputTokensOverride = this.resolveMaxOutputTokensOverride(request.generationParams, narratorParams);

        const assembled = await assemblePrompt(
          this.db,
          resolvedAccountId,
          sessionInfo,
          history,
          userMessage,
          this.tokenCounter,
          effectiveMemorySummary,
          {
            maxContextTokensOverride,
            maxOutputTokensOverride,
            variableContext: {
              sessionId: targetFloor.sessionId,
              branchId: targetFloor.branchId,
              floorId: targetFloor.id,
              pageId: userMessageRef.pageId,
            },
            includeDebug: includeRuntimeTrace,
            includeWorldbookMatchTrace: includeRuntimeTrace && request.debugOptions?.includeWorldbookMatches === true,
            runKind: this.resolvePromptRunKind("retry_turn"),
            budget: executionContext.effectivePolicy?.budget,
            sourceSelection: executionContext.effectivePolicy?.sourceSelection,
            assistantPrefillStrategy,
          }
        );
        await this.trackFloorRunPhase(targetFloor.id, "prompt_assembled");

        const materialized = this.materializeTurnPromptMessages(
          assembled.messages,
          assembled.sendDirectives,
          assistantPrefillStrategy,
          executionContext.effectivePolicy?.structure,
          executionContext.effectivePolicy?.delivery,
        );
        const inspection = await this.buildPromptRuntimeInspection({
          accountId: resolvedAccountId,
          context: executionContext,
          phase: "assemble",
          history,
          visibilityTrace,
          memorySummary: effectiveMemorySummary,
          assembled,
          worldbookHitCount: assembled.runtimeTraceSeed.worldbookHits,
        });
        const promptDebug = this.buildLivePromptDebugArtifacts({
          floorId: targetFloor.id,
          sessionId: targetFloor.sessionId,
          userMessage,
          assembled,
          materialized,
          inspection,
          visibilityTrace,
          debugOptions: request.debugOptions,
        });

        const generationParams = this.buildGenerationParams({
          requestParams: request.generationParams,
          narratorParams,
          availableForReply: promptDebug.availableForReply,
        });

        const requestedTurnConfig = this.resolveRequestedTurnConfig(request.config, resolvedTurnModels);
        const memoryConsolidationRequested = this.shouldRequestMemoryConsolidation(requestedTurnConfig);
        const turnConfig = this.toOrchestratorTurnConfig(requestedTurnConfig);
        const toolRuntime = await this.resolveTurnToolingForFloor({
          floorId: targetFloor.id,
          sessionId: targetFloor.sessionId,
          accountId: resolvedAccountId,
          config: turnConfig,
        });
        const consolidationContext = await this.buildConsolidationContext(
          targetFloor.sessionId,
          resolvedAccountId,
          targetFloor.id,
          targetFloor.branchId,
          userMessage,
          turnConfig
        );

        const turnInput: TurnInput = {
          sessionId: targetFloor.sessionId,
          branchId: targetFloor.branchId,
          floorId: targetFloor.id,
          pageId: userMessageRef.pageId,
          accountId: resolvedAccountId,
          messages: materialized.messages,
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
          accountId: resolvedAccountId,
          turnInput,
          promptSnapshot: promptDebug.promptSnapshotRecord,
          promptRuntimeInspection: promptDebug.inspection,
          macroStagedMutations: assembled.runtimeTraceSeed.macroStagedMutations,
          resolvedTurnModels,
          runType: "retry_turn",
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
          promptSnapshot: promptDebug.promptSnapshot,
          runtimeTrace: promptDebug.runtimeTrace,
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
    accountId?: string,
  ): Promise<EditAndRegenerateResult> {
    const resolvedAccountId = this.resolveAccountId(accountId);
    const initialSource = await this.resolveEditableMessage(messageId, resolvedAccountId);
    await this.requireActiveSession(initialSource.sessionId, resolvedAccountId, "Cannot edit message in an archived session");

    const newBranchId = request.branchId ? normalizeBranchId(request.branchId) : `branch-${nanoid(8)}`;

    return this.withGenerationCoordinator(initialSource.sessionId, newBranchId, undefined, async (generationRuntime: CoordinatorRuntime) => {
      const source = await this.revalidateEditableMessageTarget(messageId, resolvedAccountId, initialSource);
      const session = await this.requireActiveSession(source.sessionId, resolvedAccountId, "Cannot edit message in an archived session");
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

      const liveRequestPolicy = this.buildPromptRuntimeRequestPolicy(request);
      const executionContext = resolvePromptRuntimeExecutionContext({
        sessionId: source.sessionId,
        metadataJson: session.metadataJson,
        branchId: newBranchId,
        branchExists: false,
        historySourceBranchId: source.branchId,
        historySourceMode: "source_floor_branch",
        sourceFloorId: source.floorId,
        request: liveRequestPolicy,
      });
      const { history, visibilityTrace } = await this.loadPromptRuntimeHistoryWindow({
        sessionId: source.sessionId,
        branchId: source.branchId,
        beforeFloorNo: source.floorNo,
        visibility: executionContext.resolvedPolicy.visibility,
        sourceSelection: executionContext.effectivePolicy?.sourceSelection,
      });

      const now = Date.now();
      const newFloorId = nanoid();
      const resolvedTurnModels = await this.resolveTurnModelsForSession(source.sessionId, resolvedAccountId);
      this.assertNarratorSlotEnabled(resolvedTurnModels);
      const sessionInfo = this.buildSessionPromptInfo(session, resolvedTurnModels);
      let userMessageRef: PersistedMessageRef;
      try {
        ({ userMessageRef } = this.createDraftFloorWithUserMessage({
          floorId: newFloorId,
          sessionId: source.sessionId,
          floorNo: source.floorNo + 1,
          branchId: newBranchId,
          parentFloorId: source.floorId,
          userMessage: request.content,
          userId: session.userId,
          userSnapshotJson: session.userSnapshotJson,
          now,
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

      const persistedUserMessage = await this.applyPersistedUserInputRegex({
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

      const response = await this.generateForFloor({
        floorId: newFloorId,
        session,
        branchId: newBranchId,
        sessionId: source.sessionId,
        userMessage: persistedUserMessage,
        userMessageRef,
        history,
        request,
        executionContext,
        visibilityTrace,
        accountId: resolvedAccountId,
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

  private async withGenerationCoordinator<T>(
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
    promptSnapshot?: NonNullable<PromptRuntimeExecutionResult["promptSnapshotRecord"]>;
    promptRuntimeInspection?: PromptRuntimeInspectionResult;
    macroStagedMutations?: StMacroStagedMutation[];
    resolvedTurnModels: ResolvedTurnModels;
    orchestrationFailureCode: string;
    orchestrationFailureMessage: string;
    persistMemory: boolean;
    runType: FloorRunType;
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

    if (this.firstPartyGameStateConsumer) {
      try {
        this.firstPartyGameStateConsumer.stageSceneState({
          accountId: args.accountId,
          sessionId: args.sessionId,
          branchId: args.branchId ?? "main",
          floorId: args.floorId,
          runType: args.runType,
          execution,
        });
      } catch (error) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
        await this.tryMarkRunFailed(args.floorId, error, "session_state_stage_failed");
        await this.tryMarkFloorFailed(args.floorId, error);
        throw new ChatServiceError(
          "session_state_stage_failed",
          `Failed to stage first-party session state: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }
    }

    await this.trackFloorRunPhase(args.floorId, "transaction_prepared");

    const commitInput = {
      accountId: args.accountId,
      floorId: args.floorId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      execution,
      variableCommit: {
        pageId: turnInput.pageId,
      },
      promptSnapshot: args.promptSnapshot,
      promptRuntimeInspection: args.promptRuntimeInspection,
      // commit 只消费 assemble 阶段已经冻结的 macroStagedMutations。
      // 这里不重新执行模板，也不应通过 commit_consume 重新触发写宏。
      // commit_consume 仅保留为结果消费语义，不是另一个通用模板执行阶段。
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
        this.discardStagedSessionStateBestEffort(args.accountId, args.sessionId, args.floorId, "commit_busy");
        await this.tryMarkRunFailed(args.floorId, error, "commit_busy");
        await this.tryMarkFloorFailed(args.floorId, error);
        throw new ChatServiceError(
          "commit_busy",
          `${args.commitFailureMessage}: ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }

      this.discardStagedSessionStateBestEffort(args.accountId, args.sessionId, args.floorId, error instanceof FloorStateConflictError ? "commit_conflict" : error instanceof FloorNotFoundError ? "floor_not_found" : "turn_commit_failed");

      if (error instanceof FloorNotFoundError) {
        await this.tryMarkRunFailed(args.floorId, error, "floor_not_found");
        throw new ChatServiceError("floor_not_found", `Floor '${args.floorId}' not found`, error);
      }

      if (error instanceof FloorStateConflictError) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
        await this.tryMarkRunFailed(args.floorId, error, "commit_conflict");
        throw new ChatServiceError("commit_conflict", `${args.commitFailureMessage}: ${error.message}`, error);
      }

      if (!(error instanceof FloorStateConflictError) && !(error instanceof FloorNotFoundError)) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
        await this.tryMarkRunFailed(args.floorId, error, "turn_commit_failed");
        await this.tryMarkFloorFailed(args.floorId, error);
      }

      if (error instanceof FloorNotFoundError) {
        await this.markToolExecutionRunOutcome(toolExecutionRunId, "discarded");
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

  private discardStagedSessionStateBestEffort(
    accountId: string,
    sessionId: string,
    floorId: string,
    reason: string,
  ): void {
    if (!this.sessionStateService) {
      return;
    }

    try {
      this.sessionStateService.discardStagedMutationsForFloor({
        accountId,
        sessionId,
        floorId,
        reason,
      });
    } catch {
      // best-effort discard on failed commit paths
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

  private resolveAccountId(accountId?: string): string {
    return resolveAccountIdOrThrow(accountId, this.accountContext);
  }

  private async getSession(sessionId: string, accountId?: string) {
    return new OwnedSessionRepository(this.db).getById(this.resolveAccountId(accountId), sessionId);
  }

  private rethrowBranchLocalSnapshotError(error: unknown): never {
    if (error instanceof BranchLocalSnapshotMissingError) {
      throw new ChatServiceError(error.code, error.message, error, error.details);
    }

    throw error;
  }

  private async resolvePromptRuntimePreviewVariables(args: {
    accountId: string;
    sessionId: string;
    branchId: string;
    branchExists: boolean;
    inheritanceSource?: { floorId: string; branchId: string };
  }): Promise<{
    ordinaryVariables: Record<string, unknown>;
    localValues: Record<string, StMacroJsonValue>;
    globalValues: Record<string, StMacroJsonValue>;
  }> {
    const variableService = new VariableService(this.db);

    if (args.branchExists) {
      const snapshot = await variableService.resolveSnapshot({
        accountId: args.accountId,
        sessionId: args.sessionId,
        branchId: args.branchId,
        includeLayers: true,
      });

      return {
        ordinaryVariables: Object.fromEntries(snapshot.resolved.map((item) => [item.key, item.value])),
        localValues: mapPromptRuntimePreviewVariableItems((snapshot.layers?.branch ?? snapshot.layers?.chat)?.items),
        globalValues: mapPromptRuntimePreviewVariableItems(snapshot.layers?.global?.items),
      };
    }

    const snapshot = await variableService.resolveSnapshot({
      accountId: args.accountId,
      sessionId: args.sessionId,
      includeLayers: true,
    });
    const globalValues = mapPromptRuntimePreviewVariableItems(snapshot.layers?.global?.items);

    if (args.inheritanceSource) {
      const localValues = toPromptRuntimePreviewJsonRecord(
        new BranchLocalVariableSnapshotService(this.db).requireSourceFloorLocalValues({
          accountId: args.accountId,
          sessionId: args.sessionId,
          sourceFloorId: args.inheritanceSource.floorId,
          sourceBranchId: args.inheritanceSource.branchId,
        }).values,
      );

      return {
        ordinaryVariables: { ...globalValues, ...localValues },
        localValues,
        globalValues,
      };
    }

    return {
      ordinaryVariables: Object.fromEntries(snapshot.resolved.map((item) => [item.key, item.value])),
      localValues: mapPromptRuntimePreviewVariableItems(snapshot.layers?.chat?.items),
      globalValues,
    };
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

  private async requireRegenerationTarget(sessionId: string): Promise<Pick<typeof floors.$inferSelect, "id" | "sessionId" | "floorNo" | "branchId" | "parentFloorId" | "state">> {
    const targetFloor = await this.historyLoader.getLatestCommittedFloorInBranch(sessionId, "main");
    if (!targetFloor) {
      throw new ChatServiceError(
        "no_floor_to_regenerate",
        "No committed floor found to regenerate"
      );
    }

    return targetFloor;
  }

  private async revalidateRegenerationTarget(
    sessionId: string,
    expectedFloorId: string,
  ): Promise<Pick<typeof floors.$inferSelect, "id" | "sessionId" | "floorNo" | "branchId" | "parentFloorId" | "state">> {
    const targetFloor = await this.requireRegenerationTarget(sessionId);
    if (targetFloor.id !== expectedFloorId) {
      throw new ChatServiceError(
        "generation_target_stale",
        "Latest committed floor changed while the regenerate request was waiting to run"
      );
    }

    return targetFloor;
  }

  private async requireRetryTargetFloor(
    floorId: string,
    accountId: string,
  ): Promise<Pick<typeof floors.$inferSelect, "id" | "sessionId" | "floorNo" | "branchId" | "state">> {
    const targetFloor = new OwnedFloorRepository(this.db).getById(accountId, floorId);
    if (!targetFloor) {
      throw new ChatServiceError("floor_not_found", `Floor '${floorId}' not found`);
    }

    if (targetFloor.state !== "committed") {
      throw new ChatServiceError(
        "invalid_state",
        `Floor '${floorId}' must be in committed state to retry`
      );
    }

    return targetFloor;
  }

  private async revalidateRetryTargetFloor(
    floorId: string,
    accountId: string,
    expected: Pick<typeof floors.$inferSelect, "sessionId" | "floorNo" | "branchId">,
  ): Promise<Pick<typeof floors.$inferSelect, "id" | "sessionId" | "floorNo" | "branchId" | "state">> {
    const targetFloor = await this.requireRetryTargetFloor(floorId, accountId);
    if (
      targetFloor.sessionId !== expected.sessionId
      || targetFloor.floorNo !== expected.floorNo
      || targetFloor.branchId !== expected.branchId
    ) {
      throw new ChatServiceError(
        "generation_target_stale",
        "Retry target changed while the request was waiting to run"
      );
    }

    return targetFloor;
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

  private async revalidateEditableMessageTarget(
    messageId: string,
    accountId: string,
    expected: {
      floorId: string;
      floorNo: number;
      branchId: string;
      sessionId: string;
    },
  ): Promise<{
    messageId: string;
    floorId: string;
    floorNo: number;
    branchId: string;
    sessionId: string;
  }> {
    const source = await this.resolveEditableMessage(messageId, accountId);
    if (source.floorId !== expected.floorId || source.floorNo !== expected.floorNo || source.branchId !== expected.branchId || source.sessionId !== expected.sessionId) {
      throw new ChatServiceError("generation_target_stale", "Edit target changed while the request was waiting to run");
    }
    return source;
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
    executionContext?: PromptRuntimeResolvedContext;
    visibilityTrace?: PromptVisibilityTrace;
    accountId: string;
    abortSignal?: AbortSignal;
    runType: FloorRunType;
  }): Promise<RetryFloorResult> {
    const memorySummary = await this.retrieveMemorySummary(args.sessionId, args.accountId, args.floorId, args.branchId);
    await this.initializeFloorRun(args.sessionId, args.floorId, args.runType);
    try {

    const resolvedTurnModels = await this.resolveTurnModelsForSession(args.sessionId, args.accountId);
    this.assertNarratorSlotEnabled(resolvedTurnModels);
    const sessionInfo = this.buildSessionPromptInfo(args.session, resolvedTurnModels);
    const executionContext = args.executionContext ?? resolvePromptRuntimeExecutionContext({
      sessionId: args.sessionId,
      metadataJson: args.session.metadataJson,
      branchId: args.branchId ?? "main",
      branchExists: true,
      historySourceBranchId: args.branchId ?? "main",
      historySourceMode: "existing_branch",
      request: this.buildPromptRuntimeRequestPolicy(args.request),
    });
    const history = this.applyPromptRuntimeHistorySourceSelection(args.history, executionContext.effectivePolicy?.sourceSelection);
    const effectiveMemorySummary = executionContext.resolvedPolicy.sourceSelection.memory.enabled === false ? undefined : memorySummary;
    const narratorParams = this.getSlotGenerationParams(resolvedTurnModels, "narrator");
    await this.trackFloorRunPhase(args.floorId, "semantic_resolved");
    await this.trackFloorRunPhase(args.floorId, "prechecked");
    const includeRuntimeTrace = args.request.debugOptions?.includeRuntimeTrace === true;
    const assistantPrefillStrategy = this.resolveNarratorAssistantPrefillStrategy(resolvedTurnModels);
    const maxContextTokensOverride = this.resolveMaxContextTokensOverride(args.request.generationParams, narratorParams);
    const maxOutputTokensOverride = this.resolveMaxOutputTokensOverride(args.request.generationParams, narratorParams);

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
          pageId: args.userMessageRef.pageId,
        },
        includeDebug: includeRuntimeTrace,
        includeWorldbookMatchTrace: includeRuntimeTrace && args.request.debugOptions?.includeWorldbookMatches === true,
        runKind: this.resolvePromptRunKind(args.runType),
        budget: executionContext.effectivePolicy?.budget,
        sourceSelection: executionContext.effectivePolicy?.sourceSelection,
        assistantPrefillStrategy,
      }
    );
    await this.trackFloorRunPhase(args.floorId, "prompt_assembled");

    const materialized = this.materializeTurnPromptMessages(
      assembled.messages,
      assembled.sendDirectives,
      assistantPrefillStrategy,
      executionContext.effectivePolicy?.structure,
      executionContext.effectivePolicy?.delivery,
    );
    const inspection = await this.buildPromptRuntimeInspection({
      accountId: args.accountId,
      context: executionContext,
      phase: "assemble",
      history,
      visibilityTrace: args.visibilityTrace,
      memorySummary: effectiveMemorySummary,
      assembled,
      worldbookHitCount: assembled.runtimeTraceSeed.worldbookHits,
    });
    const promptDebug = this.buildLivePromptDebugArtifacts({
      floorId: args.floorId,
      sessionId: args.sessionId,
      userMessage: args.userMessage,
      assembled,
      materialized,
      inspection,
      visibilityTrace: args.visibilityTrace,
      debugOptions: args.request.debugOptions,
    });

    const generationParams = this.buildGenerationParams({
      requestParams: args.request.generationParams,
      narratorParams,
      availableForReply: promptDebug.availableForReply,
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
      args.floorId,
      args.branchId,
      args.userMessage,
      turnConfig
    );

    const turnInput: TurnInput = {
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.userMessageRef.pageId,
      accountId: args.accountId,
      messages: materialized.messages,
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
      promptSnapshot: promptDebug.promptSnapshotRecord,
      promptRuntimeInspection: promptDebug.inspection,
      macroStagedMutations: assembled.runtimeTraceSeed.macroStagedMutations,
      resolvedTurnModels,
      runType: args.runType,
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
      promptSnapshot: promptDebug.promptSnapshot,
      runtimeTrace: promptDebug.runtimeTrace,
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
    afterCreate?: (tx: DbExecutor, floorId: string) => void;
  }): { floorId: string; userMessageRef: PersistedMessageRef } {
    const floorId = args.floorId ?? nanoid();
    const floorMetadataJson = buildFloorMetadataJson(args.userId, args.userSnapshotJson, args.now, args.userMessage);

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
      args.afterCreate?.(tx, floorId);

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

  private async applyPersistedUserInputRegex(args: {
    accountId: string;
    sessionId: string;
    branchId?: string;
    floorId?: string;
    pageId?: string;
    session: Pick<typeof sessions.$inferSelect, "characterSnapshotJson" | "userSnapshotJson" | "metadataJson">;
    sessionInfo: SessionPromptInfo;
    rawUserMessage: string;
    regexChannel: RegexExecutionChannel;
    persistedMessageId?: string;
  }): Promise<string> {
    const resourceLoader = new PromptResourceLoader(this.db);
    const regexProfile = await resourceLoader.loadRegexScripts(args.accountId, args.sessionInfo.regexProfileId);

    if (!regexProfile || regexProfile.scripts.length === 0) {
      return args.rawUserMessage;
    }

    const variables = await this.resolveRegexVariables({
      accountId: args.accountId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.pageId,
      characterSnapshotJson: args.session.characterSnapshotJson,
      userSnapshotJson: args.session.userSnapshotJson,
      metadataJson: args.session.metadataJson,
    });

    const substituteRegexParams = createRegexMacroSubstituter(variables);
    const persistedUserMessage = applyRegexScripts(
      args.rawUserMessage,
      regexProfile.scripts,
      REGEX_PLACEMENT.USER_INPUT,
      {
        channel: args.regexChannel,
        depth: 0,
        substituteFindParams: substituteRegexParams,
        substituteReplaceParams: substituteRegexParams,
      },
    );

    if (args.persistedMessageId && persistedUserMessage !== args.rawUserMessage) {
      await this.messagePersistence.updateMessageContent(args.persistedMessageId, persistedUserMessage);
    }

    return persistedUserMessage;
  }

  private async resolveRegexVariables(args: {
    accountId: string;
    sessionId: string;
    branchId?: string;
    floorId?: string;
    pageId?: string;
    characterSnapshotJson: string | null;
    userSnapshotJson: string | null;
    metadataJson: string | null;
  }): Promise<Record<string, unknown>> {
    const variables = Object.create(null) as Record<string, unknown>;
    const variableService = new VariableService(this.db);
    const snapshot = await variableService.resolveSnapshot({
      accountId: args.accountId,
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      pageId: args.pageId,
    });

    for (const entry of snapshot.resolved) {
      variables[entry.key] = entry.value;
    }

    variables.char = parseRegexCharacterName(args.characterSnapshotJson) ?? "Assistant";
    variables.user = parseRegexUserName(args.userSnapshotJson, args.metadataJson) ?? "User";
    return variables;
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

  private resolveMaxOutputTokensOverride(
    requestParams?: Partial<GenerationParams>,
    narratorParams?: Partial<GenerationParams>,
  ): number | undefined {
    return normalizePositiveInt(requestParams?.maxOutputTokens)
      ?? normalizePositiveInt(narratorParams?.maxOutputTokens);
  }

  /**
   * 从 MemoryStore 检索可注入的记忆上下文。
   * 如果未配置 MemoryStore 或无可用记忆，返回 undefined。
   */
  private async retrieveMemorySummary(
    sessionId: string,
    accountId: string,
    floorId?: string,
    branchId?: string,
  ): Promise<string | undefined> {
    if (!this.memoryStore) return undefined;

    try {
      const scopeContext = {
        accountId,
        sessionId,
        ...(branchId ? { branchId } : {}),
        ...(floorId ? { floorId } : {}),
      };
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
              scopeContext,
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
              scopeContext,
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

  private resolvePromptRunKind(runType: FloorRunType | "dry_run"): PromptMacroRunKind {
    switch (runType) {
      case "dry_run":
        return "dry_run";
      case "respond":
        return "respond";
      case "retry_turn":
        return "retry";
      case "regenerate_page":
      case "edit_and_regenerate":
        return "regenerate";
      default:
        return "respond";
    }
  }

  private resolveNarratorAssistantPrefillStrategy(
    models: ResolvedTurnModels,
  ): AssistantPrefillExecutionStrategy {
    return resolveAssistantPrefillStrategy(
      models.narrator?.providerType ?? this.defaultNarratorProviderType,
    );
  }

  private resolveEffectivePromptRuntimePolicies(
    metadataJson: string | null,
    request: {
      structure?: PromptStructurePolicy;
      delivery?: PromptDeliveryPolicy;
      budget?: PromptBudgetPolicy;
      sourceSelection?: PromptSourceSelectionPolicy;
    },
    branchId = "main",
  ): {
    structure?: PromptStructurePolicy;
    delivery?: PromptDeliveryPolicy;
    budget?: PromptBudgetPolicy;
    sourceSelection?: PromptSourceSelectionPolicy;
  } {
    const { persistentPolicy } = readPromptRuntimePersistentPolicy(metadataJson);
    const { persistentPolicy: branchPersistentPolicy } = readPromptRuntimeBranchPersistentPolicy(metadataJson, branchId);
    const effectivePersistentPolicy = mergePromptRuntimePersistentPolicies(
      persistentPolicy,
      branchPersistentPolicy,
      this.buildPromptRuntimeRequestPolicy(request),
    );

    return {
      structure: effectivePersistentPolicy?.structure,
      delivery: effectivePersistentPolicy?.delivery,
      budget: effectivePersistentPolicy?.budget,
      sourceSelection: effectivePersistentPolicy?.sourceSelection,
    };
  }

  private buildPromptRuntimeRequestPolicy(request: {
    structure?: PromptStructurePolicy;
    delivery?: PromptDeliveryPolicy;
    budget?: PromptBudgetPolicy;
    sourceSelection?: PromptSourceSelectionPolicy;
  }): PromptRuntimePersistentPolicy | undefined {
    if (!request.structure && !request.delivery && !request.budget && !request.sourceSelection) {
      return undefined;
    }

    return {
      ...(request.structure ? { structure: request.structure } : {}),
      ...(request.delivery ? { delivery: request.delivery } : {}),
      ...(request.budget ? { budget: request.budget } : {}),
      ...(request.sourceSelection ? { sourceSelection: request.sourceSelection } : {}),
    };
  }

  private async loadPromptRuntimeHistoryWindow(args: {
    sessionId: string;
    branchId: string;
    beforeFloorNo?: number;
    visibility: PromptVisibilityPolicy;
    sourceSelection?: PromptSourceSelectionPolicy;
  }): Promise<{ history: ChatMessage[]; visibilityTrace: PromptVisibilityTrace }> {
    const [history, visibilityTrace] = await Promise.all([
      this.historyLoader.loadHistory(
        args.sessionId,
        args.branchId,
        args.beforeFloorNo,
        args.visibility,
      ),
      this.historyLoader.previewVisibility(
        args.sessionId,
        args.branchId,
        args.beforeFloorNo,
        args.visibility,
      ),
    ]);

    return {
      history: this.applyPromptRuntimeHistorySourceSelection(history, args.sourceSelection),
      visibilityTrace,
    };
  }

  private applyPromptRuntimeHistorySourceSelection(
    history: ChatMessage[],
    sourceSelection?: PromptSourceSelectionPolicy,
  ): ChatMessage[] {
    const maxMessages = normalizePositiveInt(sourceSelection?.history?.maxMessages);
    if (!maxMessages || history.length <= maxMessages) {
      return history;
    }

    return history.slice(-maxMessages);
  }

  private buildPromptRuntimeTrimReasons(
    args: {
      prunedByGroup?: Record<string, number>;
      allocatorTrimReasons?: PromptTrimReason[];
    },
  ): PromptTrimReason[] | undefined {
    if (args.allocatorTrimReasons && args.allocatorTrimReasons.length > 0) {
      return args.allocatorTrimReasons;
    }

    const trimReasons = Object.entries(args.prunedByGroup ?? {})
      .filter(([, prunedTokenCount]) => prunedTokenCount > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, prunedTokenCount]) => ({
        group,
        reason: "budget_exceeded" as const,
        prunedTokenCount,
        detail: `Prompt runtime pruned ${prunedTokenCount} tokens from budget group '${resolvePromptRuntimeBudgetGroupTraceLabel(group)}'.`,
      }));

    return trimReasons.length > 0 ? trimReasons : undefined;
  }

  private buildPromptRuntimeSourceSelectionTrace(args: {
    sourceSelection?: PromptSourceSelectionPolicy;
    history: ChatMessage[];
    visibilityTrace?: PromptRuntimeTrace["visibility"];
    memorySummary?: string;
    promptSnapshot?: AssembleResult["promptSnapshot"];
    worldbookHitCount?: number;
    budgetByGroup?: Record<string, number>;
    prunedByGroup?: Record<string, number>;
  }): PromptRuntimeTrace["sourceSelection"] | undefined {
    const excludedSources: PromptSourceExclusionReason[] = [];
    const seen = new Set<string>();
    const pushExcludedSource = (
      source: PromptSourceExclusionReason["source"],
      reason: PromptSourceExclusionReason["reason"],
      detail?: string,
    ) => {
      const key = `${source}:${reason}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      excludedSources.push({
        source,
        reason,
        ...(detail ? { detail } : {}),
      });
    };

    if (args.sourceSelection?.memory?.enabled === false && args.memorySummary?.trim()) {
      pushExcludedSource("memory", "disabled_by_policy", "sourceSelection.memory.enabled=false removed memory summary injection.");
    }

    if (
      args.sourceSelection?.worldbook?.enabled === false
      && args.promptSnapshot
      && hasPromptRuntimeWorldbookSource(args.promptSnapshot)
    ) {
      pushExcludedSource("worldbook", "disabled_by_policy", "sourceSelection.worldbook.enabled=false disabled worldbook injection.");
    } else if (
      args.promptSnapshot
      && hasPromptRuntimeWorldbookSource(args.promptSnapshot)
      && (args.worldbookHitCount ?? 0) === 0
    ) {
      pushExcludedSource("worldbook", "not_triggered", "No worldbook entry matched the current visible prompt context.");
    }

    if (
      args.sourceSelection?.examples?.enabled === false
      && args.promptSnapshot
      && hasPromptRuntimeExamplesSource(args.promptSnapshot)
    ) {
      pushExcludedSource("examples", "disabled_by_policy", "sourceSelection.examples.enabled=false removed example dialogue from prompt assembly.");
    }

    if (args.history.length === 0 && (args.visibilityTrace?.filteredFloorNos?.length ?? 0) > 0) {
      pushExcludedSource(
        "history",
        "visibility_filtered",
        `Visibility filtered ${args.visibilityTrace!.filteredFloorNos!.length} floor(s) from the available history window.`,
      );
    }

    for (const [group, prunedTokenCount] of Object.entries(args.prunedByGroup ?? {})) {
      if (prunedTokenCount <= 0) {
        continue;
      }

      const source = resolvePromptRuntimeBudgetGroupExclusionSource(group);
      if (!source) {
        continue;
      }

      const remainingTokenCount = args.budgetByGroup?.[group] ?? 0;
      if (remainingTokenCount === 0) {
        const groupLabel = resolvePromptRuntimeBudgetGroupTraceLabel(group);
        pushExcludedSource(source, "budget_trimmed", `Budget trimming removed all remaining '${groupLabel}' content from the prompt.`);
      }
    }

    return excludedSources.length > 0 ? { excludedSources } : undefined;
  }

  private buildPromptRuntimeSectionStats(
    bySection?: Record<string, number>,
  ): PromptRuntimeSectionStat[] {
    return Object.entries(bySection ?? {})
      .filter(([, tokenCount]) => Number.isFinite(tokenCount) && tokenCount > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sectionName, tokenCount]) => ({
        sectionName,
        tokenCount,
      }));
  }

  private async buildPromptRuntimeInspection(args: ({
    accountId: string;
    context: PromptRuntimeResolvedContext;
    phase: PromptRuntimeDiagnosticPhase;
    history: ChatMessage[];
    visibilityTrace?: PromptVisibilityTrace;
    memorySummary?: string;
    assembled?: AssembleResult;
    worldbookHitCount?: number;
    extraDiagnostics?: PromptRuntimeDiagnostic[];
  } | {
    accountId: string;
    sessionId: string;
    branchId: string;
    branchExists: boolean;
    sourceFloorId?: string | null;
    historySourceBranchId: string;
    historySourceMode: PromptRuntimeHistorySourceMode;
    sessionPersistentPolicy?: PromptRuntimeResolvedContext["sessionPersistentPolicy"];
    sessionPolicyWarnings?: string[];
    branchPersistentPolicy?: PromptRuntimeResolvedContext["branchPersistentPolicy"];
    branchPolicyWarnings?: string[];
    requestPolicy?: PromptRuntimeResolvedContext["requestPolicy"];
    resolvedPolicy?: ResolvedPromptRuntimePolicy;
    phase: PromptRuntimeDiagnosticPhase;
    history: ChatMessage[];
    visibilityTrace?: PromptVisibilityTrace;
    memorySummary?: string;
    assembled?: AssembleResult;
    worldbookHitCount?: number;
    extraDiagnostics?: PromptRuntimeDiagnostic[];
  })): Promise<PromptRuntimeInspectionResult> {
    const context: PromptRuntimeResolvedContext = "context" in args
      ? args.context
      : {
          scope: {
            sessionId: args.sessionId,
            targetBranchId: args.branchId,
            branchExists: args.branchExists,
            sourceFloorId: args.sourceFloorId ?? null,
            historySourceBranchId: args.historySourceBranchId,
            historySourceMode: args.historySourceMode,
          },
          sessionPersistentPolicy: args.sessionPersistentPolicy,
          sessionPolicyWarnings: args.sessionPolicyWarnings ?? [],
          branchPersistentPolicy: args.branchPersistentPolicy,
          branchPolicyWarnings: args.branchPolicyWarnings ?? [],
          requestPolicy: args.requestPolicy,
          effectivePolicy: mergePromptRuntimePersistentPolicies(
            args.sessionPersistentPolicy,
            args.branchPersistentPolicy,
            args.requestPolicy,
          ),
          resolvedPolicy: args.resolvedPolicy
            ?? buildResolvedPromptRuntimePolicy(
              args.sessionPersistentPolicy,
              args.branchPersistentPolicy,
              args.requestPolicy,
            ),
        };
    const warnings = buildPromptRuntimeWarnings(context.effectivePolicy, [
      ...context.sessionPolicyWarnings,
      ...context.branchPolicyWarnings,
    ]);
    const diagnostics = [
      ...buildPromptRuntimeDiagnostics(warnings, {
        branchId: context.scope.targetBranchId,
        phase: args.phase,
      }),
      ...(args.extraDiagnostics ?? []),
    ];
    const trimReasons = this.buildPromptRuntimeTrimReasons({
      prunedByGroup: args.assembled?.tokenUsage.prunedByGroup,
      allocatorTrimReasons: args.assembled?.tokenUsage.allocator?.trimReasons,
    }) ?? [];
    const sourceSelectionTrace = this.buildPromptRuntimeSourceSelectionTrace({
      sourceSelection: context.resolvedPolicy.sourceSelection,
      history: args.history,
      visibilityTrace: args.visibilityTrace,
      memorySummary: args.memorySummary,
      promptSnapshot: args.assembled?.promptSnapshot,
      worldbookHitCount: args.worldbookHitCount,
      budgetByGroup: args.assembled?.tokenUsage.byGroup,
      prunedByGroup: args.assembled?.tokenUsage.prunedByGroup,
    });
    const assets = await new PromptRuntimeControlService(this.db).getAssets(context.scope.sessionId, args.accountId);

    return {
      scope: context.scope,
      assets,
      resolvedPolicy: context.resolvedPolicy,
      sourceMap: buildPromptRuntimeSourceMap({
        sessionPolicy: context.sessionPersistentPolicy,
        branchPolicy: context.branchPersistentPolicy,
        requestPolicy: context.requestPolicy,
        resolvedPolicy: context.resolvedPolicy,
        history: {
          sourceBranchId: context.scope.historySourceBranchId,
          sourceMode: context.scope.historySourceMode,
        },
      }) ?? {},
      diagnostics,
      trimReasons,
      excludedSources: sourceSelectionTrace?.excludedSources ?? [],
      sectionStats: this.buildPromptRuntimeSectionStats(args.assembled?.tokenUsage.bySection),
      limitations: [...PROMPT_RUNTIME_LIMITATIONS],
    };
  }

  private buildLivePromptDebugArtifacts(args: {
    floorId: string;
    sessionId: string;
    userMessage: string;
    assembled: AssembleResult;
    materialized: MaterializePromptRuntimeMessagesResult;
    inspection: PromptRuntimeInspectionResult;
    visibilityTrace?: PromptVisibilityTrace;
    debugOptions?: PromptLiveDebugOptions;
  }): {
    availableForReply: number;
    inspection: PromptRuntimeInspectionResult;
    promptSnapshotRecord: NonNullable<PromptRuntimeExecutionResult["promptSnapshotRecord"]>;
    promptSnapshot?: PromptSnapshotPreview;
    runtimeTrace?: PromptRuntimeTrace;
  } {
    const execution = buildPromptRuntimeExecutionResult({
      tokenCounter: this.tokenCounter,
      userMessage: args.userMessage,
      floorId: args.floorId,
      sessionId: args.sessionId,
      includeRuntimeTrace: args.debugOptions?.includeRuntimeTrace,
      artifacts: {
        inspection: args.inspection,
        assembled: args.assembled,
        materialized: args.materialized,
        visibilityTrace: args.visibilityTrace,
      },
    });

    return {
      availableForReply: execution.availableForReply ?? 0,
      inspection: args.inspection,
      promptSnapshotRecord: execution.promptSnapshotRecord!,
      ...(args.debugOptions?.includePromptSnapshot && execution.promptSnapshotPreview
        ? {
            promptSnapshot: execution.promptSnapshotPreview,
          }
        : {}),
      ...(execution.runtimeTrace
        ? {
            runtimeTrace: execution.runtimeTrace,
          }
        : {}),
    };
  }

  private materializeTurnPromptMessages(
    messages: ChatMessage[],
    sendDirectives: PromptSendDirectives,
    assistantPrefillStrategy: AssistantPrefillExecutionStrategy,
    structurePolicy?: PromptStructurePolicy,
    deliveryPolicy?: PromptDeliveryPolicy,
  ): MaterializePromptRuntimeMessagesResult {
    return materializePromptRuntimeMessages({
      messages,
      sendDirectives,
      assistantPrefillStrategy,
      structurePolicy,
      deliveryPolicy,
      materializeAssistantPrefillFallback: true,
    });
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
    floorId: string,
    branchId: string | undefined,
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
      const scopeRefs = this.memoryScopeResolver.resolveVisibleRefs({ accountId, sessionId, branchId, floorId });
      const [recentSummaryItems, existingFacts] = await Promise.all([
        this.memoryStore.query({
          scopeRefs,
          accountId,
          type: "summary",
          status: "active",
          lifecycleStatus: "active",
          orderBy: "updatedAt",
          orderDir: "desc",
          limit: 20,
        }),
        this.memoryStore.query({
          scopeRefs,
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
        scope: "floor",
        scopeId: floorId,
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
  ): Promise<{
    branchExists: boolean;
    historySourceBranchId: string;
    historySourceMode: "existing_branch" | "source_floor_branch" | "main_fallback";
    nextFloorNo: number;
    parentFloorId: string | null;
    inheritanceSource?: { floorId: string; branchId: string };
  }> {
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
        branchExists: true,
        historySourceBranchId: branchId,
        historySourceMode: "existing_branch",
        nextFloorNo: lastFloorInBranch.floorNo + 1,
        parentFloorId: lastCommittedFloorInBranch?.id
          ?? lastFloorInBranch.parentFloorId
          ?? null,
      };
    }

    let sourceFloor: { id: string; floorNo: number; branchId: string } | null = null;

    if (sourceFloorId) {
      const [row] = await this.db
        .select({ id: floors.id, floorNo: floors.floorNo, branchId: floors.branchId })
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
        .select({ id: floors.id, floorNo: floors.floorNo, branchId: floors.branchId })
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
      branchExists: false,
      historySourceBranchId: sourceFloor?.branchId ?? "main",
      historySourceMode: sourceFloorId ? "source_floor_branch" : "main_fallback",
      nextFloorNo: (sourceFloor?.floorNo ?? -1) + 1,
      parentFloorId: sourceFloor?.id ?? null,
      ...(sourceFloor
        ? {
            inheritanceSource: { floorId: sourceFloor.id, branchId: sourceFloor.branchId },
          }
        : {}),
    };
  }
}

// ── 工具函数 ──────────────────────────────────────────

function mapPromptRuntimePreviewVariableItems(
  items: Array<{ key: string; value: unknown }> | undefined,
): Record<string, StMacroJsonValue> {
  if (!items || items.length === 0) {
    return {};
  }

  return toPromptRuntimePreviewJsonRecord(Object.fromEntries(items.map((item) => [item.key, item.value])));
}

function toPromptRuntimePreviewJsonRecord(values: Record<string, unknown>): Record<string, StMacroJsonValue> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value as StMacroJsonValue]),
  );
}

function buildFloorMetadataJson(
  userId: string | null,
  userSnapshotJson: string | null,
  replacedAt: number,
  userInputRaw?: string,
): string | null {
  const snapshotSummary = parseUserSnapshotSummary(userSnapshotJson);
  if (!userId && !snapshotSummary && typeof userInputRaw !== "string") {
    return null;
  }

  return JSON.stringify({
    ...(typeof userInputRaw === "string" ? { user_input_raw: userInputRaw } : {}),
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

function parseRegexCharacterName(characterSnapshotJson: string | null): string | null {
  if (!characterSnapshotJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(characterSnapshotJson) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    return name || null;
  } catch {
    return null;
  }
}

function parseRegexUserName(
  userSnapshotJson: string | null,
  metadataJson: string | null,
): string | null {
  if (userSnapshotJson) {
    try {
      const parsed = JSON.parse(userSnapshotJson) as Record<string, unknown>;
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      if (name) {
        return name;
      }
    } catch {
      // ignore and fall through to metadata persona
    }
  }

  if (!metadataJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    const persona = parsed.persona;
    if (!persona || typeof persona !== "object") {
      return null;
    }

    const personaRecord = persona as Record<string, unknown>;
    const name = typeof personaRecord.name === "string"
      ? personaRecord.name.trim()
      : "";
    return name || null;
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

function hasPromptRuntimeWorldbookSource(promptSnapshot: AssembleResult["promptSnapshot"]): boolean {
  return promptSnapshot.worldbook !== null || promptSnapshot.character?.characterBook !== undefined;
}

function hasPromptRuntimeExamplesSource(promptSnapshot: AssembleResult["promptSnapshot"]): boolean {
  return typeof promptSnapshot.character?.exampleDialogue === "string"
    && promptSnapshot.character.exampleDialogue.trim().length > 0;
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
