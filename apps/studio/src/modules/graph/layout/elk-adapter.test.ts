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

    // 23 节点，其中 15 个在三个组内 → 8 个顶层叶子 + 3 个分组容器
    expect(root.children).toHaveLength(11);

    const group = child(root, "group:g_preflight");
    expect(group).toBeDefined();
    expect(group?.children?.map((node) => node.id).sort()).toEqual([
      "n_agency_pre",
      "n_cond",
      "n_director",
      "n_gate",
      "n_lore",
    ]);
    // 组内成员不应再出现在顶层
    expect(child(root, "n_director")).toBeUndefined();
  });

  it("assigns phase partition and ELK ports to leaf nodes", () => {
    const root = buildElkGraph(SAMPLE_NODE_GRAPH_DOCUMENT);

    // n_narrator 现位于「Narrator 预设主体」分组内 → 从组容器里取叶子。
    const narratorGroup = child(root, "group:g_narrator");
    expect(narratorGroup).toBeDefined();
    const narrator = narratorGroup?.children?.find((node) => node.id === "n_narrator");
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

describe("buildElkGraph · collapsed node groups", () => {
  function collapsedDoc(): NodeGraphDocument {
    return {
      schemaVersion: 2,
      graphId: "c",
      name: "c",
      mode: "native_graph",
      nodes: [
        { id: "ext", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
        { id: "a", type: "compose.template_render", typeVersion: "1", phase: "pre_response" },
        { id: "b", type: "compose.final_messages", typeVersion: "1", phase: "response" },
        { id: "ext2", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
      ],
      edges: [
        { id: "e_in", from: { nodeId: "ext", port: "text" }, to: { nodeId: "a", port: "blocks" } },
        { id: "e_ab", from: { nodeId: "a", port: "block" }, to: { nodeId: "b", port: "blocks" } },
        { id: "e_out", from: { nodeId: "b", port: "messages" }, to: { nodeId: "ext2", port: "text" } },
      ],
      groups: [{ id: "grp", name: "Grp", kind: "subgraph", collapsed: true, nodeIds: ["a", "b"] }],
      policies: {},
    };
  }

  it("lays out a collapsed group as a single leaf node (members excluded, edges rerouted)", () => {
    const root = buildElkGraph(collapsedDoc());

    // 折叠叶子存在于顶层；成员 a/b 不参与布局；无复合 group:grp。
    const leaf = child(root, "groupx:grp");
    expect(leaf).toBeDefined();
    expect(child(root, "a")).toBeUndefined();
    expect(child(root, "b")).toBeUndefined();
    expect(child(root, "group:grp")).toBeUndefined();
    expect(child(root, "ext")).toBeDefined();

    // 跨界边重路由到折叠叶子的派生端口；组内边被略去。
    const portIds = (leaf?.ports ?? []).map((port) => port.id);
    expect(portIds).toContain("in:a:blocks");
    expect(portIds).toContain("out:b:messages");
    const eIn = root.edges?.find((edge) => edge.id === "e_in");
    expect(eIn?.targets).toEqual(["in:a:blocks"]);
    const eOut = root.edges?.find((edge) => edge.id === "e_out");
    expect(eOut?.sources).toEqual(["out:b:messages"]);
    expect(root.edges?.some((edge) => edge.id === "e_ab")).toBe(false);
  });

  it("keeps members and the compound group when not collapsed", () => {
    const doc = collapsedDoc();
    doc.groups![0]!.collapsed = false;
    const root = buildElkGraph(doc);
    expect(child(root, "group:grp")).toBeDefined();
    expect(child(root, "groupx:grp")).toBeUndefined();
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
