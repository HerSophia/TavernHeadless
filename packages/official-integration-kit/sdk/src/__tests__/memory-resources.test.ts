import { describe, expect, it, vi } from "vitest";

import { createTransportClient } from "../client/transport.js";
import { createMemoryEdgesResource } from "../resources/memory-edges.js";
import { createMemoryJobsResource } from "../resources/memory-jobs.js";
import { createMemoryScopesResource } from "../resources/memory-scopes.js";
import { createMemoriesResource } from "../resources/memories.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk memory resources", () => {
  it("creates, lists, reads stats and detail, updates, deletes, and batch mutates memories with memory v2 fields", async () => {
    const memoryPayload = {
      confidence: 0.9,
      content: { text: "Session micro summary" },
      coverage_end_floor_no: 1,
      coverage_start_floor_no: 1,
      created_at: 100,
      derived_from_count: 1,
      fact_key: null,
      id: "mem-1",
      importance: 0.8,
      last_used_at: 101,
      lifecycle_status: "active",
      scope: "chat",
      scope_id: "session-1",
      source_floor_id: "floor-1",
      source_job_id: "memory-job:ingest_turn:floor-1",
      source_message_id: "msg-1",
      status: "active",
      summary_tier: "micro",
      token_count_estimate: 64,
      type: "summary",
      updated_at: 101,
    };
    const updatedPayload = {
      ...memoryPayload,
      coverage_end_floor_no: 6,
      derived_from_count: 3,
      last_used_at: 202,
      lifecycle_status: "compacted",
      source_job_id: "memory-job:compact_macro:session-1:mem-3",
      summary_tier: "macro",
      token_count_estimate: 96,
      updated_at: 202,
    };
    const deprecatedPayload = {
      ...updatedPayload,
      lifecycle_status: "deprecated",
      status: "deprecated",
      updated_at: 303,
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: memoryPayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: [null, memoryPayload] }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            active: 1,
            avg_confidence: 0.9,
            avg_importance: 0.8,
            by_type: {
              fact: 0,
              open_loop: 0,
              summary: 1,
            },
            deprecated: 0,
            estimated_tokens: 64,
            total: 1,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: memoryPayload }))
      .mockResolvedValueOnce(jsonResponse({ data: updatedPayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "mem-1", deleted: true } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              not_found: 1,
              status: "deprecated",
              total: 2,
              updated: 1,
            },
            results: [
              {
                action: "updated",
                data: deprecatedPayload,
                id: "mem-1",
                index: 0,
              },
              {
                action: "not_found",
                id: "missing",
                index: 1,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              deleted: 1,
              not_found: 1,
              total: 2,
            },
            results: [
              { action: "deleted", id: "mem-1", index: 0 },
              { action: "not_found", id: "missing", index: 1 },
            ],
          },
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const memories = createMemoriesResource(transport);

    await expect(
      memories.create({
        confidence: 0.9,
        content: { text: "Session micro summary" },
        importance: 0.8,
        lifecycleStatus: "active",
        scope: "chat",
        scopeId: "session-1",
        sourceFloorId: "floor-1",
        sourceMessageId: "msg-1",
        status: "active",
        summaryTier: "micro",
        type: "summary",
      }),
    ).resolves.toEqual({
      confidence: 0.9,
      content: { text: "Session micro summary" },
      coverageEndFloorNo: 1,
      coverageStartFloorNo: 1,
      createdAt: 100,
      derivedFromCount: 1,
      factKey: null,
      id: "mem-1",
      importance: 0.8,
      lastUsedAt: 101,
      lifecycleStatus: "active",
      scope: "chat",
      scopeId: "session-1",
      sourceFloorId: "floor-1",
      sourceJobId: "memory-job:ingest_turn:floor-1",
      sourceMessageId: "msg-1",
      status: "active",
      summaryTier: "micro",
      tokenCountEstimate: 64,
      type: "summary",
      updatedAt: 101,
    });

    await expect(
      memories.list({
        confidenceMin: 0.5,
        createdFrom: 10,
        importanceMax: 0.9,
        lifecycleStatus: "active",
        limit: 10,
        offset: 1,
        q: "summary",
        scope: "chat",
        scopeId: "session-1",
        sortBy: "importance",
        sortOrder: "asc",
        sourceFloorId: "floor-1",
        sourceMessageId: "msg-1",
        status: "active",
        summaryTier: "micro",
        type: "summary",
        updatedTo: 999,
      }),
    ).resolves.toEqual([
      {
        confidence: 0.9,
        content: { text: "Session micro summary" },
        coverageEndFloorNo: 1,
        coverageStartFloorNo: 1,
        createdAt: 100,
        derivedFromCount: 1,
        factKey: null,
        id: "mem-1",
        importance: 0.8,
        lastUsedAt: 101,
        lifecycleStatus: "active",
        scope: "chat",
        scopeId: "session-1",
        sourceFloorId: "floor-1",
        sourceJobId: "memory-job:ingest_turn:floor-1",
        sourceMessageId: "msg-1",
        status: "active",
        summaryTier: "micro",
        tokenCountEstimate: 64,
        type: "summary",
        updatedAt: 101,
      },
    ]);

    await expect(
      memories.getStats({
        lifecycleStatus: "active",
        q: "summary",
        scope: "chat",
        status: "active",
        summaryTier: "micro",
      }),
    ).resolves.toEqual({
      active: 1,
      avgConfidence: 0.9,
      avgImportance: 0.8,
      byType: {
        fact: 0,
        openLoop: 0,
        summary: 1,
      },
      deprecated: 0,
      estimatedTokens: 64,
      total: 1,
    });

    await expect(memories.getDetail({ memoryId: "mem-1" })).resolves.toEqual({
      confidence: 0.9,
      content: { text: "Session micro summary" },
      coverageEndFloorNo: 1,
      coverageStartFloorNo: 1,
      createdAt: 100,
      derivedFromCount: 1,
      factKey: null,
      id: "mem-1",
      importance: 0.8,
      lastUsedAt: 101,
      lifecycleStatus: "active",
      scope: "chat",
      scopeId: "session-1",
      sourceFloorId: "floor-1",
      sourceJobId: "memory-job:ingest_turn:floor-1",
      sourceMessageId: "msg-1",
      status: "active",
      summaryTier: "micro",
      tokenCountEstimate: 64,
      type: "summary",
      updatedAt: 101,
    });

    await expect(
      memories.update({
        lifecycleStatus: "compacted",
        memoryId: "mem-1",
        summaryTier: "macro",
      }),
    ).resolves.toEqual({
      confidence: 0.9,
      content: { text: "Session micro summary" },
      coverageEndFloorNo: 6,
      coverageStartFloorNo: 1,
      createdAt: 100,
      derivedFromCount: 3,
      factKey: null,
      id: "mem-1",
      importance: 0.8,
      lastUsedAt: 202,
      lifecycleStatus: "compacted",
      scope: "chat",
      scopeId: "session-1",
      sourceFloorId: "floor-1",
      sourceJobId: "memory-job:compact_macro:session-1:mem-3",
      sourceMessageId: "msg-1",
      status: "active",
      summaryTier: "macro",
      tokenCountEstimate: 96,
      type: "summary",
      updatedAt: 202,
    });

    await expect(memories.remove({ memoryId: "mem-1" })).resolves.toBe(true);

    await expect(
      memories.batchUpdateStatus({
        ids: ["mem-1", "missing"],
        status: "deprecated",
      }),
    ).resolves.toEqual({
      meta: {
        notFound: 1,
        status: "deprecated",
        total: 2,
        updated: 1,
      },
      results: [
        {
          action: "updated",
          data: {
            confidence: 0.9,
            content: { text: "Session micro summary" },
            coverageEndFloorNo: 6,
            coverageStartFloorNo: 1,
            createdAt: 100,
            derivedFromCount: 3,
            factKey: null,
            id: "mem-1",
            importance: 0.8,
            lastUsedAt: 202,
            lifecycleStatus: "deprecated",
            scope: "chat",
            scopeId: "session-1",
            sourceFloorId: "floor-1",
            sourceJobId: "memory-job:compact_macro:session-1:mem-3",
            sourceMessageId: "msg-1",
            status: "deprecated",
            summaryTier: "macro",
            tokenCountEstimate: 96,
            type: "summary",
            updatedAt: 303,
          },
          id: "mem-1",
          index: 0,
        },
        {
          action: "not_found",
          data: undefined,
          id: "missing",
          index: 1,
        },
      ],
    });

    await expect(memories.batchDelete({ ids: ["mem-1", "missing"] })).resolves.toEqual({
      meta: {
        deleted: 1,
        notFound: 1,
        total: 2,
      },
      results: [
        { action: "deleted", id: "mem-1", index: 0 },
        { action: "not_found", id: "missing", index: 1 },
      ],
    });

    const [, createInit] = fetchImpl.mock.calls[0]!;
    const [listUrl] = fetchImpl.mock.calls[1]!;
    const [statsUrl] = fetchImpl.mock.calls[2]!;
    const [, updateInit] = fetchImpl.mock.calls[4]!;
    const [, batchStatusInit] = fetchImpl.mock.calls[6]!;
    const [, batchDeleteInit] = fetchImpl.mock.calls[7]!;

    expect(createInit?.body).toBe(JSON.stringify({
      confidence: 0.9,
      content: { text: "Session micro summary" },
      importance: 0.8,
      lifecycle_status: "active",
      scope: "chat",
      scope_id: "session-1",
      source_floor_id: "floor-1",
      source_message_id: "msg-1",
      status: "active",
      summary_tier: "micro",
      type: "summary",
    }));
    expect(updateInit?.body).toBe(JSON.stringify({
      lifecycle_status: "compacted",
      summary_tier: "macro",
    }));
    expect(batchStatusInit?.body).toBe(JSON.stringify({
      ids: ["mem-1", "missing"],
      status: "deprecated",
    }));
    expect(batchDeleteInit?.body).toBe(JSON.stringify({
      ids: ["mem-1", "missing"],
    }));

    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.pathname).toBe("/memories");
    expect(listRequestUrl.searchParams.get("confidence_min")).toBe("0.5");
    expect(listRequestUrl.searchParams.get("created_from")).toBe("10");
    expect(listRequestUrl.searchParams.get("importance_max")).toBe("0.9");
    expect(listRequestUrl.searchParams.get("lifecycle_status")).toBe("active");
    expect(listRequestUrl.searchParams.get("limit")).toBe("10");
    expect(listRequestUrl.searchParams.get("offset")).toBe("1");
    expect(listRequestUrl.searchParams.get("q")).toBe("summary");
    expect(listRequestUrl.searchParams.get("scope")).toBe("chat");
    expect(listRequestUrl.searchParams.get("scope_id")).toBe("session-1");
    expect(listRequestUrl.searchParams.get("sort_by")).toBe("importance");
    expect(listRequestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(listRequestUrl.searchParams.get("source_floor_id")).toBe("floor-1");
    expect(listRequestUrl.searchParams.get("source_message_id")).toBe("msg-1");
    expect(listRequestUrl.searchParams.get("status")).toBe("active");
    expect(listRequestUrl.searchParams.get("summary_tier")).toBe("micro");
    expect(listRequestUrl.searchParams.get("type")).toBe("summary");
    expect(listRequestUrl.searchParams.get("updated_to")).toBe("999");

    const statsRequestUrl = new URL(statsUrl as string);
    expect(statsRequestUrl.pathname).toBe("/memories/stats");
    expect(statsRequestUrl.searchParams.get("lifecycle_status")).toBe("active");
    expect(statsRequestUrl.searchParams.get("q")).toBe("summary");
    expect(statsRequestUrl.searchParams.get("scope")).toBe("chat");
    expect(statsRequestUrl.searchParams.get("status")).toBe("active");
    expect(statsRequestUrl.searchParams.get("summary_tier")).toBe("micro");
  });

  it("lists and mutates memory jobs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              attempt_count: 2,
              available_at: 200,
              based_on_revision: 4,
              created_at: 100,
              finished_at: null,
              floor_id: "floor-3",
              id: "job-compact",
              job_type: "compact_macro",
              last_error: null,
              lease_owner: null,
              lease_until: null,
              max_attempts: 5,
              payload: {
                accountId: "acc-1",
                committedAt: 200,
                coverageEndFloorNo: 3,
                coverageStartFloorNo: 1,
                force: true,
                scope: "chat",
                scopeId: "session-1",
                sessionId: "session-1",
                sourceMicroIds: ["mem-1", "mem-2", "mem-3"],
                triggerFloorId: "floor-3",
              },
              scope: "chat",
              scope_id: "session-1",
              status: "retry_waiting",
              updated_at: 150,
            },
            {
              attempt_count: 0,
              available_at: 300,
              based_on_revision: null,
              created_at: 250,
              finished_at: null,
              floor_id: null,
              id: "job-maintenance",
              job_type: "maintenance",
              last_error: null,
              lease_owner: null,
              lease_until: null,
              max_attempts: 3,
              payload: {
                accountId: "acc-1",
                batchSize: 50,
                dryRun: true,
                policy: {
                  deprecatedPurgeAgeMs: 3000,
                  openLoopMaxAgeMs: 2000,
                  summaryMaxAgeMs: 1000,
                },
                scheduleBucket: 42,
                scheduledAt: 300,
                scope: "chat",
                scopeId: "session-1",
              },
              scope: "chat",
              scope_id: "session-1",
              status: "pending",
              updated_at: 260,
            },
          ],
          meta: {
            has_more: false,
            limit: 20,
            offset: 0,
            sort_by: "updated_at",
            sort_order: "asc",
            total: 2,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            created: true,
            job_id: "job-compact",
            scope: "chat",
            scope_id: "session-1",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            created: true,
            job_id: "job-maintenance",
            scope: "chat",
            scope_id: "session-1",
          },
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const memoryJobs = createMemoryJobsResource(transport);

    await expect(
      memoryJobs.list({
        availableFrom: 150,
        availableTo: 400,
        createdFrom: 90,
        createdTo: 400,
        floorId: "floor-3",
        limit: 20,
        jobType: "compact_macro",
        offset: 0,
        scope: "chat",
        scopeId: "session-1",
        sortBy: "updated_at",
        sortOrder: "asc",
        status: "retry_waiting",
      }),
    ).resolves.toEqual({
      jobs: [
        {
          attemptCount: 2,
          availableAt: 200,
          basedOnRevision: 4,
          createdAt: 100,
          finishedAt: null,
          floorId: "floor-3",
          id: "job-compact",
          jobType: "compact_macro",
          lastError: null,
          leaseOwner: null,
          leaseUntil: null,
          maxAttempts: 5,
          payload: {
            accountId: "acc-1",
            committedAt: 200,
            coverageEndFloorNo: 3,
            coverageStartFloorNo: 1,
            force: true,
            scope: "chat",
            scopeId: "session-1",
            sessionId: "session-1",
            sourceMicroIds: ["mem-1", "mem-2", "mem-3"],
            triggerFloorId: "floor-3",
          },
          scope: "chat",
          scopeId: "session-1",
          status: "retry_waiting",
          updatedAt: 150,
        },
        {
          attemptCount: 0,
          availableAt: 300,
          basedOnRevision: null,
          createdAt: 250,
          finishedAt: null,
          floorId: null,
          id: "job-maintenance",
          jobType: "maintenance",
          lastError: null,
          leaseOwner: null,
          leaseUntil: null,
          maxAttempts: 3,
          payload: {
            accountId: "acc-1",
            batchSize: 50,
            dryRun: true,
            policy: {
              deprecatedPurgeAgeMs: 3000,
              openLoopMaxAgeMs: 2000,
              summaryMaxAgeMs: 1000,
            },
            scheduleBucket: 42,
            scheduledAt: 300,
            scope: "chat",
            scopeId: "session-1",
          },
          scope: "chat",
          scopeId: "session-1",
          status: "pending",
          updatedAt: 260,
        },
      ],
      meta: {
        hasMore: false,
        limit: 20,
        offset: 0,
        sortBy: "updated_at",
        sortOrder: "asc",
        total: 2,
      },
    });

    await expect(memoryJobs.retry({ jobId: "job-compact" })).resolves.toEqual({
      created: true,
      jobId: "job-compact",
      scope: "chat",
      scopeId: "session-1",
    });

    await expect(memoryJobs.cancel({ jobId: "job-maintenance" })).resolves.toEqual({
      created: true,
      jobId: "job-maintenance",
      scope: "chat",
      scopeId: "session-1",
    });

    const [listUrl] = fetchImpl.mock.calls[0]!;
    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.pathname).toBe("/memory/jobs");
    expect(listRequestUrl.searchParams.get("available_from")).toBe("150");
    expect(listRequestUrl.searchParams.get("available_to")).toBe("400");
    expect(listRequestUrl.searchParams.get("created_from")).toBe("90");
    expect(listRequestUrl.searchParams.get("created_to")).toBe("400");
    expect(listRequestUrl.searchParams.get("floor_id")).toBe("floor-3");
    expect(listRequestUrl.searchParams.get("job_type")).toBe("compact_macro");
    expect(listRequestUrl.searchParams.get("limit")).toBe("20");
    expect(listRequestUrl.searchParams.get("offset")).toBe("0");
    expect(listRequestUrl.searchParams.get("scope")).toBe("chat");
    expect(listRequestUrl.searchParams.get("scope_id")).toBe("session-1");
    expect(listRequestUrl.searchParams.get("sort_by")).toBe("updated_at");
    expect(listRequestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(listRequestUrl.searchParams.get("status")).toBe("retry_waiting");
  });

  it("lists memory scope states and enqueues rebuild and compact jobs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              last_compaction_at: 200,
              last_processed_floor_no: 8,
              lease_owner: null,
              lease_until: null,
              revision: 4,
              scope: "chat",
              scope_id: "session-1",
              updated_at: 220,
            },
          ],
          meta: {
            has_more: false,
            limit: 10,
            offset: 0,
            sort_by: "revision",
            sort_order: "desc",
            total: 1,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            created: true,
            job_id: "job-rebuild",
            scope: "chat",
            scope_id: "session-1",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            coverage_end_floor_no: 3,
            coverage_start_floor_no: 1,
            created: false,
            job_id: "job-compact",
            reason: "forced",
            scope: "chat",
            scope_id: "session-1",
            source_micro_ids: ["mem-1", "mem-2", "mem-3"],
          },
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const memoryScopes = createMemoryScopesResource(transport);

    await expect(
      memoryScopes.list({
        limit: 10,
        offset: 0,
        scope: "chat",
        scopeId: "session-1",
        sortBy: "revision",
        sortOrder: "desc",
      }),
    ).resolves.toEqual({
      meta: {
        hasMore: false,
        limit: 10,
        offset: 0,
        sortBy: "revision",
        sortOrder: "desc",
        total: 1,
      },
      scopes: [
        {
          lastCompactionAt: 200,
          lastProcessedFloorNo: 8,
          leaseOwner: null,
          leaseUntil: null,
          revision: 4,
          scope: "chat",
          scopeId: "session-1",
          updatedAt: 220,
        },
      ],
    });

    await expect(
      memoryScopes.rebuild({
        forceCompaction: true,
        scope: "chat",
        scopeId: "session-1",
        triggerFloorId: "floor-8",
      }),
    ).resolves.toEqual({
      created: true,
      jobId: "job-rebuild",
      scope: "chat",
      scopeId: "session-1",
    });

    await expect(
      memoryScopes.compact({
        force: true,
        scope: "chat",
        scopeId: "session-1",
        triggerFloorId: "floor-8",
      }),
    ).resolves.toEqual({
      coverageEndFloorNo: 3,
      coverageStartFloorNo: 1,
      created: false,
      jobId: "job-compact",
      reason: "forced",
      scope: "chat",
      scopeId: "session-1",
      sourceMicroIds: ["mem-1", "mem-2", "mem-3"],
    });

    const [listUrl] = fetchImpl.mock.calls[0]!;
    const [, rebuildInit] = fetchImpl.mock.calls[1]!;
    const [, compactInit] = fetchImpl.mock.calls[2]!;

    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.pathname).toBe("/memory/scopes");
    expect(listRequestUrl.searchParams.get("limit")).toBe("10");
    expect(listRequestUrl.searchParams.get("offset")).toBe("0");
    expect(listRequestUrl.searchParams.get("scope")).toBe("chat");
    expect(listRequestUrl.searchParams.get("scope_id")).toBe("session-1");
    expect(listRequestUrl.searchParams.get("sort_by")).toBe("revision");
    expect(listRequestUrl.searchParams.get("sort_order")).toBe("desc");

    expect(rebuildInit?.body).toBe(JSON.stringify({
      force_compaction: true,
      trigger_floor_id: "floor-8",
    }));
    expect(compactInit?.body).toBe(JSON.stringify({
      force: true,
      trigger_floor_id: "floor-8",
    }));
  });

  it("creates, lists, gets, updates, and removes memory edges with the extended relation set", async () => {
    const edgePayload = {
      created_at: 300,
      from_id: "mem-1",
      id: "edge-1",
      relation: "derived_from",
      to_id: "mem-2",
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: edgePayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: [null, edgePayload] }))
      .mockResolvedValueOnce(jsonResponse({ data: edgePayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...edgePayload, relation: "compacts" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "edge-1", deleted: true } }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const memoryEdges = createMemoryEdgesResource(transport);

    await expect(
      memoryEdges.create({
        fromId: "mem-1",
        relation: "derived_from",
        toId: "mem-2",
      }),
    ).resolves.toEqual({
      createdAt: 300,
      fromId: "mem-1",
      id: "edge-1",
      relation: "derived_from",
      toId: "mem-2",
    });

    await expect(
      memoryEdges.list({
        fromId: "mem-1",
        limit: 10,
        offset: 2,
        relation: "derived_from",
        sortBy: "created_at",
        sortOrder: "asc",
        toId: "mem-2",
      }),
    ).resolves.toEqual([
      {
        createdAt: 300,
        fromId: "mem-1",
        id: "edge-1",
        relation: "derived_from",
        toId: "mem-2",
      },
    ]);

    await expect(memoryEdges.getDetail({ edgeId: "edge-1" })).resolves.toEqual({
      createdAt: 300,
      fromId: "mem-1",
      id: "edge-1",
      relation: "derived_from",
      toId: "mem-2",
    });

    await expect(
      memoryEdges.update({
        edgeId: "edge-1",
        relation: "compacts",
      }),
    ).resolves.toEqual({
      createdAt: 300,
      fromId: "mem-1",
      id: "edge-1",
      relation: "compacts",
      toId: "mem-2",
    });

    await expect(memoryEdges.remove({ edgeId: "edge-1" })).resolves.toBe(true);

    const [, createInit] = fetchImpl.mock.calls[0]!;
    const [listUrl] = fetchImpl.mock.calls[1]!;
    const [, updateInit] = fetchImpl.mock.calls[3]!;

    expect(createInit?.body).toBe(JSON.stringify({
      from_id: "mem-1",
      relation: "derived_from",
      to_id: "mem-2",
    }));
    expect(updateInit?.body).toBe(JSON.stringify({
      relation: "compacts",
    }));

    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.pathname).toBe("/memory-edges");
    expect(listRequestUrl.searchParams.get("from_id")).toBe("mem-1");
    expect(listRequestUrl.searchParams.get("to_id")).toBe("mem-2");
    expect(listRequestUrl.searchParams.get("relation")).toBe("derived_from");
    expect(listRequestUrl.searchParams.get("sort_by")).toBe("created_at");
    expect(listRequestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(listRequestUrl.searchParams.get("limit")).toBe("10");
    expect(listRequestUrl.searchParams.get("offset")).toBe("2");
  });
});
