import { describe, it, expect } from "vitest";

import {
  mergeTodoItems,
  computeTodoCounts,
  parseStoredTodoItems,
  SessionTodoListServiceError,
  type TodoItem,
} from "../session-todo-list-service.js";

describe("session-todo-list merge (pure)", () => {
  describe("rewrite mode", () => {
    it("replaces the whole list and assigns ids + default status", () => {
      const result = mergeTodoItems(
        [{ id: "todo_old", title: "old", status: "completed" }],
        [{ title: "First task" }, { title: "Second", status: "in_progress" }],
        "rewrite",
      );
      expect(result).toHaveLength(2);
      expect(result[0]!.title).toBe("First task");
      expect(result[0]!.status).toBe("pending");
      expect(result[0]!.id).toMatch(/^todo_/);
      expect(result[1]!.status).toBe("in_progress");
      // 旧条目不再出现（全量替换）。
      expect(result.some((item) => item.id === "todo_old")).toBe(false);
    });

    it("preserves provided ids and notes", () => {
      const result = mergeTodoItems(
        [],
        [{ id: "keep-me", title: "T", note: "  detail  " }],
        "rewrite",
      );
      expect(result[0]!.id).toBe("keep-me");
      expect(result[0]!.note).toBe("detail");
    });

    it("throws on empty title", () => {
      expect(() => mergeTodoItems([], [{ title: "   " }], "rewrite")).toThrow(
        SessionTodoListServiceError,
      );
    });
  });

  describe("update mode", () => {
    const base: TodoItem[] = [
      { id: "a", title: "Design", status: "completed" },
      { id: "b", title: "Build", status: "pending" },
    ];

    it("updates status of an item matched by id", () => {
      const result = mergeTodoItems(base, [{ id: "b", status: "in_progress" }], "update");
      expect(result).toHaveLength(2);
      expect(result.find((i) => i.id === "b")!.status).toBe("in_progress");
      // title 未提供则保留原值。
      expect(result.find((i) => i.id === "b")!.title).toBe("Build");
    });

    it("matches by title (case-insensitive) when id omitted", () => {
      const result = mergeTodoItems(base, [{ title: "design", status: "blocked" }], "update");
      expect(result.find((i) => i.id === "a")!.status).toBe("blocked");
    });

    it("appends new items that do not match", () => {
      const result = mergeTodoItems(base, [{ title: "Test", status: "pending" }], "update");
      expect(result).toHaveLength(3);
      expect(result[2]!.title).toBe("Test");
    });

    it("deletes a matched item when delete=true", () => {
      const result = mergeTodoItems(base, [{ id: "a", delete: true }], "update");
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("b");
    });

    it("throws on invalid status", () => {
      expect(() =>
        mergeTodoItems(base, [{ id: "b", status: "nope" }], "update"),
      ).toThrow(SessionTodoListServiceError);
    });
  });

  describe("computeTodoCounts", () => {
    it("counts per-status and total", () => {
      const counts = computeTodoCounts([
        { id: "1", title: "a", status: "pending" },
        { id: "2", title: "b", status: "completed" },
        { id: "3", title: "c", status: "completed" },
      ]);
      expect(counts.total).toBe(3);
      expect(counts.completed).toBe(2);
      expect(counts.pending).toBe(1);
      expect(counts.blocked).toBe(0);
    });
  });

  describe("parseStoredTodoItems", () => {
    it("returns [] for null / invalid json", () => {
      expect(parseStoredTodoItems(null)).toEqual([]);
      expect(parseStoredTodoItems("not json")).toEqual([]);
      expect(parseStoredTodoItems("{}")).toEqual([]);
    });

    it("drops entries without a title and defaults status", () => {
      const items = parseStoredTodoItems(
        JSON.stringify([
          { id: "x", title: "Keep", status: "weird" },
          { id: "y" },
          { title: "Auto id" },
        ]),
      );
      expect(items).toHaveLength(2);
      expect(items[0]!.status).toBe("pending");
      expect(items[1]!.id).toMatch(/^todo_/);
    });
  });
});
