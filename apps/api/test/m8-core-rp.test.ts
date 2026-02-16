/**
 * M8 核心 RP 体验接口集成测试
 *
 * 覆盖三个接口：
 * - GET /sessions/:id/timeline
 * - POST /floors/:id/branch
 * - PATCH /pages/:id/activate
 */
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type ItemResponse<T> = { data: T };
type TimelineResponse = {
  data: {
    session_id: string;
    branch_id: string;
    floors: Array<{
      id: string;
      floor_no: number;
      state: string;
      token_in: number;
      token_out: number;
      created_at: number;
      active_page: {
        id: string;
        page_no: number;
        page_kind: string;
        version: number;
        messages: Array<{
          id: string;
          seq: number;
          role: string;
          content: string;
          content_format: string;
        }>;
      } | null;
      page_count: number;
    }>;
  };
  meta: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    sort_by: string;
    sort_order: string;
  };
};

describe("M8: Core RP Experience", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── Timeline Tests ────────────────────────────────────

  describe("GET /sessions/:id/timeline", () => {
    it("returns empty floors for a session with no floors", async () => {
      const session = await createSession(app);

      const res = await app.inject({
        method: "GET",
        url: `/sessions/${session.id}/timeline`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TimelineResponse>();
      expect(body.data.session_id).toBe(session.id);
      expect(body.data.branch_id).toBe("main");
      expect(body.data.floors).toHaveLength(0);
      expect(body.meta.total).toBe(0);
    });

    it("returns committed floors with active page and messages", async () => {
      const session = await createSession(app);
      const floor = await createFloor(app, {
        session_id: session.id,
        floor_no: 0,
        branch_id: "main",
        state: "committed",
      });
      const page = await createPage(app, { floor_id: floor.id, page_no: 0, page_kind: "output" });
      await createMessage(app, { page_id: page.id, seq: 0, role: "assistant", content: "Hello!" });

      const res = await app.inject({
        method: "GET",
        url: `/sessions/${session.id}/timeline`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TimelineResponse>();
      expect(body.data.floors).toHaveLength(1);

      const f = body.data.floors[0]!;
      expect(f.floor_no).toBe(0);
      expect(f.state).toBe("committed");
      expect(f.active_page).not.toBeNull();
      expect(f.active_page!.id).toBe(page.id);
      expect(f.active_page!.messages).toHaveLength(1);
      expect(f.active_page!.messages[0]!.content).toBe("Hello!");
      expect(f.page_count).toBe(1);
    });

    it("excludes non-committed floors (draft, failed)", async () => {
      const session = await createSession(app);
      await createFloor(app, { session_id: session.id, floor_no: 0, branch_id: "main", state: "committed" });
      await createFloor(app, { session_id: session.id, floor_no: 1, branch_id: "main", state: "draft" });
      await createFloor(app, { session_id: session.id, floor_no: 2, branch_id: "main", state: "failed" });

      const res = await app.inject({
        method: "GET",
        url: `/sessions/${session.id}/timeline`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TimelineResponse>();
      expect(body.data.floors).toHaveLength(1);
      expect(body.data.floors[0]!.floor_no).toBe(0);
      expect(body.meta.total).toBe(1);
    });

    it("filters by branch_id", async () => {
      const session = await createSession(app);
      await createFloor(app, { session_id: session.id, floor_no: 0, branch_id: "main", state: "committed" });
      await createFloor(app, { session_id: session.id, floor_no: 0, branch_id: "alt", state: "committed" });

      const mainRes = await app.inject({
        method: "GET",
        url: `/sessions/${session.id}/timeline?branch_id=main`,
      });
      expect(mainRes.json<TimelineResponse>().data.floors).toHaveLength(1);

      const altRes = await app.inject({
        method: "GET",
        url: `/sessions/${session.id}/timeline?branch_id=alt`,
      });
      const altBody = altRes.json<TimelineResponse>();
      expect(altBody.data.floors).toHaveLength(1);
      expect(altBody.data.branch_id).toBe("alt");
    });

    it("supports pagination (limit/offset)", async () => {
      const session = await createSession(app);
      for (let i = 0; i < 5; i++) {
        await createFloor(app, { session_id: session.id, floor_no: i, branch_id: "main", state: "committed" });
      }

      const res = await app.inject({
        method: "GET",
        url: `/sessions/${session.id}/timeline?limit=2&offset=1`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TimelineResponse>();
      expect(body.data.floors).toHaveLength(2);
      expect(body.data.floors[0]!.floor_no).toBe(1);
      expect(body.data.floors[1]!.floor_no).toBe(2);
      expect(body.meta.total).toBe(5);
      expect(body.meta.has_more).toBe(true);
    });

    it("page_count reflects total pages per floor (including inactive)", async () => {
      const session = await createSession(app);
      const floor = await createFloor(app, {
        session_id: session.id,
        floor_no: 0,
        branch_id: "main",
        state: "committed",
      });
      // 创建两个 page，只有一个 active
      await createPage(app, { floor_id: floor.id, page_no: 0, page_kind: "output", is_active: true, version: 1 });
      await createPage(app, { floor_id: floor.id, page_no: 0, page_kind: "output", is_active: false, version: 2 });

      const res = await app.inject({
        method: "GET",
        url: `/sessions/${session.id}/timeline`,
      });

      const body = res.json<TimelineResponse>();
      expect(body.data.floors[0]!.page_count).toBe(2);
    });

    it("returns 404 for non-existent session", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/sessions/nonexistent/timeline",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Branch Tests ───────────────────────────────────────

  describe("POST /floors/:id/branch", () => {
    it("creates a branch with auto-generated branch_id", async () => {
      const session = await createSession(app);
      const floor = await createFloor(app, {
        session_id: session.id,
        floor_no: 0,
        branch_id: "main",
        state: "committed",
      });

      const res = await app.inject({
        method: "POST",
        url: `/floors/${floor.id}/branch`,
        payload: {},
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<ItemResponse<{
        branch_id: string;
        source_floor_id: string;
        source_floor_no: number;
        session_id: string;
      }>>();
      expect(body.data.branch_id).toMatch(/^branch-/);
      expect(body.data.source_floor_id).toBe(floor.id);
      expect(body.data.source_floor_no).toBe(0);
      expect(body.data.session_id).toBe(session.id);
    });

    it("creates a branch with custom branch_id", async () => {
      const session = await createSession(app);
      const floor = await createFloor(app, {
        session_id: session.id,
        floor_no: 0,
        branch_id: "main",
        state: "committed",
      });

      const res = await app.inject({
        method: "POST",
        url: `/floors/${floor.id}/branch`,
        payload: { branch_id: "my-alt-story" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<ItemResponse<{ branch_id: string }>>(); 
      expect(body.data.branch_id).toBe("my-alt-story");
    });

    it("returns 404 for non-existent floor", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/floors/nonexistent/branch",
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 409 for non-committed floor", async () => {
      const session = await createSession(app);
      const floor = await createFloor(app, {
        session_id: session.id,
        floor_no: 0,
        branch_id: "main",
        state: "draft",
      });

      const res = await app.inject({
        method: "POST",
        url: `/floors/${floor.id}/branch`,
        payload: {},
      });

      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe("invalid_state");
    });

    it("returns 409 for duplicate branch_id", async () => {
      const session = await createSession(app);
      const floor = await createFloor(app, {
        session_id: session.id,
        floor_no: 0,
        branch_id: "main",
        state: "committed",
      });

      // "main" 分支已存在于这个 session
      const res = await app.inject({
        method: "POST",
        url: `/floors/${floor.id}/branch`,
        payload: { branch_id: "main" },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe("branch_exists");
    });
  });

  // ── Activate Tests ─────────────────────────────────────

  describe("PATCH /pages/:id/activate", () => {
    it("activates a page and deactivates siblings", async () => {
      const session = await createSession(app);
      const floor = await createFloor(app, {
        session_id: session.id,
        floor_no: 0,
        branch_id: "main",
      });
      const page1 = await createPage(app, {
        floor_id: floor.id,
        page_no: 0,
        page_kind: "output",
        is_active: true,
        version: 1,
      });
      const page2 = await createPage(app, {
        floor_id: floor.id,
        page_no: 0,
        page_kind: "output",
        is_active: false,
        version: 2,
      });

      // 激活 page2
      const res = await app.inject({
        method: "PATCH",
        url: `/pages/${page2.id}/activate`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<ItemResponse<{ id: string; is_active: boolean }>>();
      expect(body.data.id).toBe(page2.id);
      expect(body.data.is_active).toBe(true);

      // 验证 page1 已经被 deactivate
      const page1Res = await app.inject({ method: "GET", url: `/pages/${page1.id}` });
      expect(page1Res.json<ItemResponse<{ is_active: boolean }>>().data.is_active).toBe(false);
    });

    it("is idempotent for already active page", async () => {
      const session = await createSession(app);
      const floor = await createFloor(app, {
        session_id: session.id,
        floor_no: 0,
        branch_id: "main",
      });
      const page = await createPage(app, {
        floor_id: floor.id,
        page_no: 0,
        page_kind: "output",
        is_active: true,
        version: 1,
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/pages/${page.id}/activate`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<ItemResponse<{ id: string; is_active: boolean }>>().data.is_active).toBe(true);
    });

    it("returns 404 for non-existent page", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/pages/nonexistent/activate",
      });
      expect(res.statusCode).toBe(404);
    });

    it("correctly handles floor with multiple pages", async () => {
      const session = await createSession(app);
      const floor = await createFloor(app, {
        session_id: session.id,
        floor_no: 0,
        branch_id: "main",
      });
      const p1 = await createPage(app, { floor_id: floor.id, page_no: 0, page_kind: "output", is_active: true, version: 1 });
      const p2 = await createPage(app, { floor_id: floor.id, page_no: 0, page_kind: "output", is_active: false, version: 2 });
      const p3 = await createPage(app, { floor_id: floor.id, page_no: 0, page_kind: "output", is_active: false, version: 3 });

      // 激活 p3
      await app.inject({ method: "PATCH", url: `/pages/${p3.id}/activate` });

      // 验证 p1 和 p2 都 deactivated
      const p1Res = await app.inject({ method: "GET", url: `/pages/${p1.id}` });
      const p2Res = await app.inject({ method: "GET", url: `/pages/${p2.id}` });
      const p3Res = await app.inject({ method: "GET", url: `/pages/${p3.id}` });

      expect(p1Res.json<ItemResponse<{ is_active: boolean }>>().data.is_active).toBe(false);
      expect(p2Res.json<ItemResponse<{ is_active: boolean }>>().data.is_active).toBe(false);
      expect(p3Res.json<ItemResponse<{ is_active: boolean }>>().data.is_active).toBe(true);
    });

    it("does not affect pages in other floors", async () => {
      const session = await createSession(app);
      const floor1 = await createFloor(app, { session_id: session.id, floor_no: 0, branch_id: "main" });
      const floor2 = await createFloor(app, { session_id: session.id, floor_no: 1, branch_id: "main" });

      const f1p1 = await createPage(app, { floor_id: floor1.id, page_no: 0, page_kind: "output", is_active: true, version: 1 });
      const f1p2 = await createPage(app, { floor_id: floor1.id, page_no: 0, page_kind: "output", is_active: false, version: 2 });
      const f2p1 = await createPage(app, { floor_id: floor2.id, page_no: 0, page_kind: "output", is_active: true, version: 1 });

      // 激活 floor1 的 p2
      await app.inject({ method: "PATCH", url: `/pages/${f1p2.id}/activate` });

      // floor2 的 page 不受影响
      const f2p1Res = await app.inject({ method: "GET", url: `/pages/${f2p1.id}` });
      expect(f2p1Res.json<ItemResponse<{ is_active: boolean }>>().data.is_active).toBe(true);

      // floor1 的 p1 已 deactivated
      const f1p1Res = await app.inject({ method: "GET", url: `/pages/${f1p1.id}` });
      expect(f1p1Res.json<ItemResponse<{ is_active: boolean }>>().data.is_active).toBe(false);
    });
  });
});

// ── Helper Functions ────────────────────────────────────

async function createSession(app: FastifyInstance): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { title: "Test Session" },
  });
  expect(res.statusCode).toBe(201);
  return res.json<ItemResponse<{ id: string }>>().data;
}

async function createFloor(
  app: FastifyInstance,
  payload: {
    session_id: string;
    floor_no: number;
    branch_id: string;
    state?: string;
  }
): Promise<{ id: string }> {
  const res = await app.inject({ method: "POST", url: "/floors", payload });
  expect(res.statusCode).toBe(201);
  return res.json<ItemResponse<{ id: string }>>().data;
}

async function createPage(
  app: FastifyInstance,
  payload: {
    floor_id: string;
    page_no: number;
    page_kind: "input" | "output" | "mixed";
    is_active?: boolean;
    version?: number;
  }
): Promise<{ id: string }> {
  const res = await app.inject({ method: "POST", url: "/pages", payload });
  expect(res.statusCode).toBe(201);
  return res.json<ItemResponse<{ id: string }>>().data;
}

async function createMessage(
  app: FastifyInstance,
  payload: {
    page_id: string;
    seq: number;
    role: "user" | "assistant" | "system" | "narrator";
    content: string;
  }
): Promise<{ id: string }> {
  const res = await app.inject({ method: "POST", url: "/messages", payload });
  expect(res.statusCode).toBe(201);
  return res.json<ItemResponse<{ id: string }>>().data;
}
