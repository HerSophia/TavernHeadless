import type { NodeGraphDiagnostic, NodeGraphDocument } from "@tavern/core/node-graph";
import { describe, expect, it } from "vitest";

import { SAMPLE_NODE_GRAPH_DOCUMENT } from "../canvas/sample-document";
import {
  diagnosticTarget,
  sortDiagnostics,
  validateGraphDocument,
} from "./local-validation";

function doc(partial: Partial<NodeGraphDocument>): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "test",
    name: "test",
    mode: "native_graph",
    nodes: [],
    edges: [],
    policies: {},
    ...partial,
  };
}

describe("validateGraphDocument", () => {
  it("returns no errors for a minimal valid graph", () => {
    const result = validateGraphDocument(
      doc({ nodes: [{ id: "n1", type: "source.user_input", typeVersion: "1", phase: "pre_response" }] }),
    );
    expect(result.isExecutable).toBe(true);
    expect(result.counts.error).toBe(0);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("flags unknown node types as errors and marks not executable", () => {
    const result = validateGraphDocument(
      doc({ nodes: [{ id: "x", type: "does.not.exist", typeVersion: "1", phase: "response" }] }),
    );
    expect(result.isExecutable).toBe(false);
    expect(result.counts.error).toBeGreaterThan(0);
    expect(
      result.diagnostics.some((d) => d.code === "node_graph_unknown_node_type" && d.nodeId === "x"),
    ).toBe(true);
  });

  it("treats warnings as non-blocking (errors block, warnings do not)", () => {
    // 页域 phase 的节点声明 floor 级 retryPolicy → warning，但仍可执行（对齐后端语义）。
    const result = validateGraphDocument(
      doc({
        nodes: [
          {
            id: "c",
            type: "compose.final_messages",
            typeVersion: "1",
            phase: "response",
            retryPolicy: "reuse_if_inputs_same",
          },
        ],
      }),
    );
    expect(result.counts.warning).toBeGreaterThan(0);
    expect(result.counts.error).toBe(0);
    expect(result.isExecutable).toBe(true);
  });

  it("locates diagnostics onto the offending node id", () => {
    const result = validateGraphDocument(SAMPLE_NODE_GRAPH_DOCUMENT);
    // 示例图含 control.condition 缺 config 等错误，应至少有一条带 nodeId 的诊断。
    expect(result.diagnostics.some((d) => Boolean(d.nodeId))).toBe(true);
    expect(result.isExecutable).toBe(false);
  });
});

describe("sortDiagnostics", () => {
  it("orders error → warning → info, then by code", () => {
    const input: NodeGraphDiagnostic[] = [
      { severity: "info", code: "z", message: "" },
      { severity: "warning", code: "m", message: "" },
      { severity: "error", code: "b", message: "" },
      { severity: "error", code: "a", message: "" },
    ];
    const sorted = sortDiagnostics(input);
    expect(sorted.map((d) => `${d.severity}:${d.code}`)).toEqual([
      "error:a",
      "error:b",
      "warning:m",
      "info:z",
    ]);
    // 不改原数组。
    expect(input[0]?.severity).toBe("info");
  });
});

describe("diagnosticTarget", () => {
  it("extracts node / edge / group targets, null when untargeted", () => {
    expect(diagnosticTarget({ severity: "error", code: "x", message: "", nodeId: "n" })).toEqual({ nodeId: "n" });
    expect(diagnosticTarget({ severity: "error", code: "x", message: "", edgeId: "e" })).toEqual({ edgeId: "e" });
    expect(diagnosticTarget({ severity: "error", code: "x", message: "", groupId: "g" })).toEqual({ groupId: "g" });
    expect(diagnosticTarget({ severity: "error", code: "x", message: "" })).toBeNull();
  });
});
