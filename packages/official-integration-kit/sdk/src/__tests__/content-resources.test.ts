import { describe, expect, it, vi } from "vitest";

import { createBranchesResource } from "../resources/branches.js";
import { createPagesResource } from "../resources/pages.js";
import { createTransportClient } from "../client/transport.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk content resources", () => {
  it("creates, lists, gets, updates, activates, removes, and batch deletes pages", async () => {
    const pagePayload = {
      checksum: "sum-1",
      created_at: 100,
      floor_id: "floor-1",
      id: "page-1",
      is_active: true,
      page_kind: "output",
      page_no: 2,
      updated_at: 101,
      version: 3,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: pagePayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: [null, pagePayload] }))
      .mockResolvedValueOnce(jsonResponse({ data: pagePayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...pagePayload, page_no: 4, version: 5 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...pagePayload, is_active: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "page-1", deleted: true } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              deleted: 1,
              not_found: 1,
              total: 2,
            },
            results: [
              { action: "deleted", id: "page-1", index: 0 },
              { action: "not_found", id: "page-2", index: 1 },
            ],
          },
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const pages = createPagesResource(transport);

    await expect(
      pages.create({
        checksum: "sum-1",
        floorId: "floor-1",
        pageKind: "output",
        pageNo: 2,
        version: 3,
      }),
    ).resolves.toEqual({
      checksum: "sum-1",
      createdAt: 100,
      floorId: "floor-1",
      id: "page-1",
      isActive: true,
      pageKind: "output",
      pageNo: 2,
      updatedAt: 101,
      version: 3,
    });

    await expect(
      pages.list({
        floorId: "floor-1",
        isActive: true,
        limit: 10,
        offset: 2,
        pageKind: "output",
        sortBy: "version",
        sortOrder: "asc",
      }),
    ).resolves.toEqual([
      {
        checksum: "sum-1",
        createdAt: 100,
        floorId: "floor-1",
        id: "page-1",
        isActive: true,
        pageKind: "output",
        pageNo: 2,
        updatedAt: 101,
        version: 3,
      },
    ]);

    await expect(pages.getDetail({ pageId: "page-1" })).resolves.toEqual({
      checksum: "sum-1",
      createdAt: 100,
      floorId: "floor-1",
      id: "page-1",
      isActive: true,
      pageKind: "output",
      pageNo: 2,
      updatedAt: 101,
      version: 3,
    });

    await expect(
      pages.update({
        pageId: "page-1",
        pageNo: 4,
        version: 5,
      }),
    ).resolves.toEqual({
      checksum: "sum-1",
      createdAt: 100,
      floorId: "floor-1",
      id: "page-1",
      isActive: true,
      pageKind: "output",
      pageNo: 4,
      updatedAt: 101,
      version: 5,
    });

    await expect(pages.activate({ pageId: "page-1" })).resolves.toEqual({
      checksum: "sum-1",
      createdAt: 100,
      floorId: "floor-1",
      id: "page-1",
      isActive: true,
      pageKind: "output",
      pageNo: 2,
      updatedAt: 101,
      version: 3,
    });

    await expect(pages.remove({ pageId: "page-1" })).resolves.toBe(true);

    await expect(pages.batchDelete({ ids: ["page-1", "page-2"] })).resolves.toEqual({
      meta: {
        deleted: 1,
        notFound: 1,
        total: 2,
      },
      results: [
        { action: "deleted", id: "page-1", index: 0 },
        { action: "not_found", id: "page-2", index: 1 },
      ],
    });

    const [, createInit] = fetchImpl.mock.calls[0]!;
    const [listUrl] = fetchImpl.mock.calls[1]!;
    const [, updateInit] = fetchImpl.mock.calls[3]!;
    expect(createInit?.body).toBe(JSON.stringify({
      checksum: "sum-1",
      floor_id: "floor-1",
      page_kind: "output",
      page_no: 2,
      version: 3,
    }));
    expect(updateInit?.body).toBe(JSON.stringify({
      page_no: 4,
      version: 5,
    }));

    const requestUrl = new URL(listUrl as string);
    expect(requestUrl.pathname).toBe("/pages");
    expect(requestUrl.searchParams.get("floor_id")).toBe("floor-1");
    expect(requestUrl.searchParams.get("is_active")).toBe("true");
    expect(requestUrl.searchParams.get("page_kind")).toBe("output");
    expect(requestUrl.searchParams.get("sort_by")).toBe("version");
    expect(requestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(requestUrl.searchParams.get("limit")).toBe("10");
    expect(requestUrl.searchParams.get("offset")).toBe("2");
  });

  it("creates and reads manual revision timelines for committed pages", async () => {
    const timelinePayload = {
      target_kind: "page",
      target_id: "page-1",
      session_id: "session-1",
      branch_id: "main",
      floor_id: "floor-1",
      page_id: "page-1",
      message_id: "msg-1",
      current_content: "Edited page content",
      current_token_count: 8,
      latest_revision_no: 2,
      items: [
        {
          id: "rev-2",
          session_id: "session-1",
          branch_id: "main",
          floor_id: "floor-1",
          page_id: "page-1",
          message_id: "msg-1",
          requested_target_kind: "page",
          requested_target_id: "page-1",
          revision_no: 2,
          original_content: "Original page content",
          previous_content: "First edited page content",
          edited_content: "Edited page content",
          reason: "page wrapper",
          actor_type: "account",
          actor_id: "acc-1",
          actor_account_id: "acc-1",
          actor_client_id: null,
          operation_log_id: "op-2",
          created_at: 205,
        },
      ],
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: timelinePayload }))
      .mockResolvedValueOnce(jsonResponse({ data: timelinePayload }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const pages = createPagesResource(transport);

    await expect(
      pages.createManualRevision({
        accountId: "acc-1",
        content: "Edited page content",
        expectedLatestRevisionNo: 1,
        pageId: "page-1",
        reason: "page wrapper",
      }),
    ).resolves.toEqual({
      targetKind: "page",
      targetId: "page-1",
      sessionId: "session-1",
      branchId: "main",
      floorId: "floor-1",
      pageId: "page-1",
      messageId: "msg-1",
      currentContent: "Edited page content",
      currentTokenCount: 8,
      latestRevisionNo: 2,
      items: [
        expect.objectContaining({
          id: "rev-2",
          requestedTargetKind: "page",
          requestedTargetId: "page-1",
          operationLogId: "op-2",
        }),
      ],
    });

    await expect(
      pages.getManualRevisions({
        accountId: "acc-1",
        pageId: "page-1",
      }),
    ).resolves.toEqual({
      targetKind: "page",
      targetId: "page-1",
      sessionId: "session-1",
      branchId: "main",
      floorId: "floor-1",
      pageId: "page-1",
      messageId: "msg-1",
      currentContent: "Edited page content",
      currentTokenCount: 8,
      latestRevisionNo: 2,
      items: [
        expect.objectContaining({
          id: "rev-2",
          requestedTargetKind: "page",
        }),
      ],
    });

    const [, createInit] = fetchImpl.mock.calls[0]!;
    const [detailUrl, detailInit] = fetchImpl.mock.calls[1]!;
    expect(createInit?.body).toBe(JSON.stringify({
      content: "Edited page content",
      expected_latest_revision_no: 1,
      reason: "page wrapper",
    }));
    expect(String(detailUrl)).toBe("http://localhost:3000/pages/page-1/manual-revisions");
    expect(detailInit?.method).toBe("GET");
  });

  it("removes branches and passes the optional session query", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-1",
          deleted_floor_count: 3,
          session_id: "session-1",
        },
      }),
    );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const branches = createBranchesResource(transport);

    await expect(
      branches.remove({
        branchId: "branch-1",
        sessionId: "session-1",
      }),
    ).resolves.toEqual({
      branchId: "branch-1",
      deletedFloorCount: 3,
      sessionId: "session-1",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/branches/branch-1");
    expect(requestUrl.searchParams.get("session_id")).toBe("session-1");
    expect(init?.method).toBe("DELETE");
  });
});
