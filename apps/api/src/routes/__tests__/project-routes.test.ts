import type { AddressInfo } from "node:net";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import type { ProjectEventLiveHub } from "../../services/project-event-live-hub.js";
import { ProjectEventService, type ProjectEventRecord } from "../../services/project-event-service.js";
import { ProjectMembershipService } from "../../services/project-membership-service.js";

const OWNER_ACCOUNT_ID = "project-route-owner";
const OBSERVER_ACCOUNT_ID = "project-route-observer";
const OTHER_ACCOUNT_ID = "project-route-other";
const OWNER_KEY = "project-route-owner-key";
const OBSERVER_KEY = "project-route-observer-key";
const OTHER_KEY = "project-route-other-key";

type ProjectItem = {
  id: string;
  role: "owner" | "observer";
  status: "active" | "archived";
};

type ProjectSessionItem = {
  id: string;
  project_id: string;
  title: string | null;
};

type ProjectEventItem = {
  id: string;
  sequence: number;
  type: string;
  visibility: "project" | "owner" | "internal";
  payload: unknown;
};

type ProjectMemberItem = {
  account_id: string;
  role: "owner" | "observer";
  status: "active" | "removed";
};

type ItemsResponse<T> = {
  items: T[];
  next_cursor?: string | null;
  next_after?: number | null;
  has_more?: boolean;
};

type ItemResponse<T> = { item: T };
type ErrorResponse = { error: { code: string; message: string } };

type TestApp = {
  app: FastifyInstance;
  database: DatabaseConnection["db"];
  projectEventLiveHub: ProjectEventLiveHub;
};

async function buildProjectRouteApp(): Promise<TestApp> {
  const built = await buildApp({
    databasePath: ":memory:",
    logger: false,
    accountMode: "multi",
    auth: {
      mode: "api_key",
      apiKeys: [OWNER_KEY, OBSERVER_KEY, OTHER_KEY],
      apiKeyAccountMap: {
        [OWNER_KEY]: OWNER_ACCOUNT_ID,
        [OBSERVER_KEY]: OBSERVER_ACCOUNT_ID,
        [OTHER_KEY]: OTHER_ACCOUNT_ID,
      },
    },
  });

  ensureTestAccount(built.database, OWNER_ACCOUNT_ID);
  ensureTestAccount(built.database, OBSERVER_ACCOUNT_ID);
  ensureTestAccount(built.database, OTHER_ACCOUNT_ID);

  return {
    app: built.app,
    database: built.database,
    projectEventLiveHub: built.projectEventLiveHub,
  };
}

function authHeaders(apiKey: string) {
  return { "x-api-key": apiKey };
}

function addObserver(database: DatabaseConnection["db"], projectId: string): void {
  new ProjectMembershipService(database).addObserver({
    actorAccountId: OWNER_ACCOUNT_ID,
    projectId,
    accountId: OBSERVER_ACCOUNT_ID,
  });
}

function appendEvent(
  database: DatabaseConnection["db"],
  input: {
    workspaceId: string;
    projectId: string;
    type: string;
    visibility?: "project" | "owner" | "internal";
    sessionId?: string | null;
    payload?: Record<string, unknown>;
    createdAt?: number;
  },
): ProjectEventRecord {
  return new ProjectEventService(database).append({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    type: input.type,
    visibility: input.visibility ?? "project",
    actorAccountId: OWNER_ACCOUNT_ID,
    sessionId: input.sessionId ?? null,
    branchId: input.sessionId ? "main" : null,
    payload: input.payload ?? {},
    createdAt: input.createdAt ?? Date.now(),
  });
}

describe("Project routes", () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildProjectRouteApp();
  });

  afterEach(async () => {
    await testApp.app.close();
  });

  it("lets owner and observer discover projects, project sessions, and session scope", async () => {
    const project = createTestProject(testApp.database, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project_routes_read",
      now: 1_700_000_000_000,
    });
    const firstSession = createTestSessionWithScope(testApp.database, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project_routes_session_1",
      projectId: project.projectId,
      title: "Visible Session",
      now: 1_700_000_000_100,
    });
    createTestSessionWithScope(testApp.database, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project_routes_session_2",
      projectId: project.projectId,
      title: "Second Session",
      now: 1_700_000_000_200,
    });
    addObserver(testApp.database, project.projectId);

    const ownerList = await testApp.app.inject({
      method: "GET",
      url: "/projects",
      headers: authHeaders(OWNER_KEY),
    });
    expect(ownerList.statusCode, ownerList.body).toBe(200);
    const ownerProjects = ownerList.json<ItemsResponse<ProjectItem>>().items;
    expect(ownerProjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: project.projectId, role: "owner" }),
    ]));

    const observerList = await testApp.app.inject({
      method: "GET",
      url: "/projects?role=observer",
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(observerList.statusCode, observerList.body).toBe(200);
    expect(observerList.json<ItemsResponse<ProjectItem>>().items).toEqual([
      expect.objectContaining({ id: project.projectId, role: "observer" }),
    ]);

    const observerDetail = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(observerDetail.statusCode, observerDetail.body).toBe(200);
    expect(observerDetail.json<ProjectItem>()).toMatchObject({ id: project.projectId, role: "observer" });

    const projectSessions = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/sessions?limit=1`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(projectSessions.statusCode, projectSessions.body).toBe(200);
    const sessionPage = projectSessions.json<ItemsResponse<ProjectSessionItem>>();
    expect(sessionPage.items).toHaveLength(1);
    expect(sessionPage.next_cursor).toEqual(expect.any(String));

    const nextProjectSessions = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/sessions?cursor=${encodeURIComponent(sessionPage.next_cursor!)}`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(nextProjectSessions.statusCode, nextProjectSessions.body).toBe(200);
    expect(nextProjectSessions.json<ItemsResponse<ProjectSessionItem>>().items.map((item) => item.id))
      .toContain(firstSession.sessionId);

    const scope = await testApp.app.inject({
      method: "GET",
      url: `/sessions/${firstSession.sessionId}/scope`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(scope.statusCode, scope.body).toBe(200);
    expect(scope.json()).toEqual({
      session_id: firstSession.sessionId,
      workspace_id: project.workspaceId,
      project_id: project.projectId,
    });

    const denied = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}`,
      headers: authHeaders(OTHER_KEY),
    });
    expect(denied.statusCode, denied.body).toBe(404);
    expect(denied.json<ErrorResponse>().error.code).toBe("project_not_found");
  });

  it("filters project event history by role, type, session, and cursor", async () => {
    const project = createTestProject(testApp.database, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project_routes_events",
      now: 1_700_000_001_000,
    });
    const session = createTestSessionWithScope(testApp.database, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project_routes_event_session",
      projectId: project.projectId,
      now: 1_700_000_001_100,
    });
    const otherSession = createTestSessionWithScope(testApp.database, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project_routes_other_event_session",
      projectId: project.projectId,
      now: 1_700_000_001_200,
    });
    addObserver(testApp.database, project.projectId);

    appendEvent(testApp.database, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "session.created",
      visibility: "project",
      sessionId: session.sessionId,
      payload: { session_id: session.sessionId },
      createdAt: 1_700_000_001_300,
    });
    appendEvent(testApp.database, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "floor.committed",
      visibility: "owner",
      sessionId: session.sessionId,
      payload: { floor_id: "floor-owner-only" },
      createdAt: 1_700_000_001_400,
    });
    appendEvent(testApp.database, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "system.internal",
      visibility: "internal",
      sessionId: session.sessionId,
      createdAt: 1_700_000_001_500,
    });
    appendEvent(testApp.database, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "session.updated",
      visibility: "project",
      sessionId: otherSession.sessionId,
      createdAt: 1_700_000_001_600,
    });

    const ownerEvents = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/events?after=0&limit=10`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(ownerEvents.statusCode, ownerEvents.body).toBe(200);
    expect(ownerEvents.json<ItemsResponse<ProjectEventItem>>().items.map((event) => event.sequence)).toEqual([1, 2, 4]);

    const observerEvents = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/events?after=0`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(observerEvents.statusCode, observerEvents.body).toBe(200);
    expect(observerEvents.json<ItemsResponse<ProjectEventItem>>().items.map((event) => event.sequence)).toEqual([1, 4]);

    const ownerSessionFloorEvents = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/events?types=floor.committed&session_id=${session.sessionId}`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(ownerSessionFloorEvents.statusCode, ownerSessionFloorEvents.body).toBe(200);
    expect(ownerSessionFloorEvents.json<ItemsResponse<ProjectEventItem>>().items.map((event) => event.sequence)).toEqual([2]);

    const nonMemberEvents = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/events`,
      headers: authHeaders(OTHER_KEY),
    });
    expect(nonMemberEvents.statusCode, nonMemberEvents.body).toBe(404);
    expect(nonMemberEvents.json<ErrorResponse>().error.code).toBe("project_not_found");

    const invalidCursor = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/events?after=not-a-number`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(invalidCursor.statusCode, invalidCursor.body).toBe(400);
    expect(invalidCursor.json<ErrorResponse>().error.code).toBe("invalid_event_cursor");
  });

  it("lets owners manage observer members and keeps observers read-only", async () => {
    const project = createTestProject(testApp.database, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project_routes_members",
    });

    const addResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/members`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        account_id: OBSERVER_ACCOUNT_ID,
        role: "observer",
      },
    });
    expect(addResponse.statusCode, addResponse.body).toBe(201);
    expect(addResponse.json<ItemResponse<ProjectMemberItem>>().item).toMatchObject({
      account_id: OBSERVER_ACCOUNT_ID,
      role: "observer",
      status: "active",
    });

    const memberList = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/members`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(memberList.statusCode, memberList.body).toBe(200);
    expect(memberList.json<ItemsResponse<ProjectMemberItem>>().items.map((member) => [member.account_id, member.role, member.status]))
      .toEqual([
        [OWNER_ACCOUNT_ID, "owner", "active"],
        [OBSERVER_ACCOUNT_ID, "observer", "active"],
      ]);

    const observerWrite = await testApp.app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/members`,
      headers: authHeaders(OBSERVER_KEY),
      payload: {
        account_id: OTHER_ACCOUNT_ID,
        role: "observer",
      },
    });
    expect(observerWrite.statusCode, observerWrite.body).toBe(403);
    expect(observerWrite.json<ErrorResponse>().error.code).toBe("project_access_denied");

    const unsupportedRole = await testApp.app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/members`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        account_id: OTHER_ACCOUNT_ID,
        role: "owner",
      },
    });
    expect(unsupportedRole.statusCode, unsupportedRole.body).toBe(400);
    expect(unsupportedRole.json<ErrorResponse>().error.code).toBe("project_member_role_not_supported");

    const removeResponse = await testApp.app.inject({
      method: "DELETE",
      url: `/projects/${project.projectId}/members/${OBSERVER_ACCOUNT_ID}`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(removeResponse.statusCode, removeResponse.body).toBe(200);
    expect(removeResponse.json<ItemResponse<ProjectMemberItem>>().item).toMatchObject({
      account_id: OBSERVER_ACCOUNT_ID,
      status: "removed",
    });

    const observerAfterRemoval = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(observerAfterRemoval.statusCode, observerAfterRemoval.body).toBe(404);
    expect(observerAfterRemoval.json<ErrorResponse>().error.code).toBe("project_not_found");
  });

  it("streams historical and live project events through SSE", async () => {
    const project = createTestProject(testApp.database, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project_routes_sse",
      now: 1_700_000_002_000,
    });
    addObserver(testApp.database, project.projectId);

    appendEvent(testApp.database, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "session.created",
      visibility: "project",
      payload: { marker: "first" },
      createdAt: 1_700_000_002_100,
    });
    appendEvent(testApp.database, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "owner.only",
      visibility: "owner",
      payload: { marker: "owner" },
      createdAt: 1_700_000_002_200,
    });
    appendEvent(testApp.database, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "session.updated",
      visibility: "project",
      payload: { marker: "third" },
      createdAt: 1_700_000_002_300,
    });

    await testApp.app.listen({ host: "127.0.0.1", port: 0 });
    const address = testApp.app.server.address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/projects/${project.projectId}/events/stream?after=1`,
      {
        headers: {
          ...authHeaders(OBSERVER_KEY),
          "Last-Event-ID": "0",
        },
        signal: controller.signal,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).not.toBeNull();

    const nextEvent = createSseEventReader(response.body!.getReader());
    const replayed = await nextEvent();
    expect(replayed).toMatchObject({ id: "3", event: "session.updated" });
    expect(replayed.data).toMatchObject({ sequence: 3, payload: { marker: "third" } });

    const liveEvent = appendEvent(testApp.database, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "floor.committed",
      visibility: "project",
      payload: { marker: "live" },
      createdAt: 1_700_000_002_400,
    });
    testApp.projectEventLiveHub.publish(liveEvent);

    const streamedLive = await nextEvent();
    expect(streamedLive).toMatchObject({ id: "4", event: "floor.committed" });
    expect(streamedLive.data).toMatchObject({ sequence: 4, payload: { marker: "live" } });

    controller.abort();
  });

  it("hides project event SSE from non-members behind a 404 project_not_found", async () => {
    const project = createTestProject(testApp.database, {
      accountId: OWNER_ACCOUNT_ID,
      id: "project_routes_sse_non_member",
    });
    appendEvent(testApp.database, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "session.created",
      visibility: "project",
      payload: { marker: "non-member-test" },
    });

    const denied = await testApp.app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/events/stream?after=0`,
      headers: authHeaders(OTHER_KEY),
    });

    expect(denied.statusCode, denied.body).toBe(404);
    expect(denied.headers["content-type"]).toContain("application/json");
    expect(denied.json<ErrorResponse>().error.code).toBe("project_not_found");
    expect(testApp.projectEventLiveHub.listenerCount(project.projectId)).toBe(0);
  });
});

function createSseEventReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";

  return async function nextEvent(timeoutMs = 3_000): Promise<{ id: string | null; event: string | null; data: Record<string, unknown> }> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const parsed = parseSseBlock(block);
        if (parsed) {
          return parsed;
        }
        continue;
      }

      const chunk = await readWithTimeout(reader, timeoutMs - (Date.now() - startedAt));
      if (chunk.done) {
        throw new Error("SSE stream ended before an event was received");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }

    throw new Error("Timed out waiting for SSE event");
  };
}

function parseSseBlock(block: string): { id: string | null; event: string | null; data: Record<string, unknown> } | null {
  if (block.trim().length === 0 || block.startsWith(":")) {
    return null;
  }

  let id: string | null = null;
  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("id: ")) {
      id = line.slice(4);
    } else if (line.startsWith("event: ")) {
      event = line.slice(7);
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6));
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return { id, event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for SSE chunk")), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
