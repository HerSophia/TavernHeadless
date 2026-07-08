import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { todoApi } = vi.hoisted(() => ({
  todoApi: {
    get: vi.fn(),
  },
}));

vi.mock("../lib/session-todo-api", () => ({
  sessionTodoApi: todoApi,
}));

import { useSessionTodoStore } from "./session-todo";
import type { SessionTodoListSnapshot } from "../lib/session-todo-api";

function snapshot(overrides: Partial<SessionTodoListSnapshot> = {}): SessionTodoListSnapshot {
  return {
    session_id: "sess_1",
    revision: 2,
    updated_at: 1700000000000,
    counts: {
      total: 3,
      pending: 1,
      in_progress: 1,
      completed: 1,
      blocked: 0,
      cancelled: 0,
    },
    items: [
      { id: "t1", title: "Task A", status: "completed" },
      { id: "t2", title: "Task B", status: "in_progress" },
      { id: "t3", title: "Task C", status: "pending", note: "later" },
    ],
    ...overrides,
  };
}

describe("session-todo store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    todoApi.get.mockReset();
  });

  it("loads a session snapshot and exposes hasItems", async () => {
    todoApi.get.mockResolvedValue(snapshot());
    const store = useSessionTodoStore();

    await store.load("sess_1");

    expect(todoApi.get).toHaveBeenCalledWith("sess_1");
    expect(store.sessionId).toBe("sess_1");
    expect(store.snapshot?.items).toHaveLength(3);
    expect(store.hasItems).toBe(true);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("treats empty list as no items", async () => {
    todoApi.get.mockResolvedValue(
      snapshot({
        revision: 0,
        updated_at: null,
        counts: { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0, cancelled: 0 },
        items: [],
      }),
    );
    const store = useSessionTodoStore();

    await store.load("sess_1");

    expect(store.hasItems).toBe(false);
  });

  it("records error on failure without clearing session", async () => {
    todoApi.get.mockRejectedValue(new Error("boom"));
    const store = useSessionTodoStore();

    await store.load("sess_1");

    expect(store.error).toBe("boom");
    expect(store.snapshot).toBeNull();
    expect(store.loading).toBe(false);
  });

  it("refresh re-fetches the current session", async () => {
    todoApi.get.mockResolvedValue(snapshot());
    const store = useSessionTodoStore();
    await store.load("sess_1");
    todoApi.get.mockClear();

    await store.refresh();

    expect(todoApi.get).toHaveBeenCalledWith("sess_1");
  });

  it("refresh is a no-op without an active session", async () => {
    const store = useSessionTodoStore();
    await store.refresh();
    expect(todoApi.get).not.toHaveBeenCalled();
  });

  it("reset clears state", async () => {
    todoApi.get.mockResolvedValue(snapshot());
    const store = useSessionTodoStore();
    await store.load("sess_1");

    store.reset();

    expect(store.sessionId).toBeNull();
    expect(store.snapshot).toBeNull();
    expect(store.hasItems).toBe(false);
  });
});
