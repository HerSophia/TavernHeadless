import { createEventBus } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, agentTypes, derivedOutputs, projectAgentBindings, runtimeJobs } from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { AgentRuntimeWorker } from "../agent-runtime-worker.js";
import { PROJECT_DIGEST_AGENT_KEY } from "../agent-runtime/builtin/project-digest-agent.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";
import { createAgentRuntimeJobCatalog } from "../agent-runtime-job-definitions.js";
import type { AgentRunJobPayload } from "../agent-runtime-job-definitions.js";

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

function enqueue(database: DatabaseConnection, dryRun: boolean): void {
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
    resolvedConfig: {
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindings: [],
      eventSubscriptions: [],
      grants: {},
      allowedOutputTargets: ["derived_output"],
    },
    dryRun,
    inputJson: { events: [{ id: "evt_1"}] },
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
});
