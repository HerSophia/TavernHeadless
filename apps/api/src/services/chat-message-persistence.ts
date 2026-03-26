/**
 * Chat Message Persistence
 *
 * 负责聊天消息（用户消息 / 助手回复）的数据库写入与重试清理。
 * 从 ChatService 提取以降低单文件认知负荷。
 */

import { eq, and, ne, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { TokenCounter } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { messagePages, messages } from "../db/schema.js";

export interface PersistedMessageRef {
  pageId: string;
  messageId: string;
}

export class ChatMessagePersistence {
  constructor(
    private readonly db: AppDb,
    private readonly tokenCounter: TokenCounter
  ) {}

  /**
   * 保存用户消息：创建 input page + message。
   */
  async saveUserMessage(
    floorId: string,
    content: string,
    timestamp: number
  ): Promise<PersistedMessageRef> {
    return this.db.transaction((tx) => {
      return this.saveUserMessageWithExecutor(tx, floorId, content, timestamp);
    });
  }

  saveUserMessageWithExecutor(
    executor: DbExecutor,
    floorId: string,
    content: string,
    timestamp: number
  ): PersistedMessageRef {
    const pageId = nanoid();
    const messageId = nanoid();

    executor.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 0,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }).run();

    executor.insert(messages).values({
      id: messageId,
      pageId,
      seq: 0,
      role: "user",
      content,
      contentFormat: "text",
      tokenCount: this.tokenCounter.count(content),
      isHidden: false,
      source: "api",
      createdAt: timestamp
    }).run();

    return {
      pageId,
      messageId,
    };
  }

  /**
   * 保存助手回复：创建 output page + message。
   */
  async saveAssistantMessage(
    floorId: string,
    content: string,
    timestamp: number
  ): Promise<PersistedMessageRef> {
    return this.db.transaction((tx) => {
      return this.saveAssistantMessageWithExecutor(tx, floorId, content, timestamp);
    });
  }

  saveAssistantMessageWithExecutor(
    executor: DbExecutor,
    floorId: string,
    content: string,
    timestamp: number
  ): PersistedMessageRef {
    const pageId = nanoid();
    const messageId = nanoid();

    executor.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }).run();

    executor.insert(messages).values({
      id: messageId,
      pageId,
      seq: 0,
      role: "assistant",
      content,
      contentFormat: "text",
      tokenCount: this.tokenCounter.count(content),
      isHidden: false,
      source: "narrator",
      createdAt: timestamp
    }).run();

    return {
      pageId,
      messageId,
    };
  }

  clearOutputForRetry(executor: DbExecutor, floorId: string): void {
    const outputPages = executor
      .select({ id: messagePages.id })
      .from(messagePages)
      .where(and(eq(messagePages.floorId, floorId), ne(messagePages.pageKind, "input")))
      .all() as Array<{ id: string }>;

    if (outputPages.length === 0) {
      return;
    }

    executor
      .delete(messagePages)
      .where(inArray(messagePages.id, outputPages.map((page) => page.id)))
      .run();
  }
}
