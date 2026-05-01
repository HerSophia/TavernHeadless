import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../../db/client.js";
import { accounts, floors, memoryItems, messagePages, sessions } from "../../../db/schema.js";
import type { PendingCoreEvent } from "../../memory-transaction-mutations.js";
import { MemoryPromotionService } from "../../memory/proposals/memory-promotion-service.js";
import type { MemoryProposalBatchRecord } from "../../memory/proposals/memory-proposal-job-definitions.js";

const ACCOUNT_ID = "default-admin";

async function seedAccount(database: DatabaseConnection, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: ACCOUNT_ID,
    name: ACCOUNT_ID,
    createdAt: now,
    updatedAt: now,
  })
    .onConflictDoNothing()
    .run();
}

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Memory Promotion Test",
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
    floorNo: 3,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedOutputPage(database: DatabaseConnection, floorId: string, pageId: string, now: number, isActive = true): Promise<void> {
  await database.db.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: 1,
    pageKind: "output",
    isActive,
    version: 1,
    checksum: null,
    createdAt: now,
    updatedAt: now,
  });
}

function buildProposalBatch(input: { floorId: string; pageId: string; sessionId: string }): MemoryProposalBatchRecord {
  return {
    proposalBatchId: `memory-proposal:${input.pageId}`,
    floorId: input.floorId,
    pageId: input.pageId,
    branchId: "main",
    assistantMessageId: "assistant-message-1",
    userInputDigest: `digest:${input.sessionId}`,
    runtimeMode: "async_primary",
    status: "proposed",
    mutations: [
      {
        action: "refresh_summary",
        targetScope: "branch",
        payload: {
          content: "Alice confirms the archive trail remains active.",
          summaryTier: "micro",
        },
      },
    ],
  };
}

describe("MemoryPromotionService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("promotes ingest proposals only when the output page is the accepted active page", async () => {
    const now = 1_736_500_000_000;
    const sessionId = "session-1";
    const floorId = "floor-1";
    const pageId = "page-output-1";
    const pendingEvents: PendingCoreEvent[] = [];

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedOutputPage(database, floorId, pageId, now, true);

    const result = new MemoryPromotionService(database.db).promoteIngestProposal({
      proposalBatch: buildProposalBatch({ floorId, pageId, sessionId }),
      ingestOutput: {
        microSummary: "Alice confirms the archive trail remains active.",
        factsAdd: [],
        factsUpdate: [],
        factsDeprecate: [],
        openLoopsAdd: [],
        openLoopsResolve: [],
      },
      accountId: ACCOUNT_ID,
      sessionId,
      floorId,
      floorNo: 3,
      branchId: "main",
      defaultScope: "branch",
      defaultScopeId: "memscope:session-1:main",
      sourceJobId: `memory-job:ingest_turn:${pageId}`,
      timestamp: now + 100,
      pendingEvents,
    });

    expect(result.promotionStatus).toBe("promoted");
    expect(result.proposalBatch.status).toBe("promoted");
    expect(result.counts.created).toBe(1);
    const createdRows = await database.db.select().from(memoryItems).where(eq(memoryItems.sourceJobId, `memory-job:ingest_turn:${pageId}`));
    expect(createdRows).toHaveLength(1);
    expect(pendingEvents.map((event) => event.name)).toContain("memory.created");
  });

  it("marks proposals as superseded when the output page is no longer active", async () => {
    const now = 1_736_500_010_000;
    const sessionId = "session-2";
    const floorId = "floor-2";
    const pageId = "page-output-2";

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedOutputPage(database, floorId, pageId, now, false);

    const result = new MemoryPromotionService(database.db).promoteIngestProposal({
      proposalBatch: buildProposalBatch({ floorId, pageId, sessionId }),
      ingestOutput: {
        microSummary: "This should not be promoted.",
        factsAdd: [],
        factsUpdate: [],
        factsDeprecate: [],
        openLoopsAdd: [],
        openLoopsResolve: [],
      },
      accountId: ACCOUNT_ID,
      sessionId,
      floorId,
      floorNo: 3,
      branchId: "main",
      defaultScope: "branch",
      defaultScopeId: "memscope:session-2:main",
      sourceJobId: `memory-job:ingest_turn:${pageId}`,
      timestamp: now + 100,
      pendingEvents: [],
    });

    expect(result.promotionStatus).toBe("superseded");
    expect(result.proposalBatch.status).toBe("superseded");
    expect(result.counts).toEqual({ created: 0, updated: 0, deprecated: 0 });
    expect(await database.db.select().from(memoryItems)).toEqual([]);
  });
});
