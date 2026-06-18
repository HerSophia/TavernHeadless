import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NodeGraphDocument } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { NodeGraphDefinitionService } from "../node-graph-definition-service.js";
import { NodeGraphRunService } from "../node-graph-run-service.js";
import { RuntimeEvaluationService } from "../agent-runtime/runtime-evaluation-service.js";

const ACTOR = {
  actorType: "account" as const,
  actorAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
  actorClientId: null,
};

function makeGraph(graphId: string): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Eval Graph",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [{ id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response" }],
    edges: [],
  };
}

describe("RuntimeEvaluationService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    createTestProject(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: "ws_1",
      id: "proj_1",
    });
  });

  afterEach(() => {
    database?.close();
  });

  function seedRun(input: {
    graphSuffix: string;
    status: "succeeded" | "failed";
    trace: Record<string, unknown>;
    nodeTimings?: { startedAt: number; finishedAt: number };
  }): void {
    const defService = new NodeGraphDefinitionService(database.db);
    const { definition, version } = defService.create({
      actor: ACTOR,
      projectId: "proj_1",
      document: makeGraph(`ngraph_eval_${input.graphSuffix}`),
    });
    const runService = new NodeGraphRunService(database.db);
    const run = runService.createRun({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: "ws_1",
      projectId: "proj_1",
      graphId: definition.id,
      graphVersionId: version.id,
      intent: "normal",
      status: input.status,
      trace: input.trace,
      now: 1_000,
    });
    runService.appendNodeRun({
      graphRunId: run.id,
      nodeId: "history",
      phase: "pre_response",
      status: input.status === "succeeded" ? "succeeded" : "failed",
      inputHash: "sha256:in",
      outputHash: "sha256:out",
      output: { preview: { kind: "text", title: "x", value: "y" } },
      startedAt: input.nodeTimings?.startedAt ?? null,
      finishedAt: input.nodeTimings?.finishedAt ?? null,
    });
  }

  it("computes operational metrics from sampled runs and reserves grader metrics", () => {
    seedRun({
      graphSuffix: "ok",
      status: "succeeded",
      trace: {
        reason_code: "succeeded",
        statusCounts: { succeeded: 2, reused: 1, failed: 0, skipped: 0, running: 0 },
        nestedJobRefs: [{ jobId: "agent-job:1", medium: "background_job" }],
      },
      nodeTimings: { startedAt: 1_000, finishedAt: 1_120 },
    });
    seedRun({
      graphSuffix: "fail",
      status: "failed",
      trace: {
        reason_code: "node_graph_agent_router_missing",
        statusCounts: { succeeded: 0, reused: 0, failed: 1, skipped: 0, running: 0 },
        nestedJobRefs: [],
      },
    });

    const report = new RuntimeEvaluationService(database.db).evaluate(
      { accountId: DEFAULT_ADMIN_ACCOUNT_ID, projectId: "proj_1" },
      2_000,
    );

    expect(report.kind).toBe("runtime_evaluation_report");
    expect(report.contractVersion).toBe("b8-governance.v1");
    expect(report.sample.graphRunCount).toBe(2);
    expect(report.sample.nodeRunCount).toBe(2);

    // graph failure reason: 1 failed of 2 -> 0.5
    expect(report.metrics.graph_failure_reason.status).toBe("sampled");
    expect(report.metrics.graph_failure_reason.value).toBe(0.5);
    expect(report.metrics.graph_failure_reason.detail.reason_counts).toMatchObject({
      node_graph_agent_router_missing: 1,
    });

    // nested job fan-out: 1 nested job across 2 runs -> 0.5
    expect(report.metrics.nested_job_fan_out.value).toBe(0.5);
    expect(report.metrics.nested_job_fan_out.detail.max_fan_out).toBe(1);

    // retry reuse: reused 1 of total node statuses (2+1+1=4) -> 0.25
    expect(report.metrics.retry_reuse.value).toBe(0.25);

    // latency sampled from node timings (120ms single sample)
    expect(report.metrics.latency.status).toBe("sampled");
    expect(report.metrics.latency.value).toBe(120);
    expect(report.metrics.latency.unit).toBe("ms");

    // qualitative metrics reserved, not fabricated
    for (const key of ["player_agency", "state_contradiction", "memory_quality", "token_usage"] as const) {
      expect(report.metrics[key].status).toBe("not_sampled");
      expect(report.metrics[key].value).toBeNull();
    }

    // A/B baseline reserved but disabled
    expect(report.abBaseline.enabled).toBe(false);
  });

  it("produces an empty-but-valid report when no runs exist", () => {
    const report = new RuntimeEvaluationService(database.db).evaluate({ accountId: DEFAULT_ADMIN_ACCOUNT_ID, projectId: "proj_1" });
    expect(report.sample.graphRunCount).toBe(0);
    expect(report.metrics.graph_failure_reason.status).toBe("not_sampled");
    expect(report.metrics.nested_job_fan_out.status).toBe("not_sampled");
  });

  it("compares two reports into metric deltas for an A/B baseline", () => {
    seedRun({
      graphSuffix: "base",
      status: "failed",
      trace: { reason_code: "x", statusCounts: { failed: 1 }, nestedJobRefs: [] },
    });
    const service = new RuntimeEvaluationService(database.db);
    const baseline = service.evaluate({ accountId: DEFAULT_ADMIN_ACCOUNT_ID, projectId: "proj_1" }, 1);

    seedRun({
      graphSuffix: "cand",
      status: "succeeded",
      trace: { reason_code: "succeeded", statusCounts: { succeeded: 1 }, nestedJobRefs: [] },
    });
    const candidate = service.evaluate({ accountId: DEFAULT_ADMIN_ACCOUNT_ID, projectId: "proj_1" }, 2);

    const comparison = service.compareReports(baseline, candidate, {
      baselineLabel: "before",
      candidateLabel: "after",
    });
    expect(comparison.kind).toBe("runtime_evaluation_comparison");
    const failureDelta = comparison.deltas.find((d) => d.key === "graph_failure_reason");
    // baseline failure rate 1.0, candidate (2 runs, 1 failed) 0.5 -> delta -0.5
    expect(failureDelta?.baselineValue).toBe(1);
    expect(failureDelta?.candidateValue).toBe(0.5);
    expect(failureDelta?.delta).toBe(-0.5);
  });
});
