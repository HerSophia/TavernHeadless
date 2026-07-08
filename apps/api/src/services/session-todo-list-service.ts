/**
 * SessionTodoListService — 会话级待办事项清单读写服务（SC2-12 / 批次四）。
 *
 * 供「待办事项工具」（`TodoToolProvider`）与会话详情读路径共用。TODO 直接持久化到
 * `session_todo_list` 表（每会话一行，`session_id` 唯一），不进入变量 page/floor 沙盒
 * 生命周期（决策 E）。合并语义（rewrite / update）抽为纯函数，便于无 DB 单测。
 */

import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { sessionTodoLists } from "../db/schema.js";

/** 待办事项状态。 */
export type TodoItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "cancelled";

/** 所有合法待办状态（顺序即前端展示优先级参考）。 */
export const TODO_ITEM_STATUSES: readonly TodoItemStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "cancelled",
];

/** 待办事项更新模式。 */
export type TodoListUpdateMode = "rewrite" | "update";

/** 单条待办事项（持久化形态）。 */
export interface TodoItem {
  id: string;
  title: string;
  status: TodoItemStatus;
  /** 可选备注 / 说明。 */
  note?: string;
}

/** 工具入参中的单条待办事项（宽松，字段可缺省）。 */
export interface IncomingTodoItem {
  id?: string;
  title?: string;
  status?: string;
  note?: string;
  /** update 模式下置 true 表示删除匹配到的条目。 */
  delete?: boolean;
}

/** 待办事项计数（各状态 + 总数）。 */
export interface SessionTodoCounts {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
  cancelled: number;
}

/** 会话待办清单快照。 */
export interface SessionTodoListSnapshot {
  sessionId: string;
  items: TodoItem[];
  counts: SessionTodoCounts;
  /** 修订号（每次写入 +1）；无记录时为 0。 */
  revision: number;
  /** 最近更新时间戳；无记录时为 null。 */
  updatedAt: number | null;
}

/** 服务错误（供路由映射为 HTTP 状态码；工具层退化为 error 字符串）。 */
export class SessionTodoListServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionTodoListServiceError";
  }
}

function isTodoItemStatus(value: unknown): value is TodoItemStatus {
  return (
    typeof value === "string" &&
    (TODO_ITEM_STATUSES as readonly string[]).includes(value)
  );
}

function normalizeTitle(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNote(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 生成稳定的待办条目 id。 */
export function generateTodoItemId(): string {
  return `todo_${nanoid(10)}`;
}

/** 计算待办计数。 */
export function computeTodoCounts(items: readonly TodoItem[]): SessionTodoCounts {
  const counts: SessionTodoCounts = {
    total: items.length,
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
  };
  for (const item of items) {
    counts[item.status] += 1;
  }
  return counts;
}

/**
 * 解析持久化的 items JSON 为规整的 TodoItem[]（防御非法数据，跳过坏条目）。
 */
export function parseStoredTodoItems(json: string | null | undefined): TodoItem[] {
  if (!json) {
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: TodoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id.length > 0 ? record.id : generateTodoItemId();
    const title = normalizeTitle(record.title);
    if (title.length === 0) {
      continue;
    }
    const status = isTodoItemStatus(record.status) ? record.status : "pending";
    const note = normalizeNote(record.note);
    items.push(note !== undefined ? { id, title, status, note } : { id, title, status });
  }
  return items;
}

/**
 * 合并待办事项（纯函数）。
 *
 * - `rewrite`：用 incoming 全量替换（每条必须有 title；沿用传入 id 否则生成）。
 * - `update`：以 existing 为基础按 id（优先）或 title（不区分大小写）匹配增量更新；
 *   `delete:true` 删除匹配项；未匹配且带 title 的作为新条目追加。
 *
 * 非法输入抛 `SessionTodoListServiceError`。
 */
export function mergeTodoItems(
  existing: readonly TodoItem[],
  incoming: readonly IncomingTodoItem[],
  mode: TodoListUpdateMode,
): TodoItem[] {
  if (!Array.isArray(incoming)) {
    throw new SessionTodoListServiceError(400, "invalid_todo_items", "items must be an array");
  }

  for (const item of incoming) {
    if (item.status !== undefined && !isTodoItemStatus(item.status)) {
      throw new SessionTodoListServiceError(
        400,
        "invalid_todo_status",
        `Invalid status '${String(item.status)}'. Allowed: ${TODO_ITEM_STATUSES.join(", ")}`,
      );
    }
  }

  if (mode === "rewrite") {
    const next: TodoItem[] = [];
    for (const item of incoming) {
      const title = normalizeTitle(item.title);
      if (title.length === 0) {
        throw new SessionTodoListServiceError(
          400,
          "invalid_todo_items",
          "Each item must have a non-empty title in rewrite mode",
        );
      }
      const id = typeof item.id === "string" && item.id.length > 0 ? item.id : generateTodoItemId();
      const status: TodoItemStatus = isTodoItemStatus(item.status) ? item.status : "pending";
      const note = normalizeNote(item.note);
      next.push(note !== undefined ? { id, title, status, note } : { id, title, status });
    }
    return next;
  }

  // update 模式：以 existing 为基础做增量。
  const next: TodoItem[] = existing.map((item) => ({ ...item }));

  const findIndex = (item: IncomingTodoItem): number => {
    if (typeof item.id === "string" && item.id.length > 0) {
      return next.findIndex((existingItem) => existingItem.id === item.id);
    }
    const title = normalizeTitle(item.title).toLowerCase();
    if (title.length === 0) {
      return -1;
    }
    return next.findIndex((existingItem) => existingItem.title.toLowerCase() === title);
  };

  for (const item of incoming) {
    const index = findIndex(item);

    if (item.delete === true) {
      if (index >= 0) {
        next.splice(index, 1);
      }
      continue;
    }

    if (index >= 0) {
      const current = next[index]!;
      const title = normalizeTitle(item.title);
      const note = normalizeNote(item.note);
      next[index] = {
        id: current.id,
        title: title.length > 0 ? title : current.title,
        status: isTodoItemStatus(item.status) ? item.status : current.status,
        ...(note !== undefined
          ? { note }
          : current.note !== undefined
            ? { note: current.note }
            : {}),
      };
      continue;
    }

    // 未匹配：作为新条目追加（title 必填）。
    const title = normalizeTitle(item.title);
    if (title.length === 0) {
      throw new SessionTodoListServiceError(
        400,
        "invalid_todo_items",
        "New items in update mode must have a non-empty title",
      );
    }
    const id = typeof item.id === "string" && item.id.length > 0 ? item.id : generateTodoItemId();
    const status: TodoItemStatus = isTodoItemStatus(item.status) ? item.status : "pending";
    const note = normalizeNote(item.note);
    next.push(note !== undefined ? { id, title, status, note } : { id, title, status });
  }

  return next;
}

function buildSnapshot(sessionId: string, items: TodoItem[], revision: number, updatedAt: number | null): SessionTodoListSnapshot {
  return {
    sessionId,
    items,
    counts: computeTodoCounts(items),
    revision,
    updatedAt,
  };
}

/** 会话待办清单服务。 */
export class SessionTodoListService {
  private readonly now: () => number;

  constructor(
    private readonly db: AppDb | DbExecutor,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /** 读取会话当前待办清单（无记录返回空快照）。 */
  getSnapshot(sessionId: string, accountId: string): SessionTodoListSnapshot {
    const row = this.db
      .select()
      .from(sessionTodoLists)
      .where(
        and(
          eq(sessionTodoLists.sessionId, sessionId),
          eq(sessionTodoLists.accountId, accountId),
        ),
      )
      .limit(1)
      .get();

    if (!row) {
      return buildSnapshot(sessionId, [], 0, null);
    }

    const items = parseStoredTodoItems(row.itemsJson);
    return buildSnapshot(sessionId, items, row.revision, row.updatedAt);
  }

  /**
   * 应用一次待办更新（rewrite / update），返回更新后的快照。
   *
   * 首次写入创建行；后续写入 revision +1。
   */
  applyUpdate(input: {
    sessionId: string;
    accountId: string;
    mode: TodoListUpdateMode;
    items: IncomingTodoItem[];
  }): SessionTodoListSnapshot {
    const { sessionId, accountId, mode, items } = input;
    const now = this.now();

    const existingRow = this.db
      .select()
      .from(sessionTodoLists)
      .where(
        and(
          eq(sessionTodoLists.sessionId, sessionId),
          eq(sessionTodoLists.accountId, accountId),
        ),
      )
      .limit(1)
      .get();

    const existingItems = existingRow ? parseStoredTodoItems(existingRow.itemsJson) : [];
    const nextItems = mergeTodoItems(existingItems, items, mode);
    const itemsJson = JSON.stringify(nextItems);

    if (existingRow) {
      const nextRevision = existingRow.revision + 1;
      this.db
        .update(sessionTodoLists)
        .set({ itemsJson, revision: nextRevision, updatedAt: now })
        .where(eq(sessionTodoLists.id, existingRow.id))
        .run();
      return buildSnapshot(sessionId, nextItems, nextRevision, now);
    }

    this.db
      .insert(sessionTodoLists)
      .values({
        id: `stodo_${nanoid(16)}`,
        sessionId,
        accountId,
        itemsJson,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return buildSnapshot(sessionId, nextItems, 1, now);
  }
}
