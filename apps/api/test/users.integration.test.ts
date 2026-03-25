/**
 * users.ts branch coverage expansion.
 *
 * Targets:
 *   GET /users — status / keyword / sort_by / include_deleted
 *   POST /users — duplicate name 409 / invalid body 400
 *   GET /users/:id — missing 404
 *   PATCH /users/:id — missing 404 / rename conflict 409
 *   DELETE /users/:id — missing 404
 *   PATCH /users/batch/status
 *   POST /users/batch/delete
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type D<T> = { data: T };
type E = { error: { code: string; message: string } };

interface UserData {
  id: string;
  name: string;
  status: string;
  snapshot: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

interface BatchResult {
  results: Array<{ index: number; id: string; action: string }>;
  meta: Record<string,unknown>;
}

async function createUser(app: FastifyInstance, name: string, description = "desc") {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    payload: { snapshot: { name, description } },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<D<UserData>>().data;
}

describe("Users route branch coverage", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── POST /users ─────────────────────────────────────

  it("POST /users returns 409 for duplicate name", async () => {
    await createUser(app, "DupUser");
    const res = await app.inject({
      method: "POST",
      url: "/users",
      payload: { snapshot: { name: "DupUser" } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<E>().error.code).toBe("user_conflict");
  });

  it("POST /users returns 400 for missing snapshot", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /users ──────────────────────────────────────

  it("GET /users filters by status=active", async () => {
    const u = await createUser(app, "ActiveUser");
    await app.inject({ method: "PATCH", url: `/users/${u.id}`, payload: { status: "disabled" } });
    await createUser(app, "StillActive");

    const res = await app.inject({ method: "GET", url: "/users?status=active" });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: UserData[] }>().data;
    expect(data.every((u) => u.status === "active")).toBe(true);
    expect(data).toHaveLength(1);
  });

  it("GET /users filters by status=disabled", async () => {
    const u = await createUser(app, "DisableMe");
    await app.inject({ method: "PATCH", url: `/users/${u.id}`, payload: { status: "disabled" } });

    const res = await app.inject({ method: "GET", url: "/users?status=disabled" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: UserData[] }>().data).toHaveLength(1);
  });

  it("GET /users include_deleted=true shows deleted users", async () => {
    const u = await createUser(app, "WillDelete");
    await app.inject({ method: "DELETE", url: `/users/${u.id}` });

    const withoutDeleted = await app.inject({ method: "GET", url: "/users" });
   expect(withoutDeleted.json<{ data: UserData[] }>().data).toHaveLength(0);

    const withDeleted = await app.inject({ method: "GET", url: "/users?include_deleted=true" });
    expect(withDeleted.json<{ data: UserData[] }>().data).toHaveLength(1);
  });

  it("GET /users filters by keyword", async () => {
    await createUser(app, "AlphaUser");
    await createUser(app, "BetaUser");
    await createUser(app, "AlphaPrime");

    const res = await app.inject({ method: "GET", url: "/users?keyword=Alpha" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: UserData[] }>().data).toHaveLength(2);
  });

  it("GET /users sort_by=name", async () => {
    await createUser(app, "Charlie");
    await createUser(app, "Alice");
    await createUser(app, "Bob");

    const res = await app.inject({ method: "GET", url: "/users?sort_by=name&sort_order=asc" });
    expect(res.statusCode).toBe(200);
    const names = res.json<{ data: UserData[] }>().data.map((u) => u.name);
    expect(names).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("GET /users sort_by=created_at", async () => {
    await createUser(app, "First");
    await createUser(app, "Second");

    const res = await app.inject({ method: "GET", url: "/users?sort_by=created_at&sort_order=asc" });
    expect(res.statusCode).toBe(200);
    const names = res.json<{ data: UserData[] }>().data.map((u) => u.name);
    expect(names[0]).toBe("First");
  });

  // ── GET /users/:id ──────────────────────────────────

  it("GET /users/:id returns 404 for missing user", async () => {
    const res = await app.inject({ method: "GET", url: "/users/nonexistent" });
    expect(res.statusCode).toBe(404);
});

  // ── PATCH /users/:id ────────────────────────────────

  it("PATCH /users/:id returns 404 for missing user", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/users/nonexistent",
      payload: { snapshot: { name: "Ghost", description: "none" } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /users/:id returns 404 for deleted user", async () => {
    const u = await createUser(app, "Deleted");
    await app.inject({ method: "DELETE", url: `/users/${u.id}` });

    const res = await app.inject({
      method: "PATCH",
      url: `/users/${u.id}`,
      payload: { snapshot: { name: "Revive", description: "x" } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /users/:id returns 409 for rename conflict", async () => {
    const a = await createUser(app, "NameA");
    await createUser(app, "NameB");

    const res = await app.inject({
      method: "PATCH",
      url: `/users/${a.id}`,
      payload:{ snapshot: { name: "NameB", description: "conflict" } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<E>().error.code).toBe("user_conflict");
  });

  it("PATCH /users/:id allows renaming to same name", async () => {
    const u = await createUser(app, "SameName");
    const res = await app.inject({
method: "PATCH",
      url: `/users/${u.id}`,
      payload: { snapshot: { name: "SameName", description: "updated desc" } },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── DELETE /users/:id ───────────────────────────────

  it("DELETE /users/:id returns 404 for missing user", async () => {
    const res = await app.inject({ method: "DELETE", url: "/users/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  // ── PATCH /users/batch/status ───────────────────────

  it("PATCH /users/batch/status updates mixed found/not_found", async ()=> {
    const a = await createUser(app, "BatchA");
    const b = await createUser(app, "BatchB");

    const res = await app.inject({
      method: "PATCH",
      url: "/users/batch/status",
      payload: { ids: [a.id, "nonexistent", b.id], status: "disabled" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<D<BatchResult>>().data;
    expect(body.meta.updated).toBe(2);
    expect(body.meta.not_found).toBe(1);
    expect(body.results.find((r) => r.id === "nonexistent")?.action).toBe("not_found");
  });

  it("PATCH /users/batch/status skips deleted users", async () => {
    const u = await createUser(app, "DeletedBatch");
    await app.inject({ method: "DELETE", url: `/users/${u.id}` });

    const res= await app.inject({
      method: "PATCH",
      url: "/users/batch/status",
      payload: { ids: [u.id], status: "active" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<D<BatchResult>>().data.meta.not_found).toBe(1);
  });

  it("PATCH /users/batch/status returns 400 for invalid body", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/users/batch/status",
      payload: { ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  //── POST /users/batch/delete ────────────────────────

  it("POST /users/batch/delete deletes mixed found/not_found", async () => {
  const a = await createUser(app, "DelBatchA");

    const res = await app.inject({
      method: "POST",
      url: "/users/batch/delete",
      payload: { ids: [a.id, "nonexistent"] },
    });
    expect(res.statusCode).toBe(200);
    const body= res.json<D<BatchResult>>().data;
    expect(body.meta.deleted).toBe(1);
    expect(body.meta.not_found).toBe(1);
  });

  it("POST/users/batch/delete skips already-deleted users", async () => {
    const u = await createUser(app, "AlreadyDeleted");
    await app.inject({ method: "DELETE", url: `/users/${u.id}` });

    const res = await app.inject({
      method: "POST",
      url: "/users/batch/delete",
      payload: { ids: [u.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<D<BatchResult>>().data.meta.not_found).toBe(1);
  });

  it("POST /users/batch/delete returns 400 for invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users/batch/delete",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
