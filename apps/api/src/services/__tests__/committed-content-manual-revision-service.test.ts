import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  committedContentManualRevisions,
  floors,
  messagePages,
  messages,
  operationLogs,
  sessions,
} from "../../db/schema.js";
import {
  CommittedContentManualRevisionService,
  CommittedContentManualRevisionServiceError,
} from "../committed-content-manual-revision-service.js";

const NOW = 1_736_900_000_000;
const ACTOR = {
  actorType: "account" as const,
  actorId: DEFAULT_ADMIN_ACCOUNT_ID,
  actorAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
  actorClientId: null,
};

async function ensureDefaultAccount(database: DatabaseConnection): Promise<void> {
  const existing = await database.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, DEFAULT_ADMIN_ACCOUNT_ID))
    .limit(1);

  if (existing.length > 0) {
    return;
  }

  await database.db.insert(accounts).values({
    id: DEFAULT_ADMIN_ACCOUNT_ID,
    name: "Admin",
    role: "admin",
    status: "active",
    isDefault: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function seedMessageFixture(
  database: DatabaseConnection,
  input: {
    branchId?: string;
    content?: string;
    floorId?: string;
    floorNo?: number;
    floorState?: typeof floors.$inferInsert.state;
    isHidden?: boolean;
    messageId?: string;
    pageId?: string;
    role?: typeof messages.$inferInsert.role;
    sessionId?: string;
    supersededAt?: number | null;
  } = {},
): Promise<{ floorId: string; messageId: string; pageId: string; sessionId: string }> {
  const sessionId = input.sessionId ?? `session:${Math.random().toString(36).slice(2)}`;
  const floorId = input.floorId ?? `floor:${Math.random().toString(36).slice(2)}`;
  const pageId = input.pageId ?? `page:${Math.random().toString(36).slice(2)}`;
  const messageId = input.messageId ?? `message:${Math.random().toString(36).slice(2)}`;
  const branchId = input.branchId ?? "main";

  await database.db.insert(sessions).values({
    id: sessionId,
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    title: "Manual revision test",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await database.db.insert(floors).values({
    id: floorId,
    sessionId,
    floorNo: input.floorNo ?? 1,
    branchId,
    parentFloorId: null,
    supersededAt: input.supersededAt ?? null,
    supersededByFloorId: null,
    state: input.floorState ?? "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await database.db.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: 1,
    pageKind: "output",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await database.db.insert(messages).values({
    id: messageId,
    pageId,
    seq: 0,
    role: input.role ?? "assistant",
    content: input.content ?? "Initial content",
    contentFormat: "text",
    tokenCount: 3,
    isHidden: input.isHidden ?? false,
    source: "api",
    createdAt: NOW,
  });

  return { floorId, messageId, pageId, sessionId };
}

function captureServiceError(fn: () => unknown): CommittedContentManualRevisionServiceError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CommittedContentManualRevisionServiceError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected CommittedContentManualRevisionServiceError");
}

describe("CommittedContentManualRevisionService", () => {
  let database: DatabaseConnection;
  let service: CommittedContentManualRevisionService;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    await ensureDefaultAccount(database);
    service = new CommittedContentManualRevisionService(database.db, {
      now: () => NOW + 500,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("applies message manual revisions, updates current content, and preserves original content across revisions", async () => {
    const fixture = await seedMessageFixture(database, {
      content: "Original assistant reply",
      messageId: "message:apply",
      pageId: "page:apply",
      floorId: "floor:apply",
      sessionId: "session:apply",
    });

    const first = service.applyManualRevision({
      actor: ACTOR,
      content: "First manual revision",
      expectedLatestRevisionNo: 0,
      reason: "fix wording",
      requestId: "req-1",
      targetId: fixture.messageId,
      targetKind: "message",
    });

    expect(first.latestRevisionNo).toBe(1);
    expect(first.currentContent).toBe("First manual revision");
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      requestedTargetKind: "message",
      requestedTargetId: fixture.messageId,
      originalContent: "Original assistant reply",
      previousContent: "Original assistant reply",
      editedContent: "First manual revision",
      reason: "fix wording",
    });

    const persistedMessage = await database.db
      .select()
      .from(messages)
      .where(eq(messages.id, fixture.messageId))
      .limit(1);
    expect(persistedMessage[0]?.content).toBe("First manual revision");
    expect(persistedMessage[0]?.tokenCount).toBeGreaterThan(0);

    const persistedPage = await database.db
      .select()
      .from(messagePages)
      .where(eq(messagePages.id, fixture.pageId))
      .limit(1);
    expect(persistedPage[0]?.updatedAt).toBe(NOW + 500);

    const firstOperationLog = await database.db
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.id, first.items[0]!.operationLogId))
      .limit(1);
    expect(firstOperationLog[0]).toMatchObject({
      action: "message.manual_revision.apply",
      targetType: "message_manual_revision",
      sessionId: fixture.sessionId,
      floorId: fixture.floorId,
    });

    const second = service.applyManualRevision({
      actor: ACTOR,
      content: "Second manual revision",
      expectedLatestRevisionNo: 1,
      reason: "tighten narration",
      requestId: "req-2",
      targetId: fixture.messageId,
      targetKind: "message",
    });

    expect(second.latestRevisionNo).toBe(2);
    expect(second.currentContent).toBe("Second manual revision");
    expect(second.items).toHaveLength(2);
    expect(second.items[1]).toMatchObject({
      originalContent: "Original assistant reply",
      previousContent: "First manual revision",
      editedContent: "Second manual revision",
    });

    const persistedRows = await database.db
      .select()
      .from(committedContentManualRevisions)
      .where(eq(committedContentManualRevisions.messageId, fixture.messageId));
    expect(persistedRows).toHaveLength(2);
  });

  it("rejects hidden, system, non-committed, and superseded targets", async () => {
    const cases = [
      {
        id: "hidden",
        input: { isHidden: true },
        expectedReason: "message_hidden",
      },
      {
        id: "system",
        input: { role: "system" as const },
        expectedReason: "message_role_not_supported",
      },
      {
        id: "draft",
        input: { floorState: "draft" as const },
        expectedReason: "floor_not_committed",
      },
      {
        id: "superseded",
        input: { supersededAt: NOW + 1 },
        expectedReason: "floor_superseded",
      },
    ] as const;

    for (const testCase of cases) {
      const fixture = await seedMessageFixture(database, {
        ...testCase.input,
        messageId: `message:${testCase.id}`,
        pageId: `page:${testCase.id}`,
        floorId: `floor:${testCase.id}`,
        sessionId: `session:${testCase.id}`,
      });

      const error = captureServiceError(() => service.applyManualRevision({
        actor: ACTOR,
        content: "Should fail",
        expectedLatestRevisionNo: 0,
        targetId: fixture.messageId,
        targetKind: "message",
      }));

      expect(error.code).toBe("manual_revision_invalid_state");
      expect(error.details).toMatchObject({ reason: testCase.expectedReason, message_id: fixture.messageId });
    }
  });

  it("rejects page targets that do not resolve to exactly one editable message", async () => {
    const fixture = await seedMessageFixture(database, {
      messageId: "message:page-shape:1",
      pageId: "page:shape",
      floorId: "floor:shape",
      sessionId: "session:shape",
    });

    await database.db.insert(messages).values({
      id: "message:page-shape:2",
      pageId: fixture.pageId,
      seq: 1,
      role: "assistant",
      content: "Another message on the same page",
      contentFormat: "text",
      tokenCount: 4,
      isHidden: false,
      source: "api",
      createdAt: NOW + 1,
    });

    const error = captureServiceError(() => service.getPageTimeline(fixture.pageId));
    expect(error.code).toBe("manual_revision_shape_not_supported");
    expect(error.details).toMatchObject({ page_id: fixture.pageId, message_count: 2 });
  });

  it("rejects stale expected_latest_revision_no with conflict details", async () => {
    const fixture = await seedMessageFixture(database, {
      messageId: "message:conflict",
      pageId: "page:conflict",
      floorId: "floor:conflict",
      sessionId: "session:conflict",
    });

    service.applyManualRevision({
      actor: ACTOR,
      content: "First committed revision",
      expectedLatestRevisionNo: 0,
      targetId: fixture.messageId,
      targetKind: "message",
    });

    const error = captureServiceError(() => service.applyManualRevision({
      actor: ACTOR,
      content: "Stale write",
      expectedLatestRevisionNo: 0,
      targetId: fixture.messageId,
      targetKind: "message",
    }));

    expect(error.code).toBe("manual_revision_conflict");
    expect(error.details).toMatchObject({
      current_latest_revision_no: 1,
      expected_latest_revision_no: 0,
      message_id: fixture.messageId,
    });
  });
});
