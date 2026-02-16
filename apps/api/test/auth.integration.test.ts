import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

describe("Auth integration", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    app = undefined;
  });

  describe("api_key mode", () => {
    beforeEach(async () => {
      ({ app } = await buildApp({
        databasePath: ":memory:",
        logger: false,
        auth: { mode: "api_key", apiKeys: ["dev-key"] },
      }));
    });

    it("keeps health/docs public and protects business routes", async () => {
      const server = app!;

      const healthRes = await server.inject({ method: "GET", url: "/health" });
      expect(healthRes.statusCode).toBe(200);

      const docsRes = await server.inject({ method: "GET", url: "/docs/" });
      expect(docsRes.statusCode).toBe(200);

      const noAuthRes = await server.inject({ method: "GET", url: "/sessions" });
      expect(noAuthRes.statusCode).toBe(401);
      expect(noAuthRes.json<{ error: { code: string } }>().error.code).toBe("auth_required");

      const invalidKeyRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { "x-api-key": "wrong-key" },
      });
      expect(invalidKeyRes.statusCode).toBe(403);
      expect(invalidKeyRes.json<{ error: { code: string } }>().error.code).toBe("auth_invalid_credentials");

      const validKeyRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { "x-api-key": "dev-key" },
      });
      expect(validKeyRes.statusCode).toBe(200);
    });
  });

  describe("jwt mode", () => {
    beforeEach(async () => {
      ({ app } = await buildApp({
        databasePath: ":memory:",
        logger: false,
        auth: { mode: "jwt", jwtSecret: "test-secret" },
      }));
    });

    it("requires valid bearer token", async () => {
      const server = app!;

      const noAuthRes = await server.inject({ method: "GET", url: "/sessions" });
      expect(noAuthRes.statusCode).toBe(401);
      expect(noAuthRes.json<{ error: { code: string } }>().error.code).toBe("auth_required");

      const invalidTokenRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { authorization: "Bearer invalid-token" },
      });
      expect(invalidTokenRes.statusCode).toBe(403);
      expect(invalidTokenRes.json<{ error: { code: string } }>().error.code).toBe("auth_invalid_token");

      const token = server.jwt.sign({ sub: "user-1" });
      const validTokenRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(validTokenRes.statusCode).toBe(200);
    });
  });

  describe("jwt mode with ACCOUNT_MODE=multi", () => {
    beforeEach(async () => {
      ({ app } = await buildApp({
        databasePath: ":memory:",
        logger: false,
        accountMode: "multi",
        auth: { mode: "jwt", jwtSecret: "test-secret" },
      }));
    });

    it("requires account claim and enforces admin role on account management routes", async () => {
      const server = app!;

      const tokenWithoutAccount = server.jwt.sign({ sub: "u-1" });
      const unresolvedRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { authorization: `Bearer ${tokenWithoutAccount}` },
      });
      expect(unresolvedRes.statusCode).toBe(403);
      expect(unresolvedRes.json<{ error: { code: string } }>().error.code).toBe("auth_account_unresolved");

      const userToken = server.jwt.sign({ sub: "u-1", account_id: "acc-a", role: "user" });
      const forbiddenRes = await server.inject({
        method: "GET",
        url: "/accounts",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(forbiddenRes.statusCode).toBe(403);
      expect(forbiddenRes.json<{ error: { code: string } }>().error.code).toBe("account_forbidden");

      const adminToken = server.jwt.sign({ sub: "u-admin", account_id: "default-admin", role: "admin" });
      const accountsRes = await server.inject({
        method: "GET",
        url: "/accounts",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(accountsRes.statusCode).toBe(200);
    });

    it("isolates sessions by account", async () => {
      const server = app!;

      const tokenA = server.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
      const tokenB = server.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });

      const createAccountA = await server.inject({
        method: "POST",
        url: "/accounts",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { id: "acc-a", name: "Account A" },
      });
      expect(createAccountA.statusCode).toBe(201);

      const createAccountB = await server.inject({
        method: "POST",
        url: "/accounts",
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { id: "acc-b", name: "Account B" },
      });
      expect(createAccountB.statusCode).toBe(201);

      const createSessionRes = await server.inject({
        method: "POST",
        url: "/sessions",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { title: "A Session" },
      });
      expect(createSessionRes.statusCode).toBe(201);

      const sessionId = createSessionRes.json<{ data: { id: string } }>().data.id;

      const listA = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const listB = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { authorization: `Bearer ${tokenB}` },
      });

      expect(listA.statusCode).toBe(200);
      expect(listB.statusCode).toBe(200);
      expect(listA.json<{ data: unknown[] }>().data).toHaveLength(1);
      expect(listB.json<{ data: unknown[] }>().data).toHaveLength(0);

      const getByB = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(getByB.statusCode).toBe(404);

      const patchByB = await server.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { title: "Hacked" },
      });
      expect(patchByB.statusCode).toBe(404);
    });

    it("isolates session branches/timeline/diff/delete by account", async () => {
      const server = app!;

      const tokenA = server.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
      const tokenB = server.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });

      await server.inject({
        method: "POST",
        url: "/accounts",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { id: "acc-a", name: "Account A" },
      });
      await server.inject({
        method: "POST",
        url: "/accounts",
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { id: "acc-b", name: "Account B" },
      });

      const createSessionRes = await server.inject({
        method: "POST",
        url: "/sessions",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { title: "A Session" },
      });
      expect(createSessionRes.statusCode).toBe(201);
      const sessionId = createSessionRes.json<{ data: { id: string } }>().data.id;

      const createMainFloor = await server.inject({
        method: "POST",
        url: "/floors",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { session_id: sessionId, floor_no: 0, branch_id: "main", state: "committed" },
      });
      expect(createMainFloor.statusCode).toBe(201);

      const createAltFloor = await server.inject({
        method: "POST",
        url: "/floors",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { session_id: sessionId, floor_no: 0, branch_id: "alt" },
      });
      expect(createAltFloor.statusCode).toBe(201);

      const branchesByA = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/branches`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(branchesByA.statusCode).toBe(200);
      expect(branchesByA.json<{ data: Array<{ branch_id: string }> }>().data).toEqual(expect.arrayContaining([
        expect.objectContaining({ branch_id: "main" }),
        expect.objectContaining({ branch_id: "alt" }),
      ]));

      const timelineByA = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/timeline?branch_id=main`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(timelineByA.statusCode).toBe(200);

      const diffByA = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/branches/diff?target_branch_id=alt`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(diffByA.statusCode).toBe(200);

      const branchesByB = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/branches`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(branchesByB.statusCode).toBe(404);

      const timelineByB = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/timeline?branch_id=main`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(timelineByB.statusCode).toBe(404);

      const diffByB = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/branches/diff?target_branch_id=alt`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(diffByB.statusCode).toBe(404);

      const deleteByB = await server.inject({
        method: "DELETE",
        url: `/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(deleteByB.statusCode).toBe(404);
    });
  });
});
