import { beforeEach, describe, expect, it } from "vitest";

import type { AppDb } from "../../db/client";
import { createDatabase } from "../../db/client";
import { floors, messagePages, sessions } from "../../db/schema";
import { DrizzleToolExecutionRepository } from "../drizzle-tool-execution-repository";
import type { ExecutedToolCallRecord, ToolExecutionOpenRecord } from "@tavern/core";

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
      providerType: "builtin",
      toolName: "lookup_memory",
      argsJson: JSON.stringify({ q: id }),
      resultJson: JSON.stringify({ ok: true, id }),
      status: "success",
      lifecycleState: "finished",
      commitOutcome: "pending",
      sideEffectLevel: "none",
      errorMessage: undefined,
      durationMs: 12,
      startedAt: 1_000,
      finishedAt: 1_012,
      attemptNo: 1,
      replayParentExecutionId: undefined,
      createdAt: 1_000,
      ...overrides,
    };
  }

  it("persists floor-bound execution records", async () => {
    await insertFloor("floor-1", 1);
    await insertPage("page-1", "floor-1");

    const first = makeRecord("rec-1", { createdAt: 1_000, startedAt: 1_000, finishedAt: 1_010 });
    const second = makeRecord("rec-2", {
      pageId: "page-1",
      status: "error",
      errorMessage: "tool boom",
      resultJson: JSON.stringify({ error: true }),
      createdAt: 2_000,
      startedAt: 2_000,
      finishedAt: 2_025,
      durationMs: 25,
    });

    await repo.insertMany([first, second]);
    const found = await repo.findByFloorId("floor-1");

    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject(first);
    expect(found[1]).toMatchObject(second);
  });

  it("opens, finishes, and commits a journaled execution attempt", async () => {
    await insertFloor("floor-1", 1);
    await insertPage("page-1", "floor-1");

    const opened: ToolExecutionOpenRecord = {
      id: "open-1",
      runId: "run-open",
      floorId: "floor-1",
      pageId: "page-1",
      callerSlot: "narrator",
      providerId: "builtin",
      providerType: "builtin",
      toolName: "lookup_memory",
      argsJson: JSON.stringify({ q: "hero" }),
      sideEffectLevel: "none",
      startedAt: 10_000,
      createdAt: 10_000,
      attemptNo: 1,
    };

    await repo.open(opened);

    let pending = (await repo.findByRunId("run-open"))[0]!;
    expect(pending).toMatchObject({
      id: "open-1",
      runId: "run-open",
      pageId: "page-1",
      status: "running",
      lifecycleState: "opened",
      commitOutcome: "pending",
      providerType: "builtin",
      startedAt: 10_000,
      finishedAt: undefined,
      attemptNo: 1,
    });
    expect(pending.resultJson).toBe("null");

    await repo.finish("open-1", {
      resultJson: JSON.stringify({ ok: true }),
      status: "success",
      durationMs: 18,
      finishedAt: 10_018,
    });
    await repo.markRunCommitOutcome("run-open", "committed");

    pending = (await repo.findByRunId("run-open"))[0]!;
    expect(pending).toMatchObject({
      id: "open-1",
      status: "success",
      lifecycleState: "finished",
      commitOutcome: "committed",
      durationMs: 18,
      startedAt: 10_000,
      finishedAt: 10_018,
    });
  });

  it("finds records by run id", async () => {
    await insertFloor("floor-1", 1);
    await insertFloor("floor-2", 2);

    await repo.insertMany([
      makeRecord("rec-1", { runId: "run-1", floorId: "floor-1", createdAt: 1_000, startedAt: 1_000 }),
      makeRecord("rec-2", { runId: "run-1", floorId: "floor-2", createdAt: 2_000, startedAt: 2_000 }),
      makeRecord("rec-3", { runId: "run-2", floorId: "floor-2", createdAt: 3_000, startedAt: 3_000 }),
    ]);

    const found = await repo.findByRunId("run-1");

    expect(found).toHaveLength(2);
    expect(found.map((item) => item.id)).toEqual(["rec-1", "rec-2"]);
  });

  it("queries execution journal by session-facing filters", async () => {
    await insertFloor("floor-1", 1);
    await insertFloor("floor-2", 2);

    await repo.insertMany([
      makeRecord("rec-1", {
        floorId: "floor-1",
        runId: "run-query-1",
        status: "uncertain",
        commitOutcome: "discarded",
        providerType: "mcp",
        sideEffectLevel: "irreversible",
        createdAt: 1_000,
        startedAt: 1_000,
        finishedAt: 1_050,
      }),
      makeRecord("rec-2", {
        floorId: "floor-1",
        runId: "run-query-1",
        status: "denied",
        commitOutcome: "committed",
        providerType: "builtin",
        createdAt: 2_000,
        startedAt: 2_000,
        finishedAt: 2_000,
      }),
      makeRecord("rec-3", {
        floorId: "floor-2",
        runId: "run-query-2",
        status: "blocked",
        lifecycleState: "finished",
        commitOutcome: "discarded",
        providerType: "preset",
        createdAt: 3_000,
        startedAt: 3_000,
        finishedAt: 3_001,
      }),
    ]);

    const queried = await repo.query({
      sessionId,
      status: "uncertain",
      commitOutcome: "discarded",
      providerType: "mcp",
      sortBy: "started_at",
      sortOrder: "desc",
    });

    expect(queried.total).toBe(1);
    expect(queried.records).toEqual([
      expect.objectContaining({
        id: "rec-1",
        floorId: "floor-1",
        status: "uncertain",
        commitOutcome: "discarded",
        providerType: "mcp",
      }),
    ]);

    const floorScoped = await repo.query({
      floorId: "floor-1",
      sortBy: "started_at",
      sortOrder: "desc",
    });
    expect(floorScoped.records.map((record) => record.id)).toEqual(["rec-2", "rec-1"]);
  });
});
