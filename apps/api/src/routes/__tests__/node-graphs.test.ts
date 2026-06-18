import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeGraphDocument } from "@tavern/core";

import { buildApp } from "../../app.js";
import type { DatabaseConnection } from "../../db/client.js";
import { nodeGraphRuns, operationLogs } from "../../db/schema.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectMembershipService } from "../../services/project-membership-service.js";
import { NodeGraphWorker } from "../../services/node-graph-worker.js";

const OWNER_ACCOUNT_ID = "node-graphs-owner";
const OBSERVER_ACCOUNT_ID = "node-graphs-observer";
const OTHER_ACCOUNT_ID = "node-graphs-other";
const OWNER_KEY = "node-graphs-owner-key";
const OBSERVER_KEY = "node-graphs-observer-key";
const OTHER_KEY = "node-graphs-other-key";
const WORKSPACE_ID = "ws_node_graphs";
const PROJECT_ID = "proj_node_graphs";

type TestApp = {
  app: FastifyInstance;
  database: DatabaseConnection["db"];
};

function authHeaders(apiKey: string) {
  return { "x-api-key": apiKey };
}

function createMvpDocument(graphId = "ngraph_route_mvp"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Route MVP",
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

function createFailingAgentDocument(graphId = "ngraph_route_failed"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Route Failed",
    mode: "native_graph",
    policies: {},
    permissions: { required: ["project.agent.run"] },
    nodes: [{
      id: "agent",
      type: "agent.call",
      typeVersion: "1",
      phase: "pre_response",
      config: { medium: { kind: "single_call", deliveryTarget: "return_inline" } },
    }],
    edges: [],
  };
}

async function buildNodeGraphsApp(): Promise<TestApp> {
  const built = await buildApp({
    databasePath: ":memory:",
    logger: false,
    accountMode: "multi",
    auth: {
      mode: "api_key",
      apiKeys: [OWNER_KEY, OBSERVER_KEY, OTHER_KEY],
      apiKeyAccountMap: {
        [OWNER_KEY]: OWNER_ACCOUNT_ID,
        [OBSERVER_KEY]: OBSERVER_ACCOUNT_ID,
        [OTHER_KEY]: OTHER_ACCOUNT_ID,
      },
    },
  });

  ensureTestAccount(built.database, OWNER_ACCOUNT_ID);
  ensureTestAccount(built.database, OBSERVER_ACCOUNT_ID);
  ensureTestAccount(built.database, OTHER_ACCOUNT_ID);
  createTestProject(built.database, {
    accountId: OWNER_ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    id: PROJECT_ID,
  });
  new ProjectMembershipService(built.database).addObserver({
    actorAccountId: OWNER_ACCOUNT_ID,
    projectId: PROJECT_ID,
    accountId: OBSERVER_ACCOUNT_ID,
  });

  return { app: built.app, database: built.database };
}

describe("NodeGraph routes", () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildNodeGraphsApp();
  });

  afterEach(async () => {
    await testApp.app.close();
  });

  it("creates, previews, enqueues and reads a graph run trace", async () => {
    const createResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        document: createMvpDocument(),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    expect(created.definition.id).toBe("ngraph_route_mvp");
    expect(created.validation.isExecutable).toBe(true);

    const previewResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_route_mvp/preview`,
      headers: authHeaders(OBSERVER_KEY),
      payload: {
        node_id: "messages",
        chat_history: [{ role: "user", content: "hello" }],
      },
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json();
    expect(preview.status).toBe("succeeded");
    expect(Object.keys(preview.nodeOutputs)).toEqual(["messages"]);

    const runDenied = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_route_mvp/run`,
      headers: authHeaders(OBSERVER_KEY),
      payload: { dry_run: true },
    });
    expect(runDenied.statusCode).toBe(403);

    const runResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_route_mvp/run`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        intent: "dry_run",
        dry_run: true,
        input_json: { user_input: "hello" },
      },
    });
    expect(runResponse.statusCode).toBe(202);
    // R6-3（缺口 7）：测试 app 未启用 NodeGraph worker，入队响应提示 worker_enabled=false。
    expect(runResponse.json().worker_enabled).toBe(false);

    const worker = new NodeGraphWorker(testApp.database, {
      workerId: "node-graph-worker-test",
      pollIntervalMs: 60_000,
    });
    await worker.processOneDueJob();

    const run = testApp.database.select().from(nodeGraphRuns).limit(1).get();
    expect(run?.status).toBe("succeeded");

    const traceResponse = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/node-graph-runs/${run!.id}`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(traceResponse.statusCode).toBe(200);
    const trace = traceResponse.json();
    expect(trace.run.id).toBe(run!.id);
    expect(trace.node_runs.map((nodeRun: { phase: string }) => nodeRun.phase)).toContain("commit");
  });

  it("layers node output visibility behind manage debug permission", async () => {
    await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs`,
      headers: authHeaders(OWNER_KEY),
      payload: { document: createMvpDocument("ngraph_visibility") },
    });
    const runResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_visibility/run`,
      headers: authHeaders(OWNER_KEY),
      payload: { intent: "dry_run", dry_run: true, input_json: { user_input: "hello" } },
    });
    expect(runResponse.statusCode).toBe(202);

    const worker = new NodeGraphWorker(testApp.database, {
      workerId: "node-graph-worker-visibility-test",
      pollIntervalMs: 60_000,
    });
    await worker.processOneDueJob();
    const run = testApp.database.select().from(nodeGraphRuns).limit(1).get();
    expect(run?.status).toBe("succeeded");

    // Default (no include flag): node output bodies are redacted.
    const redacted = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/node-graph-runs/${run!.id}`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(redacted.statusCode).toBe(200);
    const redactedBody = redacted.json();
    expect(redactedBody.restricted).toBe(true);
    const messagesNode = redactedBody.node_runs.find((nodeRun: { node_id: string }) => nodeRun.node_id === "messages");
    expect(messagesNode.preview).toBeNull();
    expect(messagesNode.restricted).toBe(true);

    // Manage caller with include_node_output: full bodies + inspect audit.
    const debug = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/node-graph-runs/${run!.id}?include_node_output=true`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(debug.statusCode).toBe(200);
    const debugBody = debug.json();
    expect(debugBody.restricted).toBe(false);
    const debugMessagesNode = debugBody.node_runs.find((nodeRun: { node_id: string }) => nodeRun.node_id === "messages");
    expect(debugMessagesNode.preview).not.toBeNull();
    expect(debugMessagesNode.restricted).toBe(false);

    const inspectLogs = testApp.database.select().from(operationLogs).all()
      .filter((log) => log.action === "node_graph_run.inspect");
    expect(inspectLogs).toHaveLength(1);

    // Observer (read-only, no manage): include flag is silently ignored.
    const observer = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/node-graph-runs/${run!.id}?include_node_output=true`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(observer.statusCode).toBe(200);
    const observerBody = observer.json();
    expect(observerBody.restricted).toBe(true);
    const observerMessagesNode = observerBody.node_runs.find((nodeRun: { node_id: string }) => nodeRun.node_id === "messages");
    expect(observerMessagesNode.preview).toBeNull();
  });

  it("governs archive, unarchive and current-version rollback behind manage permission", async () => {
    const createResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs`,
      headers: authHeaders(OWNER_KEY),
      payload: { document: createMvpDocument("ngraph_manage") },
    });
    expect(createResponse.statusCode).toBe(201);
    const v1Id = createResponse.json().version.id;

    const versionResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_manage/versions`,
      headers: authHeaders(OWNER_KEY),
      payload: { document: createMvpDocument("ngraph_manage") },
    });
    expect(versionResponse.statusCode).toBe(201);
    const v2Id = versionResponse.json().version.id;
    expect(versionResponse.json().definition.current_version_id).toBe(v2Id);

    // Observer (no manage) cannot rollback.
    const observerRollback = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_manage/current-version`,
      headers: authHeaders(OBSERVER_KEY),
      payload: { version_id: v1Id },
    });
    expect(observerRollback.statusCode).toBe(403);

    // Owner rolls back the current version to v1.
    const rollback = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_manage/current-version`,
      headers: authHeaders(OWNER_KEY),
      payload: { version_id: v1Id },
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().definition.current_version_id).toBe(v1Id);

    // Owner archives; archived graphs reject new versions.
    const archive = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_manage/archive`,
      headers: authHeaders(OWNER_KEY),
      payload: {},
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().definition.status).toBe("archived");

    const blockedVersion = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_manage/versions`,
      headers: authHeaders(OWNER_KEY),
      payload: { document: createMvpDocument("ngraph_manage") },
    });
    expect(blockedVersion.statusCode).toBe(409);

    // Unarchive restores writability.
    const unarchive = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_manage/unarchive`,
      headers: authHeaders(OWNER_KEY),
      payload: {},
    });
    expect(unarchive.statusCode).toBe(200);
    expect(unarchive.json().definition.status).toBe("active");

    const actions = testApp.database.select().from(operationLogs).all().map((log) => log.action);
    expect(actions).toContain("node_graph.archive");
    expect(actions).toContain("node_graph.unarchive");
    expect(actions).toContain("node_graph.version.set_current");
  });

  it("rejects unrelated accounts", async () => {
    const response = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/node-graphs`,
      headers: authHeaders(OTHER_KEY),
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns structured trace for failed graph runs", async () => {
    const createResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        document: createFailingAgentDocument(),
      },
    });
    expect(createResponse.statusCode).toBe(201);

    const runResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs/ngraph_route_failed/run`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        intent: "normal",
        input_json: { value: "fail" },
      },
    });
    expect(runResponse.statusCode).toBe(202);

    const worker = new NodeGraphWorker(testApp.database, {
      workerId: "node-graph-worker-failed-route-test",
      pollIntervalMs: 60_000,
    });
    await worker.processOneDueJob();

    const run = testApp.database.select().from(nodeGraphRuns).limit(1).get();
    expect(run?.status).toBe("failed");

    const traceResponse = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/node-graph-runs/${run!.id}`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(traceResponse.statusCode).toBe(200);
    const trace = traceResponse.json();
    expect(trace.run.trace).toMatchObject({
      failedNodeId: "agent",
      statusCounts: { failed: 1 },
      runtime_kind: "node_graph_run",
      contract_version: "b8-governance.v1",
      reason_code: "node_graph_agent_router_missing",
      side_effects: {
        output_dispatch: { count: 0 },
        nested_job: { count: 0 },
      },
    });
    expect(trace.node_runs[0]).toMatchObject({
      node_id: "agent",
      status: "failed",
    });
  });

  it("rejects malformed graph documents with validation errors", async () => {
    const response = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/node-graphs`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        document: {
          schemaVersion: 1,
          graphId: "ngraph_bad",
          mode: "native_graph",
          nodes: [],
          edges: [],
        },
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
