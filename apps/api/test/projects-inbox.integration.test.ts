import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { buildApp } from "../src/app.js";
import type { DatabaseConnection } from "../src/db/client.js";
import { operationLogs } from "../src/db/schema.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../src/__tests__/helpers/workspace-project.js";
import { ProjectEventService } from "../src/services/project-event-service.js";
import { ProjectMembershipService } from "../src/services/project-membership-service.js";

type ItemResponse<T> = { item: T };
type ListResponse<T> = { items: T[]; next_cursor: string | null };
type ErrorResponse = { error: { code: string; message: string } };

type ProjectInboxItemResponse = {
  id: string;
  workspace_id: string;
  project_id: string;
  account_id: string;
  sender_account_id: string;
  type: string;
  title: string | null;
  payload: unknown;
  source_event_id: string | null;
  source_session_id: string | null;
  source_floor_id: string | null;
  source_page_id: string | null;
  status: "pending" | "accepted" | "rejected" | "archived";
  decided_by_account_id: string | null;
  decided_at: number | null;
  created_at: number;
  updated_at: number;
};

type ProjectEventResponse = {
  type: string;
  payload: Record<string, unknown>;
  causation_event_id: string | null;
};

const DERIVER_ACCOUNT_ID = "route-inbox-deriver";
const OBSERVER_ACCOUNT_ID = "route-inbox-observer";

describe("project inbox routes", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];
  let membershipService: ProjectMembershipService;

  beforeEach(async () => {
    const built = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
    });
    app = built.app;
    database = built.database;
    membershipService = new ProjectMembershipService(database);
  });

  afterEach(async () => {
    await app.close();
  });

  function authHeaders(accountId: string): { authorization: string } {
    return { authorization: `Bearer ${app.jwt.sign({ sub: accountId, account_id: accountId })}` };
  }

  it("supports owner and deriver create, deriver scoped reads, owner decisions, events and logs", async () => {
    const project = createTestProject(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "route-inbox-project",
    });
    ensureTestAccount(database, DERIVER_ACCOUNT_ID);
    membershipService.addDeriver({
      actorAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: DERIVER_ACCOUNT_ID,
    });

    const ownerCreate = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/inbox`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: {
        type: "owner.proposal",
        title: "Owner proposal",
        payload: { secret: "owner-payload-should-not-enter-event" },
      },
    });
    expect(ownerCreate.statusCode, ownerCreate.body).toBe(201);
    const ownerItem = ownerCreate.json<ItemResponse<ProjectInboxItemResponse>>().item;
    expect(ownerItem.id).toMatch(/^pinbox_/);
    expect(ownerItem.status).toBe("pending");

    const deriverCreate = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/inbox`,
      headers: authHeaders(DERIVER_ACCOUNT_ID),
      payload: {
        type: "deriver.proposal",
        payload: { note: "deriver" },
      },
    });
    expect(deriverCreate.statusCode, deriverCreate.body).toBe(201);
    const deriverItem = deriverCreate.json<ItemResponse<ProjectInboxItemResponse>>().item;
    expect(deriverItem.sender_account_id).toBe(DERIVER_ACCOUNT_ID);

    const ownerList = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/inbox?limit=1`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
    });
    expect(ownerList.statusCode, ownerList.body).toBe(200);
    const ownerPage = ownerList.json<ListResponse<ProjectInboxItemResponse>>();
    expect(ownerPage.items).toHaveLength(1);
    expect(ownerPage.next_cursor).toEqual(expect.any(String));

    const deriverList = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/inbox`,
      headers: authHeaders(DERIVER_ACCOUNT_ID),
    });
    expect(deriverList.statusCode, deriverList.body).toBe(200);
    expect(deriverList.json<ListResponse<ProjectInboxItemResponse>>().items.map((item) => item.id)).toEqual([deriverItem.id]);

    const deriverGetOwner = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/inbox/${ownerItem.id}`,
      headers: authHeaders(DERIVER_ACCOUNT_ID),
    });
    expect(deriverGetOwner.statusCode, deriverGetOwner.body).toBe(404);
    expect(deriverGetOwner.json<ErrorResponse>().error.code).toBe("project_inbox_item_not_found");

    const acceptResponse = await app.inject({
      method: "PATCH",
      url: `/projects/${project.projectId}/inbox/${ownerItem.id}`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: {
        decision: "accept",
        note: "accepted by owner",
      },
    });
    expect(acceptResponse.statusCode, acceptResponse.body).toBe(200);
    const accepted = acceptResponse.json<ItemResponse<ProjectInboxItemResponse>>().item;
    expect(accepted.status).toBe("accepted");
    expect(accepted.decided_by_account_id).toBe(DEFAULT_ADMIN_ACCOUNT_ID);

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/events?types=project_inbox.item.created,project_inbox.item.accepted`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
    });
    expect(eventsResponse.statusCode, eventsResponse.body).toBe(200);
    const events = eventsResponse.json<{ items: ProjectEventResponse[] }>().items;
    expect(events.map((event) => event.type)).toEqual([
      "project_inbox.item.created",
      "project_inbox.item.created",
      "project_inbox.item.accepted",
    ]);
    expect(events.every((event) => !JSON.stringify(event.payload).includes("should-not-enter-event"))).toBe(true);
    expect(events.every((event) => !("payload" in event.payload) && !("payload_json" in event.payload))).toBe(true);

    const logs = database.select().from(operationLogs).where(eq(operationLogs.projectId, project.projectId)).all();
    expect(logs.map((log) => log.action).sort()).toEqual([
      "project_inbox_item.create",
      "project_inbox_item.create",
      "project_inbox_item.decide",
    ].sort());
    expect(JSON.stringify(logs)).not.toContain("should-not-enter-event");
  });

  it("enforces observer denial, deriver decision denial, validation, source event scope and payload limits", async () => {
    const project = createTestProject(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "route-inbox-permission-project",
    });
    const otherProject = createTestProject(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "route-inbox-other-project",
    });
    ensureTestAccount(database, DERIVER_ACCOUNT_ID);
    ensureTestAccount(database, OBSERVER_ACCOUNT_ID);
    membershipService.addDeriver({
      actorAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: DERIVER_ACCOUNT_ID,
    });
    membershipService.addObserver({
      actorAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
      projectId: project.projectId,
      accountId: OBSERVER_ACCOUNT_ID,
    });

    const deriverCreate = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/inbox`,
      headers: authHeaders(DERIVER_ACCOUNT_ID),
      payload: {
        type: "deriver.proposal",
        payload: {},
      },
    });
    expect(deriverCreate.statusCode, deriverCreate.body).toBe(201);
    const deriverItem = deriverCreate.json<ItemResponse<ProjectInboxItemResponse>>().item;

    const deriverDecide = await app.inject({
      method: "PATCH",
      url: `/projects/${project.projectId}/inbox/${deriverItem.id}`,
      headers: authHeaders(DERIVER_ACCOUNT_ID),
      payload: { decision: "archive" },
    });
    expect(deriverDecide.statusCode, deriverDecide.body).toBe(403);
    expect(deriverDecide.json<ErrorResponse>().error.code).toBe("project_inbox_decide_denied");

    const observerList = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/inbox`,
      headers: authHeaders(OBSERVER_ACCOUNT_ID),
    });
    expect(observerList.statusCode, observerList.body).toBe(403);
    expect(observerList.json<ErrorResponse>().error.code).toBe("project_inbox_read_denied");

    const invalidBody = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/inbox`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: { payload: {} },
    });
    expect(invalidBody.statusCode).toBe(400);

    const foreignEvent = new ProjectEventService(database).append({
      workspaceId: otherProject.workspaceId,
      projectId: otherProject.projectId,
      type: "derived_output.created",
      payload: { derived_output_id: "dout_foreign" },
    });
    const mismatchResponse = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/inbox`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: {
        type: "source.mismatch",
        source_event_id: foreignEvent.id,
        payload: {},
      },
    });
    expect(mismatchResponse.statusCode, mismatchResponse.body).toBe(409);
    expect(mismatchResponse.json<ErrorResponse>().error.code).toBe("project_inbox_source_scope_mismatch");

    const largePayloadResponse = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/inbox`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: {
        type: "large.payload",
        payload: { text: "x".repeat(300 * 1024) },
      },
    });
    expect(largePayloadResponse.statusCode, largePayloadResponse.body).toBe(413);
    expect(largePayloadResponse.json<ErrorResponse>().error.code).toBe("project_inbox_payload_too_large");
  });
});
