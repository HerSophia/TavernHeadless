/**
 * 图助手工具策略面板的分类/分组纯逻辑（阶段 2）。
 *
 * 从 ToolPolicyPanel.vue 抽出，便于单测：按工具名归类（读取 / 草稿 / 提案 / 新建图 / 其他），
 * 标注 live 持久写「危险」工具，并按固定顺序分组。本模块不含 i18n 与 DOM 依赖。
 */
import type { GraphAssistantToolPolicyItem } from "../../../lib/graph-assistant-tool-policy-api";

export type ToolCategory = "read" | "draft" | "proposal" | "create" | "other";

/** 分组展示顺序。 */
export const TOOL_CATEGORY_ORDER: readonly ToolCategory[] = [
  "read",
  "draft",
  "proposal",
  "create",
  "other",
];

/** live 持久写工具：默认归 confirm，并在 UI 标「危险」。 */
export const DANGER_TOOLS: ReadonlySet<string> = new Set<string>([
  "nodegraph.graph.create",
  "nodegraph.patch.submit_proposal",
]);

/** 按工具名归类到展示类别。 */
export function categorizeTool(toolName: string): ToolCategory {
  if (toolName === "nodegraph.graph.create") return "create";
  if (toolName === "nodegraph.patch.submit_proposal") return "proposal";
  if (
    toolName.startsWith("nodegraph.graph.get")
    || toolName.startsWith("nodegraph.graph.list_versions")
    || toolName.startsWith("nodegraph.node_type.")
    || toolName === "nodegraph.patch.validate"
    || toolName === "nodegraph.patch.diff"
  ) {
    return "read";
  }
  if (
    toolName.startsWith("nodegraph.draft.")
    || toolName.startsWith("nodegraph.node.")
    || toolName.startsWith("nodegraph.edge.")
    || toolName.startsWith("nodegraph.group.")
  ) {
    return "draft";
  }
  return "other";
}

/** 是否为 live 持久写「危险」工具。 */
export function isDangerTool(toolName: string): boolean {
  return DANGER_TOOLS.has(toolName);
}

/** 去掉 `nodegraph.` 前缀，便于在窄列表里展示工具名。 */
export function shortToolName(toolName: string): string {
  return toolName.startsWith("nodegraph.") ? toolName.slice("nodegraph.".length) : toolName;
}

/**
 * 把工具名转为 i18n 安全键：去掉 `nodegraph.` 前缀，再把 `.` 换成 `_`。
 *
 * 工具名里的点会被 vue-i18n 当成嵌套路径分隔符，故这里压平成单段键
 * （如 `nodegraph.graph.get` -> `graph_get`），便于在 messages 里平铺索引。
 */
export function toolI18nKey(toolName: string): string {
  return shortToolName(toolName).replace(/\./g, "_");
}

export interface ToolCategoryGroup {
  category: ToolCategory;
  items: GraphAssistantToolPolicyItem[];
}

/**
 * 按类别分组：空类别略去，并按 {@link TOOL_CATEGORY_ORDER} 排序。
 *
 * 标签留给调用方按 i18n 解析，保持本函数与界面文案解耦。
 */
export function groupToolPoliciesByCategory(
  items: readonly GraphAssistantToolPolicyItem[],
): ToolCategoryGroup[] {
  const byCategory = new Map<ToolCategory, GraphAssistantToolPolicyItem[]>();
  for (const item of items) {
    const category = categorizeTool(item.tool_name);
    const bucket = byCategory.get(category) ?? [];
    bucket.push(item);
    byCategory.set(category, bucket);
  }
  return TOOL_CATEGORY_ORDER
    .filter((category) => (byCategory.get(category)?.length ?? 0) > 0)
    .map((category) => ({ category, items: byCategory.get(category) ?? [] }));
}
