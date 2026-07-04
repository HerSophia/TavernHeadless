import { createEventBus, type NodeGraphDocument } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import {
  DEFAULT_NODE_GRAPH_RUNTIME_BUDGET,
  DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET,
  checkNodeGraphStaticBudget,
  checkNodeGraphSyncSizeBudget,
  countNodeGraphNestedAgentJobs,
  countNodeGraphTemporaryConversations,
  exceedsNodeGraphDurationBudget,
  nodeGraphDurationViolation,
  resolveNodeGraphRuntimeBudget,
} from "../node-graph-runtime/budget.js";
import { countActiveProjectGraphRunJobs } from "../node-graph-runtime/concurrency.js";
import { createDefaultNodeGraphExecutor } from "../node-graph-runtime/index.js";
import {
  checkAgentRunNestedJobsBudget,
  checkAgentRunOutputDispatchBudget,
} from "../agent-runtime/agent-run-budget.js";
import { RUNTIME_GOVERNANCE_BUDGET_REASON_CODES } from "../governance/runtime-governance-types.js";
import {
  NODE_GRAPH_RUN_JOB_TYPE,
  NODE_GRAPH_RUNTIME_SCOPE_TYPE,
  buildNodeGraphRuntimeScopeKey,
  createNodeGraphRuntimeJobCatalog,
} from "../node-graph-runtime-job-definitions.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";

function twoNodeGraph(graphId = "ng_budget"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Budget",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
      { id: "messages", type: "compose.final_messages", typeVersion: "1", phase: "response" },
    ],
    edges: [{
      id: "e",
      kind: "data",
      from: { nodeId: "history", port: "messages" },
      to: { nodeId: "messages", port: "messages" },
    }],
  };
}

function fanOutGraph(graphId = "ng_fanout"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "FanOut",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "a", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
      { id: "b", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
    ],
    edges: [],
  };
}

function backgroundAgentGraph(graphId = "ng_bg"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Background",
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

describe("NodeGraph runtime budget", () => {
  it("resolves budget overrides while keeping base defaults", () => {
    const resolved = resolveNodeGraphRuntimeBudget(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, {
      maxNodesExecuted: 5,
      maxNestedAgentJobs: 0,
    });
    expect(resolved.maxNodesExecuted).toBe(5);
    expect(resolved.maxNestedAgentJobs).toBe(0);
    expect(resolved.maxDepth).toBe(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET.maxDepth);
    // 非法 override 回退到 base。
    expect(resolveNodeGraphRuntimeBudget(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, { maxNodesExecuted: -1 }).maxNodesExecuted)
      .toBe(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET.maxNodesExecuted);
    // 高于平台默认值不会提高有效上限。
    expect(resolveNodeGraphRuntimeBudget(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, { maxNodesExecuted: 999 }).maxNodesExecuted)
      .toBe(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET.maxNodesExecuted);
  });

  it("flags max-nodes, depth and fan-out violations", () => {
    const nodesViolation = checkNodeGraphStaticBudget({
      document: twoNodeGraph(),
      topologicalLevels: [["history"], ["messages"]],
      dryRun: true,
      budget: { ...DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, maxNodesExecuted: 1 },
    });
    expect(nodesViolation?.reasonCode).toBe(RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxNodes);

    const depthViolation = checkNodeGraphStaticBudget({
      document: twoNodeGraph(),
      topologicalLevels: [["history"], ["messages"]],
      dryRun: true,
      budget: { ...DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, maxDepth: 1 },
    });
    expect(depthViolation?.reasonCode).toBe(RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxDepth);

    const fanOutViolation = checkNodeGraphStaticBudget({
      document: fanOutGraph(),
      topologicalLevels: [["a", "b"]],
      dryRun: true,
      budget: { ...DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, maxFanOut: 1 },
    });
    expect(fanOutViolation?.reasonCode).toBe(RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxFanOut);
  });

  it("counts nested agent jobs only for real runs", () => {
    const document = backgroundAgentGraph();
    expect(countNodeGraphNestedAgentJobs(document)).toBe(1);
    expect(countNodeGraphTemporaryConversations(document)).toBe(0);

    // dry-run 不计入嵌套作业 / 临时对话预算。
    expect(checkNodeGraphStaticBudget({
      document,
      topologicalLevels: [["agent"]],
      dryRun: true,
      budget: { ...DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, maxNestedAgentJobs: 0 },
    })).toBeNull();

    const violation = checkNodeGraphStaticBudget({
      document,
      topologicalLevels: [["agent"]],
      dryRun: false,
      budget: { ...DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, maxNestedAgentJobs: 0 },
    });
    expect(violation?.reasonCode).toBe(RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxNestedAgentJobs);
  });

  it("flags duration budget overruns", () => {
    const budget = { ...DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, maxRuntimeDurationMs: 50 };
    expect(exceedsNodeGraphDurationBudget(100, budget)).toBe(true);
    expect(exceedsNodeGraphDurationBudget(10, budget)).toBe(false);
    expect(nodeGraphDurationViolation(100, budget).reasonCode)
      .toBe(RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxDuration);
  });

  it("flags sync size budget violations for preview/validate", () => {
    const ok = checkNodeGraphSyncSizeBudget(twoNodeGraph(), DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET);
    expect(ok).toBeNull();
    const violation = checkNodeGraphSyncSizeBudget(twoNodeGraph(), {
      ...DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET,
      maxNodesExecuted: 1,
    });
    expect(violation?.reasonCode).toBe(RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxNodes);
  });

  it("rejects budget-exceeding graphs in the executor without running nodes", async () => {
    const executor = createDefaultNodeGraphExecutor();
    const result = await executor.execute({
      document: twoNodeGraph("ng_executor_budget"),
      context: {
        accountId: "default-admin",
        workspaceId: "ws_1",
        projectId: "proj_1",
        intent: "dry_run",
        dryRun: true,
        budget: { ...DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, maxNodesExecuted: 1 },
      },
    });
    expect(result.status).toBe("failed");
    expect(result.trace.error).toBe(RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxNodes);
    expect(result.nodeRuns).toHaveLength(0);
  });
});

describe("Agent run budget", () => {
  it("flags output dispatch overruns", () => {
    expect(checkAgentRunOutputDispatchBudget(5)).toBeNull();
    const violation = checkAgentRunOutputDispatchBudget(99, { maxOutputDispatch: 16, maxNestedJobs: 16 });
    expect(violation?.reasonCode).toBe(RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.agentRunMaxOutputDispatch);
  });

  it("flags nested job overruns", () => {
    expect(checkAgentRunNestedJobsBudget(2)).toBeNull();
    const violation = checkAgentRunNestedJobsBudget(99, { maxOutputDispatch: 16, maxNestedJobs: 16 });
    expect(violation?.reasonCode).toBe(RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.agentRunMaxNestedJobs);
  });
});

describe("NodeGraph project run concurrency", () => {
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

  it("counts active project graph run jobs", () => {
    expect(countActiveProjectGraphRunJobs(database.db, { accountId: "default-admin", projectId: "proj_1" })).toBe(0);

    const scheduler = new RuntimeJobScheduler(createNodeGraphRuntimeJobCatalog(), { eventBus: createEventBus() });
    database.db.transaction((tx) => {
      scheduler.enqueue(tx, {
        jobType: NODE_GRAPH_RUN_JOB_TYPE,
        accountId: "default-admin",
        scopeType: NODE_GRAPH_RUNTIME_SCOPE_TYPE,
        scopeKey: buildNodeGraphRuntimeScopeKey({ workspaceId: "ws_1", projectId: "proj_1", graphId: "g1" }),
        workspaceId: "ws_1",
        projectId: "proj_1",
        payload: {
          accountId: "default-admin",
          workspaceId: "ws_1",
          projectId: "proj_1",
          graphId: "g1",
          graphVersionId: "v1",
          intent: "normal",
          dryRun: false,
          inputJson: {},
        },
      });
    });

    expect(countActiveProjectGraphRunJobs(database.db, { accountId: "default-admin", projectId: "proj_1" })).toBe(1);
    // 其它项目 / 账号隔离。
    expect(countActiveProjectGraphRunJobs(database.db, { accountId: "default-admin", projectId: "proj_other" })).toBe(0);
    expect(countActiveProjectGraphRunJobs(database.db, { accountId: "someone-else", projectId: "proj_1" })).toBe(0);
  });
});
