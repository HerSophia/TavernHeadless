import type { NodeGraphConditionExpr, NodeGraphDocument } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { floors, nodeGraphCheckpoints, nodeGraphNodeRuns, nodeGraphRuns, sessions } from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { NodeGraphDefinitionService } from "../node-graph-definition-service.js";
import { type NodeGraphFloorCheckpoint } from "../node-graph-checkpoint-service.js";
import { NodeGraphCheckpointRetentionService } from "../node-graph-checkpoint-retention-service.js";
import {
  NODE_GRAPH_RUN_JOB_TYPE,
  NODE_GRAPH_RUNTIME_SCOPE_TYPE,
  buildNodeGraphRuntimeScopeKey,
  createNodeGraphRuntimeJobCatalog,
  type NodeGraphRunJobPayload,
} from "../node-graph-runtime-job-definitions.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";
import { createDefaultNodeGraphExecutor } from "../node-graph-runtime/index.js";
import { NodeGraphWorker } from "../node-graph-worker.js";
import { createEventBus } from "@tavern/core";

const ACTOR = {
  actorType: "account" as const,
  actorAccountId: "default-admin",
  actorClientId: null,
};

const VARIABLE_ENABLED: NodeGraphConditionExpr = {
  op: "eq",
  left: { source: "variable", path: ["enabled"] },
  right: true,
};

/** branch.true 门控 narrator 的 v2 控制图。 */
function makeBranchGraph(graphId = "ngraph_v2_branch"): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId,
    name: "V2 Branch",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
      { id: "cond", type: "control.condition", typeVersion: "1", phase: "pre_response", config: { condition: VARIABLE_ENABLED } },
      { id: "branch", type: "control.branch", typeVersion: "1", phase: "pre_response" },
      { id: "messages", type: "compose.final_messages", typeVersion: "1", phase: "response" },
      { id: "narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
      { id: "commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
    ],
    edges: [
      { id: "e_history_messages", kind: "data", from: { nodeId: "history", port: "messages" }, to: { nodeId: "messages", port: "messages" } },
      { id: "e_cond_branch", kind: "data", from: { nodeId: "cond", port: "result" }, to: { nodeId: "branch", port: "condition" } },
      { id: "e_messages_narrator", kind: "data", from: { nodeId: "messages", port: "messages" }, to: { nodeId: "narrator", port: "messages" } },
      { id: "e_branch_narrator", kind: "control", from: { nodeId: "branch", port: "true" }, to: { nodeId: "narrator", port: "messages" } },
      { id: "e_narrator_commit", kind: "data", from: { nodeId: "narrator", port: "text" }, to: { nodeId: "commit", port: "text" } },
    ],
  };
}

/** gate.open 门控 target 的 v2 控制图，gate onSkip=use_default。 */
function makeGateGraph(graphId = "ngraph_v2_gate"): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId,
    name: "V2 Gate",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "cond", type: "control.condition", typeVersion: "1", phase: "pre_response", config: { condition: VARIABLE_ENABLED } },
      { id: "gate", type: "control.gate", typeVersion: "1", phase: "pre_response", config: { onSkip: "use_default" } },
      {
        id: "target",
        type: "compose.template_render",
        typeVersion: "1",
        phase: "pre_response",
        config: { template: "rendered-{{enabled}}", defaultValue: "DEFAULTED" },
      },
    ],
    edges: [
      { id: "e_cond_gate", kind: "data", from: { nodeId: "cond", port: "result" }, to: { nodeId: "gate", port: "condition" } },
      { id: "e_gate_target", kind: "control", from: { nodeId: "gate", port: "open" }, to: { nodeId: "target", port: "data" } },
    ],
  };
}

/** history 节点声明 floor_stable scope，可进入 floor checkpoint。 */
function makeCheckpointGraph(graphId = "ngraph_v2_checkpoint"): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId,
    name: "V2 Checkpoint",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response", scope: "floor_stable" },
      { id: "messages", type: "compose.final_messages", typeVersion: "1", phase: "response" },
      { id: "narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
      { id: "commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
    ],
    edges: [
      { id: "e_history_messages", kind: "data", from: { nodeId: "history", port: "messages" }, to: { nodeId: "messages", port: "messages" } },
      { id: "e_messages_narrator", kind: "data", from: { nodeId: "messages", port: "messages" }, to: { nodeId: "narrator", port: "messages" } },
      { id: "e_narrator_commit", kind: "data", from: { nodeId: "narrator", port: "text" }, to: { nodeId: "commit", port: "text" } },
    ],
  };
}

function enqueueGraphRun(database: DatabaseConnection, payload: NodeGraphRunJobPayload): void {
  const scheduler = new RuntimeJobScheduler(createNodeGraphRuntimeJobCatalog(), { eventBus: createEventBus() });
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
      sessionId: payload.sessionId ?? null,
      floorId: payload.floorId ?? null,
      payload,
    });
  });
}

describe("NodeGraph v2 runtime: control flow", () => {
  it("runs the narrator when the branch is active", async () => {
    const executor = createDefaultNodeGraphExecutor();
    const result = await executor.execute({
      document: makeBranchGraph(),
      graphVersionId: "v1",
      context: {
        accountId: "a",
        workspaceId: "w",
        projectId: "p",
        intent: "normal",
        dryRun: false,
        variables: { enabled: true },
        chatHistory: [{ role: "user", content: "hi" }],
      },
    });
    expect(result.status).toBe("succeeded");
    const narrator = result.nodeRuns.find((run) => run.nodeId === "narrator");
    expect(narrator?.status).toBe("succeeded");
    expect(result.trace.controlSkippedNodes).toEqual([]);
  });

  it("gates the narrator off when the branch is inactive", async () => {
    const executor = createDefaultNodeGraphExecutor();
    const result = await executor.execute({
      document: makeBranchGraph(),
      graphVersionId: "v1",
      context: {
        accountId: "a",
        workspaceId: "w",
        projectId: "p",
        intent: "normal",
        dryRun: false,
        variables: { enabled: false },
        chatHistory: [{ role: "user", content: "hi" }],
      },
    });
    expect(result.status).toBe("succeeded");
    const narrator = result.nodeRuns.find((run) => run.nodeId === "narrator");
    expect(narrator?.status).toBe("skipped");
    expect(result.trace.controlSkippedNodes).toEqual([{ nodeId: "narrator", onSkip: "empty_output" }]);
  });

  it("applies gate onSkip=use_default when the gate is closed", async () => {
    const executor = createDefaultNodeGraphExecutor();
    const result = await executor.execute({
      document: makeGateGraph(),
      graphVersionId: "v1",
      context: {
        accountId: "a",
        workspaceId: "w",
        projectId: "p",
        intent: "normal",
        dryRun: false,
        variables: { enabled: false },
      },
    });
    expect(result.status).toBe("succeeded");
    const target = result.nodeRuns.find((run) => run.nodeId === "target");
    expect(target?.status).toBe("succeeded");
    expect(target?.output.value).toBe("DEFAULTED");
  });
});

describe("NodeGraph v2 runtime: checkpoint reuse (executor)", () => {
  it("reuses a floor checkpoint when input and config hashes match", async () => {
    const executor = createDefaultNodeGraphExecutor();
    const baseContext = {
      accountId: "a",
      workspaceId: "w",
      projectId: "p",
      floorId: "floor_1",
      intent: "normal" as const,
      dryRun: false,
      chatHistory: [{ role: "user", content: "hi" }],
    };

    const first = await executor.execute({ document: makeCheckpointGraph(), graphVersionId: "v1", context: baseContext });
    const historyRun = first.nodeRuns.find((run) => run.nodeId === "history");
    expect(historyRun?.status).toBe("succeeded");
    expect(historyRun?.checkpointEligible).toBe(true);

    const floorCheckpoints = new Map<string, NodeGraphFloorCheckpoint>([[
      "history",
      {
        nodeId: "history",
        inputHash: historyRun!.inputHash!,
        configHash: historyRun!.configHash!,
        phase: "pre_response",
        scope: "floor_stable",
        output: historyRun!.output,
      },
    ]]);

    const second = await executor.execute({ document: makeCheckpointGraph(), graphVersionId: "v1", context: baseContext, floorCheckpoints });
    const reused = second.nodeRuns.find((run) => run.nodeId === "history");
    expect(reused?.status).toBe("reused");
    expect(reused?.checkpointReuse).toEqual({ decision: "reuse", reason: "input_hash_match" });
    expect(second.trace.checkpointReuse.reused).toContain("history");
  });
});

describe("NodeGraph v2 runtime: checkpoint persistence (worker)", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    createTestProject(database.db, { accountId: "default-admin", workspaceId: "ws_1", id: "proj_1" });
    database.db.insert(sessions).values({
      id: "sess_1",
      title: "S",
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    }).run();
    database.db.insert(floors).values({
      id: "floor_1",
      sessionId: "sess_1",
      floorNo: 1,
      branchId: "main",
      state: "generating",
      createdAt: 1,
      updatedAt: 1,
    }).run();
  });

  afterEach(() => {
    database?.close();
  });

  it("persists floor checkpoints and reuses them on a later run", async () => {
    const service = new NodeGraphDefinitionService(database.db);
    const { definition, version } = service.create({ actor: ACTOR, projectId: "proj_1", document: makeCheckpointGraph() });

    const basePayload: NodeGraphRunJobPayload = {
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      graphId: definition.id,
      graphVersionId: version.id,
      sessionId: "sess_1",
      floorId: "floor_1",
      intent: "normal",
      dryRun: false,
      inputJson: { chat_history: [{ role: "user", content: "hello" }] },
    };

    enqueueGraphRun(database, basePayload);
    const worker = new NodeGraphWorker(database.db, { workerId: "ng-v2-cp-1", pollIntervalMs: 60_000 });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const checkpoints = database.db.select().from(nodeGraphCheckpoints).all();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({ nodeId: "history", floorId: "floor_1", scope: "floor_stable" });

    // 第二次运行同一 floor + version + input：history 应复用 checkpoint。
    enqueueGraphRun(database, basePayload);
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const runs = database.db.select().from(nodeGraphRuns).all();
    expect(runs).toHaveLength(2);
    const secondRun = runs.sort((left, right) => right.createdAt - left.createdAt)[0]!;
    const secondNodeRuns = database.db
      .select()
      .from(nodeGraphNodeRuns)
      .all()
      .filter((run) => run.graphRunId === secondRun.id);
    const historyRun = secondNodeRuns.find((run) => run.nodeId === "history");
    expect(historyRun?.status).toBe("reused");
  });

  it("redacts checkpoint bodies after the retention grace window", async () => {
    const service = new NodeGraphDefinitionService(database.db);
    const { definition, version } = service.create({ actor: ACTOR, projectId: "proj_1", document: makeCheckpointGraph("ngraph_v2_cp_retention") });

    enqueueGraphRun(database, {
      accountId: "default-admin",
      workspaceId: "ws_1",
      projectId: "proj_1",
      graphId: definition.id,
      graphVersionId: version.id,
      sessionId: "sess_1",
      floorId: "floor_1",
      intent: "normal",
      dryRun: false,
      inputJson: { chat_history: [{ role: "user", content: "hello" }] },
    });
    const worker = new NodeGraphWorker(database.db, { workerId: "ng-v2-cp-retention", pollIntervalMs: 60_000 });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(database.db.select().from(nodeGraphCheckpoints).get()?.outputJson).not.toBeNull();

    const result = new NodeGraphCheckpointRetentionService(database.db).run({ retentionGraceMs: 0 });
    expect(result.cleaned).toBe(1);
    const checkpoint = database.db.select().from(nodeGraphCheckpoints).get();
    expect(checkpoint?.outputJson).toBeNull();
    expect(checkpoint?.cleanedAt).not.toBeNull();
    // 结构、hash 仍保留供审计与命中率统计。
    expect(checkpoint?.inputHash).toBeTruthy();
  });
});
