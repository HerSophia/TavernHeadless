import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { projectMemberships } from "../../db/schema.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectAccessService } from "../project-access-service.js";
import { ProjectMembershipService } from "../project-membership-service.js";

const OWNER_ACCOUNT_ID = "project-owner";
const OBSERVER_ACCOUNT_ID = "project-observer";
const OTHER_ACCOUNT_ID = "project-other";

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("ProjectMembershipService", () => {
  let database: DatabaseConnection;
  let membershipService: ProjectMembershipService;
  let accessService: ProjectAccessService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    membershipService = new ProjectMembershipService(database.db);
    accessService = new ProjectAccessService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("keeps owner membership and adds observer idempotently", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-membership-1",
      now: 1_700_000_000_000,
    });
    ensureTestAccount(database.db, OBSERVER_ACCOUNT_ID, 1_700_000_000_001);

    const first = membershipService.addObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
      now: 1_700_000_000_100,
    });
    const second = membershipService.addObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
      now: 1_700_000_000_200,
    });

    expect(first.role).toBe("observer");
    expect(first.status).toBe("active");
    expect(second.id).toBe(first.id);

    const members = membershipService.listMembers(project.projectId);
    expect(members.map((member) => [member.accountId, member.role, member.status])).toEqual([
      [OWNER_ACCOUNT_ID, "owner", "active"],
      [OBSERVER_ACCOUNT_ID, "observer", "active"],
    ]);
  });

  it("removes observer without deleting owner membership", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-membership-2",
      now: 1_700_000_000_000,
    });
    ensureTestAccount(database.db, OBSERVER_ACCOUNT_ID, 1_700_000_000_001);
    membershipService.addObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
      now: 1_700_000_000_100,
    });

    const removed = membershipService.removeObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
      now: 1_700_000_000_200,
    });

    expect(removed.status).toBe("removed");
    expect(captureError(() => accessService.requireProjectAction(OBSERVER_ACCOUNT_ID, project.projectId, "project.read")))
      .toMatchObject({ code: "project_access_denied" });

    const rows = database.db.select().from(projectMemberships).all();
    expect(rows.some((row) => row.accountId === OWNER_ACCOUNT_ID && row.status === "active")).toBe(true);
  });

  it("rejects observer management by non-owner and owner removal", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-membership-3",
    });
    ensureTestAccount(database.db, OBSERVER_ACCOUNT_ID);
    ensureTestAccount(database.db, OTHER_ACCOUNT_ID);

    expect(captureError(() => membershipService.addObserver({
      actorAccountId: OTHER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
    }))).toMatchObject({ code: "project_access_denied" });

    expect(captureError(() => membershipService.removeObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OWNER_ACCOUNT_ID,
    }))).toMatchObject({ code: "project_member_owner_remove_not_supported" });
  });
});
