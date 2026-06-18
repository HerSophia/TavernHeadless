import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { eq, inArray } from "drizzle-orm";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, messagePages, messages, promptRuntimeInjections, sessions } from "../../db/schema.js";
import { OperationLogService } from "../operation-log-service.js";
import { RuntimeMaintenanceService } from "../runtime-maintenance-service.js";

const NOW = 1_736_000_000_000;

describe("RuntimeMaintenanceService", () => {
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

  it("deletes expired prompt runtime injections and writes summary operation log", async () => {
    const sessionId = await insertSession(database);
    const expiredId = nanoid();
    const activeId = nanoid();

    await database.db.insert(promptRuntimeInjections).values([
      {
        id: expiredId,
        sessionId,
        branchId: null,
        sourceKind: "client_injection",
        title: "Expired",
        content: "Expired body",
        placement: "before_history",
        order: 100,
        enabled: true,
        modeScope: null,
        ttlMs: 100,
        createdBy: null,
        createdAt: NOW - 1_000,
        updatedAt: NOW - 1_000,
      },
      {
        id: activeId,
        sessionId,
        branchId: null,
        sourceKind: "client_injection",
        title: "Active",
        content: "Active body",
        placement: "before_history",
        order: 100,
        enabled: true,
        modeScope: null,
        ttlMs: null,
        createdBy: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const result = new RuntimeMaintenanceService(database.db).run({
      now: NOW,
      operationLog: {
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        actorType: "system",
        actorId: "test-maintenance",
      },
    });

    expect(result.promptRuntimeInjection.expiredDeleted).toBe(1);
    const rows = await database.db.select().from(promptRuntimeInjections);
    expect(rows.map((row) => row.id)).toEqual([activeId]);

    const logs = new OperationLogService(database.db).list({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      action: "prompt_injection.cleanup_expired",
    });
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0]?.metadata).toMatchObject({
      cleanup_kind: "expired",
      expired_deleted: 1,
      now: NOW,
    });
    expect(JSON.stringify(logs.rows[0]?.metadata)).not.toContain("Expired body");
  });

  it("cleans terminal temporary conversations and writes a redacted summary operation log", async () => {
    const conversationId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    await database.db.insert(sessions).values({
      id: conversationId,
      title: "Temp",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "finalized",
      kind: "temporary",
      purpose: "test",
      retentionPolicy: "delete_on_finalize",
      visibility: "internal",
      finalizedAt: NOW - 5_000,
      cleanedAt: null,
      lastActivityAt: NOW,
      promptMode: "native",
      metadataJson: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
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
    await database.db.insert(messages).values({
      id: nanoid(),
      pageId,
      seq: 0,
      role: "user",
      content: "temp secret body",
      contentFormat: "text",
      tokenCount: 4,
      isHidden: false,
      source: "temporary_conversation",
      createdAt: NOW,
    });

    const result = new RuntimeMaintenanceService(database.db).run({
      now: NOW,
      promptRuntimeInjection: { enabled: false },
      operationLog: {
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        actorType: "system",
        actorId: "test-maintenance",
      },
    });

    expect(result.temporaryConversation.cleaned).toBe(1);
    expect(result.temporaryConversation.deletedMessages).toBe(1);

    const remainingMessages = await database.db
      .select({ id: messages.id })
      .from(messages)
      .where(inArray(messages.pageId, [pageId]));
    expect(remainingMessages).toHaveLength(0);

    const [cleanedSession] = await database.db
      .select({ cleanedAt: sessions.cleanedAt })
      .from(sessions)
      .where(eq(sessions.id, conversationId));
    expect(cleanedSession?.cleanedAt).toBe(NOW);

    const logs = new OperationLogService(database.db).list({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      action: "temporary_conversation.cleanup",
    });
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0]?.metadata).toMatchObject({
      cleanup_kind: "retention",
      cleaned: 1,
      deleted_messages: 1,
    });
    expect(JSON.stringify(logs.rows[0]?.metadata)).not.toContain("temp secret body");
  });
});

async function insertSession(database: DatabaseConnection): Promise<string> {
  const sessionId = nanoid();
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Runtime maintenance session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    characterId: null,
    characterSnapshotJson: null,
    characterSyncPolicy: "manual",
    characterVersionId: null,
    projectId: null,
    workspaceId: null,
    presetId: null,
    worldbookProfileId: null,
    regexProfileId: null,
    deepBinding: false,
    presetVersionId: null,
    worldbookVersionId: null,
    regexProfileVersionId: null,
    userId: null,
    userSnapshotJson: null,
    modelProvider: null,
    modelName: null,
    modelParamsJson: null,
    promptMode: null,
    metadataJson: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  await database.db.insert(floors).values({
    id: nanoid(),
    sessionId,
    floorNo: 0,
    branchId: "main",
    parentFloorId: null,
    supersededAt: null,
    supersededByFloorId: null,
    state: "committed",
    metadataJson: null,
    tokenIn: 0,
    tokenOut: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });

  return sessionId;
}
