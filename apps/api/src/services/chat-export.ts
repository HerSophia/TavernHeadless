/**
 * Chat Export Service
 *
 * 提供两种序列化方式：
 * - serializeSessionToThChat：原生 .thchat 格式（无损）
 * - serializeSessionToStJsonl：ST .jsonl 降级格式（有损）
 */

import { asc, eq, and, inArray } from "drizzle-orm";
import {
  TH_CHAT_SPEC,
  TH_CHAT_SPEC_VERSION,
  type ThChatFile,
  type ThChatFloor,
  type ThChatPage,
  type ThChatMessage,
  type ThChatVariable,
  type ThChatMemoryItem,
  type ThChatMemoryEdge,
} from "@tavern/shared";

import type { AppDb } from "../db/client.js";
import {
  sessions,
  floors,
  messagePages,
  messages,
  variables,
  memoryItems,
  memoryEdges,
  presets,
} from "../db/schema.js";
import { parseJsonField } from "../lib/http.js";

// ── Types ──────────────────────────────────────────────

export interface ChatExportOptions {
  includeVariables?: boolean;
  includeMemories?: boolean;
  appVersion?: string;
}

// ── 原生格式 serializer ────────────────────────────────

export function serializeSessionToThChat(
  db: AppDb,
  sessionId: string,
  options?: ChatExportOptions,
): ThChatFile {
  const includeVariables = options?.includeVariables ?? true;
  const includeMemories = options?.includeMemories ?? true;

  // 1. 查询 session
  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // 2. 查询 preset 名称
  let presetName: string | null = null;
  if (session.presetId) {
    const presetRow = db
      .select({ name: presets.name })
      .from(presets)
      .where(eq(presets.id, session.presetId))
      .get();
    presetName = presetRow?.name ?? null;
  }

  // 3. 查询所有 floor
  const floorRows = db
    .select()
    .from(floors)
    .where(eq(floors.sessionId, sessionId))
    .orderBy(asc(floors.floorNo), asc(floors.branchId))
    .all();

  const floorIds = floorRows.map((f) => f.id);

  // 4. 查询所有 page（一次查出，按 floorId 分组）
  const pageRows = floorIds.length > 0
    ? db
        .select()
        .from(messagePages)
        .where(inArray(messagePages.floorId, floorIds))
        .orderBy(asc(messagePages.pageNo), asc(messagePages.version))
        .all()
    : [];

  const pagesByFloor = new Map<string, typeof pageRows>();
  for (const page of pageRows) {
    const list = pagesByFloor.get(page.floorId);
    if (list) {
      list.push(page);
    } else {
      pagesByFloor.set(page.floorId, [page]);
    }
  }

  // 5. 查询所有 message（一次查出，按 pageId 分组）
  const pageIds = pageRows.map((p) => p.id);
  const messageRows = pageIds.length > 0
    ? db
        .select()
        .from(messages)
        .where(inArray(messages.pageId, pageIds))
        .orderBy(asc(messages.seq))
        .all()
    : [];

  const messagesByPage = new Map<string, typeof messageRows>();
  for (const msg of messageRows) {
    const list = messagesByPage.get(msg.pageId);
    if (list) {
      list.push(msg);
    } else {
      messagesByPage.set(msg.pageId, [msg]);
    }
  }

  // 6. 组装 floors → pages → messages 树
  const exportFloors: ThChatFloor[] = floorRows.map((f) => {
    const floorPages = pagesByFloor.get(f.id) ?? [];

    const exportPages: ThChatPage[] = floorPages.map((p) => {
      const pageMsgs = messagesByPage.get(p.id) ?? [];

      const exportMessages: ThChatMessage[] = pageMsgs.map((m) => ({
        seq: m.seq,
        role: m.role,
        content: m.content,
        content_format: m.contentFormat,
        token_count: m.tokenCount,
        is_hidden: m.isHidden,
        source: m.source,
        created_at: m.createdAt,
        _original_id: m.id,
      }));

      return {
        page_no: p.pageNo,
        page_kind: p.pageKind,
        is_active: p.isActive,
        version: p.version,
        checksum: p.checksum,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
        _original_id: p.id,
        messages: exportMessages,
      };
    });

    return {
      floor_no: f.floorNo,
      branch_id: f.branchId,
      parent_floor_id_ref: f.parentFloorId,
      state: f.state,
      token_in: f.tokenIn,
      token_out: f.tokenOut,
      metadata: parseJsonField(f.metadataJson ?? null),
      created_at: f.createdAt,
      updated_at: f.updatedAt,
      _original_id: f.id,
      pages: exportPages,
    };
  });

  // 7. 收集所有需要的 scopeId（用于变量和记忆查询）
  const allScopeIds = [sessionId, ...floorIds, ...pageIds];

  // 8. 查询变量
  let exportVariables: ThChatVariable[] | undefined;
  if (includeVariables && allScopeIds.length > 0) {
    const varRows = db
      .select()
      .from(variables)
      .where(
        and(
          inArray(variables.scope, ["chat", "floor", "page"]),
          inArray(variables.scopeId, allScopeIds),
        ),
      )
      .all();

    exportVariables = varRows.map((v) => ({
      scope: v.scope as "chat" | "floor" | "page",
      scope_id_ref: v.scopeId === sessionId ? null : v.scopeId,
      key: v.key,
      value: JSON.parse(v.valueJson),
      updated_at: v.updatedAt,
    }));
  }

  // 9. 查询记忆
  let exportMemories: { items: ThChatMemoryItem[]; edges: ThChatMemoryEdge[] } | undefined;
  if (includeMemories) {
    const chatAndFloorIds = [sessionId, ...floorIds];

    const memItems = chatAndFloorIds.length > 0
      ? db
          .select()
          .from(memoryItems)
          .where(
            and(
              inArray(memoryItems.scope, ["chat", "floor"]),
              inArray(memoryItems.scopeId, chatAndFloorIds),
            ),
          )
          .all()
      : [];

    const memItemIds = memItems.map((m) => m.id);

    const memEdgeRows = memItemIds.length > 0
      ? db
          .select()
          .from(memoryEdges)
          .where(inArray(memoryEdges.fromId, memItemIds))
          .all()
      : [];

    const exportItems: ThChatMemoryItem[] = memItems.map((m) => ({
      _original_id: m.id,
      scope: m.scope as "chat" | "floor",
      scope_id_ref: m.scopeId === sessionId ? null : m.scopeId,
      type: m.type,
      content: JSON.parse(m.contentJson),
      importance: m.importance,
      confidence: m.confidence,
      source_floor_id_ref: m.sourceFloorId,
      source_message_id_ref: m.sourceMessageId,
      status: m.status,
      created_at: m.createdAt,
      updated_at: m.updatedAt,
    }));

    const exportEdges: ThChatMemoryEdge[] = memEdgeRows.map((e) => ({
      from_id_ref: e.fromId,
      to_id_ref: e.toId,
      relation: e.relation,
      created_at: e.createdAt,
    }));

    exportMemories = { items: exportItems, edges: exportEdges };
  }

  // 10. 组装完整文件
  const result: ThChatFile = {
    spec: TH_CHAT_SPEC,
    spec_version: TH_CHAT_SPEC_VERSION,
    exported_at: Date.now(),
    export_source: "tavern_headless",
    export_app_version: options?.appVersion,
    data: {
      title: session.title,
      status: session.status,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      character_snapshot: parseJsonField(session.characterSnapshotJson ?? null) as Record<string, unknown> | null,
      user_snapshot: parseJsonField(session.userSnapshotJson ?? null) as Record<string, unknown> | null,
      character_sync_policy: session.characterSyncPolicy,
      preset_name: presetName,
      prompt_mode: session.promptMode ?? null,
      model_provider: session.modelProvider ?? null,
      model_name: session.modelName ?? null,
      metadata: parseJsonField(session.metadataJson ?? null),
      floors: exportFloors,
      variables: exportVariables,
      memories: exportMemories,
    },
  };

  return result;
}

// ── ST jsonl 降级 serializer ───────────────────────────

export function serializeSessionToStJsonl(
  db: AppDb,
  sessionId: string,
): string {
  // 1. 查询 session
  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const charSnapshot = parseJsonField(session.characterSnapshotJson ?? null) as Record<string, unknown> | null;
  const userSnapshot = parseJsonField(session.userSnapshotJson ?? null) as Record<string, unknown> | null;

  const userName = (userSnapshot?.name as string) ?? "User";
  const characterName = (charSnapshot?.name as string) ?? session.title ?? "Assistant";

  // 2. 构建 header 行
  const header = {
    user_name: userName,
    character_name: characterName,
    chat_metadata: {
      th_export: true,
      th_session_title: session.title,
    },
  };

  const lines: string[] = [JSON.stringify(header)];

  // 3. 查询 main 分支的 committed floor
  const floorRows = db
    .select()
    .from(floors)
    .where(
      and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, "main"),
        eq(floors.state, "committed"),
      ),
    )
    .orderBy(asc(floors.floorNo))
    .all();

  // 4. 遍历每个 floor
  for (const floor of floorRows) {
    // 查询该 floor 的所有 page
    const pageRowsForFloor = db
      .select()
      .from(messagePages)
      .where(eq(messagePages.floorId, floor.id))
      .orderBy(asc(messagePages.pageNo), asc(messagePages.version))
      .all();

    // 按 pageNo 分组
    const pageGroups = new Map<number, typeof pageRowsForFloor>();
    for (const p of pageRowsForFloor) {
      const list = pageGroups.get(p.pageNo);
      if (list) {
        list.push(p);
      } else {
        pageGroups.set(p.pageNo, [p]);
      }
    }

    // 按 pageNo 排序遍历
    const sortedPageNos = [...pageGroups.keys()].sort((a, b) => a - b);

    for (const pageNo of sortedPageNos) {
      const pagesForNo = pageGroups.get(pageNo)!;

      // 找到 active page
      const activePage = pagesForNo.find((p) => p.isActive) ?? pagesForNo[0]!;

      // 查询 active page 的消息（主消息）
      const activeMessages = db
        .select()
        .from(messages)
        .where(eq(messages.pageId, activePage.id))
        .orderBy(asc(messages.seq))
        .all();

      if (activeMessages.length === 0) continue;

      // 取第一条消息作为代表
      const mainMsg = activeMessages[0]!;

      // 构建 swipes（如果有多个 version）
      let swipes: string[] | undefined;
      let swipeId: number | undefined;

      if (pagesForNo.length > 1) {
        swipes = [];
        for (let i = 0; i < pagesForNo.length; i++) {
          const page = pagesForNo[i]!;
          if (page.id === activePage.id) {
            swipeId = i;
          }
          // 获取该 version 的第一条消息内容
          const versionMsgs = page.id === activePage.id
            ? activeMessages
            : db
                .select()
                .from(messages)
                .where(eq(messages.pageId, page.id))
                .orderBy(asc(messages.seq))
                .all();
          swipes.push(versionMsgs[0]?.content ?? "");
        }
      }

      // 推断 name
      const name = inferStName(mainMsg.role, mainMsg.source, userName, characterName);

      // 构建消息行
      const msgLine: Record<string, unknown> = {
        name,
        is_user: mainMsg.role === "user",
        is_system: mainMsg.role === "system" || mainMsg.isHidden,
        mes: mainMsg.content,
        send_date: mainMsg.createdAt,
      };

      if (swipes !== undefined && swipes.length > 1) {
        msgLine.swipes = swipes;
        msgLine.swipe_id = swipeId ?? 0;
      }

      lines.push(JSON.stringify(msgLine));

      // 如果 active page 有多条消息（seq > 0），逐条输出
      for (let s = 1; s < activeMessages.length; s++) {
        const extraMsg = activeMessages[s]!;
        const extraName = inferStName(extraMsg.role, extraMsg.source, userName, characterName);
        lines.push(JSON.stringify({
          name: extraName,
          is_user: extraMsg.role === "user",
          is_system: extraMsg.role === "system" || extraMsg.isHidden,
          mes: extraMsg.content,
          send_date: extraMsg.createdAt,
        }));
      }
    }
  }

  return lines.join("\n");
}

// ── 辅助函数 ──────────────────────────────────────────

function inferStName(
  role: string,
  source: string | null,
  userName: string,
  characterName: string,
): string {
  // 如果 source 存在且不是 st_import: 前缀，直接用
  if (source && !source.startsWith("st_import:")) {
    // 但 source 为 "user" 时用 userName
    if (source === "user") return userName;
    return source;
  }

  // 从 st_import: 提取原始名称
  if (source && source.startsWith("st_import:")) {
    return source.slice("st_import:".length);
  }

  // fallback
  return role === "user" ? userName : characterName;
}
