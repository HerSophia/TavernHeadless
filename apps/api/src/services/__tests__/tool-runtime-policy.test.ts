import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, runtimeJobs, sessions } from "../../db/schema.js";
import { ToolRuntimePolicy } from "../tool-runtime-policy.js";
import { createToolRuntimeJobBridge } from "../tool-runtime-job-bridge.js";

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
    title: "Tool Runtime Policy",
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

describe("ToolRuntimePolicy", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("captures the expanded execution policy and wires maxAttempts into deferred runtime jobs", async () => {
    const { now, sessionId, floorId } = await seedTurnScope(database);
    const executionId = nanoid();
    const runId = nanoid();
    const jobId = `tool-job:${executionId}`;
    const policy = new ToolRuntimePolicy({
      enableDeferredIrreversibleTools: true,
      deferredToolAllowlist: ["mcp-1/github_create_issue"],
      timeoutMs: 1_500,
      maxAttempts: 7,
      retryableStatuses: ["timeout", "uncertain"],
      maxDeferredJobsPerRun: 2,
      maxIrreversibleCallsPerRun: 1,
    });

    expect(policy.getExecutionPolicySnapshot()).toEqual({
      enableDeferredIrreversibleTools: true,
      deferredToolAllowlist: ["mcp:mcp-1/github_create_issue"],
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
        executionId,
        runId,
        jobId,
        envelope: {
          executionId,
          runId,
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
          execution_id: executionId,
          job_id: jobId,
          status: "queued",
          message: "Deferred tool accepted.",
        },
      });
    });

    const [job] = await database.db
      .select()
      .from(runtimeJobs)
      .where(eq(runtimeJobs.id, jobId));
    const payload = JSON.parse(job?.payloadJson ?? "null");

    expect(job?.maxAttempts).toBe(7);
    expect(payload.policy).toEqual({
      enableDeferredIrreversibleTools: true,
      deferredToolAllowlist: ["mcp:mcp-1/github_create_issue"],
      timeoutMs: 1_500,
      maxAttempts: 7,
      retryableStatuses: ["timeout", "uncertain"],
      maxDeferredJobsPerRun: 2,
      maxIrreversibleCallsPerRun: 1,
    });
    expect(payload.provenance).toEqual({ triggerScope: "chat_turn" });
  });
});
