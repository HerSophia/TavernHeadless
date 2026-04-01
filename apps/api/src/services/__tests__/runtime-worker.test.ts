import { createEventBus } from "@tavern/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, runtimeJobs, runtimeScopeStates } from "../../db/schema.js";
import { RuntimeJobCatalog } from "../runtime-job-catalog.js";
import { RuntimeJobFatalError } from "../runtime-job-errors.js";
import { RuntimeJobProcessorRegistry } from "../runtime-job-processor-registry.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";
import { RuntimeWorker } from "../runtime-worker.js";
import { parseRuntimeScopeMetadata } from "../runtime-scope-state-repository.js";

const DEFAULT_ACCOUNT_ID = "default-admin";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("RuntimeWorker", () => {
  let database: DatabaseConnection;
  let catalog: RuntimeJobCatalog;
  let scheduler: RuntimeJobScheduler;
  let processors: RuntimeJobProcessorRegistry;

  beforeEach(() => {
    database = createDatabase(":memory:");
    catalog = new RuntimeJobCatalog();
    catalog.register({
      jobType: "test.scope_job",
      payloadSchema: z.object({ value: z.string().min(1) }),
      initialPhase: "queued",
    });
    scheduler = new RuntimeJobScheduler(catalog);
    processors = new RuntimeJobProcessorRegistry();
    processors.register<{ value: string }, { prepared: string }, { value: string }>("test.scope_job", {
      async prepare({ payload, updateProgress }) {
        await updateProgress({
          phase: "preparing",
          progressCurrent: 1,
          progressTotal: 2,
          progressMessage: `prepared:${payload.value}`,
          state: { prepared: payload.value.toUpperCase() },
          stateMode: "merge",
        });
        return { prepared: payload.value.toUpperCase() };
      },
      commit({ prepared }) {
        return {
          phase: "completed",
          result: { value: prepared.prepared },
          progressCurrent: 2,
          progressTotal: 2,
          progressMessage: "completed",
          scopeMutation: "changed",
          scopeMetadata: { lastValue: prepared.prepared },
        };
      },
    });
  });

  afterEach(() => {
    database.close();
  });

  it("serializes jobs by scope, advances the scope revision, and emits runtime lifecycle events", async () => {
    const now = 1_736_000_100_000;
    const eventBus = createEventBus();
    const leasedHandler = vi.fn();
    const startedHandler = vi.fn();
    const progressHandler = vi.fn();
    const succeededHandler = vi.fn();
    eventBus.on("runtime.job_leased", leasedHandler);
    eventBus.on("runtime.job_started", startedHandler);
    eventBus.on("runtime.job_progress_updated", progressHandler);
    eventBus.on("runtime.job_succeeded", succeededHandler);

    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    database.db.transaction((tx) => {
      scheduler.enqueue(tx, {
        jobId: "job-1",
        jobType: "test.scope_job",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:1",
        payload: { value: "one" },
        availableAt: now,
      });
      scheduler.enqueue(tx, {
        jobId: "job-2",
        jobType: "test.scope_job",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:1",
        payload: { value: "two" },
        availableAt: now,
      });
    });

    const worker = new RuntimeWorker(database.db, catalog, processors, {
      workerId: "runtime-worker-test",
      pollIntervalMs: 60_000,
      maxConcurrentJobs: 1,
      jobTypes: ["test.scope_job"],
      eventBus,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const rowsAfterFirst = await database.db.select().from(runtimeJobs);
    const first = rowsAfterFirst.find((row) => row.id === "job-1");
    const second = rowsAfterFirst.find((row) => row.id === "job-2");
    expect(first).toMatchObject({
      status: "succeeded",
      phase: "completed",
      progressCurrent: 2,
      progressTotal: 2,
    });
    expect(JSON.parse(first!.resultJson ?? "null")).toEqual({ value: "ONE" });
    expect(second).toMatchObject({ status: "pending", attemptCount: 0 });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [scopeState] = await database.db.select().from(runtimeScopeStates);
    expect(scopeState).toBeDefined();
    expect(scopeState?.revision).toBe(2);
    expect(parseRuntimeScopeMetadata(scopeState?.metadataJson).lastValue).toBe("TWO");

    const finalRows = await database.db.select().from(runtimeJobs);
    expect(finalRows.every((row) => row.status === "succeeded")).toBe(true);
    expect(leasedHandler).toHaveBeenCalledTimes(2);
    expect(startedHandler).toHaveBeenCalledTimes(2);
    expect(progressHandler).toHaveBeenCalledTimes(2);
    expect(succeededHandler).toHaveBeenCalledTimes(2);
  });

  it("maps retryable failures to retry_waiting and can later succeed", async () => {
    const now = 1_736_000_110_000;
    const eventBus = createEventBus();
    const retryHandler = vi.fn();
    eventBus.on("runtime.job_retry_scheduled", retryHandler);

    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    let attempts = 0;
    processors.register<{ value: string }, { value: string }, { value: string }>("test.retry_job", {
      async prepare({ payload }) {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(`transient:${payload.value}`);
        }
        return { value: payload.value.toUpperCase() };
      },
      commit({ prepared }) {
        return {
          phase: "completed",
          result: { value: prepared.value },
          progressCurrent: 1,
          progressTotal: 1,
          progressMessage: "completed",
          scopeMutation: "none",
        };
      },
    });
    catalog.register({
      jobType: "test.retry_job",
      payloadSchema: z.object({ value: z.string().min(1) }),
      initialPhase: "queued",
    });

    database.db.transaction((tx) => {
      scheduler.enqueue(tx, {
        jobId: "job-retry",
        jobType: "test.retry_job",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:retry",
        payload: { value: "recover" },
        availableAt: now,
      });
    });

    const worker = new RuntimeWorker(database.db, catalog, processors, {
      workerId: "runtime-worker-retry",
      pollIntervalMs: 60_000,
      retryBaseDelayMs: 50,
      maxRetryDelayMs: 50,
      eventBus,
      jobTypes: ["test.retry_job"],
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);
    const [afterFirstAttempt] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-retry"));
    expect(afterFirstAttempt).toMatchObject({
      status: "retry_waiting",
      lastError: "transient:recover",
      lastErrorClass: "Error",
    });
    expect((afterFirstAttempt?.availableAt ?? 0) - (afterFirstAttempt?.updatedAt ?? 0)).toBe(50);
    expect(retryHandler).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-retry",
      status: "retry_waiting",
      retryAt: expect.any(Number),
    }));

    await database.db.update(runtimeJobs)
      .set({ availableAt: Date.now() - 1, updatedAt: Date.now() - 1 })
      .where(eq(runtimeJobs.id, "job-retry"));

    await expect(worker.processOneDueJob()).resolves.toBe(true);
    const [afterSecondAttempt] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-retry"));
    expect(afterSecondAttempt).toMatchObject({
      status: "succeeded",
      attemptCount: 2,
      progressCurrent: 1,
      progressTotal: 1,
    });
    expect(JSON.parse(afterSecondAttempt!.resultJson ?? "null")).toEqual({ value: "RECOVER" });
  });

  it("maps fatal failures to dead_letter and emits the dead-letter event", async () => {
    const now = 1_736_000_120_000;
    const eventBus = createEventBus();
    const deadLetterHandler = vi.fn();
    eventBus.on("runtime.job_dead_lettered", deadLetterHandler);

    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    processors.register<{ value: string }, never, never>("test.fatal_job", {
      async prepare() {
        throw new RuntimeJobFatalError("fatal failure");
      },
      commit() {
        throw new Error("unreachable");
      },
    });
    catalog.register({
      jobType: "test.fatal_job",
      payloadSchema: z.object({ value: z.string().min(1) }),
      initialPhase: "queued",
    });

    database.db.transaction((tx) => {
      scheduler.enqueue(tx, {
        jobId: "job-fatal",
        jobType: "test.fatal_job",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:fatal",
        payload: { value: "boom" },
        availableAt: now,
      });
    });

    const worker = new RuntimeWorker(database.db, catalog, processors, {
      workerId: "runtime-worker-fatal",
      pollIntervalMs: 60_000,
      eventBus,
      jobTypes: ["test.fatal_job"],
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-fatal"));
    expect(job).toMatchObject({
      status: "dead_letter",
      lastError: "fatal failure",
      lastErrorClass: "RuntimeJobFatalError",
    });
    expect(deadLetterHandler).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-fatal",
      status: "dead_letter",
      errorClass: "RuntimeJobFatalError",
    }));
  });

  it("schedules a retry when the scope revision changes before commit", async () => {
    const now = 1_736_000_130_000;
    const gate = createDeferred<void>();

    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    processors.register<{ value: string }, { value: string }, { value: string }>("test.conflict_job", {
      async prepare({ payload }) {
        await gate.promise;
        return { value: payload.value.toUpperCase() };
      },
      commit({ prepared }) {
        return {
          phase: "completed",
          result: { value: prepared.value },
          progressCurrent: 1,
          progressTotal: 1,
          progressMessage: "completed",
          scopeMutation: "changed",
        };
      },
    });
    catalog.register({
      jobType: "test.conflict_job",
      payloadSchema: z.object({ value: z.string().min(1) }),
      initialPhase: "queued",
    });

    database.db.transaction((tx) => {
      scheduler.enqueue(tx, {
        jobId: "job-conflict",
        jobType: "test.conflict_job",
        accountId: DEFAULT_ACCOUNT_ID,
        scopeType: "test",
        scopeKey: "scope:conflict",
        payload: { value: "late" },
        availableAt: now,
      });
    });

    const worker = new RuntimeWorker(database.db, catalog, processors, {
      workerId: "runtime-worker-conflict",
      pollIntervalMs: 60_000,
      retryBaseDelayMs: 0,
      maxRetryDelayMs: 0,
      jobTypes: ["test.conflict_job"],
    });

    const processing = worker.processOneDueJob();
    await Promise.resolve();
    await database.db.update(runtimeScopeStates)
      .set({ revision: 99, updatedAt: now + 1 })
      .where(eq(runtimeScopeStates.scopeKey, "scope:conflict"));
    gate.resolve();

    await expect(processing).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-conflict"));
    expect(job).toMatchObject({
      status: "retry_waiting",
      lastErrorClass: "RuntimeRevisionConflictError",
    });
    expect(job?.lastError).toContain("expected 0, got 99");
  });

  it("allows another worker to take over an expired running lease", async () => {
    const now = 1_736_000_140_000;
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    await database.db.insert(runtimeScopeStates).values({
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      scopeKey: "scope:expired",
      revision: 0,
      leaseOwner: "worker-old",
      leaseUntil: now - 1,
      lastProcessedAt: null,
      lastSuccessJobId: null,
      metadataJson: "{}",
      updatedAt: now - 1,
    });

    await database.db.insert(runtimeJobs).values({
      id: "job-expired",
      jobType: "test.scope_job",
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      scopeKey: "scope:expired",
      sessionId: null,
      floorId: null,
      pageId: null,
      status: "running",
      phase: "stuck",
      payloadJson: JSON.stringify({ value: "expired" }),
      stateJson: JSON.stringify({ step: "stuck" }),
      resultJson: null,
      attemptCount: 0,
      maxAttempts: 5,
      availableAt: now - 1,
      startedAt: now - 10,
      finishedAt: null,
      leaseOwner: "worker-old",
      leaseUntil: now - 1,
      basedOnRevision: 0,
      dedupeKey: null,
      progressCurrent: 0,
      progressTotal: 2,
      progressMessage: "stuck",
      lastError: null,
      lastErrorCode: null,
      lastErrorClass: null,
      createdAt: now - 10,
      updatedAt: now - 1,
    });

    const worker = new RuntimeWorker(database.db, catalog, processors, {
      workerId: "runtime-worker-new",
      pollIntervalMs: 60_000,
      jobTypes: ["test.scope_job"],
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-expired"));
    expect(job).toMatchObject({
      status: "succeeded",
      leaseOwner: null,
      leaseUntil: null,
    });
    expect(JSON.parse(job!.resultJson ?? "null")).toEqual({ value: "EXPIRED" });
  });

  it("marks expired running jobs uncertain without replay when the job definition requests conservative recovery", async () => {
    const now = 1_736_000_150_000;
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    const prepareSpy = vi.fn(async () => ({ prepared: "should-not-run" }));
    const recoverSpy = vi.fn(() => ({
      phase: "uncertain",
      result: {
        recovery: true,
        reason: "expired_running_lease",
      },
      progressCurrent: 1,
      progressTotal: 1,
      progressMessage: "recovered as uncertain",
      scopeMutation: "changed" as const,
      lastProcessedAt: now,
    }));

    processors.register("test.conservative_job", {
      prepare: prepareSpy,
      commit() {
        throw new Error("unreachable");
      },
      recoverExpiredRunning: recoverSpy,
    });
    catalog.register({
      jobType: "test.conservative_job",
      payloadSchema: z.object({ value: z.string().min(1) }),
      initialPhase: "queued",
      expiredRunningPolicy: "mark_uncertain",
    });

    await database.db.insert(runtimeScopeStates).values({
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      scopeKey: "scope:uncertain",
      revision: 0,
      leaseOwner: "worker-old",
      leaseUntil: now - 1,
      lastProcessedAt: null,
      lastSuccessJobId: null,
      metadataJson: "{}",
      updatedAt: now - 1,
    });

    await database.db.insert(runtimeJobs).values({
      id: "job-uncertain",
      jobType: "test.conservative_job",
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "test",
      scopeKey: "scope:uncertain",
      sessionId: null,
      floorId: null,
      pageId: null,
      status: "running",
      phase: "executing",
      payloadJson: JSON.stringify({ value: "risk" }),
      stateJson: JSON.stringify({ step: "executing" }),
      resultJson: null,
      attemptCount: 1,
      maxAttempts: 5,
      availableAt: now - 10,
      startedAt: now - 50,
      finishedAt: null,
      leaseOwner: "worker-old",
      leaseUntil: now - 1,
      basedOnRevision: 0,
      dedupeKey: null,
      progressCurrent: 0,
      progressTotal: 1,
      progressMessage: "executing",
      lastError: null,
      lastErrorCode: null,
      lastErrorClass: null,
      createdAt: now - 50,
      updatedAt: now - 1,
    });

    const worker = new RuntimeWorker(database.db, catalog, processors, {
      workerId: "runtime-worker-uncertain",
      pollIntervalMs: 60_000,
      jobTypes: ["test.conservative_job"],
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(prepareSpy).not.toHaveBeenCalled();
    expect(recoverSpy).toHaveBeenCalledTimes(1);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-uncertain"));
    expect(job).toMatchObject({ status: "succeeded", phase: "uncertain" });
    expect(JSON.parse(job!.resultJson ?? "null")).toEqual({ recovery: true, reason: "expired_running_lease" });
  });
});
