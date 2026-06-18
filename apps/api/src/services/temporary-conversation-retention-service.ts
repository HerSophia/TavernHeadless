import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { floors, messagePages, messages, sessions } from "../db/schema.js";
import {
  TEMPORARY_CONVERSATION_RETENTION_POLICIES,
  TEMPORARY_CONVERSATION_SESSION_KIND,
  TEMPORARY_CONVERSATION_TERMINAL_STATUSES,
  type TemporaryConversationRetentionPolicy,
  type TemporaryConversationTerminalStatus,
} from "./temporary-conversation-types.js";

/** Retention policies whose terminal conversations are cleaned by normal maintenance. */
const CLEANUP_ELIGIBLE_POLICIES: readonly TemporaryConversationRetentionPolicy[] = [
  "delete_on_finalize",
  "ttl",
];

const DEFAULT_EXPIRE_LIMIT = 500;
const DEFAULT_CLEANUP_LIMIT = 200;
const DEFAULT_CLEANUP_SCAN_LIMIT = 1_000;

export interface TemporaryConversationRetentionRunInput {
  now?: number;
  /** Grace window (ms) kept after a conversation reaches a terminal state before its body is cleaned. */
  retentionGraceMs?: number;
  /** Max conversations transitioned active -> expired per run. */
  expireLimit?: number;
  /** Max terminal conversations cleaned per run. */
  cleanupLimit?: number;
}

export interface TemporaryConversationRetentionRunResult {
  now: number;
  expired: number;
  cleaned: number;
  deletedMessages: number;
  cleanedByPolicy: Record<TemporaryConversationRetentionPolicy, number>;
  cleanedByStatus: Record<TemporaryConversationTerminalStatus, number>;
}

/**
 * Batch 8 (T4) temporary conversation retention maintenance.
 *
 * This service is db-only on purpose: cleanup never needs the chat runtime, so
 * it can run inside the generic RuntimeMaintenanceService without dragging in
 * ChatService. Two phases run per pass:
 *
 *  1. expire: active TTL conversations whose `expiresAt` has passed move to
 *     `expired`. This complements the lazy expiry done on read access.
 *  2. cleanup: terminal conversations (finalized / discarded / cancelled /
 *     expired) under a cleanup-eligible retention policy have their message
 *     bodies deleted after the retention grace window, while the session row,
 *     floor / page structure and audit timestamps are preserved. `keep_for_debug`
 *     conversations are never cleaned by this pass.
 *
 * Results only carry summary counts, never message bodies.
 */
export class TemporaryConversationRetentionService {
  constructor(private readonly db: AppDb) {}

  run(input: TemporaryConversationRetentionRunInput = {}): TemporaryConversationRetentionRunResult {
    const now = input.now ?? Date.now();
    const retentionGraceMs = Math.max(0, input.retentionGraceMs ?? 0);

    const expired = this.expireDue(now, input.expireLimit ?? DEFAULT_EXPIRE_LIMIT);
    const cleanup = this.cleanupEligible(now, retentionGraceMs, input.cleanupLimit ?? DEFAULT_CLEANUP_LIMIT);

    return {
      now,
      expired,
      cleaned: cleanup.cleaned,
      deletedMessages: cleanup.deletedMessages,
      cleanedByPolicy: cleanup.cleanedByPolicy,
      cleanedByStatus: cleanup.cleanedByStatus,
    };
  }

  /** Transitions active TTL conversations whose `expiresAt` already passed to `expired`. */
  expireDue(now = Date.now(), limit = DEFAULT_EXPIRE_LIMIT): number {
    const candidates = this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(
        eq(sessions.kind, TEMPORARY_CONVERSATION_SESSION_KIND),
        eq(sessions.status, "active"),
        isNotNull(sessions.expiresAt),
        lte(sessions.expiresAt, now),
      ))
      .limit(Math.max(1, limit))
      .all();

    if (candidates.length === 0) {
      return 0;
    }

    const updated = this.db
      .update(sessions)
      .set({ status: "expired", updatedAt: now })
      .where(and(
        inArray(sessions.id, candidates.map((row) => row.id)),
        eq(sessions.status, "active"),
      ))
      .returning({ id: sessions.id })
      .all();

    return updated.length;
  }

  /**
   * Deletes message bodies of terminal, cleanup-eligible temporary conversations
   * once the retention grace window has elapsed. Structure and audit fields stay.
   */
  cleanupEligible(
    now = Date.now(),
    retentionGraceMs = 0,
    limit = DEFAULT_CLEANUP_LIMIT,
  ): {
    cleaned: number;
    deletedMessages: number;
    cleanedByPolicy: Record<TemporaryConversationRetentionPolicy, number>;
    cleanedByStatus: Record<TemporaryConversationTerminalStatus, number>;
  } {
    const cleanedByPolicy = emptyPolicyCounter();
    const cleanedByStatus = emptyStatusCounter();
    let cleaned = 0;
    let deletedMessages = 0;

    const candidates = this.db
      .select({
        id: sessions.id,
        status: sessions.status,
        retentionPolicy: sessions.retentionPolicy,
        finalizedAt: sessions.finalizedAt,
        discardedAt: sessions.discardedAt,
        cancelledAt: sessions.cancelledAt,
        expiresAt: sessions.expiresAt,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .where(and(
        eq(sessions.kind, TEMPORARY_CONVERSATION_SESSION_KIND),
        isNull(sessions.cleanedAt),
        inArray(sessions.status, [...TEMPORARY_CONVERSATION_TERMINAL_STATUSES]),
        inArray(sessions.retentionPolicy, [...CLEANUP_ELIGIBLE_POLICIES]),
      ))
      .limit(DEFAULT_CLEANUP_SCAN_LIMIT)
      .all();

    for (const candidate of candidates) {
      if (cleaned >= Math.max(1, limit)) {
        break;
      }

      const status = candidate.status as TemporaryConversationTerminalStatus;
      const policy = candidate.retentionPolicy as TemporaryConversationRetentionPolicy | null;
      if (!policy || !CLEANUP_ELIGIBLE_POLICIES.includes(policy)) {
        continue;
      }

      const terminalAt = resolveTerminalAt(candidate, status);
      if (terminalAt === null || terminalAt + retentionGraceMs > now) {
        continue;
      }

      deletedMessages += this.cleanupConversationBody(candidate.id, now);
      cleaned += 1;
      cleanedByPolicy[policy] += 1;
      cleanedByStatus[status] += 1;
    }

    return { cleaned, deletedMessages, cleanedByPolicy, cleanedByStatus };
  }

  private cleanupConversationBody(conversationId: string, now: number): number {
    const floorRows = this.db
      .select({ id: floors.id })
      .from(floors)
      .where(eq(floors.sessionId, conversationId))
      .all();

    let deletedMessages = 0;
    if (floorRows.length > 0) {
      const pageRows = this.db
        .select({ id: messagePages.id })
        .from(messagePages)
        .where(inArray(messagePages.floorId, floorRows.map((row) => row.id)))
        .all();

      if (pageRows.length > 0) {
        const deleted = this.db
          .delete(messages)
          .where(inArray(messages.pageId, pageRows.map((row) => row.id)))
          .returning({ id: messages.id })
          .all();
        deletedMessages = deleted.length;
      }
    }

    this.db
      .update(sessions)
      .set({ cleanedAt: now, updatedAt: now })
      .where(eq(sessions.id, conversationId))
      .run();

    return deletedMessages;
  }
}

function resolveTerminalAt(
  candidate: {
    finalizedAt: number | null;
    discardedAt: number | null;
    cancelledAt: number | null;
    expiresAt: number | null;
    updatedAt: number;
  },
  status: TemporaryConversationTerminalStatus,
): number | null {
  switch (status) {
    case "finalized":
      return candidate.finalizedAt ?? candidate.updatedAt;
    case "discarded":
      return candidate.discardedAt ?? candidate.updatedAt;
    case "cancelled":
      return candidate.cancelledAt ?? candidate.updatedAt;
    case "expired":
      return candidate.expiresAt ?? candidate.updatedAt;
    default:
      return null;
  }
}

function emptyPolicyCounter(): Record<TemporaryConversationRetentionPolicy, number> {
  const counter = {} as Record<TemporaryConversationRetentionPolicy, number>;
  for (const policy of TEMPORARY_CONVERSATION_RETENTION_POLICIES) {
    counter[policy] = 0;
  }
  return counter;
}

function emptyStatusCounter(): Record<TemporaryConversationTerminalStatus, number> {
  const counter = {} as Record<TemporaryConversationTerminalStatus, number>;
  for (const status of TEMPORARY_CONVERSATION_TERMINAL_STATUSES) {
    counter[status] = 0;
  }
  return counter;
}
