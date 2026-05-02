import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, sessions } from "../../db/schema.js";
import { SessionBranchRegistryService } from "../variables/host/session-branch-registry-service.js";

const ACCOUNT_ID = "default-admin";

async function seedAccount(database: DatabaseConnection, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: ACCOUNT_ID,
    name: "Default Admin",
    createdAt: now,
    updatedAt: now,
  })
    .onConflictDoNothing()
    .run();
}

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Registry Test",
    accountId: ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedFloor(args: {
  database: DatabaseConnection;
  sessionId: string;
  floorId: string;
  branchId: string;
  now: number;
}): Promise<void> {
  await args.database.db.insert(floors).values({
    id: args.floorId,
    sessionId: args.sessionId,
    floorNo: 0,
    branchId: args.branchId,
    parentFloorId: null,
    state: "draft",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

describe("SessionBranchRegistryService", () => {
  let database: DatabaseConnection;
  let service: SessionBranchRegistryService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new SessionBranchRegistryService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("ensures, lists, and removes first-class branch hosts", async () => {
    const sessionId = nanoid();
    const otherSessionId = nanoid();
    const now = 1_735_700_000_000;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedSession(database, otherSessionId, now + 1_000);
    await seedFloor({ database, sessionId, floorId: "floor-main", branchId: "main", now });
    await seedFloor({ database, sessionId: otherSessionId, floorId: "floor-alt", branchId: "alt", now: now + 1_000 });

    const main = service.ensure({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: "floor-main",
      sourceBranchId: null,
      createdAt: now,
      updatedAt: now + 10,
    });
    const alt = service.ensure({
      accountId: ACCOUNT_ID,
      sessionId: otherSessionId,
      branchId: "alt",
      sourceFloorId: "floor-alt",
      sourceBranchId: "main",
      createdAt: now + 20,
      updatedAt: now + 30,
    });

    expect(service.get(ACCOUNT_ID, sessionId, "main")).toEqual(main);
    expect(service.listByBranchId(ACCOUNT_ID, "alt")).toEqual([alt]);
    expect(service.listBySession(ACCOUNT_ID, sessionId)).toEqual([main]);

    const updated = service.ensure({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: null,
      sourceBranchId: "seed-main",
      createdAt: now + 5,
      updatedAt: now + 40,
    });

    expect(updated).toMatchObject({
      id: main.id,
      sourceFloorId: "floor-main",
      sourceBranchId: "seed-main",
      createdAt: now,
      updatedAt: now + 40,
    });

    expect(service.listByBranchId(ACCOUNT_ID, "main", [sessionId])).toEqual([updated]);
    expect(service.listBySession(ACCOUNT_ID, otherSessionId)).toEqual([alt]);
    expect(service.remove(ACCOUNT_ID, sessionId, "main")).toMatchObject({ id: main.id, branchId: "main" });
    expect(service.get(ACCOUNT_ID, sessionId, "main")).toBeNull();
  });
});
