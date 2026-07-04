import type { NodeGraphDocument } from "@tavern/core/node-graph";
import { describe, expect, it } from "vitest";

import { validateGraphDocument } from "../validate/local-validation";
import { extractSubgraph, type ExtractSubgraphResult } from "./extract-subgraph";

function parentDoc(): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "p",
    name: "Parent",
    mode: "native_graph",
    nodes: [
      { id: "b1", type: "compose.template_render", typeVersion: "1", phase: "pre_response" },
      { id: "b2", type: "compose.template_render", typeVersion: "1", phase: "pre_response" },
      { id: "compose", type: "compose.final_messages", typeVersion: "1", phase: "response" },
      { id: "user_input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      { id: "narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
      { id: "commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
    ],
    edges: [
      { id: "e_b1", from: { nodeId: "b1", port: "block" }, to: { nodeId: "compose", port: "blocks" } },
      { id: "e_b2", from: { nodeId: "b2", port: "block" }, to: { nodeId: "compose", port: "blocks" } },
      { id: "e_cn", from: { nodeId: "compose", port: "messages" }, to: { nodeId: "narrator", port: "messages" } },
      { id: "e_ui", from: { nodeId: "user_input", port: "text" }, to: { nodeId: "narrator", port: "user_input" } },
      { id: "e_nc", from: { nodeId: "narrator", port: "text" }, to: { nodeId: "commit", port: "text" } },
    ],
    groups: [
      { id: "g_blocks", name: "Blocks", kind: "subgraph", nodeIds: ["b1", "b2"] },
      { id: "g_narrator", name: "Narrator", kind: "subgraph", nodeIds: ["compose", "narrator", "user_input"] },
    ],
    policies: {},
  };
}

function ok(result: ExtractSubgraphResult | { error: string }): ExtractSubgraphResult {
  if ("error" in result) {
    throw new Error(`unexpected extract error: ${result.error}`);
  }
  return result;
}

/** 回填 group.node 的 ref（模拟持久化后），便于校验父图。 */
function withRef(result: ExtractSubgraphResult, graphId: string): NodeGraphDocument {
  const doc = JSON.parse(JSON.stringify(result.parentDocument)) as NodeGraphDocument;
  const gn = doc.nodes.find((node) => node.id === result.groupNodeId)!;
  (gn.config as { ref: { graphId: string } }).ref.graphId = graphId;
  return doc;
}

describe("extractSubgraph", () => {
  it("extracts an outbound-only cluster (blocks → compose) into a subgraph + group.node", () => {
    const result = ok(extractSubgraph(parentDoc(), "g_blocks"));

    // 子图：2 成员 + 单个 group.output（2 端口）；无 group.input；可执行；标记 subgraph。
    expect(result.subDocument.metadata?.subgraph).toBe(true);
    expect(result.subDocument.nodes.filter((n) => n.type === "group.output")).toHaveLength(1);
    expect(result.subDocument.nodes.filter((n) => n.type === "group.input")).toHaveLength(0);
    expect(validateGraphDocument(result.subDocument).isExecutable).toBe(true);

    // 接口：2 输出（prompt_block），无输入。
    const gn = result.parentDocument.nodes.find((n) => n.id === result.groupNodeId)!;
    const iface = (gn.config as { interface: { inputs: unknown[]; outputs: unknown[] } }).interface;
    expect(iface.outputs).toHaveLength(2);
    expect(iface.inputs).toHaveLength(0);
    expect(gn.type).toBe("group.node");

    // 父图：移除 b1/b2，新增 group.node；out_* → compose.blocks；填 ref 后可执行。
    expect(result.parentDocument.nodes.some((n) => n.id === "b1")).toBe(false);
    const parent = withRef(result, "sub-1");
    const validation = validateGraphDocument(parent);
    expect(validation.counts.error).toBe(0);
    expect(validation.isExecutable).toBe(true);
    // g_blocks 组被替换移除，g_narrator 仍在。
    expect(parent.groups?.some((g) => g.id === "g_blocks")).toBe(false);
    expect(parent.groups?.some((g) => g.id === "g_narrator")).toBe(true);
  });

  it("extracts a group with inbound + outbound boundaries (compose+narrator)", () => {
    const result = ok(extractSubgraph(parentDoc(), "g_narrator"));

    // 入边界：b1/b2 → compose.blocks → 单个 group.input（2 端口）；出边界：narrator.text → 单个 group.output（1 端口）。
    expect(result.subDocument.nodes.filter((n) => n.type === "group.input")).toHaveLength(1);
    expect(result.subDocument.nodes.filter((n) => n.type === "group.output")).toHaveLength(1);
    expect(validateGraphDocument(result.subDocument).isExecutable).toBe(true);

    const gn = result.parentDocument.nodes.find((n) => n.id === result.groupNodeId)!;
    const iface = (gn.config as { interface: { inputs: unknown[]; outputs: unknown[] } }).interface;
    expect(iface.inputs).toHaveLength(2);
    expect(iface.outputs).toHaveLength(1);

    const parent = withRef(result, "sub-2");
    expect(validateGraphDocument(parent).isExecutable).toBe(true);
    // 父图仍含 b1/b2/commit + group.node，且边重连到 group.node。
    expect(parent.edges.some((e) => e.to.nodeId === result.groupNodeId)).toBe(true);
    expect(parent.edges.some((e) => e.from.nodeId === result.groupNodeId)).toBe(true);
  });

  it("returns errors for unknown / empty groups", () => {
    expect(extractSubgraph(parentDoc(), "nope")).toEqual({ error: "group_not_found" });
    const doc = parentDoc();
    doc.groups!.push({ id: "g_empty", name: "Empty", kind: "subgraph", nodeIds: [] });
    expect(extractSubgraph(doc, "g_empty")).toEqual({ error: "group_empty" });
  });

  it("refuses to extract when a control edge crosses the boundary", () => {
    const doc: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "p",
      name: "P",
      mode: "native_graph",
      nodes: [
        { id: "cond", type: "control.condition", typeVersion: "1", phase: "pre_response", config: { condition: { op: "exists", value: { source: "variable", path: ["x"] } } } },
        { id: "gate", type: "control.gate", typeVersion: "1", phase: "pre_response" },
        { id: "m", type: "compose.template_render", typeVersion: "1", phase: "pre_response" },
      ],
      edges: [
        { id: "e_cg", from: { nodeId: "cond", port: "result" }, to: { nodeId: "gate", port: "condition" } },
        { id: "c_gate_m", kind: "control", from: { nodeId: "gate", port: "open" }, to: { nodeId: "m", port: "data" } },
      ],
      groups: [{ id: "g", name: "G", kind: "subgraph", nodeIds: ["m"] }],
      policies: {},
    };
    expect(extractSubgraph(doc, "g")).toEqual({ error: "control_edge_crosses_boundary" });
  });
});
