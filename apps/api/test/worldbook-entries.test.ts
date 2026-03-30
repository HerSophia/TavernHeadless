/**
 * Worldbook Entry Routes Tests
 *
 * 测试世界书条目管理 CRUD + 批量操作。
 * 使用真实 DB（:memory:）。
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";
import * as retryModule from "../src/lib/retry";

// ── 最小有效世界书 ────────────────────────────────────

const MINIMAL_WORLDBOOK = {
  name: "Test World",
  entries: {
    "0": {
      uid: 0,
      key: ["dragon"],
      keysecondary: ["fire"],
      content: "Dragons are powerful creatures.",
      comment: "Dragon entry",
      selective: true,
      selectiveLogic: 0,
      constant: false,
      position: 0,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
    },
    "1": {
      uid: 1,
      key: ["elf"],
      keysecondary: [],
      content: "Elves live in ancient forests.",
      comment: "Elf entry",
      selective: false,
      selectiveLogic: 0,
      constant: true,
      position: 1,
      order: 200,
      depth: 4,
      role: 0,
      disable: false,
    },
    "2": {
      uid: 2,
      key: ["dwarf"],
      keysecondary: ["mine", "mountain"],
      content: "Dwarves are master smiths.",
      comment: "Dwarf entry",
      selective: true,
      selectiveLogic: 1,
      constant: false,
      position: 0,
      order: 300,
      depth: 2,
      role: 0,
      disable: true,
    },
  },
};

// ── 辅助类型 ──────────────────────────────────────────

interface ImportResponse {
  data: { id: string; name: string; source: string };
}

interface EntryResponse {
  data: {
    id: string;
    worldbook_id: string;
    uid: number;
    comment: string;
    content: string;
    keys: string[];
    keys_secondary: string[];
    selective: boolean;
    selective_logic: number;
    constant: boolean;
    position: number;
    order: number;
    depth: number;
    role: number;
    disable: boolean;
    scan_depth: number | null;
    case_sensitive: boolean | null;
    match_whole_words: boolean | null;
    created_at: number;
    updated_at: number;
  };
}

interface EntryListResponse {
  data: EntryResponse["data"][];
  meta: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    sort_by: string;
    sort_order: string;
  };
}

interface BatchUpdateResponse {
  data: {
    results: Array<{
      index: number;
      id: string;
      action: "updated" | "not_found";
      data?: EntryResponse["data"];
    }>;
    meta: { total: number; updated: number; not_found: number };
  };
}

interface BatchDeleteResponse {
  data: {
    results: Array<{
      index: number;
      id: string;
      action: "deleted" | "not_found";
    }>;
    meta: { total: number; deleted: number; not_found: number };
  };
}

interface BatchReorderResponse {
  data: {
    results: Array<{
      index: number;
      id: string;
      action: "updated" | "not_found";
      data?: EntryResponse["data"];
    }>;
    meta: { total: number; updated: number; not_found: number };
  };
}

interface ErrorBody {
  error: { code: string; message: string };
}

// ── 辅助函数 ──────────────────────────────────────────

async function importWorldbook(app: FastifyInstance, name?: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/import/worldbook",
    payload: { name: name ?? "Test World", data: MINIMAL_WORLDBOOK },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as ImportResponse).data.id;
}

async function listEntries(app: FastifyInstance, wbId: string, query = ""): Promise<EntryListResponse> {
  const res = await app.inject({
    method: "GET",
    url: `/worldbooks/${wbId}/entries${query ? `?${query}` : ""}`,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as EntryListResponse;
}

async function getWorldbookDetail(app: FastifyInstance, wbId: string) {
  const res = await app.inject({ method: "GET", url: `/worldbooks/${wbId}` });
  expect(res.statusCode).toBe(200);
  return res.json() as { data: { version: number; data: Record<string, unknown> } };
}

async function bumpWorldbookVersion(app: FastifyInstance, wbId: string): Promise<number> {
  const detail = await getWorldbookDetail(app, wbId);
  const res = await app.inject({
    method: "PUT",
    url: `/worldbooks/${wbId}`,
    payload: {
      name: `World bumped ${detail.data.version}`,
      expected_version: detail.data.version,
      data: detail.data.data,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  return detail.data.version;
}

async function createEntry(
  app: FastifyInstance,
  wbId: string,
  payload: Record<string, unknown>
): Promise<EntryResponse["data"]> {
  const res = await app.inject({
    method: "POST",
    url: `/worldbooks/${wbId}/entries`,
    payload,
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as EntryResponse).data;
}

// ── Tests ─────────────────────────────────────────────

describe("Worldbook Entry Routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) await app.close();
    vi.restoreAllMocks();
  });

  // ══════════════════════════════════════════════════════
  // 导入后条目自动迁移
  // ══════════════════════════════════════════════════════

  describe("import integration", () => {
    it("imported worldbook entries are accessible via entry endpoints", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);

      expect(list.data.length).toBe(3);
      expect(list.meta.total).toBe(3);

      // 按 order 排序：dragon(100) < elf(200) < dwarf(300)
      expect(list.data[0]!.comment).toBe("Dragon entry");
      expect(list.data[0]!.keys).toEqual(["dragon"]);
      expect(list.data[0]!.keys_secondary).toEqual(["fire"]);
      expect(list.data[0]!.content).toBe("Dragons are powerful creatures.");
      expect(list.data[0]!.uid).toBe(0);
      expect(list.data[0]!.order).toBe(100);

      expect(list.data[1]!.comment).toBe("Elf entry");
      expect(list.data[1]!.constant).toBe(true);
      expect(list.data[1]!.uid).toBe(1);

      expect(list.data[2]!.comment).toBe("Dwarf entry");
      expect(list.data[2]!.disable).toBe(true);
      expect(list.data[2]!.uid).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════
  // Single CRUD
  // ══════════════════════════════════════════════════════

  describe("single CRUD", () => {
    it("creates a new entry with defaults", async () => {
      const wbId = await importWorldbook(app);

      const entry = await createEntry(app, wbId, {
        keys: ["wizard"],
        content: "Wizards cast powerful spells.",
      });

      expect(entry.id).toBeTruthy();
      expect(entry.worldbook_id).toBe(wbId);
      expect(entry.keys).toEqual(["wizard"]);
      expect(entry.content).toBe("Wizards cast powerful spells.");
      expect(entry.comment).toBe("");
      expect(entry.keys_secondary).toEqual([]);
      expect(entry.selective).toBe(true);
      expect(entry.selective_logic).toBe(0);
      expect(entry.constant).toBe(false);
      expect(entry.position).toBe(0);
      expect(entry.order).toBe(100);
      expect(entry.depth).toBe(4);
      expect(entry.role).toBe(0);
      expect(entry.disable).toBe(false);
      expect(entry.scan_depth).toBeNull();
      expect(entry.case_sensitive).toBeNull();
      expect(entry.match_whole_words).toBeNull();
      expect(entry.created_at).toBeGreaterThan(0);
      expect(entry.updated_at).toBe(entry.created_at);
    });

    it("creates entry with all custom fields", async () => {
      const wbId = await importWorldbook(app);

      const entry = await createEntry(app, wbId, {
        keys: ["orc"],
        keys_secondary: ["war"],
        content: "Orcs are fierce warriors.",
        comment: "Orc entry",
        selective: false,
        selective_logic: 2,
        constant: true,
        position: 3,
        order: 50,
        depth: 8,
        role: 1,
        disable: true,
        scan_depth: 10,
        case_sensitive: true,
        match_whole_words: false,
      });

      expect(entry.keys_secondary).toEqual(["war"]);
      expect(entry.comment).toBe("Orc entry");
      expect(entry.selective).toBe(false);
      expect(entry.selective_logic).toBe(2);
      expect(entry.constant).toBe(true);
      expect(entry.position).toBe(3);
      expect(entry.order).toBe(50);
      expect(entry.depth).toBe(8);
      expect(entry.role).toBe(1);
      expect(entry.disable).toBe(true);
      expect(entry.scan_depth).toBe(10);
      expect(entry.case_sensitive).toBe(true);
      expect(entry.match_whole_words).toBe(false);
    });

    it("auto-assigns uid incrementally", async () => {
      const wbId = await importWorldbook(app);
      // 导入时已有 uid 0, 1, 2

      const e1 = await createEntry(app, wbId, { keys: ["a"], content: "A" });
      expect(e1.uid).toBe(3);

      const e2 = await createEntry(app, wbId, { keys: ["b"], content: "B" });
      expect(e2.uid).toBe(4);
    });

    it("gets a single entry by id", async () => {
      const wbId = await importWorldbook(app);
      const created = await createEntry(app, wbId, { keys: ["test"], content: "Test" });

      const res = await app.inject({
        method: "GET",
        url: `/worldbooks/${wbId}/entries/${created.id}`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as EntryResponse;
      expect(body.data.id).toBe(created.id);
      expect(body.data.content).toBe("Test");
    });

    it("returns 404 for non-existent entry", async () => {
      const wbId = await importWorldbook(app);

      const res = await app.inject({
        method: "GET",
        url: `/worldbooks/${wbId}/entries/non-existent`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for non-existent worldbook", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/worldbooks/non-existent/entries",
      });
      expect(res.statusCode).toBe(404);
    });

    it("patches an entry partially", async () => {
      const wbId = await importWorldbook(app);
      const created = await createEntry(app, wbId, {
        keys: ["original"],
        content: "Original content",
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/worldbooks/${wbId}/entries/${created.id}`,
        payload: { content: "Updated content", disable: true },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as EntryResponse;
      expect(body.data.content).toBe("Updated content");
      expect(body.data.disable).toBe(true);
      // 未修改的字段不变
      expect(body.data.keys).toEqual(["original"]);
      expect(body.data.updated_at).toBeGreaterThanOrEqual(created.updated_at);
    });

    it("patch returns 400 when no fields provided", async () => {
      const wbId = await importWorldbook(app);
      const created = await createEntry(app, wbId, { keys: ["x"], content: "X" });

      const res = await app.inject({
        method: "PATCH",
        url: `/worldbooks/${wbId}/entries/${created.id}`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("patch returns 404 for non-existent entry", async () => {
      const wbId = await importWorldbook(app);

      const res = await app.inject({
        method: "PATCH",
        url: `/worldbooks/${wbId}/entries/non-existent`,
        payload: { content: "x" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("deletes an entry", async () => {
      const wbId = await importWorldbook(app);
      const created = await createEntry(app, wbId, { keys: ["temp"], content: "Temp" });

      const delRes = await app.inject({
        method: "DELETE",
        url: `/worldbooks/${wbId}/entries/${created.id}`,
      });
      expect(delRes.statusCode).toBe(200);

      const body = delRes.json() as { data: { id: string; deleted: boolean } };
      expect(body.data.id).toBe(created.id);
      expect(body.data.deleted).toBe(true);

      // 确认已删除
      const getRes = await app.inject({
        method: "GET",
        url: `/worldbooks/${wbId}/entries/${created.id}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it("delete returns 404 for non-existent entry", async () => {
      const wbId = await importWorldbook(app);

      const res = await app.inject({
        method: "DELETE",
        url: `/worldbooks/${wbId}/entries/non-existent`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════
  // List — 分页、过滤、搜索、排序
  // ══════════════════════════════════════════════════════

  describe("list, pagination, filter, search", () => {
    it("paginates with limit and offset", async () => {
      const wbId = await importWorldbook(app);

      const page1 = await listEntries(app, wbId, "limit=2&offset=0&sort_by=order&sort_order=asc");
      expect(page1.data.length).toBe(2);
      expect(page1.meta.total).toBe(3);
      expect(page1.meta.has_more).toBe(true);
      expect(page1.data[0]!.order).toBe(100);
      expect(page1.data[1]!.order).toBe(200);

      const page2 = await listEntries(app, wbId, "limit=2&offset=2&sort_by=order&sort_order=asc");
      expect(page2.data.length).toBe(1);
      expect(page2.meta.has_more).toBe(false);
      expect(page2.data[0]!.order).toBe(300);
    });

    it("sorts by uid descending", async () => {
      const wbId = await importWorldbook(app);

      const list = await listEntries(app, wbId, "sort_by=uid&sort_order=desc");
      expect(list.data[0]!.uid).toBe(2);
      expect(list.data[1]!.uid).toBe(1);
      expect(list.data[2]!.uid).toBe(0);
    });

    it("filters by disable status", async () => {
      const wbId = await importWorldbook(app);

      const disabled = await listEntries(app, wbId, "disable=true");
      expect(disabled.data.length).toBe(1);
      expect(disabled.data[0]!.comment).toBe("Dwarf entry");

      const enabled = await listEntries(app, wbId, "disable=false");
      expect(enabled.data.length).toBe(2);
    });

    it("filters by constant status", async () => {
      const wbId = await importWorldbook(app);

      const constants = await listEntries(app, wbId, "constant=true");
      expect(constants.data.length).toBe(1);
      expect(constants.data[0]!.comment).toBe("Elf entry");
    });

    it("filters by position", async () => {
      const wbId = await importWorldbook(app);

      const pos0 = await listEntries(app, wbId, "position=0");
      expect(pos0.data.length).toBe(2); // dragon + dwarf

      const pos1 = await listEntries(app, wbId, "position=1");
      expect(pos1.data.length).toBe(1); // elf
    });

    it("searches by keyword in keys", async () => {
      const wbId = await importWorldbook(app);

      const result = await listEntries(app, wbId, "q=dragon");
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.comment).toBe("Dragon entry");
    });

    it("searches by keyword in content", async () => {
      const wbId = await importWorldbook(app);

      const result = await listEntries(app, wbId, "q=forests");
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.comment).toBe("Elf entry");
    });

    it("searches by keyword in comment", async () => {
      const wbId = await importWorldbook(app);

      const result = await listEntries(app, wbId, "q=Dwarf");
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.comment).toBe("Dwarf entry");
    });

    it("search with no matches returns empty", async () => {
      const wbId = await importWorldbook(app);

      const result = await listEntries(app, wbId, "q=unicorn");
      expect(result.data.length).toBe(0);
      expect(result.meta.total).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════
  // Batch update
  // ══════════════════════════════════════════════════════

  describe("batch update", () => {
    it("updates multiple entries with shared fields", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);
      const ids = list.data.map((e) => e.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/worldbooks/${wbId}/entries/batch/update`,
        payload: {
          ids: [ids[0], ids[1]],
          fields: { disable: true, depth: 10 },
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as BatchUpdateResponse;
      expect(body.data.meta.total).toBe(2);
      expect(body.data.meta.updated).toBe(2);
      expect(body.data.meta.not_found).toBe(0);

      expect(body.data.results[0]!.action).toBe("updated");
      expect(body.data.results[0]!.data!.disable).toBe(true);
      expect(body.data.results[0]!.data!.depth).toBe(10);

      expect(body.data.results[1]!.action).toBe("updated");
      expect(body.data.results[1]!.data!.disable).toBe(true);
    });

    it("reports not_found for missing ids", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);

      const res = await app.inject({
        method: "PATCH",
        url: `/worldbooks/${wbId}/entries/batch/update`,
        payload: {
          ids: [list.data[0]!.id, "non-existent"],
          fields: { disable: false },
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as BatchUpdateResponse;
      expect(body.data.meta.updated).toBe(1);
      expect(body.data.meta.not_found).toBe(1);
      expect(body.data.results[1]!.action).toBe("not_found");
    });

    it("returns 400 for duplicate ids", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);
      const id = list.data[0]!.id;

      const res = await app.inject({
        method: "PATCH",
        url: `/worldbooks/${wbId}/entries/batch/update`,
        payload: {
          ids: [id, id],
          fields: { disable: true },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when fields is empty", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);

      const res = await app.inject({
        method: "PATCH",
        url: `/worldbooks/${wbId}/entries/batch/update`,
        payload: {
          ids: [list.data[0]!.id],
          fields: {},
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for non-existent worldbook", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/worldbooks/non-existent/entries/batch/update",
        payload: {
          ids: ["some-id"],
          fields: { disable: true },
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════
  // Batch delete
  // ══════════════════════════════════════════════════════

  describe("batch delete", () => {
    it("deletes multiple entries", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);
      const ids = list.data.map((e) => e.id);

      const res = await app.inject({
        method: "POST",
        url: `/worldbooks/${wbId}/entries/batch/delete`,
        payload: { ids: [ids[0], ids[1]] },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as BatchDeleteResponse;
      expect(body.data.meta.deleted).toBe(2);
      expect(body.data.meta.not_found).toBe(0);

      // 确认只剩 1 条
      const remaining = await listEntries(app, wbId);
      expect(remaining.meta.total).toBe(1);
    });

    it("reports not_found for missing ids", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);

      const res = await app.inject({
        method: "POST",
        url: `/worldbooks/${wbId}/entries/batch/delete`,
        payload: { ids: [list.data[0]!.id, "non-existent"] },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as BatchDeleteResponse;
      expect(body.data.meta.deleted).toBe(1);
      expect(body.data.meta.not_found).toBe(1);
    });

    it("returns 400 for duplicate ids", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);
      const id = list.data[0]!.id;

      const res = await app.inject({
        method: "POST",
        url: `/worldbooks/${wbId}/entries/batch/delete`,
        payload: { ids: [id, id] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════
  // Batch reorder
  // ══════════════════════════════════════════════════════

  describe("batch reorder", () => {
    it("reorders entries", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId, "sort_by=order&sort_order=asc");
      const ids = list.data.map((e) => e.id);

      // 反转排序
      const res = await app.inject({
        method: "PUT",
        url: `/worldbooks/${wbId}/entries/batch/reorder`,
        payload: {
          items: [
            { id: ids[0], order: 300 },
            { id: ids[1], order: 200 },
            { id: ids[2], order: 100 },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as BatchReorderResponse;
      expect(body.data.meta.updated).toBe(3);
      expect(body.data.meta.not_found).toBe(0);

      // 验证新排序
      const reordered = await listEntries(app, wbId, "sort_by=order&sort_order=asc");
      expect(reordered.data[0]!.order).toBe(100);
      expect(reordered.data[0]!.comment).toBe("Dwarf entry");
      expect(reordered.data[2]!.order).toBe(300);
      expect(reordered.data[2]!.comment).toBe("Dragon entry");
    });

    it("reports not_found for missing ids in reorder", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);

      const res = await app.inject({
        method: "PUT",
        url: `/worldbooks/${wbId}/entries/batch/reorder`,
        payload: {
          items: [
            { id: list.data[0]!.id, order: 1 },
            { id: "non-existent", order: 2 },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as BatchReorderResponse;
      expect(body.data.meta.updated).toBe(1);
      expect(body.data.meta.not_found).toBe(1);
    });

    it("returns 400 for duplicate ids in reorder", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);
      const id = list.data[0]!.id;

      const res = await app.inject({
        method: "PUT",
        url: `/worldbooks/${wbId}/entries/batch/reorder`,
        payload: {
          items: [
            { id, order: 1 },
            { id, order: 2 },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it.each([
      (wbId: string, staleVersion: number, entryId: string) => ({ method: "POST" as const, url: `/worldbooks/${wbId}/entries`, payload: { expected_version: staleVersion, keys: ["stale"], content: "create" } }),
      (wbId: string, staleVersion: number, entryId: string) => ({ method: "PATCH" as const, url: `/worldbooks/${wbId}/entries/${entryId}`, payload: { expected_version: staleVersion, content: "patch" } }),
      (wbId: string, staleVersion: number, entryId: string) => ({ method: "DELETE" as const, url: `/worldbooks/${wbId}/entries/${entryId}?expected_version=${staleVersion}` }),
      (wbId: string, staleVersion: number, entryId: string) => ({ method: "PATCH" as const, url: `/worldbooks/${wbId}/entries/batch/update`, payload: { expected_version: staleVersion, ids: [entryId], fields: { disable: true } } }),
      (wbId: string, staleVersion: number, entryId: string) => ({ method: "POST" as const, url: `/worldbooks/${wbId}/entries/batch/delete`, payload: { expected_version: staleVersion, ids: [entryId] } }),
      (wbId: string, staleVersion: number, entryId: string) => ({ method: "PUT" as const, url: `/worldbooks/${wbId}/entries/batch/reorder`, payload: { expected_version: staleVersion, items: [{ id: entryId, order: 999 }] } }),
    ])("returns 409 worldbook_conflict for stale entry write baseline", async (buildRequest) => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);
      const entryId = list.data[0]!.id;
      const staleVersion = await bumpWorldbookVersion(app, wbId);

      const res = await app.inject(buildRequest(wbId, staleVersion, entryId));
      expect(res.statusCode).toBe(409);
      expect((res.json() as ErrorBody).error.code).toBe("worldbook_conflict");
    });

    it("returns 503 resource_busy when worldbook entry writes exhaust busy retries", async () => {
      const wbId = await importWorldbook(app);
      const list = await listEntries(app, wbId);
      vi.spyOn(retryModule, "executeWithSqliteBusyRetry").mockRejectedValueOnce(new retryModule.ResourceBusyError("database is locked"));

      const res = await app.inject({
        method: "PATCH",
        url: `/worldbooks/${wbId}/entries/${list.data[0]!.id}`,
        payload: { content: "busy patch" },
      });

      expect(res.statusCode).toBe(503);
      expect((res.json() as ErrorBody).error.code).toBe("resource_busy");
    });
  });

  // ══════════════════════════════════════════════════════
  // 级联删除
  // ══════════════════════════════════════════════════════

  describe("cascade delete", () => {
    it("deleting worldbook removes all its entries", async () => {
      const wbId = await importWorldbook(app);

      // 确认有条目
      const before = await listEntries(app, wbId);
      expect(before.meta.total).toBe(3);

      // 删除世界书
      const delRes = await app.inject({
        method: "DELETE",
        url: `/worldbooks/${wbId}`,
      });
      expect(delRes.statusCode).toBe(204);

      // 世界书已不存在，查条目返回 404
      const entryRes = await app.inject({
        method: "GET",
        url: `/worldbooks/${wbId}/entries`,
      });
      expect(entryRes.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════
  // 跨世界书隔离
  // ══════════════════════════════════════════════════════

  describe("cross-worldbook isolation", () => {
    it("entries from one worldbook are not visible in another", async () => {
      const wb1 = await importWorldbook(app, "World 1");
      const wb2 = await importWorldbook(app, "World 2");

      const list1 = await listEntries(app, wb1);
      const list2 = await listEntries(app, wb2);

      // 各自 3 条
      expect(list1.meta.total).toBe(3);
      expect(list2.meta.total).toBe(3);

      // ID 不重叠
      const ids1 = new Set(list1.data.map((e) => e.id));
      const ids2 = new Set(list2.data.map((e) => e.id));
      for (const id of ids1) {
        expect(ids2.has(id)).toBe(false);
      }
    });

    it("cannot access entry from wrong worldbook", async () => {
      const wb1 = await importWorldbook(app, "World 1");
      const wb2 = await importWorldbook(app, "World 2");

      const list1 = await listEntries(app, wb1);
      const entryFromWb1 = list1.data[0]!.id;

      // 用 wb2 的路径去访问 wb1 的条目
      const res = await app.inject({
        method: "GET",
        url: `/worldbooks/${wb2}/entries/${entryFromWb1}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("cannot delete entry from wrong worldbook", async () => {
      const wb1 = await importWorldbook(app, "World 1");
      const wb2 = await importWorldbook(app, "World 2");

      const list1 = await listEntries(app, wb1);
      const entryFromWb1 = list1.data[0]!.id;

      const res = await app.inject({
        method: "DELETE",
        url: `/worldbooks/${wb2}/entries/${entryFromWb1}`,
      });
      expect(res.statusCode).toBe(404);

      // 原世界书中条目仍在
      const check = await app.inject({
        method: "GET",
        url: `/worldbooks/${wb1}/entries/${entryFromWb1}`,
      });
      expect(check.statusCode).toBe(200);
    });

    it("cannot update entry from wrong worldbook", async () => {
      const wb1 = await importWorldbook(app, "World 1");
      const wb2 = await importWorldbook(app, "World 2");

      const list1 = await listEntries(app, wb1);
      const entryFromWb1 = list1.data[0]!.id;

      const res = await app.inject({
        method: "PATCH",
        url: `/worldbooks/${wb2}/entries/${entryFromWb1}`,
        payload: { content: "hacked" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════
  // 多账号隔离
  // ══════════════════════════════════════════════════════

  describe("account isolation", () => {
    let multiApp: FastifyInstance;
    let tokenA: string;
    let tokenB: string;

    beforeEach(async () => {
      ({ app: multiApp } = await buildApp({
        databasePath: ":memory:",
        logger: false,
        auth: { mode: "jwt", jwtSecret: "test-secret" },
        accountMode: "multi",
      }));

      const rootToken = multiApp.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });
      tokenA = multiApp.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
      tokenB = multiApp.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });

      // 创建两个账号
      await multiApp.inject({
        method: "POST",
        url: "/accounts",
        headers: { authorization: `Bearer ${rootToken}` },
        payload: { id: "acc-a", name: "Account A" },
      });
      await multiApp.inject({
        method: "POST",
        url: "/accounts",
        headers: { authorization: `Bearer ${rootToken}` },
        payload: { id: "acc-b", name: "Account B" },
      });
    });

    afterEach(async () => {
      if (multiApp) await multiApp.close();
    });

    it("account A cannot see account B worldbook entries", async () => {
      // Account A 导入世界书
      const importRes = await multiApp.inject({
        method: "POST",
        url: "/import/worldbook",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: "World A", data: MINIMAL_WORLDBOOK },
      });
      expect(importRes.statusCode).toBe(201);
      const wbId = (importRes.json() as ImportResponse).data.id;

      // Account A 能看到条目
      const aRes = await multiApp.inject({
        method: "GET",
        url: `/worldbooks/${wbId}/entries`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(aRes.statusCode).toBe(200);
      expect((aRes.json() as EntryListResponse).data.length).toBe(3);

      // Account B 看不到（worldbook 不属于 B，返回 404）
      const bRes = await multiApp.inject({
        method: "GET",
        url: `/worldbooks/${wbId}/entries`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(bRes.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════
  // GET /worldbooks/:id 详情兼容性
  // ══════════════════════════════════════════════════════

  describe("worldbook detail compatibility", () => {
    it("GET /worldbooks/:id returns entries from entry table", async () => {
      const wbId = await importWorldbook(app);

      // 通过条目端点新增一条
      await createEntry(app, wbId, {
        keys: ["wizard"],
        content: "Wizard content",
        comment: "Wizard entry",
      });

      // 通过世界书详情端点查看，应包含 4 条
      const res = await app.inject({ method: "GET", url: `/worldbooks/${wbId}` });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { data: { data: { entries: unknown[] } } };
      expect(Array.isArray(body.data.data.entries)).toBe(true);
      expect(body.data.data.entries.length).toBe(4);
    });
  });
});
