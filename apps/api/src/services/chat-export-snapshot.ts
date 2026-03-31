import { and, asc, count, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../accounts/constants.js";
import {
  floors,
  memoryEdges,
  memoryItems,
  messagePages,
  messages,
  presets,
  sessions,
} from "../db/schema.js";
import { parseJsonField } from "../lib/http.js";
import { VariableService } from "./variable-service.js";

export interface ChatExportSnapshotOptions {
  accountId?: string;
  includeVariables?: boolean;
  includeMemories?: boolean;
}

export interface ExportSnapshotMessage {
  id: string;
  seq: number;
  role: "user" | "assistant" | "system" | "narrator";
  content: string;
  contentFormat: "text" | "markdown" | "json";
  tokenCount: number;
  isHidden: boolean;
  source: string | null;
  createdAt: number;
}

export interface ExportSnapshotPage {
  id: string;
  pageNo: number;
  pageKind: "input" | "output" | "mixed";
  isActive: boolean;
  version: number;
  checksum: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ExportSnapshotMessage[];
}

export interface ExportSnapshotFloor {
  id: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: "draft" | "generating" | "committed" | "failed";
  tokenIn: number;
  tokenOut: number;
  metadata: unknown;
  createdAt: number;
  updatedAt: number;
  pages: ExportSnapshotPage[];
}

export interface ExportSnapshotVariable {
  scope: "chat" | "floor" | "page";
  scopeId: string;
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface ExportSnapshotMemoryItem {
  id: string;
  scope: "chat" | "floor";
  scopeId: string;
  type: "fact" | "summary" | "open_loop";
  summaryTier: "micro" | "macro" | null;
  content: unknown;
  importance: number;
  confidence: number;
  sourceFloorId: string | null;
  sourceMessageId: string | null;
  status: "active" | "deprecated";
  lifecycleStatus: "active" | "compacted" | "deprecated";
  sourceJobId: string | null;
  tokenCountEstimate: number | null;
  lastUsedAt: number | null;
  coverageStartFloorNo: number | null;
  coverageEndFloorNo: number | null;
  derivedFromCount: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExportSnapshotMemoryEdge {
  fromId: string;
  toId: string;
  relation: "supports" | "contradicts" | "updates" | "derived_from" | "compacts" | "resolves";
  createdAt: number;
}

export interface SessionExportSnapshot {
  sessionId: string;
  accountId: string;
  title: string | null;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
  characterSnapshot: Record<string, unknown> | null;
  userSnapshot: Record<string, unknown> | null;
  characterSyncPolicy: "pin" | "manual" | "force";
  promptMode: "compat_strict" | "compat_plus" | "native" | null;
  modelProvider: string | null;
  modelName: string | null;
  metadata: unknown;
  presetName: string | null;
  floors: ExportSnapshotFloor[];
  variables?: ExportSnapshotVariable[];
  memories?: {
    items: ExportSnapshotMemoryItem[];
    edges: ExportSnapshotMemoryEdge[];
  };
  messageCount: number;
}

export function countSessionExportMessages(
  db: AppDb,
  sessionId: string,
  options?: Pick<ChatExportSnapshotOptions, "accountId">,
): number {
  const accountId = options?.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID;

  const session = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
    .get();

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const row = db
    .select({ total: count() })
    .from(messages)
    .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
    .innerJoin(floors, eq(messagePages.floorId, floors.id))
    .innerJoin(sessions, eq(floors.sessionId, sessions.id))
    .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
    .get();

  return Number(row?.total ?? 0);
}

export function captureSessionExportSnapshot(
  db: AppDb,
  sessionId: string,
  options?: ChatExportSnapshotOptions,
): SessionExportSnapshot {
  const includeVariables = options?.includeVariables ?? true;
  const includeMemories = options?.includeMemories ?? true;
  const accountId = options?.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID;

  return db.transaction((tx) => {
    const session = tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .get();

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const presetName = session.presetId
      ? tx
          .select({ name: presets.name })
          .from(presets)
          .where(and(eq(presets.id, session.presetId), eq(presets.accountId, accountId)))
          .get()?.name ?? null
      : null;

    const floorRows = tx
      .select()
      .from(floors)
      .where(eq(floors.sessionId, sessionId))
      .orderBy(asc(floors.floorNo), asc(floors.branchId))
      .all();

    const floorIds = floorRows.map((row) => row.id);
    const pageRows = floorIds.length > 0
      ? tx
          .select()
          .from(messagePages)
          .where(inArray(messagePages.floorId, floorIds))
          .orderBy(asc(messagePages.pageNo), asc(messagePages.version))
          .all()
      : [];
    const pageIds = pageRows.map((row) => row.id);
    const messageRows = pageIds.length > 0
      ? tx
          .select()
          .from(messages)
          .where(inArray(messages.pageId, pageIds))
          .orderBy(asc(messages.seq))
          .all()
      : [];

    const messagesByPage = new Map<string, ExportSnapshotMessage[]>();
    for (const row of messageRows) {
      const list = messagesByPage.get(row.pageId);
      const message: ExportSnapshotMessage = {
        id: row.id,
        seq: row.seq,
        role: row.role,
        content: row.content,
        contentFormat: row.contentFormat,
        tokenCount: row.tokenCount,
        isHidden: row.isHidden,
        source: row.source,
        createdAt: row.createdAt,
      };
      if (list) {
        list.push(message);
      } else {
        messagesByPage.set(row.pageId, [message]);
      }
    }

    const pagesByFloor = new Map<string, ExportSnapshotPage[]>();
    for (const row of pageRows) {
      const list = pagesByFloor.get(row.floorId);
      const page: ExportSnapshotPage = {
        id: row.id,
        pageNo: row.pageNo,
        pageKind: row.pageKind,
        isActive: row.isActive,
        version: row.version,
        checksum: row.checksum,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        messages: messagesByPage.get(row.id) ?? [],
      };
      if (list) {
        list.push(page);
      } else {
        pagesByFloor.set(row.floorId, [page]);
      }
    }

    const snapshotFloors: ExportSnapshotFloor[] = floorRows.map((row) => ({
      id: row.id,
      floorNo: row.floorNo,
      branchId: row.branchId,
      parentFloorId: row.parentFloorId,
      state: row.state,
      tokenIn: row.tokenIn,
      tokenOut: row.tokenOut,
      metadata: parseJsonField(row.metadataJson ?? null),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      pages: pagesByFloor.get(row.id) ?? [],
    }));

    let snapshotVariables: ExportSnapshotVariable[] | undefined;
    if (includeVariables) {
      const variableService = new VariableService(tx);
      const rows = variableService.listByTargets({
        accountId,
        targets: [
          { scope: "chat", scopeId: sessionId },
          ...floorIds.map((floorId) => ({ scope: "floor" as const, scopeId: floorId })),
          ...pageIds.map((pageId) => ({ scope: "page" as const, scopeId: pageId })),
        ],
      });

      snapshotVariables = rows.map((row) => ({
        scope: row.scope as "chat" | "floor" | "page",
        scopeId: row.scopeId,
        key: row.key,
        value: row.value,
        updatedAt: row.updatedAt,
      }));
    }

    let snapshotMemories: SessionExportSnapshot["memories"] | undefined;
    if (includeMemories) {
      const chatAndFloorIds = [sessionId, ...floorIds];
      const itemRows = chatAndFloorIds.length > 0
        ? tx
            .select()
            .from(memoryItems)
            .where(and(
              eq(memoryItems.accountId, accountId),
              inArray(memoryItems.scope, ["chat", "floor"]),
              inArray(memoryItems.scopeId, chatAndFloorIds),
            ))
            .all()
        : [];
      const itemIds = itemRows.map((row) => row.id);
      const edgeRows = itemIds.length > 0
        ? tx
            .select()
            .from(memoryEdges)
            .where(and(eq(memoryEdges.accountId, accountId), inArray(memoryEdges.fromId, itemIds)))
            .all()
        : [];

      snapshotMemories = {
        items: itemRows.map((row) => ({
          id: row.id,
          scope: row.scope as "chat" | "floor",
          scopeId: row.scopeId,
          type: row.type,
          summaryTier: row.summaryTier,
          content: parseJsonField(row.contentJson),
          importance: row.importance,
          confidence: row.confidence,
          sourceFloorId: row.sourceFloorId,
          sourceMessageId: row.sourceMessageId,
          status: row.status,
          lifecycleStatus: row.lifecycleStatus,
          sourceJobId: row.sourceJobId,
          tokenCountEstimate: row.tokenCountEstimate,
          lastUsedAt: row.lastUsedAt,
          coverageStartFloorNo: row.coverageStartFloorNo,
          coverageEndFloorNo: row.coverageEndFloorNo,
          derivedFromCount: row.derivedFromCount,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        edges: edgeRows.map((row) => ({
          fromId: row.fromId,
          toId: row.toId,
          relation: row.relation,
          createdAt: row.createdAt,
        })),
      };
    }

    return {
      sessionId: session.id,
      accountId,
      title: session.title,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      characterSnapshot: parseJsonField(session.characterSnapshotJson ?? null) as Record<string, unknown> | null,
      userSnapshot: parseJsonField(session.userSnapshotJson ?? null) as Record<string, unknown> | null,
      characterSyncPolicy: session.characterSyncPolicy,
      promptMode: session.promptMode,
      modelProvider: session.modelProvider,
      modelName: session.modelName,
      metadata: parseJsonField(session.metadataJson ?? null),
      presetName,
      floors: snapshotFloors,
      ...(snapshotVariables ? { variables: snapshotVariables } : {}),
      ...(snapshotMemories ? { memories: snapshotMemories } : {}),
      messageCount: messageRows.length,
    };
  });
}
