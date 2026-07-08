import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { projectMemberships, projects } from "../../db/schema.js";
import { OperationLogService } from "../operation-log-service.js";
import { ProjectEventService } from "../project-event-service.js";
import {
  ProjectLifecycleService,
  ProjectLifecycleServiceError,
} from "../project-lifecycle-service.js";
import {
  createTestProject,
  createTestWorkspace,
  ensureTestAccount,
  ensureTestDefaultWorkspace,
} from "../../__tests__/helpers/workspace-project.js";

const ACCOUNT_ID = "proj-lifecycle-account";
const ACTOR = { actorType: "account", actorAccountId: ACCOUNT_ID } as const;

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("ProjectLifecycleService", () => {
  let database: DatabaseConnection;
  let service: ProjectLifecycleService;
  let operationLog: OperationLogService;
  let projectEvents: ProjectEventService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new ProjectLifecycleService(database.db);
    operationLog = new OperationLogService(database.db);
    projectEvents = new ProjectEventService(database.db);
    ensureTestAccount(database.db, ACCOUNT_ID, 1_700_000_000_000);
    ensureTestDefaultWorkspace(database.db, ACCOUNT_ID, 1_700_000_000_000);
  });

  afterEach(() => {
    database.close();
  });

  it("creates a manual project with owner membership, audit and lifecycle event", () => {
    const created = service.create({
      actor: ACTOR,
      name: "  My Project  ",
      description: "  a project  ",
      settings: { model: "gpt" },
      now: 1_700_000_001_000,
    });

    expect(created.name).toBe("My Project");
    expect(created.description).toBe("a project");
    expect(created.kind).toBe("manual");
    expect(created.status).toBe("active");
    expect(created.archivedAt).toBeNull();
    expect(created.id.startsWith("proj_")).toBe(true);
    expect(JSON.parse(created.settingsOverrideJson)).toEqual({ model: "gpt" });

    const membership = database.db
      .select()
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.projectId, created.id),
          eq(projectMemberships.subjectType, "account"),
          eq(projectMemberships.subjectId, ACCOUNT_ID),
        ),
      )
      .get();
    expect(membership?.role).toBe("owner");
    expect(membership?.status).toBe("active");

    const logs = operationLog.list({ accountId: ACCOUNT_ID });
    const createLog = logs.rows.find((row) => row.action === "project.create");
    expect(createLog).toBeDefined();
    expect(createLog?.targetId).toBe(created.id);
    expect(createLog?.projectId).toBe(created.id);
    const metadata = createLog?.metadata as Record<string, unknown> | null;
    const summary = (metadata?.settings_summary ?? null) as Record<string, unknown> | null;
    expect(summary?.redacted).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain("gpt");

    const events = projectEvents.list(created.id);
    const createdEvent = events.items.find((event) => event.type === "project.lifecycle.created");
    expect(createdEvent).toBeDefined();
    expect(createdEvent?.operationLogId).toBe(createLog?.id);
  });

  it("rejects create with an empty name", () => {
    expect(captureError(() => service.create({ actor: ACTOR, name: "   " }))).toMatchObject({
      code: "project_name_required",
    });
  });

  it("maps workspace scope failures on create", () => {
    const missing = captureError(() =>
      service.create({ actor: ACTOR, name: "Scoped", workspaceId: "ws_missing" }),
    );
    expect(missing).toMatchObject({ code: "workspace_not_found", statusCode: 404 });

    const archived = createTestWorkspace(database.db, {
      accountId: ACCOUNT_ID,
      id: "ws_archived_lifecycle",
      status: "archived",
      now: 1_700_000_000_500,
    });
    const archivedError = captureError(() =>
      service.create({ actor: ACTOR, name: "Scoped", workspaceId: archived.workspaceId }),
    );
    expect(archivedError).toMatchObject({ code: "workspace_archived", statusCode: 409 });
  });

  it("updates fields and rejects empty updates", () => {
    const created = service.create({ actor: ACTOR, name: "Before", now: 1_700_000_002_000 });

    const updated = service.update({
      actor: ACTOR,
      id: created.id,
      name: "After",
      description: "updated",
      settings: { locale: "zh" },
      now: 1_700_000_003_000,
    });
    expect(updated.name).toBe("After");
    expect(updated.description).toBe("updated");
    expect(JSON.parse(updated.settingsOverrideJson)).toEqual({ locale: "zh" });

    const logs = operationLog.list({ accountId: ACCOUNT_ID });
    const updateLog = logs.rows.find((row) => row.action === "project.update");
    expect(updateLog).toBeDefined();
    const metadata = updateLog?.metadata as Record<string, unknown> | null;
    expect(metadata?.changed_fields).toEqual(["name", "description", "settings"]);

    expect(captureError(() => service.update({ actor: ACTOR, id: created.id }))).toMatchObject({
      code: "project_update_empty",
    });
  });

  it("refuses to archive the session_default project", () => {
    const scope = createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      id: "proj_session_default_guard",
      now: 1_700_000_000_500,
    });
    const error = captureError(() => service.archive({ actor: ACTOR, id: scope.projectId }));
    expect(error).toMatchObject({
      code: "project_session_default_immutable",
      statusCode: 409,
    });
  });

  it("archives and restores a manual project with lifecycle guards", () => {
    const created = service.create({ actor: ACTOR, name: "Lifecycle", now: 1_700_000_004_000 });

    const archived = service.archive({ actor: ACTOR, id: created.id, now: 1_700_000_005_000 });
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBe(1_700_000_005_000);

    const events = projectEvents.list(created.id);
    expect(events.items.some((event) => event.type === "project.lifecycle.archived")).toBe(true);

    const restored = service.restore({ actor: ACTOR, id: created.id, now: 1_700_000_006_000 });
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();

    expect(captureError(() => service.restore({ actor: ACTOR, id: created.id }))).toMatchObject({
      code: "project_not_archived",
      statusCode: 409,
    });

    const logs = operationLog.list({ accountId: ACCOUNT_ID });
    expect(logs.rows.some((row) => row.action === "project.archive")).toBe(true);
    expect(logs.rows.some((row) => row.action === "project.restore")).toBe(true);
  });

  it("duplicates only metadata into a new manual project", () => {
    const source = service.create({
      actor: ACTOR,
      name: "Original",
      description: "source",
      settings: { flag: true },
      now: 1_700_000_007_000,
    });

    const copy = service.duplicate({ actor: ACTOR, id: source.id, now: 1_700_000_008_000 });
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Original (\u526f\u672c)");
    expect(copy.description).toBe("source");
    expect(copy.kind).toBe("manual");
    expect(copy.status).toBe("active");
    expect(JSON.parse(copy.settingsOverrideJson)).toEqual({ flag: true });

    const membership = database.db
      .select()
      .from(projectMemberships)
      .where(and(eq(projectMemberships.projectId, copy.id), eq(projectMemberships.subjectId, ACCOUNT_ID)))
      .get();
    expect(membership?.role).toBe("owner");

    const logs = operationLog.list({ accountId: ACCOUNT_ID });
    const duplicateLog = logs.rows.find((row) => row.action === "project.duplicate");
    expect(duplicateLog).toBeDefined();
    const metadata = duplicateLog?.metadata as Record<string, unknown> | null;
    expect(metadata?.duplicated_from).toBe(source.id);

    const sourceRow = database.db.select().from(projects).where(eq(projects.id, source.id)).get();
    expect(sourceRow?.status).toBe("active");
  });

  it("throws ProjectLifecycleServiceError instances with status codes", () => {
    const error = captureError(() => service.create({ actor: ACTOR, name: "   " }));
    expect(error).toBeInstanceOf(ProjectLifecycleServiceError);
    expect((error as ProjectLifecycleServiceError).statusCode).toBe(400);
  });
});
