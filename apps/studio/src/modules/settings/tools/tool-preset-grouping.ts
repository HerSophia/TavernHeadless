/**
 * 工具策略预设面板的分类/分组纯逻辑（SC2-10 / #b4-7）。
 *
 * 从 ToolPolicyPresetPanel.vue 抽出，便于单测：按后端工具目录的 `category` 分组，
 * 并按固定顺序展示。本模块不含 i18n 与 DOM 依赖。
 */
import type {
  ToolPolicyCategory,
  ToolPolicyPresetToolItem,
} from "../../../lib/tool-policy-preset-api";

/** 分组展示顺序（与后端 `tool-catalog.ts` 的目录顺序一致）。 */
export const TOOL_PRESET_CATEGORY_ORDER: readonly ToolPolicyCategory[] = [
  "character",
  "worldbook",
  "regex",
  "preset",
  "resource_text",
  "nodegraph",
  "todo",
];

/** 副作用不可逆的工具视为「危险」，UI 高亮提示。 */
export function isDangerTool(sideEffectLevel: string): boolean {
  return sideEffectLevel === "irreversible";
}

/** 去掉 `nodegraph.` 前缀，便于在窄列表里展示工具名。 */
export function shortToolName(toolName: string): string {
  return toolName.startsWith("nodegraph.") ? toolName.slice("nodegraph.".length) : toolName;
}

/**
 * 把工具名转成 i18n 安全的 key。
 *
 * 点分工具名（如 `nodegraph.graph.create`）里的 `.` 会被 vue-i18n 当作路径分隔符，
 * 无法命中扁平 map 里的键；此处统一把 `.` 替换为 `_`（→ `nodegraph_graph_create`），
 * 与 `settings.tools.toolName` / `settings.tools.toolDesc` 的键对齐。
 * 裸名工具（如 `create_character`）本就无点，返回原样。
 */
export function toolI18nKey(toolName: string): string {
  return toolName.replace(/\./g, "_");
}

export interface ToolPresetCategoryGroup {
  category: ToolPolicyCategory;
  items: ToolPolicyPresetToolItem[];
}

/**
 * 按类别分组：空类别略去，并按 {@link TOOL_PRESET_CATEGORY_ORDER} 排序。
 *
 * 标签留给调用方按 i18n 解析，保持本函数与界面文案解耦。
 */
export function groupPresetToolsByCategory(
  tools: readonly ToolPolicyPresetToolItem[],
): ToolPresetCategoryGroup[] {
  const byCategory = new Map<ToolPolicyCategory, ToolPolicyPresetToolItem[]>();
  for (const tool of tools) {
    const bucket = byCategory.get(tool.category) ?? [];
    bucket.push(tool);
    byCategory.set(tool.category, bucket);
  }
  return TOOL_PRESET_CATEGORY_ORDER
    .filter((category) => (byCategory.get(category)?.length ?? 0) > 0)
    .map((category) => ({ category, items: byCategory.get(category) ?? [] }));
}
