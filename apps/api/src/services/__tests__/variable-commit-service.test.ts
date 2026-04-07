import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { floors, messagePages, sessions, variables } from "../../db/schema.js";
import { VariableCommitService } from "../variable-commit-service.js";

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Variable Commit Test",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedFloor(args: {
  database: DatabaseConnection;
  sessionId: string;
  floorId: string;
  now: number;
}): Promise<void> {
  await args.database.db.insert(floors).values({
    id: args.floorId,
    sessionId: args.sessionId,
    floorNo: 0,
    branchId: "main",
    parentFloorId: null,
    state: "generating",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function seedInputPage(args: {
  database: DatabaseConnection;
  floorId: string;
  pageId: string;
  now: number;
}): Promise<void> {
  await args.database.db.insert(messagePages).values({
    id: args.pageId,
    floorId: args.floorId,
    pageNo: 0,
    pageKind: "input",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function seedVariable(args: {
  database: DatabaseConnection;
  id?: string;
  scope: "global" | "chat" | "floor" | "page";
  scopeId: string;
  key: string;
  value: unknown;
  now: number;
}): Promise<void> {
  await args.database.db.insert(variables).values({
    id: args.id ?? nanoid(),
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    scope: args.scope,
    scopeId: args.scopeId,
    key: args.key,
    valueJson: JSON.stringify(args.value),
    updatedAt: args.now,
  });
}

describe("VariableCommitService", () => {
  let database: DatabaseConnection;
  let service: VariableCommitService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new VariableCommitService();
  });

  afterEach(() => {
    database.close();
  });

  it("promotes page variables to floor with replace policy", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_690_000_000;
    const committedAt = now + 500;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, now });
    await seedInputPage({ database, floorId, pageId, now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "hp", value: 120, now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "mood", value: "happy", now });
    await seedVariable({ database, scope: "floor", scopeId: floorId, key: "hp", value: 80, now });

    const result = database.db.transaction((tx) => {
      return service.promoteAll(
        {
          pageId,
          floorId,
          sessionId,
          policy: "replace",
          committedAt,
        },
        tx
      );
    });

    expect(result).toMatchObject({
      pageId,
      floorId,
      sessionId,
      policy: "replace",
      scannedCount: 2,
      promotedCount: 2,
      skippedCount: 0,
    });
    expect(result.promotedVariables.map((entry) => entry.key)).toEqual(["hp", "mood"]);
    expect(result.promotedVariables.map((entry) => entry.value)).toEqual([120, "happy"]);

    const floorRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));

    const byKey = new Map(
      floorRows.map((row) => [row.key, JSON.parse(row.valueJson)])
    );

    expect(byKey.get("hp")).toBe(120);
    expect(byKey.get("mood")).toBe("happy");
  });

  it("skips existing floor keys when policy is ifAbsent", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_690_010_000;
    const committedAt = now + 500;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, now });
    await seedInputPage({ database, floorId, pageId, now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "hp", value: 120, now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "mood", value: "calm", now });
    await seedVariable({ database, scope: "floor", scopeId: floorId, key: "hp", value: 80, now });

    const result = database.db.transaction((tx) => {
      return service.promoteAll(
        {
          pageId,
          floorId,
          sessionId,
          policy: "ifAbsent",
          committedAt,
        },
        tx
      );
    });

    expect(result).toMatchObject({
      pageId,
      floorId,
      sessionId,
      policy: "ifAbsent",
      scannedCount: 2,
      promotedCount: 1,
      skippedCount: 1,
    });
    expect(result.promotedVariables).toEqual([
      expect.objectContaining({
        scope: "floor",
        scopeId: floorId,
        key: "mood",
        value: "calm",
        updatedAt: committedAt,
      }),
    ]);

    const floorRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));

    const byKey = new Map(
      floorRows.map((row) => [row.key, JSON.parse(row.valueJson)])
    );

    expect(byKey.get("hp")).toBe(80);
    expect(byKey.get("mood")).toBe("calm");
  });

  it("returns an empty summary when pageId is absent", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_690_020_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, now });

    const result = database.db.transaction((tx) => {
      return service.promoteAll(
        {
          floorId,
          sessionId,
        },
        tx
      );
    });

    expect(result).toEqual({
      pageId: undefined,
      floorId,
      sessionId,
      fromScope: "page",
      toScope: "floor",
      policy: "replace",
      scannedCount: 0,
      promotedCount: 0,
      skippedCount: 0,
      promotedVariables: [],
    });
  });

  it("rolls back promoted floor variables when the outer transaction fails", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_690_030_000;
    const committedAt = now + 500;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, now });
    await seedInputPage({ database, floorId, pageId, now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "mood", value: "tense", now });

    expect(() => {
      database.db.transaction((tx) => {
        service.promoteAll(
          {
            pageId,
            floorId,
            sessionId,
            committedAt,
          },
          tx
        );

        throw new Error("force rollback");
      });
    }).toThrow("force rollback");

    const floorRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));

    expect(floorRows).toEqual([]);
  });
});
