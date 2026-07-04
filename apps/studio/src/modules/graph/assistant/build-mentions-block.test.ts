import { describe, expect, it } from "vitest";

import { buildMentionsBlock } from "./build-mentions-block";
import type { MentionRef } from "./mention-types";

describe("buildMentionsBlock", () => {
 it("空列表返回空串", () => {
    expect(buildMentionsBlock([])).toBe("");
  });

  it("渲染图引用，带 graph_id", () => {
    const block = buildMentionsBlock([{ kind: "graph", id: "ngraph_x", name: "订单处理" }]);
    expect(block).toContain("【用户提及】");
    expect(block).toContain("图「订单处理」: graph_id=ngraph_x");
  });

  it("渲染节点引用，带 node_id 与 type", () => {
    const block = buildMentionsBlock([
      { kind: "node", id: "n_tpl_1", name: "模板渲染", type: "compose.template_render" },
    ]);
    expect(block).toContain("节点「模板渲染」: node_id=n_tpl_1, type=compose.template_render");
  });

  it("同名多 id 标注名称重复并列出全部 id", () => {
    const refs: MentionRef[] = [
      { kind: "graph", id: "g1", name: "订单处理" },
      { kind: "graph", id: "g2", name: "订单处理" },
    ];
    const block = buildMentionsBlock(refs);
    expect(block).toContain("名称重复");
    expect(block).toContain("graph_id=g1");
    expect(block).toContain("graph_id=g2");
  });

  it("不同 kind 的同名不算重复", () => {
    const refs: MentionRef[] = [
      { kind: "graph", id: "g1", name: "处理" },
      { kind: "node", id: "n1", name: "处理", type: "x" },
    ];
    const block = buildMentionsBlock(refs);
    expect(block).not.toContain("名称重复");
  });
});
