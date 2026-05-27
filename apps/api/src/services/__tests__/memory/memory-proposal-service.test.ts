import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../../db/client.js";
import {
  accounts,
  floors,
  messagePages,
  pageStagedMemoryProposalBatches,
  pageStagedMemoryProposalItems,
  promptRuntimeExplainSnapshots,
  sessions,
} from "../../../db/schema.js";
import { MemoryProposalService } from "../../memory/proposals/memory-proposal-service.js";

const ACCOUNT_ID = "default-admin";

async function seedAccount(database: DatabaseConnection, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: ACCOUNT_ID,
    name: ACCOUNT_ID,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run();
}

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Memory Proposal Test",
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

async function seedOutputPage(database: DatabaseConnection, floorId: string, pageId: string, now: number): Promise<void> {
  await database.db.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: 1,
    pageKind: "output",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedExplainSnapshot(database: DatabaseConnection, sessionId: string, floorId: string, now: number): Promise<void> {
  await database.db.insert(promptRuntimeExplainSnapshots).values({
    id: `explain:${floorId}`,
    floorId,
    sessionId,
    targetBranchId: "main",
    sourceFloorId: null,
    historySourceBranchId: "main",
    historySourceMode: "existing_branch",
    snapshotVersion: 4,
    assetsJson: JSON.stringify({}),
    memoryJson: JSON.stringify({
      summaryInjected: true,
      strategy: "dual_summary",
      summaryTextHash: "sha256:memory-proposal-test",
      tokenStats: {
        budget: 500,
        used: 96,
        microSummary: 32,
        macroSummary: 0,
        directItems: 64,
      },
      scopeResolution: {
        mode: "branch_aware",
        requestedScopes: ["branch", "chat"],
        resolvedScopes: ["branch", "chat"],
        requestedBranchId: "main",
        resolvedBranchId: "main",
      },
    }),
    resolvedPolicyJson: JSON.stringify({}),
    sourceMapJson: JSON.stringify({ sourceMap: {}, governance: null, historyNormalization: null }),
    diagnosticsJson: JSON.stringify([]),
    trimReasonsJson: JSON.stringify([]),
    excludedSourcesJson: JSON.stringify([]),
    sectionStatsJson: JSON.stringify([]),
    createdAt: now,
  });
}

describe("MemoryProposalService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("creates a durable page-level proposal ledger when ingest batches are created", async () => {
    const now = 1_736_510_000_000;
    const sessionId = "session-memory-proposal";
    const floorId = "floor-memory-proposal";
    const pageId = "page-memory-proposal";

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedOutputPage(database, floorId, pageId, now);
    await seedExplainSnapshot(database, sessionId, floorId, now + 10);

    const proposalBatch = new MemoryProposalService(database.db).createIngestProposalBatch({
      payload: {
        accountId: ACCOUNT_ID,
        sessionId,
        floorId,
        floorNo: 3,
        assistantMessageId: "assistant-message-1",
        pageId,
        branchId: "main",
        userInputDigest: "digest:memory-proposal",
        committedAt: now + 20,
        summaries: [],
        enableConsolidation: true,
        runtimeMode: "async_primary",
      },
      ingestOutput: {
        microSummary: "Alice confirms the archive trail remains active.",
        factsAdd: [{ factKey: "trail.status", value: "active", importance: 0.7, scope: "branch" }],
        factsUpdate: [],
        factsDeprecate: [],
        openLoopsAdd: [{ content: "Find the second key.", importance: 0.5, scope: "branch" }],
        openLoopsResolve: [],
      },
      defaultScope: "branch",
      createdAt: now + 100,
      sourceJobId: `memory-job:ingest_turn:${pageId}`,
    });

    expect(proposalBatch).toMatchObject({
      proposalBatchId: `memory-proposal:${pageId}`,
      pageId,
      floorId,
      branchId: "main",
      runtimeMode: "async_primary",
      status: "proposed",
    });

    const [batchRow] = await database.db.select().from(pageStagedMemoryProposalBatches);
    expect(batchRow).toMatchObject({
      id: `memory-proposal:${pageId}`,
      proposalBatchId: `memory-proposal:${pageId}`,
      accountId: ACCOUNT_ID,
      pageId,
      floorId,
      sessionId,
      branchId: "main",
      runtimeMode: "async_primary",
      strategy: "dual_summary",
      sourceKind: "memory_runtime",
      proposalStatus: "proposed",
      promotionStatus: null,
      decisionReason: null,
      decisionCode: null,
      createdAt: now + 100,
      updatedAt: now + 100,
      decidedAt: null,
    });

    expect(JSON.parse(batchRow!.sourceJson)).toEqual({
      assistantMessageId: "assistant-message-1",
      userInputDigest: "digest:memory-proposal",
      sourceJobId: `memory-job:ingest_turn:${pageId}`,
    });
    expect(JSON.parse(batchRow!.evidenceJson)).toEqual({
      floorNo: 3,
      mutationCount: 3,
      summaryCount: 1,
    });

    const itemRows = await database.db.select().from(pageStagedMemoryProposalItems);
    expect(itemRows).toHaveLength(3);
    expect(itemRows.map((row) => [row.memoryKind, row.operationKind, row.targetScope, row.status])).toEqual([
      ["summary", "refresh_summary", "branch", "proposed"],
      ["fact", "add_fact", "branch", "proposed"],
      ["open_loop", "add_open_loop", "branch", "proposed"],
    ]);
  });
});
