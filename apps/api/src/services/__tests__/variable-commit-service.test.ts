import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { buildBranchVariableScopeId } from "@tavern/shared";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, messagePages, sessions, variables } from "../../db/schema.js";
import { VariableCommitService } from "../variable-commit-service.js";
import { createEventBus } from "@tavern/core";

type PromotedVariableEntry = {
  key: string;
  value: unknown;
};

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
  scope: "global" | "chat" | "branch" | "floor" | "page";
  scopeId: string;
  key: string;
  value: unknown;
  now: number;
  accountId?: string;
}): Promise<void> {
  await args.database.db.insert(variables).values({
    id: args.id ?? nanoid(),
    accountId: args.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID,
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
    service = new VariableCommitService({
      db: database.db,
      eventBus: createEventBus(),
      defaultAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
      accountMode: "single",
    });
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
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          pageId,
          floorId,
          sessionId,
          policy: "replace",
          committedAt,
        },
        tx,
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
    expect(result.promotedVariables.map((entry: PromotedVariableEntry) => entry.key)).toEqual(["hp", "mood"]);
    expect(result.promotedVariables.map((entry: PromotedVariableEntry) => entry.value)).toEqual([120, "happy"]);

    const floorRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));

    const byKey = new Map(
      floorRows.map((row) => [row.key, JSON.parse(row.valueJson)]),
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
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          pageId,
          floorId,
          sessionId,
          policy: "ifAbsent",
          committedAt,
        },
        tx,
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
      floorRows.map((row) => [row.key, JSON.parse(row.valueJson)]),
    );

    expect(byKey.get("hp")).toBe(80);
    expect(byKey.get("mood")).toBe("calm");
  });

  it("keeps variable commit on the page -> floor boundary without touching branch scope", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const branchScopeId = buildBranchVariableScopeId(sessionId, "main");
    const now = 1_735_690_015_000;
    const committedAt = now + 500;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, now });
    await seedInputPage({ database, floorId, pageId, now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "mood", value: "focused", now });
    await seedVariable({
      database,
      scope: "branch",
      scopeId: branchScopeId,
      key: "route",
      value: "existing-branch",
      now,
    });

    const result = database.db.transaction((tx) => {
      return service.promoteAll(
        {
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          pageId,
          floorId,
          sessionId,
          policy: "replace",
          committedAt,
        },
        tx,
      );
    });

    expect(result.fromScope).toBe("page");
    expect(result.toScope).toBe("floor");

    const floorRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));
    expect(floorRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([["mood", "focused"]]);

    const branchRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "branch"), eq(variables.scopeId, branchScopeId)));
    expect(branchRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([["route", "existing-branch"]]);
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
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          floorId,
          sessionId,
        },
        tx,
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
            accountId: DEFAULT_ADMIN_ACCOUNT_ID,
            pageId,
            floorId,
            sessionId,
            committedAt,
          },
          tx,
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

  it("scopes page->floor promotion strictly by the requesting accountId", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const foreignAccountId = "account-foreign";
    const now = 1_735_690_050_000;
    const committedAt = now + 500;

    // 当前账号的 page 真相源。
    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, now });
    await seedInputPage({ database, floorId, pageId, now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "mood", value: "focused", now });

    // 另一个账号持有同 key 同 scope 结构的 page 与 floor 行。
    // Phase 1 要求 promotion 既不能读取这里的 page 值，
    // 也不能覆盖这里的 floor 值。
    await database.db.insert(accounts).values({
      id: foreignAccountId,
      name: foreignAccountId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    await seedVariable({
      database,
      accountId: foreignAccountId,
      scope: "page",
      scopeId: pageId,
      key: "mood",
      value: "foreign-page",
      now,
    });
    await seedVariable({
      database,
      accountId: foreignAccountId,
      scope: "floor",
      scopeId: floorId,
      key: "mood",
      value: "foreign-floor",
      now,
    });

    const result = database.db.transaction((tx) => {
      return service.promoteAll(
        {
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          pageId,
          floorId,
          sessionId,
          policy: "replace",
          committedAt,
        },
        tx,
      );
    });

    expect(result).toMatchObject({
      scannedCount: 1,
      promotedCount: 1,
      skippedCount: 0,
    });
    expect(result.promotedVariables.map((entry: PromotedVariableEntry) => entry.value)).toEqual(["focused"]);

    const ownedFloorRows = await database.db
      .select()
      .from(variables)
      .where(and(
        eq(variables.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
        eq(variables.scope, "floor"),
        eq(variables.scopeId, floorId),
      ));
    expect(ownedFloorRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([
      ["mood", "focused"],
    ]);

    // 另一个账号的 floor 行不应被覆盖。
    const foreignFloorRows = await database.db
      .select()
      .from(variables)
      .where(and(
        eq(variables.accountId, foreignAccountId),
        eq(variables.scope, "floor"),
        eq(variables.scopeId, floorId),
      ));
    expect(foreignFloorRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([
      ["mood", "foreign-floor"],
    ]);

    // 另一个账号的 page 行也不应被读取到（等价校验它还在原位）。
    const foreignPageRows = await database.db
      .select()
      .from(variables)
      .where(and(
        eq(variables.accountId, foreignAccountId),
        eq(variables.scope, "page"),
        eq(variables.scopeId, pageId),
      ));
    expect(foreignPageRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([
      ["mood", "foreign-page"],
    ]);
  });
});
