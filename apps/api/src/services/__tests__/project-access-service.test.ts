import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectAccessService } from "../project-access-service.js";
import { ProjectMembershipService } from "../project-membership-service.js";

const OWNER_ACCOUNT_ID = "access-owner";
const OBSERVER_ACCOUNT_ID = "access-observer";
const DERIVER_ACCOUNT_ID = "access-deriver";
const OTHER_ACCOUNT_ID = "access-other";

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("ProjectAccessService", () => {
  let database: DatabaseConnection;
  let accessService: ProjectAccessService;
  let membershipService: ProjectMembershipService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    accessService = new ProjectAccessService(database.db);
    membershipService = new ProjectMembershipService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("allows owner to perform all phase-two project actions", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "access-project-owner",
    });

    expect(accessService.requireProjectAction(OWNER_ACCOUNT_ID, project.projectId, "project.read").role).toBe("owner");
    expect(accessService.requireProjectAction(OWNER_ACCOUNT_ID, project.projectId, "project.observe").role).toBe("owner");
    expect(accessService.requireProjectAction(OWNER_ACCOUNT_ID, project.projectId, "project.write").role).toBe("owner");
    expect(accessService.requireProjectAction(OWNER_ACCOUNT_ID, project.projectId, "project.manage_members").role).toBe("owner");
  });

  it("applies the phase-three owner observer deriver action matrix", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "access-project-phase-three",
    });
    ensureTestAccount(database.db, OBSERVER_ACCOUNT_ID);
    ensureTestAccount(database.db, DERIVER_ACCOUNT_ID);
    membershipService.addObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
    });
    membershipService.addDeriver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: DERIVER_ACCOUNT_ID,
    });

    expect(accessService.requireProjectAction(OWNER_ACCOUNT_ID, project.projectId, "project.derived_output.write").role)
      .toBe("owner");
    expect(accessService.requireProjectAction(OWNER_ACCOUNT_ID, project.projectId, "project.inbox.decide").role)
      .toBe("owner");
    expect(accessService.requireProjectAction(OBSERVER_ACCOUNT_ID, project.projectId, "project.derived_output.read").role)
      .toBe("observer");
    expect(captureError(() => accessService.requireProjectAction(OBSERVER_ACCOUNT_ID, project.projectId, "project.derived_output.write")))
      .toMatchObject({ code: "project_access_denied", denyReason: "role_forbidden" });
    expect(captureError(() => accessService.requireProjectAction(OBSERVER_ACCOUNT_ID, project.projectId, "project.inbox.read")))
      .toMatchObject({ code: "project_access_denied", denyReason: "role_forbidden" });
    expect(accessService.requireProjectAction(DERIVER_ACCOUNT_ID, project.projectId, "project.derived_output.write").role)
      .toBe("deriver");
    expect(accessService.requireProjectAction(DERIVER_ACCOUNT_ID, project.projectId, "project.inbox.read").role)
      .toBe("deriver");
    expect(captureError(() => accessService.requireProjectAction(DERIVER_ACCOUNT_ID, project.projectId, "project.manage_members")))
      .toMatchObject({ code: "project_access_denied", denyReason: "role_forbidden" });
  });

  it("allows observer to read and observe but denies write", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "access-project-observer",
    });
    ensureTestAccount(database.db, OBSERVER_ACCOUNT_ID);
    membershipService.addObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
    });

    expect(accessService.requireProjectAction(OBSERVER_ACCOUNT_ID, project.projectId, "project.read").role).toBe("observer");
    expect(accessService.requireProjectAction(OBSERVER_ACCOUNT_ID, project.projectId, "project.observe").role).toBe("observer");
    expect(captureError(() => accessService.requireProjectAction(OBSERVER_ACCOUNT_ID, project.projectId, "project.write")))
      .toMatchObject({ code: "project_access_denied" });
  });

  it("resolves access by session id", () => {
    const session = createTestSessionWithScope(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "access-session-1",
    });
    ensureTestAccount(database.db, OBSERVER_ACCOUNT_ID);
    membershipService.addObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: session.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
    });

    expect(accessService.requireProjectActionBySessionId(OBSERVER_ACCOUNT_ID, session.sessionId, "project.read").role)
      .toBe("observer");
    expect(captureError(() => accessService.requireProjectActionBySessionId(OBSERVER_ACCOUNT_ID, session.sessionId, "project.write")))
      .toMatchObject({ code: "project_access_denied" });
  });

  it("denies non-members and archived projects", () => {
    const activeProject = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "access-project-active",
    });
    createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "access-project-archived",
      status: "archived",
    });
    ensureTestAccount(database.db, OTHER_ACCOUNT_ID);

    expect(captureError(() => accessService.requireProjectAction(OTHER_ACCOUNT_ID, activeProject.projectId, "project.read")))
      .toMatchObject({ code: "project_access_denied" });
    expect(captureError(() => accessService.requireProjectAction(OWNER_ACCOUNT_ID, "access-project-archived", "project.read")))
      .toMatchObject({ code: "project_archived" });
  });
});
