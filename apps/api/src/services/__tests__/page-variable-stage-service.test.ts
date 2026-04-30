import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import type { BufferedToolVariableMutation } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, messagePages, sessions } from "../../db/schema.js";
import { PageVariableStageService } from "../variables/stage/page-variable-stage-service.js";

const ACCOUNT_ID = "default-admin";

async function seedAccount(database: DatabaseConnection, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: ACCOUNT_ID,
    name: "Default Admin",
    createdAt: now,
    updatedAt: now,
  })
    .onConflictDoNothing()
    .run();
}

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Stage Test",
    accountId: ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedFloor(database: DatabaseConnection, sessionId: string, floorId: string, now: number): Promise<void> {
  await database.db.insert(floors).values({
    id: floorId,
    sessionId,
    floorNo: 0,
    branchId: "main",
    parentFloorId: null,
    state: "generating",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedInputPage(database: DatabaseConnection, floorId: string, pageId: string, now: number): Promise<void> {
  await database.db.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: 0,
    pageKind: "input",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("PageVariableStageService", () => {
  let database: DatabaseConnection;
  let service: PageVariableStageService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new PageVariableStageService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("persists buffered writes into the page staged ledger with intent, reason, source, and evidence", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_700_100_000;
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedInputPage(database, floorId, pageId, now);

    const writes: BufferedToolVariableMutation[] = [
      {
        runId: "run-1",
        generationAttemptNo: 1,
        scope: "page",
        scopeId: pageId,
        key: "mood",
        value: "steady",
        intent: "page_only",
        reason: "builtin:set_variable",
        source: { toolName: "set_variable", providerId: "builtin", nodeId: "node-1" },
        bufferedAt: now + 10,
      },
      {
        runId: "run-1",
        generationAttemptNo: 1,
        scope: "page",
        scopeId: pageId,
        key: "hp",
        value: 95,
        bufferedAt: now + 20,
      },
    ];

    const staged = service.stageBufferedWrites({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      mutations: writes,
      committedAt,
    });

    expect(staged).toEqual([
      expect.objectContaining({
        pageId,
        floorId,
        sessionId,
        branchId: "main",
        key: "mood",
        op: "set",
        value: "steady",
        intent: "page_only",
        conflictPolicy: "replace",
        reason: "builtin:set_variable",
        source: { toolName: "set_variable", providerId: "builtin", nodeId: "node-1" },
        evidence: expect.objectContaining({ runId: "run-1", generationAttemptNo: 1, scope: "page", scopeId: pageId }),
        status: "staged",
        resolvedAt: null,
      }),
      expect.objectContaining({
        pageId,
        floorId,
        sessionId,
        branchId: "main",
        key: "hp",
        op: "set",
        value: 95,
        intent: "promote_to_floor_on_accept",
        conflictPolicy: "replace",
        reason: "builtin:set_variable",
        source: {},
        evidence: expect.objectContaining({ runId: "run-1", generationAttemptNo: 1, scope: "page", scopeId: pageId }),
        status: "staged",
        resolvedAt: null,
      }),
    ]);

    expect(service.listByPageId(ACCOUNT_ID, pageId).map((item) => item.key)).toEqual(["mood", "hp"]);
  });

  it("updates staged write terminal statuses without changing the original ordering", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_700_110_000;
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedInputPage(database, floorId, pageId, now);

    const [first, second] = service.stageBufferedWrites({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      mutations: [
        {
          runId: "run-2",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "mood",
          value: "steady",
          bufferedAt: now + 10,
        },
        {
          runId: "run-2",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "topic",
          value: "campfire",
          bufferedAt: now + 20,
        },
      ],
      committedAt,
    });

    const updated = service.markResolvedWrites({
      updates: [
        { id: first!.id, status: "accepted_page_only" },
        { id: second!.id, status: "promoted", decisionReason: null },
      ],
      resolvedAt: committedAt + 50,
    });

    expect(updated.map((item) => [item.key, item.status, item.resolvedAt])).toEqual([
      ["mood", "accepted_page_only", committedAt + 50],
      ["topic", "promoted", committedAt + 50],
    ]);
  });
});
