import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { projects } from "../../db/schema.js";
import {
  ProjectScopeService,
  buildSessionDefaultProjectName,
} from "../project-scope-service.js";
import {
  createTestProject,
  createTestWorkspace,
  ensureTestAccount,
  ensureTestDefaultWorkspace,
} from "../../__tests__/helpers/workspace-project.js";

const ACCOUNT_ID = "project-account";

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("ProjectScopeService", () => {
  let database: DatabaseConnection;
  let service: ProjectScopeService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new ProjectScopeService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates a session_default project in the requested workspace", () => {
    const { workspaceId } = ensureTestDefaultWorkspace(database.db, ACCOUNT_ID, 1_700_000_000_000);

    const project = service.createSessionDefaultProject({
      accountId: ACCOUNT_ID,
      workspaceId,
      sessionId: "session-1",
      sessionTitle: "  Session Project  ",
      now: 1_700_000_000_100,
    });

    expect(project.accountId).toBe(ACCOUNT_ID);
    expect(project.workspaceId).toBe(workspaceId);
    expect(project.kind).toBe("session_default");
    expect(project.name).toBe("Session Project");

    const rows = database.db.select().from(projects).where(eq(projects.id, project.id)).all();
    expect(rows).toHaveLength(1);
  });

  it("uses a stable fallback name when the session title is empty", () => {
    expect(buildSessionDefaultProjectName("  ", "sess-1")).toBe("默认项目 - sess-1");
  });

  it("rejects cross-account and archived projects", () => {
    const { workspaceId } = ensureTestDefaultWorkspace(database.db, ACCOUNT_ID);
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, workspaceId, id: "project-owned" });
    createTestProject(database.db, { accountId: ACCOUNT_ID, workspaceId, id: "project-archived", status: "archived" });
    ensureTestAccount(database.db, "other-account");

    expect(service.requireProjectForAccount(ACCOUNT_ID, project.projectId).id).toBe("project-owned");
    expect(captureError(() => service.requireProjectForAccount("other-account", project.projectId))).toMatchObject({
      code: "project_not_found",
    });
    expect(captureError(() => service.requireProjectForAccount(ACCOUNT_ID, "project-archived"))).toMatchObject({
      code: "project_archived",
    });
  });

  it("rejects projects whose workspace is unavailable", () => {
    createTestWorkspace(database.db, { accountId: ACCOUNT_ID, id: "ws-archived", isDefault: false, status: "archived" });
    createTestProject(database.db, { accountId: ACCOUNT_ID, workspaceId: "ws-archived", id: "project-archived-ws" });

    expect(captureError(() => service.requireProjectForAccount(ACCOUNT_ID, "project-archived-ws"))).toMatchObject({
      code: "workspace_archived",
    });
  });
});
