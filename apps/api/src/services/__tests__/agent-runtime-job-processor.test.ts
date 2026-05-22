import { createEventBus } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, agentTypes, projectAgentBindings, runtimeJobs } from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { createAgentRuntimeJobCatalog } from "../agent-runtime-job-definitions.js";
import { createAgentRuntimeJobProcessorRegistry } from "../agent-runtime-job-processor.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";
import { RuntimeWorker } from "../runtime-worker.js";

describe("AgentRuntimeJobProcessor placeholder", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("moves agent.run jobs to dead letter with the placeholder error", async () => {
    await database.db.insert(accounts).values({
      id: "default-admin",
      name: "default-admin",
      createdAt: 1,
      updatedAt: 1,
    }).onConflictDoNothing().run();

    createTestProject(database.db, { accountId: "default-admin", workspaceId: "ws_1", id: "proj_1" });

    await database.db.insert(agentTypes).values({
      id: "agt_1",
      workspaceId: "ws_1",
      accountId: "default-admin",
      key: "agent.one",
      name: "Agent One",
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
    }).onConflictDoNothing().run();

    await database.db.insert(projectAgentBindings).values({
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
    }).onConflictDoNothing().run();

    const catalog = createAgentRuntimeJobCatalog();
    const processors = createAgentRuntimeJobProcessorRegistry();
    const scheduler = new RuntimeJobScheduler(catalog, { eventBus: createEventBus() });

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
        payload: {
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
          dryRun: true,
          inputJson: {},
        },
      });
    });

    const worker = new RuntimeWorker(database.db, catalog, processors, {
      workerId: "agent-runtime-worker-test",
      pollIntervalMs: 60_000,
      jobTypes: ["agent.run"],
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job).toMatchObject({
      status: "dead_letter",
      lastError: "agent_processor_not_implemented",
      lastErrorClass: "RuntimeJobFatalError",
    });
  });
});
