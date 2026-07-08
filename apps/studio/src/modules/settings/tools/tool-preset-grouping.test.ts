import { describe, expect, it } from "vitest";

import type { ToolPolicyPresetToolItem } from "../../../lib/tool-policy-preset-api";
import {
  groupPresetToolsByCategory,
  isDangerTool,
  shortToolName,
  toolI18nKey,
} from "./tool-preset-grouping";

function tool(overrides: Partial<ToolPolicyPresetToolItem>): ToolPolicyPresetToolItem {
  return {
    tool_name: "list_characters",
    category: "character",
    side_effect_level: "none",
    description: "",
    enabled: true,
    default_decision: "auto",
    decision: "auto",
    source: "default",
    ...overrides,
  };
}

describe("tool-preset-grouping", () => {
  it("groups tools by category in fixed order, skipping empty categories", () => {
    const groups = groupPresetToolsByCategory([
      tool({ tool_name: "update_todo_list", category: "todo" }),
      tool({ tool_name: "create_character", category: "character" }),
      tool({ tool_name: "list_worldbooks", category: "worldbook" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["character", "worldbook", "todo"]);
  });

  it("flags irreversible tools as danger", () => {
    expect(isDangerTool("irreversible")).toBe(true);
    expect(isDangerTool("sandbox")).toBe(false);
    expect(isDangerTool("none")).toBe(false);
  });

  it("strips the nodegraph prefix for compact display", () => {
    expect(shortToolName("nodegraph.graph.create")).toBe("graph.create");
    expect(shortToolName("create_character")).toBe("create_character");
  });

  it("converts dotted tool names into i18n-safe keys", () => {
    expect(toolI18nKey("nodegraph.graph.create")).toBe("nodegraph_graph_create");
    expect(toolI18nKey("nodegraph.patch.submit_proposal")).toBe("nodegraph_patch_submit_proposal");
    // 裸名工具本就无点，保持原样。
    expect(toolI18nKey("create_character")).toBe("create_character");
    expect(toolI18nKey("update_todo_list")).toBe("update_todo_list");
  });
});
