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
  type SessionPromptInfo,
  type AssembleDebugInfo,
} from "./prompt-assembler.js";
import type {
  TurnOrchestrator,
  TurnInput,
  TurnOutput,
  TurnConfig,
  ChatMessage,
  GenerationParams,
  InstanceSlot,
  ModelConfig,
  TokenCounter,
  MemoryInjectionOptions,
  MemoryStore,
  ToolPermissions,
  ToolCallRecord,
} from "@tavern/core";
import { ToolRegistry, BuiltinToolProvider } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { sessions, floors, messagePages, messages } from "../db/schema.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../accounts/constants.js";
import { normalizePositiveInt } from "../lib/utils.js";
import { ChatHistoryLoader } from "./chat-history-loader.js";
import { ChatMessagePersistence } from "./chat-message-persistence.js";
import { DrizzleToolRepository } from "../adapters/drizzle-tool-repository.js";

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
  totalUsage: TurnOutput["totalUsage"];
  /** 楼层最终状态 */
  finalState: TurnOutput["finalState"];
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
  totalUsage: TurnOutput["totalUsage"];
  /** 最终状态 */
  finalState: TurnOutput["finalState"];
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
  totalUsage: TurnOutput["totalUsage"];
  /** 最终状态 */
  finalState: TurnOutput["finalState"];
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
  private readonly toolRepo: DrizzleToolRepository;

  constructor(
    private readonly db: AppDb,
    private readonly orchestrator: TurnOrchestrator,
    private readonly tokenCounter: TokenCounter,
    options: ChatServiceOptions = {}
  ) {
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
    this.toolRepo = new DrizzleToolRepository(db);
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
    const floorId = nanoid();
    const now = Date.now();
    const floorMetadataJson = buildFloorMetadataJson(session.userId, session.userSnapshotJson, now);

    this.db.transaction((tx) => {
      tx.insert(floors).values({
        id: floorId,
        sessionId,
        floorNo: nextFloorNo,
        branchId,
        parentFloorId: branchContext.parentFloorId,
        state: "draft",
        metadataJson: floorMetadataJson,
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now,
        updatedAt: now
      }).run();

      this.messagePersistence.saveUserMessageWithExecutor(tx, floorId, request.message, now);
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
    const maxContextTokensOverride = normalizePositiveInt(request.generationParams?.maxContextTokens)
      ?? normalizePositiveInt(narratorParams?.maxContextTokens);

    const assembled = await assemblePrompt(
      this.db,
      sessionInfo,
      history,
      request.message,
      this.tokenCounter,
      memorySummary,
      { maxContextTokensOverride }
    );

    const generationParams: GenerationParams = {
      temperature: 0.7,
      maxOutputTokens: assembled.tokenUsage.availableForReply || 1000,
      stream: !!runtimeOptions.onChunk,
      ...this.stripMaxContextTokens(narratorParams),
      ...request.generationParams,
    };

    const turnConfig = this.resolveTurnConfig(request.config);
    const consolidationContext = await this.buildConsolidationContext(
      sessionId,
      request.message,
      turnConfig
    );

    const turnInput: TurnInput = {
      sessionId,
      floorId,
      messages: assembled.messages,
      generationParams,
      config: turnConfig,
      consolidationContext,
      preProcess: assembled.preProcess,
      postProcess: assembled.postProcess,
      modelOverrides: this.buildModelOverrides(resolvedTurnModels),
      generationParamsOverrides: this.buildGenerationParamsOverrides(resolvedTurnModels),
      onChunk: runtimeOptions.onChunk,
      abortSignal: runtimeOptions.abortSignal,
      toolRegistry: this.toolRegistry,
      toolPermissions: await this.resolveToolPermissionsForSession(sessionId, accountId),
    };

    let turnOutput: TurnOutput;
    try {
      turnOutput = await this.orchestrator.executeTurn(turnInput);
    } catch (error) {
      // Orchestrator 已经将楼层标记为 failed，
      // 我们只需包装错误重新抛出
      throw new ChatServiceError(
        "orchestration_failed",
        `Turn orchestration failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }

    await this.markTurnModelUsed(resolvedTurnModels, accountId);

    // ── 6. 保存助手回复 ──
    await this.messagePersistence.saveAssistantMessage(floorId, turnOutput.generatedText, now);

    // ── 6b. 记忆持久化 ──
    await this.persistMemory(turnOutput, sessionId, floorId);

    // ── 6c. 工具调用记录持久化 ──
    await this.persistToolCalls(turnOutput.toolCalls);

    // ── 7. 更新楼层 token 统计 ──
    const usage = normalizeTokenUsage(turnOutput.totalUsage);

    await this.db
      .update(floors)
      .set({
        tokenIn: usage.promptTokens,
        tokenOut: usage.completionTokens,
        updatedAt: Date.now(),
      })
      .where(eq(floors.id, floorId));

    return {
      floorId,
      floorNo: nextFloorNo,
      generatedText: turnOutput.generatedText,
      summaries: turnOutput.summaries,
      totalUsage: usage,
      finalState: turnOutput.finalState,
      branchId,
    };
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
      sessionInfo,
      history,
      request.message,
      this.tokenCounter,
      memorySummary,
      { includeDebug: true, maxContextTokensOverride }
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
    };

    return {
      messages: assembled.messages,
      tokenEstimate: assembled.tokenUsage.total,
      availableForReply: assembled.tokenUsage.availableForReply,
      memorySummary,
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

    // ── 2. 找到最后一个 committed 楼层 ──
    const targetFloor = await this.historyLoader.getLastCommittedFloor(sessionId);
    if (!targetFloor) {
      throw new ChatServiceError(
        "no_floor_to_regenerate",
        "No committed floor found to regenerate"
      );
    }

    // ── 3. 提取用户消息 ──
    const userMessage = await this.getUserMessageFromFloor(targetFloor.id);
    if (!userMessage) {
      throw new ChatServiceError(
        "no_user_message",
        `No user message found in floor '${targetFloor.id}'`
      );
    }

    // ── 4. 加载该楼层之前的历史 ──
    const history = await this.historyLoader.loadHistoryBeforeFloor(sessionId, targetFloor.floorNo);

    // ── 4b. 记忆检索 ──
    const memorySummary = await this.retrieveMemorySummary(sessionId);

    const newFloorId = nanoid();
    const now = Date.now();
    const floorMetadataJson = buildFloorMetadataJson(session.userId, session.userSnapshotJson, now);

    this.db.transaction((tx) => {
      tx
        .update(floors)
        .set({
          branchId: `superseded-${targetFloor.id}`,
          updatedAt: now
        })
        .where(eq(floors.id, targetFloor.id))
        .run();

      tx.insert(floors).values({
        id: newFloorId,
        sessionId,
        floorNo: targetFloor.floorNo,
        branchId: "main",
        parentFloorId: targetFloor.id,
        state: "draft",
        metadataJson: floorMetadataJson,
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now,
        updatedAt: now
      }).run();

      this.messagePersistence.saveUserMessageWithExecutor(tx, newFloorId, userMessage, now);
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
    const maxContextTokensOverride = normalizePositiveInt(request.generationParams?.maxContextTokens)
      ?? normalizePositiveInt(narratorParams?.maxContextTokens);

    const assembled = await assemblePrompt(
      this.db,
      sessionInfo,
      history,
      userMessage,
      this.tokenCounter,
      memorySummary,
      { maxContextTokensOverride }
    );

    const generationParams: GenerationParams = {
      temperature: 0.7,
      maxOutputTokens: assembled.tokenUsage.availableForReply || 1000,
      ...this.stripMaxContextTokens(narratorParams),
      ...request.generationParams,
    };

    const turnConfig = this.resolveTurnConfig(request.config);
    const consolidationContext = await this.buildConsolidationContext(
      sessionId,
      userMessage,
      turnConfig
    );

    const turnInput: TurnInput = {
      sessionId,
      floorId: newFloorId,
      messages: assembled.messages,
      generationParams,
      config: turnConfig,
      consolidationContext,
      preProcess: assembled.preProcess,
      postProcess: assembled.postProcess,
      modelOverrides: this.buildModelOverrides(resolvedTurnModels),
      generationParamsOverrides: this.buildGenerationParamsOverrides(resolvedTurnModels),
      toolRegistry: this.toolRegistry,
      toolPermissions: await this.resolveToolPermissionsForSession(sessionId, accountId),
    };

    let turnOutput: TurnOutput;
    try {
      turnOutput = await this.orchestrator.executeTurn(turnInput);
    } catch (error) {
      throw new ChatServiceError(
        "orchestration_failed",
        `Regeneration orchestration failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }

    await this.markTurnModelUsed(resolvedTurnModels, accountId);

    // ── 9. 保存助手回复 ──
    await this.messagePersistence.saveAssistantMessage(newFloorId, turnOutput.generatedText, now);

    // ── 9b. 记忆持久化 ──
    await this.persistMemory(turnOutput, sessionId, newFloorId);

    // ── 9c. 工具调用记录持久化 ──
    await this.persistToolCalls(turnOutput.toolCalls);

    // ── 10. 更新楼层 token 统计 ──
    const usage = normalizeTokenUsage(turnOutput.totalUsage);

    await this.db
      .update(floors)
      .set({
        tokenIn: usage.promptTokens,
        tokenOut: usage.completionTokens,
        updatedAt: Date.now(),
      })
      .where(eq(floors.id, newFloorId));

    return {
      floorId: newFloorId,
      floorNo: targetFloor.floorNo,
      previousFloorId: targetFloor.id,
      generatedText: turnOutput.generatedText,
      summaries: turnOutput.summaries,
      totalUsage: usage,
      finalState: turnOutput.finalState,
    };
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

    const userMessage = await this.getUserMessageFromFloor(targetFloor.id);
    if (!userMessage) {
      throw new ChatServiceError("no_user_message", `No user message found in floor '${floorId}'`);
    }

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
    const maxContextTokensOverride = normalizePositiveInt(request.generationParams?.maxContextTokens)
      ?? normalizePositiveInt(narratorParams?.maxContextTokens);

    const assembled = await assemblePrompt(
      this.db,
      sessionInfo,
      history,
      userMessage,
      this.tokenCounter,
      memorySummary,
      { maxContextTokensOverride }
    );

    const generationParams: GenerationParams = {
      temperature: 0.7,
      maxOutputTokens: assembled.tokenUsage.availableForReply || 1000,
      ...this.stripMaxContextTokens(narratorParams),
      ...request.generationParams,
    };

    const turnConfig = this.resolveTurnConfig(request.config);
    const consolidationContext = await this.buildConsolidationContext(
      targetFloor.sessionId,
      userMessage,
      turnConfig
    );

    const turnInput: TurnInput = {
      sessionId: targetFloor.sessionId,
      floorId: targetFloor.id,
      messages: assembled.messages,
      generationParams,
      config: turnConfig,
      consolidationContext,
      preProcess: assembled.preProcess,
      postProcess: assembled.postProcess,
      modelOverrides: this.buildModelOverrides(resolvedTurnModels),
      generationParamsOverrides: this.buildGenerationParamsOverrides(resolvedTurnModels),
      toolRegistry: this.toolRegistry,
      toolPermissions: await this.resolveToolPermissionsForSession(targetFloor.sessionId, accountId),
    };

    let turnOutput: TurnOutput;
    try {
      turnOutput = await this.orchestrator.executeTurn(turnInput);
    } catch (error) {
      throw new ChatServiceError(
        "orchestration_failed",
        `Retry orchestration failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }

    await this.markTurnModelUsed(resolvedTurnModels, accountId);

    await this.messagePersistence.saveAssistantMessage(targetFloor.id, turnOutput.generatedText, now);
    await this.persistMemory(turnOutput, targetFloor.sessionId, targetFloor.id);
    await this.persistToolCalls(turnOutput.toolCalls);

    const usage = normalizeTokenUsage(turnOutput.totalUsage);
    await this.db
      .update(floors)
      .set({ tokenIn: usage.promptTokens, tokenOut: usage.completionTokens, updatedAt: Date.now() })
      .where(eq(floors.id, targetFloor.id));

    return {
      floorId: targetFloor.id,
      floorNo: targetFloor.floorNo,
      branchId: targetFloor.branchId,
      generatedText: turnOutput.generatedText,
      summaries: turnOutput.summaries,
      totalUsage: usage,
      finalState: turnOutput.finalState,
    };
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

    const now = Date.now();
    const newFloorId = nanoid();
    const floorMetadataJson = buildFloorMetadataJson(session.userId, session.userSnapshotJson, now);

    await this.db.insert(floors).values({
      id: newFloorId,
      sessionId: source.sessionId,
      floorNo: source.floorNo + 1,
      branchId: newBranchId,
      parentFloorId: source.floorId,
      metadataJson: floorMetadataJson,
      state: "draft",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    const history = await this.historyLoader.loadHistoryBeforeFloor(source.sessionId, source.floorNo, source.branchId);
    const response = await this.generateForFloor({
      floorId: newFloorId,
      session,
      sessionId: source.sessionId,
      userMessage: request.content,
      history,
      request,
      now,
      accountId,
    });

    return {
      ...response,
      sourceFloorId: source.floorId,
      sourceMessageId: source.messageId,
    };
  }

  // ── 私有方法 ────────────────────────────────────────

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
    session: typeof sessions.$inferSelect;
    userMessage: string;
    history: ChatMessage[];
    request: RetryFloorRequest;
    now: number;
    accountId: string;
  }): Promise<RetryFloorResult> {
    const memorySummary = await this.retrieveMemorySummary(args.sessionId);

    await this.messagePersistence.saveUserMessage(args.floorId, args.userMessage, args.now);

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
    const maxContextTokensOverride = normalizePositiveInt(args.request.generationParams?.maxContextTokens)
      ?? normalizePositiveInt(narratorParams?.maxContextTokens);

    const assembled = await assemblePrompt(
      this.db,
      sessionInfo,
      args.history,
      args.userMessage,
      this.tokenCounter,
      memorySummary,
      { maxContextTokensOverride }
    );

    const generationParams: GenerationParams = {
      temperature: 0.7,
      maxOutputTokens: assembled.tokenUsage.availableForReply || 1000,
      ...this.stripMaxContextTokens(narratorParams),
      ...args.request.generationParams,
    };

    const turnConfig = this.resolveTurnConfig(args.request.config);
    const consolidationContext = await this.buildConsolidationContext(
      args.sessionId,
      args.userMessage,
      turnConfig
    );

    let turnOutput: TurnOutput;
    try {
      turnOutput = await this.orchestrator.executeTurn({
        sessionId: args.sessionId,
        floorId: args.floorId,
        messages: assembled.messages,
        generationParams,
        config: turnConfig,
        consolidationContext,
        preProcess: assembled.preProcess,
        postProcess: assembled.postProcess,
        modelOverrides: this.buildModelOverrides(resolvedTurnModels),
        generationParamsOverrides: this.buildGenerationParamsOverrides(resolvedTurnModels),
        toolRegistry: this.toolRegistry,
        toolPermissions: await this.resolveToolPermissionsForSession(args.sessionId, args.accountId),
      });
    } catch (error) {
      throw new ChatServiceError(
        "orchestration_failed",
        `Turn orchestration failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }

    await this.markTurnModelUsed(resolvedTurnModels, args.accountId);

    await this.messagePersistence.saveAssistantMessage(args.floorId, turnOutput.generatedText, args.now);
    await this.persistMemory(turnOutput, args.sessionId, args.floorId);
    await this.persistToolCalls(turnOutput.toolCalls);

    const usage = normalizeTokenUsage(turnOutput.totalUsage);
    await this.db
      .update(floors)
      .set({ tokenIn: usage.promptTokens, tokenOut: usage.completionTokens, updatedAt: Date.now() })
      .where(eq(floors.id, args.floorId));

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
      generatedText: turnOutput.generatedText,
      summaries: turnOutput.summaries,
      totalUsage: usage,
      finalState: turnOutput.finalState,
    };
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
    } catch {
      // 记忆检索失败不应阻断聊天流程
      return undefined;
    }
  }

  /**
   * 回合完成后持久化记忆（摘要入库）。
   * 如果未配置 MemoryStore 或回合无摘要，静默跳过。
   */
  private async persistMemory(
    turnOutput: TurnOutput,
    sessionId: string,
    floorId: string
  ): Promise<void> {
    if (!this.memoryStore) return;

    try {
      if (turnOutput.summaries && turnOutput.summaries.length > 0) {
        await this.memoryStore.ingestSummaries(
          turnOutput.summaries, "chat", sessionId, floorId
        );
      }
    } catch {
      // 记忆持久化失败不应阻断聊天流程
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

  /**
   * 持久化工具调用记录。
   */
  private async persistToolCalls(toolCalls?: ToolCallRecord[]): Promise<void> {
    if (!toolCalls || toolCalls.length === 0) return;

    try {
      await this.toolRepo.insertCallRecords(toolCalls);
    } catch {
      // 工具调用记录持久化失败不应阻断聊天流程
    }
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
    } catch {
      return undefined;
    }
  }

  /**
   * 从指定楼层中提取用户消息文本。
   * 查找 input page 下的第一条 user 消息。
   */
  private async getUserMessageFromFloor(floorId: string): Promise<string | null> {
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
      .select({ content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.pageId, inputPage.id),
          eq(messages.role, "user")
        )
      )
      .orderBy(asc(messages.seq))
      .limit(1);

    return userMsg?.content ?? null;
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

function normalizeToken(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  return Math.trunc(value);
}


function normalizeBranchId(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    return "main";
  }

  return normalized;
}

function normalizeTokenUsage(usage: { promptTokens: number; completionTokens: number; totalTokens: number }) {
  return {
    promptTokens: normalizeToken(usage.promptTokens),
    completionTokens: normalizeToken(usage.completionTokens),
    totalTokens: normalizeToken(usage.totalTokens),
  };
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
