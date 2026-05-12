import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk operation logs resource", () => {
  it("lists operation logs and maps response fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: [
        {
          id: "op-1",
          account_id: "acc-1",
          actor_type: "user",
          actor_id: "subject-1",
          operation_group_id: null,
          request_id: "req-1",
          source_type: "http",
          action: "update_session",
          status: "succeeded",
          session_id: "session-1",
          branch_id: "main",
          floor_id: null,
          run_id: null,
          target_type: "session",
          target_id: "session-1",
          before_ref: { title: "Old" },
          after_ref: { title: "New" },
          diff: { total_changes: 1 },
          metadata: { route: "PATCH /sessions/:id" },
          created_at: 100,
        },
      ],
      meta: {
        total: 1,
        limit: 20,
        offset: 5,
        has_more: false,
        sort_by: "created_at",
        sort_order: "asc",
      },
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.operationLogs.list({
      accountId: "acc-1",
      limit: 20,
      offset: 5,
      sortOrder: "asc",
      status: "succeeded",
      targetId: "session-1",
      targetType: "session",
    })).resolves.toEqual({
      logs: [
        {
          accountId: "acc-1",
          action: "update_session",
          actorId: "subject-1",
          actorType: "user",
          afterRef: { title: "New" },
          beforeRef: { title: "Old" },
          branchId: "main",
          createdAt: 100,
          diff: { total_changes: 1 },
          floorId: null,
          id: "op-1",
          metadata: { route: "PATCH /sessions/:id" },
          operationGroupId: null,
          requestId: "req-1",
          runId: null,
          sessionId: "session-1",
          sourceType: "http",
          status: "succeeded",
          targetId: "session-1",
          targetType: "session",
        },
      ],
      meta: {
        hasMore: false,
        limit: 20,
        offset: 5,
        sortBy: "created_at",
        sortOrder: "asc",
        total: 1,
      },
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(String(url));
    expect(requestUrl.pathname).toBe("/operation-logs");
    expect(requestUrl.searchParams.get("target_type")).toBe("session");
    expect(requestUrl.searchParams.get("target_id")).toBe("session-1");
    expect(requestUrl.searchParams.get("status")).toBe("succeeded");
    expect(requestUrl.searchParams.get("limit")).toBe("20");
    expect(requestUrl.searchParams.get("offset")).toBe("5");
    expect(requestUrl.searchParams.get("sort_order")).toBe("asc");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });

  it("uses scoped operation log endpoints", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { total: 0, limit: 50, offset: 0, has_more: false, sort_by: "created_at", sort_order: "desc" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { total: 0, limit: 50, offset: 0, has_more: false, sort_by: "created_at", sort_order: "desc" } }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await client.operationLogs.listForSession({ accountId: "acc-1", sessionId: "session 1", action: "update_session" });
    await client.operationLogs.listForFloor({ accountId: "acc-1", floorId: "floor 1", runId: "run-1" });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/sessions/session%201/operation-logs?action=update_session&limit=50&offset=0&sort_order=desc");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/floors/floor%201/operation-logs?run_id=run-1&limit=50&offset=0&sort_order=desc");
  });
});
