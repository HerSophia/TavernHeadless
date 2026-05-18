import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { ensureTestAccount } from "../../__tests__/helpers/workspace-project.js";
import {
  ClientApiKeyService,
  ClientApiKeyServiceError,
} from "../client-api-key-service.js";
import { ClientService } from "../client-service.js";

const ACCOUNT_A = "client-api-key-acc-a";
const NOW = 1_731_000_000_000;

describe("ClientApiKeyService", () => {
  let database: DatabaseConnection;
  let clientService: ClientService;
  let apiKeyService: ClientApiKeyService;
  let clientId: string;

  beforeEach(() => {
   database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_A, NOW);
    clientService = new ClientService(database.db);
    apiKeyService = new ClientApiKeyService(database.db);
    clientId = clientService.create({
      accountId: ACCOUNT_A,
      name: "Sample",
      kind: "deriver",
      now: NOW,
    }).id;
  });

  afterEach(() => {
    database.close();
  });

  it("creates an api key and returns secret only once", ()=> {
    const created = apiKeyService.create({
      accountId: ACCOUNT_A,
      clientId,
      name: "production",
     now: NOW,
    });
    expect(created.secret.startsWith("tvk_live_")).toBe(true);
    expect(created.apiKey.keyPrefix.startsWith("tvk_live_")).toBe(true);

    const list = apiKeyService.list({ accountId: ACCOUNT_A, clientId });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).not.toHaveProperty("secret");
  });

  it("authenticates with the issued secret", () => {
    const created = apiKeyService.create({
      accountId: ACCOUNT_A,
    clientId,
      now: NOW,
    });
    const auth = apiKeyService.authenticate(created.secret, NOW + 1_000);
    expect(auth.accountId).toBe(ACCOUNT_A);
    expect(auth.clientId).toBe(clientId);
  });

  it("rejects revoked or unknown secrets with a uniform error", () => {
    const created = apiKeyService.create({
      accountId: ACCOUNT_A,
      clientId,
      now: NOW,
    });
    apiKeyService.revoke({
      accountId: ACCOUNT_A,
      clientId,
      apiKeyId: created.apiKey.id,
      now: NOW + 5,
    });

    expect(() => apiKeyService.authenticate(created.secret, NOW + 100)).toThrowError(
      ClientApiKeyServiceError,
    );
    expect(() => apiKeyService.authenticate("tvk_live_unknown", NOW + 100)).toThrowError(
      ClientApiKeyServiceError,
    );
  });

  it("rejects expired keys",() => {
    const created = apiKeyService.create({
      accountId:ACCOUNT_A,
      clientId,
      expiresAt: NOW + 100,
      now: NOW,
    });
    expect(() => apiKeyService.authenticate(created.secret,NOW + 200)).toThrowError(
      ClientApiKeyServiceError,
    );
  });

  it("refuses to create a key for a disabled client", () => {
    clientService.disable({ accountId: ACCOUNT_A, clientId });
    expect(() =>
      apiKeyService.create({ accountId: ACCOUNT_A, clientId, now: NOW + 10 }),
    ).toThrowError(ClientApiKeyServiceError);
  });
});
