import { createEventBus } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, runtimeJobs } from "../../db/schema.js";
import { RuntimeJobCatalog } from "../runtime-job-catalog.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";

const DEFAULT_ACCOUNT_ID = "default-admin";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("RuntimeJobScheduler", () => {
  let database: DatabaseConnection;
  let catalog: RuntimeJobCatalog;
  let scheduler: RuntimeJobScheduler;

  beforeEach(() => {
    database = createDatabase(":memory:");
    catalog = new RuntimeJobCatalog();
    catalog.register({
      jobType: "test.echo",
      payloadSchema: z.object({ value: z.string().min(1) }),
      initialPhase: "queued",
    });
    scheduler = new RuntimeJobScheduler(catalog);
  });

  afterEach(() => {
    database.close();
  });

  it("creates jobs and reuses the existing job id on dedupe conflict", async () => {
    const now = 1_736_000_000_000;
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    const result = database.db.transaction((tx) => {
      const first = scheduler.enqueue(tx, {
        jobType: "test.echo",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:1",
        payload: { value: "hello" },
        dedupeKey: "same-request",
        availableAt: now,
      });
      const second = scheduler.enqueue(tx, {
        jobType: "test.echo",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:1",
        payload: { value: "hello-again" },
        dedupeKey: "same-request",
        availableAt: now + 100,
      });

      return { first, second };
    });

    expect(result.first.created).toBe(true);
    expect(result.second).toEqual({
      jobId: result.first.jobId,
      created: false,
      dedupeKey: "same-request",
    });

    const rows = await database.db.select().from(runtimeJobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.first.jobId,
      jobType: "test.echo",
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      scopeKey: "scope:1",
      status: "pending",
      phase: "queued",
      attemptCount: 0,
      maxAttempts: 5,
      dedupeKey: "same-request",
    });
    expect(JSON.parse(rows[0]!.payloadJson)).toEqual({ value: "hello" });
  });

  it("rejects invalid payloads before writing runtime jobs", async () => {
    const now = 1_736_000_010_000;
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    expect(() => database.db.transaction((tx) => scheduler.enqueue(tx, {
      jobType: "test.echo",
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      scopeKey: "scope:invalid",
      payload: { value: "" },
      availableAt: now,
    }))).toThrow();

    const rows = await database.db.select().from(runtimeJobs);
    expect(rows).toHaveLength(0);
  });

  it("emits runtime.job_enqueued when a new job is inserted", async () => {
    const now = 1_736_000_020_000;
    const eventBus = createEventBus();
    const handler = vi.fn();
    eventBus.on("runtime.job_enqueued", handler);
    const schedulerWithEvents = new RuntimeJobScheduler(catalog, { eventBus });

    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    database.db.transaction((tx) => schedulerWithEvents.enqueue(tx, {
      jobId: "job-with-event",
      jobType: "test.echo",
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      scopeKey: "scope:event",
      payload: { value: "hello" },
      availableAt: now,
    }));

    await flushMicrotasks();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-with-event",
      status: "pending",
      scopeType: "test",
    }));
  });
});
