import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../../db/client.js";
import {
  accounts,
  floorRunStates,
  floors,
  memoryItems,
  messagePages,
  pageStagedMemoryProposalBatches,
  pageStagedMemoryProposalItems,
  pageStagedWrites,
  sessions,
} from "../../../db/schema.js";
import type { TurnProposalEnvelope } from "../turn-proposal-envelope.js";
import { TurnProposalStagingService } from "../turn-proposal-staging-service.js";

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
    title: "Turn Proposal Staging Test",
    accountId: ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedFloor(database: DatabaseConnection, input: {
  sessionId: string;
  floorId: string;
  now: number;
}): Promise<void> {
  await database.db.insert(floors).values({
    id: input.floorId,
    sessionId: input.sessionId,
    floorNo: 3,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function seedOutputPage(database: DatabaseConnection, input: {
  floorId: string;
  pageId: string;
  now: number;
  isActive?: boolean;
}): Promise<void> {
  await database.db.insert(messagePages).values({
    id: input.pageId,
    floorId: input.floorId,
    pageNo: 1,
    pageKind: "output",
    isActive: input.isActive ?? true,
    version: 1,
    checksum: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function seedRunState(database: DatabaseConnection, input: {
  floorId: string;
  runId: string;
  runType?: "respond" | "retry_turn" | "regenerate_page" | "edit_and_regenerate";
  attemptNo: number;
  status?: "running" | "completed" | "failed" | "cancelled";
  now: number;
}): Promise<void> {
  await database.db.insert(floorRunStates).values({
    floorId: input.floorId,
    runId: input.runId,
    runType: input.runType ?? "respond",
    status: input.status ?? "running",
    phase: "candidate_generated",
    publicPhase: "verifying",
    phaseSeq: 1,
    attemptNo: input.attemptNo,
    pendingOutputJson: null,
    verifierJson: null,
    errorJson: null,
    startedAt: input.now,
    updatedAt: input.now,
    completedAt: null,
  });
}

function buildEnvelope(input: {
  sessionId: string;
  floorId: string;
  pageId: string;
  runId?: string;
  attemptNo?: number;
}): TurnProposalEnvelope {
  return {
    attempt: {
      sessionId: input.sessionId,
      branchId: "main",
      floorId: input.floorId,
      runId: input.runId ?? "run-1",
      runType: "respond",
      attemptNo: input.attemptNo ?? 1,
      replayMode: "full_floor_context",
      candidateOutputPageId: input.pageId,
      candidateAssistantMessageId: "assistant-message-1",
    },
    outputPageId: input.pageId,
    findings: {
      continuity: [],
      agency: [],
      style: [],
    },
    stateProposals: [
      {
        id: "state-1",
        sourceAgentId: "inline:state_proposal",
        targetNamespace: "scene",
        targetSlot: "weather",
        payload: { raw: "rain" },
        promotion: "observe_only",
      },
    ],
    memoryProposals: [
      {
        id: "memory-1",
        sourceAgentId: "inline:memory_proposal",
        kind: "summary",
        summary: "Remember the rain.",
        promotion: "stage_for_review",
      },
    ],
    relationshipProposals: [],
    openLoopProposals: [],
  };
}

describe("TurnProposalStagingService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("stages observe-only state proposals and review-only memory proposals on the accepted output page", async () => {
    const now = 1_736_600_000_000;
    const sessionId = "session-stage-1";
    const floorId = "floor-stage-1";
    const pageId = "page-stage-1";
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, { sessionId, floorId, now });
    await seedOutputPage(database, { floorId, pageId, now });
    await seedRunState(database, { floorId, runId: "run-1", attemptNo: 1, now });

    const summary = new TurnProposalStagingService(database.db).stageCommittedProposals({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      outputPageId: pageId,
      assistantMessageId: "assistant-message-1",
      committedAt,
      proposalEnvelope: buildEnvelope({ sessionId, floorId, pageId }),
      commitGateDecision: {
        status: "allow",
        policy: "warn_only",
        reasons: [],
      },
    });

    expect(summary).toMatchObject({
      status: "staged",
      pageWriteAcceptedCount: 1,
      pageWriteDiscardedCount: 0,
      stateObservedCount: 1,
      stateDiscardedCount: 0,
      sessionStateStagedCount: 0,
      memoryBatchCount: 1,
      memoryProposedCount: 1,
      memoryRejectedCount: 0,
      memorySupersededCount: 0,
    });

    const [pageWrite] = await database.db.select().from(pageStagedWrites);
    expect(pageWrite).toMatchObject({
      pageId,
      status: "accepted",
      reason: "agent:state_proposal",
      sourceKind: "agent",
      sourceSessionId: sessionId,
      sourcePageId: pageId,
      discardedAt: null,
    });
    expect(JSON.parse(pageWrite!.metadataJson)).toMatchObject({
      category: "state",
      sourceAgentId: "inline:state_proposal",
      targetNamespace: "scene",
      targetSlot: "weather",
      stageStatus: "staged",
      decisionCode: null,
      decisionReason: null,
    });

    const [batchRow] = await database.db.select().from(pageStagedMemoryProposalBatches);
    expect(batchRow).toMatchObject({
      proposalBatchId: `agent-proposal:${pageId}`,
      pageId,
      floorId,
      sessionId,
      branchId: "main",
      sourceKind: "agent",
      proposalStatus: "proposed",
      promotionStatus: null,
      decisionReason: null,
      decisionCode: null,
      createdAt: committedAt,
      updatedAt: committedAt,
      decidedAt: null,
    });

    const itemRows = await database.db.select().from(pageStagedMemoryProposalItems);
    expect(itemRows).toHaveLength(1);
    expect(itemRows[0]).toMatchObject({
      batchId: `agent-proposal:${pageId}`,
      memoryKind: "summary",
      operationKind: "refresh_summary",
      targetScope: "branch",
      status: "proposed",
    });

    expect(await database.db.select().from(memoryItems)).toEqual([]);
  });

  it("records blocked proposal staging without promoting review proposals into durable truth", async () => {
    const now = 1_736_600_005_000;
    const sessionId = "session-stage-blocked";
    const floorId = "floor-stage-blocked";
    const pageId = "page-stage-blocked";
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, { sessionId, floorId, now });
    await seedOutputPage(database, { floorId, pageId, now });
    await seedRunState(database, { floorId, runId: "run-1", attemptNo: 1, now });

    const summary = new TurnProposalStagingService(database.db).stageCommittedProposals({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      outputPageId: pageId,
      assistantMessageId: "assistant-message-1",
      committedAt,
      proposalEnvelope: buildEnvelope({ sessionId, floorId, pageId }),
      commitGateDecision: {
        status: "block",
        policy: "block_on_error",
        reasons: [{ code: "block", severity: "error", summary: "blocked" }],
      },
    });

    expect(summary).toMatchObject({
      status: "blocked",
      reason: "commit_gate_blocked",
      decisionCode: "commit_gate_blocked",
      pageWriteAcceptedCount: 0,
      pageWriteDiscardedCount: 1,
      memoryBatchCount: 1,
      memoryProposedCount: 0,
      memoryRejectedCount: 1,
      memorySupersededCount: 0,
    });

    const [pageWrite] = await database.db.select().from(pageStagedWrites);
    expect(pageWrite).toMatchObject({
      pageId,
      status: "discarded",
      discardedAt: committedAt,
    });

    const [batchRow] = await database.db.select().from(pageStagedMemoryProposalBatches);
    expect(batchRow).toMatchObject({
      proposalStatus: "rejected",
      promotionStatus: "rejected",
      decisionReason: "commit_gate_blocked",
      decisionCode: "policy_forbidden",
      decidedAt: committedAt,
    });
    expect(await database.db.select().from(memoryItems)).toEqual([]);
  });

  it("marks proposals as discarded or superseded when the accepted candidate page is no longer active", async () => {
    const now = 1_736_600_010_000;
    const sessionId = "session-stage-2";
    const floorId = "floor-stage-2";
    const pageId = "page-stage-2";
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, { sessionId, floorId, now });
    await seedOutputPage(database, { floorId, pageId, now, isActive: false });
    await seedRunState(database, { floorId, runId: "run-1", attemptNo: 1, now });

    const summary = new TurnProposalStagingService(database.db).stageCommittedProposals({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      outputPageId: pageId,
      assistantMessageId: "assistant-message-1",
      committedAt,
      proposalEnvelope: buildEnvelope({ sessionId, floorId, pageId }),
      commitGateDecision: {
        status: "warn",
        policy: "warn_only",
        reasons: [{ code: "warn", severity: "warn", summary: "warn" }],
      },
    });

    expect(summary).toMatchObject({
      status: "stale",
      reason: "page_not_active_at_commit",
      decisionCode: "source_page_not_active",
      pageWriteAcceptedCount: 0,
      pageWriteDiscardedCount: 1,
      stateObservedCount: 1,
      stateDiscardedCount: 1,
      memoryBatchCount: 1,
      memoryProposedCount: 0,
      memoryRejectedCount: 0,
      memorySupersededCount: 1,
    });

    const [pageWrite] = await database.db.select().from(pageStagedWrites);
    expect(pageWrite).toMatchObject({
      pageId,
      status: "discarded",
      discardedAt: committedAt,
    });

    const [batchRow] = await database.db.select().from(pageStagedMemoryProposalBatches);
    expect(batchRow).toMatchObject({
      proposalBatchId: `agent-proposal:${pageId}`,
      proposalStatus: "superseded",
      promotionStatus: "superseded",
      decisionReason: "page_not_active_at_commit",
      decisionCode: "source_page_not_active",
      decidedAt: committedAt,
    });
    expect(await database.db.select().from(memoryItems)).toEqual([]);
  });

  it("returns stale without staging when the attempt is no longer current", async () => {
    const now = 1_736_600_020_000;
    const sessionId = "session-stage-3";
    const floorId = "floor-stage-3";
    const pageId = "page-stage-3";
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, { sessionId, floorId, now });
    await seedOutputPage(database, { floorId, pageId, now });
    await seedRunState(database, { floorId, runId: "run-1", attemptNo: 2, now });

    const summary = new TurnProposalStagingService(database.db).stageCommittedProposals({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      outputPageId: pageId,
      assistantMessageId: "assistant-message-1",
      committedAt,
      proposalEnvelope: buildEnvelope({ sessionId, floorId, pageId, runId: "run-1", attemptNo: 1 }),
      commitGateDecision: {
        status: "allow",
        policy: "warn_only",
        reasons: [],
      },
    });

    expect(summary).toMatchObject({
      status: "stale",
      reason: "attempt_not_current",
      decisionCode: "attempt_not_current",
      pageWriteAcceptedCount: 0,
      pageWriteDiscardedCount: 0,
      stateObservedCount: 1,
      stateDiscardedCount: 0,
      memoryBatchCount: 0,
      memoryProposedCount: 0,
      memoryRejectedCount: 0,
      memorySupersededCount: 0,
    });

    expect(await database.db.select().from(pageStagedWrites)).toEqual([]);
    expect(await database.db.select().from(pageStagedMemoryProposalBatches)).toEqual([]);
    expect(await database.db.select().from(pageStagedMemoryProposalItems)).toEqual([]);
  });
});
