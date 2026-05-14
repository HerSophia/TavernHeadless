import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { operationLogs, projectEvents, projectInboxItems, sessions } from "../../db/schema.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectEventService } from "../project-event-service.js";
import { ProjectInboxService } from "../project-inbox-service.js";
import { ProjectMembershipService } from "../project-membership-service.js";

const OWNER_ACCOUNT_ID = "project-inbox-owner";
const DERIVER_ACCOUNT_ID = "project-inbox-deriver";
const SECOND_DERIVER_ACCOUNT_ID = "project-inbox-second-deriver";
const OBSERVER_ACCOUNT_ID = "project-inbox-observer";

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

function readJsonObject(value: string | null): Record<string, unknown> {
  expect(value).toEqual(expect.any(String));
  const parsed = JSON.parse(value ?? "{}");
  expect(parsed).toEqual(expect.any(Object));
  return parsed as Record<string, unknown>;
}

describe("ProjectInboxService", () => {
  let database: DatabaseConnection;
  let service: ProjectInboxService;
  let membershipService: ProjectMembershipService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new ProjectInboxService(database.db);
    membershipService = new ProjectMembershipService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates inbox items with small event and operation-log metadata", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-inbox-create",
    });
    const sourceEvent = new ProjectEventService(database.db).append({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "derived_output.created",
      payload: { derived_output_id: "dout_source" },
    });

    const item = service.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      type: "world.summary",
      title: "Summary",
      payload: { secret: "do-not-copy-full-payload" },
      sourceEventId: sourceEvent.id,
      now: 1_700_000_000_100,
    });

    expect(item.id).toMatch(/^pinbox_/);
    expect(item.status).toBe("pending");
    expect(item.payload).toEqual({ secret: "do-not-copy-full-payload" });

    const events = database.db.select().from(projectEvents).where(eq(projectEvents.projectId, project.projectId)).all();
    expect(events.map((event) => event.type)).toEqual(["derived_output.created", "project_inbox.item.created"]);
    const inboxEvent = events.find((event) => event.type === "project_inbox.item.created");
    expect(inboxEvent).toMatchObject({
      visibility: "project",
      source: "api",
      actorAccountId: OWNER_ACCOUNT_ID,
      causationEventId: sourceEvent.id,
    });
    const eventPayload = readJsonObject(inboxEvent!.payloadJson);
    expect(eventPayload).toMatchObject({
      inbox_item_id: item.id,
      type: "world.summary",
      title: "Summary",
      status: "pending",
      sender_account_id: OWNER_ACCOUNT_ID,
      source_event_id: sourceEvent.id,
    });
    expect(eventPayload).not.toHaveProperty("payload");
    expect(eventPayload).not.toHaveProperty("payload_json");
    expect(JSON.stringify(eventPayload)).not.toContain("do-not-copy-full-payload");

    const logs = database.db.select().from(operationLogs).where(eq(operationLogs.projectId, project.projectId)).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "project_inbox_item.create",
      targetType: "project_inbox_item",
      targetId: item.id,
      actorAccountId: OWNER_ACCOUNT_ID,
    });
    const metadata = readJsonObject(logs[0]!.metadataJson);
    expect(metadata.payload_byte_count).toEqual(expect.any(Number));
    expect(JSON.stringify(metadata)).not.toContain("do-not-copy-full-payload");
  });

  it("keeps deriver scoped to its own inbox items and denies observer reads", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-inbox-roles",
    });
    ensureTestAccount(database.db, DERIVER_ACCOUNT_ID);
    ensureTestAccount(database.db, SECOND_DERIVER_ACCOUNT_ID);
    ensureTestAccount(database.db, OBSERVER_ACCOUNT_ID);
    membershipService.addDeriver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: DERIVER_ACCOUNT_ID,
    });
    membershipService.addDeriver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: SECOND_DERIVER_ACCOUNT_ID,
    });
    membershipService.addObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
    });

    const ownerItem = service.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      type: "owner.item",
      payload: {},
    });
    const deriverItem = service.create({
      actorAccountId: DERIVER_ACCOUNT_ID,
      projectId: project.projectId,
      type: "deriver.item",
      payload: {},
    });
    service.create({
      actorAccountId: SECOND_DERIVER_ACCOUNT_ID,
      projectId: project.projectId,
      type: "second.item",
      payload: {},
    });

    expect(service.list({ actorAccountId: DERIVER_ACCOUNT_ID, projectId: project.projectId }).items.map((item) => item.id))
      .toEqual([deriverItem.id]);
    expect(service.list({
      actorAccountId: DERIVER_ACCOUNT_ID,
      projectId: project.projectId,
      senderAccountId: SECOND_DERIVER_ACCOUNT_ID,
    })).toEqual({ items: [], nextCursor: null });
    expect(captureError(() => service.getById({
      actorAccountId: DERIVER_ACCOUNT_ID,
      projectId: project.projectId,
      itemId: ownerItem.id,
    }))).toMatchObject({ statusCode: 404, code: "project_inbox_item_not_found" });
    expect(captureError(() => service.list({
      actorAccountId: OBSERVER_ACCOUNT_ID,
      projectId: project.projectId,
    }))).toMatchObject({ statusCode: 403, code: "project_inbox_read_denied" });
  });

  it("lets owner decide items without changing the main session", () => {
    const sourceSession = createTestSessionWithScope(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-inbox-source-session",
      now: 1_700_000_000_000,
    });
    const item = service.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: sourceSession.projectId,
      type: "session.proposal",
      payload: { proposed: true },
      sourceSessionId: sourceSession.sessionId,
      now: 1_700_000_000_100,
    });
    const beforeSession = database.db.select().from(sessions).where(eq(sessions.id, sourceSession.sessionId)).get();

    const accepted = service.decide({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: sourceSession.projectId,
      itemId: item.id,
      decision: "accept",
      note: "confirmed",
      now: 1_700_000_000_200,
    });
    const afterSession = database.db.select().from(sessions).where(eq(sessions.id, sourceSession.sessionId)).get();

    expect(accepted).toMatchObject({
      status: "accepted",
      decidedByAccountId: OWNER_ACCOUNT_ID,
      decidedAt: 1_700_000_000_200,
    });
    expect(afterSession).toEqual(beforeSession);

    const inboxEvents = database.db.select().from(projectEvents).where(eq(projectEvents.projectId, sourceSession.projectId)).all();
    expect(inboxEvents.map((event) => event.type)).toEqual([
      "project_inbox.item.created",
      "project_inbox.item.accepted",
    ]);
    const decisionPayload = readJsonObject(inboxEvents[1]!.payloadJson);
    expect(decisionPayload).toMatchObject({
      inbox_item_id: item.id,
      type: "session.proposal",
      status: "accepted",
      decision: "accept",
      decided_by_account_id: OWNER_ACCOUNT_ID,
    });
    expect(decisionPayload).not.toHaveProperty("payload");

    expect(captureError(() => service.decide({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: sourceSession.projectId,
      itemId: item.id,
      decision: "reject",
    }))).toMatchObject({ statusCode: 409, code: "project_inbox_invalid_transition" });
  });

  it("denies deriver decisions and rejects mismatched source events and oversized payloads", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-inbox-denied",
    });
    const otherProject = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project-inbox-other-project",
    });
    ensureTestAccount(database.db, DERIVER_ACCOUNT_ID);
    ensureTestAccount(database.db, OBSERVER_ACCOUNT_ID);
    membershipService.addDeriver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: DERIVER_ACCOUNT_ID,
    });
    membershipService.addObserver({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
    });

    const deriverItem = service.create({
      actorAccountId: DERIVER_ACCOUNT_ID,
      projectId: project.projectId,
      type: "deriver.proposal",
      payload: {},
    });
    expect(captureError(() => service.decide({
      actorAccountId: DERIVER_ACCOUNT_ID,
      projectId: project.projectId,
      itemId: deriverItem.id,
      decision: "archive",
    }))).toMatchObject({ statusCode: 403, code: "project_inbox_decide_denied" });

    expect(captureError(() => service.create({
      actorAccountId: OBSERVER_ACCOUNT_ID,
      projectId: project.projectId,
      type: "observer.proposal",
      payload: {},
    }))).toMatchObject({ statusCode: 403, code: "project_inbox_write_denied" });

    const foreignEvent = new ProjectEventService(database.db).append({
      workspaceId: otherProject.workspaceId,
      projectId: otherProject.projectId,
      type: "derived_output.created",
      payload: { derived_output_id: "dout_foreign" },
    });
    expect(captureError(() => service.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      type: "source.mismatch",
      sourceEventId: foreignEvent.id,
      payload: {},
    }))).toMatchObject({ statusCode: 409, code: "project_inbox_source_scope_mismatch" });

    const smallLimitService = new ProjectInboxService(database.db, { maxPayloadBytes: 16 });
    expect(captureError(() => smallLimitService.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      type: "size.test",
      payload: { text: "this value is too large" },
    }))).toMatchObject({ statusCode: 413, code: "project_inbox_payload_too_large" });

    expect(database.db.select().from(projectInboxItems).where(eq(projectInboxItems.id, deriverItem.id)).get()).toBeTruthy();
  });
});
