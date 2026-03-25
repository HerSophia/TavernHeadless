/**
* sessions.ts branch coverage expansion.
 *
 * Targets:
 *POST /sessions — snapshot-only bindings, binding errors
 *   GET /sessions — status, keyword filters
 *   PATCH /sessions/:id — user binding update, not-found
 *   POST /sessions/:id/character/sync — not-found, no-op
 *   PATCH /sessions/batch/status
 *   POST /sessions/batch/delete
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type D<T> = { data: T };
type E={ error: { code: string; message: string } };

interface SessionData {
  id: string;
  title: string | null;
  status: string;
  character_binding: Record<string, unknown> | null;
  user_binding: Record<string, unknown> | null;
}

interface BatchResult {
  results: Array<{ index: number; id: string; action: string }>;
  meta: Record<string, unknown>;
}

async function createSession(app: FastifyInstance, payload: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { title: "Test Session", ...payload },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<D<SessionData>>().data;
}

async function createUser(app: FastifyInstance, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    payload: { snapshot: { name, description: "d" } },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<D<{ id: string; name: string; status: string }>>().data;
}

describe("Sessions route extra branch coverage", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── POST /sessions snapshot-only bindings ──────────

  it("POST /sessions with character_snapshot only (no character_id)", async () => {
    const session = await createSession(app, {
      character_snapshot: { name: "SnapshotChar", greeting: "Hello!" },
    });
  expect(session.character_binding).not.toBeNull();
  });

  it("POST /sessions with user_snapshot only (no user_id)", async () => {
    const session = await createSession(app, {
      user_snapshot: { name: "SnapshotUser" },
    });
    expect(session.user_binding).not.toBeNull();
  });

  it("POST /sessions with non-existent character_id returns 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title:"Bad Char", character_id: "nonexistent" },
    });
expect(res.statusCode).toBe(404);
    expect(res.json<E>().error.code).toBe("character_not_found");
  });

  it("POST /sessions with non-existent user_id returns 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Bad User", user_id: "nonexistent" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<E>().error.code).toBe("user_not_found");
  });

  it("POST /sessions with disabled user_id returns 409", async () => {
    const user = await createUser(app, "DisabledUser");
    await app.inject({
      method: "PATCH",
      url: `/users/${user.id}`,
      payload: { status: "disabled" },
});

    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Inactive", user_id: user.id },
    });
    expect(res.statusCode).toBe(409);
expect(res.json<E>().error.code).toBe("user_not_active");
  });

  // ── GET /sessions filters ──────────────────────────

  it("GET /sessions filters by status", async ()=> {
    await createSession(app, { title: "Active One" });
    const s = await createSession(app, { title: "Archived One" });
    await app.inject({
      method: "PATCH",
      url: `/sessions/${s.id}`,
      payload: { status: "archived" },
    });

    const res = await app.inject({ method: "GET", url: "/sessions?status=archived" });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: SessionData[] }>().data;
    expect(data).toHaveLength(1);
    expect(data[0]!.status).toBe("archived");
  });

  it("GET /sessions filters by keyword", async ()=> {
    await createSession(app, { title: "Alpha Session" });
    await createSession(app, { title: "Beta Session" });

    const res = await app.inject({ method: "GET", url: "/sessions?keyword=Alpha" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: SessionData[] }>().data).toHaveLength(1);
  });

  it("GET /sessions sort_by=updated_at", async () => {
    await createSession(app, { title: "First" });
  await createSession(app, { title: "Second"});

    const res = await app.inject({ method: "GET", url: "/sessions?sort_by=updated_at&sort_order=asc" });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: SessionData[] }>().data;
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  // ── PATCH /sessions/:id ────────────────────────────

  it("PATCH/sessions/:id returns 404 for missing session", async () => {
 const res = await app.inject({
      method: "PATCH",
      url: "/sessions/nonexistent",
      payload: { title: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /sessions/:idupdates user binding", async () => {
  const user = await createUser(app, "PatchUser");
    const session =await createSession(app);

    const res = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      payload: { user_id: user.id },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<D<SessionData>>().data;
    expect(updated.user_binding).not.toBeNull();
  });

  it("PATCH /sessions/:id with user_snapshot only", async () => {
    const session = await createSession(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      payload: { user_snapshot: { name:"InlineUser" } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("PATCH /sessions/:id with character_snapshot only", async () => {
    const session = await createSession(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      payload: { character_snapshot: { name: "InlineChar" } },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── POST /sessions/:id/character/sync ─────────────

  it("POST /sessions/:id/character/sync returns 404 for missing session", async () => {
    const res =await app.inject({
      method: "POST",
      url: "/sessions/nonexistent/character/sync",
    });
    expect(res.statusCode).toBe(404);
  });

  // ── PATCH /sessions/batch/status ───────────────────

  it("PATCH /sessions/batch/status handles mixed found/not_found", async () => {
    const s = await createSession(app, { title: "BatchSess" });

    const res = await app.inject({
      method: "PATCH",
      url: "/sessions/batch/status",
      payload: { ids: [s.id, "nonexistent"], status: "archived" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<D<BatchResult>>().data;
 expect(body.meta.updated).toBe(1);
    expect(body.meta.not_found).toBe(1);
  });

  it("PATCH /sessions/batch/status returns400 for empty ids", async () => {
    const res =await app.inject({
      method: "PATCH",
      url: "/sessions/batch/status",
      payload: { ids: [],status: "archived" },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── POST /sessions/batch/delete ───────────────────

  it("POST /sessions/batch/delete handles mixed found/not_found", async () => {
    const s = await createSession(app, { title: "DelSess" });

    const res = await app.inject({
      method: "POST",
      url: "/sessions/batch/delete",
      payload: { ids: [s.id, "nonexistent"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<D<BatchResult>>().data;
    expect(body.meta.deleted).toBe(1);
    expect(body.meta.not_found).toBe(1);
  });

  it("POST /sessions/batch/delete returns 400 for empty ids", async () => {
    const res = await app.inject({
      method: "POST",
   url: "/sessions/batch/delete",
    payload: { ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});
