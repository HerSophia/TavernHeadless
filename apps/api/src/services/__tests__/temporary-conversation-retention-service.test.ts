import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, messagePages, messages, sessions } from "../../db/schema.js";
import { TemporaryConversationRetentionService } from "../temporary-conversation-retention-service.js";
import type {
  TemporaryConversationRetentionPolicy,
  TemporaryConversationStatus,
} from "../temporary-conversation-types.js";

const NOW = 1_736_000_000_000;

describe("TemporaryConversationRetentionService", () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    await database.db.insert(accounts).values({
      id: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "Admin",
      role: "admin",
      status: "active",
      isDefault: true,
      createdAt: NOW,
      updatedAt: NOW,
    }).onConflictDoNothing();
  });

  afterEach(() => {
    database.close();
  });

  it("expires active ttl conversations whose expiresAt already passed", async () => {
    const dueId = await seedTemporaryConversation(database, {
      status: "active",
      retentionPolicy: "ttl",
      expiresAt: NOW - 1_000,
    });
    const futureId = await seedTemporaryConversation(database, {
      status: "active",
      retentionPolicy: "ttl",
      expiresAt: NOW + 60_000,
    });

    const expired = new TemporaryConversationRetentionService(database.db).expireDue(NOW);

    expect(expired).toBe(1);
    expect(await statusOf(database, dueId)).toBe("expired");
    expect(await statusOf(database, futureId)).toBe("active");
  });

  it("cleans terminal delete_on_finalize and ttl conversations but keeps keep_for_debug", async () => {
    const finalizedId = await seedTemporaryConversation(database, {
      status: "finalized",
      retentionPolicy: "delete_on_finalize",
      finalizedAt: NOW - 5_000,
      messageContents: ["secret user message", "secret assistant reply"],
    });
    const expiredId = await seedTemporaryConversation(database, {
      status: "expired",
      retentionPolicy: "ttl",
      expiresAt: NOW - 5_000,
      messageContents: ["expired body"],
    });
    const debugId = await seedTemporaryConversation(database, {
      status: "finalized",
      retentionPolicy: "keep_for_debug",
      finalizedAt: NOW - 5_000,
      messageContents: ["debug body must stay"],
    });
    const activeId = await seedTemporaryConversation(database, {
      status: "active",
      retentionPolicy: "delete_on_finalize",
      messageContents: ["live body"],
    });

    const result = new TemporaryConversationRetentionService(database.db).run({ now: NOW });

    expect(result.cleaned).toBe(2);
    expect(result.deletedMessages).toBe(3);
    expect(result.cleanedByPolicy.delete_on_finalize).toBe(1);
    expect(result.cleanedByPolicy.ttl).toBe(1);
    expect(result.cleanedByStatus.finalized).toBe(1);
    expect(result.cleanedByStatus.expired).toBe(1);

    expect(await messageCountOf(database, finalizedId)).toBe(0);
    expect(await messageCountOf(database, expiredId)).toBe(0);
    expect(await cleanedAtOf(database, finalizedId)).toBe(NOW);
    expect(await cleanedAtOf(database, expiredId)).toBe(NOW);

    // keep_for_debug and active conversations are untouched.
    expect(await messageCountOf(database, debugId)).toBe(1);
    expect(await cleanedAtOf(database, debugId)).toBeNull();
    expect(await messageCountOf(database, activeId)).toBe(1);
    expect(await cleanedAtOf(database, activeId)).toBeNull();
  });

  it("respects the retention grace window before cleaning a terminal conversation", async () => {
    const recentlyFinalizedId = await seedTemporaryConversation(database, {
      status: "finalized",
      retentionPolicy: "delete_on_finalize",
      finalizedAt: NOW - 1_000,
      messageContents: ["fresh body"],
    });

    const service = new TemporaryConversationRetentionService(database.db);

    const withinGrace = service.cleanupEligible(NOW, 10_000);
    expect(withinGrace.cleaned).toBe(0);
    expect(await messageCountOf(database, recentlyFinalizedId)).toBe(1);

    const afterGrace = service.cleanupEligible(NOW, 500);
    expect(afterGrace.cleaned).toBe(1);
    expect(await messageCountOf(database, recentlyFinalizedId)).toBe(0);
  });

  it("does not clean the same conversation twice", async () => {
    await seedTemporaryConversation(database, {
      status: "discarded",
      retentionPolicy: "delete_on_finalize",
      discardedAt: NOW - 5_000,
      messageContents: ["one"],
    });

    const service = new TemporaryConversationRetentionService(database.db);
    const first = service.cleanupEligible(NOW);
    const second = service.cleanupEligible(NOW);

    expect(first.cleaned).toBe(1);
    expect(second.cleaned).toBe(0);
  });
});

async function seedTemporaryConversation(
  database: DatabaseConnection,
  input: {
    status: TemporaryConversationStatus;
    retentionPolicy: TemporaryConversationRetentionPolicy;
    expiresAt?: number | null;
    finalizedAt?: number | null;
    discardedAt?: number | null;
    cancelledAt?: number | null;
    messageContents?: string[];
  },
): Promise<string> {
  const conversationId = nanoid();
  await database.db.insert(sessions).values({
    id: conversationId,
    title: "Temp",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: input.status,
    kind: "temporary",
    purpose: "test",
    retentionPolicy: input.retentionPolicy,
    visibility: "internal",
    expiresAt: input.expiresAt ?? null,
    finalizedAt: input.finalizedAt ?? null,
    discardedAt: input.discardedAt ?? null,
    cancelledAt: input.cancelledAt ?? null,
    cleanedAt: null,
    lastActivityAt: NOW,
    promptMode: "native",
    metadataJson: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  const contents = input.messageContents ?? [];
  if (contents.length > 0) {
    const floorId = nanoid();
    const pageId = nanoid();
    await database.db.insert(floors).values({
      id: floorId,
      sessionId: conversationId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 0,
      pageKind: "mixed",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await database.db.insert(messages).values(contents.map((content, index) => ({
      id: nanoid(),
      pageId,
      seq: index,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content,
      contentFormat: "text" as const,
      tokenCount: content.length,
      isHidden: false,
      source: "temporary_conversation",
      createdAt: NOW,
    })));
  }

  return conversationId;
}

async function statusOf(database: DatabaseConnection, conversationId: string): Promise<string | undefined> {
  const rows = await database.db
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, conversationId));
  return rows[0]?.status;
}

async function cleanedAtOf(database: DatabaseConnection, conversationId: string): Promise<number | null> {
  const rows = await database.db
    .select({ cleanedAt: sessions.cleanedAt })
    .from(sessions)
    .where(eq(sessions.id, conversationId));
  return rows[0]?.cleanedAt ?? null;
}

async function messageCountOf(database: DatabaseConnection, conversationId: string): Promise<number> {
  const floorRows = await database.db
    .select({ id: floors.id })
    .from(floors)
    .where(eq(floors.sessionId, conversationId));
  if (floorRows.length === 0) {
    return 0;
  }
  const pageRows = await database.db
    .select({ id: messagePages.id })
    .from(messagePages)
    .where(inArray(messagePages.floorId, floorRows.map((row) => row.id)));
  if (pageRows.length === 0) {
    return 0;
  }
  const messageRows = await database.db
    .select({ id: messages.id })
    .from(messages)
    .where(inArray(messages.pageId, pageRows.map((row) => row.id)));
  return messageRows.length;
}
