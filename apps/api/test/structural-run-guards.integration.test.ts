import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../src/db/client.js";
import { accounts, floorRunStates, floors, sessions } from "../src/db/schema.js";
import { registerFloorRoutes } from "../src/routes/floors.js";
import { registerSessionRoutes } from "../src/routes/sessions.js";
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth.js";

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type BatchDeleteResponse = {
  data: {
    results: Array<{ index: number; id: string; action: string }>;
    meta: {
      total: number;
      deleted: number;
      not_found: number;
      conflicts: number;
    };
  };
};

describe("structural run guards", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    app = Fastify({ logger: false });
    await registerDevelopmentTestAuth(app, database.db);
    await registerSessionRoutes(app, database);
    await registerFloorRoutes(app, database);

    const now = 1_763_600_000_000;
    await database.db
      .insert(accounts)
      .values({
        id: DEFAULT_ADMIN_ACCOUNT_ID,
        name: "Default Admin",
        role: "admin",
        status: "active",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  async function seedSession(sessionId: string, title = "Session"): Promise<void> {
    const now = Date.now();
    await database.db.insert(sessions).values({
      id: sessionId,
      title,
      status: "active",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function seedFloor(args: {
    floorId: string;
    sessionId: string;
    branchId?: string;
    floorNo?: number;
    state?: "draft" | "generating" | "committed" | "failed";
  }): Promise<void> {
    const now = Date.now();
    await database.db.insert(floors).values({
      id: args.floorId,
      sessionId: args.sessionId,
      floorNo: args.floorNo ?? 0,
      branchId: args.branchId ?? "main",
      parentFloorId: null,
      state: args.state ?? "generating",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function seedRunningRun(floorId: string, runType: "respond" | "regenerate_page" | "retry_turn" | "edit_and_regenerate" = "respond"): Promise<void> {
    const now = Date.now();
    await database.db.insert(floorRunStates).values({
      floorId,
      runId: `run-${floorId}`,
      runType,
      status: "running",
      phase: "page_generating",
      publicPhase: "generating",
      phaseSeq: 1,
      attemptNo: 1,
      pendingOutputJson: null,
      verifierJson: null,
      errorJson: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    });
  }

  it("DELETE /sessions/:id rejects sessions with active runs", async () => {
    await seedSession("session-running", "Running Session");
    await seedFloor({ floorId: "floor-running", sessionId: "session-running", state: "generating" });
    await seedRunningRun("floor-running");

    const response = await app.inject({
      method: "DELETE",
      url: "/sessions/session-running",
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<ErrorResponse>().error.code).toBe("active_run_in_progress");

    const [sessionRow] = await database.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, "session-running"));
    expect(sessionRow?.id).toBe("session-running");
  });

  it("POST /sessions/batch/delete marks active sessions as conflict", async () => {
    await seedSession("session-running", "Running Session");
    await seedSession("session-idle", "Idle Session");
    await seedFloor({ floorId: "floor-running", sessionId: "session-running", state: "generating" });
    await seedRunningRun("floor-running");

    const response = await app.inject({
      method: "POST",
      url: "/sessions/batch/delete",
      payload: { ids: ["session-running", "session-idle", "missing-session"] },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<BatchDeleteResponse>()).toEqual({
      data: {
        results: [
          { index: 0, id: "session-running", action: "conflict" },
          { index: 1, id: "session-idle", action: "deleted" },
          { index: 2, id: "missing-session", action: "not_found" },
        ],
        meta: {
          total: 3,
          deleted: 1,
          not_found: 1,
          conflicts: 1,
        },
      },
    });

    const remainingSessions = await database.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.accountId, DEFAULT_ADMIN_ACCOUNT_ID));
    expect(remainingSessions.map((row) => row.id)).toEqual(["session-running"]);
  });

  it("PATCH /floors/:id and DELETE /floors/:id reject floors with active runs", async () => {
    await seedSession("session-1");
    await seedFloor({ floorId: "floor-1", sessionId: "session-1", floorNo: 2, state: "generating" });
    await seedRunningRun("floor-1", "retry_turn");

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/floors/floor-1",
      payload: { floor_no: 3 },
    });

    expect(patchResponse.statusCode, patchResponse.body).toBe(409);
    expect(patchResponse.json<ErrorResponse>().error.code).toBe("active_run_in_progress");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/floors/floor-1",
    });

    expect(deleteResponse.statusCode, deleteResponse.body).toBe(409);
    expect(deleteResponse.json<ErrorResponse>().error.code).toBe("active_run_in_progress");

    const [floorRow] = await database.db.select().from(floors).where(eq(floors.id, "floor-1"));
    expect(floorRow?.floorNo).toBe(2);
  });

  it("DELETE /branches/:id rejects branches with active runs", async () => {
    await seedSession("session-1");
    await seedFloor({ floorId: "floor-branch", sessionId: "session-1", floorNo: 1, branchId: "alt", state: "generating" });
    await seedRunningRun("floor-branch", "edit_and_regenerate");

    const response = await app.inject({
      method: "DELETE",
      url: "/branches/alt?session_id=session-1",
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<ErrorResponse>().error.code).toBe("active_run_in_progress");

    const [floorRow] = await database.db.select({ id: floors.id }).from(floors).where(eq(floors.id, "floor-branch"));
    expect(floorRow?.id).toBe("floor-branch");
  });
});
