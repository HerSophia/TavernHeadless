import type { ToolSideEffectLevel } from "@tavern/core";

/**
 * 待办事项（TODO list）工具目录。
 *
 * 这些常量是「工具目录聚合」（`services/tool-catalog.ts`）与「实际 TODO Provider」
 * （`todo-tool-provider.ts`，#b4-8）的**唯一事实源**：工具名 / 副作用级别 / 描述在此定义一次，
 * 供预设策略默认值推导与 provider 实现共同引用，避免两处漂移。
 *
 * 命名与 resource 工具保持一致（裸名，无点分前缀），因为它们同属「聊天会话工具」空间。
 */

/** 覆盖式 / 增量式更新会话待办清单。 */
export const TODO_TOOL_UPDATE = "update_todo_list";
/** 读取会话当前待办清单（只读）。 */
export const TODO_TOOL_GET = "get_todo_list";

/** TODO 工具目录条目：工具名 + 副作用级别 + 描述。 */
export interface TodoToolCatalogEntry {
  name: string;
  sideEffectLevel: ToolSideEffectLevel;
  description: string;
}

/**
 * TODO 工具目录。
 *
 * - `update_todo_list`：写会话状态命名空间 `__todo_list__`，可逆（可再次改写），故 `sandbox`。
 * - `get_todo_list`：纯读取，`none`。
 */
export const TODO_TOOL_CATALOG: TodoToolCatalogEntry[] = [
  {
    name: TODO_TOOL_UPDATE,
    sideEffectLevel: "sandbox",
    description:
      "Create or update the session to-do list. Use mode='rewrite' to replace the whole list, or mode='update' to merge items matched by id/title.",
  },
  {
    name: TODO_TOOL_GET,
    sideEffectLevel: "none",
    description: "Read the current session to-do list.",
  },
];

/** 所有 TODO 工具名集合。 */
export const TODO_TOOL_NAMES: readonly string[] = TODO_TOOL_CATALOG.map((entry) => entry.name);
