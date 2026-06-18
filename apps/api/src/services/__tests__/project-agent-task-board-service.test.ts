import { createEventBus } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, agentTypes, projectAgentBindings } from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import {
  ProjectAgentTaskBoardService,
  ProjectAgentTaskBoardServiceError,
} from "../project-agent-task-board-service.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";
import { createAgentRuntimeJobCatalog } from "../agent-runtime-job-definitions.js";
import type { AgentRunJobPayload } from "../agent-runtime-job-definitions.js";

function basePayload(overrides: Partial<AgentRunJobPayload> = {}): AgentRunJobPayload {
  return {
    accountId: "default-admin",
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentTypeId: "agt_1",
    agentBindingId: "agb_1",
    sourceEventId: "evt_1",
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
    dryRun: false,
    inputJson: {},
    ...overrides,
  };
}

function enqueueJob(
  database: DatabaseConnection,
  args: { jobId?: string; workspaceId: string; projectId: string;agentTypeId: string; payload: AgentRunJobPayload },
): void {
  const catalog = createAgentRuntimeJobCatalog();
  const scheduler = new RuntimeJobScheduler(catalog, { eventBus: createEventBus() });
  database.db.transaction((tx) => {
    scheduler.enqueue(tx, {
      ...(args.jobId ? { jobId: args.jobId } : {}),
      jobType: "agent.run",
      accountId: "default-admin",
      scopeType: "agent",
      scopeKey: `${args.workspaceId}:${args.projectId}:${args.agentTypeId}`,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      agentTypeId: args.agentTypeId,
      agentBindingId: args.payload.agentBindingId,
      payload: args.payload,
    });
  });
}

describe("ProjectAgentTaskBoardService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    database.db
      .insert(accounts)
      .values({ id: "default-admin", name: "default-admin", createdAt: 1, updatedAt: 1 })
      .onConflictDoNothing()
      .run();
    createTestProject(database.db, { accountId: "default-admin", workspaceId: "ws_1", id: "proj_1" });
   createTestProject(database.db, { accountId: "default-admin", workspaceId: "ws_1", id: "proj_2" });
    database.db
      .insert(agentTypes)
      .values({
        id: "agt_1",
        workspaceId: "ws_1",
        accountId: "default-admin",
        key: "project.digest",
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
  });

  afterEach(() => {
    database.close();
  });

  it("lists only jobs that belong to the project scope prefix", async () => {
    enqueueJob(database, {
      jobId: "job_proj1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentTypeId: "agt_1",
      payload: basePayload(),
    });
    enqueueJob(database, {
      jobId: "job_proj2",
      workspaceId: "ws_1",
      projectId: "proj_2",
      agentTypeId: "agt_1",
      payload: basePayload({ projectId: "proj_2" }),
    });

    const service = new ProjectAgentTaskBoardService(database.db);
    const result = await service.list({
      accountId: "default-admin",
 workspaceId: "ws_1",
      projectId: "proj_1",
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.id).toBe("job_proj1");
    expect(result.jobs[0]?.agentBindingId).toBe("agb_1");
    expect(result.jobs[0]?.sourceEventId).toBe("evt_1");
    expect(result.jobs[0]?.deliveryTargets).toEqual(["derived_output"]);
    expect(result.jobs[0]?.dryRun).toBe(false);
  });

  it("filters by status", async () => {
    enqueueJob(database, {
      jobId: "job_proj1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentTypeId: "agt_1",
      payload: basePayload(),
    });

    const service = new ProjectAgentTaskBoardService(database.db);
    const pending = await service.list({
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      status: "pending",
    });
expect(pending.jobs).toHaveLength(1);

    const dead = await service.list({
      accountId: "default-admin",
      workspaceId: "ws_1",
    projectId: "proj_1",
      status: "dead_letter",
    });
    expect(dead.jobs).toHaveLength(0);
  });

  it("groups jobs by source event for the minimal merged notification view", async () => {
    enqueueJob(database, {
      jobId: "job_evt_1a",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentTypeId: "agt_1",
      payload: basePayload({ sourceEventId: "evt_merge" }),
    });
    enqueueJob(database, {
      jobId: "job_evt_1b",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentTypeId: "agt_1",
      payload: basePayload({ sourceEventId: "evt_merge" }),
    });
    enqueueJob(database, {
      jobId: "job_manual",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentTypeId: "agt_1",
      payload: basePayload({ sourceEventId: null, agentBindingId: "agb_1" }),
    });

    const service = new ProjectAgentTaskBoardService(database.db);
    const grouped = await service.listGroupedBySource({
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
    });

    expect(grouped.total).toBe(3);
    expect(grouped.groups).toHaveLength(2);
    const eventGroup = grouped.groups.find((group) => group.groupKey === "evt_merge");
    expect(eventGroup).toMatchObject({
      sourceEventId: "evt_merge",
      total: 2,
      statusCounts: { pending: 2 },
    });
    expect(["job_evt_1a", "job_evt_1b"]).toContain(eventGroup?.latestJob.id);
    expect(grouped.groups.find((group) => group.groupKey === "agb_1")).toMatchObject({
      agentBindingId: "agb_1",
      sourceEventId: null,
      total: 1,
    });
  });

  it("cancels a pending job", async () => {
    enqueueJob(database, {
      jobId: "job_proj1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentTypeId: "agt_1",
      payload: basePayload(),
    });

    const service = new ProjectAgentTaskBoardService(database.db);
    const cancelled = await service.cancel({
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      jobId: "job_proj1",
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("rejects cancelling a job from another project", async () => {
    enqueueJob(database, {
      jobId: "job_proj2",
      workspaceId: "ws_1",
      projectId: "proj_2",
      agentTypeId: "agt_1",
      payload: basePayload({ projectId: "proj_2" }),
    });

    const service = new ProjectAgentTaskBoardService(database.db);
    await expect(
      service.cancel({
        accountId: "default-admin",
        workspaceId: "ws_1",
        projectId: "proj_1",
        jobId: "job_proj2",
      }),
    ).rejects.toBeInstanceOf(ProjectAgentTaskBoardServiceError);
  });

  it("throws not found for unknown job", async () => {
    const service = new ProjectAgentTaskBoardService(database.db);
    await expect(
      service.get({
        accountId: "default-admin",
        workspaceId: "ws_1",
        projectId: "proj_1",
        jobId: "missing",
   }),
    ).rejects.toBeInstanceOf(ProjectAgentTaskBoardServiceError);
  });
});
