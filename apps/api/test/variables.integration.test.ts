import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type ItemResponse<T> = { data: T };
type ErrorResponse = { error: { code: string; message: string } };

type VariableDto = {
  id: string;
  scope: "global" | "chat" | "floor" | "page";
  scope_id: string;
  key: string;
  value: unknown;
  updated_at: number;
};

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createAccount(app: FastifyInstance, token: string, id: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    headers: authHeader(token),
    payload: { id, name },
  });

  expect(response.statusCode, response.body).toBe(201);
}

async function createSession(app: FastifyInstance, headers?: Record<string, string>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/sessions",
    headers,
    payload: { title: "Variable Session" },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data.id;
}

async function createFloor(
  app: FastifyInstance,
  args: { sessionId: string; floorNo: number; branchId: string; state?: "draft" | "generating" | "committed" | "failed" },
  headers?: Record<string, string>
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/floors",
    headers,
    payload: {
      session_id: args.sessionId,
      floor_no: args.floorNo,
      branch_id: args.branchId,
      ...(args.state ? { state: args.state } : {}),
    },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data.id;
}

async function createPage(
  app: FastifyInstance,
  args: { floorId: string; pageNo: number; pageKind: "input" | "output" | "mixed" },
  headers?: Record<string, string>
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/pages",
    headers,
    payload: {
      floor_id: args.floorId,
      page_no: args.pageNo,
      page_kind: args.pageKind,
    },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data.id;
}

async function upsertVar(
  app: FastifyInstance,
  args: { scope: string; scopeId: string; key: string; value: unknown },
  headers?: Record<string, string>
): Promise<VariableDto> {
  const response = await app.inject({
    method: "PUT",
    url: "/variables",
    headers,
    payload: {
      scope: args.scope,
      scope_id: args.scopeId,
      key: args.key,
      value: args.value,
    },
  });

  expect([200, 201], response.body).toContain(response.statusCode);
  return response.json<ItemResponse<VariableDto>>().data;
}

describe("variables routes", () => {
  describe("single-account behavior", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
    });

    afterEach(async () => {
      if (app) {
        await app.close();
      }
    });

    it("creates, updates, lists, resolves, gets, and deletes variables", async () => {
      const sessionId = await createSession(app);
      const floorId = await createFloor(app, { sessionId, floorNo: 0, branchId: "main" });
      const pageId = await createPage(app, { floorId, pageNo: 0, pageKind: "input" });

      const created = await upsertVar(app, { scope: "global", scopeId: "ignored-global", key: "theme", value: "night" });
      expect(created.scope).toBe("global");
      expect(created.scope_id).toBe("global");

      const firstChat = await upsertVar(app, { scope: "chat", scopeId: sessionId, key: "mood", value: "calm" });
      const updatedChat = await upsertVar(app, { scope: "chat", scopeId: sessionId, key: "mood", value: "tense" });
      expect(updatedChat.id).toBe(firstChat.id);
      expect(updatedChat.value).toBe("tense");

      await upsertVar(app, { scope: "floor", scopeId: floorId, key: "location", value: "tavern" });
      await upsertVar(app, { scope: "page", scopeId: pageId, key: "mood", value: "excited" });

      const listRes = await app.inject({ method: "GET", url: "/variables?sort_by=key&sort_order=asc" });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json<{ data: VariableDto[] }>().data).toHaveLength(4);

      const resolveRes = await app.inject({
        method: "GET",
        url: `/variables/resolve?session_id=${sessionId}&floor_id=${floorId}&page_id=${pageId}&include_layers=true`,
      });
      expect(resolveRes.statusCode).toBe(200);
      expect(resolveRes.json()).toEqual({
        data: {
          context: {
            account_id: "default-admin",
            session_id: sessionId,
            floor_id: floorId,
            page_id: pageId,
            global_scope_id: "global",
          },
          resolved: [
            {
              key: "location",
              value: "tavern",
              source_scope: "floor",
              source_scope_id: floorId,
              updated_at: expect.any(Number),
            },
            {
              key: "mood",
              value: "excited",
              source_scope: "page",
              source_scope_id: pageId,
              updated_at: expect.any(Number),
            },
            {
              key: "theme",
              value: "night",
              source_scope: "global",
              source_scope_id: "global",
              updated_at: expect.any(Number),
            },
          ],
          layers: {
            global: {
              scope: "global",
              scope_id: "global",
              items: [
                {
                  id: created.id,
                  scope: "global",
                  scope_id: "global",
                  key: "theme",
                  value: "night",
                  updated_at: expect.any(Number),
                },
              ],
            },
            chat: {
              scope: "chat",
              scope_id: sessionId,
              items: [
                {
                  id: updatedChat.id,
                  scope: "chat",
                  scope_id: sessionId,
                  key: "mood",
                  value: "tense",
                  updated_at: expect.any(Number),
                },
              ],
            },
            floor: {
              scope: "floor",
              scope_id: floorId,
              items: [
                {
                  id: expect.any(String),
                  scope: "floor",
                  scope_id: floorId,
                  key: "location",
                  value: "tavern",
                  updated_at: expect.any(Number),
                },
              ],
            },
            page: {
              scope: "page",
              scope_id: pageId,
              items: [
                {
                  id: expect.any(String),
                  scope: "page",
                  scope_id: pageId,
                  key: "mood",
                  value: "excited",
                  updated_at: expect.any(Number),
                },
              ],
            },
          },
        },
      });

      const detailRes = await app.inject({ method: "GET", url: `/variables/${updatedChat.id}` });
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json<ItemResponse<VariableDto>>().data.value).toBe("tense");

      const deleteRes = await app.inject({ method: "DELETE", url: `/variables/${updatedChat.id}` });
      expect(deleteRes.statusCode).toBe(200);

      const missingRes = await app.inject({ method: "GET", url: `/variables/${updatedChat.id}` });
      expect(missingRes.statusCode).toBe(404);
    });

    it("returns 400 for invalid request bodies and normalized duplicate targets", async () => {
      const invalidRes = await app.inject({
        method: "PUT",
        url: "/variables",
        payload: { scope: "global" },
      });
      expect(invalidRes.statusCode).toBe(400);

      const duplicateBatchRes = await app.inject({
        method: "PUT",
        url: "/variables/batch",
        payload: {
          items: [
            { scope: "global", scope_id: "g1", key: "dup", value: 1 },
            { scope: "global", scope_id: "g2", key: "dup", value: 2 },
          ],
        },
      });
      expect(duplicateBatchRes.statusCode).toBe(400);
      expect(duplicateBatchRes.json<ErrorResponse>().error.code).toBe("duplicate_variable_target");
    });

    it("supports batch upsert created and updated mix", async () => {
      await upsertVar(app, { scope: "global", scopeId: "global", key: "x", value: 1 });

      const response = await app.inject({
        method: "PUT",
        url: "/variables/batch",
        payload: {
          items: [
            { scope: "global", scope_id: "global", key: "x", value: 2 },
            { scope: "global", scope_id: "global", key: "y", value: 3 },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { meta: { created: number; updated: number } } }>().data.meta).toEqual({
        total: 2,
        created: 1,
        updated: 1,
      });
    });

    it("rejects writes to missing hosts and committed floor or page targets", async () => {
      const missingSessionRes = await app.inject({
        method: "PUT",
        url: "/variables",
        payload: { scope: "chat", scope_id: "missing-session", key: "mood", value: "tense" },
      });
      expect(missingSessionRes.statusCode).toBe(404);
      expect(missingSessionRes.json<ErrorResponse>().error.code).toBe("variable_host_not_found");

      const sessionId = await createSession(app);
      const committedFloorId = await createFloor(app, {
        sessionId,
        floorNo: 0,
        branchId: "main",
        state: "committed",
      });
      const committedPageId = await createPage(app, {
        floorId: committedFloorId,
        pageNo: 0,
        pageKind: "input",
      });

      const floorRes = await app.inject({
        method: "PUT",
        url: "/variables",
        payload: { scope: "floor", scope_id: committedFloorId, key: "mood", value: "tense" },
      });
      expect(floorRes.statusCode).toBe(409);
      expect(floorRes.json<ErrorResponse>().error.code).toBe("variable_target_locked");

      const pageRes = await app.inject({
        method: "PUT",
        url: "/variables",
        payload: { scope: "page", scope_id: committedPageId, key: "mood", value: "tense" },
      });
      expect(pageRes.statusCode).toBe(409);
      expect(pageRes.json<ErrorResponse>().error.code).toBe("variable_target_locked");
    });

    it("returns 404 for missing variable detail and delete targets", async () => {
      const getRes = await app.inject({ method: "GET", url: "/variables/nonexistent" });
      expect(getRes.statusCode).toBe(404);

      const deleteRes = await app.inject({ method: "DELETE", url: "/variables/nonexistent" });
      expect(deleteRes.statusCode).toBe(404);
    });
  });

  describe("multi-account isolation", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      ({ app } = await buildApp({
        databasePath: ":memory:",
        logger: false,
        accountMode: "multi",
        auth: { mode: "jwt", jwtSecret: "test-secret" },
      }));
    });

    afterEach(async () => {
      if (app) {
        await app.close();
      }
    });

    it("isolates global variables by account and hides foreign session hosts", async () => {
      const tokenA = app.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
      const tokenB = app.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });

      await createAccount(app, tokenA, "acc-a", "Account A");
      await createAccount(app, tokenB, "acc-b", "Account B");

      const varA = await upsertVar(app, { scope: "global", scopeId: "global", key: "theme", value: "red" }, authHeader(tokenA));
      const varB = await upsertVar(app, { scope: "global", scopeId: "global", key: "theme", value: "blue" }, authHeader(tokenB));

      expect(varA.id).not.toBe(varB.id);

      const listA = await app.inject({ method: "GET", url: "/variables", headers: authHeader(tokenA) });
      const listB = await app.inject({ method: "GET", url: "/variables", headers: authHeader(tokenB) });

      expect(listA.statusCode).toBe(200);
      expect(listB.statusCode).toBe(200);
      expect(listA.json<{ data: VariableDto[] }>().data).toEqual([
        expect.objectContaining({ id: varA.id, value: "red" }),
      ]);
      expect(listB.json<{ data: VariableDto[] }>().data).toEqual([
        expect.objectContaining({ id: varB.id, value: "blue" }),
      ]);

      const foreignDetail = await app.inject({
        method: "GET",
        url: `/variables/${varA.id}`,
        headers: authHeader(tokenB),
      });
      expect(foreignDetail.statusCode).toBe(404);

      const sessionA = await createSession(app, authHeader(tokenA));
      await upsertVar(app, { scope: "chat", scopeId: sessionA, key: "mood", value: "tense" }, authHeader(tokenA));

      const foreignUpsert = await app.inject({
        method: "PUT",
        url: "/variables",
        headers: authHeader(tokenB),
        payload: { scope: "chat", scope_id: sessionA, key: "mood", value: "hack" },
      });
      expect(foreignUpsert.statusCode).toBe(404);
      expect(foreignUpsert.json<ErrorResponse>().error.code).toBe("variable_host_not_found");

      const foreignResolve = await app.inject({
        method: "GET",
        url: `/variables/resolve?session_id=${sessionA}`,
        headers: authHeader(tokenB),
      });
      expect(foreignResolve.statusCode).toBe(404);
      expect(foreignResolve.json<ErrorResponse>().error.code).toBe("variable_host_not_found");
    });
  });
});
