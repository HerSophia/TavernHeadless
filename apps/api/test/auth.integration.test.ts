import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

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

    it("keeps health/version/docs public and protects business routes", async () => {
      const server = app!;

      const healthRes = await server.inject({ method: "GET", url: "/health" });
      expect(healthRes.statusCode).toBe(200);

      const versionRes = await server.inject({ method: "GET", url: "/version" });
      expect(versionRes.statusCode).toBe(200);

      const docsRes = await server.inject({ method: "GET", url: "/docs/" });
      expect(docsRes.statusCode).toBe(200);

      const noAuthRes = await server.inject({ method: "GET", url: "/sessions" });
      expect(noAuthRes.statusCode).toBe(401);
      expect(noAuthRes.json<ErrorResponse>().error.code).toBe("auth_required");

      const invalidKeyRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { "x-api-key": "wrong-key" },
      });
      expect(invalidKeyRes.statusCode).toBe(403);
      expect(invalidKeyRes.json<ErrorResponse>().error.code).toBe("auth_invalid_credentials");

      const validKeyRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { "x-api-key": "dev-key" },
      });
      expect(validKeyRes.statusCode).toBe(200);
    });
  });

  describe("api_key mode with ACCOUNT_MODE=multi", () => {
    beforeEach(async () => {
      ({ app } = await buildApp({
        databasePath: ":memory:",
        logger: false,
        accountMode: "multi",
        auth: {
          mode: "api_key",
          apiKeys: ["root-key", "disabled-key", "ghost-key"],
          apiKeyAccountMap: {
            "root-key": "default-admin",
            "disabled-key": "acc-disabled",
            "ghost-key": "acc-missing",
          },
        },
      }));

      const server = app!;

      const createDisabledAccountRes = await server.inject({
        method: "POST",
        url: "/accounts",
        headers: { "x-api-key": "root-key" },
        payload: { id: "acc-disabled", name: "Disabled Account" },
      });
      expect(createDisabledAccountRes.statusCode, createDisabledAccountRes.body).toBe(201);

      const disableAccountRes = await server.inject({
        method: "PATCH",
        url: "/accounts/acc-disabled",
        headers: { "x-api-key": "root-key" },
        payload: { status: "disabled" },
      });
      expect(disableAccountRes.statusCode, disableAccountRes.body).toBe(200);
    });

    it("rejects api keys bound to missing or disabled accounts", async () => {
      const server = app!;

      const rootKeyRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { "x-api-key": "root-key" },
      });
      expect(rootKeyRes.statusCode).toBe(200);

      const missingAccountRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { "x-api-key": "ghost-key" },
      });
      expect(missingAccountRes.statusCode).toBe(401);
      expect(missingAccountRes.json<ErrorResponse>().error.code).toBe("auth_account_not_found");

      const disabledAccountRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { "x-api-key": "disabled-key" },
      });
      expect(disabledAccountRes.statusCode).toBe(403);
      expect(disabledAccountRes.json<ErrorResponse>().error.code).toBe("auth_account_disabled");
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

    it("requires valid bearer token while keeping version public", async () => {
      const server = app!;

      const versionRes = await server.inject({ method: "GET", url: "/version" });
      expect(versionRes.statusCode).toBe(200);

      const noAuthRes = await server.inject({ method: "GET", url: "/sessions" });
      expect(noAuthRes.statusCode).toBe(401);
      expect(noAuthRes.json<ErrorResponse>().error.code).toBe("auth_required");

      const invalidTokenRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: { authorization: "Bearer invalid-token" },
      });
      expect(invalidTokenRes.statusCode).toBe(403);
      expect(invalidTokenRes.json<ErrorResponse>().error.code).toBe("auth_invalid_token");

      const token = server.jwt.sign({ sub: "user-1" });
      const validTokenRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: bearer(token),
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

    async function createAccount(id: string, name: string, role: "admin" | "user" = "user") {
      const server = app!;
      const rootToken = server.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });
      const response = await server.inject({
        method: "POST",
        url: "/accounts",
        headers: bearer(rootToken),
        payload: { id, name, role },
      });
      expect(response.statusCode, response.body).toBe(201);
    }

    async function disableAccount(id: string) {
      const server = app!;
      const rootToken = server.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });
      const response = await server.inject({
        method: "PATCH",
        url: `/accounts/${id}`,
        headers: bearer(rootToken),
        payload: { status: "disabled" },
      });
      expect(response.statusCode, response.body).toBe(200);
    }

    it("requires account claim and uses database role/status for authorization", async () => {
      const server = app!;

      const tokenWithoutAccount = server.jwt.sign({ sub: "u-1" });
      const unresolvedRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: bearer(tokenWithoutAccount),
      });
      expect(unresolvedRes.statusCode).toBe(403);
      expect(unresolvedRes.json<ErrorResponse>().error.code).toBe("auth_account_unresolved");

      const missingAccountToken = server.jwt.sign({ sub: "u-missing", account_id: "ghost-account", role: "admin" });
      const missingAccountRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: bearer(missingAccountToken),
      });
      expect(missingAccountRes.statusCode).toBe(401);
      expect(missingAccountRes.json<ErrorResponse>().error.code).toBe("auth_account_not_found");

      await createAccount("acc-user", "User Account", "user");

      const userTokenWithAdminClaim = server.jwt.sign({ sub: "u-1", account_id: "acc-user", role: "admin" });
      const forbiddenRes = await server.inject({
        method: "GET",
        url: "/accounts",
        headers: bearer(userTokenWithAdminClaim),
      });
      expect(forbiddenRes.statusCode).toBe(403);
      expect(forbiddenRes.json<ErrorResponse>().error.code).toBe("account_forbidden");

      const adminTokenWithUserClaim = server.jwt.sign({ sub: "u-admin", account_id: "default-admin", role: "user" });
      const accountsRes = await server.inject({
        method: "GET",
        url: "/accounts",
        headers: bearer(adminTokenWithUserClaim),
      });
      expect(accountsRes.statusCode).toBe(200);

      await createAccount("acc-disabled", "Disabled Account", "user");
      await disableAccount("acc-disabled");

      const disabledToken = server.jwt.sign({ sub: "u-disabled", account_id: "acc-disabled", role: "admin" });
      const disabledRes = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: bearer(disabledToken),
      });
      expect(disabledRes.statusCode).toBe(403);
      expect(disabledRes.json<ErrorResponse>().error.code).toBe("auth_account_disabled");
    });

    it("isolates sessions by account", async () => {
      const server = app!;

      await createAccount("acc-a", "Account A");
      await createAccount("acc-b", "Account B");

      const tokenA = server.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
      const tokenB = server.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });

      const createSessionRes = await server.inject({
        method: "POST",
        url: "/sessions",
        headers: bearer(tokenA),
        payload: { title: "A Session" },
      });
      expect(createSessionRes.statusCode).toBe(201);

      const sessionId = createSessionRes.json<{ data: { id: string } }>().data.id;

      const listA = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: bearer(tokenA),
      });
      const listB = await server.inject({
        method: "GET",
        url: "/sessions",
        headers: bearer(tokenB),
      });

      expect(listA.statusCode).toBe(200);
      expect(listB.statusCode).toBe(200);
      expect(listA.json<{ data: unknown[] }>().data).toHaveLength(1);
      expect(listB.json<{ data: unknown[] }>().data).toHaveLength(0);

      const getByB = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}`,
        headers: bearer(tokenB),
      });
      expect(getByB.statusCode).toBe(404);

      const patchByB = await server.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}`,
        headers: bearer(tokenB),
        payload: { title: "Hacked" },
      });
      expect(patchByB.statusCode).toBe(404);
    });

    it("isolates session branches/timeline/diff/delete by account", async () => {
      const server = app!;

      await createAccount("acc-a", "Account A");
      await createAccount("acc-b", "Account B");

      const tokenA = server.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
      const tokenB = server.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });

      const createSessionRes = await server.inject({
        method: "POST",
        url: "/sessions",
        headers: bearer(tokenA),
        payload: { title: "A Session" },
      });
      expect(createSessionRes.statusCode).toBe(201);
      const sessionId = createSessionRes.json<{ data: { id: string } }>().data.id;

      const createMainFloor = await server.inject({
        method: "POST",
        url: "/floors",
        headers: bearer(tokenA),
        payload: { session_id: sessionId, floor_no: 0, branch_id: "main", state: "committed" },
      });
      expect(createMainFloor.statusCode).toBe(201);

      const createAltFloor = await server.inject({
        method: "POST",
        url: "/floors",
        headers: bearer(tokenA),
        payload: { session_id: sessionId, floor_no: 0, branch_id: "alt" },
      });
      expect(createAltFloor.statusCode).toBe(201);

      const branchesByA = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/branches`,
        headers: bearer(tokenA),
      });
      expect(branchesByA.statusCode).toBe(200);
      expect(branchesByA.json<{ data: Array<{ branch_id: string }> }>().data).toEqual(expect.arrayContaining([
        expect.objectContaining({ branch_id: "main" }),
        expect.objectContaining({ branch_id: "alt" }),
      ]));

      const timelineByA = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/timeline?branch_id=main`,
        headers: bearer(tokenA),
      });
      expect(timelineByA.statusCode).toBe(200);

      const diffByA = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/branches/diff?target_branch_id=alt`,
        headers: bearer(tokenA),
      });
      expect(diffByA.statusCode).toBe(200);

      const branchesByB = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/branches`,
        headers: bearer(tokenB),
      });
      expect(branchesByB.statusCode).toBe(404);

      const timelineByB = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/timeline?branch_id=main`,
        headers: bearer(tokenB),
      });
      expect(timelineByB.statusCode).toBe(404);

      const diffByB = await server.inject({
        method: "GET",
        url: `/sessions/${sessionId}/branches/diff?target_branch_id=alt`,
        headers: bearer(tokenB),
      });
      expect(diffByB.statusCode).toBe(404);

      const deleteByB = await server.inject({
        method: "DELETE",
        url: `/sessions/${sessionId}`,
        headers: bearer(tokenB),
      });
      expect(deleteByB.statusCode).toBe(404);
    });
  });
});
