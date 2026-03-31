import { createEventBus } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, runtimeJobs, runtimeScopeStates } from "../../db/schema.js";
import { RuntimeJobCatalog } from "../runtime-job-catalog.js";
import {
  RuntimeJobInvalidStateError,
  RuntimeJobNotFoundError,
  RuntimeJobQueryService,
} from "../runtime-job-query-service.js";

const DEFAULT_ACCOUNT_ID = "default-admin";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("RuntimeJobQueryService", () => {
  let database: DatabaseConnection;
  let catalog: RuntimeJobCatalog;

  beforeEach(() => {
    database = createDatabase(":memory:");
    catalog = new RuntimeJobCatalog();
    catalog.register({
      jobType: "test.echo",
      payloadSchema: z.object({ value: z.string().min(1) }),
      initialPhase: "queued",
    });
  });

  afterEach(() => {
    database.close();
  });

  it("lists runtime jobs, reads detail, and parses scope metadata", async () => {
    const now = 1_736_100_000_000;
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    await database.db.insert(runtimeJobs).values([
      {
        id: "job-1",
        jobType: "test.echo",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:1",
        sessionId: null,
        floorId: null,
        pageId: null,
        status: "pending",
        phase: "queued",
        payloadJson: JSON.stringify({ value: "hello" }),
        stateJson: JSON.stringify({ prepared: true }),
        resultJson: null,
        attemptCount: 0,
        maxAttempts: 5,
        availableAt: now,
        startedAt: null,
        finishedAt: null,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: null,
        dedupeKey: "dedupe-1",
        progressCurrent: 0,
        progressTotal: 2,
        progressMessage: "queued",
        lastError: null,
        lastErrorCode: null,
        lastErrorClass: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "job-2",
        jobType: "test.echo",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:2",
        sessionId: null,
        floorId: null,
        pageId: null,
        status: "dead_letter",
        phase: "failed",
        payloadJson: JSON.stringify({ value: "world" }),
        stateJson: JSON.stringify({ attempts: 5 }),
        resultJson: JSON.stringify({ ok: false }),
        attemptCount: 5,
        maxAttempts: 5,
        availableAt: now + 100,
        startedAt: now + 10,
        finishedAt: now + 20,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: 2,
        dedupeKey: null,
        progressCurrent: 2,
        progressTotal: 2,
        progressMessage: "failed",
        lastError: "boom",
        lastErrorCode: "E_FAIL",
        lastErrorClass: "RuntimeJobFatalError",
        createdAt: now + 1,
        updatedAt: now + 20,
      },
    ]);

    await database.db.insert(runtimeScopeStates).values({
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      scopeKey: "scope:1",
      revision: 3,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: now + 30,
      lastSuccessJobId: "job-1",
      metadataJson: JSON.stringify({ lastValue: "hello" }),
      updatedAt: now + 30,
    });

    const service = new RuntimeJobQueryService(database.db, { catalog });
    const listResult = await service.list({
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      sortBy: "created_at",
      sortOrder: "asc",
    });

    expect(listResult.total).toBe(2);
    expect(listResult.jobs.map((job) => job.id)).toEqual(["job-1", "job-2"]);
    expect(listResult.jobs[0]).toMatchObject({
      payload: { value: "hello" },
      state: { prepared: true },
      result: null,
      dedupeKey: "dedupe-1",
    });

    await expect(service.get({ accountId: DEFAULT_ACCOUNT_ID, jobId: "job-2" })).resolves.toMatchObject({
      id: "job-2",
      result: { ok: false },
      lastErrorCode: "E_FAIL",
      lastErrorClass: "RuntimeJobFatalError",
    });

    const scopeResult = await service.listScopes({
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
    });
    expect(scopeResult.total).toBe(1);
    expect(scopeResult.scopes[0]).toEqual(expect.objectContaining({
      scopeKey: "scope:1",
      metadata: { lastValue: "hello" },
    }));
  });

  it("cancels pending jobs and retries terminal jobs while emitting runtime events", async () => {
    const now = 1_736_100_010_000;
    const eventBus = createEventBus();
    const cancelledHandler = vi.fn();
    const retryHandler = vi.fn();
    eventBus.on("runtime.job_cancelled", cancelledHandler);
    eventBus.on("runtime.job_retry_scheduled", retryHandler);

    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    await database.db.insert(runtimeJobs).values([
      {
        id: "job-pending",
        jobType: "test.echo",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:pending",
        sessionId: null,
        floorId: null,
        pageId: null,
        status: "pending",
        phase: "queued",
        payloadJson: JSON.stringify({ value: "cancel me" }),
        stateJson: null,
        resultJson: null,
        attemptCount: 0,
        maxAttempts: 5,
        availableAt: now,
        startedAt: null,
        finishedAt: null,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: null,
        dedupeKey: null,
        progressCurrent: 0,
        progressTotal: 2,
        progressMessage: "queued",
        lastError: null,
        lastErrorCode: null,
        lastErrorClass: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "job-dead",
        jobType: "test.echo",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:dead",
        sessionId: null,
        floorId: null,
        pageId: null,
        status: "dead_letter",
        phase: "failed",
        payloadJson: JSON.stringify({ value: "retry me" }),
        stateJson: JSON.stringify({ step: "failed" }),
        resultJson: null,
        attemptCount: 5,
        maxAttempts: 5,
        availableAt: now,
        startedAt: now - 5,
        finishedAt: now - 1,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: 7,
        dedupeKey: null,
        progressCurrent: 2,
        progressTotal: 2,
        progressMessage: "failed",
        lastError: "boom",
        lastErrorCode: "E_FAIL",
        lastErrorClass: "RuntimeJobFatalError",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const service = new RuntimeJobQueryService(database.db, { catalog, eventBus });

    await expect(service.cancel({ accountId: DEFAULT_ACCOUNT_ID, jobId: "job-pending" })).resolves.toMatchObject({
      previousStatus: "pending",
      job: expect.objectContaining({
        id: "job-pending",
        status: "cancelled",
      }),
    });

    await expect(service.retry({ accountId: DEFAULT_ACCOUNT_ID, jobId: "job-dead" })).resolves.toMatchObject({
      previousStatus: "dead_letter",
      job: expect.objectContaining({
        id: "job-dead",
        status: "retry_waiting",
        phase: "queued",
        progressCurrent: 0,
        progressMessage: "queued",
        startedAt: null,
        basedOnRevision: null,
      }),
    });

    await flushMicrotasks();
    expect(cancelledHandler).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-pending",
      status: "cancelled",
    }));
    expect(retryHandler).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-dead",
      status: "retry_waiting",
      retryAt: expect.any(Number),
    }));
  });

  it("rejects unsupported state transitions and missing jobs", async () => {
    const now = 1_736_100_020_000;
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    await database.db.insert(runtimeJobs).values({
      id: "job-running",
      jobType: "test.echo",
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      scopeKey: "scope:running",
      sessionId: null,
      floorId: null,
      pageId: null,
      status: "running",
      phase: "working",
      payloadJson: JSON.stringify({ value: "active" }),
      stateJson: null,
      resultJson: null,
      attemptCount: 1,
      maxAttempts: 5,
      availableAt: now,
      startedAt: now,
      finishedAt: null,
      leaseOwner: "worker-1",
      leaseUntil: now + 1_000,
      basedOnRevision: 1,
      dedupeKey: null,
      progressCurrent: 1,
      progressTotal: 2,
      progressMessage: "working",
      lastError: null,
      lastErrorCode: null,
      lastErrorClass: null,
      createdAt: now,
      updatedAt: now,
    });

    const service = new RuntimeJobQueryService(database.db, { catalog });

    await expect(service.cancel({ accountId: DEFAULT_ACCOUNT_ID, jobId: "job-running" })).rejects.toBeInstanceOf(RuntimeJobInvalidStateError);
    await expect(service.retry({ accountId: DEFAULT_ACCOUNT_ID, jobId: "missing-job" })).rejects.toBeInstanceOf(RuntimeJobNotFoundError);
  });
});
