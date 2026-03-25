/**
 * variables.ts branch coverage expansion.
 *
 * Targets:
 *   GET /variables — no filters, key, scope+scope_id, sort_by=key/updated_at
 *   GET /variables/:id — missing 404
 *   DELETE /variables/:id — missing 404
 *   PUT /variables — invalid body 400
 *   PUT /variables/batch — invalid body 400, mixed created/updated
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type D<T> = { data: T };
type E = { error: { code: string; message: string } };

interface VarData {
id: string;
  scope: string;
  scope_id: string;
  key: string;
  value: unknown;
  updated_at: number;
}

async function upsertVar(app: FastifyInstance, scope: string, scopeId: string, key: string, value: unknown) {
  const res = await app.inject({
    method: "PUT",
    url: "/variables",
    payload: { scope, scope_id: scopeId, key, value },
  });
  expect([200, 201]).toContain(res.statusCode);
  return res.json<D<VarData>>().data;
}

describe("Variables route branch coverage", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── PUT /variables ─────────────────────────────────

  it("PUT /variables creates and then updates", async () => {
    const created = await upsertVar(app, "global", "global", "color", "red");
    expect(created.key).toBe("color");

    const updated = await upsertVar(app, "global", "global", "color", "blue");
    expect(updated.id).toBe(created.id);
    expect(updated.value).toBe("blue");
  });

  it("PUT /variables returns 400 for invalid body", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/variables",
      payload: { scope: "global" },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── PUT /variables/batch ───────────────────────────

  it("PUT /variables/batch handles created + updated mix", async () => {
    await upsertVar(app, "global", "global", "x", 1);

    const res = await app.inject({
      method: "PUT",
      url: "/variables/batch",
      payload: {
        items: [
          { scope: "global", scope_id: "global", key: "x", value: 2 },
          { scope: "global", scope_id: "global", key: "y", value: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { meta: { created: number; updated: number } } }>();
    expect(body.data.meta.updated).toBe(1);
    expect(body.data.meta.created).toBe(1);
  });

  it("PUT /variables/batch returns 400 for invalid body", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/variables/batch",
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /variables/batch returns 400 for duplicate keys in same batch", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/variables/batch",
      payload: {
        items: [
          { scope: "global", scope_id: "global", key: "dup", value:1 },
          { scope: "global", scope_id: "global", key: "dup", value: 2 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /variables ─────────────────────────────────

  it("GET /variables with no filters returns all", async () => {
    await upsertVar(app, "global", "global", "a", 1);
    await upsertVar(app, "chat", "s1", "b", 2);

    const res = await app.inject({ method: "GET", url: "/variables" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: VarData[] }>().data).toHaveLength(2);
  });

  it("GET /variables filters by key", async () => {
    await upsertVar(app, "global", "global", "target", 1);
    await upsertVar(app, "global", "global", "other", 2);

    const res = await app.inject({ method: "GET", url: "/variables?key=target" });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: VarData[] }>().data;
    expect(data).toHaveLength(1);
    expect(data[0]!.key).toBe("target");
  });

  it("GET /variables filters by scope + scope_id", async () => {
    await upsertVar(app, "global", "global", "k1", 1);
    await upsertVar(app, "chat", "sess-1", "k1", 2);

    const res = await app.inject({ method: "GET", url: "/variables?scope=chat&scope_id=sess-1" });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: VarData[] }>().data;
    expect(data).toHaveLength(1);
    expect(data[0]!.scope).toBe("chat");
  });

  it("GET/variables sort_by=key", async () => {
    await upsertVar(app, "global", "global", "zebra", 1);
    await upsertVar(app, "global", "global", "alpha", 2);

    const res = await app.inject({ method: "GET", url: "/variables?sort_by=key&sort_order=asc" });
    expect(res.statusCode).toBe(200);
    const keys = res.json<{ data: VarData[] }>().data.map((v) => v.key);
    expect(keys).toEqual(["alpha", "zebra"]);
  });

  // ── GET /variables/:id ─────────────────────────────

  it("GET /variables/:id returns 404 for missing", async () => {
    const res = await app.inject({ method: "GET", url: "/variables/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /variables/:id returns existing variable", async () => {
    const v = await upsertVar(app, "global", "global", "mykey", 42);
    const res = await app.inject({ method: "GET", url: `/variables/${v.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<D<VarData>>().data.key).toBe("mykey");
  });

  // ── DELETE /variables/:id ───────────────────────────

  it("DELETE /variables/:id returns 404 for missing", async () => {
    const res = await app.inject({ method: "DELETE", url: "/variables/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /variables/:id removes existing variable", async () => {
    const v = await upsertVar(app, "global", "global", "gone", "bye");
    const delRes = await app.inject({ method: "DELETE", url: `/variables/${v.id}` });
    expect(delRes.statusCode).toBe(200);

    const getRes = await app.inject({ method: "GET", url: `/variables/${v.id}` });
    expect(getRes.statusCode).toBe(404);
  });
});
