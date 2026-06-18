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
  floors,
  messagePages,
  messages,
  pageStagedWrites,
  projects,
  sessions,
} from "../db/schema.js";
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
import { resolvePromptRuntimeExecutionContext } from "./prompt-runtime-execution.js";
import {
  SessionBranchRegistryService,
  type SessionBranchAssetBindingState,
} from "./variables/host/session-branch-registry-service.js";
import {
  TemporaryConversationError,
} from "./temporary-conversation-errors.js";
import {
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
  type TemporaryConversationRetentionPolicy,
  type TemporaryConversationVisibility,
  type TemporaryConversationStreamChunk,
  type TemporaryConversationStreamInput,
  type TemporaryConversationTranscript,
  type TemporaryConversationTranscriptFloor,
  type TemporaryConversationTranscriptMessage,
  type TemporaryConversationTranscriptPage,
  isTemporaryConversationSessionLike,
} from "./temporary-conversation-types.js";

interface TemporaryConversationServiceOptions {
  tokenCounter?: TokenCounter;
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
    const metadataJson = sanitizeTemporaryConversationMetadataJson(sourceSession.metadataJson);
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
    const metadataJson = buildTemporaryConversationMetadataJson(null);
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
      source: "temporary_conversation",
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

  async respond(input: TemporaryConversationRespondInput): Promise<TemporaryConversationResult> {
    const session = await this.requireActiveTemporaryConversation(input.accountId, input.conversationId);
    const branchId = normalizeTemporaryConversationBranchId(input.branchId);

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
        config: input.config,
        generationParams: input.generationParams,
        promptIntent: input.promptIntent,
        debugOptions: input.debugOptions,
        structure: input.structure,
        delivery: input.delivery,
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
    runtimeOptions: Pick<RespondRuntimeOptions, "onStart" | "onChunk" | "onTool" | "onRun">,
  ): Promise<TemporaryConversationResult> {
    const session = await this.requireActiveTemporaryConversation(input.accountId, input.conversationId);
    const branchId = normalizeTemporaryConversationBranchId(input.branchId);

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
        config: input.config,
        generationParams: input.generationParams,
        promptIntent: input.promptIntent,
        debugOptions: input.debugOptions,
        structure: input.structure,
        delivery: input.delivery,
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

function sanitizeTemporaryConversationMetadataJson(metadataJson: string | null): string | null {
  if (!metadataJson) {
    return metadataJson;
  }

  try {
    const parsed = JSON.parse(metadataJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return metadataJson;
    }

    const record = parsed as Record<string, unknown>;
    const toolPermissions = record.tool_permissions;
    if (toolPermissions && typeof toolPermissions === "object" && !Array.isArray(toolPermissions)) {
      record.tool_permissions = {
        ...(toolPermissions as Record<string, unknown>),
        allow_irreversible: false,
      };
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

function buildTemporaryConversationMetadataJson(metadataJson: string | null): string {
  if (!metadataJson) {
    return JSON.stringify({
      tool_permissions: {
        allow_irreversible: false,
      },
    });
  }

  const sanitized = sanitizeTemporaryConversationMetadataJson(metadataJson);
  return sanitized ?? JSON.stringify({
    tool_permissions: {
      allow_irreversible: false,
    },
  });
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
