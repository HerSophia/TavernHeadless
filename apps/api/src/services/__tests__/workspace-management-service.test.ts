import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { OperationLogService } from "../operation-log-service.js";
import {
  WorkspaceManagementService,
  WorkspaceManagementServiceError,
} from "../workspace-management-service.js";
import { ensureTestAccount, ensureTestDefaultWorkspace } from "../../__tests__/helpers/workspace-project.js";

const ACCOUNT_ID = "ws-mgmt-account";
const ACTOR = { actorType: "account", actorId: ACCOUNT_ID } as const;

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("WorkspaceManagementService", () => {
  let database: DatabaseConnection;
  let service: WorkspaceManagementService;
  let operationLog: OperationLogService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new WorkspaceManagementService(database.db);
    operationLog = new OperationLogService(database.db);
    ensureTestAccount(database.db, ACCOUNT_ID, 1_700_000_000_000);
  });

  afterEach(() => {
    database.close();
  });

  it("creates a manual workspace and writes a create audit", () => {
    const created = service.create({
      accountId: ACCOUNT_ID,
      name: "  Team Space  ",
      settings: { theme: "dark" },
      actor: ACTOR,
      now: 1_700_000_001_000,
    });

    expect(created.name).toBe("Team Space");
    expect(created.kind).toBe("manual");
    expect(created.isDefault).toBe(false);
    expect(created.status).toBe("active");
    expect(created.archivedAt).toBeNull();

    const logs = operationLog.list({ accountId: ACCOUNT_ID });
    const createLog = logs.rows.find((row) => row.action === "workspace.create");
    expect(createLog).toBeDefined();
    expect(createLog?.targetId).toBe(created.id);
    expect(createLog?.workspaceId).toBe(created.id);
    // settings are redacted to a hash-only summary in the audit metadata.
    const metadata = createLog?.metadata as Record<string, unknown> | null;
    const summary = (metadata?.settings_summary ?? null) as Record<string, unknown> | null;
    expect(summary?.redacted).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain("dark");
  });

  it("throws when creating with an empty name", () => {
    expect(captureError(() => service.create({ accountId: ACCOUNT_ID, name: "   " }))).toMatchObject({
      code: "workspace_name_required",
    });
  });

  it("lists workspaces, excluding archived by default and honouring the status filter", () => {
    ensureTestDefaultWorkspace(database.db, ACCOUNT_ID, 1_700_000_000_500);
    const manual = service.create({ accountId: ACCOUNT_ID, name: "Manual", actor: ACTOR, now: 1_700_000_002_000 });
    service.archive({ accountId: ACCOUNT_ID, id: manual.id, actor: ACTOR, now: 1_700_000_003_000 });

    const active = service.list({ accountId: ACCOUNT_ID });
    expect(active.every((row) => row.status === "active")).toBe(true);
    expect(active.some((row) => row.isDefault)).toBe(true);
    expect(active.some((row) => row.id === manual.id)).toBe(false);

    const archived = service.list({ accountId: ACCOUNT_ID, status: "archived" });
    expect(archived.map((row) => row.id)).toEqual([manual.id]);

    const all = service.list({ accountId: ACCOUNT_ID, includeArchived: true });
    expect(all.some((row) => row.id === manual.id)).toBe(true);
    expect(all.some((row) => row.isDefault)).toBe(true);
  });

  it("gets a workspace by id and isolates by account", () => {
    const created = service.create({ accountId: ACCOUNT_ID, name: "Owned", actor: ACTOR });
    expect(service.getById({ accountId: ACCOUNT_ID, id: created.id }).id).toBe(created.id);

    ensureTestAccount(database.db, "other-account");
    expect(captureError(() => service.getById({ accountId: "other-account", id: created.id }))).toMatchObject({
      code: "workspace_not_found",
    });
  });

  it("updates name and settings and rejects empty updates", () => {
    const created = service.create({ accountId: ACCOUNT_ID, name: "Before", actor: ACTOR });

    const updated = service.update({
      accountId: ACCOUNT_ID,
      id: created.id,
      name: "After",
      settings: { locale: "zh" },
      actor: ACTOR,
      now: 1_700_000_004_000,
    });
    expect(updated.name).toBe("After");
    expect(JSON.parse(updated.settingsJson)).toEqual({ locale: "zh" });

    const logs = operationLog.list({ accountId: ACCOUNT_ID });
    expect(logs.rows.some((row) => row.action === "workspace.update")).toBe(true);

    expect(captureError(() => service.update({ accountId: ACCOUNT_ID, id: created.id }))).toMatchObject({
      code: "workspace_update_empty",
    });
  });

  it("refuses to archive the default workspace", () => {
    const { workspaceId } = ensureTestDefaultWorkspace(database.db, ACCOUNT_ID, 1_700_000_000_500);
    expect(captureError(() => service.archive({ accountId: ACCOUNT_ID, id: workspaceId, actor: ACTOR }))).toMatchObject({
      code: "workspace_default_immutable",
    });
  });

  it("archives and restores a manual workspace with lifecycle guards", () => {
    const created = service.create({ accountId: ACCOUNT_ID, name: "Lifecycle", actor: ACTOR });

    const archived = service.archive({ accountId: ACCOUNT_ID, id: created.id, actor: ACTOR, now: 1_700_000_005_000 });
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBe(1_700_000_005_000);

    expect(captureError(() => service.archive({ accountId: ACCOUNT_ID, id: created.id, actor: ACTOR }))).toMatchObject({
      code: "workspace_already_archived",
    });

    const restored = service.restore({ accountId: ACCOUNT_ID, id: created.id, actor: ACTOR, now: 1_700_000_006_000 });
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();

    expect(captureError(() => service.restore({ accountId: ACCOUNT_ID, id: created.id, actor: ACTOR }))).toMatchObject({
      code: "workspace_not_archived",
    });

    const logs = operationLog.list({ accountId: ACCOUNT_ID });
    expect(logs.rows.some((row) => row.action === "workspace.archive")).toBe(true);
    expect(logs.rows.some((row) => row.action === "workspace.restore")).toBe(true);
  });

  it("throws WorkspaceManagementServiceError instances with status codes", () => {
    const error = captureError(() => service.getById({ accountId: ACCOUNT_ID, id: "missing" }));
    expect(error).toBeInstanceOf(WorkspaceManagementServiceError);
    expect((error as WorkspaceManagementServiceError).statusCode).toBe(404);
  });
});
