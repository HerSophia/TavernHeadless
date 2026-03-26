import { beforeEach, describe, expect, it } from "vitest";

import type { AppDb } from "../../db/client";
import { createDatabase } from "../../db/client";
import { floors, messagePages, sessions } from "../../db/schema";
import { DrizzleToolExecutionRepository } from "../drizzle-tool-execution-repository";
import type { ExecutedToolCallRecord } from "@tavern/core";

describe("DrizzleToolExecutionRepository", () => {
  let db: AppDb;
  let repo: DrizzleToolExecutionRepository;

  const sessionId = "test-session-1";

  beforeEach(async () => {
    const conn = createDatabase(":memory:");
    db = conn.db;
    repo = new DrizzleToolExecutionRepository(db);

    const now = Date.now();
    await db.insert(sessions).values({
      id: sessionId,
      title: "Test Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  async function insertFloor(id = "floor-1", floorNo = 1) {
    const now = Date.now();
    await db.insert(floors).values({
      id,
      sessionId,
      floorNo,
      branchId: "main",
      parentFloorId: null,
      state: "draft",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function insertPage(id: string, floorId: string) {
    const now = Date.now();
    await db.insert(messagePages).values({
      id,
      floorId,
      pageNo: 0,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  function makeRecord(id: string, overrides: Partial<ExecutedToolCallRecord> = {}): ExecutedToolCallRecord {
    return {
      id,
      runId: "run-1",
      floorId: "floor-1",
      callerSlot: "narrator",
      pageId: undefined,
      providerId: "builtin",
      toolName: "lookup_memory",
      argsJson: JSON.stringify({ q: id }),
      resultJson: JSON.stringify({ ok: true, id }),
      status: "success",
      errorMessage: undefined,
      durationMs: 12,
      createdAt: Date.now(),
      ...overrides,
    };
  }

  it("persists floor-bound execution records", async () => {
    await insertFloor("floor-1", 1);
    await insertPage("page-1", "floor-1");

    const first = makeRecord("rec-1", { createdAt: 1000 });
    const second = makeRecord("rec-2", {
      pageId: "page-1",
      status: "error",
      errorMessage: "tool boom",
      resultJson: JSON.stringify({ error: true }),
      createdAt: 2000,
    });

    await repo.insertMany([first, second]);
    const found = await repo.findByFloorId("floor-1");

    expect(found).toHaveLength(2);
    expect(found[0]).toEqual(first);
    expect(found[1]).toEqual(second);
  });

  it("finds records by run id", async () => {
    await insertFloor("floor-1", 1);
    await insertFloor("floor-2", 2);

    await repo.insertMany([
      makeRecord("rec-1", { runId: "run-1", floorId: "floor-1", createdAt: 1000 }),
      makeRecord("rec-2", { runId: "run-1", floorId: "floor-2", createdAt: 2000 }),
      makeRecord("rec-3", { runId: "run-2", floorId: "floor-2", createdAt: 3000 }),
    ]);

    const found = await repo.findByRunId("run-1");

    expect(found).toHaveLength(2);
    expect(found.map((item) => item.id)).toEqual(["rec-1", "rec-2"]);
  });
});
