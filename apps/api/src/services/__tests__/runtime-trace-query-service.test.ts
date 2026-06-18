import { createEventBus, type NodeGraphDocument } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  agentTypes,
  nodeGraphRuns,
  projectAgentBindings,
  runtimeJobs,
} from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { NodeGraphDefinitionService } from "../node-graph-definition-service.js";
import {
  NODE_GRAPH_RUN_JOB_TYPE,
  NODE_GRAPH_RUNTIME_SCOPE_TYPE,
  buildNodeGraphRuntimeScopeKey,
  createNodeGraphRuntimeJobCatalog,
  type NodeGraphRunJobPayload,
} from "../node-graph-runtime-job-definitions.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";
import { NodeGraphWorker } from "../node-graph-worker.js";
import { AgentExecutorRouter } from "../agent-runtime/agent-executor-router.js";
import { AgentJobTriggerBackgroundJobEnqueuer } from "../agent-runtime/background-job-enqueuer.js";
import { RuntimeTraceQueryService } from "../agent-runtime/runtime-trace-query-service.js";

const ACTOR = {
  actorType: "account" as const,
  actorAccountId: "default-admin",
  actorClientId: null,
};

function makeBackgroundAgentCallGraph(graphId = "ngraph_trace_agent_call"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Trace Agent Call",
    mode: "native_graph",
    policies: { allowBackgroundJobs: true },
    permissions: { required: ["project.agent.run"] },
    nodes: [{
      id: "agent",
      type: "agent.call",
      typeVersion: "1",
      phase: "pre_response",
      config: {
        agentBindingId: "agb_1",
        medium: { kind: "background_job", deliveryTarget: "derived_output" },
      },
    }],
    edges: [],
  };
}

function seedAgentBinding(database: DatabaseConnection): void {
  database.db.insert(agentTypes).values({
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
    defaultGrantsJson: JSON.stringify({ allowed_output_targets: ["derived_output"] }),
    metadataJson: "{}",
    createdAt: 1,
    updatedAt: 1,
  }).run();
  database.db.insert(projectAgentBindings).values({
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
    grantsJson: JSON.stringify({ allowed_output_targets: ["derived_output"] }),
    metadataJson: "{}",
    createdAt: 1,
    updatedAt: 1,
  }).run();
}

function enqueueGraphRun(database: DatabaseConnection, payload: NodeGraphRunJobPayload): void {
  const catalog = createNodeGraphRuntimeJobCatalog();
  const scheduler = new RuntimeJobScheduler(catalog, { eventBus: createEventBus() });
  database.db.transaction((tx) => {
    scheduler.enqueue(tx, {
      jobType: NODE_GRAPH_RUN_JOB_TYPE,
      accountId: payload.accountId,
      scopeType: NODE_GRAPH_RUNTIME_SCOPE_TYPE,
      scopeKey: buildNodeGraphRuntimeScopeKey({
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        graphId: payload.graphId,
      }),
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      payload,
    });
  });
}

async function runBackgroundAgentCallGraph(database: DatabaseConnection): Promise<{ graphRunId: string; agentJobId: string }> {
  seedAgentBinding(database);
  const service = new NodeGraphDefinitionService(database.db);
  const { definition, version } = service.create({
    actor: ACTOR,
    projectId: "proj_1",
    document: makeBackgroundAgentCallGraph(),
  });

  enqueueGraphRun(database, {
    accountId: "default-admin",
    workspaceId: "ws_1",
    projectId: "proj_1",
    graphId: definition.id,
    graphVersionId: version.id,
    intent: "normal",
    dryRun: false,
    inputJson: { value: "trace agent" },
  });

  const worker = new NodeGraphWorker(database.db, {
    workerId: "node-graph-worker-trace-test",
    pollIntervalMs: 60_000,
    agentRouter: new AgentExecutorRouter(undefined, {
      backgroundJobEnqueuer: new AgentJobTriggerBackgroundJobEnqueuer(database.db),
    }),
  });
  await worker.processOneDueJob();

  const graphRun = database.db.select().from(nodeGraphRuns).limit(1).get()!;
  const agentJob = database.db.select().from(runtimeJobs).all().find((job) => job.jobType === "agent.run")!;
  return { graphRunId: graphRun.id, agentJobId: agentJob.id };
}

describe("RuntimeTraceQueryService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    createTestProject(database.db, {
      accountId: "default-admin",
      workspaceId: "ws_1",
      id: "proj_1",
    });
  });

  afterEach(() => {
    database?.close();
  });

  it("aggregates node graph runs and agent jobs into unified entries", async () => {
    const { graphRunId, agentJobId } = await runBackgroundAgentCallGraph(database);

    const service = new RuntimeTraceQueryService(database.db);
    const result = service.query({ accountId: "default-admin", projectId: "proj_1" });

    const graphRunEntry = result.entries.find((entry) => entry.source === "node_graph_run");
    expect(graphRunEntry).toBeDefined();
    expect(graphRunEntry?.runtimeKind).toBe("node_graph_run");
    expect(graphRunEntry?.runId).toBe(graphRunId);

    const agentJobEntry = result.entries.find((entry) => entry.source === "runtime_job" && entry.jobType === "agent.run");
    expect(agentJobEntry).toBeDefined();
    expect(agentJobEntry?.runtimeKind).toBe("agent_run");
    expect(agentJobEntry?.id).toBe(agentJobId);
    expect(agentJobEntry?.parentRunId).toBe(graphRunId);
  });

  it("resolves graph run -> nested agent job lineage (parent -> child)", async () => {
    const { graphRunId, agentJobId } = await runBackgroundAgentCallGraph(database);

    const service = new RuntimeTraceQueryService(database.db);
    const lineage = service.resolveGraphRunLineage({
      accountId: "default-admin",
      projectId: "proj_1",
      graphRunId,
    });

    expect(lineage.run?.runId).toBe(graphRunId);
    expect(lineage.nodeRuns).toHaveLength(1);
    expect(lineage.nestedJobs.map((job) => job.id)).toContain(agentJobId);
    expect(lineage.nestedJobs[0]?.parentRunId).toBe(graphRunId);
  });

  it("resolves agent job -> parent run lineage (child -> parent)", async () => {
    const { graphRunId, agentJobId } = await runBackgroundAgentCallGraph(database);

    const service = new RuntimeTraceQueryService(database.db);
    const lineage = service.resolveAgentJobLineage({
      accountId: "default-admin",
      jobId: agentJobId,
    });

    expect(lineage.job?.id).toBe(agentJobId);
    expect(lineage.job?.parentRuntimeKind).toBe("node_graph_run");
    expect(lineage.parentRun?.runId).toBe(graphRunId);
    expect(lineage.parentRun?.source).toBe("node_graph_run");
  });

  it("includes governance operation logs when requested", async () => {
    const { graphRunId } = await runBackgroundAgentCallGraph(database);

    const service = new RuntimeTraceQueryService(database.db);
    const result = service.query({
      accountId: "default-admin",
      projectId: "proj_1",
      includeOperationLogs: true,
    });

    const runLog = result.entries.find(
      (entry) => entry.source === "operation_log" && entry.action === "node_graph_run.run",
    );
    expect(runLog).toBeDefined();
    expect(runLog?.runId).toBe(graphRunId);
  });

  it("enforces account isolation", async () => {
    await runBackgroundAgentCallGraph(database);

    const service = new RuntimeTraceQueryService(database.db);
    const result = service.query({ accountId: "someone-else" });
    expect(result.entries).toHaveLength(0);
  });
});
