import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, runtimeJobs, sessions, toolExecutionRecords } from "../../db/schema.js";
import { createToolRuntimeJobBridge } from "../tool-runtime-job-bridge.js";
import { ToolRuntimePolicy } from "../tool-runtime-policy.js";
import { ToolRoundtripTraceService } from "../tooling/tool-roundtrip-trace-service.js";

const ACCOUNT_ID = "default-admin";

async function seedTurnScope(database: DatabaseConnection) {
  const now = Date.now();
  const sessionId = nanoid();
  const floorId = nanoid();

  await database.db.insert(accounts).values({
    id: ACCOUNT_ID,
    name: ACCOUNT_ID,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run();

  await database.db.insert(sessions).values({
    id: sessionId,
    accountId: ACCOUNT_ID,
    title: "Tool Trace",
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

describe("ToolRoundtripTraceService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("aggregates inline and deferred tool executions into a unified trace view", async () => {
    const { now, sessionId, floorId } = await seedTurnScope(database);
    const inlineExecutionId = nanoid();
    const inlineRunId = nanoid();
    const asyncExecutionId = nanoid();
    const asyncRunId = nanoid();
    const asyncJobId = `tool-job:${asyncExecutionId}`;

    await database.db.insert(toolExecutionRecords).values({
      id: inlineExecutionId,
      runId: inlineRunId,
      floorId,
      pageId: null,
      callerSlot: "narrator",
      providerId: "builtin",
      providerType: "builtin",
      toolName: "get_time",
      argsJson: JSON.stringify({}),
      resultJson: JSON.stringify({ now: now + 10 }),
      status: "success",
      lifecycleState: "finished",
      commitOutcome: "committed",
      deliveryMode: "inline",
      runtimeJobId: null,
      sideEffectLevel: "none",
      errorMessage: null,
      durationMs: 10,
      startedAt: now,
      finishedAt: now + 10,
      attemptNo: 1,
      replayParentExecutionId: null,
      createdAt: now,
    });

    await database.db.insert(toolExecutionRecords).values({
      id: asyncExecutionId,
      runId: asyncRunId,
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

    const policy = new ToolRuntimePolicy({
      enableDeferredIrreversibleTools: true,
      deferredToolAllowlist: ["mcp-1/github_create_issue"],
      timeoutMs: 1_500,
      maxAttempts: 7,
      retryableStatuses: ["timeout", "uncertain"],
      maxDeferredJobsPerRun: 2,
      maxIrreversibleCallsPerRun: 1,
    });
    const bridge = createToolRuntimeJobBridge(database.db, {
      toolRuntimePolicy: policy,
    });

    database.db.transaction((tx) => {
      bridge.enqueue(tx, {
        executionId: asyncExecutionId,
        runId: asyncRunId,
        jobId: asyncJobId,
        envelope: {
          executionId: asyncExecutionId,
          runId: asyncRunId,
          sessionId,
          accountId: ACCOUNT_ID,
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
          execution_id: asyncExecutionId,
          job_id: asyncJobId,
          status: "queued",
          message: "Deferred tool accepted.",
        },
      });
    });

    await database.db
      .update(toolExecutionRecords)
      .set({
        status: "uncertain",
        lifecycleState: "finished",
        errorMessage: "execution outcome is uncertain",
        durationMs: 50,
        finishedAt: now + 50,
        runtimeJobId: asyncJobId,
      })
      .where(eq(toolExecutionRecords.id, asyncExecutionId))
      .run();

    await database.db
      .update(runtimeJobs)
      .set({
        status: "succeeded",
        phase: "uncertain",
        startedAt: now + 5,
        finishedAt: now + 50,
        progressCurrent: 1,
        progressTotal: 1,
        progressMessage: "tool execution outcome uncertain",
        resultJson: JSON.stringify({
          status: "uncertain",
          recoveryRequired: true,
          reason: "expired_running_lease",
        }),
        updatedAt: now + 50,
      })
      .where(eq(runtimeJobs.id, asyncJobId))
      .run();

    const service = new ToolRoundtripTraceService(database.db);
    const result = await service.list({
      accountId: ACCOUNT_ID,
      floorId,
      sortBy: "started_at",
      sortOrder: "asc",
    });

    expect(result.total).toBe(2);

    const inlineTrace = result.traces.find((trace) => trace.executionId === inlineExecutionId);
    expect(inlineTrace).toMatchObject({
      executionId: inlineExecutionId,
      deliveryMode: "inline",
      status: "success",
      replaySafety: "safe",
      provenance: { triggerScope: "unknown" },
      runtimeJob: {
        id: null,
        status: null,
      },
      roundtrip: {
        wasAccepted: true,
        wasEnqueued: false,
        wasStarted: true,
        wasCompleted: true,
        wasUncertain: false,
      },
    });

    const asyncTrace = result.traces.find((trace) => trace.executionId === asyncExecutionId);
    expect(asyncTrace).toMatchObject({
      executionId: asyncExecutionId,
      deliveryMode: "async_job",
      status: "uncertain",
      replaySafety: "uncertain",
      replayReason: "uncertain_execution_outcome",
      policy: {
        enableDeferredIrreversibleTools: true,
        deferredToolAllowlist: ["mcp:mcp-1/github_create_issue"],
        timeoutMs: 1_500,
        maxAttempts: 7,
        retryableStatuses: ["timeout", "uncertain"],
        maxDeferredJobsPerRun: 2,
        maxIrreversibleCallsPerRun: 1,
      },
      provenance: {
        triggerScope: "chat_turn",
      },
      runtimeJob: {
        id: asyncJobId,
        status: "succeeded",
        phase: "uncertain",
        maxAttempts: 7,
      },
      roundtrip: {
        wasAccepted: true,
        wasEnqueued: true,
        wasStarted: true,
        wasCompleted: true,
        wasUncertain: true,
      },
    });
  });
});
