import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { buildApp } from "../src/app";
import { floors } from "../src/db/schema";
import type { DatabaseConnection } from "../src/db/client";

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
  let database: DatabaseConnection["db"];

  beforeEach(async () => {
    ({ app, database } = await buildApp({ databasePath: ":memory:", logger: false }));
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

    const pageA = await createPage({ floorId, pageNo: 1, pageKind: "input", version: 1 });
    const pageB = await createPage({ floorId, pageNo: 2, pageKind: "output", version: 3, checksum: "sha-b" });
    const pageC = await createPage({ floorId, pageNo: 2, pageKind: "output", version: 4, checksum: "sha-c" });
    const pageD = await createPage({ floorId, pageNo: 4, pageKind: "output", version: 5, checksum: "sha-d" });
    const pageE = await createPage({ floorId, pageNo: 4, pageKind: "output", version: 6, checksum: "sha-e" });

    const listAllByVersionResponse = await app.inject({
      method: "GET",
      url: "/pages?limit=10&offset=0&sort_by=version&sort_order=desc"
    });

    expect(listAllByVersionResponse.statusCode, listAllByVersionResponse.body).toBe(200);
    const listAllByVersionBody = listAllByVersionResponse.json<ListResponse<PageDto>>();
    expect(listAllByVersionBody.meta).toEqual({
      total: 5,
      limit: 10,
      offset: 0,
      has_more: false,
      sort_by: "version",
      sort_order: "desc"
    });
    expect(listAllByVersionBody.data.map((item) => item.id)).toEqual([
      pageE.id,
      pageD.id,
      pageC.id,
      pageB.id,
      pageA.id
    ]);

    const listAllByUpdatedAtResponse = await app.inject({
      method: "GET",
      url: "/pages?limit=10&offset=0&sort_by=updated_at&sort_order=desc"
    });

    expect(listAllByUpdatedAtResponse.statusCode, listAllByUpdatedAtResponse.body).toBe(200);
    const listAllByUpdatedAtBody = listAllByUpdatedAtResponse.json<ListResponse<PageDto>>();
    expect(listAllByUpdatedAtBody.meta).toEqual({
      total: 5,
      limit: 10,
      offset: 0,
      has_more: false,
      sort_by: "updated_at",
      sort_order: "desc"
    });
    expect(listAllByUpdatedAtBody.data).toHaveLength(5);

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
        id: pageC.id,
        floor_id: floorId,
        page_no: 2,
        page_kind: "output",
        is_active: false,
        version: 4,
        checksum: "sha-c"
      }),
      expect.objectContaining({
        id: pageE.id,
        floor_id: floorId,
        page_no: 4,
        page_kind: "output",
        is_active: false,
        version: 6,
        checksum: "sha-e"
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
        is_active: true,
        version: 7,
        checksum: "sha-updated"
      })
    );

    const invalidPatchResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${page.id}`,
      payload: { is_active: false }
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
      payload: { version: 2 }
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

  it("maps page uniqueness conflicts to stable 409 errors", async () => {
    const sessionId = await createSession();
    const floorId = await createFloor({ sessionId, floorNo: 3, branchId: "main" });

    const primaryPage = await createPage({ floorId, pageNo: 1, pageKind: "output", version: 1 });
    const otherActivePage = await createPage({ floorId, pageNo: 2, pageKind: "output", version: 2 });

    const duplicateCreateResponse = await app.inject({
      method: "POST",
      url: "/pages",
      payload: {
        floor_id: floorId,
        page_no: 1,
        page_kind: "output",
        version: 1,
      },
    });

    expect(duplicateCreateResponse.statusCode, duplicateCreateResponse.body).toBe(409);
    expect(duplicateCreateResponse.json<ErrorResponse>().error.code).toBe("page_conflict");

    const duplicateActiveSlotPatchResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${otherActivePage.id}`,
      payload: {
        page_no: primaryPage.page_no,
      },
    });

    expect(duplicateActiveSlotPatchResponse.statusCode, duplicateActiveSlotPatchResponse.body).toBe(409);
    expect(duplicateActiveSlotPatchResponse.json<ErrorResponse>().error.code).toBe("page_conflict");
  });

  it("locks committed floors for CRUD but still allows output activation within the same slot", async () => {
    const sessionId = await createSession();
    const floorId = await createFloor({ sessionId, floorNo: 3, branchId: "main" });

    const inputPage = await createPage({ floorId, pageNo: 0, pageKind: "input", version: 1 });
    const outputPageV1 = await createPage({ floorId, pageNo: 1, pageKind: "output", version: 1 });
    const outputPageV2 = await createPage({ floorId, pageNo: 1, pageKind: "output", version: 2 });

    // Phase 4.1 guardrails 后 PATCH /floors/:id 不再允许改 state，
    // 这里的夹具改走 DB 直写把 floor 切到 committed。
    await database
      .update(floors)
      .set({ state: "committed", updatedAt: Date.now() })
      .where(eq(floors.id, floorId));

    const lockedCreateResponse = await app.inject({
      method: "POST",
      url: "/pages",
      payload: { floor_id: floorId, page_no: 2, page_kind: "mixed" }
    });
    expect(lockedCreateResponse.statusCode).toBe(409);
    expect(lockedCreateResponse.json<ErrorResponse>().error.code).toBe("content_target_locked");

    const lockedPatchResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${outputPageV1.id}`,
      payload: { checksum: "after-commit" }
    });
    expect(lockedPatchResponse.statusCode).toBe(409);
    expect(lockedPatchResponse.json<ErrorResponse>().error.code).toBe("content_target_locked");

    const lockedDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/pages/${outputPageV1.id}`
    });
    expect(lockedDeleteResponse.statusCode).toBe(409);
    expect(lockedDeleteResponse.json<ErrorResponse>().error.code).toBe("content_target_locked");

    const lockedBatchDeleteResponse = await app.inject({
      method: "POST",
      url: "/pages/batch/delete",
      payload: { ids: [outputPageV1.id] }
    });
    expect(lockedBatchDeleteResponse.statusCode).toBe(409);
    expect(lockedBatchDeleteResponse.json<ErrorResponse>().error.code).toBe("content_target_locked");

    const activateInputResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${inputPage.id}/activate`
    });
    expect(activateInputResponse.statusCode).toBe(409);
    expect(activateInputResponse.json<ErrorResponse>().error.code).toBe("page_activation_not_allowed");

    const activateOutputResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${outputPageV2.id}/activate`
    });
    expect(activateOutputResponse.statusCode, activateOutputResponse.body).toBe(200);
    expect(activateOutputResponse.json<ItemResponse<PageDto>>().data).toEqual(expect.objectContaining({ id: outputPageV2.id, is_active: true }));

    expect((await app.inject({ method: "GET", url: `/pages/${inputPage.id}` })).json<ItemResponse<PageDto>>().data.is_active).toBe(true);
    expect((await app.inject({ method: "GET", url: `/pages/${outputPageV1.id}` })).json<ItemResponse<PageDto>>().data.is_active).toBe(false);
  });
});
