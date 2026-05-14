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
const DERIVER_ACCOUNT_ID = "project-deriver";
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

  it("adds, restores, lists and removes deriver members without changing observer roles", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-membership-deriver",
      now: 1_700_000_000_000,
    });
    ensureTestAccount(database.db, OBSERVER_ACCOUNT_ID, 1_700_000_000_001);
    ensureTestAccount(database.db, DERIVER_ACCOUNT_ID, 1_700_000_000_002);

    const first = membershipService.addDeriver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: DERIVER_ACCOUNT_ID,
      now: 1_700_000_000_100,
    });
    const second = membershipService.addDeriver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: DERIVER_ACCOUNT_ID,
      now: 1_700_000_000_200,
    });

    expect(first.role).toBe("deriver");
    expect(first.status).toBe("active");
    expect(second.id).toBe(first.id);

    const removed = membershipService.removeMember({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: DERIVER_ACCOUNT_ID,
      now: 1_700_000_000_300,
    });
    expect(removed).toMatchObject({ role: "deriver", status: "removed" });
    expect(captureError(() => accessService.requireProjectAction(DERIVER_ACCOUNT_ID, project.projectId, "project.read")))
      .toMatchObject({ code: "project_access_denied" });

    const restored = membershipService.addMember({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: DERIVER_ACCOUNT_ID,
      role: "deriver",
      now: 1_700_000_000_400,
    });
    expect(restored).toMatchObject({ id: first.id, role: "deriver", status: "active" });
    expect(accessService.requireProjectAction(DERIVER_ACCOUNT_ID, project.projectId, "project.inbox.write").role)
      .toBe("deriver");

    membershipService.addObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
      now: 1_700_000_000_500,
    });
    expect(captureError(() => membershipService.addMember({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
      role: "deriver",
    }))).toMatchObject({ code: "project_member_role_conflict" });
    expect(membershipService.listMembers(project.projectId).map((member) => [member.accountId, member.role, member.status])).toEqual([
      [OWNER_ACCOUNT_ID, "owner", "active"],
      [OBSERVER_ACCOUNT_ID, "observer", "active"],
      [DERIVER_ACCOUNT_ID, "deriver", "active"],
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

  it("rejects unsupported member roles and owner assignment", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-membership-role-reject",
    });
    ensureTestAccount(database.db, OTHER_ACCOUNT_ID);

    expect(captureError(() => membershipService.addMember({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OTHER_ACCOUNT_ID,
      role: "owner",
    }))).toMatchObject({ code: "project_member_role_not_supported" });

    expect(captureError(() => membershipService.removeMember({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OWNER_ACCOUNT_ID,
    }))).toMatchObject({ code: "project_member_owner_remove_not_supported" });
  });
});
