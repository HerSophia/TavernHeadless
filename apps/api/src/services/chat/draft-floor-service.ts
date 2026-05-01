import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../../db/client.js";
import { floors, messagePages, messages } from "../../db/schema.js";
import { ChatMessagePersistence, type PersistedMessageRef } from "../chat-message-persistence.js";
import { SessionBranchRegistryService } from "../variables/host/session-branch-registry-service.js";

import { buildFloorMetadataJson } from "./shared/metadata.js";

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

  async getUserMessageFromFloor(floorId: string): Promise<{ content: string; pageId: string } | null> {
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
      .select({ content: messages.content, pageId: messages.pageId })
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
    };
  }
}
