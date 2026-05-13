import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { projects } from "../../db/schema.js";
import { SessionScopeResolver } from "../session-scope-resolver.js";
import {
  createTestProject,
  ensureTestAccount,
  ensureTestDefaultWorkspace,
} from "../../__tests__/helpers/workspace-project.js";

const ACCOUNT_ID = "resolver-account";

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("SessionScopeResolver", () => {
  let database: DatabaseConnection;
  let resolver: SessionScopeResolver;

  beforeEach(() => {
    database = createDatabase(":memory:");
    resolver = new SessionScopeResolver(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates a default project when project_id is not provided", () => {
    ensureTestAccount(database.db, ACCOUNT_ID, 1_700_000_000_000);

    const resolved = resolver.resolveForCreate({
      accountId: ACCOUNT_ID,
      sessionId: "session-new",
      title: "New Session",
      now: 1_700_000_000_100,
    });

    expect(resolved.projectWasCreated).toBe(true);
    expect(resolved.accountId).toBe(ACCOUNT_ID);
    expect(resolved.workspaceId).toBe(`ws_default_${ACCOUNT_ID}`);

    const [project] = database.db.select().from(projects).where(eq(projects.id, resolved.projectId)).all();
    expect(project).toMatchObject({
      accountId: ACCOUNT_ID,
      workspaceId: resolved.workspaceId,
      kind: "session_default",
      name: "New Session",
    });
  });

  it("reuses a provided project and derives its workspace", () => {
    const { workspaceId } = ensureTestDefaultWorkspace(database.db, ACCOUNT_ID);
    const project = createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      workspaceId,
      id: "project-existing",
      name: "Existing Project",
    });

    const resolved = resolver.resolveForCreate({
      accountId: ACCOUNT_ID,
      projectId: project.projectId,
      sessionId: "session-existing",
      now: 1_700_000_000_200,
    });

    expect(resolved).toEqual({
      accountId: ACCOUNT_ID,
      workspaceId,
      projectId: project.projectId,
      projectWasCreated: false,
    });
  });

  it("rejects a project from another account", () => {
    ensureTestDefaultWorkspace(database.db, ACCOUNT_ID);
    const otherProject = createTestProject(database.db, {
      accountId: "other-account",
      id: "project-other",
    });

    expect(captureError(() => resolver.resolveForCreate({
      accountId: ACCOUNT_ID,
      projectId: otherProject.projectId,
      sessionId: "session-cross-account",
      now: 1_700_000_000_300,
    }))).toMatchObject({ code: "project_not_found" });
  });
});
