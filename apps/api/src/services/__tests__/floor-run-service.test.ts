import { eq } from "drizzle-orm";
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

  it("重试在已提交楼层上新建的 running run 不会被 getSnapshot 误收尾为 completed", async () => {
    // 模拟重试时序：目标楼层仍是旧的 committed（reopen 到 generating 发生在更晚的 executeTurn 内），
    // 此时先 initializeRun 创建新的 running run。新 run 的 updatedAt 晚于楼层旧的提交时刻，
    // 不应被 stale 收尾逻辑误判为滞后快照。
    const committedAt = Date.now() - 60_000;
    await db.insert(floors).values({
      id: "floor-committed",
      sessionId: "session-1",
      floorNo: 2,
      branchId: "main",
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: committedAt,
      updatedAt: committedAt,
    });

    const initialized = await service.initializeRun({
      sessionId: "session-1",
      floorId: "floor-committed",
      runType: "retry_turn",
    });
    expect(initialized?.status).toBe("running");

    // 直接读 DB（getRunIdentity 不经 reconcile）验证未被误收尾，仍是当前 running attempt。
    const identity = await service.getRunIdentity("floor-committed");
    expect(identity?.status).toBe("running");
    await expect(service.isCurrentAttempt({
      floorId: "floor-committed",
      runId: initialized!.runId,
      attemptNo: 1,
    })).resolves.toBe(true);
  });

  it("getSnapshot 对处于 reopen 前准备阶段的重试 run 不收尾为 completed", async () => {
    // 直接命中 reconcile 守卫：重试在 committed 楼层上新建 run，并推进到 reopen 前的准备阶段
    // （prompt_assembled）。此时即使有外部走 reconcile 的读取（如轮询 active-run），也不应把它
    // 误收尾成 completed，否则随后 commit 的 attempt 并发校验会读到非 running 而抛 attempt_not_current。
    const committedAt = Date.now() - 60_000;
    await db.insert(floors).values({
      id: "floor-retry-prep",
      sessionId: "session-1",
      floorNo: 3,
      branchId: "main",
      state:"committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: committedAt,
      updatedAt: committedAt,
    });

    await service.initializeRun({
      sessionId: "session-1",
      floorId: "floor-retry-prep",
      runType: "retry_step",
    });
    await service.advancePhase("floor-retry-prep", "prompt_assembled");

    // getSnapshot 默认走 reconcile，仍应保持 running（准备阶段的重试不被收尾）。
    const snapshot = await service.getSnapshot("floor-retry-prep");
    expect(snapshot?.status).toBe("running");
    expect(snapshot?.phase).toBe("prompt_assembled");
  });

  it("getSnapshot 对已进入生成阶段却仍显示 committed 的重试 run 仍收尾为 completed", async () => {
    // 一旦重试已进入生成阶段（page_generating），楼层理应已被 reopen 到 generating；
    // 若此时仍是 committed，说明是被取代 / 滞后的旧 attempt，应按 stale 收尾。
    const committedAt = Date.now() - 60_000;
    await db.insert(floors).values({
      id: "floor-retry-gen",
      sessionId: "session-1",
      floorNo: 4,
      branchId: "main",
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: committedAt,
      updatedAt: committedAt,
    });

    await service.initializeRun({
      sessionId: "session-1",
      floorId: "floor-retry-gen",
      runType: "retry_step",
    });
    await service.startAttempt("floor-retry-gen", { attemptNo: 2 });

    const snapshot = await service.getSnapshot("floor-retry-gen");
    expect(snapshot?.status).toBe("completed");
  });

  it("getSnapshot 仍会把滞后于楼层提交的 running run 收尾为 completed", async () => {
    // 回归保护：正常回合 commit 已把楼层置为 committed（提交时刻晚于 run 生成期的活动），
    // 若 markCompleted 未同步，run 快照仍停在 running，此时应被 stale 收尾逻辑补偿为 completed。
    await service.initializeRun({ sessionId: "session-1", floorId: "floor-1", runType: "respond" });
    // 把楼层置为 committed 且提交时刻晚于 run 刚创建的 updatedAt。
    const committedAt = Date.now() + 60_000;
    await db
      .update(floors)
      .set({ state: "committed", updatedAt: committedAt })
      .where(eq(floors.id, "floor-1"))
      .run();

    const snapshot = await service.getSnapshot("floor-1");
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.completedAt).toEqual(expect.any(Number));
  });
});
