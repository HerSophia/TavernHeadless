import { describe, expect, it } from "vitest";
import { listNodeTypeKnowledge } from "@tavern/core/node-graph";

import {
  buildNodeTypeViewItems,
  filterNodeTypeViewItems,
  groupNodeTypeViewItemsByCategory,
  nodeTypeDetailText,
} from "./node-type-view";

describe("node type view model", () => {
  it("builds searchable view items from core node knowledge", () => {
    const items = buildNodeTypeViewItems(listNodeTypeKnowledge());
    const agentCall = items.find((item) => item.type === "agent.call");
    expect(agentCall).toMatchObject({
      category: "agent",
      inputCount: 2,
      outputCount: 3,
      permissionCount: 1,
    });
    expect(agentCall?.searchText).toContain("agent.call");
    expect(agentCall?.searchText).toContain("project.agent.run");
  });

  it("filters by query, category, and side effect", () => {
    const items = buildNodeTypeViewItems(listNodeTypeKnowledge());
    expect(filterNodeTypeViewItems(items, { query: "memory", category: "select" }).map((item) => item.type))
      .toContain("select.memory_retrieve");
    expect(filterNodeTypeViewItems(items, { category: "control" }).every((item) => item.category === "control"))
      .toBe(true);
    expect(filterNodeTypeViewItems(items, { sideEffect: "write" }).every((item) => item.sideEffects === "write"))
      .toBe(true);
  });

  it("groups items by category using display labels", () => {
    const items = buildNodeTypeViewItems(listNodeTypeKnowledge());
    const groups = groupNodeTypeViewItemsByCategory(items);
    expect(groups.map((group) => group.category)).toEqual(expect.arrayContaining(["source", "control", "annotation"]));
    expect(groups.find((group) => group.category === "control")?.items.map((item) => item.type))
      .toEqual(expect.arrayContaining(["control.condition", "control.branch", "control.gate"]));
  });

  it("uses i18n labels when present and falls back to core text", () => {
    const detail = listNodeTypeKnowledge().find((item) => item.type === "source.user_input");
    expect(detail).toBeDefined();
    const text = nodeTypeDetailText(
      detail ? { ...detail, usage: "Core usage" } : undefined,
      {
        te: (key) => key === "graphNode.type.source_user_input",
        t: () => "用户输入",
      },
    );
    expect(text.title).toBe("用户输入");
    expect(text.summary).toContain("user input");
    expect(text.usage).toBe("Core usage");
  });
});
