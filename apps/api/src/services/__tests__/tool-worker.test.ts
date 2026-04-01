import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, runtimeJobs, sessions, toolExecutionRecords } from "../../db/schema.js";
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
});
