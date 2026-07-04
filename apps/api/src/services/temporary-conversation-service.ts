import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  SimpleTokenCounter,
  type ChatMessage,
  type TokenCounter,
  type PromptRuntimeTrace,
} from "@tavern/core";

import type { AppDb } from "../db/client.js";
import {
  floorResultSnapshots,
  floors,
  messagePages,
  messages,
  pageStagedWrites,
    projects,
  sessions,
  toolExecutionRecords,
} from"../db/schema.js";
import { ChatMessagePersistence } from "./chat-message-persistence.js";
import { DraftFloorService } from "./chat/draft-floor-service.js";
import type {
  PromptRuntimeConversationWindow,
} from "./chat/prompt-preparation-service.js";
import { buildConversationHistoryWindow } from "./chat/conversation-history-normalizer.js";
import type { PromptHistoryMessageEntry } from "./chat-history-loader.js";
import type {
  RespondRuntimeOptions,
} from "./chat/contracts.js";
import { buildLivePromptRuntimeRequestPolicy } from "./chat/shared/request-policy.js";
import { normalizeBranchId } from "./chat/shared/branch.js";
import type { ChatService } from "./chat/chat-service.js";
import { ChatServiceError } from "./chat/errors.js";
import { resolvePromptRuntimeExecutionContext } from "./prompt-runtime-execution.js";
import {
  SessionBranchRegistryService,
  type SessionBranchAssetBindingState,
} from "./variables/host/session-branch-registry-service.js";
import {
    TemporaryConversationError,
} from "./temporary-conversation-errors.js";
import {
  GraphAssistantToolConfirmationService,
  type GraphAssistantPendingToolCallRecord,
} from "./graph-assistant-tool-confirmation-service.js";
import { GraphAssistantPromptConfigService } from "./graph-assistant-prompt-config-service.js";
import type { PromptRuntimeClientInjectionInput } from "./prompt-runtime-injection-types.js";
import {
  GRAPH_ASSISTANT_PURPOSE,
  TEMPORARY_CONVERSATION_BRANCH_ID,
  TEMPORARY_CONVERSATION_RETENTION_POLICIES,
  TEMPORARY_CONVERSATION_SESSION_KIND,
  TEMPORARY_CONVERSATION_STATUSES,
  TEMPORARY_CONVERSATION_VISIBILITIES,
  type TemporaryConversationAgentOrigin,
  type TemporaryConversationAppendInput,
  type TemporaryConversationCreateFromProjectInput,
  type TemporaryConversationCreateInput,
  type TemporaryConversationExportInput,
  type TemporaryConversationExportRecord,
  type TemporaryConversationExportResult,
  type TemporaryConversationHandle,
  type TemporaryConversationInspect,
  type TemporaryConversationInspectTranscriptFloor,
  type TemporaryConversationMessageRef,
  type TemporaryConversationResource,
  type TemporaryConversationRespondInput,
  type TemporaryConversationResult,
  type TemporaryConversationRetryInput,
  type TemporaryConversationRetryStepInput,
  type TemporaryConversationRetryStreamInput,
  type TemporaryConversationRetryStepStreamInput,
  type TemporaryConversationRetentionPolicy,
  type TemporaryConversationVisibility,
  type TemporaryConversationStreamChunk,
  type TemporaryConversationStreamInput,
  type TemporaryConversationTranscript,
  type TemporaryConversationTranscriptFloor,
  type TemporaryConversationTranscriptMessage,
  type TemporaryConversationTranscriptPage,
  type TemporaryConversationTranscriptStepNarration,
  type TemporaryConversationTranscriptToolExecution,
  isTemporaryConversationSessionLike,
} from "./temporary-conversation-types.js";

interface TemporaryConversationServiceOptions {
  tokenCounter?: TokenCounter;
}

/** 图助手一次性引导消息的专用 source 标记，用于幂等识别。 */
const GRAPH_ASSISTANT_GUIDANCE_SOURCE = "graph_assistant_guidance";

/** 图助手动态上下文注入的标题（仅参与 prompt 组装，不写入 transcript）。 */
const GRAPH_ASSISTANT_DYNAMIC_CONTEXT_TITLE = "Graph context";

/**
 * 把前端按回合求值的动态上下文文本包装成一条 request-scope client injection。
 *
 * 空串 / 纯空白视为未提供，返回空对象（不注入）。注入 placement 取
 * `before_current_user_input`：放在历史之后、当前用户输入之前，贴近「本回合上下文」语义。
 */
function buildDynamicContextInjection(
  dynamicContext: string | undefined,
): { promptRuntimeInjections?: PromptRuntimeClientInjectionInput[] } {
  const content = dynamicContext?.trim();
  if (!content) {
    return {};
  }
  return {
    promptRuntimeInjections: [
      {
        sourceKind: "client_injection",
        title: GRAPH_ASSISTANT_DYNAMIC_CONTEXT_TITLE,
        content,
        placement: "before_current_user_input",
        scope: "request",
      },
    ],
  };
}

interface PreparedDraftConversationState {
  branchId: string;
  floorId: string;
  floorNo: number;
  pageId: string | undefined;
  pageMessageId: string | undefined;
  sourceFloorId: string | null;
  rawUserMessage: string;
  conversationWindow: PromptRuntimeConversationWindow;
}

interface AsyncQueueState<T> {
  items: T[];
  waiting: Array<(value: IteratorResult<T>) => void>;
  done: boolean;
  error: unknown;
}

interface ExportableOutputPageMessage {
  pageId: string;
  floorId: string;
  floorNo: number;
  content: string;
  contentFormat: typeof messages.$inferSelect["contentFormat"];
}

export class TemporaryConversationService {
  private readonly draftFloorService: DraftFloorService;
  private readonly tokenCounter: TokenCounter;

  constructor(
    private readonly db: AppDb,
    private readonly chatService: ChatService,
    private readonly options: TemporaryConversationServiceOptions = {},
  ) {
    this.tokenCounter = options.tokenCounter ?? new SimpleTokenCounter();
    this.draftFloorService = new DraftFloorService(
      db,
      new ChatMessagePersistence(db, this.tokenCounter),
    );
  }

  async create(input: TemporaryConversationCreateInput): Promise<TemporaryConversationHandle> {
    const sourceSession = await this.requireSourceSession(input.accountId, input.sourceSessionId);
    const sourceBranchId = normalizeTemporaryConversationBranchId(input.sourceBranchId);
    const sourceBranch = new SessionBranchRegistryService(this.db).get(
      input.accountId,
      sourceSession.id,
      sourceBranchId,
    );
    const now = Date.now();
    const conversationId = nanoid();
    const purpose = normalizeOptionalText(input.purpose);
    const title = normalizeOptionalText(input.title)
      ?? buildTemporaryConversationTitle(sourceSession.title, purpose);
    const visibility = resolveTemporaryConversationVisibility(input.visibility);
    const retention = resolveTemporaryConversationRetention({
      retentionPolicy: input.retentionPolicy,
      ttlSeconds: input.ttlSeconds,
      now,
    });
    const metadataJson = sanitizeTemporaryConversationMetadataJson(sourceSession.metadataJson, purpose);
    const snapshotDigest = buildTemporaryConversationSnapshotDigest({
      title,
      metadataJson,
      sourceSession,
      sourceBranch,
    });
    const storedMetadataJson = mergeAgentOriginIntoMetadataJson(metadataJson, input.agentOrigin);

    this.db.transaction((tx) => {
      tx.insert(sessions).values({
        id: conversationId,
        title,
        accountId: sourceSession.accountId,
        workspaceId: sourceSession.workspaceId,
        projectId: sourceSession.projectId,
        characterId: sourceSession.characterId,
        characterVersionId: sourceSession.characterVersionId,
        characterSnapshotJson: sourceSession.characterSnapshotJson,
        characterSyncPolicy: sourceSession.characterSyncPolicy,
        userId: sourceSession.userId,
        userSnapshotJson: sourceSession.userSnapshotJson,
        status: "active",
        kind: TEMPORARY_CONVERSATION_SESSION_KIND,
        purpose,
        temporarySourceSessionId: sourceSession.id,
        temporarySnapshotDigest: snapshotDigest,
        retentionPolicy: retention.retentionPolicy,
        visibility,
        expiresAt: retention.expiresAt,
        finalizedAt: null,
        discardedAt: null,
        cancelledAt: null,
        lastActivityAt: now,
        presetId: sourceSession.presetId,
        regexProfileId: sourceSession.regexProfileId,
        worldbookProfileId: sourceSession.worldbookProfileId,
        deepBinding: sourceSession.deepBinding,
        presetVersionId: sourceSession.presetVersionId,
        worldbookVersionId: sourceSession.worldbookVersionId,
        regexProfileVersionId: sourceSession.regexProfileVersionId,
        modelProvider: sourceSession.modelProvider,
        modelName: sourceSession.modelName,
        modelParamsJson: sourceSession.modelParamsJson,
        promptMode: sourceSession.promptMode,
        metadataJson: storedMetadataJson,
        createdAt: now,
        updatedAt: now,
      }).run();

      new SessionBranchRegistryService(tx).ensure({
        accountId: sourceSession.accountId,
        sessionId: conversationId,
        branchId: TEMPORARY_CONVERSATION_BRANCH_ID,
        sourceFloorId: null,
        sourceBranchId,
        assetBinding: sourceBranch?.assetBinding ?? null,
        createdAt: now,
        updatedAt: now,
      });
    });

    return this.buildTemporaryConversationHandle({
      id: conversationId,
      title,
      accountId: sourceSession.accountId,
      workspaceId: sourceSession.workspaceId,
      projectId: sourceSession.projectId,
      status: TEMPORARY_CONVERSATION_STATUSES[0],
      kind: TEMPORARY_CONVERSATION_SESSION_KIND,
      purpose,
      temporarySourceSessionId: sourceSession.id,
      retentionPolicy: retention.retentionPolicy,
      visibility,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt: retention.expiresAt,
      finalizedAt: null,
      discardedAt: null,
      cancelledAt: null,
    } as typeof sessions.$inferSelect);
  }

  async createFromProject(input: TemporaryConversationCreateFromProjectInput): Promise<TemporaryConversationHandle> {
    const sourceProject = await this.requireSourceProject(input.accountId, input.projectId);
    const now = Date.now();
    const conversationId = nanoid();
    const purpose = normalizeOptionalText(input.purpose);
    const title = normalizeOptionalText(input.title)
      ?? buildTemporaryConversationTitle(sourceProject.name, purpose);
    const visibility = resolveTemporaryConversationVisibility(input.visibility);
    const retention = resolveTemporaryConversationRetention({
      retentionPolicy: input.retentionPolicy,
      ttlSeconds: input.ttlSeconds,
      now,
    });
    const metadataJson = buildTemporaryConversationMetadataJson(null, purpose);
    const snapshotDigest = buildTemporaryConversationProjectSnapshotDigest({
            title,
      metadataJson,
      sourceProject,
    });
    const storedMetadataJson = mergeAgentOriginIntoMetadataJson(metadataJson, input.agentOrigin);

    this.db.transaction((tx) => {
      tx.insert(sessions).values({
        id: conversationId,
        title,
        accountId: input.accountId,
        workspaceId: sourceProject.workspaceId,
        projectId: sourceProject.id,
        characterId: null,
        characterVersionId: null,
        characterSnapshotJson: null,
        characterSyncPolicy: "pin",
        userId: null,
        userSnapshotJson: null,
        status: "active",
        kind: TEMPORARY_CONVERSATION_SESSION_KIND,
        purpose,
        temporarySourceSessionId: null,
        temporarySnapshotDigest: snapshotDigest,
        retentionPolicy: retention.retentionPolicy,
        visibility,
        expiresAt: retention.expiresAt,
        finalizedAt: null,
        discardedAt: null,
        cancelledAt: null,
        lastActivityAt: now,
        presetId: null,
        regexProfileId: null,
        worldbookProfileId: null,
        deepBinding: false,
        presetVersionId: null,
        worldbookVersionId: null,
        regexProfileVersionId: null,
        modelProvider: null,
        modelName: null,
        modelParamsJson: null,
        promptMode: "native",
        metadataJson: storedMetadataJson,
        createdAt: now,
        updatedAt: now,
      }).run();

      new SessionBranchRegistryService(tx).ensure({
        accountId: input.accountId,
        sessionId: conversationId,
        branchId: TEMPORARY_CONVERSATION_BRANCH_ID,
        sourceFloorId: null,
        sourceBranchId: TEMPORARY_CONVERSATION_BRANCH_ID,
        assetBinding: null,
        createdAt: now,
        updatedAt: now,
      });
    });

    return this.buildTemporaryConversationHandle({
      id: conversationId,
      title,
      accountId: input.accountId,
      workspaceId: sourceProject.workspaceId,
      projectId: sourceProject.id,
      status: TEMPORARY_CONVERSATION_STATUSES[0],
      kind: TEMPORARY_CONVERSATION_SESSION_KIND,
      purpose,
      temporarySourceSessionId: null,
      retentionPolicy: retention.retentionPolicy,
      visibility,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt: retention.expiresAt,
      finalizedAt: null,
      discardedAt: null,
      cancelledAt: null,
    } as typeof sessions.$inferSelect);
  }

  async getDetail(input: {
    accountId: string;
    conversationId: string;
  }): Promise<TemporaryConversationResource> {
    const session = await this.getTemporaryConversation(input.accountId, input.conversationId);
    return this.toTemporaryConversationResource(session);
  }

  async appendMessage(input: TemporaryConversationAppendInput): Promise<TemporaryConversationMessageRef> {
    const session = await this.requireActiveTemporaryConversation(input.accountId, input.conversationId);
    return this.insertConversationMessage(session, {
      branchId: input.branchId,
      role: input.role,
      content: input.content,
    });
  }

  /**
   * 向已加载的临时对话 session 追加一条消息。
   *
   * 与 `appendMessage` 公开入口共用同一插入逻辑，额外允许指定 `source`（默认
   * `temporary_conversation`），供图助手一次性引导消息用专用 source 标记做幂等识别。
   */
  private async insertConversationMessage(
    session: typeof sessions.$inferSelect,
    input: { branchId?: string; role: TemporaryConversationAppendInput["role"]; content: string; source?: string },
  ): Promise<TemporaryConversationMessageRef> {
    const branchId = normalizeTemporaryConversationBranchId(input.branchId);
    const role = normalizeAppendRole(input.role);
    const content = requireMessageContent(input.content);
    const now = Date.now();
    const draftFloor = await this.ensureDraftFloor(session, branchId, now);
    const activePage = await this.ensureDraftPage(draftFloor.id, role, now);
    const seq = await this.loadNextMessageSeq(activePage.id);
    const messageId = nanoid();

    await this.db.insert(messages).values({
      id: messageId,
      pageId: activePage.id,
      seq,
      role,
      content,
      contentFormat: "text",
      tokenCount: this.tokenCounter.count(content),
      isHidden: false,
      source: input.source ?? "temporary_conversation",
      createdAt: now,
    });
    await this.touchConversation(session.id, now);

    return {
      conversationId: session.id,
      floorId: draftFloor.id,
      pageId: activePage.id,
      messageId,
      seq,
      role,
    };
  }

  /** 是否为图助手临时对话（按 purpose 判定）。 */
  private isGraphAssistantSession(session: typeof sessions.$inferSelect): boolean {
    return session.purpose === GRAPH_ASSISTANT_PURPOSE;
  }

  /**
   * 图助手会话强制启用 NodeGraph 工具。
   *
   * 非图助手会话原样返回传入 config（工具默认关闭）。图助手会话在原 config 基础上合并
   * `enableTools: true`；调用方未给 config 时也构造一个仅含该字段的 config。
   */
  private withGraphAssistantToolConfig(
    session: typeof sessions.$inferSelect,
    config: TemporaryConversationRespondInput["config"],
  ): TemporaryConversationRespondInput["config"] {
    if (!this.isGraphAssistantSession(session)) {
    return config;
    }
    return { ...(config ?? {}),enableTools: true };
  }

  /**
   * 首次为图助手会话注入一次性 system 引导消息。
   *
   * 仅对 purpose=graph-assistant 的会话生效，且经专用 source 标记做幂等：已存在引导消息时跳过。
   * 引导消息为可见 system 消息（历史装载会过滤 isHidden=true 的消息，故不能隐藏），
   * 说明可用工具集合、典型工作流与「除新建图外不直接改线上图」的边界。
   */
  private async maybeInjectGraphAssistantGuidance(
    session: typeof sessions.$inferSelect,
    branchId: string,
  ): Promise<void> {
    if (!this.isGraphAssistantSession(session)) {
      return;
    }
    const existing = await this.db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .where(and(
        eq(floors.sessionId, session.id),
        eq(messages.source, GRAPH_ASSISTANT_GUIDANCE_SOURCE),
      ))
      .limit(1);
  if (existing.length > 0) {
      return;
    }
    const content = new GraphAssistantPromptConfigService(this.db).resolveStaticPrompt({
      projectId: session.projectId,
    });
    await this.insertConversationMessage(session, {
      branchId,
      role: "system",
      content,
      source: GRAPH_ASSISTANT_GUIDANCE_SOURCE,
    });
  }

  async respond(input: TemporaryConversationRespondInput): Promise<TemporaryConversationResult> {
    const session = await this.requireActiveTemporaryConversation(input.accountId, input.conversationId);
    const branchId = normalizeTemporaryConversationBranchId(input.branchId);

    await this.maybeInjectGraphAssistantGuidance(session, branchId);

    if (input.inputMessage) {
      await this.appendMessage({
        accountId: input.accountId,
        conversationId: input.conversationId,
        branchId,
        role: input.inputMessage.role,
        content: input.inputMessage.content,
      });
    }

    const prepared = await this.prepareDraftConversation(session, branchId, {
      structure: input.structure,
      delivery: input.delivery,
    });
    await this.promoteDraftFloorToGenerating(prepared.floorId);

    const result = await this.chatService.respondFromPreparedDraftFloor({
      sessionId: session.id,
      accountId: input.accountId,
      branchId: prepared.branchId,
      floorId: prepared.floorId,
      floorNo: prepared.floorNo,
      pageId: prepared.pageId,
      pageMessageId: prepared.pageMessageId,
      sourceFloorId: prepared.sourceFloorId,
request: {
        config: this.withGraphAssistantToolConfig(session, input.config),
        generationParams: input.generationParams,
        promptIntent: input.promptIntent,
        debugOptions: input.debugOptions,
        structure: input.structure,
        delivery: input.delivery,
        ...(input.toolTransportPreference
          ? { toolTransportPreference: input.toolTransportPreference }
          : {}),
        ...buildDynamicContextInjection(input.dynamicContext),
      },
      rawUserMessage: prepared.rawUserMessage,
      executionContext: resolvePromptRuntimeExecutionContext({
        sessionId: session.id,
        metadataJson: session.metadataJson,
        branchId: prepared.branchId,
        branchExists: true,
        historySourceBranchId: prepared.branchId,
        historySourceMode:"existing_branch",
        sourceFloorId: prepared.sourceFloorId,
        request: buildLivePromptRuntimeRequestPolicy({
          structure: input.structure,
          delivery: input.delivery,
        }),
      }),
      conversationWindow: prepared.conversationWindow,
      runtimeOptions: {
             ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      },
    });
    await this.touchConversation(session.id);

    return {
      conversationId: session.id,
      branchId: prepared.branchId,
      floorId: result.floorId,
      floorNo: prepared.floorNo,
      pageId: result.outputPageId,
      text: result.generatedText,
      usage: result.totalUsage,
      finalState: result.finalState,
      finishReason: resolveTemporaryConversationFinishReason(result.runtimeTrace),
      warnings: resolveTemporaryConversationWarnings(result.runtimeTrace),
    };
  }

  /**
   * 列出某临时对话当前处于 `pending` 的待确认工具调用。
   *
   * 仅图助手（purpose=graph-assistant）会话会产生待确认记录；其他会话返回空列表。
   */
  async listPendingToolCalls(input: {
    accountId: string;
    conversationId: string;
  }): Promise<GraphAssistantPendingToolCallRecord[]> {
    await this.requireActiveTemporaryConversation(input.accountId, input.conversationId);
    return new GraphAssistantToolConfirmationService(this.db).listPending({
      conversationId: input.conversationId,
    });
  }

  /**
   * 解决一条待确认工具调用：批准或拒绝。
   *
   * - 批准：标记 `approved`，随即发起一次续跑。续跑会先执行已批准的工具，
   *   再自动多轮 agent 循环直到自然停止或再次遇 confirm 工具（决策 C）。
   * - 拒绝：标记 `rejected`，不执行，向 transcript 注入一条说明消息（决策 E），
   *   控制权交回用户，等下一条消息。
   */
  async resolveToolConfirmation(input: {
    accountId: string;
    conversationId: string;
    confirmationId: string;
    decision: "approve" | "reject";
  }): Promise<
    | { decision: "approved"; pending: GraphAssistantPendingToolCallRecord; result: TemporaryConversationResult }
    | { decision: "rejected"; pending: GraphAssistantPendingToolCallRecord }
  > {
    const session = await this.requireActiveTemporaryConversation(input.accountId, input.conversationId);
    const confirmationService = new GraphAssistantToolConfirmationService(this.db);
    const pending = confirmationService.getById(input.confirmationId);
    if (!pending || pending.conversationId !== input.conversationId) {
      throw new TemporaryConversationError(
        "pending_tool_call_not_found",
        `Pending tool call '${input.confirmationId}' not found in this conversation.`,
      );
    }
    if (pending.status !== "pending") {
      throw new TemporaryConversationError(
        "pending_tool_call_not_pending",
        `Pending tool call '${input.confirmationId}' is '${pending.status}', cannot resolve.`,
      );
    }

    if (input.decision === "reject") {
      const rejected = confirmationService.reject(input.confirmationId);
      const branchId = normalizeTemporaryConversationBranchId(undefined);
      await this.insertConversationMessage(session, {
        branchId,
        role: "system",
        content: `用户拒绝了工具调用 ${pending.toolName}。请不要再执行该调用，可改用其他方式继续。`,
      });
      await this.touchConversation(session.id);
      return { decision: "rejected", pending: rejected };
    }

    const approved = confirmationService.approve(input.confirmationId);
    // 批准后自动续跑：以一条「继续」用户消息驱动既有 respond 管线。
    // buildGraphAssistantAgentLoopTurnConfig 会侦测到该已批准记录并先执行已批准工具，再续跑多轮。
    const result = await this.respond({
      accountId: input.accountId,
      conversationId: input.conversationId,
      inputMessage: {
        role: "user",
        content: `（已批准工具调用 ${pending.toolName}，请继续）`,
      },
    });
    return { decision: "approved", pending: approved, result };
  }

  async *stream(input: TemporaryConversationStreamInput): AsyncIterable<TemporaryConversationStreamChunk> {
    const queue = createAsyncQueue<TemporaryConversationStreamChunk>();

    void this.respondWithRuntimeEvents(input, {
      onStart: (context) => {
        queue.push({
          type: "start",
          floorId: context.floorId,
          floorNo: context.floorNo,
          branchId: context.branchId,
        });
      },
      onChunk: (chunk) => {
        queue.push({ type: "delta", text: chunk });
      },
      onReasoning: (delta) => {
        queue.push({ type: "reasoning", text: delta });
      },
      onStepNarration: (narration) => {
        queue.push({
          type: "narration",
          stepIndex: narration.stepIndex,
          text: narration.text,
          createdAt: narration.createdAt,
        });
      },
      onTool: (event) => {
        queue.push({ type: "tool", event});
      },
      onRun: (event) => {
        queue.push({ type: "run", event });
      },
    }).then((result) => {
      queue.push({ type: "result", result });
      queue.close();
    }).catch((error) => {
      queue.fail(error);
    });

    for await (const chunk of queue.stream()) {
      yield chunk;
    }
  }
  /**
   * 图助手 floor级重试：在目标已提交楼层上重生成，产生新 output page version（开新消息页）。
   *
   * 委托主会话 chatService.retryFloor（allowTemporary），复用其「同楼层新 page version」语义；
   * 旧页历史保留，仅多占少量数据空间。
   */
  async retryFloor(input: TemporaryConversationRetryInput): Promise<TemporaryConversationResult> {
    return this.runRetry(input, {});
  }

  /**
   * 图助手 step 级重试：保留前 N-1 步成功工具往返，从第 fromStepIndex 步重生成。
   *
   * 委托chatService.retryStep；前缀往返由后端从 tool_execution_record 重建，起点带写副作用时拒绝。
   */
  async retryStep(input: TemporaryConversationRetryStepInput): Promise<TemporaryConversationResult> {
    return this.runRetry(input, {});
  }

  /** floor 级重试的流式版本（与 respond stream 一致的 chunk 联合）。 */
  async *retryStream(input: TemporaryConversationRetryStreamInput): AsyncIterable<TemporaryConversationStreamChunk> {
    yield* this.runRetryStream(input);
  }

  /** step 级重试的流式版本。 */
  async *retryStepStream(input: TemporaryConversationRetryStepStreamInput): AsyncIterable<TemporaryConversationStreamChunk> {
    yield* this.runRetryStream(input);
  }

  private async *runRetryStream(
    input: TemporaryConversationRetryInput & { fromStepIndex?: number },
  ): AsyncIterable<TemporaryConversationStreamChunk> {
    const queue= createAsyncQueue<TemporaryConversationStreamChunk>();

    void this.runRetry(input, {
      onStart: (context) => {
        queue.push({
          type:"start",
          floorId: context.floorId,
          floorNo: context.floorNo,
          branchId: context.branchId,
        });
      },
      onChunk: (chunk) => {
        queue.push({ type: "delta", text: chunk });
      },
      onReasoning: (delta) => {
        queue.push({ type: "reasoning", text: delta });
      },
      onStepNarration: (narration) => {
        queue.push({
          type: "narration",
          stepIndex: narration.stepIndex,
          text: narration.text,
          createdAt: narration.createdAt,
        });
      },
      onTool: (event) => {
        queue.push({ type: "tool", event });
      },
      onRun: (event) => {
        queue.push({ type: "run", event });
      },
    }).then((result) => {
      queue.push({ type: "result", result });
      queue.close();
    }).catch((error) => {
      queue.fail(error);
    });

    for await (const chunk of queue.stream()) {
      yield chunk;
    }
  }

  /**
   * 重试核心：校验目标楼层归属本会话后，构造请求并委托 chatService.retryFloor / retryStep。
   *
   * fromStepIndex 存在走 step 重试（携 priorRoundtrips），否则走整轮重试。并发保护与副作用
   * 校验由 chatService 内部承担；ChatServiceError 映射为 TemporaryConversationError 供路由统一处理。
   */
  private async runRetry(
    input: TemporaryConversationRetryInput & { fromStepIndex?: number },
    runtimeOptions: Pick<
      RespondRuntimeOptions,
      "onStart" | "onChunk" | "onReasoning" | "onStepNarration" | "onTool" | "onRun"
    >,
  ): Promise<TemporaryConversationResult> {
    const session = await this.requireActiveTemporaryConversation(input.accountId, input.conversationId);
    const branchId = normalizeTemporaryConversationBranchId(input.branchId);

    // 跨会话防护：重试目标楼层必须属于本临时对话。
    const targetFloorRows = await this.db
      .select({ sessionId: floors.sessionId })
      .from(floors)
      .where(eq(floors.id, input.floorId))
      .limit(1);
    if (!targetFloorRows[0] || targetFloorRows[0].sessionId !== session.id) {
      throw new TemporaryConversationError(
        "retry_target_not_found",
        `Retry target floor '${input.floorId}' not found in this conversation.`,
      );
    }

    await this.maybeInjectGraphAssistantGuidance(session, branchId);

    const dynamicInjection = buildDynamicContextInjection(input.dynamicContext);
    const promptRuntimeInjections = [
      ...(input.promptRuntimeInjections ?? []),
      ...(dynamicInjection.promptRuntimeInjections ?? []),
    ];
    const request = {
      config: this.withGraphAssistantToolConfig(session, input.config),
      ...(input.generationParams ? { generationParams: input.generationParams } : {}),
      ...(input.debugOptions ? { debugOptions: input.debugOptions } : {}),
      ...(input.structure ? { structure: input.structure } : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
      ...(promptRuntimeInjections.length > 0 ? { promptRuntimeInjections } : {}),
      ...(input.confirmedExecutionIds ? { confirmedExecutionIds: input.confirmedExecutionIds } : {}),
      ...(input.confirmedSessionStateMutationIds
        ? { confirmedSessionStateMutationIds: input.confirmedSessionStateMutationIds }
        : {}),
    };
    const callOptions = {
      allowTemporary: true as const,
      runtimeOptions: {
        ...runtimeOptions,
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      },
    };

    try {
      if (input.fromStepIndex !== undefined) {
        const result = await this.chatService.retryStep(
          input.floorId,
          { ...request, fromStepIndex: input.fromStepIndex },
          input.accountId,
          callOptions,
        );
        await this.touchConversation(session.id);
        return {
          conversationId: session.id,
          branchId: result.branchId,
          floorId: result.floorId,
          floorNo: result.floorNo,
          pageId: result.outputPageId ?? "",
          text: result.generatedText,
          usage: result.totalUsage,
          finalState: result.finalState,
          finishReason: resolveTemporaryConversationFinishReason(result.runtimeTrace),
          warnings: resolveTemporaryConversationWarnings(result.runtimeTrace),
          discardedFromStepIndex: result.discardedFromStepIndex,
          irreversibleSideEffects: result.irreversibleSideEffects,
        };
      }

      const result = await this.chatService.retryFloor(input.floorId, request, input.accountId, callOptions);
      await this.touchConversation(session.id);
      return {
        conversationId: session.id,
        branchId: result.branchId,
        floorId: result.floorId,
        floorNo: result.floorNo,
        pageId: result.outputPageId ?? "",
        text: result.generatedText,
        usage: result.totalUsage,
        finalState: result.finalState,
        finishReason: resolveTemporaryConversationFinishReason(result.runtimeTrace),
        warnings: resolveTemporaryConversationWarnings(result.runtimeTrace),
      };
    } catch (error) {
      throw mapChatServiceErrorToTemporaryConversationError(error);
    }
  }


  async readTranscript(input: {
    accountId: string;
    conversationId: string;
    branchId?: string;
}): Promise<TemporaryConversationTranscript> {
    const session = await this.getTemporaryConversation(input.accountId, input.conversationId);
    const branchId = normalizeTemporaryConversationBranchId(input.branchId);
    const floors = await this.loadTranscriptFloors(session.id, branchId);

    return {
      conversationId: session.id,
      branchId,
      floors,
    };
  }

  async inspect(input: {
    accountId: string;
    conversationId: string;
    branchId?: string;
    includeAgentPrivateContent?: boolean;
  }): Promise<TemporaryConversationInspect> {
    const session = await this.getTemporaryConversation(input.accountId, input.conversationId);
    const branchId = normalizeTemporaryConversationBranchId(input.branchId);
    const resource = this.toTemporaryConversationResource(session);
    const agentOrigin = readAgentOriginFromMetadataJson(session.metadataJson);
    const agentPrivate = resource.visibility === "internal" || agentOrigin !== null;
    const includeAgentPrivateContent = input.includeAgentPrivateContent === true;
    const transcriptRestricted = agentPrivate && !includeAgentPrivateContent;

    const floors = await this.loadTranscriptFloors(session.id, branchId);
    const inspectFloors = floors.map((floor) => toInspectTranscriptFloor(floor, transcriptRestricted));
    const exports = await this.loadExportRecords(session.id);

    return {
      conversation: resource,
      agentPrivate,
      transcriptRestricted,
      sourceSnapshot: {
        digest: session.temporarySnapshotDigest,
        sourceSessionId: session.temporarySourceSessionId,
      },
      agentOrigin: transcriptRestricted ? null : agentOrigin,
      cleanup: {
        cleaned: session.cleanedAt !== null,
        cleanedAt: session.cleanedAt,
        retentionPolicy: resource.retentionPolicy,
      },
      transcript: {
        conversationId: session.id,
        branchId,
        floors: inspectFloors,
      },
      exports,
    };
  }

  private async loadExportRecords(
    conversationId: string,
  ): Promise<TemporaryConversationExportRecord[]> {
    const rows = await this.db
      .select({
        stagedWriteId: pageStagedWrites.id,
        sourceKind: pageStagedWrites.sourceKind,
        targetSessionId: pageStagedWrites.sessionId,
        targetPageId: pageStagedWrites.pageId,
        sourcePageId: pageStagedWrites.sourcePageId,
        status: pageStagedWrites.status,
        reason: pageStagedWrites.reason,
        createdAt: pageStagedWrites.createdAt,
        updatedAt: pageStagedWrites.updatedAt,
        appliedAt: pageStagedWrites.appliedAt,
        discardedAt: pageStagedWrites.discardedAt,
      })
      .from(pageStagedWrites)
      .where(eq(pageStagedWrites.sourceSessionId, conversationId))
      .orderBy(desc(pageStagedWrites.createdAt), desc(pageStagedWrites.id));

    return rows.map((row) => ({
      stagedWriteId: row.stagedWriteId,
      deliveryTarget: "page_staged_write",
      targetSessionId: row.targetSessionId,
      targetPageId: row.targetPageId,
      sourcePageId: row.sourcePageId,
      status: row.status,
      reason: row.reason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      appliedAt: row.appliedAt,
      discardedAt: row.discardedAt,
    }));
  }

  private async loadTranscriptFloors(
    sessionId: string,
    branchId: string,
  ): Promise<TemporaryConversationTranscriptFloor[]> {
    const floorRows = await this.db
      .select({
        id: floors.id,
        floorNo: floors.floorNo,
        branchId: floors.branchId,
        parentFloorId: floors.parentFloorId,
        state: floors.state,
        tokenIn: floors.tokenIn,
        tokenOut: floors.tokenOut,
        createdAt: floors.createdAt,
        updatedAt: floors.updatedAt,
      })
      .from(floors)
      .where(and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
        isNull(floors.supersededAt),
      ))
      .orderBy(asc(floors.floorNo), asc(floors.createdAt));

    const pagesByFloor = new Map<string, TemporaryConversationTranscriptPage[]>();
    const messagesByPage = new Map<string, TemporaryConversationTranscriptMessage[]>();

    const pageRows = floorRows.length === 0
      ? []
      : await this.db
          .select({
            id: messagePages.id,
            floorId: messagePages.floorId,
            pageNo: messagePages.pageNo,
            pageKind: messagePages.pageKind,
            isActive: messagePages.isActive,
            version: messagePages.version,
            checksum: messagePages.checksum,
            createdAt: messagePages.createdAt,
            updatedAt: messagePages.updatedAt,
          })
          .from(messagePages)
          .where(inArray(messagePages.floorId, floorRows.map((row) => row.id)))
          .orderBy(asc(messagePages.floorId), asc(messagePages.pageNo), asc(messagePages.version));

    for (const pageRow of pageRows) {
      const pages = pagesByFloor.get(pageRow.floorId) ?? [];
      pages.push({
        id: pageRow.id,
        pageNo: pageRow.pageNo,
        pageKind: pageRow.pageKind,
        isActive: pageRow.isActive,
        version: pageRow.version,
        checksum: pageRow.checksum,
        createdAt: pageRow.createdAt,
        updatedAt: pageRow.updatedAt,
        messages: [],
      });
      pagesByFloor.set(pageRow.floorId, pages);
    }

    const messageRows = pageRows.length === 0
      ? []
      : await this.db
          .select({
            id: messages.id,
            pageId: messages.pageId,
            seq: messages.seq,
            role: messages.role,
            content: messages.content,
            contentFormat: messages.contentFormat,
            isHidden: messages.isHidden,
            source: messages.source,
             createdAt: messages.createdAt,
          })
          .from(messages)
          .where(inArray(messages.pageId, pageRows.map((row) => row.id)))
          .orderBy(asc(messages.pageId), asc(messages.seq));

  // 思维链与中间叙述：关联 floor_result_snapshot 读取已提交楼层的 reasoning_text 与 step_narrations_json。
    const reasoningByFloor = new Map<string, string | null>();
    const stepNarrationsByFloor = new Map<string, TemporaryConversationTranscriptStepNarration[]>();
    if (floorRows.length > 0) {
      const snapshotRows = await this.db
        .select({
          floorId: floorResultSnapshots.floorId,
          reasoningText: floorResultSnapshots.reasoningText,
          stepNarrationsJson: floorResultSnapshots.stepNarrationsJson,
        })
        .from(floorResultSnapshots)
        .where(inArray(floorResultSnapshots.floorId, floorRows.map((row) => row.id)));
      for (const snapshotRow of snapshotRows) {
        reasoningByFloor.set(snapshotRow.floorId, snapshotRow.reasoningText ?? null);
        stepNarrationsByFloor.set(snapshotRow.floorId, parseStepNarrations(snapshotRow.stepNarrationsJson));
      }
    }

    // 工具执行：按 floorId 关联tool_execution_record（工具执行主审计真相），startedAt 升序。
    // 与 message 并列挂在 floor 上的旁路数组，不进 floor→page→message 层级、不参与 prompt 投影。
    // 版本对齐：楼层可能留有多次生成（respond / 楼层重试 / step 重试，各是一次独立 run）的执行记录。
    // 「开新消息页」后旧输出页版本仍保留在库里，但当前 step 视图只应反映「当前这次生成」，否则旧版本页的
    // 工具步会与新生成的工具步按 started_at 混排，让用户误以为重试是在原步之后追加/替换。这里沿用 step
    // 重试前缀重建（step-retry-prefix）的口径：按 started_at 取该层最后一条（优先已提交）执行的 run_id 作为
    // 「当前生成」，只带出该 run 的执行记录。
    const toolExecutionsByFloor = new Map<string, TemporaryConversationTranscriptToolExecution[]>();
    if (floorRows.length > 0) {
      const execRows = await this.db
        .select({
          id: toolExecutionRecords.id,
          runId: toolExecutionRecords.runId,
          floorId: toolExecutionRecords.floorId,
          toolName: toolExecutionRecords.toolName,
          argsJson: toolExecutionRecords.argsJson,
          resultJson: toolExecutionRecords.resultJson,
     status: toolExecutionRecords.status,
          commitOutcome: toolExecutionRecords.commitOutcome,
          sideEffectLevel: toolExecutionRecords.sideEffectLevel,
          errorMessage: toolExecutionRecords.errorMessage,
          durationMs: toolExecutionRecords.durationMs,
          startedAt: toolExecutionRecords.startedAt,
          finishedAt: toolExecutionRecords.finishedAt,
          attemptNo: toolExecutionRecords.attemptNo,
          replayParentExecutionId: toolExecutionRecords.replayParentExecutionId,
          generationStepNo: toolExecutionRecords.generationStepNo,
        })
        .from(toolExecutionRecords)
        .where(inArray(toolExecutionRecords.floorId, floorRows.map((row) => row.id)))
        .orderBy(asc(toolExecutionRecords.floorId), asc(toolExecutionRecords.startedAt));

      //先按 started_at 升序定位每层「当前生成」的 run_id：已提交优先（最后一条已提交），
      // 无已提交时退化为最后一条执行的 run_id（best-effort，兼容仍在生成或历史缺失场景）。
      const lastCommittedRunIdByFloor = new Map<string, string>();
      const lastAnyRunIdByFloor = new Map<string, string>();
      for (const execRow of execRows) {
        lastAnyRunIdByFloor.set(execRow.floorId, execRow.runId);
        if (execRow.commitOutcome === "committed") {
          lastCommittedRunIdByFloor.set(execRow.floorId, execRow.runId);
        }
      }
      const currentRunIdByFloor = new Map<string, string>();
      for (const [floorId, lastAnyRunId] of lastAnyRunIdByFloor) {
        currentRunIdByFloor.set(floorId, lastCommittedRunIdByFloor.get(floorId) ?? lastAnyRunId);
      }

      for (const execRow of execRows) {
        // 只保留「当前生成」这一 run 的执行：旧输出页版本的执行不进当前 step 视图。
        if (currentRunIdByFloor.get(execRow.floorId) !== execRow.runId) {
          continue;
        }
        const list = toolExecutionsByFloor.get(execRow.floorId) ?? [];
        list.push({
          id: execRow.id,
          toolName: execRow.toolName,
          status: execRow.status,
          args: parseTranscriptToolJson(execRow.argsJson),
          result: parseTranscriptToolJson(execRow.resultJson),
          sideEffectLevel: execRow.sideEffectLevel,
          commitOutcome: execRow.commitOutcome,
     errorMessage: execRow.errorMessage,
          durationMs: execRow.durationMs,
          startedAt: execRow.startedAt,
          finishedAt: execRow.finishedAt,
          attemptNo: execRow.attemptNo,
          replayParentExecutionId: execRow.replayParentExecutionId,
          generationStepNo: execRow.generationStepNo?? null,
        });
        toolExecutionsByFloor.set(execRow.floorId, list);
      }
    }

    for (const row of messageRows) {
      const pageMessages = messagesByPage.get(row.pageId) ?? [];
      pageMessages.push({
        id: row.id,
        seq: row.seq,
        role: row.role,
        content: row.content,
        contentFormat: row.contentFormat,
        isHidden: row.isHidden,
        source: row.source,
        createdAt: row.createdAt,
      });
      messagesByPage.set(row.pageId, pageMessages);
    }

    const transcriptFloors: TemporaryConversationTranscriptFloor[] = floorRows.map((floorRow) => {
      const pages = pagesByFloor.get(floorRow.id) ?? [];
      return {
        id: floorRow.id,
        floorNo: floorRow.floorNo,
        branchId: floorRow.branchId,
        parentFloorId: floorRow.parentFloorId,
        state: floorRow.state,
        tokenIn: floorRow.tokenIn,
        tokenOut: floorRow.tokenOut,
        createdAt: floorRow.createdAt,
        updatedAt: floorRow.updatedAt,
        reasoningText: reasoningByFloor.get(floorRow.id) ?? null,
        stepNarrations: stepNarrationsByFloor.get(floorRow.id) ?? [],
        toolExecutions: toolExecutionsByFloor.get(floorRow.id) ?? [],
        pages: pages.map((page) => ({
          ...page,
          messages: messagesByPage.get(page.id) ?? [],
        })),
      };
    });

    return transcriptFloors;
  }

  async finalize(input: {
    accountId: string;
    conversationId: string;
  }): Promise<TemporaryConversationResource> {
    return this.transitionConversationTerminalState(input.accountId, input.conversationId, "finalized");
  }

  async discard(input: {
    accountId: string;
    conversationId: string;
  }): Promise<TemporaryConversationResource> {
    return this.transitionConversationTerminalState(input.accountId, input.conversationId, "discarded");
  }

  async cancel(input: {
    accountId: string;
    conversationId: string;
  }): Promise<TemporaryConversationResource> {
    return this.transitionConversationTerminalState(input.accountId, input.conversationId, "cancelled");
  }

  async exportResult(input: TemporaryConversationExportInput): Promise<TemporaryConversationExportResult> {
    const session = await this.requireActiveTemporaryConversation(input.accountId, input.conversationId);
    if (input.target !== "page_staged_write") {
      throw new TemporaryConversationError(
        "unsupported_export_target",
        `Unsupported temporary conversation export target '${input.target}'.`,
      );
    }

    const sourceOutput = input.sourceOutputPageId
      ? await this.loadExportableOutputPageMessage(session.id, input.sourceOutputPageId)
      : await this.loadLatestExportableOutputPageMessage(session.id);
    if (!sourceOutput) {
      throw new TemporaryConversationError(
        "source_output_page_not_found",
        "Temporary conversation has no exportable output page.",
      );
    }

    const targetPage = await this.db
      .select({
        sessionId: floors.sessionId,
        branchId: floors.branchId,
        floorId: floors.id,
        pageId: messagePages.id,
      })
      .from(messagePages)
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(
        eq(sessions.accountId, input.accountId),
        eq(messagePages.id, input.targetPageId),
      ))
      .limit(1);

    const target = targetPage[0];
    if (!target) {
      throw new TemporaryConversationError(
        "target_page_not_found",
        `Target page '${input.targetPageId}' was not found.`,
      );
    }

    const now = Date.now();
    const stagedWriteId = nanoid();
    await this.db.insert(pageStagedWrites).values({
      id: stagedWriteId,
      accountId: input.accountId,
      sessionId: target.sessionId,
      branchId: target.branchId,
      floorId: target.floorId,
      pageId: target.pageId,
      sourceKind: "temporary_conversation",
      sourceSessionId: session.id,
      sourcePageId: sourceOutput.pageId,
      actorClientId: null,
      content: sourceOutput.content,
      contentFormat: sourceOutput.contentFormat,
      reason: normalizeTemporaryConversationExportReason(input.reason),
      status: "staged",
      metadataJson: JSON.stringify({
        purpose: session.purpose,
        source_floor_id: sourceOutput.floorId,
        source_floor_no: sourceOutput.floorNo,
      }),
      createdAt: now,
      updatedAt: now,
      appliedAt: null,
      discardedAt: null,
    });
    await this.touchConversation(session.id, now);

    return {
      conversationId: session.id,
      target: "page_staged_write",
      stagedWriteId,
      targetPageId: target.pageId,
      sourcePageId: sourceOutput.pageId,
      createdAt: now,
      status: "staged",
    };
  }

  private async respondWithRuntimeEvents(
    input: TemporaryConversationStreamInput,
    runtimeOptions: Pick<RespondRuntimeOptions, "onStart" | "onChunk" | "onReasoning" | "onStepNarration" | "onTool" | "onRun">,
  ): Promise<TemporaryConversationResult> {
    const session = await this.requireActiveTemporaryConversation(input.accountId, input.conversationId);
    const branchId = normalizeTemporaryConversationBranchId(input.branchId);

    await this.maybeInjectGraphAssistantGuidance(session, branchId);

    if (input.inputMessage) {
      await this.appendMessage({
        accountId: input.accountId,
        conversationId: input.conversationId,
        branchId,
        role: input.inputMessage.role,
        content: input.inputMessage.content,
      });
    }

    const prepared = await this.prepareDraftConversation(session, branchId, {
      structure: input.structure,
      delivery: input.delivery,
    });

    await this.promoteDraftFloorToGenerating(prepared.floorId);

    const result = await this.chatService.respondFromPreparedDraftFloor({
      sessionId: session.id,
      accountId: input.accountId,
      branchId: prepared.branchId,
      floorId: prepared.floorId,
      floorNo: prepared.floorNo,
      pageId: prepared.pageId,
      pageMessageId: prepared.pageMessageId,
      sourceFloorId: prepared.sourceFloorId,
      request: {
        config: this.withGraphAssistantToolConfig(session, input.config),
        generationParams: input.generationParams,
        promptIntent: input.promptIntent,
        debugOptions: input.debugOptions,
        structure: input.structure,
        delivery: input.delivery,
        ...(input.toolTransportPreference
          ? { toolTransportPreference: input.toolTransportPreference }
          : {}),
        ...buildDynamicContextInjection(input.dynamicContext),
      },
      rawUserMessage: prepared.rawUserMessage,
      executionContext: resolvePromptRuntimeExecutionContext({
        sessionId: session.id,
         metadataJson: session.metadataJson,
          branchId: prepared.branchId,
       branchExists: true,
        historySourceBranchId: prepared.branchId,
   historySourceMode: "existing_branch",
        sourceFloorId: prepared.sourceFloorId,
        request: buildLivePromptRuntimeRequestPolicy({
          structure: input.structure,
          delivery: input.delivery,
        }),
      }),
      conversationWindow: prepared.conversationWindow,
      runtimeOptions: {
        ...runtimeOptions,
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      },
    });
    await this.touchConversation(session.id);

    return {
      conversationId: session.id,
      branchId: prepared.branchId,
      floorId: result.floorId,
      floorNo: prepared.floorNo,
      pageId: result.outputPageId,
      text: result.generatedText,
      usage: result.totalUsage,
      finalState: result.finalState,
      finishReason: resolveTemporaryConversationFinishReason(result.runtimeTrace),
      warnings: resolveTemporaryConversationWarnings(result.runtimeTrace),
    };
  }

  private async prepareDraftConversation(
    session: typeof sessions.$inferSelect,
    branchId: string,
    request: {
      structure?: TemporaryConversationRespondInput["structure"];
      delivery?: TemporaryConversationRespondInput["delivery"];
    },
  ): Promise<PreparedDraftConversationState> {
    const latestFloor = await this.loadLatestLiveFloor(session.id, branchId);
    if (!latestFloor || latestFloor.state !== "draft") {
      throw new TemporaryConversationError(
        "no_pending_input",
        "Temporary conversation has no pending draft input to respond from.",
      );
    }

    const committedHistory = await this.loadCommittedHistoryEntries(session.id, branchId, latestFloor.floorNo);
    const draftEntries = await this.loadDraftFloorEntries(latestFloor.id, latestFloor.floorNo);
    const entries = [...committedHistory, ...draftEntries.entries];
    const maxSelectedTurns = resolveHistoryMaxTurnsFromRequestMetadata(
      session.metadataJson,
      request.structure,
      request.delivery,
    );
    const window = buildConversationHistoryWindow({
      entries,
      ...(maxSelectedTurns !== undefined ? { maxSelectedTurns } : {}),
    });

    if (!window.effectiveUserMessage) {
      throw new TemporaryConversationError(
        "missing_effective_user_tail",
        "Temporary conversation respond requires a trailing effective user turn.",
      );
    }

    return {
      branchId,
      floorId: latestFloor.id,
      floorNo: latestFloor.floorNo,
      pageId: draftEntries.pageId,
      pageMessageId: draftEntries.pageMessageId,
      sourceFloorId: await this.loadLatestCommittedFloorId(session.id, branchId, latestFloor.floorNo),
      rawUserMessage: window.effectiveUserMessage,
      conversationWindow: {
        ...window,
        visibilityTrace: { filteredFloorNos: [] },
      },
    };
  }

  private async requireSourceSession(
    accountId: string,
    sourceSessionId: string,
  ): Promise<typeof sessions.$inferSelect> {
    const sourceSession = await this.db
      .select()
      .from(sessions)
      .where(and(
        eq(sessions.accountId, accountId),
        eq(sessions.id, sourceSessionId),
      ))
      .limit(1);

    const row = sourceSession[0];
    if (!row) {
      throw new TemporaryConversationError(
        "source_session_not_found",
        `Source session '${sourceSessionId}' was not found.`,
      );
    }

    if (isTemporaryConversationSessionLike(row)) {
      throw new TemporaryConversationError(
        "invalid_kind",
        "Temporary conversations cannot derive directly from another temporary conversation.",
      );
    }

    return row;
  }

  private async requireSourceProject(
    _accountId: string,
    projectId: string,
  ): Promise<typeof projects.$inferSelect> {
    const sourceProject = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const row = sourceProject[0];
    if (!row) {
      throw new TemporaryConversationError(
        "source_project_not_found",
        `Source project '${projectId}' was not found.`,
      );
    }

    return row;
  }

  private async getTemporaryConversation(
    accountId: string,
    conversationId: string,
  ): Promise<typeof sessions.$inferSelect> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(
        eq(sessions.accountId, accountId),
        eq(sessions.id, conversationId),
      ))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new TemporaryConversationError(
        "conversation_not_found",
        `Temporary conversation '${conversationId}' was not found.`,
      );
    }

    if (!isTemporaryConversationSessionLike(row)) {
      throw new TemporaryConversationError(
        "invalid_kind",
        `Session '${conversationId}' is not a temporary conversation.`,
      );
    }

    return this.expireTemporaryConversationIfNeeded(row);
  }

  private async requireActiveTemporaryConversation(
    accountId: string,
    conversationId: string,
  ): Promise<typeof sessions.$inferSelect> {
    const row = await this.getTemporaryConversation(accountId, conversationId);
    if (row.status !== "active") {
      throw new TemporaryConversationError(
        "conversation_not_active",
        `Temporary conversation '${conversationId}' is not active.`,
      );
    }

    return row;
  }

  private async expireTemporaryConversationIfNeeded(
    row: typeof sessions.$inferSelect,
  ): Promise<typeof sessions.$inferSelect> {
    if (row.status !== "active" || row.expiresAt === null || row.expiresAt > Date.now()) {
      return row;
    }

    const now = Date.now();
    const updated = await this.db
      .update(sessions)
      .set({
        status: "expired",
        updatedAt: now,
      })
      .where(and(
        eq(sessions.id, row.id),
        eq(sessions.status, "active"),
      ))
      .returning()
      .all();

    return updated[0] ?? { ...row, status: "expired", updatedAt: now };
  }

  private async touchConversation(
    conversationId: string,
    now: number = Date.now(),
  ): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        updatedAt: now,
        lastActivityAt: now,
      })
      .where(eq(sessions.id, conversationId));
  }

  private async transitionConversationTerminalState(
    accountId: string,
    conversationId: string,
    status: "finalized" | "discarded" | "cancelled",
  ): Promise<TemporaryConversationResource> {
    await this.requireActiveTemporaryConversation(accountId, conversationId);
    const now = Date.now();
    const updated = await this.db
      .update(sessions)
      .set({
        status,
        updatedAt: now,
        lastActivityAt: now,
        finalizedAt: status === "finalized" ? now : null,
        discardedAt: status === "discarded" ? now : null,
        cancelledAt: status === "cancelled" ? now : null,
      })
      .where(and(
        eq(sessions.id, conversationId),
        eq(sessions.accountId, accountId),
        eq(sessions.status, "active"),
      ))
      .returning()
      .all();

    const row = updated[0];
    if (!row) {
      throw new TemporaryConversationError(
        "conversation_not_active",
        `Temporary conversation '${conversationId}' is not active.`,
      );
    }

    return this.toTemporaryConversationResource(row);
  }

  private buildTemporaryConversationHandle(
    row: typeof sessions.$inferSelect,
  ): TemporaryConversationHandle {
    const resource = this.toTemporaryConversationResource(row);
    return {
      ...resource,
      conversationId: resource.id,
    };
  }

  private toTemporaryConversationResource(
    row: typeof sessions.$inferSelect,
  ): TemporaryConversationResource {
    return {
      id: row.id,
      branchId: TEMPORARY_CONVERSATION_BRANCH_ID,
      kind: TEMPORARY_CONVERSATION_SESSION_KIND,
      title: row.title,
      status: row.status as TemporaryConversationResource["status"],
      purpose: row.purpose,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      sourceSessionId: row.temporarySourceSessionId,
      retentionPolicy: (row.retentionPolicy ?? TEMPORARY_CONVERSATION_RETENTION_POLICIES[0]) as TemporaryConversationResource["retentionPolicy"],
      visibility: (row.visibility ?? TEMPORARY_CONVERSATION_VISIBILITIES[0]) as TemporaryConversationResource["visibility"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastActivityAt: row.lastActivityAt,
      expiresAt: row.expiresAt,
      finalizedAt: row.finalizedAt,
      discardedAt: row.discardedAt,
      cancelledAt: row.cancelledAt,
      cleanedAt: row.cleanedAt,
    };
  }

  private async loadLatestExportableOutputPageMessage(
    conversationId: string,
  ): Promise<ExportableOutputPageMessage | null> {
    const rows = await this.db
      .select({
        pageId: messagePages.id,
        floorId: floors.id,
        floorNo: floors.floorNo,
        content: messages.content,
        contentFormat: messages.contentFormat,
      })
      .from(floors)
      .innerJoin(messagePages, and(
        eq(messagePages.floorId, floors.id),
        inArray(messagePages.pageKind, ["output", "mixed"]),
      ))
      .innerJoin(messages, and(
        eq(messages.pageId, messagePages.id),
        inArray(messages.role, ["assistant", "narrator"]),
        eq(messages.isHidden, false),
      ))
      .where(and(
        eq(floors.sessionId, conversationId),
        isNull(floors.supersededAt),
      ))
      .orderBy(desc(floors.floorNo), desc(messagePages.pageNo), desc(messages.seq))
      .limit(1);

    return rows[0] ?? null;
  }

  private async loadExportableOutputPageMessage(
    conversationId: string,
    pageId: string,
  ): Promise<ExportableOutputPageMessage | null> {
    const rows = await this.db
      .select({
        pageId: messagePages.id,
        floorId: floors.id,
        floorNo: floors.floorNo,
        content: messages.content,
        contentFormat: messages.contentFormat,
      })
      .from(messagePages)
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(messages, and(
        eq(messages.pageId, messagePages.id),
        inArray(messages.role, ["assistant", "narrator"]),
        eq(messages.isHidden, false),
      ))
      .where(and(
        eq(messagePages.id, pageId),
        eq(floors.sessionId, conversationId),
        isNull(floors.supersededAt),
        inArray(messagePages.pageKind, ["output", "mixed"]),
      ))
      .orderBy(desc(messages.seq))
      .limit(1);

    return rows[0] ?? null;
  }

  private async promoteDraftFloorToGenerating(floorId: string): Promise<void> {
    const updated = await this.db
      .update(floors)
      .set({
        state: "generating",
        updatedAt: Date.now(),
      })
      .where(and(
        eq(floors.id, floorId),
        eq(floors.state, "draft"),
      ))
      .returning({ id: floors.id })
      .all();

    if (updated.length === 0) {
      throw new TemporaryConversationError(
        "conversation_busy",
        `Temporary conversation floor '${floorId}' is no longer available for generation.`,
      );
    }
  }

  private async ensureDraftFloor(
    session: typeof sessions.$inferSelect,
    branchId: string,
    now: number,
  ): Promise<{ id: string; floorNo: number; state: typeof floors.$inferSelect["state"] }> {
    const latestFloor = await this.loadLatestLiveFloor(session.id, branchId);
    if (!latestFloor) {
      const created = this.draftFloorService.createDraftResponseFloor({
        accountId: session.accountId,
        sessionId: session.id,
        floorId: nanoid(),
        floorNo: 1,
        branchId,
        parentFloorId: null,
        userId: session.userId,
        userSnapshotJson: session.userSnapshotJson,
        now,
      });
      return { id: created.floorId, floorNo: 1, state: "draft" };
    }

    if (latestFloor.state === "draft") {
      return latestFloor;
    }

    if (latestFloor.state === "generating") {
      throw new TemporaryConversationError(
        "conversation_busy",
        `Temporary conversation '${session.id}' is already generating on branch '${branchId}'.`,
      );
    }

    const created = this.draftFloorService.createDraftResponseFloor({
      accountId: session.accountId,
      sessionId: session.id,
      floorId: nanoid(),
      floorNo: latestFloor.floorNo + 1,
      branchId,
      parentFloorId: latestFloor.id,
      userId: session.userId,
      userSnapshotJson: session.userSnapshotJson,
      now,
      sourceFloorId: latestFloor.id,
      sourceBranchId: branchId,
    });

    return {
      id: created.floorId,
      floorNo: latestFloor.floorNo + 1,
      state: "draft",
    };
  }

  private async ensureDraftPage(
    floorId: string,
    role: TemporaryConversationAppendInput["role"],
    now: number,
  ): Promise<{ id: string; pageKind: typeof messagePages.$inferSelect["pageKind"] }> {
    const existingPages = await this.db
      .select({
        id: messagePages.id,
        pageKind: messagePages.pageKind,
      })
      .from(messagePages)
      .where(and(
        eq(messagePages.floorId, floorId),
        eq(messagePages.isActive, true),
      ))
      .orderBy(asc(messagePages.pageNo), asc(messagePages.version))
      .limit(1);

    const existing = existingPages[0];
    if (!existing) {
      const pageId = nanoid();
      const pageKind = role === "user" ? "input" : "mixed";
      await this.db.insert(messagePages).values({
        id: pageId,
        floorId,
        pageNo: 0,
        pageKind,
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: now,
        updatedAt: now,
      });
      return { id: pageId, pageKind };
    }

    if (existing.pageKind === "input" && role !== "user") {
      await this.db.update(messagePages).set({
        pageKind: "mixed",
        updatedAt: now,
      }).where(eq(messagePages.id, existing.id));
      return { id: existing.id, pageKind: "mixed" };
    }

    return existing;
  }

  private async loadNextMessageSeq(pageId: string): Promise<number> {
    const rows = await this.db
      .select({ seq: messages.seq })
      .from(messages)
      .where(eq(messages.pageId, pageId))
      .orderBy(desc(messages.seq))
      .limit(1);

    return (rows[0]?.seq ?? -1) + 1;
  }

  private async loadLatestLiveFloor(
    sessionId: string,
    branchId: string,
  ): Promise<{ id: string; floorNo: number; state: typeof floors.$inferSelect["state"] } | null> {
    const rows = await this.db
      .select({
        id: floors.id,
        floorNo: floors.floorNo,
        state: floors.state,
      })
      .from(floors)
      .where(and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
        isNull(floors.supersededAt),
      ))
      .orderBy(desc(floors.floorNo), desc(floors.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }

  private async loadLatestCommittedFloorId(
    sessionId: string,
    branchId: string,
    beforeFloorNo: number,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ id: floors.id })
      .from(floors)
      .where(and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
        isNull(floors.supersededAt),
        eq(floors.state, "committed"),
        lt(floors.floorNo, beforeFloorNo),
      ))
      .orderBy(desc(floors.floorNo), desc(floors.createdAt))
      .limit(1);

    return rows[0]?.id ?? null;
  }

  private async loadCommittedHistoryEntries(
    sessionId: string,
    branchId: string,
    beforeFloorNo: number,
  ): Promise<PromptHistoryMessageEntry[]> {
    const rows = await this.db
      .select({
        floorId: floors.id,
        floorNo: floors.floorNo,
        pageId: messagePages.id,
        pageNo: messagePages.pageNo,
        messageId: messages.id,
        seq: messages.seq,
        role: messages.role,
        content: messages.content,
      })
      .from(floors)
      .innerJoin(messagePages, and(
        eq(messagePages.floorId, floors.id),
        eq(messagePages.isActive, true),
      ))
      .innerJoin(messages, and(
        eq(messages.pageId, messagePages.id),
        eq(messages.isHidden, false),
      ))
      .where(and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
        isNull(floors.supersededAt),
        eq(floors.state, "committed"),
        lt(floors.floorNo, beforeFloorNo),
      ))
      .orderBy(asc(floors.floorNo), asc(messagePages.pageNo), asc(messages.seq));

    return rows.map((row) => ({
      floorId: row.floorId,
      floorNo: row.floorNo,
      pageId: row.pageId,
      pageNo: row.pageNo,
      messageId: row.messageId,
      seq: row.seq,
      role: mapDbMessageRole(row.role),
      content: row.content,
    }));
  }

  private async loadDraftFloorEntries(
    floorId: string,
    floorNo: number,
  ): Promise<{ entries: PromptHistoryMessageEntry[]; pageId: string | undefined; pageMessageId: string | undefined }> {
    const rows = await this.db
      .select({
        pageId: messagePages.id,
        pageNo: messagePages.pageNo,
        messageId: messages.id,
        seq: messages.seq,
        role: messages.role,
        content: messages.content,
      })
      .from(messagePages)
      .innerJoin(messages, and(
        eq(messages.pageId, messagePages.id),
        eq(messages.isHidden, false),
      ))
      .where(and(
        eq(messagePages.floorId, floorId),
        eq(messagePages.isActive, true),
      ))
      .orderBy(asc(messagePages.pageNo), asc(messages.seq));

    const entries = rows.map((row) => ({
      floorId,
      floorNo,
      pageId: row.pageId,
      pageNo: row.pageNo,
      messageId: row.messageId,
      seq: row.seq,
      role: mapDbMessageRole(row.role),
      content: row.content,
      fromCurrentInput: true,
    } satisfies PromptHistoryMessageEntry));

    const trailingUserEntry = [...entries].reverse().find((entry) => entry.role === "user");

    return {
      entries,
      pageId: trailingUserEntry?.pageId ?? entries[0]?.pageId,
      pageMessageId: trailingUserEntry?.messageId,
    };
  }
}
/**
 * 将 chatService 招出的 ChatServiceError 映射为 TemporaryConversationError，以便路由统一错误处理。
 *
 * 仅转换重试路径有意义的错误码；generation_cancelled 等原样抛出（SSE 层按客户端断开处理）。
 * 未识别的错误原样返回（最终落到 500）。
 */
function mapChatServiceErrorToTemporaryConversationError(error: unknown): unknown {
  if (!(error instanceof ChatServiceError)) {
    return error;
  }
  switch (error.code) {
    case "invalid_from_step_index":
      return new TemporaryConversationError("invalid_from_step_index", error.message, { cause: error });
    case "step_retry_blocked_side_effect":
      return new TemporaryConversationError("step_retry_blocked_side_effect", error.message, { cause: error });
    case "generation_conflict":
    case "generation_queue_timeout":
      return new TemporaryConversationError("conversation_busy", error.message, { cause: error });
    case "session_not_found":
      return new TemporaryConversationError("conversation_not_found", error.message, { cause: error });
    case "session_archived":
      return new TemporaryConversationError("conversation_not_active", error.message, { cause: error });
    case "no_user_message":
      return new TemporaryConversationError("no_pending_input", error.message, { cause: error });
    default:
      return error;
  }
}



function normalizeTemporaryConversationBranchId(branchId?: string): string {
  const normalized = normalizeBranchId(branchId);
  if (normalized !== TEMPORARY_CONVERSATION_BRANCH_ID) {
    throw new TemporaryConversationError(
      "unsupported_branch",
      `Temporary conversations only support the '${TEMPORARY_CONVERSATION_BRANCH_ID}' branch during T1.`,
    );
  }
  return normalized;
}

function normalizeAppendRole(role: TemporaryConversationAppendInput["role"]): TemporaryConversationAppendInput["role"] {
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }

  throw new TemporaryConversationError(
    "invalid_message_role",
    `Unsupported temporary conversation append role '${String(role)}'.`,
  );
}

function requireMessageContent(content: string): string {
  const normalized = typeof content === "string" ? content : "";
  if (normalized.length === 0) {
    throw new TemporaryConversationError(
      "empty_message_content",
      "Temporary conversation messages must not be empty.",
    );
  }
  return normalized;
}

function buildTemporaryConversationTitle(
  sourceTitle: string | null,
  purpose: string | null,
): string {
  const titleBase = normalizeOptionalText(sourceTitle) ?? "Temporary conversation";
  const purposeSuffix = purpose ? ` · ${purpose}` : "";
  return `${titleBase}${purposeSuffix}`.slice(0, 200);
}

function sanitizeTemporaryConversationMetadataJson(
  metadataJson: string | null,
  purpose?: string | null,
): string | null {
  if (!metadataJson) {
    return metadataJson;
  }

  try {
    const parsed = JSON.parse(metadataJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return metadataJson;
    }

    const record = parsed as Record<string, unknown>;
    // 图助手会话强制启用工具：默认工具权限补 enabled:true，避免 transport 因 tools_disabled 退化为 none。
    // 详见 temporary-conversation-types 中 GRAPH_ASSISTANT_PURPOSE 的注释。
    const isGraphAssistant = purpose === GRAPH_ASSISTANT_PURPOSE;
    const toolPermissions = record.tool_permissions;
    if (toolPermissions && typeof toolPermissions === "object" && !Array.isArray(toolPermissions)) {
      record.tool_permissions = {
        ...(toolPermissions as Record<string, unknown>),
        allow_irreversible: false,
        ...(isGraphAssistant ? { enabled: true } : {}),
      };
    } else if (isGraphAssistant) {
      record.tool_permissions = { enabled: true, allow_irreversible: false };
    }

    return JSON.stringify(record);
  } catch {
    return metadataJson;
  }
}

function buildTemporaryConversationSnapshotDigest(args: {
  title: string;
  metadataJson: string | null;
  sourceSession: typeof sessions.$inferSelect;
  sourceBranch: { assetBinding: SessionBranchAssetBindingState | null } | null;
}): string {
  const payload = JSON.stringify({
    title: args.title,
    sourceSessionId: args.sourceSession.id,
    sourceSessionUpdatedAt: args.sourceSession.updatedAt,
    presetId: args.sourceSession.presetId,
    regexProfileId: args.sourceSession.regexProfileId,
    worldbookProfileId: args.sourceSession.worldbookProfileId,
    deepBinding: args.sourceSession.deepBinding,
    presetVersionId: args.sourceSession.presetVersionId,
    regexProfileVersionId: args.sourceSession.regexProfileVersionId,
    worldbookVersionId: args.sourceSession.worldbookVersionId,
    modelProvider: args.sourceSession.modelProvider,
    modelName: args.sourceSession.modelName,
    modelParamsJson: args.sourceSession.modelParamsJson,
    promptMode: args.sourceSession.promptMode,
    characterId: args.sourceSession.characterId,
    characterVersionId: args.sourceSession.characterVersionId,
    metadataJson: args.metadataJson,
    userSnapshotJson: args.sourceSession.userSnapshotJson,
    characterSnapshotJson: args.sourceSession.characterSnapshotJson,
    branchAssetBinding: args.sourceBranch?.assetBinding ?? null,
  });

  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function buildTemporaryConversationProjectSnapshotDigest(args: {
  title: string;
  metadataJson: string | null;
  sourceProject: typeof projects.$inferSelect;
}): string {
  const payload = JSON.stringify({
    title: args.title,
    metadataJson: args.metadataJson,
    sourceProjectId: args.sourceProject.id,
    sourceProjectUpdatedAt: args.sourceProject.updatedAt,
    sourceProjectKind: args.sourceProject.kind,
    sourceProjectStatus: args.sourceProject.status,
    workspaceId: args.sourceProject.workspaceId,
    accountId: args.sourceProject.accountId,
  });

  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function buildTemporaryConversationMetadataJson(
  metadataJson: string | null,
  purpose?: string | null,
): string {
  // 图助手会话强制启用工具：默认工具权限带 enabled:true，避免 transport 因 tools_disabled 退化为 none。
  const defaultToolPermissions: Record<string, unknown> = purpose === GRAPH_ASSISTANT_PURPOSE
    ? { enabled: true, allow_irreversible: false }
    : { allow_irreversible: false };

  if (!metadataJson) {
    return JSON.stringify({ tool_permissions: defaultToolPermissions });
  }

  const sanitized = sanitizeTemporaryConversationMetadataJson(metadataJson, purpose);
  return sanitized ?? JSON.stringify({ tool_permissions: defaultToolPermissions });
}
function mergeAgentOriginIntoMetadataJson(
  metadataJson: string | null,
  agentOrigin: TemporaryConversationAgentOrigin | null | undefined,
): string | null {
  if (!agentOrigin) {
    return metadataJson;
  }

  const compact = compactAgentOrigin(agentOrigin);
  if (Object.keys(compact).length === 0) {
    return metadataJson;
  }

  let base: Record<string, unknown> = {};
  if (metadataJson) {
    try {
      const parsed = JSON.parse(metadataJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {};
    }
  }

  base.agent_origin = compact;
  return JSON.stringify(base);
}

function compactAgentOrigin(
  agentOrigin: TemporaryConversationAgentOrigin,
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [
    ["source_agent_run_id", agentOrigin.sourceAgentRunId],
    ["parent_run_id", agentOrigin.parentRunId],
    ["root_run_id", agentOrigin.rootRunId],
    ["source_node_run_id", agentOrigin.sourceNodeRunId],
    ["source_page_id", agentOrigin.sourcePageId],
    ["source_floor_id", agentOrigin.sourceFloorId],
    ["source_session_id", agentOrigin.sourceSessionId],
    ["source_attempt_no", agentOrigin.sourceAttemptNo],
  ];
  const compact: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null) {
      compact[key] = value;
    }
  }
  return compact;
}

/**
 * 把 metadata_json 中的 `agent_origin` 反序列化回 TemporaryConversationAgentOrigin。
 *
 * 与 compactAgentOrigin 互为逆操作：compactAgentOrigin 写入 snake_case 字段，
 * 这里按 snake_case 读取并映射回 camelCase。
 *
 * 解析失败、缺少 agent_origin、或没有任何有效字段时返回 null，不抛错。
 * 供 Agent 介质 trace、审计与内部排障读取，默认不进入公共资源响应。
 */
export function readAgentOriginFromMetadataJson(
  metadataJson: string | null,
): TemporaryConversationAgentOrigin | null {
  if (!metadataJson) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson);
  } catch {
    return null;
  }

  if (!parsed|| typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

const origin = (parsed as Record<string, unknown>).agent_origin;
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) {
    return null;
  }

  const record = origin as Record<string, unknown>;
  const readString = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  const readNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

  const result: TemporaryConversationAgentOrigin = {};
  const sourceAgentRunId = readString(record.source_agent_run_id);
  if (sourceAgentRunId !== undefined) result.sourceAgentRunId = sourceAgentRunId;
  const parentRunId = readString(record.parent_run_id);
  if (parentRunId !== undefined) result.parentRunId = parentRunId;
  const rootRunId =readString(record.root_run_id);
  if (rootRunId !== undefined) result.rootRunId = rootRunId;
  const sourceNodeRunId = readString(record.source_node_run_id);
  if (sourceNodeRunId !== undefined) result.sourceNodeRunId = sourceNodeRunId;
  const sourcePageId = readString(record.source_page_id);
  if (sourcePageId !== undefined) result.sourcePageId = sourcePageId;
  const sourceFloorId = readString(record.source_floor_id);
  if (sourceFloorId !== undefined) result.sourceFloorId = sourceFloorId;
  const sourceSessionId = readString(record.source_session_id);
  if (sourceSessionId !== undefined) result.sourceSessionId = sourceSessionId;
  const sourceAttemptNo = readNumber(record.source_attempt_no);
  if (sourceAttemptNo !== undefined) result.sourceAttemptNo = sourceAttemptNo;

  if (Object.keys(result).length === 0) {
    return null;
  }
  return result;
}




function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveTemporaryConversationVisibility(
  visibility: TemporaryConversationVisibility | null | undefined,
): TemporaryConversationVisibility {
  if (visibility === undefined || visibility === null) {
    return TEMPORARY_CONVERSATION_VISIBILITIES[0];
  }

  if (TEMPORARY_CONVERSATION_VISIBILITIES.includes(visibility)) {
    return visibility;
  }

  throw new TemporaryConversationError(
    "invalid_visibility",
    `Unsupported temporary conversation visibility '${String(visibility)}'.`,
  );
}

function resolveTemporaryConversationRetention(input: {
  retentionPolicy?: TemporaryConversationRetentionPolicy | null;
  ttlSeconds?: number | null;
  now: number;
}): {
  retentionPolicy: TemporaryConversationRetentionPolicy;
  expiresAt: number | null;
} {
  const retentionPolicy = input.retentionPolicy ?? TEMPORARY_CONVERSATION_RETENTION_POLICIES[0];
  if (!TEMPORARY_CONVERSATION_RETENTION_POLICIES.includes(retentionPolicy)) {
    throw new TemporaryConversationError(
      "invalid_retention_policy",
      `Unsupported temporary conversation retention policy '${String(retentionPolicy)}'.`,
    );
  }

  if (retentionPolicy !== "ttl") {
    return {
      retentionPolicy,
      expiresAt: null,
    };
  }

  if (input.ttlSeconds === undefined || input.ttlSeconds === null) {
    throw new TemporaryConversationError(
      "ttl_required",
      "Temporary conversation ttl retention requires ttlSeconds.",
    );
  }

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    throw new TemporaryConversationError(
      "invalid_ttl_seconds",
      "Temporary conversation ttlSeconds must be a positive integer.",
    );
  }

  return {
    retentionPolicy,
    expiresAt: input.now + (input.ttlSeconds * 1000),
  };
}

function normalizeTemporaryConversationExportReason(reason: string | null | undefined): string {
  const normalized = normalizeOptionalText(reason);
  return normalized ?? "temporary_conversation_export";
}

function resolveTemporaryConversationWarnings(
  runtimeTrace?: PromptRuntimeTrace,
): string[] {
  if (!runtimeTrace) {
    return [];
  }

  const warnings = new Set<string>();

  for (const warning of runtimeTrace.preset?.warnings ?? []) {
    warnings.add(`preset:${warning}`);
  }
  for (const warning of runtimeTrace.macro?.warnings ?? []) {
    warnings.add(`macro:${warning.code}`);
  }
  for (const reason of runtimeTrace.delivery?.degradeReasons ?? []) {
    warnings.add(`delivery:${reason}`);
  }

  return [...warnings];
}

function resolveTemporaryConversationFinishReason(
  runtimeTrace?: PromptRuntimeTrace,
): string {
  const deliveryTrace = runtimeTrace?.delivery;
  if (deliveryTrace?.degraded) {
    return "delivery_degraded";
  }
  if (deliveryTrace?.noAssistant) {
    return "no_assistant";
  }
  return "assistant_message_committed";
}

function resolveHistoryMaxTurnsFromRequestMetadata(
  metadataJson: string | null,
  structure?: TemporaryConversationRespondInput["structure"],
  delivery?: TemporaryConversationRespondInput["delivery"],
): number | undefined {
  void structure;
  void delivery;

  if (!metadataJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    const policy = parsed.prompt_runtime_policy;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      return undefined;
    }
    const sourceSelection = (policy as Record<string, unknown>).sourceSelection;
    if (!sourceSelection || typeof sourceSelection !== "object" || Array.isArray(sourceSelection)) {
      return undefined;
    }
    const history = (sourceSelection as Record<string, unknown>).history;
    if (!history || typeof history !== "object" || Array.isArray(history)) {
      return undefined;
    }
    const mode = (history as Record<string, unknown>).mode;
    if (mode === "full") {
      return undefined;
    }
    const maxMessages = (history as Record<string, unknown>).maxMessages;
    return typeof maxMessages === "number" && Number.isInteger(maxMessages) && maxMessages > 0
      ? maxMessages
      : undefined;
  } catch {
    return undefined;
  }
}

function mapDbMessageRole(role: typeof messages.$inferSelect["role"]): ChatMessage["role"] {
  if (role === "assistant" || role === "narrator") {
    return "assistant";
  }
  if (role === "system") {
    return "system";
  }
  return "user";
}

/** 解析工具执行记录里的 args / result JSON 字符串；空串视为 null，解析失败时回退为原始字符串。 */
function parseTranscriptToolJson(raw: string): unknown {
  if (raw === "") {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * 解析 floor_result_snapshot.step_narrations_json 为中间叙述数组。
 *
 * 解析失败或结构不合时退化为空数组；按 createdAt（次级 stepIndex）升序稳定排列。
 */
function parseStepNarrations(value: string | null): TemporaryConversationTranscriptStepNarration[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is TemporaryConversationTranscriptStepNarration =>
          item !== null &&
          typeof item === "object" &&
          typeof (item as { stepIndex?: unknown }).stepIndex === "number" &&
          typeof (item as { text?: unknown }).text === "string" &&
          typeof (item as { createdAt?: unknown }).createdAt === "number",
      )
      .sort((a, b) => a.createdAt - b.createdAt || a.stepIndex - b.stepIndex);
  } catch {
    return [];
  }
}

function toInspectTranscriptFloor(
  floor: TemporaryConversationTranscriptFloor,
  restricted: boolean,
): TemporaryConversationInspectTranscriptFloor {
  return {
    id: floor.id,
    floorNo: floor.floorNo,
    branchId: floor.branchId,
    parentFloorId: floor.parentFloorId,
    state: floor.state,
    tokenIn: floor.tokenIn,
    tokenOut: floor.tokenOut,
    createdAt: floor.createdAt,
    updatedAt: floor.updatedAt,
    reasoningText: restricted ? null : floor.reasoningText,
    // 中间叙述旁路数组：agent-private 受限时擦除 text，保留 stepIndex / createdAt 结构。
    stepNarrations: floor.stepNarrations.map((narration) => ({
      ...narration,
      text: restricted ? "" : narration.text,
    })),
    // 工具执行旁路数组：agent-private 受限时擦除 args / result / errorMessage，结构字段保留。
    toolExecutions: floor.toolExecutions.map((exec) => ({
      ...exec,
      args: restricted ? null : exec.args,
      result: restricted ? null : exec.result,
      errorMessage: restricted ? null : exec.errorMessage,
    })),
    pages: floor.pages.map((page) => ({
      id: page.id,
      pageNo: page.pageNo,
      pageKind: page.pageKind,
      isActive: page.isActive,
      version: page.version,
      checksum: page.checksum,
           createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      messages: page.messages.map((message) => ({
        id: message.id,
        seq: message.seq,
        role: message.role,
        content: restricted ? null : message.content,
        contentLength: message.content.length,
        contentFormat: message.contentFormat,
        isHidden: message.isHidden,
        source: message.source,
        restricted,
        createdAt: message.createdAt,
      })),
    })),
  };
}

function createAsyncQueue<T>() {
  const state: AsyncQueueState<T> = {
    items: [],
    waiting: [],
    done: false,
    error: undefined,
  };

  return {
    push(item: T) {
      if (state.done) {
        return;
      }
      const waiter = state.waiting.shift();
      if (waiter) {
        waiter({ value: item, done: false });
        return;
      }
      state.items.push(item);
    },
    close() {
      if (state.done) {
        return;
      }
      state.done = true;
      while (state.waiting.length > 0) {
        const waiter = state.waiting.shift();
        waiter?.({ value: undefined, done: true });
      }
    },
    fail(error: unknown) {
      if (state.done) {
        return;
      }
      state.error = error;
      state.done = true;
      while (state.waiting.length > 0) {
        const waiter = state.waiting.shift();
        waiter?.({ value: undefined, done: true });
      }
    },
    async *stream(): AsyncGenerator<T, void, void> {
      while (true) {
        if (state.items.length > 0) {
          yield state.items.shift() as T;
          continue;
        }

        if (state.done) {
          if (state.error) {
            throw state.error;
          }
          return;
        }

        const next = await new Promise<IteratorResult<T>>((resolve) => {
          state.waiting.push(resolve);
        });

        if (next.done) {
          if (state.error) {
            throw state.error;
          }
          return;
        }

        yield next.value;
      }
    },
  };
}
