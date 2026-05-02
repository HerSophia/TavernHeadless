import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../../db/client.js";
import { floors, messagePages, messages } from "../../db/schema.js";
import { ChatMessagePersistence, type PersistedMessageRef } from "../chat-message-persistence.js";
import { SessionBranchRegistryService } from "../variables/host/session-branch-registry-service.js";

import {
  buildConversationInputSnapshot,
  buildFloorMetadataJson,
  readFloorConversationInputSnapshot,
  type FloorConversationInputSnapshot,
} from "./shared/metadata.js";

export interface FloorConversationReplaySeed {
  snapshot: FloorConversationInputSnapshot;
  currentInput?: {
    content: string;
    floorId: string;
    floorNo: number;
    pageId: string;
    pageNo: number;
    messageId: string;
    seq: number;
  };
}

export class DraftFloorService {
  constructor(
    private readonly db: AppDb,
    private readonly messagePersistence: ChatMessagePersistence,
  ) {}

  createDraftFloorWithUserMessage(args: {
    floorId?: string;
    accountId: string;
    sessionId: string;
    floorNo: number;
    branchId: string;
    parentFloorId: string | null;
    userMessage: string;
    userId: string | null;
    userSnapshotJson: string | null;
    now: number;
    sourceFloorId?: string | null;
    sourceBranchId?: string | null;
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

      new SessionBranchRegistryService(tx).ensure({
        accountId: args.accountId,
        sessionId: args.sessionId,
        branchId: args.branchId,
        sourceFloorId: args.sourceFloorId ?? null,
        sourceBranchId: args.sourceBranchId ?? null,
        createdAt: args.now,
        updatedAt: args.now,
      });
      args.afterCreate?.(tx, floorId);

      return this.messagePersistence.saveUserMessageWithExecutor(tx, floorId, args.userMessage, args.now);
    });

    return { floorId, userMessageRef };
  }

  createDraftResponseFloor(args: {
    floorId?: string;
    accountId: string;
    sessionId: string;
    floorNo: number;
    branchId: string;
    parentFloorId: string | null;
    userId: string | null;
    userSnapshotJson: string | null;
    now: number;
    sourceFloorId?: string | null;
    sourceBranchId?: string | null;
    prepare?: (tx: DbExecutor) => void;
    afterCreate?: (tx: DbExecutor, floorId: string) => void;
  }): { floorId: string } {
    const floorId = args.floorId ?? nanoid();
    const floorMetadataJson = buildFloorMetadataJson(args.userId, args.userSnapshotJson, args.now);

    this.db.transaction((tx) => {
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

      new SessionBranchRegistryService(tx).ensure({
        accountId: args.accountId,
        sessionId: args.sessionId,
        branchId: args.branchId,
        sourceFloorId: args.sourceFloorId ?? null,
        sourceBranchId: args.sourceBranchId ?? null,
        createdAt: args.now,
        updatedAt: args.now,
      });
      args.afterCreate?.(tx, floorId);
    });

    return { floorId };
  }

  async getUserMessageFromFloor(floorId: string): Promise<{ content: string; pageId: string; messageId: string; seq: number } | null> {
    const [inputPage] = await this.db
      .select({ id: messagePages.id })
      .from(messagePages)
      .where(
        and(
          eq(messagePages.floorId, floorId),
          eq(messagePages.pageKind, "input"),
          eq(messagePages.isActive, true),
        ),
      )
      .limit(1);

    if (!inputPage) {
      return null;
    }

    const [userMsg] = await this.db
      .select({ content: messages.content, pageId: messages.pageId, messageId: messages.id, seq: messages.seq })
      .from(messages)
      .where(
        and(
          eq(messages.pageId, inputPage.id),
          eq(messages.role, "user"),
        ),
      )
      .orderBy(asc(messages.seq))
      .limit(1);

    if (!userMsg) {
      return null;
    }

    return {
      content: userMsg.content,
      pageId: userMsg.pageId,
      messageId: userMsg.messageId,
      seq: userMsg.seq,
    };
  }

  async getEffectiveConversationInputFromFloor(floorId: string): Promise<FloorConversationReplaySeed | null> {
    const [floor] = await this.db
      .select({
        id: floors.id,
        floorNo: floors.floorNo,
        metadataJson: floors.metadataJson,
      })
      .from(floors)
      .where(eq(floors.id, floorId))
      .limit(1);

    if (!floor) {
      return null;
    }

    const persistedSnapshot = readFloorConversationInputSnapshot(floor.metadataJson);
    const currentInput = await this.loadReplayCurrentInput({
      floorId: floor.id,
      floorNo: floor.floorNo,
      persistedSnapshot,
    });

    const snapshot = persistedSnapshot ?? (currentInput
      ? buildConversationInputSnapshot({
          effectiveText: currentInput.content,
          sourceTurn: {
            sourceFloorIds: [floor.id],
            sourcePageIds: [currentInput.pageId],
            sourceMessageIds: [currentInput.messageId],
            floorRange: { start: floor.floorNo, end: floor.floorNo },
            includesCurrentInput: true,
            entryCount: 1,
          },
          currentInputPageId: currentInput.pageId,
          currentInputMessageId: currentInput.messageId,
        })
      : null);

    if (!snapshot) {
      return null;
    }

    return {
      snapshot,
      ...(currentInput ? { currentInput } : {}),
    };
  }

  private async loadReplayCurrentInput(args: {
    floorId: string;
    floorNo: number;
    persistedSnapshot: FloorConversationInputSnapshot | null;
  }): Promise<FloorConversationReplaySeed["currentInput"] | undefined> {
    const snapshotPageId = args.persistedSnapshot?.currentInputPageId;
    const snapshotMessageId = args.persistedSnapshot?.currentInputMessageId;

    if (snapshotPageId && snapshotMessageId) {
      const message = await this.loadUserMessageByIdentity(args.floorId, snapshotPageId, snapshotMessageId);
      if (message) {
        return {
          content: message.content,
          floorId: args.floorId,
          floorNo: args.floorNo,
          pageId: message.pageId,
          pageNo: 0,
          messageId: message.messageId,
          seq: message.seq,
        };
      }
    }

    const legacyMessage = await this.getUserMessageFromFloor(args.floorId);
    if (!legacyMessage) {
      return undefined;
    }

    return {
      content: legacyMessage.content,
      floorId: args.floorId,
      floorNo: args.floorNo,
      pageId: legacyMessage.pageId,
      pageNo: 0,
      messageId: legacyMessage.messageId,
      seq: legacyMessage.seq,
    };
  }

  private async loadUserMessageByIdentity(
    floorId: string,
    pageId: string,
    messageId: string,
  ): Promise<{ content: string; pageId: string; messageId: string; seq: number } | null> {
    const [userMessage] = await this.db
      .select({
        content: messages.content,
        pageId: messages.pageId,
        messageId: messages.id,
        seq: messages.seq,
      })
      .from(messages)
      .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
      .where(and(
        eq(messagePages.floorId, floorId),
        eq(messagePages.id, pageId),
        eq(messages.id, messageId),
        eq(messages.role, "user"),
      ))
      .limit(1);

    return userMessage ?? null;
  }
}
