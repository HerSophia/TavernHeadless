import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { createDatabase, type AppDb } from "../../db/client";
import { floors, sessions } from "../../db/schema";
import { DrizzleFloorRepository } from "../drizzle-floor-repository";

describe("DrizzleFloorRepository", () => {
  let db: AppDb;
  let repo: DrizzleFloorRepository;
  let closeDb: () => void;

  // 预置 session（floor 有外键依赖）
  const sessionId = "test-session-1";

  beforeEach(async () => {
    const conn = createDatabase(":memory:");
    db = conn.db;
    closeDb = conn.close;
    repo = new DrizzleFloorRepository(db);

    // 插入依赖的 session
    const now = Date.now();
    await db.insert(sessions).values({
      id: sessionId,
      title: "Test Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  // ── helpers ─────────────────────────────────────────

  async function insertFloor(overrides: Partial<typeof floors.$inferInsert> = {}) {
    const now = Date.now();
    const defaults = {
      id: nanoid(),
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "draft" as const,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    };
    const values = { ...defaults, ...overrides };
    await db.insert(floors).values(values);
    return values;
  }

  // ── findById ────────────────────────────────────────

  it("returns null for non-existent id", async () => {
    const result = await repo.findById("non-existent");
    expect(result).toBeNull();
  });

  it("returns FloorEntity for existing floor", async () => {
    const inserted = await insertFloor({ id: "floor-1", floorNo: 3 });
    const result = await repo.findById("floor-1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("floor-1");
    expect(result!.sessionId).toBe(sessionId);
    expect(result!.floorNo).toBe(3);
    expect(result!.branchId).toBe("main");
    expect(result!.parentFloorId).toBeNull();
    expect(result!.state).toBe("draft");
    expect(result!.tokenIn).toBe(0);
    expect(result!.tokenOut).toBe(0);
    expect(result!.createdAt).toBe(inserted.createdAt);
    expect(result!.updatedAt).toBe(inserted.updatedAt);
  });

  it("maps parentFloorId correctly when set", async () => {
    const parent = await insertFloor({ id: "parent-1", floorNo: 1 });
    await insertFloor({ id: "child-1", floorNo: 2, parentFloorId: "parent-1" });

    const result = await repo.findById("child-1");
    expect(result!.parentFloorId).toBe("parent-1");
  });

  // ── updateState ─────────────────────────────────────

  it("returns null when updating non-existent floor", async () => {
    const result = await repo.updateState("non-existent", "generating", Date.now());
    expect(result).toBeNull();
  });

  it("updates state and updatedAt", async () => {
    await insertFloor({ id: "floor-2", state: "draft" as const });
    const newTimestamp = Date.now() + 1000;

    const result = await repo.updateState("floor-2", "generating", newTimestamp);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("floor-2");
    expect(result!.state).toBe("generating");
    expect(result!.updatedAt).toBe(newTimestamp);
  });

  it("preserves other fields when updating state", async () => {
    await insertFloor({
      id: "floor-3",
      floorNo: 5,
      tokenIn: 100,
      tokenOut: 200,
      state: "draft" as const,
    });

    const result = await repo.updateState("floor-3", "committed", Date.now() + 2000);

    expect(result!.floorNo).toBe(5);
    expect(result!.tokenIn).toBe(100);
    expect(result!.tokenOut).toBe(200);
    expect(result!.state).toBe("committed");
  });

  it("can transition through all states", async () => {
    await insertFloor({ id: "floor-4", state: "draft" as const });

    let result = await repo.updateState("floor-4", "generating", Date.now());
    expect(result!.state).toBe("generating");

    result = await repo.updateState("floor-4", "committed", Date.now());
    expect(result!.state).toBe("committed");
  });

  it("can set state to failed", async () => {
    await insertFloor({ id: "floor-5", state: "generating" as const });

    const result = await repo.updateState("floor-5", "failed", Date.now());
    expect(result!.state).toBe("failed");
  });
});
