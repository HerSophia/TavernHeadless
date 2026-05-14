import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { derivedOutputs, operationLogs, projectEvents } from "../../db/schema.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectEventLiveHub } from "../project-event-live-hub.js";
import type { ProjectEventRecord } from "../project-event-service.js";
import { DerivedOutputService } from "../derived-output-service.js";
import { ProjectMembershipService } from "../project-membership-service.js";

const OWNER_ACCOUNT_ID = "derived-output-owner";
const DERIVER_ACCOUNT_ID = "derived-output-deriver";
const OBSERVER_ACCOUNT_ID = "derived-output-observer";

class ThrowingProjectEventLiveHub extends ProjectEventLiveHub {
  override publish(_event: ProjectEventRecord): void {
    throw new Error("publish failed");
  }
}

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

describe("DerivedOutputService", () => {
  let database: DatabaseConnection;
  let service: DerivedOutputService;
  let membershipService: ProjectMembershipService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new DerivedOutputService(database.db);
    membershipService = new ProjectMembershipService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates derived output with operation log, durable event, and post-commit live publish", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "derived-output-project-create",
      now: 1_700_000_000_000,
    });
    const liveHub = new ProjectEventLiveHub();
    const published: ProjectEventRecord[] = [];
    liveHub.subscribe(project.projectId, (event) => {
      published.push(event);
      const payload = event.payload as { derived_output_id?: string };
      expect(database.db.select().from(projectEvents).where(eq(projectEvents.id, event.id)).get()).toBeTruthy();
      expect(database.db.select().from(derivedOutputs).where(eq(derivedOutputs.id, payload.derived_output_id ?? "")).get()).toBeTruthy();
    });
    const publishingService = new DerivedOutputService(database.db, { projectEventLiveHub: liveHub });

    const record = publishingService.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      domain: "analysis.summary",
      value: { summary: "do-not-copy-full-value" },
      status: "published",
      now: 1_700_000_000_100,
    });

    expect(record.id).toMatch(/^dout_/);
    expect(record.status).toBe("published");
    expect(record.value).toEqual({ summary: "do-not-copy-full-value" });
    expect(published).toHaveLength(1);

    const eventRows = database.db.select().from(projectEvents).where(eq(projectEvents.projectId, project.projectId)).all();
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]).toMatchObject({
      type: "derived_output.created",
      visibility: "project",
      source: "api",
      actorAccountId: OWNER_ACCOUNT_ID,
    });
    const eventPayload = readJsonObject(eventRows[0]!.payloadJson);
    expect(eventPayload).toMatchObject({
      derived_output_id: record.id,
      domain: "analysis.summary",
      status: "published",
      owner_account_id: OWNER_ACCOUNT_ID,
    });
    expect(eventPayload).not.toHaveProperty("value");
    expect(eventPayload).not.toHaveProperty("value_json");
    expect(JSON.stringify(eventPayload)).not.toContain("do-not-copy-full-value");

    const logs = database.db.select().from(operationLogs).where(eq(operationLogs.projectId, project.projectId)).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "derived_output.create",
      targetType: "derived_output",
      targetId: record.id,
      actorAccountId: OWNER_ACCOUNT_ID,
    });
    const metadata = readJsonObject(logs[0]!.metadataJson);
    expect(metadata.value_byte_count).toEqual(expect.any(Number));
    expect(JSON.stringify(metadata)).not.toContain("do-not-copy-full-value");
  });

  it("allows deriver to mutate only its own records and keeps observer read-only", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "derived-output-project-roles",
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

    const ownerRecord = service.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      domain: "owner.domain",
      value: { owner: true },
    });
    const deriverRecord = service.create({
      actorAccountId: DERIVER_ACCOUNT_ID,
      projectId: project.projectId,
      domain: "deriver.domain",
      value: { version: 1 },
    });

    expect(service.update({
      actorAccountId: DERIVER_ACCOUNT_ID,
      projectId: project.projectId,
      itemId: deriverRecord.id,
      value: { version: 2 },
      status: "published",
    })).toMatchObject({
      ownerAccountId: DERIVER_ACCOUNT_ID,
      status: "published",
      value: { version: 2 },
    });

    expect(captureError(() => service.create({
      actorAccountId: OBSERVER_ACCOUNT_ID,
      projectId: project.projectId,
      domain: "observer.domain",
      value: {},
    }))).toMatchObject({ statusCode: 403, code: "derived_output_write_denied" });

    expect(captureError(() => service.update({
      actorAccountId: DERIVER_ACCOUNT_ID,
      projectId: project.projectId,
      itemId: ownerRecord.id,
      value: { stolen: true },
    }))).toMatchObject({ statusCode: 403, code: "derived_output_forbidden_for_role" });

    service.archive({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      itemId: ownerRecord.id,
    });
    expect(captureError(() => service.update({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      itemId: ownerRecord.id,
      value: { changed: true },
    }))).toMatchObject({ statusCode: 409, code: "derived_output_archived_immutable" });
  });

  it("rejects mismatched source scope and oversized JSON values", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "derived-output-project-scope",
    });
    const otherSession = createTestSessionWithScope(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "derived-output-other-session",
      projectId: "derived-output-other-project",
    });

    expect(captureError(() => service.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      domain: "scope.test",
      sourceSessionId: otherSession.sessionId,
      value: {},
    }))).toMatchObject({ statusCode: 409, code: "derived_output_source_scope_mismatch" });

    const smallLimitService = new DerivedOutputService(database.db, { maxPayloadBytes: 16 });
    expect(captureError(() => smallLimitService.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      domain: "size.test",
      value: { text: "this value is too large" },
    }))).toMatchObject({ statusCode: 413, code: "derived_output_payload_too_large" });
  });

  it("keeps committed writes when live publish fails", () => {
    const project = createTestProject(database.db, {
      accountId: OWNER_ACCOUNT_ID,
      id: "derived-output-project-live-failure",
    });
    const publishingService = new DerivedOutputService(database.db, {
      projectEventLiveHub: new ThrowingProjectEventLiveHub(),
    });

    const record = publishingService.create({
      actorAccountId: OWNER_ACCOUNT_ID,
      projectId: project.projectId,
      domain: "live.failure",
      value: { ok: true },
    });

    expect(database.db.select().from(derivedOutputs).where(eq(derivedOutputs.id, record.id)).get()).toBeTruthy();
    expect(database.db.select().from(projectEvents).where(eq(projectEvents.projectId, project.projectId)).all()).toHaveLength(1);
    expect(database.db.select().from(operationLogs).where(eq(operationLogs.projectId, project.projectId)).all()).toHaveLength(1);
  });
});
