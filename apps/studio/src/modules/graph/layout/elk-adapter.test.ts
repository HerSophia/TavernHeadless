import type { NodeGraphDocument } from "@tavern/core/node-graph";
import type { ElkNode } from "elkjs";
import { describe, expect, it } from "vitest";

import { SAMPLE_NODE_GRAPH_DOCUMENT } from "../canvas/sample-document";
import { buildElkGraph, extractElkLayout } from "./elk-adapter";

function child(root: ElkNode, id: string): ElkNode | undefined {
  return root.children?.find((node) => node.id === id);
}

describe("buildElkGraph", () => {
  it("produces a layered RIGHT root with phase partitioning enabled", () => {
    const root = buildElkGraph(SAMPLE_NODE_GRAPH_DOCUMENT);

    expect(root.id).toBe("root");
    expect(root.layoutOptions?.["elk.algorithm"]).toBe("layered");
    expect(root.layoutOptions?.["elk.direction"]).toBe("RIGHT");
    expect(root.layoutOptions?.["elk.partitioning.activate"]).toBe("true");
    expect(root.layoutOptions?.["elk.hierarchyHandling"]).toBe("INCLUDE_CHILDREN");
  });

  it("maps groups to compound nodes containing their members", () => {
    const root = buildElkGraph(SAMPLE_NODE_GRAPH_DOCUMENT);

    // 12 节点，其中 4 个在组内 → 8 个顶层叶子 + 1 个分组容器
    expect(root.children).toHaveLength(9);

    const group = child(root, "group:g_pre");
    expect(group).toBeDefined();
    expect(group?.children?.map((node) => node.id).sort()).toEqual([
      "n_branch",
      "n_cond",
      "n_gate",
      "n_wb",
    ]);
    // 组内成员不应再出现在顶层
    expect(child(root, "n_wb")).toBeUndefined();
  });

  it("assigns phase partition and ELK ports to leaf nodes", () => {
    const root = buildElkGraph(SAMPLE_NODE_GRAPH_DOCUMENT);

    const narrator = child(root, "n_narrator");
    expect(narrator).toBeDefined();
    // narration.narrator 在 response phase（order 2）
    expect(narrator?.layoutOptions?.["elk.partitioning.partition"]).toBe("2");
    expect(narrator?.layoutOptions?.["elk.portConstraints"]).toBe("FIXED_ORDER");
    // 输入 messages（WEST）+ 输出 text/diagnostics（EAST）
    const sides = (narrator?.ports ?? []).map((port) => port.layoutOptions?.["elk.port.side"]);
    expect(sides).toContain("WEST");
    expect(sides).toContain("EAST");
  });

  it("references ELK port ids on edges when ports exist", () => {
    const root = buildElkGraph(SAMPLE_NODE_GRAPH_DOCUMENT);

    const edge = root.edges?.find((candidate) => candidate.id === "e_user_wb");
    expect(edge?.sources).toEqual(["n_user::out::text"]);
    expect(edge?.targets).toEqual(["n_wb::in::query"]);
  });

  it("uses measured sizes when provided and falls back otherwise", () => {
    const root = buildElkGraph(SAMPLE_NODE_GRAPH_DOCUMENT, {
      sizeByNodeId: { n_user: { width: 300, height: 111 } },
    });

    const user = child(root, "n_user");
    expect(user?.width).toBe(300);
    expect(user?.height).toBe(111);

    const history = child(root, "n_history");
    expect(history?.width).toBe(220);
    expect((history?.height ?? 0) > 0).toBe(true);
  });

  it("falls back to node id and FREE constraints for unknown node types", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "unknown",
      name: "unknown",
      mode: "native_graph",
      nodes: [
        { id: "a", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
        { id: "x", type: "does.not.exist", typeVersion: "1", phase: "response" },
      ],
      edges: [{ id: "e", from: { nodeId: "a", port: "text" }, to: { nodeId: "x", port: "in" } }],
      policies: {},
    };

    const root = buildElkGraph(document);
    const unknown = child(root, "x");
    expect(unknown?.ports ?? []).toHaveLength(0);
    expect(unknown?.layoutOptions?.["elk.portConstraints"]).toBe("FREE");

    const edge = root.edges?.[0];
    // source 端口存在 → 端口 id；target 端口在未知节点上不存在 → 回退节点 id
    expect(edge?.sources).toEqual(["a::out::text"]);
    expect(edge?.targets).toEqual(["x"]);
  });
});

describe("extractElkLayout", () => {
  it("flattens child coordinates to absolute positions and group rects", () => {
    const root: ElkNode = {
      id: "root",
      children: [
        { id: "a", x: 10, y: 20, width: 220, height: 80 },
        {
          id: "group:g",
          x: 100,
          y: 5,
          width: 260,
          height: 140,
          children: [
            { id: "m1", x: 5, y: 8, width: 220, height: 80 },
            { id: "m2", x: 5, y: 60, width: 220, height: 70 },
          ],
        },
      ],
    };

    const { positions, groups } = extractElkLayout(root);

    expect(positions.a).toEqual({ x: 10, y: 20 });
    // 组内成员坐标相对父容器 → 累加为绝对坐标
    expect(positions.m1).toEqual({ x: 105, y: 13 });
    expect(positions.m2).toEqual({ x: 105, y: 65 });
    expect(groups["group:g"]).toEqual({ x: 100, y: 5, width: 260, height: 140 });
  });
});
