import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { buildBranchVariableScopeId } from "@tavern/shared";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  branchLocalVariableSnapshots,
  floors,
  sessions,
  variables,
} from "../../db/schema.js";
import {
  BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1,
  BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2,
  BranchLocalSnapshotMissingError,
  BranchLocalVariableSnapshotService,
} from "../branch-local-variable-snapshot-service.js";

async function seedAccount(database: DatabaseConnection, accountId: string, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: accountId,
    name: accountId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
}

async function seedSession(
  database: DatabaseConnection,
  sessionId: string,
  now: number,
  accountId: string = DEFAULT_ADMIN_ACCOUNT_ID,
): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Branch Local Snapshot Test",
    accountId,
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
  branchId?: string;
}): Promise<void> {
  await args.database.db.insert(floors).values({
    id: args.floorId,
    sessionId: args.sessionId,
    floorNo: 0,
    branchId: args.branchId ?? "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function seedVariable(args: {
  database: DatabaseConnection;
  id?: string;
  accountId?: string;
  scope: "global" | "chat" | "branch" | "floor" | "page";
  scopeId: string;
  key: string;
  value: unknown;
  now: number;
}): Promise<string> {
  const id = args.id ?? nanoid();
  await args.database.db.insert(variables).values({
    id,
    accountId: args.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID,
    scope: args.scope,
    scopeId: args.scopeId,
    key: args.key,
    valueJson: JSON.stringify(args.value),
    updatedAt: args.now,
  });
  return id;
}

describe("BranchLocalVariableSnapshotService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("persists a v2 snapshot with provenance distinguishing inherited chat values from authored branch values", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_690_000_000;
    const branchScopeId = buildBranchVariableScopeId(sessionId, "main");

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, now });

    // chat 层提供两个可继承值：chat_only 与 shared
    const chatOnlyVarId = await seedVariable({
      database,
      scope: "chat",
      scopeId: sessionId,
      key: "chat_only",
      value: "campfire",
      now: now + 1,
    });
    await seedVariable({
      database,
      scope: "chat",
      scopeId: sessionId,
      key: "shared",
      value: "chat-shared",
      now: now + 2,
    });

    // branch 层覆盖 shared 并新增 branch_only
    const branchOnlyVarId = await seedVariable({
      database,
      scope: "branch",
      scopeId: branchScopeId,
      key: "branch_only",
      value: { coins: 3 },
      now: now + 3,
    });
    const sharedBranchVarId = await seedVariable({
      database,
      scope: "branch",
      scopeId: branchScopeId,
      key: "shared",
      value: "branch-shared",
      now: now + 4,
    });

    const service = new BranchLocalVariableSnapshotService(database.db);
    const persisted = service.persistFloorLocalSnapshot({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      floorId,
      sessionId,
      branchId: "main",
      createdAt: now + 10,
    });

    expect(persisted.schemaVersion).toBe(BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2);
    expect(persisted.values).toEqual({
      chat_only: "campfire",
      shared: "branch-shared",
      branch_only: { coins: 3 },
    });
    expect(persisted.provenance.chat_only).toEqual({
      sourceScope: "chat",
      sourceScopeId: sessionId,
      sourceVariableId: chatOnlyVarId,
      sourceUpdatedAt: now + 1,
      originKind: "inherited",
    });
    expect(persisted.provenance.shared).toEqual({
      sourceScope: "branch",
      sourceScopeId: branchScopeId,
      sourceVariableId: sharedBranchVarId,
      sourceUpdatedAt: now + 4,
      originKind: "authored",
    });
    expect(persisted.provenance.branch_only).toEqual({
      sourceScope: "branch",
      sourceScopeId: branchScopeId,
      sourceVariableId: branchOnlyVarId,
      sourceUpdatedAt: now + 3,
      originKind: "authored",
    });

    // round-trip：持久化后从 DB 重读，schemaVersion / provenance 应保持一致
    const reloaded = service.getFloorLocalSnapshot({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      floorId,
    });
    expect(reloaded).toMatchObject({
      floorId,
      schemaVersion: BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2,
      values: persisted.values,
      provenance: persisted.provenance,
    });

    const [row] = await database.db
      .select()
      .from(branchLocalVariableSnapshots)
      .where(eq(branchLocalVariableSnapshots.floorId, floorId));
    expect(row?.snapshotVersion).toBe(BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2);
    expect(row?.provenanceJson).toBeTruthy();
  });

  it("keeps reading legacy v1 snapshot rows without provenance", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_690_100_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, now });

    // 模拟旧行：仅有 valuesJson，snapshot_version 走默认值 1，provenance_json 为 NULL
    await database.db.insert(branchLocalVariableSnapshots).values({
      floorId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      valuesJson: JSON.stringify({ mood: "steady" }),
      createdAt: now,
    });

    const service = new BranchLocalVariableSnapshotService(database.db);
    const record = service.getFloorLocalSnapshot({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      floorId,
    });

    expect(record).not.toBeNull();
    expect(record!.schemaVersion).toBe(BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1);
    expect(record!.values).toEqual({ mood: "steady" });
    expect(record!.provenance).toEqual({});
  });

  it("materialize marks inherited origin for the target branch snapshot payload", async () => {
    const sessionId = nanoid();
    const sourceFloorId = nanoid();
    const now = 1_735_690_200_000;
    const sourceBranchScopeId = buildBranchVariableScopeId(sessionId, "main");

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId: sourceFloorId, now });
    await seedVariable({
      database,
      scope: "chat",
      scopeId: sessionId,
      key: "chat_only",
      value: "campfire",
      now: now + 1,
    });
    await seedVariable({
      database,
      scope: "branch",
      scopeId: sourceBranchScopeId,
      key: "branch_only",
      value: "lantern",
      now: now + 2,
    });

    const service = new BranchLocalVariableSnapshotService(database.db);
    service.persistFloorLocalSnapshot({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      floorId: sourceFloorId,
      sessionId,
      branchId: "main",
      createdAt: now + 5,
    });

    const result = service.materializeFromSourceFloor({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      sourceFloorId,
      sourceBranchId: "main",
      targetBranchId: "alt",
      createdAt: now + 10,
    });

    expect(result.restoredKeys.sort()).toEqual(["branch_only", "chat_only"]);
    expect(result.targetScopeId).toBe(buildBranchVariableScopeId(sessionId, "alt"));
    // chat_only 源本来就是 inherited；branch_only 源本是 authored，
    // 迁移到 alt 分支后统一视为 inherited，
    // 并加上 inheritedFromFloorId / inheritedFromBranchId
    expect(result.provenance.chat_only).toMatchObject({
      sourceScope: "chat",
      sourceScopeId: sessionId,
      inheritedFromFloorId: sourceFloorId,
      inheritedFromBranchId: "main",
      originKind: "inherited",
    });
    expect(result.provenance.branch_only).toMatchObject({
      sourceScope: "branch",
      sourceScopeId: sourceBranchScopeId,
      inheritedFromFloorId: sourceFloorId,
      inheritedFromBranchId: "main",
      originKind: "inherited",
    });

    // 确认 alt 分支的变量行已落库
    const altScopeId = buildBranchVariableScopeId(sessionId, "alt");
    const altRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "branch"), eq(variables.scopeId, altScopeId)));
    const byKey = new Map(altRows.map((row) => [row.key, JSON.parse(row.valueJson)]));
    expect(byKey.get("chat_only")).toBe("campfire");
    expect(byKey.get("branch_only")).toBe("lantern");
  });

  it("throws BranchLocalSnapshotMissingError when source floor has no snapshot", async () => {
    const sessionId = nanoid();
    const sourceFloorId = nanoid();
    const now = 1_735_690_300_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId: sourceFloorId, now });

    const service = new BranchLocalVariableSnapshotService(database.db);
    expect(() => service.requireSourceFloorLocalValues({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      sourceFloorId,
      sourceBranchId: "main",
    })).toThrow(BranchLocalSnapshotMissingError);
  });

  it("restoreSnapshot writes a v2 row with the provided provenance payload", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const foreignAccountId = "account-foreign";
    const now = 1_735_690_400_000;

    await seedAccount(database, foreignAccountId, now);
    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, now });

    const service = new BranchLocalVariableSnapshotService(database.db);
    const restored = service.restoreSnapshot({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      floorId,
      sessionId,
      branchId: "main",
      createdAt: now + 5,
      values: { imported_key: "imported-value" },
      provenance: {
        imported_key: {
          sourceScope: "branch",
          sourceScopeId: buildBranchVariableScopeId(sessionId, "main"),
          sourceVariableId: "var_legacy_export",
          sourceUpdatedAt: now,
          inheritedFromFloorId: "legacy-floor",
          inheritedFromBranchId: "legacy-branch",
          originKind: "inherited",
        },
      },
    });

    expect(restored.schemaVersion).toBe(BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2);
    expect(restored.provenance.imported_key?.originKind).toBe("inherited");

    const reloaded = service.getFloorLocalSnapshot({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      floorId,
    });
    expect(reloaded!.values).toEqual({ imported_key: "imported-value" });
    expect(reloaded!.provenance.imported_key).toMatchObject({
      sourceScope: "branch",
      inheritedFromFloorId: "legacy-floor",
      inheritedFromBranchId: "legacy-branch",
      originKind: "inherited",
    });
  });
});
