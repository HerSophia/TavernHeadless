import type { NodeGraphDocument } from "@tavern/core/node-graph";
import type { EdgeMarker } from "@vue-flow/core";
import { describe, expect, it } from "vitest";

import {
  GROUP_NODE_TYPE,
  NODE_WIDTH,
  TAVERN_NODE_TYPE,
  mapDocumentToFlow,
  type GraphFlowNode,
  type GraphGroupNodeData,
  type GraphTavernNodeData,
} from "./map-document";
import { SAMPLE_NODE_GRAPH_DOCUMENT } from "./sample-document";

function tavernData(nodes: GraphFlowNode[], id: string): GraphTavernNodeData {
  const node = nodes.find((candidate) => candidate.id === id);
  expect(node, `node ${id} should exist`).toBeDefined();
  expect(node?.type).toBe(TAVERN_NODE_TYPE);
  const data = node!.data as GraphTavernNodeData;
  expect(data.kind).toBe("node");
  return data;
}

describe("mapDocumentToFlow", () => {
  it("maps a v2 document with groups and control edges", () => {
    const { nodes, edges } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    // 12 个文档节点 + 1 个分组容器
    expect(nodes).toHaveLength(13);
    expect(nodes.filter((node) => node.type === TAVERN_NODE_TYPE)).toHaveLength(12);
    expect(nodes.filter((node) => node.type === GROUP_NODE_TYPE)).toHaveLength(1);
    // 分组容器排在最前（绘制于成员之后）
    expect(nodes[0]?.type).toBe(GROUP_NODE_TYPE);

    expect(edges).toHaveLength(SAMPLE_NODE_GRAPH_DOCUMENT.edges.length);

    for (const node of nodes.filter((candidate) => candidate.type === TAVERN_NODE_TYPE)) {
      expect(node.style).toMatchObject({ width: `${NODE_WIDTH}px` });
      expect(node.position).toEqual({
        x: expect.any(Number),
        y: expect.any(Number),
      });
    }
  });

  it("encodes registry metadata onto node data", () => {
    const { nodes } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    const user = tavernData(nodes, "n_user");
    expect(user.title).toBe("User Input");
    expect(user.sideEffects).toBe("none");
    expect(user.inputPorts).toHaveLength(0);
    expect(user.outputPorts.map((port) => port.name)).toContain("text");
    expect(user.unknownType).toBe(false);

    const narrator = tavernData(nodes, "n_narrator");
    expect(narrator.sideEffects).toBe("llm");

    const derived = tavernData(nodes, "n_derived");
    expect(derived.sideEffects).toBe("write");
  });

  it("distinguishes data and control edges and wires handles", () => {
    const { edges } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    const controlEdges = edges.filter((edge) => edge.data?.kind === "control");
    expect(controlEdges.map((edge) => edge.id).sort()).toEqual([
      "c_branch_narrator",
      "c_gate_compose",
    ]);
    for (const edge of controlEdges) {
      expect((edge.style as Record<string, unknown>).strokeDasharray).toBeDefined();
    }

    const dataEdge = edges.find((edge) => edge.id === "e_user_wb");
    expect(dataEdge?.data?.kind).toBe("data");
    expect(dataEdge?.source).toBe("n_user");
    expect(dataEdge?.target).toBe("n_wb");
    expect(dataEdge?.sourceHandle).toBe("text");
    expect(dataEdge?.targetHandle).toBe("query");
    expect((dataEdge?.markerEnd as EdgeMarker).type).toBe("arrowclosed");
  });

  it("applies deterministic placeholder positions when coordinates are missing", () => {
    const first = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);
    const second = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    for (const node of first.nodes) {
      const other = second.nodes.find((candidate) => candidate.id === node.id);
      expect(other?.position).toEqual(node.position);
    }

    // 示例文档不带坐标 → 全部为占位布局
    for (const node of first.nodes.filter((candidate) => candidate.type === TAVERN_NODE_TYPE)) {
      expect((node.data as GraphTavernNodeData).hasPosition).toBe(false);
    }

    // 不同 phase 应落在不同列（x 不同）
    const userX = tavernData(first.nodes, "n_user").node.ui?.position?.x;
    expect(userX).toBeUndefined();
    const userNode = first.nodes.find((node) => node.id === "n_user");
    const responseNode = first.nodes.find((node) => node.id === "n_compose");
    expect(userNode?.position.x).not.toBe(responseNode?.position.x);
  });

  it("respects explicit ui.position and flags hasPosition", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "explicit",
      name: "explicit",
      mode: "native_graph",
      nodes: [
        {
          id: "n1",
          type: "source.user_input",
          typeVersion: "1",
          phase: "pre_response",
          ui: { position: { x: 123, y: 456 } },
        },
      ],
      edges: [],
      policies: {},
    };

    const { nodes } = mapDocumentToFlow(document);
    const data = tavernData(nodes, "n1");
    expect(data.hasPosition).toBe(true);
    expect(nodes.find((node) => node.id === "n1")?.position).toEqual({ x: 123, y: 456 });
  });

  it("overlays run status by node id", () => {
    const { nodes } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT, {
      runStatusByNodeId: { n_narrator: "running", n_commit: "succeeded" },
    });

    expect(tavernData(nodes, "n_narrator").runStatus).toBe("running");
    expect(tavernData(nodes, "n_commit").runStatus).toBe("succeeded");
    expect(tavernData(nodes, "n_user").runStatus).toBeUndefined();
  });

  it("flags unknown node types with empty ports", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "unknown",
      name: "unknown",
      mode: "native_graph",
      nodes: [
        { id: "x", type: "does.not.exist", typeVersion: "1", name: "Mystery", phase: "response" },
      ],
      edges: [],
      policies: {},
    };

    const { nodes } = mapDocumentToFlow(document);
    const data = tavernData(nodes, "x");
    expect(data.unknownType).toBe(true);
    expect(data.entry).toBeUndefined();
    expect(data.title).toBe("Mystery");
    expect(data.inputPorts).toHaveLength(0);
    expect(data.outputPorts).toHaveLength(0);
  });

  it("computes a group container bounding box covering its members", () => {
    const { nodes } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    const groupNode = nodes.find((node) => node.id === "group:g_pre");
    expect(groupNode).toBeDefined();
    expect(groupNode?.type).toBe(GROUP_NODE_TYPE);

    const data = groupNode!.data as GraphGroupNodeData;
    expect(data.kind).toBe("group");
    expect(data.group.id).toBe("g_pre");
    expect(data.memberCount).toBe(4);

    const style = groupNode!.style as Record<string, string>;
    expect(style.width).toMatch(/px$/);
    expect(style.height).toMatch(/px$/);
    expect(groupNode!.selectable).toBe(false);
    expect(groupNode!.draggable).toBe(false);
  });
});
