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

type FloorState = "draft" | "generating" | "committed" | "failed";
type PageKind = "input" | "output" | "mixed";
type MessageRole = "user" | "assistant" | "system" | "narrator";

type FloorDto = {
  id: string;
  session_id: string;
  floor_no: number;
  branch_id: string;
  state: FloorState;
  parent_floor_id: string | null;
};

type PageDto = {
  id: string;
  floor_id: string;
  page_no: number;
  page_kind: PageKind;
  is_active: boolean;
};

type MessageDto = {
  id: string;
  page_id: string;
  seq: number;
  role: MessageRole;
  content: string;
  is_hidden: boolean;
};

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("direct content CRUD multi-account isolation", () => {
  let app: FastifyInstance;
  let rootToken: string;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
    }));

    rootToken = app.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });
    await createAccount("acc-a", "Account A");
    await createAccount("acc-b", "Account B");

    tokenA = app.jwt.sign({ sub: "user-a", account_id: "acc-a", role: "admin" });
    tokenB = app.jwt.sign({ sub: "user-b", account_id: "acc-b", role: "admin" });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function createAccount(id: string, name: string) {
    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: bearer(rootToken),
      payload: { id, name },
    });

    expect(response.statusCode, response.body).toBe(201);
  }

  async function createSession(token: string, title: string): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: bearer(token),
      payload: { title },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createFloor(args: {
    token: string;
    sessionId: string;
    floorNo: number;
    branchId: string;
    state?: FloorState;
    parentFloorId?: string;
  }): Promise<FloorDto> {
    const response = await app.inject({
      method: "POST",
      url: "/floors",
      headers: bearer(args.token),
      payload: {
        session_id: args.sessionId,
        floor_no: args.floorNo,
        branch_id: args.branchId,
        ...(args.state !== undefined ? { state: args.state } : {}),
        ...(args.parentFloorId !== undefined ? { parent_floor_id: args.parentFloorId } : {}),
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<FloorDto>>().data;
  }

  async function createPage(args: {
    token: string;
    floorId: string;
    pageNo: number;
    pageKind: PageKind;
    isActive?: boolean;
  }): Promise<PageDto> {
    const response = await app.inject({
      method: "POST",
      url: "/pages",
      headers: bearer(args.token),
      payload: {
        floor_id: args.floorId,
        page_no: args.pageNo,
        page_kind: args.pageKind,
        ...(args.isActive !== undefined ? { is_active: args.isActive } : {}),
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<PageDto>>().data;
  }

  async function createMessage(args: {
    token: string;
    pageId: string;
    seq: number;
    role: MessageRole;
    content: string;
    isHidden?: boolean;
  }): Promise<MessageDto> {
    const response = await app.inject({
      method: "POST",
      url: "/messages",
      headers: bearer(args.token),
      payload: {
        page_id: args.pageId,
        seq: args.seq,
        role: args.role,
        content: args.content,
        ...(args.isHidden !== undefined ? { is_hidden: args.isHidden } : {}),
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<MessageDto>>().data;
  }

  it("isolates floor CRUD and branch routes by account", async () => {
    const sessionA = await createSession(tokenA, "Session A");
    const sessionB = await createSession(tokenB, "Session B");

    const floorAMain = await createFloor({
      token: tokenA,
      sessionId: sessionA,
      floorNo: 0,
      branchId: "main",
      state: "committed",
    });
    const floorAAlt = await createFloor({
      token: tokenA,
      sessionId: sessionA,
      floorNo: 1,
      branchId: "alt",
      state: "committed",
    });
    const floorBMain = await createFloor({
      token: tokenB,
      sessionId: sessionB,
      floorNo: 0,
      branchId: "main",
      state: "draft",
    });

    const listOwnResponse = await app.inject({
      method: "GET",
      url: "/floors?limit=10&offset=0&sort_by=floor_no&sort_order=asc",
      headers: bearer(tokenB),
    });

    expect(listOwnResponse.statusCode, listOwnResponse.body).toBe(200);
    const listOwnBody = listOwnResponse.json<ListResponse<FloorDto>>();
    expect(listOwnBody.data).toHaveLength(1);
    expect(listOwnBody.data[0]?.id).toBe(floorBMain.id);
    expect(listOwnBody.data[0]?.session_id).toBe(sessionB);

    const filteredForeignListResponse = await app.inject({
      method: "GET",
      url: `/floors?session_id=${sessionA}&limit=10&offset=0&sort_by=floor_no&sort_order=asc`,
      headers: bearer(tokenB),
    });

    expect(filteredForeignListResponse.statusCode, filteredForeignListResponse.body).toBe(200);
    expect(filteredForeignListResponse.json<ListResponse<FloorDto>>().data).toHaveLength(0);

    const createForeignSessionResponse = await app.inject({
      method: "POST",
      url: "/floors",
      headers: bearer(tokenB),
      payload: { session_id: sessionA, floor_no: 2, branch_id: "fork" },
    });

    expect(createForeignSessionResponse.statusCode).toBe(404);
    expect(createForeignSessionResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const createForeignParentResponse = await app.inject({
      method: "POST",
      url: "/floors",
      headers: bearer(tokenB),
      payload: {
        session_id: sessionB,
        floor_no: 1,
        branch_id: "alt",
        parent_floor_id: floorAMain.id,
      },
    });

    expect(createForeignParentResponse.statusCode).toBe(404);
    expect(createForeignParentResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const getForeignResponse = await app.inject({
      method: "GET",
      url: `/floors/${floorAMain.id}`,
      headers: bearer(tokenB),
    });

    expect(getForeignResponse.statusCode).toBe(404);
    expect(getForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const patchForeignResponse = await app.inject({
      method: "PATCH",
      url: `/floors/${floorAMain.id}`,
      headers: bearer(tokenB),
      payload: { state: "failed" },
    });

    expect(patchForeignResponse.statusCode).toBe(404);
    expect(patchForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const patchForeignParentResponse = await app.inject({
      method: "PATCH",
      url: `/floors/${floorBMain.id}`,
      headers: bearer(tokenB),
      payload: { parent_floor_id: floorAMain.id },
    });

    expect(patchForeignParentResponse.statusCode).toBe(404);
    expect(patchForeignParentResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const deleteForeignResponse = await app.inject({
      method: "DELETE",
      url: `/floors/${floorAMain.id}`,
      headers: bearer(tokenB),
    });

    expect(deleteForeignResponse.statusCode).toBe(404);
    expect(deleteForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const branchForeignResponse = await app.inject({
      method: "POST",
      url: `/floors/${floorAMain.id}/branch`,
      headers: bearer(tokenB),
    });

    expect(branchForeignResponse.statusCode).toBe(404);
    expect(branchForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const deleteForeignBranchResponse = await app.inject({
      method: "DELETE",
      url: `/branches/alt?session_id=${sessionA}`,
      headers: bearer(tokenB),
    });

    expect(deleteForeignBranchResponse.statusCode).toBe(404);
    expect(deleteForeignBranchResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const ownerAltListResponse = await app.inject({
      method: "GET",
      url: `/floors?session_id=${sessionA}&branch_id=alt&limit=10&offset=0&sort_by=floor_no&sort_order=asc`,
      headers: bearer(tokenA),
    });

    expect(ownerAltListResponse.statusCode, ownerAltListResponse.body).toBe(200);
    expect(ownerAltListResponse.json<ListResponse<FloorDto>>().data.map((item) => item.id)).toEqual([floorAAlt.id]);
  });

  it("isolates page CRUD, activation, and batch delete by account", async () => {
    const sessionA = await createSession(tokenA, "Session A");
    const sessionB = await createSession(tokenB, "Session B");

    const floorA = await createFloor({ token: tokenA, sessionId: sessionA, floorNo: 0, branchId: "main" });
    const floorB = await createFloor({ token: tokenB, sessionId: sessionB, floorNo: 0, branchId: "main" });

    const pageA1 = await createPage({ token: tokenA, floorId: floorA.id, pageNo: 1, pageKind: "input", isActive: true });
    const pageA2 = await createPage({ token: tokenA, floorId: floorA.id, pageNo: 2, pageKind: "output", isActive: false });
    const pageB1 = await createPage({ token: tokenB, floorId: floorB.id, pageNo: 1, pageKind: "input", isActive: true });
    const pageB2 = await createPage({ token: tokenB, floorId: floorB.id, pageNo: 2, pageKind: "output", isActive: false });

    const listOwnResponse = await app.inject({
      method: "GET",
      url: "/pages?limit=10&offset=0&sort_by=page_no&sort_order=asc",
      headers: bearer(tokenB),
    });

    expect(listOwnResponse.statusCode, listOwnResponse.body).toBe(200);
    expect(listOwnResponse.json<ListResponse<PageDto>>().data.map((item) => item.id)).toEqual([pageB1.id, pageB2.id]);

    const filteredForeignListResponse = await app.inject({
      method: "GET",
      url: `/pages?floor_id=${floorA.id}&limit=10&offset=0&sort_by=page_no&sort_order=asc`,
      headers: bearer(tokenB),
    });

    expect(filteredForeignListResponse.statusCode, filteredForeignListResponse.body).toBe(200);
    expect(filteredForeignListResponse.json<ListResponse<PageDto>>().data).toHaveLength(0);

    const createForeignResponse = await app.inject({
      method: "POST",
      url: "/pages",
      headers: bearer(tokenB),
      payload: { floor_id: floorA.id, page_no: 3, page_kind: "mixed" },
    });

    expect(createForeignResponse.statusCode).toBe(404);
    expect(createForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const getForeignResponse = await app.inject({
      method: "GET",
      url: `/pages/${pageA1.id}`,
      headers: bearer(tokenB),
    });

    expect(getForeignResponse.statusCode).toBe(404);
    expect(getForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const patchForeignResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${pageA1.id}`,
      headers: bearer(tokenB),
      payload: { is_active: false },
    });

    expect(patchForeignResponse.statusCode).toBe(404);
    expect(patchForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const deleteForeignResponse = await app.inject({
      method: "DELETE",
      url: `/pages/${pageA1.id}`,
      headers: bearer(tokenB),
    });

    expect(deleteForeignResponse.statusCode).toBe(404);
    expect(deleteForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const activateOwnResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${pageB2.id}/activate`,
      headers: bearer(tokenB),
    });

    expect(activateOwnResponse.statusCode, activateOwnResponse.body).toBe(200);
    expect(activateOwnResponse.json<ItemResponse<PageDto>>().data).toEqual(
      expect.objectContaining({ id: pageB2.id, is_active: true })
    );

    const pageB1AfterActivateResponse = await app.inject({
      method: "GET",
      url: `/pages/${pageB1.id}`,
      headers: bearer(tokenB),
    });

    expect(pageB1AfterActivateResponse.statusCode, pageB1AfterActivateResponse.body).toBe(200);
    expect(pageB1AfterActivateResponse.json<ItemResponse<PageDto>>().data.is_active).toBe(false);

    const activateForeignResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${pageA2.id}/activate`,
      headers: bearer(tokenB),
    });

    expect(activateForeignResponse.statusCode).toBe(404);
    expect(activateForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const batchDeleteResponse = await app.inject({
      method: "POST",
      url: "/pages/batch/delete",
      headers: bearer(tokenB),
      payload: { ids: [pageB1.id, pageA1.id, "page_missing"] },
    });

    expect(batchDeleteResponse.statusCode, batchDeleteResponse.body).toBe(200);
    expect(batchDeleteResponse.json()).toEqual({
      data: {
        results: [
          { index: 0, id: pageB1.id, action: "deleted" },
          { index: 1, id: pageA1.id, action: "not_found" },
          { index: 2, id: "page_missing", action: "not_found" },
        ],
        meta: { total: 3, deleted: 1, not_found: 2 },
      },
    });

    const ownerPageStillExistsResponse = await app.inject({
      method: "GET",
      url: `/pages/${pageA1.id}`,
      headers: bearer(tokenA),
    });

    expect(ownerPageStillExistsResponse.statusCode, ownerPageStillExistsResponse.body).toBe(200);

    const deletedOwnPageResponse = await app.inject({
      method: "GET",
      url: `/pages/${pageB1.id}`,
      headers: bearer(tokenB),
    });

    expect(deletedOwnPageResponse.statusCode).toBe(404);
  });

  it("isolates message CRUD and batch operations by account", async () => {
    const sessionA = await createSession(tokenA, "Session A");
    const sessionB = await createSession(tokenB, "Session B");

    const floorA = await createFloor({ token: tokenA, sessionId: sessionA, floorNo: 0, branchId: "main" });
    const floorB = await createFloor({ token: tokenB, sessionId: sessionB, floorNo: 0, branchId: "main" });

    const pageA = await createPage({ token: tokenA, floorId: floorA.id, pageNo: 1, pageKind: "mixed" });
    const pageB = await createPage({ token: tokenB, floorId: floorB.id, pageNo: 1, pageKind: "mixed" });

    const messageA1 = await createMessage({ token: tokenA, pageId: pageA.id, seq: 1, role: "user", content: "A1" });
    const messageA2 = await createMessage({ token: tokenA, pageId: pageA.id, seq: 2, role: "assistant", content: "A2" });
    const messageB1 = await createMessage({ token: tokenB, pageId: pageB.id, seq: 1, role: "user", content: "B1" });
    const messageB2 = await createMessage({ token: tokenB, pageId: pageB.id, seq: 2, role: "assistant", content: "B2" });

    const listOwnResponse = await app.inject({
      method: "GET",
      url: "/messages?limit=10&offset=0&sort_by=seq&sort_order=asc",
      headers: bearer(tokenB),
    });

    expect(listOwnResponse.statusCode, listOwnResponse.body).toBe(200);
    expect(listOwnResponse.json<ListResponse<MessageDto>>().data.map((item) => item.id)).toEqual([messageB1.id, messageB2.id]);

    const filteredForeignListResponse = await app.inject({
      method: "GET",
      url: `/messages?page_id=${pageA.id}&limit=10&offset=0&sort_by=seq&sort_order=asc`,
      headers: bearer(tokenB),
    });

    expect(filteredForeignListResponse.statusCode, filteredForeignListResponse.body).toBe(200);
    expect(filteredForeignListResponse.json<ListResponse<MessageDto>>().data).toHaveLength(0);

    const createForeignResponse = await app.inject({
      method: "POST",
      url: "/messages",
      headers: bearer(tokenB),
      payload: { page_id: pageA.id, seq: 3, role: "assistant", content: "foreign" },
    });

    expect(createForeignResponse.statusCode).toBe(404);
    expect(createForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const getForeignResponse = await app.inject({
      method: "GET",
      url: `/messages/${messageA1.id}`,
      headers: bearer(tokenB),
    });

    expect(getForeignResponse.statusCode).toBe(404);
    expect(getForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const patchForeignResponse = await app.inject({
      method: "PATCH",
      url: `/messages/${messageA1.id}`,
      headers: bearer(tokenB),
      payload: { content: "rewritten" },
    });

    expect(patchForeignResponse.statusCode).toBe(404);
    expect(patchForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const deleteForeignResponse = await app.inject({
      method: "DELETE",
      url: `/messages/${messageA1.id}`,
      headers: bearer(tokenB),
    });

    expect(deleteForeignResponse.statusCode).toBe(404);
    expect(deleteForeignResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const batchVisibilityResponse = await app.inject({
      method: "PATCH",
      url: "/messages/batch/visibility",
      headers: bearer(tokenB),
      payload: { ids: [messageB1.id, messageA1.id, "msg_missing"], is_hidden: true },
    });

    expect(batchVisibilityResponse.statusCode, batchVisibilityResponse.body).toBe(200);
    expect(batchVisibilityResponse.json()).toEqual({
      data: {
        results: [
          {
            index: 0,
            id: messageB1.id,
            action: "updated",
            data: expect.objectContaining({ id: messageB1.id, is_hidden: true }),
          },
          { index: 1, id: messageA1.id, action: "not_found" },
          { index: 2, id: "msg_missing", action: "not_found" },
        ],
        meta: { total: 3, updated: 1, not_found: 2, is_hidden: true },
      },
    });

    const ownerMessageStillVisibleResponse = await app.inject({
      method: "GET",
      url: `/messages/${messageA1.id}`,
      headers: bearer(tokenA),
    });

    expect(ownerMessageStillVisibleResponse.statusCode, ownerMessageStillVisibleResponse.body).toBe(200);
    expect(ownerMessageStillVisibleResponse.json<ItemResponse<MessageDto>>().data.is_hidden).toBe(false);

    const batchDeleteResponse = await app.inject({
      method: "POST",
      url: "/messages/batch/delete",
      headers: bearer(tokenB),
      payload: { ids: [messageB2.id, messageA2.id, "msg_missing"] },
    });

    expect(batchDeleteResponse.statusCode, batchDeleteResponse.body).toBe(200);
    expect(batchDeleteResponse.json()).toEqual({
      data: {
        results: [
          { index: 0, id: messageB2.id, action: "deleted" },
          { index: 1, id: messageA2.id, action: "not_found" },
          { index: 2, id: "msg_missing", action: "not_found" },
        ],
        meta: { total: 3, deleted: 1, not_found: 2 },
      },
    });

    const ownerMessageStillExistsResponse = await app.inject({
      method: "GET",
      url: `/messages/${messageA2.id}`,
      headers: bearer(tokenA),
    });

    expect(ownerMessageStillExistsResponse.statusCode, ownerMessageStillExistsResponse.body).toBe(200);

    const deletedOwnMessageResponse = await app.inject({
      method: "GET",
      url: `/messages/${messageB2.id}`,
      headers: bearer(tokenB),
    });

    expect(deletedOwnMessageResponse.statusCode).toBe(404);
  });
});
