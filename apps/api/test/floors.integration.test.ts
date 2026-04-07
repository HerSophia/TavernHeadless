import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type ItemResponse<T> = { data: T };

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type FloorState = "draft" | "generating" | "committed" | "failed";

type FloorDto = {
  id: string;
  session_id: string;
  floor_no: number;
  branch_id: string;
  parent_floor_id: string | null;
  state: FloorState;
  token_in: number;
  token_out: number;
  created_at: number;
  updated_at: number;
};

type ListResponse<T> = {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    sort_by: string;
    sort_order: "asc" | "desc";
    has_more: boolean;
  };
};

describe("floor routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function createSession(title = "Floor Session"): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createFloor(args: {
    sessionId: string;
    floorNo: number;
    branchId: string;
    parentFloorId?: string;
    state?: FloorState;
    tokenIn?: number;
    tokenOut?: number;
  }): Promise<FloorDto> {
    const payload = {
      session_id: args.sessionId,
      floor_no: args.floorNo,
      branch_id: args.branchId,
      ...(args.parentFloorId !== undefined ? { parent_floor_id: args.parentFloorId } : {}),
      ...(args.state !== undefined ? { state: args.state } : {}),
      ...(args.tokenIn !== undefined ? { token_in: args.tokenIn } : {}),
      ...(args.tokenOut !== undefined ? { token_out: args.tokenOut } : {}),
    };

    const response = await app.inject({
      method: "POST",
      url: "/floors",
      payload,
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<FloorDto>>().data;
  }

  it("lists floors with and without filters", async () => {
    const sessionA = await createSession("Session A");
    const sessionB = await createSession("Session B");

    await createFloor({ sessionId: sessionA, floorNo: 0, branchId: "main", state: "committed" });
    const failedAlt = await createFloor({ sessionId: sessionA, floorNo: 1, branchId: "alt", state: "failed" });
    await createFloor({ sessionId: sessionB, floorNo: 0, branchId: "main", state: "draft" });

    const allResponse = await app.inject({
      method: "GET",
      url: "/floors?sort_by=updated_at&sort_order=desc",
    });

    expect(allResponse.statusCode).toBe(200);
    const allBody = allResponse.json<ListResponse<FloorDto>>();
    expect(allBody.data).toHaveLength(3);
    expect(allBody.meta.total).toBe(3);
    expect(allBody.meta.sort_by).toBe("updated_at");

    const filteredResponse = await app.inject({
      method: "GET",
      url: `/floors?session_id=${sessionA}&branch_id=alt&state=failed&sort_by=created_at&sort_order=asc`,
    });

    expect(filteredResponse.statusCode).toBe(200);
    const filteredBody = filteredResponse.json<ListResponse<FloorDto>>();
    expect(filteredBody.meta.total).toBe(1);
    expect(filteredBody.data).toEqual([
      expect.objectContaining({
        id: failedAlt.id,
        session_id: sessionA,
        branch_id: "alt",
        state: "failed",
      }),
    ]);
  });

  it("gets a floor and returns 404 when it is missing", async () => {
    const sessionId = await createSession();
    const floor = await createFloor({ sessionId, floorNo: 0, branchId: "main", state: "committed" });

    const getResponse = await app.inject({
      method: "GET",
      url: `/floors/${floor.id}`,
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json<ItemResponse<FloorDto>>().data).toEqual(expect.objectContaining({
      id: floor.id,
      session_id: sessionId,
      branch_id: "main",
      floor_no: 0,
      state: "committed",
    }));

    const missingResponse = await app.inject({
      method: "GET",
      url: "/floors/missing-floor",
    });

    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("patches floor fields and reports invalid or missing updates", async () => {
    const sessionId = await createSession();
    const parent = await createFloor({ sessionId, floorNo: 0, branchId: "main", state: "committed" });
    const floor = await createFloor({ sessionId, floorNo: 1, branchId: "alt", state: "draft" });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/floors/${floor.id}`,
      payload: {
        floor_no: 2,
        branch_id: "fork-1",
        parent_floor_id: parent.id,
        state: "failed",
        token_in: 11,
        token_out: 22,
      },
    });

    expect(patchResponse.statusCode, patchResponse.body).toBe(200);
    expect(patchResponse.json<ItemResponse<FloorDto>>().data).toEqual(expect.objectContaining({
      id: floor.id,
      session_id: sessionId,
      floor_no: 2,
      branch_id: "fork-1",
      parent_floor_id: parent.id,
      state: "failed",
      token_in: 11,
      token_out: 22,
    }));

    const invalidResponse = await app.inject({
      method: "PATCH",
      url: `/floors/${floor.id}`,
      payload: {},
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const missingResponse = await app.inject({
      method: "PATCH",
      url: "/floors/missing-floor",
      payload: { state: "draft" },
    });

    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("rejects cross-session parent floors on create and update", async () => {
    const sessionA = await createSession("Session A");
    const sessionB = await createSession("Session B");
    const parentInA = await createFloor({ sessionId: sessionA, floorNo: 0, branchId: "main", state: "committed" });
    const floorInB = await createFloor({ sessionId: sessionB, floorNo: 0, branchId: "main", state: "draft" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: sessionB,
        floor_no: 1,
        branch_id: "main",
        parent_floor_id: parentInA.id,
      },
    });

    expect(createResponse.statusCode, createResponse.body).toBe(409);
    expect(createResponse.json<ErrorResponse>().error.code).toBe("floor_parent_session_mismatch");

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/floors/${floorInB.id}`,
      payload: {
        parent_floor_id: parentInA.id,
      },
    });

    expect(patchResponse.statusCode, patchResponse.body).toBe(409);
    expect(patchResponse.json<ErrorResponse>().error.code).toBe("floor_parent_session_mismatch");

    const getResponse = await app.inject({
      method: "GET",
      url: `/floors/${floorInB.id}`,
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json<ItemResponse<FloorDto>>().data.parent_floor_id).toBeNull();
  });

  it("deletes floors and returns 404 for a missing floor", async () => {
    const sessionId = await createSession();
    const floor = await createFloor({ sessionId, floorNo: 0, branchId: "main", state: "committed" });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/floors/${floor.id}`,
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({
      data: {
        id: floor.id,
        deleted: true,
      },
    });

    const missingResponse = await app.inject({
      method: "DELETE",
      url: `/floors/${floor.id}`,
    });

    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("prepares branches and validates source floor state and conflicts", async () => {
    const sessionId = await createSession();
    const sourceFloor = await createFloor({ sessionId, floorNo: 0, branchId: "main", state: "committed" });

    const autoBranchResponse = await app.inject({
      method: "POST",
      url: `/floors/${sourceFloor.id}/branch`,
    });

    expect(autoBranchResponse.statusCode, autoBranchResponse.body).toBe(201);
    const autoBranchBody = autoBranchResponse.json<ItemResponse<{
      branch_id: string;
      source_floor_id: string;
      source_floor_no: number;
      session_id: string;
    }>>();
    expect(autoBranchBody.data.branch_id).toMatch(/^branch-/);
    expect(autoBranchBody.data.source_floor_id).toBe(sourceFloor.id);
    expect(autoBranchBody.data.source_floor_no).toBe(0);
    expect(autoBranchBody.data.session_id).toBe(sessionId);

    await createFloor({ sessionId, floorNo: 1, branchId: "taken", state: "committed" });
    const conflictResponse = await app.inject({
      method: "POST",
      url: `/floors/${sourceFloor.id}/branch`,
      payload: { branch_id: "taken" },
    });

    expect(conflictResponse.statusCode).toBe(409);
    expect(conflictResponse.json<ErrorResponse>().error.code).toBe("branch_exists");

    const failedFloor = await createFloor({ sessionId, floorNo: 2, branchId: "failed", state: "failed" });
    const invalidStateResponse = await app.inject({
      method: "POST",
      url: `/floors/${failedFloor.id}/branch`,
    });

    expect(invalidStateResponse.statusCode).toBe(409);
    expect(invalidStateResponse.json<ErrorResponse>().error.code).toBe("invalid_state");

    const missingResponse = await app.inject({
      method: "POST",
      url: "/floors/missing-floor/branch",
    });

    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("deletes branches with protected, missing, ambiguous, and scoped cases", async () => {
    const sessionA = await createSession("Session A");
    const sessionB = await createSession("Session B");

    await createFloor({ sessionId: sessionA, floorNo: 0, branchId: "main", state: "committed" });
    await createFloor({ sessionId: sessionA, floorNo: 1, branchId: "alt", state: "committed" });
    await createFloor({ sessionId: sessionB, floorNo: 0, branchId: "main", state: "committed" });
    await createFloor({ sessionId: sessionB, floorNo: 1, branchId: "alt", state: "committed" });

    const protectedResponse = await app.inject({
      method: "DELETE",
      url: `/branches/main?session_id=${sessionA}`,
    });

    expect(protectedResponse.statusCode).toBe(409);
    expect(protectedResponse.json<ErrorResponse>().error.code).toBe("protected_branch");

    const missingResponse = await app.inject({
      method: "DELETE",
      url: `/branches/missing?session_id=${sessionA}`,
    });

    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const ambiguousResponse = await app.inject({
      method: "DELETE",
      url: "/branches/alt",
    });

    expect(ambiguousResponse.statusCode).toBe(409);
    expect(ambiguousResponse.json<ErrorResponse>().error.code).toBe("ambiguous_branch");

    const scopedDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/branches/alt?session_id=${sessionA}`,
    });

    expect(scopedDeleteResponse.statusCode).toBe(200);
    expect(scopedDeleteResponse.json()).toEqual({
      data: {
        branch_id: "alt",
        session_id: sessionA,
        deleted_floor_count: 1,
      },
    });

    const sessionBAltResponse = await app.inject({
      method: "GET",
      url: `/floors?session_id=${sessionB}&branch_id=alt`,
    });

    expect(sessionBAltResponse.statusCode).toBe(200);
    expect(sessionBAltResponse.json<ListResponse<FloorDto>>().data).toHaveLength(1);
  });
});
