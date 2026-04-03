import { and, eq, inArray } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floors, messagePages, messages, sessions } from "../db/schema.js";

export type OwnedSessionRecord = typeof sessions.$inferSelect;
export type OwnedFloorRecord = typeof floors.$inferSelect;
export type OwnedPageRecord = typeof messagePages.$inferSelect;
export type OwnedMessageRecord = typeof messages.$inferSelect;

type QueryExecutor = AppDb | DbExecutor;

export interface OwnedPageContext extends OwnedPageRecord {
  floorState: typeof floors.$inferSelect["state"];
  floorSupersededAt: number | null;
  sessionId: string;
  branchId: string;
}

export interface OwnedMessageContext extends OwnedMessageRecord {
  pageKind: typeof messagePages.$inferSelect["pageKind"];
  pageIsActive: boolean;
  floorId: string;
  floorNo: number;
  floorState: typeof floors.$inferSelect["state"];
  floorSupersededAt: number | null;
  sessionId: string;
  branchId: string;
}

export class OwnedSessionRepository {
  constructor(private readonly db: QueryExecutor) {}

  listIds(accountId: string, candidateSessionIds?: readonly string[]): string[] {
    const sessionIds = normalizeCandidateIds(candidateSessionIds);

    if (sessionIds && sessionIds.length === 0) {
      return [];
    }

    const whereClause = sessionIds
      ? and(eq(sessions.accountId, accountId), inArray(sessions.id, sessionIds))
      : eq(sessions.accountId, accountId);

    const rows = this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(whereClause)
      .all();

    return rows.map((row) => row.id);
  }

  getById(accountId: string, sessionId: string): OwnedSessionRecord | null {
    const row = this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .limit(1)
      .all()[0];

    return row ?? null;
  }
}

export class OwnedFloorRepository {
  constructor(private readonly db: QueryExecutor) {}

  listIds(accountId: string, candidateFloorIds?: readonly string[]): string[] {
    const floorIds = normalizeCandidateIds(candidateFloorIds);

    if (floorIds && floorIds.length === 0) {
      return [];
    }

    const rows = this.db
      .select({ id: floors.id })
      .from(floors)
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(
        floorIds
          ? and(eq(sessions.accountId, accountId), inArray(floors.id, floorIds))
          : eq(sessions.accountId, accountId)
      )
      .all();

    return rows.map((row) => row.id);
  }

  getById(accountId: string, floorId: string): OwnedFloorRecord | null {
    const row = this.db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        floorNo: floors.floorNo,
        branchId: floors.branchId,
        parentFloorId: floors.parentFloorId,
        supersededAt: floors.supersededAt,
        supersededByFloorId: floors.supersededByFloorId,
        state: floors.state,
        metadataJson: floors.metadataJson,
        tokenIn: floors.tokenIn,
        tokenOut: floors.tokenOut,
        createdAt: floors.createdAt,
        updatedAt: floors.updatedAt,
      })
      .from(floors)
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(floors.id, floorId), eq(sessions.accountId, accountId)))
      .limit(1)
      .all()[0];

    return row ?? null;
  }
}

export class OwnedPageRepository {
  constructor(private readonly db: QueryExecutor) {}

  listIds(accountId: string, candidatePageIds?: readonly string[]): string[] {
    const pageIds = normalizeCandidateIds(candidatePageIds);

    if (pageIds && pageIds.length === 0) {
      return [];
    }

    const rows = this.db
      .select({ id: messagePages.id })
      .from(messagePages)
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(
        pageIds
          ? and(eq(sessions.accountId, accountId), inArray(messagePages.id, pageIds))
          : eq(sessions.accountId, accountId)
      )
      .all();

    return rows.map((row) => row.id);
  }

  getContextById(accountId: string, pageId: string): OwnedPageContext | null {
    return this.getContextsByIds(accountId, [pageId])[0] ?? null;
  }

  getContextsByIds(accountId: string, candidatePageIds: readonly string[]): OwnedPageContext[] {
    const pageIds = normalizeCandidateIds(candidatePageIds);

    if (!pageIds || pageIds.length === 0) {
      return [];
    }

    return this.db
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
        floorState: floors.state,
        floorSupersededAt: floors.supersededAt,
        sessionId: floors.sessionId,
        branchId: floors.branchId,
      })
      .from(messagePages)
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(sessions.accountId, accountId), inArray(messagePages.id, pageIds)))
      .all();
  }
}

export class OwnedMessageRepository {
  constructor(private readonly db: QueryExecutor) {}

  listIds(accountId: string, candidateMessageIds?: readonly string[]): string[] {
    const messageIds = normalizeCandidateIds(candidateMessageIds);

    if (messageIds && messageIds.length === 0) {
      return [];
    }

    const rows = this.db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(
        messageIds
          ? and(eq(sessions.accountId, accountId), inArray(messages.id, messageIds))
          : eq(sessions.accountId, accountId)
      )
      .all();

    return rows.map((row) => row.id);
  }

  getContextById(accountId: string, messageId: string): OwnedMessageContext | null {
    return this.getContextsByIds(accountId, [messageId])[0] ?? null;
  }

  getContextsByIds(accountId: string, candidateMessageIds: readonly string[]): OwnedMessageContext[] {
    const messageIds = normalizeCandidateIds(candidateMessageIds);

    if (!messageIds || messageIds.length === 0) {
      return [];
    }

    return this.db
      .select({
        id: messages.id,
        pageId: messages.pageId,
        seq: messages.seq,
        role: messages.role,
        content: messages.content,
        contentFormat: messages.contentFormat,
        tokenCount: messages.tokenCount,
        isHidden: messages.isHidden,
        source: messages.source,
        createdAt: messages.createdAt,
        pageKind: messagePages.pageKind,
        pageIsActive: messagePages.isActive,
        floorId: floors.id,
        floorNo: floors.floorNo,
        floorState: floors.state,
        floorSupersededAt: floors.supersededAt,
        sessionId: floors.sessionId,
        branchId: floors.branchId,
      })
      .from(messages)
      .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(sessions.accountId, accountId), inArray(messages.id, messageIds)))
      .all();
  }
}

function normalizeCandidateIds(candidateIds?: readonly string[]): string[] | undefined {
  if (candidateIds === undefined) {
    return undefined;
  }

  return Array.from(new Set(candidateIds));
}
