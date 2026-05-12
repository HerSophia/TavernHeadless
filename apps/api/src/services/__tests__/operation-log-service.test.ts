import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, operationLogs } from "../../db/schema.js";
import { OperationLogService } from "../operation-log-service.js";
import { VcDiffService } from "../vc-diff-service.js";

describe("OperationLogService", () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    await database.db.insert(accounts).values([
      {
        id: "account-a",
        name: "Account A",
        role: "admin",
        status: "active",
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "account-b",
        name: "Account B",
        role: "user",
        status: "active",
        isDefault: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  afterEach(() => {
    database.close();
  });

  it("appends operation logs and parses JSON fields", () => {
    const service = new OperationLogService(database.db);
    const diff = new VcDiffService().diff({ title: "old" }, { title: "new" });

    const created = service.append({
      id: "op-1",
      accountId: "account-a",
      actorType: "user",
      actorId: "subject-1",
      requestId: "req-1",
      sourceType: "http",
      action: "update_session",
      status: "succeeded",
      sessionId: "session-1",
      targetType: "session",
      targetId: "session-1",
      beforeRef: { session_id: "session-1", revision: 1 },
      afterRef: { session_id: "session-1", revision: 2 },
      diff,
      metadata: { route: "PATCH /sessions/:id" },
      createdAt: 100,
    });

    expect(created).toMatchObject({
      id: "op-1",
      accountId: "account-a",
      actorType: "user",
      actorId: "subject-1",
      requestId: "req-1",
      sourceType: "http",
      action: "update_session",
      status: "succeeded",
      sessionId: "session-1",
      targetType: "session",
      targetId: "session-1",
      beforeRef: { session_id: "session-1", revision: 1 },
      afterRef: { session_id: "session-1", revision: 2 },
      metadata: { route: "PATCH /sessions/:id" },
      createdAt: 100,
    });
    expect(created.diff).toMatchObject({ mode: "summary", total_changes: 1 });
  });

  it("queries logs with account isolation", () => {
    const service = new OperationLogService(database.db);
    service.append({
      id: "op-a",
      accountId: "account-a",
      actorType: "user",
      sourceType: "http",
      action: "update_session",
      status: "succeeded",
      sessionId: "session-a",
      targetType: "session",
      targetId: "session-a",
      createdAt: 200,
    });
    service.append({
      id: "op-b",
      accountId: "account-b",
      actorType: "user",
      sourceType: "http",
      action: "update_session",
      status: "succeeded",
      sessionId: "session-b",
      targetType: "session",
      targetId: "session-b",
      createdAt: 100,
    });

    const result = service.list({ accountId: "account-a", limit: 20, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual(["op-a"]);
  });

  it("rolls back the business write when the operation log append fails in one transaction", () => {
    const service = new OperationLogService(database.db);

    expect(() => {
      database.db.transaction((tx) => {
        tx.insert(operationLogs).values({
          id: "existing-op",
          accountId: "account-a",
          actorType: "user",
          sourceType: "http",
          action: "seed",
          status: "succeeded",
          targetType: "test",
          createdAt: 1,
        }).run();
        new OperationLogService(tx).append({
          id: "existing-op",
          accountId: "account-a",
          actorType: "user",
          sourceType: "http",
          action: "duplicate",
          status: "succeeded",
          targetType: "test",
          createdAt: 2,
        });
      });
    }).toThrow();

    const rows = database.db.select().from(operationLogs).where(eq(operationLogs.accountId, "account-a")).all();
    expect(rows).toHaveLength(0);

    service.append({
      id: "after-rollback",
      accountId: "account-a",
      actorType: "system",
      sourceType: "system",
      action: "healthcheck",
      status: "succeeded",
      targetType: "operation_log",
      createdAt: 3,
    });
    expect(database.db.select().from(operationLogs).where(eq(operationLogs.id, "after-rollback")).all()).toHaveLength(1);
  });
});
