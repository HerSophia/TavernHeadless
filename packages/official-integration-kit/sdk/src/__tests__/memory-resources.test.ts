import { describe, expect, it, vi } from "vitest";

import { createMemoriesResource } from "../resources/memories.js";
import { createMemoryEdgesResource } from "../resources/memory-edges.js";
import { createTransportClient } from "../client/transport.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk memory resources", () => {
  it("creates, lists, reads stats and detail, updates, deletes, and batch mutates memories", async () => {
    const memoryPayload = {
      confidence: 0.9,
      content: { text: "Alice carries a silver sword." },
      created_at: 100,
      id: "mem-1",
      fact_key: "relationship",
      importance: 0.8,
      scope: "chat",
      scope_id: "session-1",
      source_floor_id: "floor-1",
      source_message_id: "msg-1",
      status: "active",
      type: "fact",
      updated_at: 101,
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
              fact: 1,
              open_loop: 0,
              summary: 0,
            },
            deprecated: 0,
            estimated_tokens: 12,
            total: 1,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: memoryPayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...memoryPayload, fact_key: null, status: "deprecated" } }))
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
                data: { ...memoryPayload, fact_key: null, status: "deprecated" },
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
        content: { text: "Alice carries a silver sword." },
        importance: 0.8,
        factKey: "relationship",
        scope: "chat",
        scopeId: "session-1",
        sourceFloorId: "floor-1",
        sourceMessageId: "msg-1",
        status: "active",
        type: "fact",
      }),
    ).resolves.toEqual({
      confidence: 0.9,
      content: { text: "Alice carries a silver sword." },
      createdAt: 100,
      factKey: "relationship",
      id: "mem-1",
      importance: 0.8,
      scope: "chat",
      scopeId: "session-1",
      sourceFloorId: "floor-1",
      sourceMessageId: "msg-1",
      status: "active",
      type: "fact",
      updatedAt: 101,
    });

    await expect(
      memories.list({
        confidenceMin: 0.5,
        createdFrom: 10,
        importanceMax: 0.9,
        limit: 10,
        factKey: "relationship",
        offset: 1,
        q: "silver",
        scope: "chat",
        scopeId: "session-1",
        sortBy: "importance",
        sortOrder: "asc",
        sourceFloorId: "floor-1",
        sourceMessageId: "msg-1",
        status: "active",
        type: "fact",
        updatedTo: 999,
      }),
    ).resolves.toEqual([
      {
        confidence: 0.9,
        content: { text: "Alice carries a silver sword." },
        createdAt: 100,
        factKey: "relationship",
        id: "mem-1",
        importance: 0.8,
        scope: "chat",
        scopeId: "session-1",
        sourceFloorId: "floor-1",
        sourceMessageId: "msg-1",
        status: "active",
        type: "fact",
        updatedAt: 101,
      },
    ]);

    await expect(
      memories.getStats({
        q: "silver",
        factKey: "relationship",
        scope: "chat",
        status: "active",
      }),
    ).resolves.toEqual({
      active: 1,
      avgConfidence: 0.9,
      avgImportance: 0.8,
      byType: {
        fact: 1,
        openLoop: 0,
        summary: 0,
      },
      deprecated: 0,
      estimatedTokens: 12,
      total: 1,
    });

    await expect(memories.getDetail({ memoryId: "mem-1" })).resolves.toEqual({
      confidence: 0.9,
      content: { text: "Alice carries a silver sword." },
      createdAt: 100,
      factKey: "relationship",
      id: "mem-1",
      importance: 0.8,
      scope: "chat",
      scopeId: "session-1",
      sourceFloorId: "floor-1",
      sourceMessageId: "msg-1",
      status: "active",
      type: "fact",
      updatedAt: 101,
    });

    await expect(
      memories.update({
        memoryId: "mem-1",
        factKey: null,
        status: "deprecated",
      }),
    ).resolves.toEqual({
      confidence: 0.9,
      content: { text: "Alice carries a silver sword." },
      createdAt: 100,
      factKey: null,
      id: "mem-1",
      importance: 0.8,
      scope: "chat",
      scopeId: "session-1",
      sourceFloorId: "floor-1",
      sourceMessageId: "msg-1",
      status: "deprecated",
      type: "fact",
      updatedAt: 101,
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
            content: { text: "Alice carries a silver sword." },
            createdAt: 100,
            factKey: null,
            id: "mem-1",
            importance: 0.8,
            scope: "chat",
            scopeId: "session-1",
            sourceFloorId: "floor-1",
            sourceMessageId: "msg-1",
            status: "deprecated",
            type: "fact",
            updatedAt: 101,
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
      content: { text: "Alice carries a silver sword." },
      fact_key: "relationship",
      importance: 0.8,
      scope: "chat",
      scope_id: "session-1",
      source_floor_id: "floor-1",
      source_message_id: "msg-1",
      status: "active",
      type: "fact",
    }));
    expect(updateInit?.body).toBe(JSON.stringify({
      fact_key: null,
      status: "deprecated",
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
    expect(listRequestUrl.searchParams.get("fact_key")).toBe("relationship");
    expect(listRequestUrl.searchParams.get("limit")).toBe("10");
    expect(listRequestUrl.searchParams.get("offset")).toBe("1");
    expect(listRequestUrl.searchParams.get("q")).toBe("silver");
    expect(listRequestUrl.searchParams.get("scope")).toBe("chat");
    expect(listRequestUrl.searchParams.get("scope_id")).toBe("session-1");
    expect(listRequestUrl.searchParams.get("sort_by")).toBe("importance");
    expect(listRequestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(listRequestUrl.searchParams.get("source_floor_id")).toBe("floor-1");
    expect(listRequestUrl.searchParams.get("source_message_id")).toBe("msg-1");
    expect(listRequestUrl.searchParams.get("status")).toBe("active");
    expect(listRequestUrl.searchParams.get("type")).toBe("fact");
    expect(listRequestUrl.searchParams.get("updated_to")).toBe("999");

    const statsRequestUrl = new URL(statsUrl as string);
    expect(statsRequestUrl.pathname).toBe("/memories/stats");
    expect(statsRequestUrl.searchParams.get("fact_key")).toBe("relationship");
    expect(statsRequestUrl.searchParams.get("q")).toBe("silver");
    expect(statsRequestUrl.searchParams.get("scope")).toBe("chat");
    expect(statsRequestUrl.searchParams.get("status")).toBe("active");
  });

  it("creates, lists, gets, updates, and removes memory edges", async () => {
    const edgePayload = {
      created_at: 300,
      from_id: "mem-1",
      id: "edge-1",
      relation: "supports",
      to_id: "mem-2",
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: edgePayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: [null, edgePayload] }))
      .mockResolvedValueOnce(jsonResponse({ data: edgePayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...edgePayload, relation: "updates" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "edge-1", deleted: true } }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const memoryEdges = createMemoryEdgesResource(transport);

    await expect(
      memoryEdges.create({
        fromId: "mem-1",
        relation: "supports",
        toId: "mem-2",
      }),
    ).resolves.toEqual({
      createdAt: 300,
      fromId: "mem-1",
      id: "edge-1",
      relation: "supports",
      toId: "mem-2",
    });

    await expect(
      memoryEdges.list({
        fromId: "mem-1",
        limit: 10,
        offset: 2,
        relation: "supports",
        sortBy: "created_at",
        sortOrder: "asc",
        toId: "mem-2",
      }),
    ).resolves.toEqual([
      {
        createdAt: 300,
        fromId: "mem-1",
        id: "edge-1",
        relation: "supports",
        toId: "mem-2",
      },
    ]);

    await expect(memoryEdges.getDetail({ edgeId: "edge-1" })).resolves.toEqual({
      createdAt: 300,
      fromId: "mem-1",
      id: "edge-1",
      relation: "supports",
      toId: "mem-2",
    });

    await expect(
      memoryEdges.update({
        edgeId: "edge-1",
        relation: "updates",
      }),
    ).resolves.toEqual({
      createdAt: 300,
      fromId: "mem-1",
      id: "edge-1",
      relation: "updates",
      toId: "mem-2",
    });

    await expect(memoryEdges.remove({ edgeId: "edge-1" })).resolves.toBe(true);

    const [, createInit] = fetchImpl.mock.calls[0]!;
    const [listUrl] = fetchImpl.mock.calls[1]!;
    const [, updateInit] = fetchImpl.mock.calls[3]!;

    expect(createInit?.body).toBe(JSON.stringify({
      from_id: "mem-1",
      relation: "supports",
      to_id: "mem-2",
    }));
    expect(updateInit?.body).toBe(JSON.stringify({
      relation: "updates",
    }));

    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.pathname).toBe("/memory-edges");
    expect(listRequestUrl.searchParams.get("from_id")).toBe("mem-1");
    expect(listRequestUrl.searchParams.get("to_id")).toBe("mem-2");
    expect(listRequestUrl.searchParams.get("relation")).toBe("supports");
    expect(listRequestUrl.searchParams.get("sort_by")).toBe("created_at");
    expect(listRequestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(listRequestUrl.searchParams.get("limit")).toBe("10");
    expect(listRequestUrl.searchParams.get("offset")).toBe("2");
  });
});
