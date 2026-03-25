import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type ItemResponse<T> = { data: T };

type ListResponse<T> = {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    sort_by: string;
    sort_order: "asc" | "desc";
  };
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type PageKind = "input" | "output" | "mixed";

type PageDto = {
  id: string;
  floor_id: string;
  page_no: number;
  page_kind: PageKind;
  is_active: boolean;
  version: number;
  checksum: string | null;
  created_at: number;
  updated_at: number;
};

type BatchDeleteResponse = {
  data: {
    results: Array<{ index: number; id: string; action: "deleted" | "not_found" }>;
    meta: { total: number; deleted: number; not_found: number };
  };
};

describe("page routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function createSession(title = "Page Session"): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title }
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createFloor(args: { sessionId: string; floorNo: number; branchId: string }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: args.sessionId,
        floor_no: args.floorNo,
        branch_id: args.branchId
      }
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createPage(args: {
    floorId: string;
    pageNo: number;
    pageKind: PageKind;
    isActive?: boolean;
    version?: number;
    checksum?: string;
  }): Promise<PageDto> {
    const response = await app.inject({
      method: "POST",
      url: "/pages",
      payload: {
        floor_id: args.floorId,
        page_no: args.pageNo,
        page_kind: args.pageKind,
        ...(args.isActive !== undefined ? { is_active: args.isActive } : {}),
        ...(args.version !== undefined ? { version: args.version } : {}),
        ...(args.checksum !== undefined ? { checksum: args.checksum } : {})
      }
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<PageDto>>().data;
  }

  it("lists pages with and without filters", async () => {
    const sessionId = await createSession();
    const floorId = await createFloor({ sessionId, floorNo: 0, branchId: "main" });

    const pageA = await createPage({ floorId, pageNo: 1, pageKind: "input", isActive: true, version: 1 });
    const pageB = await createPage({ floorId, pageNo: 2, pageKind: "output", isActive: false, version: 3, checksum: "sha-b" });
    const pageC = await createPage({ floorId, pageNo: 3, pageKind: "mixed", isActive: true, version: 2, checksum: "sha-c" });
    const pageD = await createPage({ floorId, pageNo: 4, pageKind: "output", isActive: false, version: 4, checksum: "sha-d" });

    const listAllByVersionResponse = await app.inject({
      method: "GET",
      url: "/pages?limit=10&offset=0&sort_by=version&sort_order=desc"
    });

    expect(listAllByVersionResponse.statusCode, listAllByVersionResponse.body).toBe(200);
    const listAllByVersionBody = listAllByVersionResponse.json<ListResponse<PageDto>>();
    expect(listAllByVersionBody.meta).toEqual({
      total: 4,
      limit: 10,
      offset: 0,
      has_more: false,
      sort_by: "version",
      sort_order: "desc"
    });
    expect(listAllByVersionBody.data.map((item) => item.id)).toEqual([
      pageD.id,
      pageB.id,
      pageC.id,
      pageA.id
    ]);

    const listAllByUpdatedAtResponse = await app.inject({
      method: "GET",
      url: "/pages?limit=10&offset=0&sort_by=updated_at&sort_order=desc"
    });

    expect(listAllByUpdatedAtResponse.statusCode, listAllByUpdatedAtResponse.body).toBe(200);
    const listAllByUpdatedAtBody = listAllByUpdatedAtResponse.json<ListResponse<PageDto>>();
    expect(listAllByUpdatedAtBody.meta).toEqual({
      total: 4,
      limit: 10,
      offset: 0,
      has_more: false,
      sort_by: "updated_at",
      sort_order: "desc"
    });
    expect(listAllByUpdatedAtBody.data).toHaveLength(4);

    const filteredResponse = await app.inject({
      method: "GET",
      url: `/pages?floor_id=${floorId}&page_kind=output&is_active=false&limit=10&offset=0&sort_by=page_no&sort_order=asc`
    });

    expect(filteredResponse.statusCode, filteredResponse.body).toBe(200);
    const filteredBody = filteredResponse.json<ListResponse<PageDto>>();
    expect(filteredBody.meta).toEqual({
      total: 2,
      limit: 10,
      offset: 0,
      has_more: false,
      sort_by: "page_no",
      sort_order: "asc"
    });
    expect(filteredBody.data).toEqual([
      expect.objectContaining({
        id: pageB.id,
        floor_id: floorId,
        page_no: 2,
        page_kind: "output",
        is_active: false,
        version: 3,
        checksum: "sha-b"
      }),
      expect.objectContaining({
        id: pageD.id,
        floor_id: floorId,
        page_no: 4,
        page_kind: "output",
        is_active: false,
        version: 4,
        checksum: "sha-d"
      })
    ]);
  });

  it("gets and updates pages and reports missing pages", async () => {
    const sessionId = await createSession();
    const floorId = await createFloor({ sessionId, floorNo: 1, branchId: "main" });
    const page = await createPage({
      floorId,
      pageNo: 1,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: "sha-initial"
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/pages/${page.id}`
    });

    expect(getResponse.statusCode, getResponse.body).toBe(200);
    expect(getResponse.json<ItemResponse<PageDto>>().data).toEqual(
      expect.objectContaining({
        id: page.id,
        floor_id: floorId,
        page_no: 1,
        page_kind: "input",
        is_active: true,
        version: 1,
        checksum: "sha-initial"
      })
    );

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${page.id}`,
      payload: {
        page_no: 5,
        page_kind: "mixed",
        is_active: false,
        version: 7,
        checksum: "sha-updated"
      }
    });

    expect(patchResponse.statusCode, patchResponse.body).toBe(200);
    expect(patchResponse.json<ItemResponse<PageDto>>().data).toEqual(
      expect.objectContaining({
        id: page.id,
        floor_id: floorId,
        page_no: 5,
        page_kind: "mixed",
        is_active: false,
        version: 7,
        checksum: "sha-updated"
      })
    );

    const invalidPatchResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${page.id}`,
      payload: {}
    });

    expect(invalidPatchResponse.statusCode).toBe(400);
    expect(invalidPatchResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const missingGetResponse = await app.inject({
      method: "GET",
      url: "/pages/missing-page"
    });

    expect(missingGetResponse.statusCode).toBe(404);
    expect(missingGetResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const missingPatchResponse = await app.inject({
      method: "PATCH",
      url: "/pages/missing-page",
      payload: { is_active: true }
    });

    expect(missingPatchResponse.statusCode).toBe(404);
    expect(missingPatchResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const missingDeleteResponse = await app.inject({
      method: "DELETE",
      url: "/pages/missing-page"
    });

    expect(missingDeleteResponse.statusCode).toBe(404);
    expect(missingDeleteResponse.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("validates create and list requests and supports batch delete", async () => {
    const sessionId = await createSession();
    const floorId = await createFloor({ sessionId, floorNo: 2, branchId: "main" });
    const pageA = await createPage({ floorId, pageNo: 1, pageKind: "input" });
    const pageB = await createPage({ floorId, pageNo: 2, pageKind: "output" });

    const invalidCreateResponse = await app.inject({
      method: "POST",
      url: "/pages",
      payload: {
        floor_id: floorId,
        page_no: -1,
        page_kind: "input"
      }
    });

    expect(invalidCreateResponse.statusCode).toBe(400);
    expect(invalidCreateResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const invalidListResponse = await app.inject({
      method: "GET",
      url: "/pages?limit=0"
    });

    expect(invalidListResponse.statusCode).toBe(400);
    expect(invalidListResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const invalidBatchDeleteResponse = await app.inject({
      method: "POST",
      url: "/pages/batch/delete",
      payload: {
        ids: [pageA.id, pageA.id]
      }
    });

    expect(invalidBatchDeleteResponse.statusCode).toBe(400);
    const invalidBatchDeleteBody = invalidBatchDeleteResponse.json<ErrorResponse>();
    expect(invalidBatchDeleteBody.error.code).toBe("validation_error");
    expect(invalidBatchDeleteBody.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "ids.1",
          message: expect.stringContaining("Duplicate id")
        })
      ])
    );

    const batchDeleteResponse = await app.inject({
      method: "POST",
      url: "/pages/batch/delete",
      payload: {
        ids: [pageA.id, "page_missing", pageB.id]
      }
    });

    expect(batchDeleteResponse.statusCode, batchDeleteResponse.body).toBe(200);
    const batchDeleteBody = batchDeleteResponse.json<BatchDeleteResponse>();
    expect(batchDeleteBody.data.meta).toEqual({ total: 3, deleted: 2, not_found: 1 });
    expect(batchDeleteBody.data.results).toEqual([
      { index: 0, id: pageA.id, action: "deleted" },
      { index: 1, id: "page_missing", action: "not_found" },
      { index: 2, id: pageB.id, action: "deleted" }
    ]);

    expect((await app.inject({ method: "GET", url: `/pages/${pageA.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/pages/${pageB.id}` })).statusCode).toBe(404);
  });
});
