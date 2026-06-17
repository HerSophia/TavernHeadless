import { createEventBus } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  agentTypes,
  derivedOutputs,
  projectAgentBindings,
  runtimeJobs,
} from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { AgentJobTriggerService } from "../agent-job-trigger-service.js";
import { AgentRuntimeWorker } from "../agent-runtime-worker.js";
import { ProjectEventService } from "../project-event-service.js";
import { PROJECT_DIGEST_AGENT_KEY } from "../agent-runtime/builtin/project-digest-agent.js";

const PROJECT_EVENT_TYPE = "project.digest.requested";

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
      defaultEventSubscriptionsJson: JSON.stringify([{ type: PROJECT_EVENT_TYPE }]),
      defaultGrantsJson: JSON.stringify({ allowed_output_targets: ["derived_output"] }),
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
      eventSubscriptionsJson: JSON.stringify([{ type: PROJECT_EVENT_TYPE }]),
      grantsJson: JSON.stringify({ allowed_output_targets: ["derived_output"] }),
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    .onConflictDoNothing()
    .run();

  new ProjectEventService(database.db).append({
    id: "evt_1",
    workspaceId: "ws_1",
  projectId: "proj_1",
    type: PROJECT_EVENT_TYPE,
    visibility: "project",
    source: "api",
    payload: {},
    createdAt: 1,
  });
}

describe("agent runtime event -> worker integration",() => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    seed(database);
  });

  afterEach(() => {
    database.close();
  });

  it("enqueues from a committed-only event and runs to a derived_output", async () => {
    const trigger = new AgentJobTriggerService(database.db);
    const enqueueResult = database.db.transaction((tx) =>
      trigger.enqueueFromEvent(tx, {
        accountId: "default-admin",
        projectId: "proj_1",
        eventId: "evt_1",
        dryRun: false,
      }),
    );

    expect(enqueueResult.triggered).toHaveLength(1);
    expect(enqueueResult.triggered[0]?.created).toBe(true);

const worker = new AgentRuntimeWorker(database.db, {
      workerId: "agent-runtime-worker-e2e",
      pollIntervalMs: 60_000,
      eventBus: createEventBus(),
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job?.lastError).toBeNull();
    expect(job?.status).toBe("succeeded");

    const outputs = await database.db.select().from(derivedOutputs);
       expect(outputs).toHaveLength(1);
    expect(outputs[0]?.domain).toBe("project_digest");
  });

  it("dry_run event trigger runs without writing derived_output", async () => {
    const trigger = new AgentJobTriggerService(database.db);
    database.db.transaction((tx) =>
      trigger.enqueueFromEvent(tx, {
        accountId: "default-admin",
        projectId: "proj_1",
        eventId: "evt_1",
        dryRun: true,
      }),
    );

    const worker = new AgentRuntimeWorker(database.db, {
      workerId: "agent-runtime-worker-e2e-dry",
      pollIntervalMs: 60_000,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const outputs = await database.db.select().from(derivedOutputs);
    expect(outputs).toHaveLength(0);

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job?.status).toBe("succeeded");
  });
});
