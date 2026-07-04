import { describe, expect, it } from "vitest";

import { filterCandidates, type MentionSources } from "./mention-providers";
import type { MentionCandidate } from "./mention-types";

function graph(name: string, id = name): MentionCandidate {
  return { kind: "graph", id, name };
}
function node(name: string, id = name): MentionCandidate {
  return { kind: "node", id, name, type: "compose.template_render" };
}
function selection(name: string, id = name): MentionCandidate {
  return { kind: "selection", id, name };
}

function sources(over: Partial<MentionSources> = {}): MentionSources {
  return {
    selection: [],
    nodes: [],
    graphs: [],
    ...over,
  };
}

describe("filterCandidates", () => {
  it("query 为空时按来源顺序返回（选中 → 节点 → 图）", () => {
    const result = filterCandidates("", sources({
      selection: [selection("当前选中节点")],
      nodes: [node("模板渲染")],
      graphs: [graph("订单处理")],
    }));
    expect(result.map((c) => c.kind)).toEqual(["selection", "node", "graph"]);
});

  it("前缀命中优先于子串命中", () => {
    const result = filterCandidates("订单", sources({
      graphs: [graph("处理订单的图", "g1"), graph("订单处理", "g2")],
    }));
    expect(result.map((c) => c.id)).toEqual(["g2", "g1"]);
  });

  it("大小写不敏感", () => {
    const result = filterCandidates("graph", sources({
      graphs: [graph("MyGraph", "g1")],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("g1");
  });

  it("不命中的候选被过滤掉", () => {
    const result= filterCandidates("xyz", sources({
      graphs: [graph("订单处理")],
    }));
    expect(result).toHaveLength(0);
  });

  it("同等命中等级下保持来源相对顺序", () => {
    const result = filterCandidates("a", sources({
      selection: [selection("a-sel", "s1")],
      nodes: [node("a-node", "n1")],
      graphs: [graph("a-graph", "g1")],
    }));
    expect(result.map((c) => c.id)).toEqual(["s1", "n1", "g1"]);
  });
});
