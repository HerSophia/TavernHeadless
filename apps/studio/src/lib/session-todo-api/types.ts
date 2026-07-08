/**
 * 会话待办事项清单读取 API 类型（SC2-12 / #b4-9）。
 *
 * 对齐 apps/api `routes/session-todo-list.ts` 的 snake_case 响应契约。
 * 属第一方接入面，不经公共 SDK。
 */

/** 待办事项状态（与后端 SessionTodoListService 一致）。 */
export type TodoItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "cancelled";

/** 单条待办事项。 */
export interface SessionTodoItem {
  id: string;
  title: string;
  status: TodoItemStatus;
  note?: string;
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

/** 会话待办清单快照（GET /sessions/:id/todo-list 的 data）。 */
export interface SessionTodoListSnapshot {
  session_id: string;
  revision: number;
  updated_at: number | null;
  counts: SessionTodoCounts;
  items: SessionTodoItem[];
}

/** 响应包裹。 */
export interface SessionTodoListResponse {
  data: SessionTodoListSnapshot;
}
