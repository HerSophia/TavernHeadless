import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { workspaces } from "../../db/schema.js";
import {
  WorkspaceScopeService,
  buildDefaultWorkspaceId,
} from "../workspace-scope-service.js";
import { ensureTestAccount, createTestWorkspace } from "../../__tests__/helpers/workspace-project.js";

const ACCOUNT_ID = "scope-account";

function countDefaultWorkspaces(database: DatabaseConnection, accountId: string): number {
  const row = database.db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.accountId, accountId))
    .all();
  return row.length;
}

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}


describe("WorkspaceScopeService", () => {
  let database: DatabaseConnection;
  let service: WorkspaceScopeService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new WorkspaceScopeService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates the default workspace for an account and keeps repeated calls idempotent", () => {
    ensureTestAccount(database.db, ACCOUNT_ID, 1_700_000_000_000);

    const first = service.ensureDefaultWorkspace(ACCOUNT_ID, 1_700_000_000_100);
    const second = service.ensureDefaultWorkspace(ACCOUNT_ID, 1_700_000_000_200);

    expect(first.id).toBe(buildDefaultWorkspaceId(ACCOUNT_ID));
    expect(second.id).toBe(first.id);
    expect(first.accountId).toBe(ACCOUNT_ID);
    expect(countDefaultWorkspaces(database, ACCOUNT_ID)).toBe(1);
  });

  it("throws account_not_found when the account does not exist", () => {
    expect(captureError(() => service.ensureDefaultWorkspace("missing-account"))).toMatchObject({
      code: "account_not_found",
    });
  });

  it("requires workspace account ownership and active status", () => {
    createTestWorkspace(database.db, { accountId: ACCOUNT_ID, id: "ws-active", isDefault: false });
    createTestWorkspace(database.db, { accountId: ACCOUNT_ID, id: "ws-archived", isDefault: false, status: "archived" });
    ensureTestAccount(database.db, "other-account");

    expect(service.requireWorkspaceForAccount(ACCOUNT_ID, "ws-active").id).toBe("ws-active");
    expect(captureError(() => service.requireWorkspaceForAccount("other-account", "ws-active"))).toMatchObject({
      code: "workspace_not_found",
    });
    expect(captureError(() => service.requireWorkspaceForAccount(ACCOUNT_ID, "ws-archived"))).toMatchObject({
      code: "workspace_archived",
    });
  });
});
