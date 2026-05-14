import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";

import { buildApp } from "../src/app";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import type { DatabaseConnection } from "../src/db/client.js";
import {
  operationLogs,
  projectEvents,
  sessions,
} from "../src/db/schema.js";
import {
  createTestProject,
  createTestSessionWithScope,
} from "../src/__tests__/helpers/workspace-project.js";
import type { ProjectEventLiveHub } from "../src/services/project-event-live-hub.js";
import type { ProjectEventRecord } from "../src/services/project-event-service.js";

type ItemResponse<T> = { data: T };
type ErrorResponse = { error: { code: string; message: string } };

type SessionResponse = {
  id: string;
  title: string | null;
  status: "active" | "archived";
};

function listProjectEvents(
  database: DatabaseConnection["db"],
  projectId: string,
): ProjectEventRecord[] {
  return database
    .select()
    .from(projectEvents)
    .where(eq(projectEvents.projectId, projectId))
    .orderBy(asc(projectEvents.sequence))
    .all()
    .map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      sequence: row.sequence,
      type: row.type,
      visibility: row.visibility,
      source: row.source,
      actorAccountId: row.actorAccountId,
      sessionId: row.sessionId,
      branchId: row.branchId,
      floorId: row.floorId,
      pageId: row.pageId,
      messageId: row.messageId,
      operationLogId: row.operationLogId,
      correlationId: row.correlationId,
      causationEventId: row.causationEventId,
      payload: JSON.parse(row.payloadJson),
      createdAt: row.createdAt,
    }));
}

function payloadOf(event: ProjectEventRecord): Record<string, unknown> {
  expect(event.payload).toEqual(expect.any(Object));
  return event.payload as Record<string, unknown>;
}

describe("Project events from business write routes", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];
  let projectEventLiveHub: ProjectEventLiveHub;

  beforeEach(async () => {
    const built = await buildApp({
      databasePath: ":memory:",
      logger: false,
    });
    app = built.app;
    database = built.database;
    projectEventLiveHub = built.projectEventLiveHub;
  });

  afterEach(async () => {
    await app.close();
  });

  it("writes and publishes session.created from POST /sessions", async () => {
    const project = createTestProject(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "project_route_session_created",
    });
    const published: ProjectEventRecord[] = [];
    const unsubscribe = projectEventLiveHub.subscribe(project.projectId, (event) => {
      published.push(event);
    });

    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        title: "Project Event Session",
        project_id: project.projectId,
      },
    });
    unsubscribe();

    expect(response.statusCode, response.body).toBe(201);
    const created = response.json<ItemResponse<SessionResponse>>().data;
    const events = listProjectEvents(database, project.projectId);

    expect(events).toHaveLength(1);
    expect(published.map((event) => event.id)).toEqual(events.map((event) => event.id));
    expect(events[0]).toMatchObject({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      sequence: 1,
      type: "session.created",
      visibility: "project",
      source: "api",
      actorAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: created.id,
      branchId: "main",
    });
    expect(payloadOf(events[0]!)).toMatchObject({
      session_id: created.id,
      title: "Project Event Session",
      status: "active",
      project_was_created: false,
    });

    const operationLogId = events[0]!.operationLogId;
    expect(operationLogId).toEqual(expect.any(String));
    const operation = database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.id, operationLogId!))
      .get();
    expect(operation).toMatchObject({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      actorAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: created.id,
      branchId: "main",
      action: "create_session",
    });
  });

  it("writes and publishes session.updated and session.archived from single and batch status updates", async () => {
    const project = createTestProject(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "project_route_session_archived",
    });
    const first = createTestSessionWithScope(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "sess_route_archive_first",
      projectId: project.projectId,
      title: "First",
    });
    const second = createTestSessionWithScope(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "sess_route_archive_second",
      projectId: project.projectId,
      title: "Second",
    });
    const alreadyArchived = createTestSessionWithScope(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "sess_route_archive_existing",
      projectId: project.projectId,
      title: "Already Archived",
      values: { status: "archived" },
    });

    const published: ProjectEventRecord[] = [];
    const unsubscribe = projectEventLiveHub.subscribe(project.projectId, (event) => {
      published.push(event);
    });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/sessions/${first.sessionId}`,
      payload: {
        title: "First Archived",
        status: "archived",
      },
    });
    expect(patchResponse.statusCode, patchResponse.body).toBe(200);

    const batchResponse = await app.inject({
      method: "PATCH",
      url: "/sessions/batch/status",
      payload: {
        ids: [second.sessionId, alreadyArchived.sessionId, "missing-session"],
        status: "archived",
      },
    });
    unsubscribe();

    expect(batchResponse.statusCode, batchResponse.body).toBe(200);
    expect(batchResponse.json<ItemResponse<{ meta: { updated: number; not_found: number } }>>().data.meta)
      .toMatchObject({ updated: 2, not_found: 1 });

    const events = listProjectEvents(database, project.projectId);
    expect(events.map((event) => event.type)).toEqual([
      "session.updated",
      "session.archived",
      "session.updated",
      "session.archived",
      "session.updated",
    ]);
    expect(published.map((event) => event.id)).toEqual(events.map((event) => event.id));

    const [patchUpdated, patchArchived, batchSecondUpdated, batchSecondArchived, batchExistingUpdated] = events;
    expect(payloadOf(patchUpdated!)).toMatchObject({
      session_id: first.sessionId,
      changed_fields: ["status", "title"],
      status_changed_to: "archived",
    });
    expect(payloadOf(patchArchived!)).toEqual({ session_id: first.sessionId });
    expect(patchArchived!.operationLogId).toBe(patchUpdated!.operationLogId);

    expect(payloadOf(batchSecondUpdated!)).toMatchObject({
      session_id: second.sessionId,
      changed_fields: ["status"],
      status: "archived",
      status_changed_to: "archived",
    });
    expect(payloadOf(batchSecondArchived!)).toEqual({ session_id: second.sessionId });
    expect(batchSecondArchived!.operationLogId).toBe(batchSecondUpdated!.operationLogId);

    expect(payloadOf(batchExistingUpdated!)).toMatchObject({
      session_id: alreadyArchived.sessionId,
      changed_fields: ["status"],
      status: "archived",
    });
    expect(payloadOf(batchExistingUpdated!)).not.toHaveProperty("status_changed_to");

    const scopedOperations = database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.projectId, project.projectId))
      .orderBy(asc(operationLogs.createdAt))
      .all();
    expect(scopedOperations.map((operation) => operation.action)).toEqual([
      "update_session",
      "batch_update_session_status",
      "batch_update_session_status",
    ]);
    expect(scopedOperations.every((operation) => operation.workspaceId === project.workspaceId)).toBe(true);
  });

  it("writes and publishes phase-three derived output and inbox events without full JSON bodies", async () => {
    const project = createTestProject(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "project_route_phase_three_events",
    });
    const published: ProjectEventRecord[] = [];
    const unsubscribe = projectEventLiveHub.subscribe(project.projectId, (event) => {
      published.push(event);
    });

    const derivedResponse = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/derived-outputs`,
      payload: {
        domain: "event.regression",
        value: { secret: "derived-event-secret" },
      },
    });
    expect(derivedResponse.statusCode, derivedResponse.body).toBe(201);
    const derived = derivedResponse.json<{ item: { id: string } }>().item;

    const inboxResponse = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/inbox`,
      payload: {
        type: "event.regression",
        payload: { secret: "inbox-event-secret" },
      },
    });
    expect(inboxResponse.statusCode, inboxResponse.body).toBe(201);
    const inbox = inboxResponse.json<{ item: { id: string } }>().item;
    unsubscribe();

    const events = listProjectEvents(database, project.projectId);
    expect(events.map((event) => event.type)).toEqual([
      "derived_output.created",
      "project_inbox.item.created",
    ]);
    expect(published.map((event) => event.id)).toEqual(events.map((event) => event.id));
    expect(events.every((event) => event.visibility === "project" && event.source === "api")).toBe(true);

    expect(payloadOf(events[0]!)).toMatchObject({
      derived_output_id: derived.id,
      domain: "event.regression",
      status: "draft",
    });
    expect(payloadOf(events[1]!)).toMatchObject({
      inbox_item_id: inbox.id,
      type: "event.regression",
      status: "pending",
    });
    expect(JSON.stringify(events.map((event) => event.payload))).not.toContain("derived-event-secret");
    expect(JSON.stringify(events.map((event) => event.payload))).not.toContain("inbox-event-secret");
    expect(events.map((event) => event.operationLogId)).toEqual(expect.arrayContaining([
      expect.any(String),
      expect.any(String),
    ]));

    const scopedOperations = database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.projectId, project.projectId))
      .orderBy(asc(operationLogs.createdAt))
      .all();
    expect(scopedOperations.map((operation) => operation.action)).toEqual([
      "derived_output.create",
      "project_inbox_item.create",
    ]);
    expect(JSON.stringify(scopedOperations)).not.toContain("event-secret");
  });

  it("rolls back session updates and project events when durable event append fails", async () => {
    const project = createTestProject(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "project_route_archived_rollback",
      status: "archived",
    });
    const session = createTestSessionWithScope(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "sess_route_archived_rollback",
      projectId: project.projectId,
      title: "Before rollback",
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.sessionId}`,
      payload: { title: "After rollback" },
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<ErrorResponse>().error.code).toBe("project_archived");

    const storedSession = database
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.sessionId))
      .get();
    expect(storedSession).toMatchObject({ title: "Before rollback" });
    expect(listProjectEvents(database, project.projectId)).toEqual([]);

    const scopedOperations = database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.projectId, project.projectId))
      .all();
    expect(scopedOperations).toEqual([]);
  });
});
