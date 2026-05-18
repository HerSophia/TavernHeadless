import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { ensureTestAccount } from "../../__tests__/helpers/workspace-project.js";
import { ClientService, ClientServiceError, buildDefaultClientId } from "../client-service.js";

const ACCOUNT_A = "client-service-acc-a";
const ACCOUNT_B = "client-service-acc-b";
const NOW = 1_730_000_000_000;

describe("ClientService", () => {
  let database: DatabaseConnection;
  let service: ClientService;

 beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_A, NOW);
    ensureTestAccount(database.db, ACCOUNT_B, NOW);
    service = new ClientService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("ensures a default client per account and is idempotent", () => {
    const first = service.ensureDefaultClient({ accountId: ACCOUNT_A, now: NOW });
    const second = service.ensureDefaultClient({ accountId: ACCOUNT_A, now: NOW + 1 });
    expect(first.id).toBe(buildDefaultClientId(ACCOUNT_A));
    expect(first.isDefault).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it("creates a client with a normalized name and kind", () => {
    const record = service.create({
      accountId: ACCOUNT_A,
      name: "  World Simulator  ",
      kind: "deriver",
      now: NOW,
    });
    expect(record.name).toBe("World Simulator");
    expect(record.kind).toBe("deriver");
    expect(record.isDefault).toBe(false);
  });

  it("rejects empty name and invalid kind", () => {
    expect(() =>
      service.create({ accountId: ACCOUNT_A, name: "", now: NOW }),
    ).toThrowError(ClientServiceError);
    expect(() =>
      service.create({ accountId: ACCOUNT_A, name: "x", kind: "unknown" as never, now: NOW }),
    ).toThrowError(ClientServiceError);
  });

  it("refuses to disable the default client", () => {
    const def = service.ensureDefaultClient({ accountId: ACCOUNT_A, now: NOW });
    expect(() => service.disable({ accountId: ACCOUNT_A, clientId: def.id })).toThrowError(
      ClientServiceError,
    );
  });

  it("isolates clients by account", () => {
    const clientA = service.create({ accountId: ACCOUNT_A, name: "A", now: NOW });
    expect(() => service.getById({ accountId: ACCOUNT_B, clientId: clientA.id })).toThrowError(
      ClientServiceError,
    );
    service.ensureDefaultClient({ accountId: ACCOUNT_B, now: NOW });
    const listForB = service.list({ accountId: ACCOUNT_B });
    expect(listForB.items).toHaveLength(1); // only defaultclient
    expect(listForB.items[0]?.isDefault).toBe(true);
  });
});
