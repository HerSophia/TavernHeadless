import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type BuildAppResult } from "../../app.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import {
  floors,
  messagePages,
  pageStagedMemoryProposalBatches,
  pageStagedMemoryProposalItems,
  promptRuntimeExplainSnapshots,
  sessions,
} from "../../db/schema.js";

async function buildPagesApp(): Promise<BuildAppResult> {
  const built = await buildApp({
    databasePath: ":memory:",
    auth: { mode: "off" },
    accountMode: "single",
  });
  await built.app.ready();
  return built;
}

describe("page memory inspection routes", () => {
  const builtApps: BuildAppResult[] = [];

  afterEach(async () => {
    while (builtApps.length > 0) {
      const built = builtApps.pop();
      if (built) {
        await built.app.close();
      }
    }
  });

  it("lists page memory proposals and filters decided entries for the promotions route", async () => {
    const built = await buildPagesApp();
    builtApps.push(built);

    const now = 1_736_520_000_000;
    const sessionId = "session-pages-memory";
    const floorId = "floor-pages-memory";
    const pageId = "page-pages-memory";
    const decidedBatchId = `memory-proposal:${pageId}`;
    const pendingBatchId = `memory-proposal:${pageId}:pending`;

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Page memory inspection",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await built.database.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 4,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
    await built.database.insert(messagePages).values({
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
    await built.database.insert(promptRuntimeExplainSnapshots).values({
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
        summaryTextHash: "sha256:pages-memory-route",
        tokenStats: {
          budget: 500,
          used: 144,
          microSummary: 48,
          macroSummary: 0,
          directItems: 96,
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
    await built.database.insert(pageStagedMemoryProposalBatches).values([
      {
        id: decidedBatchId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        proposalBatchId: decidedBatchId,
        pageId,
        floorId,
        branchId: "main",
        sessionId,
        runtimeMode: "async_primary",
        strategy: "dual_summary",
        sourceKind: "memory_runtime",
        actorClientId: null,
        sourceJson: JSON.stringify({ assistantMessageId: "assistant-1" }),
        evidenceJson: JSON.stringify({ floorNo: 4 }),
        proposalStatus: "promoted",
        promotionStatus: "promoted",
        decisionReason: null,
        decisionCode: "promotion_allowed",
        createdAt: now + 10,
        updatedAt: now + 20,
        decidedAt: now + 20,
      },
      {
        id: pendingBatchId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        proposalBatchId: pendingBatchId,
        pageId,
        floorId,
        branchId: "main",
        sessionId,
        runtimeMode: "async_primary",
        strategy: "dual_summary",
        sourceKind: "memory_runtime",
        actorClientId: null,
        sourceJson: JSON.stringify({ assistantMessageId: "assistant-2" }),
        evidenceJson: JSON.stringify({ floorNo: 4 }),
        proposalStatus: "proposed",
        promotionStatus: null,
        decisionReason: null,
        decisionCode: null,
        createdAt: now + 30,
        updatedAt: now + 30,
        decidedAt: null,
      },
    ]);
    await built.database.insert(pageStagedMemoryProposalItems).values([
      {
        id: `${decidedBatchId}:1`,
        batchId: decidedBatchId,
        memoryKind: "summary",
        operationKind: "refresh_summary",
        targetScope: "branch",
        payloadJson: JSON.stringify({ content: "A promoted summary." }),
        importance: null,
        reason: "memory_ingest_micro_summary",
        evidenceJson: JSON.stringify({}),
        status: "promoted",
        createdAt: now + 10,
        updatedAt: now + 20,
      },
      {
        id: `${pendingBatchId}:1`,
        batchId: pendingBatchId,
        memoryKind: "fact",
        operationKind: "add_fact",
        targetScope: "branch",
        payloadJson: JSON.stringify({ factKey: "trail.status", value: "active" }),
        importance: 0.7,
        reason: "memory_ingest_fact_add",
        evidenceJson: JSON.stringify({}),
        status: "proposed",
        createdAt: now + 30,
        updatedAt: now + 30,
      },
    ]);

    const proposalsResponse = await built.app.inject({
      method: "GET",
      url: `/pages/${encodeURIComponent(pageId)}/memory/proposals`,
    });
    expect(proposalsResponse.statusCode, proposalsResponse.body).toBe(200);
    expect(proposalsResponse.json()).toEqual({
      data: {
        page_id: pageId,
        floor_id: floorId,
        session_id: sessionId,
        branch_id: "main",
        items: [
          {
            id: decidedBatchId,
            proposal_batch_id: decidedBatchId,
            runtime_mode: "async_primary",
            strategy: "dual_summary",
            source_kind: "memory_runtime",
            actor_client_id: null,
            proposal_status: "promoted",
            promotion_status: "promoted",
            decision_reason: null,
            decision_code: "promotion_allowed",
            source_json: { assistantMessageId: "assistant-1" },
            evidence_json: { floorNo: 4 },
            summary_text_hash: "sha256:pages-memory-route",
            token_stats: {
              budget: 500,
              used: 144,
              micro_summary: 48,
              macro_summary: 0,
              direct_items: 96,
            },
            scope_resolution: {
              mode: "branch_aware",
              requested_scopes: ["branch", "chat"],
              resolved_scopes: ["branch", "chat"],
              requested_branch_id: "main",
              resolved_branch_id: "main",
              fallback_reason: null,
            },
            created_at: now + 10,
            updated_at: now + 20,
            decided_at: now + 20,
            items: [
              {
                id: `${decidedBatchId}:1`,
                memory_kind: "summary",
                operation_kind: "refresh_summary",
                target_scope: "branch",
                payload: { content: "A promoted summary." },
                importance: null,
                reason: "memory_ingest_micro_summary",
                evidence_json: {},
                status: "promoted",
                created_at: now + 10,
                updated_at: now + 20,
              },
            ],
          },
          {
            id: pendingBatchId,
            proposal_batch_id: pendingBatchId,
            runtime_mode: "async_primary",
            strategy: "dual_summary",
            source_kind: "memory_runtime",
            actor_client_id: null,
            proposal_status: "proposed",
            promotion_status: null,
            decision_reason: null,
            decision_code: null,
            source_json: { assistantMessageId: "assistant-2" },
            evidence_json: { floorNo: 4 },
            summary_text_hash: "sha256:pages-memory-route",
            token_stats: {
              budget: 500,
              used: 144,
              micro_summary: 48,
              macro_summary: 0,
              direct_items: 96,
            },
            scope_resolution: {
              mode: "branch_aware",
              requested_scopes: ["branch", "chat"],
              resolved_scopes: ["branch", "chat"],
              requested_branch_id: "main",
              resolved_branch_id: "main",
              fallback_reason: null,
            },
            created_at: now + 30,
            updated_at: now + 30,
            decided_at: null,
            items: [
              {
                id: `${pendingBatchId}:1`,
                memory_kind: "fact",
                operation_kind: "add_fact",
                target_scope: "branch",
                payload: { factKey: "trail.status", value: "active" },
                importance: 0.7,
                reason: "memory_ingest_fact_add",
                evidence_json: {},
                status: "proposed",
                created_at: now + 30,
                updated_at: now + 30,
              },
            ],
          },
        ],
      },
    });

    const promotionsResponse = await built.app.inject({
      method: "GET",
      url: `/pages/${encodeURIComponent(pageId)}/memory/promotions`,
    });
    expect(promotionsResponse.statusCode, promotionsResponse.body).toBe(200);
    expect(promotionsResponse.json()).toEqual({
      data: {
        page_id: pageId,
        floor_id: floorId,
        session_id: sessionId,
        branch_id: "main",
        items: [
          {
            id: decidedBatchId,
            proposal_batch_id: decidedBatchId,
            runtime_mode: "async_primary",
            strategy: "dual_summary",
            source_kind: "memory_runtime",
            actor_client_id: null,
            proposal_status: "promoted",
            promotion_status: "promoted",
            decision_reason: null,
            decision_code: "promotion_allowed",
            source_json: { assistantMessageId: "assistant-1" },
            evidence_json: { floorNo: 4 },
            summary_text_hash: "sha256:pages-memory-route",
            token_stats: {
              budget: 500,
              used: 144,
              micro_summary: 48,
              macro_summary: 0,
              direct_items: 96,
            },
            scope_resolution: {
              mode: "branch_aware",
              requested_scopes: ["branch", "chat"],
              resolved_scopes: ["branch", "chat"],
              requested_branch_id: "main",
              resolved_branch_id: "main",
              fallback_reason: null,
            },
            created_at: now + 10,
            updated_at: now + 20,
            decided_at: now + 20,
            items: [
              {
                id: `${decidedBatchId}:1`,
                memory_kind: "summary",
                operation_kind: "refresh_summary",
                target_scope: "branch",
                payload: { content: "A promoted summary." },
                importance: null,
                reason: "memory_ingest_micro_summary",
                evidence_json: {},
                status: "promoted",
                created_at: now + 10,
                updated_at: now + 20,
              },
            ],
          },
        ],
      },
    });
  });
});
