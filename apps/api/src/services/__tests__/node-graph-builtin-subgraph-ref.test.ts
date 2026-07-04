import type { NodeGraphDocument } from "@tavern/core";
import {
  CONTINUITY_VERIFIER_SUBGRAPH_ID,
DIRECTOR_ADVISOR_SUBGRAPH_ID,
  buildNativePromptFloorTemplateWithAdvisorRefs,
} from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { floors, nodeGraphNodeRuns, nodeGraphRuns, sessions } from "../../db/schema.js";
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
import { createEventBus } from "@tavern/core";

const ACTOR = {
  actorType: "account" as const,
  actorAccountId: "default-admin",
  actorClientId: null,
};

/**
 * 父图：history -> group.node(ref=system.subgraph.director) -> commit。
 * `granted` 控制父图 manifest 是否声明 director 子图所需的 `project.agent.run`，
 * 用于验证 SG11-3 的权限上卷校验。
 */
function directorRefGraph(granted: boolean, graphId = "ngraph_sg11_director_ref"): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId,
    name: "SG11-3 Director Ref",
    mode: "native_graph",
    policies: {},
    permissions: { required: granted ? ["project.agent.run"] : [] },
    nodes: [
      { id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
      {
        id: "g",
        type: "group.node",
        typeVersion: "1",
        phase: "pre_response",
        config: {
          ref: { graphId: DIRECTOR_ADVISOR_SUBGRAPH_ID },
          interface: {
            inputs: [{ name: "messages", type: "messages" }],
            outputs: [{ name: "brief", type: "agent_brief" }],
          },
        },
      },
    ],
    edges: [
      { id: "e_history_g", kind: "data", from: { nodeId: "history", port: "messages" }, to: { nodeId: "g", port: "messages" } },
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

describe("SG11-3 built-in subgraph reference resolution (worker)", () => {
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

  it("resolves and runs a built-in advisor subgraph via group.node when the permission is granted", async () => {
    const service = new NodeGraphDefinitionService(database.db);
    // 引用版默认楼层模板：director + continuity都经 group.node 引用内置子图，manifest 已声明 project.agent.run。
    const { definition, version } = service.create({
      actor: ACTOR,
      projectId: "proj_1",
      document: { ...buildNativePromptFloorTemplateWithAdvisorRefs(), graphId: "ngraph_sg11_floor_refs" },
    });
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
    const worker = new NodeGraphWorker(database.db, { workerId: "ng-sg11-3-granted", pollIntervalMs: 60_000 });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const run = database.db.select().from(nodeGraphRuns).get();
expect(run?.status).toBe("succeeded");
    const nodeRuns = database.db.select().from(nodeGraphNodeRuns).all();
    const director = nodeRuns.find((node) => node.nodeId === "director");
    const verify = nodeRuns.find((node) => node.nodeId === "verify");
    // group.node 实例成功（内置子图经嵌套 run 执行并映射回边界输出）。
    expect(director?.status).toBe("succeeded");
    expect(verify?.status).toBe("succeeded");
    expect(nodeRuns.some((node) => node.status === "failed")).toBe(false);
  });

it("fails the run when the built-in subgraph requires a permission the parent graph does not declare", async () => {
    const service = new NodeGraphDefinitionService(database.db);
    const { definition, version } = service.create({ actor: ACTOR, projectId: "proj_1", document: directorRefGraph(false) });
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
    const worker = new NodeGraphWorker(database.db, { workerId: "ng-sg11-3-denied", pollIntervalMs: 60_000 });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const run = database.db.select().from(nodeGraphRuns).get();
    expect(run?.status).toBe("failed");
    const nodeRuns = database.db.select().from(nodeGraphNodeRuns).all();
    const groupNode = nodeRuns.find((node) => node.nodeId === "g");
    expect(groupNode?.status).toBe("failed");
    expect(run?.traceJson ?? "").toContain("node_graph_subgraph_permission_not_granted");
  });

  it("runs a built-in subgraph that needs no extra permission (continuity verifier)",async () => {
    const service = new NodeGraphDefinitionService(database.db);
    const document: NodeGraphDocument = {
     schemaVersion: 2,
      graphId: "ngraph_sg11_continuity_ref",
   name: "SG11-3 Continuity Ref",
      mode: "native_graph",
      policies: {},
      permissions: { required: [] },
      nodes: [
        { id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
        { id: "user_input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
        { id: "compose", type: "compose.final_messages", typeVersion: "1", phase: "response" },
        { id: "narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
        {
          id: "verify",
          type: "group.node",
          typeVersion: "1",
          phase: "post_response",
          config: {
            ref: { graphId: CONTINUITY_VERIFIER_SUBGRAPH_ID },
            interface: {
        inputs: [
                { name: "text", type: "text" },
                { name: "context", type: "json" },
              ],
              outputs: [{ name: "result", type: "verifier_result" }],
            },
          },
        },
        { id: "commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
      ],
      edges: [
        { id: "e_history_compose", kind: "data", from: { nodeId: "history", port: "messages" }, to: { nodeId: "compose", port: "messages" } },
        { id: "e_compose_narrator", kind: "data", from: { nodeId: "compose", port: "messages" }, to: { nodeId: "narrator", port: "messages" } },
        { id: "e_user_input_narrator", kind: "data", from: { nodeId: "user_input", port: "text" }, to: { nodeId: "narrator", port: "user_input" } },
        { id: "e_narrator_verify", kind: "data", from: { nodeId: "narrator", port: "text" }, to: { nodeId: "verify", port: "text" } },
        { id: "e_narrator_commit", kind: "data", from: { nodeId: "narrator", port: "text" }, to: { nodeId: "commit", port: "text" } },
        { id: "e_verify_commit", kind: "data", from: { nodeId: "verify", port: "result" }, to: { nodeId: "commit", port: "verifier" } },
      ],
    };
    const { definition, version } = service.create({ actor: ACTOR, projectId: "proj_1", document });
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
    const worker = new NodeGraphWorker(database.db, { workerId: "ng-sg11-3-continuity", pollIntervalMs: 60_000 });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const run = database.db.select().from(nodeGraphRuns).get();
    expect(run?.status).toBe("succeeded");
    const verify = database.db.select().from(nodeGraphNodeRuns).all().find((node) => node.nodeId === "verify");
    expect(verify?.status).toBe("succeeded");
  });
});
