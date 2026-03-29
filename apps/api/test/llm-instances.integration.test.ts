import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type InstanceConfig = {
  id: string;
  scope: string;
  scope_id: string;
  instance_slot: string;
  preset_id: string | null;
  enabled: boolean;
  params: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
};

type ConfigListResponse = { data: InstanceConfig[] };
type ConfigResponse = { data: InstanceConfig };

type ResolvedSlot = {
  slot: string;
  source: string;
  scope: string | null;
  config_id: string | null;
  preset_id: string | null;
  enabled: boolean;
  params: Record<string, unknown> | null;
};

type ResolvedResponse = {
  data: {
    session_id: string | null;
    slots: ResolvedSlot[];
  };
};

type DeleteResponse = {
  data: {
    instance_slot: string;
    scope: string;
    deleted: boolean;
  };
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

describe("LLM Instance Config Routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  // ── PUT (upsert) + GET (list) ──

  it("creates a global config and lists it", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: {
        scope: "global",
        enabled: true,
        params: { temperature: 0.8, max_output_tokens: 1024 },
      },
    });

    expect(putRes.statusCode).toBe(200);
    const created = putRes.json<ConfigResponse>();
    expect(created.data.id).toBeTruthy();
    expect(created.data.scope).toBe("global");
    expect(created.data.scope_id).toBe("global");
    expect(created.data.instance_slot).toBe("narrator");
    expect(created.data.enabled).toBe(true);
    expect(created.data.params).toMatchObject({ temperature: 0.8, max_output_tokens: 1024 });

    const listRes = await app.inject({ method: "GET", url: "/llm-instances" });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json<ConfigListResponse>();
    expect(list.data).toHaveLength(1);
    expect(list.data[0]!.id).toBe(created.data.id);
  });

  it("updates existing config via upsert", async () => {
    await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", enabled: true, params: { temperature: 0.5 } },
    });

    const updateRes = await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", enabled: false, params: { temperature: 0.9 } },
    });

    expect(updateRes.statusCode).toBe(200);
    const updated = updateRes.json<ConfigResponse>();
    expect(updated.data.enabled).toBe(false);
    expect(updated.data.params).toMatchObject({ temperature: 0.9 });

    const listRes = await app.inject({ method: "GET", url: "/llm-instances" });
    expect(listRes.json<ConfigListResponse>().data).toHaveLength(1);
  });

  // ── GET by slot ──

  it("queries configs by slot", async () => {
    await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", enabled: true },
    });
    await app.inject({
      method: "PUT",
      url: "/llm-instances/director",
      payload: { scope: "global", enabled: true },
    });

    const slotRes = await app.inject({ method: "GET", url: "/llm-instances/narrator" });
    expect(slotRes.statusCode).toBe(200);
    const body = slotRes.json<ConfigListResponse>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.instance_slot).toBe("narrator");
  });

  it("supports session-scope slot queries with and without session_id", async () => {
    await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "session", session_id: "sess-1", enabled: true },
    });
    await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "session", session_id: "sess-2", enabled: false },
    });
    await app.inject({
      method: "PUT",
      url: "/llm-instances/director",
      payload: { scope: "session", session_id: "sess-1", enabled: true },
    });

    const allSessionRes = await app.inject({ method: "GET", url: "/llm-instances?scope=session" });
    expect(allSessionRes.statusCode).toBe(200);
    expect(allSessionRes.json<ConfigListResponse>().data).toHaveLength(3);

    const slotAllSessionRes = await app.inject({ method: "GET", url: "/llm-instances/narrator?scope=session" });
    expect(slotAllSessionRes.statusCode).toBe(200);
    expect(slotAllSessionRes.json<ConfigListResponse>().data).toHaveLength(2);

    const slotSingleSessionRes = await app.inject({
      method: "GET",
      url: "/llm-instances/narrator?scope=session&session_id=sess-1",
    });
    expect(slotSingleSessionRes.statusCode).toBe(200);
    const sessionBody = slotSingleSessionRes.json<ConfigListResponse>();
    expect(sessionBody.data).toHaveLength(1);
    expect(sessionBody.data[0]!.scope_id).toBe("sess-1");
  });

  // ── GET resolved ──

  it("returns resolved defaults when no configs exist", async () => {
    const res = await app.inject({ method: "GET", url: "/llm-instances/resolved" });
    expect(res.statusCode).toBe(200);

    const body = res.json<ResolvedResponse>();
    expect(body.data.session_id).toBeNull();
    expect(body.data.slots).toHaveLength(5);

    const slotNames = body.data.slots.map((s) => s.slot);
    expect(slotNames).toContain("*");
    expect(slotNames).toContain("narrator");
    expect(slotNames).toContain("director");
    expect(slotNames).toContain("verifier");
    expect(slotNames).toContain("memory");

    for (const slot of body.data.slots) {
      expect(slot.source).toBe("default");
      expect(slot.enabled).toBe(true);
    }
  });

  it("resolves a global config for a slot", async () => {
    await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", params: { temperature: 0.7 } },
    });

    const res = await app.inject({ method: "GET", url: "/llm-instances/resolved" });
    const body = res.json<ResolvedResponse>();
    const narrator = body.data.slots.find((s) => s.slot === "narrator");

    expect(narrator?.source).toBe("global_config");
    expect(narrator?.scope).toBe("global");
    expect(narrator?.params).toMatchObject({ temperature: 0.7 });
  });

  it("resolves session config over global config", async () => {
    await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", params: { temperature: 0.5 } },
    });

    await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "session", session_id: "test-sess-1", params: { temperature: 0.9 } },
    });

    const res = await app.inject({
      method: "GET",
      url: "/llm-instances/resolved?session_id=test-sess-1",
    });
    const body = res.json<ResolvedResponse>();
    const narrator = body.data.slots.find((s) => s.slot === "narrator");

    expect(narrator?.source).toBe("session_config");
    expect(narrator?.scope).toBe("session");
    expect(narrator?.params).toMatchObject({ temperature: 0.9 });
  });

  it("stores params as null when upserting with params: null", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", enabled: true, params: null },
    });

    expect(putRes.statusCode).toBe(200);
    expect(putRes.json<ConfigResponse>().data.params).toBeNull();

    const getRes = await app.inject({ method: "GET", url: "/llm-instances/narrator" });
    expect(getRes.json<ConfigListResponse>().data[0]!.params).toBeNull();
  });

  // ── DELETE ──

  it("deletes an existing config", async () => {
    await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", enabled: true },
    });

    const deleteRes = await app.inject({
      method: "DELETE",
      url: "/llm-instances/narrator?scope=global",
    });

    expect(deleteRes.statusCode).toBe(200);
    const body = deleteRes.json<DeleteResponse>();
    expect(body.data.instance_slot).toBe("narrator");
    expect(body.data.scope).toBe("global");
    expect(body.data.deleted).toBe(true);

    const listRes = await app.inject({ method: "GET", url: "/llm-instances" });
    expect(listRes.json<ConfigListResponse>().data).toHaveLength(0);
  });

  it("returns 404 when deleting non-existent config", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/llm-instances/narrator?scope=global",
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<ErrorResponse>();
    expect(body.error.code).toBe("config_not_found");
  });

  // ── Validation errors ──

  it("returns 400 for invalid slot", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/llm-instances/invalid_slot",
      payload: { scope: "global", enabled: true },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<ErrorResponse>();
    expect(body.error.code).toBe("invalid_slot");
  });

  it("returns 400 for invalid slot on GET and DELETE", async () => {
    const getRes = await app.inject({
      method: "GET",
      url: "/llm-instances/invalid_slot",
    });

    expect(getRes.statusCode).toBe(400);
    expect(getRes.json<ErrorResponse>().error.code).toBe("invalid_slot");

    const deleteRes = await app.inject({
      method: "DELETE",
      url: "/llm-instances/invalid_slot?scope=global",
    });

    expect(deleteRes.statusCode).toBe(400);
    expect(deleteRes.json<ErrorResponse>().error.code).toBe("invalid_slot");
  });

  it("returns 400 when session scope misses session_id on PUT", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "session", enabled: true },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when session scope misses session_id on DELETE", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/llm-instances/narrator?scope=session",
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<ErrorResponse>();
    expect(body.error.code).toBe("missing_session_id");
  });

  // ── Scope filtering ──

  it("filters list by scope query param", async () => {
    await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", enabled: true },
    });

    await app.inject({
      method: "PUT",
      url: "/llm-instances/director",
      payload: { scope: "session", session_id: "test-sess-1", enabled: false },
    });

    const globalRes = await app.inject({ method: "GET", url: "/llm-instances?scope=global" });
    expect(globalRes.json<ConfigListResponse>().data).toHaveLength(1);
    expect(globalRes.json<ConfigListResponse>().data[0]!.instance_slot).toBe("narrator");

    const sessionRes = await app.inject({
      method: "GET",
      url: "/llm-instances?scope=session&session_id=test-sess-1",
    });
    expect(sessionRes.json<ConfigListResponse>().data).toHaveLength(1);
    expect(sessionRes.json<ConfigListResponse>().data[0]!.instance_slot).toBe("director");
  });

  it("isolates instance configs by account in multi-account mode", async () => {
    await app.close();
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
    }));

    const rootToken = app.jwt.sign({ sub: "root", role: "user", account_id: "default-admin" });
    const tokenA = app.jwt.sign({ sub: "user-a", role: "admin", account_id: "acc-a" });
    const tokenB = app.jwt.sign({ sub: "user-b", role: "admin", account_id: "acc-b" });

    const accountARes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${rootToken}` },
      payload: { id: "acc-a", name: "Account A" },
    });
    expect(accountARes.statusCode).toBe(201);

    const accountBRes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${rootToken}` },
      payload: { id: "acc-b", name: "Account B" },
    });
    expect(accountBRes.statusCode).toBe(201);

    const putRes = await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { scope: "global", enabled: true, params: { temperature: 0.7 } },
    });
    expect(putRes.statusCode).toBe(200);

    const listB = await app.inject({ method: "GET", url: "/llm-instances", headers: { authorization: `Bearer ${tokenB}` } });
    expect(listB.json<ConfigListResponse>().data).toHaveLength(0);

    const slotB = await app.inject({ method: "GET", url: "/llm-instances/narrator", headers: { authorization: `Bearer ${tokenB}` } });
    expect(slotB.json<ConfigListResponse>().data).toHaveLength(0);

    const resolvedB = await app.inject({ method: "GET", url: "/llm-instances/resolved", headers: { authorization: `Bearer ${tokenB}` } });
    const narrator = resolvedB.json<ResolvedResponse>().data.slots.find((slot) => slot.slot === "narrator");
    expect(narrator?.source).toBe("default");
  });
});
