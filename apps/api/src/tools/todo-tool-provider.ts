/**
 * TodoToolProvider — 待办事项（TODO list）工具（SC2-12 / 批次四）。
 *
 * 提供两个工具：
 * - `update_todo_list`：覆盖式（rewrite）或增量式（update）维护会话待办清单。
 * - `get_todo_list`：读取会话当前待办清单。
 *
 * 待办数据落 `session_todo_list` 表（每会话一行），经 `SessionTodoListService` 读写，
 * 不进入变量 page/floor 沙盒生命周期（决策 E）。实现 `ToolProvider`，与 `ResourceToolProvider`
 * 一样注册到 baseToolRegistry；工具名 / 副作用级别以 `todo-tool-catalog.ts` 为唯一事实源。
 */

import type {
  ToolProvider,
  ToolDefinition,
  ToolCallResult,
  ToolExecutionContext,
  InstanceSlot,
} from "@tavern/core";

import type { AppDb } from "../db/client.js";
import {
  SessionTodoListService,
  TODO_ITEM_STATUSES,
  SessionTodoListServiceError,
  type IncomingTodoItem,
  type TodoListUpdateMode,
  type SessionTodoListSnapshot,
} from "../services/session-todo-list-service.js";
import {
  TODO_TOOL_UPDATE,
  TODO_TOOL_GET,
  TODO_TOOL_CATALOG,
} from "./todo-tool-catalog.js";

/** TODO 工具公共属性：空 allowedSlots = 所有槽位可用；source=builtin。 */
const TODO_COMMON = {
  allowedSlots: [] as InstanceSlot[],
  source: "builtin" as const,
} satisfies Pick<ToolDefinition, "allowedSlots" | "source">;

function descriptionOf(name: string): string {
  return TODO_TOOL_CATALOG.find((entry) => entry.name === name)?.description ?? "";
}

const TODO_TOOLS: ToolDefinition[] = [
  {
    name: TODO_TOOL_UPDATE,
    description: descriptionOf(TODO_TOOL_UPDATE),
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["rewrite", "update"],
          description:
            "'rewrite' replaces the entire list with the provided items; 'update' merges items matched by id (preferred) or title. Defaults to 'rewrite'.",
        },
        items: {
          type: "array",
          description: "The to-do items to write.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "Stable item id. Provide an id returned earlier to update/delete that item; omit to create a new item.",
              },
              title: {
                type: "string",
                description: "Short task title. Required for new items.",
              },
              status: {
                type: "string",
                enum: [...TODO_ITEM_STATUSES],
                description: "Item status. Defaults to 'pending' for new items.",
              },
              note: {
                type: "string",
                description: "Optional note or detail for the item.",
              },
              delete: {
                type: "boolean",
                description:
                  "Only used in 'update' mode: set true to remove the matched item.",
              },
            },
          },
        },
      },
      required: ["items"],
    },
    sideEffectLevel: "sandbox",
    ...TODO_COMMON,
  },
  {
    name: TODO_TOOL_GET,
    description: descriptionOf(TODO_TOOL_GET),
    parameters: {
      type: "object",
      properties: {},
    },
    sideEffectLevel: "none",
    ...TODO_COMMON,
  },
];

function requireAccountId(context: ToolExecutionContext): string {
  if (!context.accountId) {
    throw new Error("accountId is required for todo tools");
  }
  return context.accountId;
}

/** 把入参 items 粗规整为 IncomingTodoItem[]（真正的校验在 mergeTodoItems）。 */
function coerceIncomingItems(raw: unknown): IncomingTodoItem[] {
  if (!Array.isArray(raw)) {
    throw new SessionTodoListServiceError(400, "invalid_todo_items", "items must be an array");
  }
  return raw.map((entry) => {
    const record = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const item: IncomingTodoItem = {};
    if (typeof record.id === "string") item.id = record.id;
    if (typeof record.title === "string") item.title = record.title;
    if (typeof record.status === "string") item.status = record.status;
    if (typeof record.note === "string") item.note = record.note;
    if (typeof record.delete === "boolean") item.delete = record.delete;
    return item;
  });
}

/** 快照 → 工具结果数据（供 LLM 消费）。 */
function toResultData(snapshot: SessionTodoListSnapshot) {
  return {
    items: snapshot.items,
    counts: snapshot.counts,
    revision: snapshot.revision,
  };
}

export class TodoToolProvider implements ToolProvider {
  readonly id = "todo";
  readonly type = "builtin" as const;
  private readonly service: SessionTodoListService;

  constructor(
    db: AppDb,
    options: { now?: () => number } = {},
  ) {
    this.service = new SessionTodoListService(db, options);
  }

  async listTools(): Promise<ToolDefinition[]> {
    return TODO_TOOLS;
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    try {
      switch (name) {
        case TODO_TOOL_UPDATE:
          return this.handleUpdate(args, context);
        case TODO_TOOL_GET:
          return this.handleGet(context);
        default:
          return { error: `Unknown todo tool: ${name}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }

  private handleUpdate(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): ToolCallResult {
    const accountId = requireAccountId(context);
    const rawMode = args.mode;
    if (rawMode !== undefined && rawMode !== "rewrite" && rawMode !== "update") {
      return { error: "mode must be 'rewrite' or 'update'" };
    }
    const mode: TodoListUpdateMode = rawMode === "update" ? "update" : "rewrite";
    const items = coerceIncomingItems(args.items);

    const snapshot = this.service.applyUpdate({
      sessionId: context.sessionId,
      accountId,
      mode,
      items,
    });
    return { data: toResultData(snapshot) };
  }

  private handleGet(context: ToolExecutionContext): ToolCallResult {
    const accountId = requireAccountId(context);
    const snapshot = this.service.getSnapshot(context.sessionId, accountId);
    return { data: toResultData(snapshot) };
  }
}
