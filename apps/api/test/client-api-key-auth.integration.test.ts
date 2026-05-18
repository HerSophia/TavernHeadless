import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp, type BuildAppResult } from "../src/app";
import { ClientApiKeyService } from "../src/services/client-api-key-service";
import { ClientService } from "../src/services/client-service";

type ErrorResponse= { error: { code: string; message: string } };

describe("Client API Key auth integration", () => {
  let built: BuildAppResult | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    built = undefined;
    app = undefined;
  });

  it("authenticates with X-Tavern-Client-Key and exposes a client actor", async () => {
    built = await buildApp({
      databasePath: ":memory:",
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;

    const clientService= new ClientService(built.database);
    const apiKeyService = new ClientApiKeyService(built.database);
    const client = clientService.create({
      accountId: "default-admin",
      name: "Test Client",
      kind: "custom",
      now: 1_700_000_000_000,
    });
    const created = apiKeyService.create({
      accountId: "default-admin",
     clientId: client.id,
      now: 1_700_000_000_001,
    });

    app.get("/test/auth-context", async (request) => ({
      auth: request.authContext ?? null,
    }));

    const ok = await app.inject({
      method: "GET",
      url: "/test/auth-context",
      headers: { "x-tavern-client-key": created.secret },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const body = ok.json<{ auth: { actorType: string; actorClientId: string | null; authMethod: string } }>();
    expect(body.auth.actorType).toBe("client");
    expect(body.auth.actorClientId).toBe(client.id);
    expect(body.auth.authMethod).toBe("client_api_key");

    const bad = await app.inject({
      method: "GET",
      url: "/test/auth-context",
      headers: { "x-tavern-client-key": "tvk_live_unknown"},
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json<ErrorResponse>().error.code).toBe("client_api_key_invalid");
  });

it("also accepts Authorization: Bearer tvk_live_...", async () => {
    built = await buildApp({
      databasePath: ":memory:",
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;

    const clientService = new ClientService(built.database);
    const apiKeyService = new ClientApiKeyService(built.database);
    const client = clientService.create({
      accountId: "default-admin",
      name: "Bearer Client",
      kind: "custom",
      now: 1_700_000_000_000,
 });
    const created = apiKeyService.create({
      accountId: "default-admin",
      clientId: client.id,
      now: 1_700_000_000_001,
    });

    app.get("/test/auth-context", async (request) => ({
      auth: request.authContext ?? null,
    }));

    const ok = await app.inject({
      method: "GET",
      url: "/test/auth-context",
     headers: { authorization: `Bearer ${created.secret}` },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const body = ok.json<{ auth: { actorType: string; actorClientId: string | null } }>();
    expect(body.auth.actorType).toBe("client");
    expect(body.auth.actorClientId).toBe(client.id);
  });
});
