import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, runtimeJobs, runtimeScopeStates, sessions, toolExecutionRecords } from "../../db/schema.js";
import { ToolAsyncHandlerRegistry } from "../tool-async-handler-registry.js";
import { createToolRuntimeJobBridge } from "../tool-runtime-job-bridge.js";
import { ToolWorker } from "../tool-worker.js";

const DEFAULT_ACCOUNT_ID = "default-admin";

describe("ToolWorker", () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  async function seedTurnScope() {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();

    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    await database.db.insert(sessions).values({
      id: sessionId,
      accountId: DEFAULT_ACCOUNT_ID,
      title: "Deferred tool worker",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { now, sessionId, floorId };
  }

  it("processes deferred tool jobs and finalizes queued executions as success", async () => {
    const { now, sessionId, floorId } = await seedTurnScope();
    const executionId = nanoid();
    const runId = nanoid();
    const jobId = `tool-job:${executionId}`;

    await database.db.insert(toolExecutionRecords).values({
      id: executionId,
      runId,
      floorId,
      pageId: null,
      callerSlot: "narrator",
      providerId: "mcp:mcp-1",
      providerType: "mcp",
      toolName: "github_create_issue",
      argsJson: JSON.stringify({ title: "Need help" }),
      resultJson: JSON.stringify({ accepted: true, status: "queued" }),
      status: "queued",
      lifecycleState: "opened",
      commitOutcome: "committed",
      deliveryMode: "async_job",
      runtimeJobId: null,
      sideEffectLevel: "irreversible",
      errorMessage: null,
      durationMs: 0,
      startedAt: now,
      finishedAt: null,
      attemptNo: 1,
      replayParentExecutionId: null,
      createdAt: now,
    });

    const bridge = createToolRuntimeJobBridge(database.db);
    database.db.transaction((tx) => {
      bridge.enqueue(tx, {
        executionId,
        runId,
        jobId,
        envelope: {
          executionId,
          runId,
          sessionId,
          accountId: DEFAULT_ACCOUNT_ID,
          floorId,
          callerSlot: "narrator",
          providerId: "mcp:mcp-1",
          providerType: "mcp",
          toolName: "github_create_issue",
          args: { title: "Need help" },
          sideEffectLevel: "irreversible",
          deliveryMode: "async_job",
          asyncCapability: "deferred_ok",
          resultVisibility: "deferred_receipt",
          acceptedAt: now,
        },
        receipt: {
          accepted: true,
          delivery_mode: "async_job",
          execution_id: executionId,
          job_id: jobId,
          status: "queued",
          message: "Deferred tool accepted.",
        },
      });
    });

    const handlers = new ToolAsyncHandlerRegistry();
    handlers.register({
      providerType: "mcp",
      execute: async () => ({ data: { issue_number: 42 } }),
    });

    const worker = new ToolWorker(database.db, handlers, { pollIntervalMs: 60_000 });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, jobId));
    expect(job).toMatchObject({
      id: jobId,
      status: "succeeded",
      progressCurrent: 1,
      progressTotal: 1,
    });

    const [execution] = await database.db.select().from(toolExecutionRecords).where(eq(toolExecutionRecords.id, executionId));
    expect(execution).toMatchObject({
      id: executionId,
      status: "success",
      lifecycleState: "finished",
      deliveryMode: "async_job",
      runtimeJobId: jobId,
      commitOutcome: "committed",
    });
    expect(JSON.parse(execution!.resultJson)).toEqual({ issue_number: 42 });
  });

  it("preserves uncertain outcomes without replaying the external call", async () => {
    const { now, sessionId, floorId } = await seedTurnScope();
    const executionId = nanoid();
    const runId = nanoid();
    const jobId = `tool-job:${executionId}`;

    await database.db.insert(toolExecutionRecords).values({
      id: executionId,
      runId,
      floorId,
      pageId: null,
      callerSlot: "narrator",
      providerId: "mcp:mcp-1",
      providerType: "mcp",
      toolName: "github_create_issue",
      argsJson: JSON.stringify({ title: "Need help" }),
      resultJson: JSON.stringify({ accepted: true, status: "queued" }),
      status: "queued",
      lifecycleState: "opened",
      commitOutcome: "committed",
      deliveryMode: "async_job",
      runtimeJobId: null,
      sideEffectLevel: "irreversible",
      errorMessage: null,
      durationMs: 0,
      startedAt: now,
      finishedAt: null,
      attemptNo: 1,
      replayParentExecutionId: null,
      createdAt: now,
    });

    const bridge = createToolRuntimeJobBridge(database.db);
    database.db.transaction((tx) => {
      bridge.enqueue(tx, {
        executionId,
        runId,
        jobId,
        envelope: {
          executionId,
          runId,
          sessionId,
          accountId: DEFAULT_ACCOUNT_ID,
          floorId,
          callerSlot: "narrator",
          providerId: "mcp:mcp-1",
          providerType: "mcp",
          toolName: "github_create_issue",
          args: { title: "Need help" },
          sideEffectLevel: "irreversible",
          deliveryMode: "async_job",
          asyncCapability: "deferred_ok",
          resultVisibility: "deferred_receipt",
          acceptedAt: now,
        },
        receipt: {
          accepted: true,
          delivery_mode: "async_job",
          execution_id: executionId,
          job_id: jobId,
          status: "queued",
          message: "Deferred tool accepted.",
        },
      });
    });

    const handlers = new ToolAsyncHandlerRegistry();
    handlers.register({
      providerType: "mcp",
      execute: async () => ({
        error: "Tool call timeout after 50ms; execution outcome is uncertain; reconnect required before the next call",
        executionStatus: "uncertain",
      }),
    });

    const worker = new ToolWorker(database.db, handlers, { pollIntervalMs: 60_000 });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, jobId));
    expect(job).toMatchObject({ id: jobId, status: "succeeded" });

    const [execution] = await database.db.select().from(toolExecutionRecords).where(eq(toolExecutionRecords.id, executionId));
    expect(execution).toMatchObject({
      id: executionId,
      status: "uncertain",
      lifecycleState: "finished",
      runtimeJobId: jobId,
    });
    expect(execution?.errorMessage).toContain("execution outcome is uncertain");
  });

  it("marks expired running deferred tool jobs as uncertain without replaying the handler", async () => {
    const { now, sessionId, floorId } = await seedTurnScope();
    const executionId = nanoid();
    const runId = nanoid();
    const jobId = `tool-job:${executionId}`;

    await database.db.insert(runtimeScopeStates).values({
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "tool_execution",
      scopeKey: `session:${sessionId}`,
      revision: 0,
      leaseOwner: "tool-worker-old",
      leaseUntil: now - 1,
      lastProcessedAt: null,
      lastSuccessJobId: null,
      metadataJson: "{}",
      updatedAt: now - 1,
    });

    await database.db.insert(toolExecutionRecords).values({
      id: executionId,
      runId,
      floorId,
      pageId: null,
      callerSlot: "narrator",
      providerId: "mcp:mcp-1",
      providerType: "mcp",
      toolName: "github_create_issue",
      argsJson: JSON.stringify({ title: "Need help" }),
      resultJson: JSON.stringify({ accepted: true, status: "running" }),
      status: "running",
      lifecycleState: "opened",
      commitOutcome: "committed",
      deliveryMode: "async_job",
      runtimeJobId: jobId,
      sideEffectLevel: "irreversible",
      errorMessage: null,
      durationMs: 0,
      startedAt: now - 200,
      finishedAt: null,
      attemptNo: 1,
      replayParentExecutionId: null,
      createdAt: now - 200,
    });

    await database.db.insert(runtimeJobs).values({
      id: jobId,
      jobType: "tool.execute",
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "tool_execution",
      scopeKey: `session:${sessionId}`,
      sessionId,
      floorId,
      pageId: null,
      status: "running",
      phase: "executing",
      payloadJson: JSON.stringify({
        envelope: {
          executionId,
          runId,
          sessionId,
          accountId: DEFAULT_ACCOUNT_ID,
          floorId,
          callerSlot: "narrator",
          providerId: "mcp:mcp-1",
          providerType: "mcp",
          toolName: "github_create_issue",
          args: { title: "Need help" },
          sideEffectLevel: "irreversible",
          deliveryMode: "async_job",
          asyncCapability: "deferred_ok",
          resultVisibility: "deferred_receipt",
          acceptedAt: now - 300,
        },
      }),
      stateJson: JSON.stringify({ executionId }),
      resultJson: null,
      attemptCount: 1,
      maxAttempts: 3,
      availableAt: now - 300,
      startedAt: now - 250,
      finishedAt: null,
      leaseOwner: "tool-worker-old",
      leaseUntil: now - 1,
      basedOnRevision: 0,
      dedupeKey: `tool-execution:${executionId}`,
      progressCurrent: 0,
      progressTotal: 1,
      progressMessage: "executing",
      lastError: null,
      lastErrorCode: null,
      lastErrorClass: null,
      createdAt: now - 300,
      updatedAt: now - 1,
    });

    const executeSpy = vi.fn(async () => ({ data: { issue_number: 42 } }));

    const handlers = new ToolAsyncHandlerRegistry();
    handlers.register({ providerType: "mcp", execute: executeSpy });

    const worker = new ToolWorker(database.db, handlers, { pollIntervalMs: 60_000 });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(executeSpy).not.toHaveBeenCalled();

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, jobId));
    expect(job).toMatchObject({ id: jobId, status: "succeeded", phase: "uncertain" });
    expect(JSON.parse(job!.resultJson ?? "null")).toEqual(expect.objectContaining({ status: "uncertain", recoveryRequired: true, reason: "expired_running_lease" }));

    const [execution] = await database.db.select().from(toolExecutionRecords).where(eq(toolExecutionRecords.id, executionId));
    expect(execution).toMatchObject({ id: executionId, status: "uncertain", lifecycleState: "finished", runtimeJobId: jobId });
    expect(execution?.errorMessage).toContain("automatic replay blocked");
    expect(JSON.parse(execution!.resultJson)).toEqual(expect.objectContaining({ recoveryRequired: true, reason: "expired_running_lease" }));
  });
});
