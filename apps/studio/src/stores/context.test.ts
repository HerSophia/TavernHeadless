import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/sdk", () => ({
  apiClient: {
    projects: {
      list: vi.fn(),
      listSessions: vi.fn(),
    },
  },
}));

vi.mock("../lib/chat", () => ({
  chatApi: {
    renameSession: vi.fn(),
    setSessionStatus: vi.fn(),
    deleteSession: vi.fn(),
    batchSetSessionStatus: vi.fn(),
    batchDeleteSessions: vi.fn(),
  },
}));

import { apiClient } from "../lib/sdk";
import { chatApi } from "../lib/chat";
import type {
  SessionRecord,
  SessionsBatchDeleteResult,
  SessionsBatchUpdateStatusResult,
} from "../lib/chat";
import { useContextStore } from "./context";

type SessionSummary = {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  title: string | null;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
};

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    workspaceId: null,
    projectId: "p1",
    title: "Session 1",
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const listSessions = vi.mocked(apiClient.projects.listSessions);
const renameSession = vi.mocked(chatApi.renameSession);
const setSessionStatus = vi.mocked(chatApi.setSessionStatus);
const deleteSession = vi.mocked(chatApi.deleteSession);
const batchSetSessionStatus = vi.mocked(chatApi.batchSetSessionStatus);
const batchDeleteSessions = vi.mocked(chatApi.batchDeleteSessions);

/** 构造改名返回的最小 SessionRecord（测试只读取 title）。 */
function record(title: string | null): SessionRecord {
  return { title } as unknown as SessionRecord;
}

function statusMeta(over: Partial<{ notFound: number; total: number; updated: number }> = {}) {
  return {
    meta: { notFound: 0, status: "archived", total: 1, updated: 1, ...over },
    results: [],
  } as unknown as SessionsBatchUpdateStatusResult;
}

function deleteMeta(over: Partial<{ deleted: number; notFound: number; total: number }> = {}) {
  return {
    meta: { deleted: 1, notFound: 0, total: 1, ...over },
    results: [],
  } as unknown as SessionsBatchDeleteResult;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("context store: session list & pagination", () => {
  it("loads first page with active filter and does not auto-select", async () => {
    listSessions.mockResolvedValue({
      items: [session({ id: "s1" }), session({ id: "s2" })],
      nextCursor: "c2",
    });
    const store = useContextStore();

    await store.loadSessions("p1");

    expect(listSessions).toHaveBeenCalledWith({ projectId: "p1", status: "active" });
    expect(store.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(store.currentSessionId).toBeNull();
    expect(store.sessionCursor).toBe("c2");
    expect(store.sessionsHasMore).toBe(true);
  });

  it("appends the next page via cursor", async () => {
    listSessions.mockResolvedValueOnce({ items: [session({ id: "s1" })], nextCursor: "c2" });
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");

    listSessions.mockResolvedValueOnce({ items: [session({ id: "s2" })], nextCursor: null });
    await store.loadMoreSessions();

    expect(listSessions).toHaveBeenLastCalledWith({ projectId: "p1", status: "active", cursor: "c2" });
    expect(store.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(store.sessionCursor).toBeNull();
    expect(store.sessionsHasMore).toBe(false);
  });

  it("does not request more when there is no next page", async () => {
    listSessions.mockResolvedValueOnce({ items: [session()], nextCursor: null });
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");

    listSessions.mockClear();
    await store.loadMoreSessions();

    expect(listSessions).not.toHaveBeenCalled();
  });

  it("changing filter resets cursor and reloads with new status", async () => {
    listSessions.mockResolvedValueOnce({ items: [session()], nextCursor: "c2" });
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");
    expect(store.sessionsHasMore).toBe(true);

    listSessions.mockResolvedValueOnce({ items: [session({ status: "archived" })], nextCursor: null });
    await store.setSessionStatusFilter("archived");

    expect(store.sessionStatusFilter).toBe("archived");
    expect(listSessions).toHaveBeenLastCalledWith({ projectId: "p1", status: "archived" });
    expect(store.sessionsHasMore).toBe(false);
  });

  it("filter=all omits the status param", async () => {
    listSessions.mockResolvedValue({ items: [], nextCursor: null });
    const store = useContextStore();
    store.currentProjectId = "p1";

    await store.setSessionStatusFilter("all");

    expect(store.sessionStatusFilter).toBe("all");
    expect(listSessions).toHaveBeenLastCalledWith({ projectId: "p1", status: undefined });
  });
});

describe("context store: selection model", () => {
  it("selectProject clears current selection and loads without auto-select", async () => {
    listSessions.mockResolvedValue({ items: [session({ id: "s1" })], nextCursor: null });
    const store = useContextStore();
    store.currentSessionId = "old";

    await store.selectProject("p1");

    expect(store.currentProjectId).toBe("p1");
    expect(store.currentSessionId).toBeNull();
  });

  it("refresh keeps current selection even when it is not in the list", async () => {
    listSessions.mockResolvedValue({ items: [session({ id: "s1" })], nextCursor: null });
    const store = useContextStore();
    store.currentProjectId = "p1";
    store.currentSessionId = "s-not-in-list";

    await store.loadSessions("p1");

    expect(store.currentSessionId).toBe("s-not-in-list");
  });

  it("loadSessions error clears the list and reports error but keeps selection", async () => {
    listSessions.mockRejectedValue(new Error("boom"));
    const store = useContextStore();
    store.currentSessionId = "s1";

    await store.loadSessions("p1");

    expect(store.sessions).toEqual([]);
    expect(store.sessionCursor).toBeNull();
    expect(store.sessionsHasMore).toBe(false);
    expect(store.error).toBe("boom");
    expect(store.currentSessionId).toBe("s1");
  });

  it("reset clears list, selection and pagination state", () => {
    const store = useContextStore();
    store.currentSessionId = "s1";
    store.sessionsHasMore = true;
    store.sessionCursor = "c";
    store.sessionStatusFilter = "archived";

    store.reset();

    expect(store.sessions).toEqual([]);
    expect(store.currentSessionId).toBeNull();
    expect(store.sessionCursor).toBeNull();
    expect(store.sessionsHasMore).toBe(false);
    expect(store.sessionStatusFilter).toBe("active");
  });
});

describe("context store: session lifecycle", () => {
  it("renameSession optimistically updates then backfills the returned title", async () => {
    listSessions.mockResolvedValue({ items: [session({ id: "s1", title: "Old" })], nextCursor: null });
    renameSession.mockResolvedValue(record("Renamed"));
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");

    await store.renameSession("s1", "Renamed");

    expect(renameSession).toHaveBeenCalledWith("s1", "Renamed");
    expect(store.sessions[0]!.title).toBe("Renamed");
    expect(store.error).toBeNull();
  });

  it("renameSession rolls back the title on failure and reports error", async () => {
    listSessions.mockResolvedValue({ items: [session({ id: "s1", title: "Old" })], nextCursor: null });
    renameSession.mockRejectedValue(new Error("nope"));
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");

    await store.renameSession("s1", "Renamed");

    expect(store.sessions[0]!.title).toBe("Old");
    expect(store.error).toBe("nope");
  });

  it("archiveSession removes the row and clears selection under the active filter", async () => {
    listSessions.mockResolvedValue({ items: [session({ id: "s1" }), session({ id: "s2" })], nextCursor: null });
    setSessionStatus.mockResolvedValue(record("s1"));
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");
    store.currentSessionId = "s1";

    await store.archiveSession("s1");

    expect(setSessionStatus).toHaveBeenCalledWith("s1", "archived");
    expect(store.sessions.map((s) => s.id)).toEqual(["s2"]);
    expect(store.currentSessionId).toBeNull();
  });

  it("archiveSession updates the badge in place under filter=all", async () => {
    listSessions.mockResolvedValue({ items: [session({ id: "s1", status: "active" })], nextCursor: null });
    setSessionStatus.mockResolvedValue(record("s1"));
    const store = useContextStore();
    store.currentProjectId = "p1";
    store.sessionStatusFilter = "all";
    await store.loadSessions("p1");
    store.currentSessionId = "s1";

    await store.archiveSession("s1");

    expect(store.sessions[0]!.status).toBe("archived");
    expect(store.currentSessionId).toBe("s1");
  });

  it("deleteSession removes the row and clears the matching selection", async () => {
    listSessions.mockResolvedValue({ items: [session({ id: "s1" }), session({ id: "s2" })], nextCursor: null });
    deleteSession.mockResolvedValue(true);
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");
    store.currentSessionId = "s1";

    await store.deleteSession("s1");

    expect(deleteSession).toHaveBeenCalledWith("s1");
    expect(store.sessions.map((s) => s.id)).toEqual(["s2"]);
    expect(store.currentSessionId).toBeNull();
  });

  it("batchArchive refreshes the list, records meta and clears selection under active filter", async () => {
    listSessions.mockResolvedValueOnce({
      items: [session({ id: "s1" }), session({ id: "s2" })],
      nextCursor: null,
    });
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");
    store.currentSessionId = "s1";

    batchSetSessionStatus.mockResolvedValue(statusMeta({ total: 2, updated: 2 }));
    listSessions.mockResolvedValueOnce({ items: [], nextCursor: null });
    await store.batchArchive(["s1", "s2"]);

    expect(batchSetSessionStatus).toHaveBeenCalledWith(["s1", "s2"], "archived");
    expect(store.lastBatchResult).toEqual({ kind: "status", meta: expect.objectContaining({ updated: 2 }) });
    expect(store.currentSessionId).toBeNull();
  });

  it("batchArchive keeps selection when the new status stays visible (filter=all)", async () => {
    listSessions.mockResolvedValueOnce({ items: [session({ id: "s1" })], nextCursor: null });
    const store = useContextStore();
    store.currentProjectId = "p1";
    store.sessionStatusFilter = "all";
    await store.loadSessions("p1");
    store.currentSessionId = "s1";

    batchSetSessionStatus.mockResolvedValue(statusMeta({ total: 1, updated: 1 }));
    listSessions.mockResolvedValueOnce({ items: [session({ id: "s1", status: "archived" })], nextCursor: null });
    await store.batchArchive(["s1"]);

    expect(store.currentSessionId).toBe("s1");
  });

  it("batchDelete refreshes the list, records meta and clears matching selection", async () => {
    listSessions.mockResolvedValueOnce({
      items: [session({ id: "s1" }), session({ id: "s2" })],
      nextCursor: null,
    });
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");
    store.currentSessionId = "s1";

    batchDeleteSessions.mockResolvedValue(deleteMeta({ deleted: 2, total: 2 }));
    listSessions.mockResolvedValueOnce({ items: [], nextCursor: null });
    await store.batchDelete(["s1", "s2"]);

    expect(batchDeleteSessions).toHaveBeenCalledWith(["s1", "s2"]);
    expect(store.lastBatchResult).toEqual({ kind: "delete", meta: expect.objectContaining({ deleted: 2 }) });
    expect(store.currentSessionId).toBeNull();
  });

  it("clearLastBatchResult drops the pending batch hint", async () => {
    listSessions.mockResolvedValue({ items: [session({ id: "s1" })], nextCursor: null });
    const store = useContextStore();
    store.currentProjectId = "p1";
    await store.loadSessions("p1");

    batchDeleteSessions.mockResolvedValue(deleteMeta({ deleted: 1, total: 1 }));
    await store.batchDelete(["s1"]);
    expect(store.lastBatchResult).not.toBeNull();

    store.clearLastBatchResult();
    expect(store.lastBatchResult).toBeNull();
  });
});
