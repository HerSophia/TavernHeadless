import { describe, expect, it } from "vitest";
import { buildBranchMemoryScopeId } from "@tavern/shared";

import { buildMemoryRuntimeJobEventAugment } from "../../memory/observe/memory-runtime-event-bridge.js";

describe("buildMemoryRuntimeJobEventAugment", () => {
  it("projects branch, runtime mode, and proposal status from page-aware memory jobs", () => {
    const augment = buildMemoryRuntimeJobEventAugment({
      id: "memory-job:ingest_turn:page-output-1",
      jobType: "memory.ingest_turn",
      accountId: "default-admin",
      scopeType: "memory",
      scopeKey: `branch:${buildBranchMemoryScopeId("session-1", "main")}`,
      sessionId: "session-1",
      floorId: "floor-1",
      pageId: "page-output-1",
      status: "succeeded",
      phase: null,
      payloadJson: JSON.stringify({ pageId: "page-output-1", runtimeMode: "async_primary", strategy: "dual_summary" }),
      stateJson: null,
      resultJson: JSON.stringify({
        proposalBatchId: "memory-proposal:page-output-1",
        floorId: "floor-1",
        pageId: "page-output-1",
        branchId: "main",
        assistantMessageId: "assistant-message-1",
        userInputDigest: "digest",
        runtimeMode: "async_primary",
        status: "promoted",
        mutations: [],
      }),
      attemptCount: 1,
      maxAttempts: 5,
      availableAt: 1,
      startedAt: 2,
      finishedAt: 3,
      leaseOwner: null,
      leaseUntil: null,
      basedOnRevision: 0,
      dedupeKey: null,
      progressCurrent: 0,
      progressTotal: null,
      progressMessage: null,
      lastError: null,
      lastErrorCode: null,
      lastErrorClass: null,
      workspaceId: null,
      projectId: null,
      actorClientId: null,
      sourceEventId: null,
      agentTypeId: null,
      agentBindingId: null,

      createdAt: 1,
      updatedAt: 3,
    });

    expect(augment).toMatchObject({
      branchId: "main",
      runtimeMode: "async_primary",
      strategy: "dual_summary",
      proposalBatchId: "memory-proposal:page-output-1",
      proposalStatus: "promoted",
      promotionStatus: "promoted",
    });
  });
});
