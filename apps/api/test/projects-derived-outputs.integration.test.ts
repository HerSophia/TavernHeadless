import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { buildApp } from "../src/app.js";
import type { DatabaseConnection } from "../src/db/client.js";
import { operationLogs } from "../src/db/schema.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestAccount,
} from "../src/__tests__/helpers/workspace-project.js";
import { ProjectMembershipService } from "../src/services/project-membership-service.js";

type ItemResponse<T> = { item: T };
type ListResponse<T> = { items: T[]; next_cursor: string | null };
type ErrorResponse = { error: { code: string; message: string } };

type DerivedOutputResponse = {
  id: string;
  workspace_id: string;
  project_id: string;
  account_id: string;
  owner_account_id: string;
  source_session_id: string | null;
  source_floor_id: string | null;
  source_page_id: string | null;
  domain: string;
  value: unknown;
  status: "draft" | "published" | "archived";
  created_at: number;
  updated_at: number;
};

type ProjectEventResponse = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  operation_log_id: string | null;
};

const DERIVER_ACCOUNT_ID = "route-derived-deriver";
const OBSERVER_ACCOUNT_ID = "route-derived-observer";
const NON_MEMBER_ACCOUNT_ID = "route-derived-non-member";

describe("project derived output routes", () => {
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

  it("supports owner create, list pagination, get, update, archive, events and operation logs", async () => {
    const project = createTestProject(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "route-derived-owner-project",
    });
    const sourceSession = createTestSessionWithScope(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "route-derived-source-session",
      projectId: project.projectId,
    });

    const createFirst = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/derived-outputs`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: {
        domain: "analysis.summary",
        source_session_id: sourceSession.sessionId,
        value: { text: "first-value-should-not-enter-event" },
      },
    });
    expect(createFirst.statusCode, createFirst.body).toBe(201);
    const first = createFirst.json<ItemResponse<DerivedOutputResponse>>().item;
    expect(first.id).toMatch(/^dout_/);
    expect(first).toMatchObject({
      project_id: project.projectId,
      owner_account_id: DEFAULT_ADMIN_ACCOUNT_ID,
      source_session_id: sourceSession.sessionId,
      domain: "analysis.summary",
      status: "draft",
    });

    const createSecond = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/derived-outputs`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: {
        domain: "analysis.other",
        value: { text: "second" },
        status: "published",
      },
    });
    expect(createSecond.statusCode, createSecond.body).toBe(201);
    const second = createSecond.json<ItemResponse<DerivedOutputResponse>>().item;

    const firstPageResponse = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/derived-outputs?limit=1`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
    });
    expect(firstPageResponse.statusCode, firstPageResponse.body).toBe(200);
    const firstPage = firstPageResponse.json<ListResponse<DerivedOutputResponse>>();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const secondPageResponse = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/derived-outputs?limit=1&cursor=${encodeURIComponent(firstPage.next_cursor ?? "")}`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
    });
    expect(secondPageResponse.statusCode, secondPageResponse.body).toBe(200);
    const listedIds = [
      ...firstPage.items.map((item) => item.id),
      ...secondPageResponse.json<ListResponse<DerivedOutputResponse>>().items.map((item) => item.id),
    ];
    expect(listedIds.sort()).toEqual([first.id, second.id].sort());

    const getResponse = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/derived-outputs/${first.id}`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
    });
    expect(getResponse.statusCode, getResponse.body).toBe(200);
    expect(getResponse.json<ItemResponse<DerivedOutputResponse>>().item.value).toEqual({ text: "first-value-should-not-enter-event" });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/projects/${project.projectId}/derived-outputs/${first.id}`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: {
        status: "published",
        value: { text: "updated-value-should-not-enter-event" },
      },
    });
    expect(patchResponse.statusCode, patchResponse.body).toBe(200);
    expect(patchResponse.json<ItemResponse<DerivedOutputResponse>>().item.status).toBe("published");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/projects/${project.projectId}/derived-outputs/${first.id}`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
    });
    expect(deleteResponse.statusCode, deleteResponse.body).toBe(200);
    expect(deleteResponse.json<ItemResponse<DerivedOutputResponse>>().item.status).toBe("archived");

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/events?types=derived_output.created,derived_output.updated,derived_output.archived`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
    });
    expect(eventsResponse.statusCode, eventsResponse.body).toBe(200);
    const events = eventsResponse.json<{ items: ProjectEventResponse[] }>().items;
    expect(events.map((event) => event.type)).toEqual([
      "derived_output.created",
      "derived_output.created",
      "derived_output.updated",
      "derived_output.archived",
    ]);
    expect(events.every((event) => !JSON.stringify(event.payload).includes("should-not-enter-event"))).toBe(true);
    expect(events.every((event) => !("value" in event.payload) && !("value_json" in event.payload))).toBe(true);

    const logs = database.select().from(operationLogs).where(eq(operationLogs.projectId, project.projectId)).all();
    expect(logs.map((log) => log.action).sort()).toEqual([
      "derived_output.create",
      "derived_output.create",
      "derived_output.update",
      "derived_output.archive",
    ].sort());
    expect(JSON.stringify(logs)).not.toContain("should-not-enter-event");
  });

  it("enforces deriver ownership, observer read-only access, validation, hidden non-members and payload limits", async () => {
    const project = createTestProject(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "route-derived-permissions-project",
    });
    ensureTestAccount(database, DERIVER_ACCOUNT_ID);
    ensureTestAccount(database, OBSERVER_ACCOUNT_ID);
    ensureTestAccount(database, NON_MEMBER_ACCOUNT_ID);
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
      url: `/projects/${project.projectId}/derived-outputs`,
      headers: authHeaders(DERIVER_ACCOUNT_ID),
      payload: {
        domain: "deriver.result",
        value: { version: 1 },
      },
    });
    expect(deriverCreate.statusCode, deriverCreate.body).toBe(201);
    const deriverItem = deriverCreate.json<ItemResponse<DerivedOutputResponse>>().item;
    expect(deriverItem.owner_account_id).toBe(DERIVER_ACCOUNT_ID);

    const deriverPatch = await app.inject({
      method: "PATCH",
      url: `/projects/${project.projectId}/derived-outputs/${deriverItem.id}`,
      headers: authHeaders(DERIVER_ACCOUNT_ID),
      payload: { value: { version: 2 } },
    });
    expect(deriverPatch.statusCode, deriverPatch.body).toBe(200);
    expect(deriverPatch.json<ItemResponse<DerivedOutputResponse>>().item.value).toEqual({ version: 2 });

    const observerCreate = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/derived-outputs`,
      headers: authHeaders(OBSERVER_ACCOUNT_ID),
      payload: {
        domain: "observer.result",
        value: {},
      },
    });
    expect(observerCreate.statusCode, observerCreate.body).toBe(403);
    expect(observerCreate.json<ErrorResponse>().error.code).toBe("derived_output_write_denied");

    const nonMemberList = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/derived-outputs`,
      headers: authHeaders(NON_MEMBER_ACCOUNT_ID),
    });
    expect(nonMemberList.statusCode, nonMemberList.body).toBe(404);
    expect(nonMemberList.json<ErrorResponse>().error.code).toBe("project_not_found");

    const invalidBody = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/derived-outputs`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: { value: {} },
    });
    expect(invalidBody.statusCode).toBe(400);

    const foreignSession = createTestSessionWithScope(database, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "route-derived-foreign-session",
      projectId: "route-derived-foreign-project",
    });
    const mismatchResponse = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/derived-outputs`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: {
        domain: "scope.mismatch",
        source_session_id: foreignSession.sessionId,
        value: {},
      },
    });
    expect(mismatchResponse.statusCode, mismatchResponse.body).toBe(409);
    expect(mismatchResponse.json<ErrorResponse>().error.code).toBe("derived_output_source_scope_mismatch");

    const largePayloadResponse = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/derived-outputs`,
      headers: authHeaders(DEFAULT_ADMIN_ACCOUNT_ID),
      payload: {
        domain: "large.payload",
        value: { text: "x".repeat(300 * 1024) },
      },
    });
    expect(largePayloadResponse.statusCode, largePayloadResponse.body).toBe(413);
    expect(largePayloadResponse.json<ErrorResponse>().error.code).toBe("derived_output_payload_too_large");
  });
});
