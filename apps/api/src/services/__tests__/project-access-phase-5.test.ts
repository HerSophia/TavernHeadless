import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectAccessService } from "../project-access-service.js";
import { ProjectMembershipService } from "../project-membership-service.js";

const OWNER = "phase5-access-owner";
const OBSERVER = "phase5-access-observer";
const DERIVER = "phase5-access-deriver";

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("ProjectAccessService phase 5 actions", () => {
  let database: DatabaseConnection;
  let accessService: ProjectAccessService;
  let membershipService: ProjectMembershipService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, OWNER);
    ensureTestAccount(database.db, OBSERVER);
    ensureTestAccount(database.db, DERIVER);
    accessService = new ProjectAccessService(database.db);
    membershipService = new ProjectMembershipService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("allows owner all phase 5 actions and keeps observer/deriver read-only for agent/config", () => {
    const project = createTestProject(database.db, { accountId: OWNER, id: "proj-phase5-access" });
    membershipService.addObserver({ actorAccountId: OWNER, projectId: project.projectId, accountId: OBSERVER });
    membershipService.addDeriver({ actorAccountId: OWNER, projectId: project.projectId, accountId: DERIVER });

    expect(accessService.requireProjectAction(OWNER, project.projectId, "project.agent.read").role).toBe("owner");
    expect(accessService.requireProjectAction(OWNER, project.projectId, "project.agent.manage").role).toBe("owner");
    expect(accessService.requireProjectAction(OWNER, project.projectId, "project.agent.run").role).toBe("owner");
    expect(accessService.requireProjectAction(OWNER, project.projectId, "project.config.read").role).toBe("owner");
    expect(accessService.requireProjectAction(OWNER, project.projectId, "project.config.write").role).toBe("owner");

    expect(accessService.requireProjectAction(OBSERVER, project.projectId, "project.agent.read").role).toBe("observer");
    expect(accessService.requireProjectAction(OBSERVER, project.projectId, "project.config.read").role).toBe("observer");
    expect(captureError(() => accessService.requireProjectAction(OBSERVER, project.projectId, "project.agent.manage")))
      .toMatchObject({ code: "project_access_denied", denyReason: "role_forbidden" });
    expect(captureError(() => accessService.requireProjectAction(OBSERVER, project.projectId, "project.agent.run")))
      .toMatchObject({ code: "project_access_denied", denyReason: "role_forbidden" });
    expect(captureError(() => accessService.requireProjectAction(OBSERVER, project.projectId, "project.config.write")))
      .toMatchObject({ code: "project_access_denied", denyReason: "role_forbidden" });

    expect(accessService.requireProjectAction(DERIVER, project.projectId, "project.agent.read").role).toBe("deriver");
    expect(accessService.requireProjectAction(DERIVER, project.projectId, "project.config.read").role).toBe("deriver");
    expect(captureError(() => accessService.requireProjectAction(DERIVER, project.projectId, "project.agent.manage")))
      .toMatchObject({ code: "project_access_denied", denyReason: "role_forbidden" });
    expect(captureError(() => accessService.requireProjectAction(DERIVER, project.projectId, "project.agent.run")))
      .toMatchObject({ code: "project_access_denied", denyReason: "role_forbidden" });
    expect(captureError(() => accessService.requireProjectAction(DERIVER, project.projectId, "project.config.write")))
      .toMatchObject({ code: "project_access_denied", denyReason: "role_forbidden" });
  });
});
