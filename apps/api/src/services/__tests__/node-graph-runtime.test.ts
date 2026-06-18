import { createEventBus, type NodeGraphDocument } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  agentTypes,
  derivedOutputs,
  nodeGraphDefinitions,
  nodeGraphNodeRuns,
  nodeGraphRuns,
  nodeGraphVersions,
  operationLogs,
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
import { createDefaultNodeGraphExecutor, previewNodeGraph } from "../node-graph-runtime/index.js";
import { NodeGraphWorker } from "../node-graph-worker.js";
import { AgentExecutorRouter } from "../agent-runtime/agent-executor-router.js";
import { AgentJobTriggerBackgroundJobEnqueuer } from "../agent-runtime/background-job-enqueuer.js";

const ACTOR = {
  actorType: "account" as const,
  actorAccountId: "default-admin",
  actorClientId: null,
};

function makeGraph(graphId = "ngraph_test"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Test NodeGraph",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
      { id: "messages", type: "compose.final_messages", typeVersion: "1", phase: "response" },
      { id: "narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
      { id: "commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
    ],
    edges: [
      {
        id: "e_history_messages",
        kind: "data",
        from: { nodeId: "history", port: "messages" },
        to: { nodeId: "messages", port: "messages" },
      },
      {
        id: "e_messages_narrator",
        kind: "data",
        from: { nodeId: "messages", port: "messages" },
        to: { nodeId: "narrator", port: "messages" },
      },
      {
        id: "e_narrator_commit",
        kind: "data",
        from: { nodeId: "narrator", port: "text" },
        to: { nodeId: "commit", port: "text" },
      },
    ],
  };
}

function makeBackgroundAgentCallGraph(graphId = "ngraph_agent_call"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Background Agent Call",
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
        medium: {
          kind: "background_job",
          deliveryTarget: "derived_output",
        },
      },
    }],
    edges: [],
  };
}

function makeSingleCallAgentGraph(
  graphId = "ngraph_single_call",
  failurePolicy: "fail_closed" | "fail_open" | "skip" | "use_default" = "fail_closed",
): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Single Call Agent",
    mode: "native_graph",
    policies: {},
    permissions: { required: ["project.agent.run"] },
    nodes: [{
      id: "agent",
      type: "agent.call",
      typeVersion: "1",
      phase: "pre_response",
      failurePolicy,
      config: {
        medium: { kind: "single_call", deliveryTarget: "return_inline" },
        defaultValue: { fallback: true },
      },
    }],
    edges: [],
  };
}

function makeDerivedOutputGraph(graphId = "ngraph_output_commit"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Derived Output Commit",
    mode: "native_graph",
    policies: { allowPersistentOutputs: true },
    permissions: { required: ["project.derived_output.write"] },
    nodes: [
      { id: "value", type: "source.character", typeVersion: "1", phase: "pre_response" },
      { id: "write", type: "output.derived_output", typeVersion: "1", phase: "commit" },
    ],
    edges: [{
      id: "e_value_write",
      kind: "data",
      from: { nodeId: "value", port: "json" },
      to: { nodeId: "write", port: "value" },
    }],
  };
}

function makeManifestRestrictedOutputGraph(graphId = "ngraph_manifest_restricted"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Manifest Restricted Output",
    mode: "native_graph",
    policies: { allowPersistentOutputs: true },
    // R6-3（缺口 6）：manifest 只允许 project_inbox，derived_output 应在 commit 被拒绝。
    permissions: { required: ["project.derived_output.write"], outputTargets: ["project_inbox"] },
    nodes: [
      { id: "value", type: "source.character", typeVersion: "1", phase: "pre_response" },
      { id: "write", type: "output.derived_output", typeVersion: "1", phase: "commit" },
    ],
    edges: [{
      id: "e_value_write",
      kind: "data",
      from: { nodeId: "value", port: "json" },
      to: { nodeId: "write", port: "value" },
    }],
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

describe("NodeGraph runtime", () => {
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

  it("creates a definition and immutable current version", () => {
    const service = new NodeGraphDefinitionService(database.db);
    const result = service.create({
      actor: ACTOR,
      projectId: "proj_1",
      document: makeGraph(),
      now: 100,
    });

    expect(result.validation.isExecutable).toBe(true);
    expect(result.definition.currentVersionId).toBe(result.version.id);
    expect(database.db.select().from(nodeGraphDefinitions).all()).toHaveLength(1);
    expect(database.db.select().from(nodeGraphVersions).all()).toHaveLength(1);
  });

  it("previews a graph without writing run rows", async () => {
    const service = new NodeGraphDefinitionService(database.db);
    const { version } = service.create({
      actor: ACTOR,
      projectId: "proj_1",
      document: makeGraph("ngraph_preview"),
    });

    const result = await previewNodeGraph(createDefaultNodeGraphExecutor(), {
      document: version.document,
      graphVersionId: version.id,
      context: {
        accountId: "default-admin",
        workspaceId: "ws_1",
        projectId: "proj_1",
        input: { chat_history: [{ role: "user", content: "Hello" }] },
        chatHistory: [{ role: "user", content: "Hello" }],
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.nodeOutputs.messages?.preview?.kind).toBe("messages");
    expect(result.trace.statusCounts.succeeded).toBeGreaterThan(0);
    expect(database.db.select().from(nodeGraphRuns).all()).toHaveLength(0);
  });

  it("records node failurePolicy outcomes in executor trace", async () => {
    const executor = createDefaultNodeGraphExecutor();
    const baseContext = {
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      intent: "normal" as const,
      dryRun: false,
      input: { value: "hello" },
      agentRouter: new AgentExecutorRouter(),
    };

    const failClosed = await executor.execute({
      document: makeSingleCallAgentGraph("ngraph_fail_closed", "fail_closed"),
      context: baseContext,
    });
    expect(failClosed.status).toBe("failed");
    expect(failClosed.trace.failedNodeId).toBe("agent");
    expect(failClosed.nodeRuns[0]).toMatchObject({ nodeId: "agent", status: "failed" });

    const skipped = await executor.execute({
      document: makeSingleCallAgentGraph("ngraph_skip", "skip"),
      context: baseContext,
    });
    expect(skipped.status).toBe("succeeded");
    expect(skipped.nodeRuns[0]?.status).toBe("skipped");

    const useDefault = await executor.execute({
      document: makeSingleCallAgentGraph("ngraph_default", "use_default"),
      context: baseContext,
    });
    expect(useDefault.status).toBe("succeeded");
    expect(useDefault.nodeRuns[0]).toMatchObject({
      status: "succeeded",
      output: { value: { fallback: true } },
    });
  });

  it("processes graph.run jobs and writes run trace rows", async () => {
    const service = new NodeGraphDefinitionService(database.db);
    const { definition, version } = service.create({
      actor: ACTOR,
      projectId: "proj_1",
      document: makeGraph("ngraph_worker"),
    });

    enqueueGraphRun(database, {
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      graphId: definition.id,
      graphVersionId: version.id,
      intent: "dry_run",
      dryRun: true,
      inputJson: { chat_history: [{ role: "user", content: "Hello" }] },
    });

    const worker = new NodeGraphWorker(database.db, {
      workerId: "node-graph-worker-test",
      pollIntervalMs: 60_000,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const runs = database.db.select().from(nodeGraphRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      graphId: definition.id,
      graphVersionId: version.id,
      status: "succeeded",
      intent: "dry_run",
    });
    expect(database.db.select().from(nodeGraphNodeRuns).all()).toHaveLength(4);
  });

  it("dispatches persistent outputs only during successful commit", async () => {
    const service = new NodeGraphDefinitionService(database.db);
    const { definition, version } = service.create({
      actor: ACTOR,
      projectId: "proj_1",
      document: makeDerivedOutputGraph(),
    });

    enqueueGraphRun(database, {
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      graphId: definition.id,
      graphVersionId: version.id,
      intent: "normal",
      dryRun: false,
      inputJson: { character: { name: "Ada" } },
    });

    const worker = new NodeGraphWorker(database.db, {
      workerId: "node-graph-worker-output-test",
      pollIntervalMs: 60_000,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const outputs = database.db.select().from(derivedOutputs).all();
    expect(outputs).toHaveLength(1);
    const run = database.db.select().from(nodeGraphRuns).limit(1).get();
    expect(run?.status).toBe("succeeded");
    const trace = JSON.parse(run!.traceJson!);
    expect(trace).toMatchObject({
      runtime_kind: "node_graph_run",
      contract_version: "b8-governance.v1",
      reason_code: "succeeded",
      side_effects: {
        output_dispatch: {
          count: 1,
          dispatched: 1,
          result_count: 1,
          targets: ["derived_output"],
        },
      },
    });
    expect(trace.outputDispatchRefs[0]).toMatchObject({
      nodeId: "write",
      target: "derived_output",
      status: "dispatched",
    });

    // R6-1（缺口 1）：成功 run 写运行级 operation log 与 output_dispatched。
    const logs = database.db.select().from(operationLogs).all();
    const actions = logs.map((log) => log.action);
    expect(actions).toContain("node_graph_run.run");
    expect(actions).toContain("node_graph_run.output_dispatched");
    const runLog = logs.find((log) => log.action === "node_graph_run.run");
    expect(runLog?.status).toBe("succeeded");
    expect(runLog?.runId).toBe(run!.id);
    expect(runLog?.targetId).toBe(run!.id);
  });

  it("writes failed graph trace without dispatching outputs", async () => {
    const service = new NodeGraphDefinitionService(database.db);
    const { definition, version } = service.create({
      actor: ACTOR,
      projectId: "proj_1",
      document: makeSingleCallAgentGraph("ngraph_failed_worker", "fail_closed"),
    });

    enqueueGraphRun(database, {
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      graphId: definition.id,
      graphVersionId: version.id,
      intent: "normal",
      dryRun: false,
      inputJson: { value: "fail" },
    });

    const worker = new NodeGraphWorker(database.db, {
      workerId: "node-graph-worker-failed-test",
      pollIntervalMs: 60_000,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(database.db.select().from(derivedOutputs).all()).toHaveLength(0);
    const run = database.db.select().from(nodeGraphRuns).limit(1).get();
    expect(run?.status).toBe("failed");
    const trace = JSON.parse(run!.traceJson!);
    expect(trace.failedNodeId).toBe("agent");
    expect(trace.statusCounts.failed).toBe(1);
    expect(trace).toMatchObject({
      runtime_kind: "node_graph_run",
      reason_code: "node_graph_agent_router_missing",
      diagnostics: {
        failed_node_id: "agent",
        failed_node_count: 1,
      },
    });
    expect(database.db.select().from(nodeGraphNodeRuns).all()[0]).toMatchObject({
      nodeId: "agent",
      status: "failed",
    });

    // R6-1（缺口 1）：失败 run 写 node_graph_run.failed，不写 output_dispatched。
    const logs = database.db.select().from(operationLogs).all();
    const failedLog = logs.find((log) => log.action === "node_graph_run.failed");
    expect(failedLog?.status).toBe("failed");
    expect(failedLog?.runId).toBe(run!.id);
    expect(logs.map((log) => log.action)).not.toContain("node_graph_run.output_dispatched");
  });

  it("rejects persistent outputs not allowed by the graph permission manifest", async () => {
    const service = new NodeGraphDefinitionService(database.db);
    const { definition, version } = service.create({
      actor: ACTOR,
      projectId: "proj_1",
      document: makeManifestRestrictedOutputGraph(),
    });

    enqueueGraphRun(database, {
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      graphId: definition.id,
      graphVersionId: version.id,
      intent: "normal",
      dryRun: false,
      inputJson: { character: { name: "Ada" } },
    });

    const worker = new NodeGraphWorker(database.db, {
      workerId: "node-graph-worker-manifest-test",
      pollIntervalMs: 60_000,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    // 输出目标被 manifest 拒绝：不落库。
    expect(database.db.select().from(derivedOutputs).all()).toHaveLength(0);

    const run = database.db.select().from(nodeGraphRuns).limit(1).get();
    expect(run?.status).toBe("succeeded");
    const trace = JSON.parse(run!.traceJson!);
    expect(trace.outputDispatchRefs[0]).toMatchObject({
      nodeId: "write",
      target: "derived_output",
      status: "rejected",
      reason: "node_graph_output_target_not_in_manifest",
    });
    expect(trace.side_effects.output_dispatch).toMatchObject({ rejected: 1, dispatched: 0 });

    // R6-3（缺口 6）：被拒输出写 node_graph_run.output_rejected，不写 output_dispatched。
    const logs = database.db.select().from(operationLogs).all();
    const actions = logs.map((log) => log.action);
    expect(actions).toContain("node_graph_run.output_rejected");
    expect(actions).not.toContain("node_graph_run.output_dispatched");
    const rejectedLog = logs.find((log) => log.action === "node_graph_run.output_rejected");
    expect(rejectedLog?.status).toBe("denied");
    expect(JSON.parse(rejectedLog!.metadataJson!)).toMatchObject({
      target: "derived_output",
      reason_code: "node_graph_output_target_not_in_manifest",
    });
  });

  it("routes agent.call background_job nodes through the production enqueuer", async () => {
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
      inputJson: { value: "enqueue agent" },
    });

    const worker = new NodeGraphWorker(database.db, {
      workerId: "node-graph-worker-agent-call-test",
      pollIntervalMs: 60_000,
      agentRouter: new AgentExecutorRouter(undefined, {
        backgroundJobEnqueuer: new AgentJobTriggerBackgroundJobEnqueuer(database.db),
      }),
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(database.db.select().from(runtimeJobs).all().map((job) => job.jobType)).toContain("agent.run");
    const graphRun = database.db.select().from(nodeGraphRuns).limit(1).get()!;
    const runTrace = JSON.parse(graphRun.traceJson!);
    expect(runTrace.nestedJobRefs[0]).toMatchObject({
      nodeId: "agent",
      medium: "background_job",
    });

    // R6-1（缺口 3）：nested lineage 双向化。被入队的 agent.run job payload 记录
    // parent_run_id == graphRunId，与 graph trace 的 nestedJobRefs(jobId) 互相可查。
    const agentJob = database.db.select().from(runtimeJobs).all().find((job) => job.jobType === "agent.run")!;
    const agentPayload = JSON.parse(agentJob.payloadJson);
    expect(agentPayload.lineage).toMatchObject({
      parentRunId: graphRun.id,
      rootRunId: graphRun.id,
      parentRuntimeKind: "node_graph_run",
    });
    expect(runTrace.nestedJobRefs[0].jobId).toBe(agentJob.id);
  });
});
