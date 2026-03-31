/**
 * Chat Export Service
 *
 * 提供两种序列化方式：
 * - serializeSessionToThChat：原生 .thchat 格式（无损）
 * - serializeSessionToStJsonl：ST .jsonl 降级格式（有损）
 */

import type { ThChatFile } from "@tavern/shared";

import type { AppDb } from "../db/client.js";
import type { ChatExportSnapshotOptions } from "./chat-export-snapshot.js";
import { captureSessionExportSnapshot } from "./chat-export-snapshot.js";
import {
  renderExportSnapshotToStJsonl,
  renderExportSnapshotToThChat,
} from "./chat-export-renderer.js";

export interface ChatExportOptions extends ChatExportSnapshotOptions {
  appVersion?: string;
}

export function serializeSessionToThChat(
  db: AppDb,
  sessionId: string,
  options?: ChatExportOptions,
): ThChatFile {
  const snapshot = captureSessionExportSnapshot(db, sessionId, options);
  return renderExportSnapshotToThChat(snapshot, { appVersion: options?.appVersion });
}

export function serializeSessionToStJsonl(
  db: AppDb,
  sessionId: string,
  options?: Pick<ChatExportOptions, "accountId">,
): string {
  const snapshot = captureSessionExportSnapshot(db, sessionId, {
    accountId: options?.accountId,
    includeVariables: false,
    includeMemories: false,
  });
  return renderExportSnapshotToStJsonl(snapshot);
}
