import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, runtimeJobs, sessions } from "../../db/schema.js";
import { MemoryJobScheduler } from "../memory-job-scheduler.js";
import {
  MEMORY_RUNTIME_SCOPE_TYPE,
  buildMemoryRuntimeScopeKey,
  fromMemoryRuntimeJobType,
  parseMemoryRuntimeScopeKey,
} from "../memory-runtime-job-definitions.js";

const DEFAULT_ACCOUNT_ID = "default-admin";

async function seedAccount(database: DatabaseConnection, accountId: string, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: accountId,
    name: accountId,
    createdAt: now,
    updatedAt: now,
  })
    .onConflictDoNothing()
    .run();
}

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Memory Scheduler Test",
    accountId: DEFAULT_ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedFloor(database: DatabaseConnection, sessionId: string, floorId: string, floorNo: number, now: number): Promise<void> {
  await database.db.insert(floors).values({
    id: floorId,
    sessionId,
    floorNo,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });
}

function toLegacyMemoryJob(row: typeof runtimeJobs.$inferSelect) {
  const scopeRef = parseMemoryRuntimeScopeKey(row.scopeKey);
  return {
    ...row,
    jobType: fromMemoryRuntimeJobType(row.jobType),
    scope: scopeRef.scope,
    scopeId: scopeRef.scopeId,
  };
}

describe("MemoryJobScheduler", () => {
  let database: DatabaseConnection;
  let scheduler: MemoryJobScheduler;

  beforeEach(() => {
    database = createDatabase(":memory:");
    scheduler = new MemoryJobScheduler();
  });

  afterEach(() => {
    database.close();
  });

  it("keeps ingest_turn enqueue idempotent for the same floor", async () => {
    const now = 1_735_800_000_000;
    const sessionId = nanoid();
    const floorId = nanoid();

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, 7, now);

    const result = database.db.transaction((tx) => {
      const first = scheduler.enqueueIngestTurn(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        sessionId,
        floorId,
        floorNo: 7,
        assistantMessageId: nanoid(),
        userInputDigest: "digest-1",
        committedAt: now,
        summaries: ["summary-1"],
        enableConsolidation: true,
      });
      const second = scheduler.enqueueIngestTurn(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        sessionId,
        floorId,
        floorNo: 7,
        assistantMessageId: nanoid(),
        userInputDigest: "digest-2",
        committedAt: now + 100,
        summaries: ["summary-2"],
        enableConsolidation: false,
      });

      return { first, second };
    });

    expect(result.first).toEqual({
      jobId: `memory-job:ingest_turn:${floorId}`,
      created: true,
    });
    expect(result.second).toEqual({
      jobId: `memory-job:ingest_turn:${floorId}`,
      created: false,
    });

    const rows = await database.db.select().from(runtimeJobs).where(and(
      eq(runtimeJobs.scopeType, MEMORY_RUNTIME_SCOPE_TYPE),
      eq(runtimeJobs.scopeKey, buildMemoryRuntimeScopeKey("chat", sessionId)),
    ));
    expect(rows).toHaveLength(1);
    expect(toLegacyMemoryJob(rows[0]!)).toMatchObject({
      id: `memory-job:ingest_turn:${floorId}`,
      floorId,
      status: "pending",
      scope: "chat",
      scopeId: sessionId,
      jobType: "ingest_turn",
    });
    expect(JSON.parse(rows[0]!.payloadJson)).toEqual(expect.objectContaining({
      summaries: ["summary-1"],
      enableConsolidation: true,
    }));
  });

  it("keeps compact_macro enqueue idempotent for the same source window", async () => {
    const now = 1_735_800_100_000;
    const sessionId = nanoid();

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);

    const result = database.db.transaction((tx) => {
      const first = scheduler.enqueueCompactMacro(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        sessionId,
        sourceMicroIds: ["micro-1", "micro-2", "micro-3"],
        coverageStartFloorNo: 1,
        coverageEndFloorNo: 3,
        committedAt: now,
        force: false,
      });
      const second = scheduler.enqueueCompactMacro(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        sessionId,
        sourceMicroIds: ["micro-1", "micro-2", "micro-3"],
        coverageStartFloorNo: 1,
        coverageEndFloorNo: 3,
        committedAt: now + 100,
        force: false,
      });

      return { first, second };
    });

    expect(result.first).toEqual({
      jobId: `memory-job:compact_macro:${sessionId}:micro-3`,
      created: true,
    });
    expect(result.second).toEqual({
      jobId: `memory-job:compact_macro:${sessionId}:micro-3`,
      created: false,
    });

    const rows = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.jobType, "memory.compact_macro"));
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payloadJson)).toEqual(expect.objectContaining({
      sourceMicroIds: ["micro-1", "micro-2", "micro-3"],
      coverageStartFloorNo: 1,
      coverageEndFloorNo: 3,
    }));
  });

  it("keeps maintenance enqueue idempotent within the same schedule bucket", async () => {
    const now = 1_735_800_200_000;
    const sessionId = nanoid();

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);

    const result = database.db.transaction((tx) => {
      const first = scheduler.enqueueMaintenance(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        scheduleBucket: 42,
        scheduledAt: now,
        batchSize: 100,
        dryRun: true,
      });
      const second = scheduler.enqueueMaintenance(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        scheduleBucket: 42,
        scheduledAt: now + 100,
        batchSize: 100,
        dryRun: false,
      });

      return { first, second };
    });

    expect(result.first).toEqual({
      jobId: `memory-job:maintenance:${DEFAULT_ACCOUNT_ID}:chat:${sessionId}:42`,
      created: true,
    });
    expect(result.second).toEqual({
      jobId: `memory-job:maintenance:${DEFAULT_ACCOUNT_ID}:chat:${sessionId}:42`,
      created: false,
    });
  });

  it("does not inject default-admin into malformed maintenance job ids", () => {
    expect(scheduler.createJobId("maintenance", ":chat:session-1:42")).toBe(
      "memory-job:maintenance::chat:session-1:42",
    );
  });

  it("enqueues rebuild_scope jobs with an explicit seed", async () => {
    const now = 1_735_800_300_000;
    const sessionId = nanoid();

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);

    const result = database.db.transaction((tx) => scheduler.enqueueRebuildScope(tx, {
      accountId: DEFAULT_ACCOUNT_ID,
      scope: "chat",
      scopeId: sessionId,
      committedAt: now,
      forceCompaction: true,
      seed: "manual-backfill",
    }));

    expect(result).toEqual({
      jobId: `memory-job:rebuild_scope:chat:${sessionId}:manual-backfill`,
      created: true,
    });
  });
});
