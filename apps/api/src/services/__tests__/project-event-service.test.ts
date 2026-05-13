import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  createTestSessionWithScope,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectEventService } from "../project-event-service.js";

const ACCOUNT_ID = "project-event-account";

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("ProjectEventService", () => {
  let database: DatabaseConnection;
  let service: ProjectEventService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new ProjectEventService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("allocates independent project sequences", () => {
    const firstProject = createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      id: "event-project-1",
      now: 1_700_000_000_000,
    });
    const secondProject = createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      id: "event-project-2",
      now: 1_700_000_000_000,
    });

    const first = service.append({
      workspaceId: firstProject.workspaceId,
      projectId: firstProject.projectId,
      type: "session.created",
      payload: { session_id: "sess-1" },
      createdAt: 1_700_000_000_100,
    });
    const second = service.append({
      workspaceId: firstProject.workspaceId,
      projectId: firstProject.projectId,
      type: "floor.committed",
      payload: { floor_id: "floor-1" },
      createdAt: 1_700_000_000_200,
    });
    const third = service.append({
      workspaceId: secondProject.workspaceId,
      projectId: secondProject.projectId,
      type: "session.created",
      payload: { session_id: "sess-2" },
      createdAt: 1_700_000_000_300,
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(third.sequence).toBe(1);
  });

  it("lists events by cursor, type, session and visibility", () => {
    const session = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT_ID,
      id: "event-session-1",
      now: 1_700_000_000_000,
    });
    service.appendMany([
      {
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        sessionId: session.sessionId,
        type: "session.created",
        visibility: "project",
        payload: { session_id: session.sessionId },
        createdAt: 1_700_000_000_100,
      },
      {
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        sessionId: session.sessionId,
        type: "floor.committed",
        visibility: "owner",
        payload: { floor_id: "floor-1" },
        createdAt: 1_700_000_000_200,
      },
      {
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        type: "floor.committed",
        visibility: "project",
        payload: { floor_id: "floor-2" },
        createdAt: 1_700_000_000_300,
      },
    ]);

    const projectOnly = service.list(session.projectId, {
      after: 0,
      visibilitySet: ["project"],
    });
    expect(projectOnly.items.map((event) => event.sequence)).toEqual([1, 3]);

    const ownerFloorEvents = service.list(session.projectId, {
      after: 1,
      types: ["floor.committed"],
      sessionId: session.sessionId,
      visibilitySet: ["project", "owner"],
    });
    expect(ownerFloorEvents.items.map((event) => event.sequence)).toEqual([2]);
    expect(ownerFloorEvents.nextAfter).toBe(2);
  });

  it("appendMany keeps input order and assigns contiguous sequences", () => {
    const project = createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      id: "event-project-append-many",
      now: 1_700_000_000_000,
    });

    const inputs = Array.from({ length: 5 }, (_, index) => ({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: index % 2 === 0 ? "floor.committed" : "variable.set",
      visibility: "project" as const,
      payload: { ordinal: index },
      createdAt: 1_700_000_000_100 + index,
    }));

    const records = service.appendMany(inputs);

    expect(records.map((record) => record.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(records.map((record) => (record.payload as { ordinal: number }).ordinal)).toEqual([
      0,
      1,
      2,
      3,
      4,
    ]);

    const persisted = service.list(project.projectId, {
      after: 0,
      visibilitySet: ["project"],
      limit: 10,
    });
    expect(persisted.items.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(persisted.items.map((item) => item.type)).toEqual([
      "floor.committed",
      "variable.set",
      "floor.committed",
      "variable.set",
      "floor.committed",
    ]);
  });

  it("rejects invalid workspace and non-serializable payload", () => {
    const project = createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      id: "event-project-invalid",
    });

    expect(captureError(() => service.append({
      workspaceId: "other-workspace",
      projectId: project.projectId,
      type: "session.created",
    }))).toMatchObject({ code: "project_event_workspace_mismatch" });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(captureError(() => service.append({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "session.created",
      payload: circular,
    }))).toMatchObject({ code: "project_event_payload_invalid" });
  });
});
