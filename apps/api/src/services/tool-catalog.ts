import type { ToolSideEffectLevel } from "@tavern/core";

import { RESOURCE_TOOL_CATALOG } from "../tools/resource-tool-provider.js";
import { NODE_GRAPH_TOOL_CATALOG } from "../tools/node-graph-tool-provider.js";
import { TODO_TOOL_CATALOG } from "../tools/todo-tool-catalog.js";

/**
 * 统一工具目录聚合。
 *
 * 把三类可被会话工具策略管辖的 Provider 目录合并为一份「工具目录」：
 * - `resource`（资产管理工具，来自 `ResourceToolProvider`）
 * - `nodegraph`（图助手 / 节点图工具，来自 `NodeGraphToolProvider`）
 * - `todo`（待办事项工具，来自 `TodoToolProvider`，#b4-8）
 *
 * 目录条目提供 `category`（分组）与 `sideEffectLevel`（副作用级别），
 * 供工具策略预设的默认决策推导（写=confirm / 读=auto）与前端分组展示使用。
 */

/** 工具目录分组。 */
export type ToolCategory =
  | "character"
  | "worldbook"
  | "regex"
  | "preset"
  | "resource_text"
  | "nodegraph"
  | "todo";

/** 统一工具目录条目。 */
export interface ToolCatalogEntry {
  toolName: string;
  category: ToolCategory;
  sideEffectLevel: ToolSideEffectLevel;
  description: string;
}

/** 由 resource 工具名推导其分组（按资源域细分，便于前端分组展示）。 */
function categorizeResourceTool(toolName: string): ToolCategory {
  if (toolName === "edit_resource_text" || toolName === "search_resource_text") {
    return "resource_text";
  }
  if (toolName.includes("character")) {
    return "character";
  }
  if (toolName.includes("worldbook")) {
    return "worldbook";
  }
  if (toolName.includes("regex")) {
    return "regex";
  }
  if (toolName.includes("preset")) {
    return "preset";
  }
  // 兜底：归入资源文本组（不会命中已知 resource 工具，仅防御未来新增未分类工具）。
  return "resource_text";
}

/**
 * 构建统一工具目录（纯函数，稳定顺序：resource → nodegraph → todo）。
 *
 * 目录来源全部是编译期常量，因此结果可缓存；此处每次重新构建以避免共享可变引用。
 */
export function buildToolCatalog(): ToolCatalogEntry[] {
  const catalog: ToolCatalogEntry[] = [];

  for (const entry of RESOURCE_TOOL_CATALOG) {
    catalog.push({
      toolName: entry.name,
      category: categorizeResourceTool(entry.name),
      sideEffectLevel: entry.sideEffectLevel,
      description: entry.description,
    });
  }

  for (const entry of NODE_GRAPH_TOOL_CATALOG) {
    catalog.push({
      toolName: entry.name,
      category: "nodegraph",
      sideEffectLevel: entry.sideEffectLevel,
      // NODE_GRAPH_TOOL_CATALOG 仅含 name + sideEffectLevel，描述留空占位。
      description: "",
    });
  }

  for (const entry of TODO_TOOL_CATALOG) {
    catalog.push({
      toolName: entry.name,
      category: "todo",
      sideEffectLevel: entry.sideEffectLevel,
      description: entry.description,
    });
  }

  return catalog;
}

/** 统一工具目录（编译期常量，供快速查表）。 */
export const TOOL_CATALOG: ToolCatalogEntry[] = buildToolCatalog();

/** 全部已知工具名集合。 */
export const TOOL_CATALOG_NAMES: ReadonlySet<string> = new Set(
  TOOL_CATALOG.map((entry) => entry.toolName),
);

/** 全部资产管理（resource）工具名（供 `asset-management` 预设默认启用集使用）。 */
export const RESOURCE_TOOL_NAMES: readonly string[] = RESOURCE_TOOL_CATALOG.map(
  (entry) => entry.name,
);

/** 按工具名查目录条目。 */
export function findToolCatalogEntry(toolName: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG.find((entry) => entry.toolName === toolName);
}
