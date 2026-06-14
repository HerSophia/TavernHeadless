import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type AppDb, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, sessions } from "../../db/schema.js";
import { FloorRunService } from "../floor-run-service.js";

describe("FloorRunService R2 attempt helpers", () => {
  let database: DatabaseConnection;
  let db: AppDb;
  let service: FloorRunService;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    db = database.db;
    service = new FloorRunService(db);

    const now = Date.now();
    await db.insert(accounts).values({
      id: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "Default Admin",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    await db.insert(sessions).values({
      id: "session-1",
      title: "Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(floors).values({
      id: "floor-1",
      sessionId: "session-1",
      floorNo: 1,
      branchId: "main",
      state: "generating",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("markCancelled 写入 cancelled run snapshot", async () => {
    await service.initializeRun({ sessionId: "session-1", floorId: "floor-1", runType: "respond" });

    const snapshot = await service.markCancelled("floor-1", {
      code: "user_cancelled",
      message: "用户取消生成",
    });

    expect(snapshot?.status).toBe("cancelled");
    expect(snapshot?.error).toEqual({
      code: "user_cancelled",
      message: "用户取消生成",
    });
    expect(snapshot?.completedAt).toEqual(expect.any(Number));
  });

  it("getRunIdentity 返回当前 runId 与 attemptNo", async () => {
    const initialized = await service.initializeRun({ sessionId: "session-1", floorId: "floor-1", runType: "retry_turn" });

    const identity = await service.getRunIdentity("floor-1");

    expect(identity).toEqual({
      floorId: "floor-1",
      runId: initialized?.runId,
      runType: "retry_turn",
      attemptNo: 1,
      status: "running",
    });
  });

  it("startAttempt 会切换当前 attempt，并让旧 attempt 失效", async () => {
    const initialized = await service.initializeRun({ sessionId: "session-1", floorId: "floor-1", runType: "retry_turn" });
    expect(initialized).not.toBeNull();

    const next = await service.startAttempt("floor-1", { attemptNo: 2 });

    expect(next?.attemptNo).toBe(2);
    expect(next?.phase).toBe("page_generating");
    await expect(service.isCurrentAttempt({
      floorId: "floor-1",
      runId: initialized!.runId,
      attemptNo: 1,
    })).resolves.toBe(false);
    await expect(service.isCurrentAttempt({
      floorId: "floor-1",
      runId: initialized!.runId,
      attemptNo: 2,
    })).resolves.toBe(true);
  });
});
