import { describe, expect, it } from "vitest";

import {
  buildOperationLogAction,
  buildOperationLogResourceAction,
  GOVERNANCE_OPERATION_ACTIONS,
  isGovernanceOperationAction,
} from "../governance/operation-log-names.js";
import {
  attachNodeGraphRunGovernanceTraceSummary,
  buildNodeGraphRunGovernanceTraceSummary,
  buildToolTransportGovernanceTraceSummary,
  normalizeReasonCode,
  summarizePayloadForOperationLog,
} from "../governance/trace-summary.js";
import { RUNTIME_GOVERNANCE_CONTRACT_VERSION } from "../governance/runtime-governance-types.js";

describe("runtime governance helpers", () => {
  it("builds stable operation log action names", () => {
    expect(buildOperationLogAction("node_graph_run", "outputDispatched")).toBe("node_graph_run.output_dispatched");
    expect(buildOperationLogResourceAction("node_graph", "proposal", "submit")).toBe("node_graph.proposal.submit");
    expect(GOVERNANCE_OPERATION_ACTIONS.nodeGraphRun.failed).toBe("node_graph_run.failed");
    expect(isGovernanceOperationAction("node_graph_run.output_dispatched")).toBe(true);
    expect(isGovernanceOperationAction("message.manual_revision.apply")).toBe(false);
  });

  it("normalizes reason codes to snake_case", () => {
    expect(normalizeReasonCode("NodeGraph.Node Execution Failed")).toBe("node_graph_node_execution_failed");
    expect(normalizeReasonCode("  budget-exceeded  ")).toBe("budget_exceeded");
    expect(normalizeReasonCode(null, "FallbackReason")).toBe("fallback_reason");
  });

  it("summarizes sensitive payloads without storing the body", () => {
    const summary = summarizePayloadForOperationLog({ prompt: "secret prompt body", result: [1, 2, 3] });

    expect(summary).toMatchObject({
      redacted: true,
      kind: "object",
      key_count: 2,
      marker: "runtime_governance_payload_redacted",
    });
    expect(summary.byte_length).toBeGreaterThan(0);
    expect(summary.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(summary)).not.toContain("secret prompt body");
  });

  it("builds governance summary for tool transport traces", () => {
    const summary = buildToolTransportGovernanceTraceSummary({
      trace: {
        selection: { transport: "text_protocol", reasonCode: "explicit_override" },
        toolList: {
          injected: true,
          contributorId: "builtin:tool_list",
          toolCount: 2,
          tokenCount: 96,
          budgetGroup: "tool_list",
        },
        parsing: {
          blockCount: 2,
          acceptedCount: 1,
          rejectedCount: 1,
          diagnostics: [{ callId: "bad", toolName: "missing", reason: "tool_not_registered", excerpt: "x" }],
          diagnosticsByReason: { tool_not_registered: 1 },
        },
        toolResult: {
          writtenBack: true,
          blockCount: 1,
          tokenCount: 128,
          budgetGroup: "tool_result",
        },
      },
      runId: "run-1",
      sessionId: "session-1",
      branchId: "main",
      floorId: "floor-1",
      requestId: "req-1",
      route: "POST /sessions/:id/respond",
      finishedAt: 200,
    });

    expect(summary).toMatchObject({
      contract_version: "b8-governance.v1",
      runtime_kind: "tool_transport",
      run_id: "run-1",
      status: "failed",
      reason_code: "tool_not_registered",
      diagnostics: expect.objectContaining({
        selection_reason_code: "explicit_override",
        block_count: 2,
        accepted_count: 1,
        rejected_count: 1,
        diagnostics_by_reason: { tool_not_registered: 1 },
        tool_result_written_back: true,
      }),
      side_effects: expect.objectContaining({
        tool_execution: { count: 1 },
        tool_list_prompt: { written: true, count: 2 },
        tool_result_prompt: { written: true, count: 1 },
      }),
    });
  });


  it("maps node graph trace blobs to shared governance summary fields", () => {
    const trace = {
      graphId: "ngraph_1",
      intent: "normal",
      statusCounts: { skipped: 0, running: 0, succeeded: 1, failed: 1, reused: 0 },
      failedNodeId: "agent",
      failedNodes: [{
        nodeId: "agent",
        diagnostics: [{ code: "NodeGraph.Node Execution Failed", severity: "error", message: "failed" }],
      }],
      outputDispatchRefs: [
        { nodeId: "write", target: "derived_output", status: "dispatched" },
        { nodeId: "draft", target: "project_inbox", status: "pending" },
      ],
      outputDispatchResults: [{ nodeId: "write", result: { id: "out_1" } }],
      nestedJobRefs: [{ nodeId: "agent", jobId: "job_1", medium: "background_job", created: true }],
    };

    const summary = buildNodeGraphRunGovernanceTraceSummary({
      trace,
      graphRunId: "ngrun_1",
      graphId: "ngraph_1",
      graphVersionId: "ngver_1",
      accountId: "acc_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      jobId: "graph-job:1",
      jobType: "graph.run",
      status: "failed",
      startedAt: 100,
      finishedAt: 175,
    });

    expect(summary).toMatchObject({
      contract_version: RUNTIME_GOVERNANCE_CONTRACT_VERSION,
      runtime_kind: "node_graph_run",
      run_id: "ngrun_1",
      root_run_id: "ngrun_1",
      source_kind: "runtime_job",
      status: "failed",
      reason_code: "node_graph_node_execution_failed",
      duration_ms: 75,
      target_ref: {
        graph_id: "ngraph_1",
        graph_version_id: "ngver_1",
        project_id: "proj_1",
      },
      side_effects: {
        output_dispatch: {
          count: 2,
          dispatched: 1,
          pending: 1,
          result_count: 1,
          targets: ["derived_output", "project_inbox"],
        },
        nested_job: {
          count: 1,
          created: 1,
          refs: [{ node_id: "agent", job_id: "job_1", medium: "background_job" }],
        },
      },
    });
  });

  it("attaches governance fields without removing existing node graph trace fields", () => {
    const trace = attachNodeGraphRunGovernanceTraceSummary({
      trace: {
        graphId: "ngraph_2",
        intent: "dry_run",
        statusCounts: { skipped: 0, running: 0, succeeded: 1, failed: 0, reused: 0 },
        nestedJobRefs: [],
      },
      graphRunId: "ngrun_2",
      graphId: "ngraph_2",
      graphVersionId: "ngver_2",
      status: "succeeded",
      dryRun: true,
    });

    expect(trace.graphId).toBe("ngraph_2");
    expect(trace.runtime_kind).toBe("node_graph_run");
    expect(trace.reason_code).toBe("succeeded");
    expect(trace.dry_run).toBe(true);
  });
});
