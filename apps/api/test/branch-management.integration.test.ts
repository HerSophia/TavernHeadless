import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type ItemResponse<T> = { data: T };

describe("branch management routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function createSession(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "branch test" },
    });

    expect(response.statusCode).toBe(201);
    return (response.json() as ItemResponse<{ id: string }>).data.id;
  }

  async function createFloor(args: {
    sessionId: string;
    floorNo: number;
    branchId: string;
    state?: "draft" | "generating" | "committed" | "failed";
    parentFloorId?: string;
  }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: args.sessionId,
        floor_no: args.floorNo,
        branch_id: args.branchId,
        state: args.state ?? "committed",
        ...(args.parentFloorId ? { parent_floor_id: args.parentFloorId } : {}),
      },
    });

    expect(response.statusCode).toBe(201);
    return (response.json() as ItemResponse<{ id: string }>).data.id;
  }

  it("lists the default main branch even before any floor is created", async () => {
    const sessionId = await createSession();

    const response = await app.inject({ method: "GET", url: `/sessions/${sessionId}/branches` });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: Array<{
        branch_id: string;
        floor_count: number;
        latest_floor_no: number | null;
        latest_floor_id: string | null;
        latest_state: string | null;
      }>;
    };

    expect(body.data).toEqual([
      { branch_id: "main", floor_count: 0, latest_floor_no: null, latest_floor_id: null, latest_state: null, updated_at: expect.any(Number) },
    ]);
  });

  it("lists branches for a session", async () => {
    const sessionId = await createSession();

    await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    await createFloor({ sessionId, floorNo: 1, branchId: "main" });
    await createFloor({ sessionId, floorNo: 1, branchId: "alt" });

    const response = await app.inject({ method: "GET", url: `/sessions/${sessionId}/branches` });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: Array<{ branch_id: string; floor_count: number; latest_floor_no: number | null }>;
    };

    const main = body.data.find((row) => row.branch_id === "main");
    const alt = body.data.find((row) => row.branch_id === "alt");

    expect(main).toBeDefined();
    expect(main?.floor_count).toBe(2);
    expect(alt).toBeDefined();
    expect(alt?.latest_floor_no).toBe(1);
  });

  it("returns branch diff against main", async () => {
    const sessionId = await createSession();

    // 通过真实 parent_floor_id 链构造 ancestry：
    //   main: f0 → f1
    //   alt:  f0 → alt_f1 → alt_f2
    // 两支在 f0 处分叉，diff 的 fork 应落在 f0（floor_no=0）。
    const mainF0 = await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    await createFloor({ sessionId, floorNo: 1, branchId: "main", parentFloorId: mainF0 });
    const altF1 = await createFloor({
      sessionId,
      floorNo: 1,
      branchId: "alt",
      parentFloorId: mainF0,
    });
    await createFloor({ sessionId, floorNo: 2, branchId: "alt", parentFloorId: altF1 });

    const response = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/branches/diff?target_branch_id=alt`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: {
        base_branch_id: string;
        target_branch_id: string;
        fork_floor_no: number | null;
        shared_floor_nos: number[];
      };
    };

    expect(body.data.base_branch_id).toBe("main");
    expect(body.data.target_branch_id).toBe("alt");
    // ancestry-based diff：两支在 f0 处是真实共同祖先。
    expect(body.data.fork_floor_no).toBe(0);
    expect(body.data.shared_floor_nos).toEqual([0]);
  });

  it("deletes a non-main branch", async () => {
    const sessionId = await createSession();

    await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    await createFloor({ sessionId, floorNo: 1, branchId: "alt" });
    await createFloor({ sessionId, floorNo: 2, branchId: "alt" });

    const response = await app.inject({
      method: "DELETE",
      url: `/branches/alt?session_id=${sessionId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        branch_id: "alt",
        session_id: sessionId,
        deleted_floor_count: 2,
      },
    });

    const floorListResponse = await app.inject({
      method: "GET",
      url: `/floors?session_id=${sessionId}&branch_id=alt`,
    });
    expect(floorListResponse.statusCode).toBe(200);
    expect((floorListResponse.json() as { data: unknown[] }).data).toHaveLength(0);
  });
});
