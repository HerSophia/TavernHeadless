import { createEventBus } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, agentTypes, derivedOutputs, projectAgentBindings, projectInboxItems, runtimeJobs } from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { AgentRuntimeWorker } from "../agent-runtime-worker.js";
import { PROJECT_DIGEST_AGENT_KEY } from "../agent-runtime/builtin/project-digest-agent.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";
import { createAgentRuntimeJobCatalog } from "../agent-runtime-job-definitions.js";
import type { AgentRunJobPayload } from "../agent-runtime-job-definitions.js";
import type { BackgroundAgentHandler } from "../agent-runtime/background-agent-types.js";

function seed(database: DatabaseConnection): void {
  database.db
    .insert(accounts)
    .values({ id: "default-admin", name: "default-admin", createdAt: 1, updatedAt: 1 })
    .onConflictDoNothing()
    .run();
  createTestProject(database.db, { accountId: "default-admin", workspaceId: "ws_1", id: "proj_1" });
  database.db
 .insert(agentTypes)
    .values({
      id: "agt_1",
      workspaceId: "ws_1",
      accountId: "default-admin",
      key: PROJECT_DIGEST_AGENT_KEY,
      name: "Project Digest",
      scopeKind: "project",
      status: "active",
      defaultLlmProfileId: null,
      defaultToolPolicyId: null,
      defaultMcpBindingJson: "{}",
      defaultEventSubscriptionsJson: "[]",
      defaultGrantsJson: "{}",
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    .onConflictDoNothing()
    .run();
  database.db
    .insert(projectAgentBindings)
    .values({
      id: "agb_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      accountId: "default-admin",
      agentTypeId: "agt_1",
      status: "enabled",
      scopeKind: "project",
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindingJson: "{}",
      eventSubscriptionsJson: "[]",
      grantsJson: "{}",
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    .onConflictDoNothing()
 .run();
}

function enqueue(
  database: DatabaseConnection,
  dryRun: boolean,
  overrides: Partial<AgentRunJobPayload> = {},
): void {
  const catalog = createAgentRuntimeJobCatalog();
  const scheduler = new RuntimeJobScheduler(catalog, { eventBus: createEventBus() });
  const payload: AgentRunJobPayload = {
    accountId: "default-admin",
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentTypeId: "agt_1",
    agentBindingId: "agb_1",
    sourceEventId: null,
    actorClientId: null,
    triggerType: "manual",
    triggerReason: "test",
    scopeKind: "project",
    resolvedConfig: overrides.resolvedConfig ?? {
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindings: [],
      eventSubscriptions: [],
      grants: {},
      allowedOutputTargets: ["derived_output"],
    },
    dryRun,
    inputJson: { events: [{ id: "evt_1"}] },
    ...overrides,
  };
  database.db.transaction((tx) => {
  scheduler.enqueue(tx, {
      jobType: "agent.run",
      accountId: "default-admin",
      scopeType: "agent",
      scopeKey: "ws_1:proj_1:agt_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentTypeId: "agt_1",
      agentBindingId: "agb_1",
      payload,
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("AgentRuntimeWorker", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    seed(database);
  });

  afterEach(() => {
    database.close();
  });

  it("consumes a due agent.run job and writes a derived_output",async () => {
    enqueue(database, false);
    const worker = new AgentRuntimeWorker(database.db, {
      workerId: "agent-runtime-worker-it",
      pollIntervalMs: 60_000,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const outputs = await database.db.select().from(derivedOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.domain).toBe("project_digest");

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job?.status).toBe("succeeded");
  });

  it("does not write derived_output ondry_run", async () => {
    enqueue(database, true);
    const worker = new AgentRuntimeWorker(database.db, {
      workerId: "agent-runtime-worker-it-dry",
      pollIntervalMs: 60_000,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const outputs = await database.db.select().from(derivedOutputs);
    expect(outputs).toHaveLength(0);

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job?.status).toBe("succeeded");
  });

  it("writes project_inbox output through the worker dispatcher", async () => {
    const handler: BackgroundAgentHandler = {
      agentKey: PROJECT_DIGEST_AGENT_KEY,
      async run(context) {
        return {
          status: "completed",
          outputs: [{
            target: "project_inbox",
            actorAccountId: context.accountId,
            projectId: context.projectId,
            type: "agent_suggestion",
            title: "Review project note",
            payload: { text: "Review this note" },
            lineage: context.lineage,
          }],
          traceDraft: { deliveryTarget: "project_inbox", lineage: context.lineage },
          summary: "project inbox item prepared",
        };
      },
    };
    enqueue(database, false, {
      resolvedConfig: {
        llmProfileId: null,
        toolPolicyId: null,
        mcpBindings: [],
        eventSubscriptions: [],
        grants: {},
        allowedOutputTargets: ["project_inbox"],
      },
    });
    const worker = new AgentRuntimeWorker(database.db, {
      workerId: "agent-runtime-worker-project-inbox",
      pollIntervalMs: 60_000,
      handlers: [handler],
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const inbox = await database.db.select().from(projectInboxItems);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      projectId: "proj_1",
      type: "agent_suggestion",
      title: "Review project note",
      status: "pending",
    });
    const [job] = await database.db.select().from(runtimeJobs);
    expect(JSON.parse(job?.resultJson ?? "{}")).toMatchObject({
      outputCount: 1,
      outputs: [{ target: "project_inbox", id: expect.any(String) }],
    });
  });

  it("routes session_state_proposal output to the injected sink", async () => {
    const stage = vi.fn(() => ({ proposalId: "prop_1" }));
    const handler: BackgroundAgentHandler = {
      agentKey: PROJECT_DIGEST_AGENT_KEY,
      async run(context) {
        return {
          status: "completed",
          outputs: [{
            target: "session_state_proposal",
            accountId: context.accountId,
            sessionId: "sess_1",
            summary: "Propose storm state",
            namespace: "scene",
            slot: "weather",
            value: "storm",
            lineage: context.lineage,
          }],
          traceDraft: { deliveryTarget: "session_state_proposal", lineage: context.lineage },
          summary: "session state proposal prepared",
        };
      },
    };
    enqueue(database, false, {
      resolvedConfig: {
        llmProfileId: null,
        toolPolicyId: null,
        mcpBindings: [],
        eventSubscriptions: [],
        grants: {},
        allowedOutputTargets: ["session_state_proposal"],
      },
    });
    const worker = new AgentRuntimeWorker(database.db, {
      workerId: "agent-runtime-worker-session-proposal",
      pollIntervalMs: 60_000,
      handlers: [handler],
      sessionStateProposalSink: { stage },
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(stage).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "default-admin",
      sessionId: "sess_1",
      summary: "Propose storm state",
      namespace: "scene",
      slot: "weather",
      value: "storm",
    }));
    const [job] = await database.db.select().from(runtimeJobs);
    expect(JSON.parse(job?.resultJson ?? "{}")).toMatchObject({
      outputCount: 1,
      outputs: [{ target: "session_state_proposal", id: "prop_1" }],
    });
  });

  it("keeps same agent scope jobs FIFO even when worker concurrency is greater than one", async () => {
    let releaseFirst: (() => void) | undefined;
    let runCount = 0;
    const startedJobs: string[] = [];
    const handler: BackgroundAgentHandler = {
      agentKey: PROJECT_DIGEST_AGENT_KEY,
      async run(context) {
        runCount += 1;
        startedJobs.push(context.lineage.rootRunId ?? `run_${runCount}`);
        if (runCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return {
          status: "completed",
          outputs: [],
          traceDraft: { deliveryTarget: "derived_output", lineage: context.lineage },
          summary: "fifo checked",
        };
      },
    };
    enqueue(database, false);
    enqueue(database, false);
    const worker = new AgentRuntimeWorker(database.db, {
      workerId: "agent-runtime-worker-fifo",
      pollIntervalMs: 60_000,
      maxConcurrentJobs: 2,
      handlers: [handler],
    });

    const firstRun = worker.processOneDueJob();
    try {
      await waitFor(() => startedJobs.length === 1);
      const whileBlocked = await database.db.select().from(runtimeJobs);
      expect(whileBlocked.filter((job) => job.status === "running")).toHaveLength(1);
      expect(whileBlocked.filter((job) => job.status === "pending")).toHaveLength(1);
      await expect(worker.processOneDueJob()).resolves.toBe(false);

      releaseFirst?.();
      await expect(firstRun).resolves.toBe(true);
      await expect(worker.processOneDueJob()).resolves.toBe(true);
      expect(startedJobs).toHaveLength(2);
      expect(database.db.select().from(runtimeJobs).all().every((job) => job.status === "succeeded")).toBe(true);
    } finally {
      releaseFirst?.();
      await firstRun.catch(() => undefined);
      await worker.stop();
    }
  });
});
