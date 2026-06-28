import { describe, expect, it } from "vitest";

import type { GraphAssistantToolPolicyItem } from "../../../lib/graph-assistant-tool-policy-api";
import {
  categorizeTool,
  groupToolPoliciesByCategory,
  isDangerTool,
  shortToolName,
  TOOL_CATEGORY_ORDER,
  toolI18nKey,
} from "./tool-policy-grouping";

function item(toolName: string): GraphAssistantToolPolicyItem {
  return {
    tool_name: toolName,
    side_effect_level: "sandbox",
    default_decision: "auto",
    decision: "auto",
    source: "default",
  };
}

describe("categorizeTool", () => {
  it("把新建图与提交提案归为独立类别", () => {
    expect(categorizeTool("nodegraph.graph.create")).toBe("create");
    expect(categorizeTool("nodegraph.patch.submit_proposal")).toBe("proposal");
  });

  it("把只读工具归为 read", () => {
    expect(categorizeTool("nodegraph.graph.get")).toBe("read");
    expect(categorizeTool("nodegraph.graph.list_versions")).toBe("read");
    expect(categorizeTool("nodegraph.node_type.list")).toBe("read");
    expect(categorizeTool("nodegraph.patch.validate")).toBe("read");
    expect(categorizeTool("nodegraph.patch.diff")).toBe("read");
  });

  it("把草稿改写工具归为 draft", () => {
    expect(categorizeTool("nodegraph.draft.reset")).toBe("draft");
    expect(categorizeTool("nodegraph.node.add")).toBe("draft");
    expect(categorizeTool("nodegraph.edge.add")).toBe("draft");
    expect(categorizeTool("nodegraph.group.create")).toBe("draft");
  });

  it("把未知工具归为 other", () => {
    expect(categorizeTool("nodegraph.unknown.thing")).toBe("other");
    expect(categorizeTool("something.else")).toBe("other");
  });
});

describe("isDangerTool", () => {
  it("仅把 live 持久写工具标记为危险", () => {
    expect(isDangerTool("nodegraph.graph.create")).toBe(true);
    expect(isDangerTool("nodegraph.patch.submit_proposal")).toBe(true);
    expect(isDangerTool("nodegraph.graph.get")).toBe(false);
    expect(isDangerTool("nodegraph.node.add")).toBe(false);
  });
});

describe("shortToolName", () => {
  it("去掉 nodegraph. 前缀", () => {
    expect(shortToolName("nodegraph.graph.get")).toBe("graph.get");
  });

  it("无前缀时原样返回", () => {
    expect(shortToolName("other.tool")).toBe("other.tool");
  });
});

describe("toolI18nKey", () => {
  it("去掉前缀并把点压平为下划线", () => {
    expect(toolI18nKey("nodegraph.graph.get")).toBe("graph_get");
    expect(toolI18nKey("nodegraph.node_type.describe")).toBe("node_type_describe");
    expect(toolI18nKey("nodegraph.patch.submit_proposal")).toBe("patch_submit_proposal");
  });

  it("无前缀时仅压平点", () => {
    expect(toolI18nKey("other.tool")).toBe("other_tool");
  });
});

describe("groupToolPoliciesByCategory", () => {
  it("按固定顺序分组并略去空类别", () => {
    const groups = groupToolPoliciesByCategory([
      item("nodegraph.graph.create"),
      item("nodegraph.node.add"),
      item("nodegraph.graph.get"),
      item("nodegraph.patch.submit_proposal"),
    ]);
    expect(groups.map((group) => group.category)).toEqual(["read", "draft", "proposal", "create"]);
    expect(groups.some((group) => group.category === "other")).toBe(false);
  });

  it("把同类多个工具聚合到一组", () => {
    const groups = groupToolPoliciesByCategory([
      item("nodegraph.node.add"),
      item("nodegraph.edge.add"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe("draft");
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("空输入返回空数组", () => {
    expect(groupToolPoliciesByCategory([])).toEqual([]);
  });

  it("暴露稳定的类别顺序常量", () => {
    expect(TOOL_CATEGORY_ORDER).toEqual(["read", "draft", "proposal", "create", "other"]);
  });
});
