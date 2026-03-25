import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";
import { registerAccountRoutes } from "../src/routes/accounts";

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type AccountResponse = {
  data: {
    id: string;
    name: string;
    role: "admin" | "user";
    status: "active" | "disabled";
    is_default: boolean;
    created_at: number;
    updated_at: number;
  };
};

describe("Account routes", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let userToken: string;

  beforeEach(async () => {
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" }
    }));

    adminToken = app.jwt.sign({ sub: "u-admin", account_id: "default-admin", role: "admin" });
    userToken = app.jwt.sign({ sub: "u-user", account_id: "default-admin", role: "user" });
  });

  afterEach(async () => {
    await app.close();
  });

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it("covers account create/get/update/delete branches", async () => {
    const forbiddenCreateRes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeader(userToken),
      payload: { name: "Forbidden Create" }
    });
    expect(forbiddenCreateRes.statusCode).toBe(403);
    expect(forbiddenCreateRes.json<ErrorResponse>().error.code).toBe("account_forbidden");

    const invalidCreateRes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeader(adminToken),
      payload: {}
    });
    expect(invalidCreateRes.statusCode).toBe(400);

    const createdRes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeader(adminToken),
      payload: { name: "Generated Account" }
    });
    expect(createdRes.statusCode, createdRes.body).toBe(201);
    const created = createdRes.json<AccountResponse>().data;
    expect(created.id).toEqual(expect.any(String));
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.name).toBe("Generated Account");
    expect(created.role).toBe("user");
    expect(created.status).toBe("active");
    expect(created.is_default).toBe(false);

    const listRes = await app.inject({
      method: "GET",
      url: "/accounts",
      headers: authHeader(adminToken)
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json<{ data: Array<{ id: string }> }>().data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })])
    );

    const duplicateRes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeader(adminToken),
      payload: { id: created.id, name: "Duplicate Account" }
    });
    expect(duplicateRes.statusCode).toBe(409);
    expect(duplicateRes.json<ErrorResponse>().error.code).toBe("account_conflict");

    const forbiddenGetRes = await app.inject({
      method: "GET",
      url: `/accounts/${created.id}`,
      headers: authHeader(userToken)
    });
    expect(forbiddenGetRes.statusCode).toBe(403);
    expect(forbiddenGetRes.json<ErrorResponse>().error.code).toBe("account_forbidden");

    const getRes = await app.inject({
      method: "GET",
      url: `/accounts/${created.id}`,
      headers: authHeader(adminToken)
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json<AccountResponse>().data).toEqual(expect.objectContaining({
      id: created.id,
      name: "Generated Account"
    }));

    const missingGetRes = await app.inject({
      method: "GET",
      url: "/accounts/missing-account",
      headers: authHeader(adminToken)
    });
    expect(missingGetRes.statusCode).toBe(404);
    expect(missingGetRes.json<ErrorResponse>().error.code).toBe("account_not_found");

    const forbiddenPatchRes = await app.inject({
      method: "PATCH",
      url: `/accounts/${created.id}`,
      headers: authHeader(userToken),
      payload: { name: "Blocked Rename" }
    });
    expect(forbiddenPatchRes.statusCode).toBe(403);
    expect(forbiddenPatchRes.json<ErrorResponse>().error.code).toBe("account_forbidden");

    const invalidPatchRes = await app.inject({
      method: "PATCH",
      url: `/accounts/${created.id}`,
      headers: authHeader(adminToken),
      payload: {}
    });
    expect(invalidPatchRes.statusCode).toBe(400);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/accounts/${created.id}`,
      headers: authHeader(adminToken),
      payload: {
        name: "Renamed Account",
        role: "admin",
        status: "disabled"
      }
    });
    expect(patchRes.statusCode, patchRes.body).toBe(200);
    expect(patchRes.json<AccountResponse>().data).toEqual(expect.objectContaining({
      id: created.id,
      name: "Renamed Account",
      role: "admin",
      status: "disabled"
    }));

    const missingPatchRes = await app.inject({
      method: "PATCH",
      url: "/accounts/missing-account",
      headers: authHeader(adminToken),
      payload: { name: "Ghost" }
    });
    expect(missingPatchRes.statusCode).toBe(404);
    expect(missingPatchRes.json<ErrorResponse>().error.code).toBe("account_not_found");

    const protectedPatchRes = await app.inject({
      method: "PATCH",
      url: "/accounts/default-admin",
      headers: authHeader(adminToken),
      payload: { status: "disabled" }
    });
    expect(protectedPatchRes.statusCode).toBe(409);
    expect(protectedPatchRes.json<ErrorResponse>().error.code).toBe("account_protected");

    const forbiddenDeleteRes = await app.inject({
      method: "DELETE",
      url: `/accounts/${created.id}`,
      headers: authHeader(userToken)
    });
    expect(forbiddenDeleteRes.statusCode).toBe(403);
    expect(forbiddenDeleteRes.json<ErrorResponse>().error.code).toBe("account_forbidden");

    const missingDeleteRes = await app.inject({
      method: "DELETE",
      url: "/accounts/missing-account",
      headers: authHeader(adminToken)
    });
    expect(missingDeleteRes.statusCode).toBe(404);
    expect(missingDeleteRes.json<ErrorResponse>().error.code).toBe("account_not_found");

    const protectedDeleteRes = await app.inject({
      method: "DELETE",
      url: "/accounts/default-admin",
      headers: authHeader(adminToken)
    });
    expect(protectedDeleteRes.statusCode).toBe(409);
    expect(protectedDeleteRes.json<ErrorResponse>().error.code).toBe("account_protected");

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/accounts/${created.id}`,
      headers: authHeader(adminToken)
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({
      data: {
        id: created.id,
        deleted: true
      }
    });
  });

  it("returns account_has_resources when delete hits a foreign key failure", async () => {
    const routeApp = Fastify({ logger: false });
    const mockConnection = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{
              id: "acc-owned",
              name: "Owned Account",
              role: "admin",
              status: "active",
              isDefault: false,
              createdAt: 1,
              updatedAt: 1
            }]
          })
        })
      }),
      delete: () => ({
        where: async () => {
          throw new Error("FOREIGN KEY constraint failed");
        }
      })
    };

    await registerAccountRoutes(routeApp, { db: mockConnection } as any);

    const deleteRes = await routeApp.inject({
      method: "DELETE",
      url: "/accounts/acc-owned"
    });

    expect(deleteRes.statusCode).toBe(409);
    expect(deleteRes.json<ErrorResponse>().error.code).toBe("account_has_resources");

    await routeApp.close();
  });
});
