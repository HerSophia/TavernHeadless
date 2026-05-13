import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp, type BuildAppResult } from "../../app.js";
import type { DatabaseConnection } from "../../db/client.js";
import { createDatabase } from "../../db/client.js";
import { floors, messagePages, messages } from "../../db/schema.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectAccessService } from "../../services/project-access-service.js";
import { ProjectMembershipService } from "../../services/project-membership-service.js";
import { type ChatService } from "../../services/chat/chat-service.js";
import { registerChatRoutes } from "../chat.js";

const OWNER_ACCOUNT_ID = "observer-permissions-owner";
const OBSERVER_ACCOUNT_ID = "observer-permissions-observer";
const OTHER_ACCOUNT_ID = "observer-permissions-other";

const OWNER_KEY = "observer-permissions-owner-key";
const OBSERVER_KEY = "observer-permissions-observer-key";
const OTHER_KEY = "observer-permissions-other-key";

const NOW = 1_720_000_000_000;

const clientDataConfig = {
  expirationIntervalMs: 300_000,
  domainPurgeGracePeriodMs: 604_800_000,
  defaultMaxItemSizeBytes: 1_048_576,
  defaultQuotaMaxEntries: 10_000,
  defaultQuotaMaxBytes: 10_485_760,
  maxDomainsPerAccount: 64,
  maxTotalEntriesPerAccount: 100_000,
  maxTotalBytesPerAccount: 104_857_600,
};

type ErrorResponse = { error: { code: string; message: string } };
type ItemResponse<T> = { data: T };
type BatchResponse = {
  data: {
    results: Array<{ index: number; id?: string; action: string; data?: unknown }>;
    meta: Record<string, number | string | boolean | null>;
  };
};

type FullAppFixture = {
  built: BuildAppResult;
  database: DatabaseConnection["db"];
  ownerSessionId: string;
  observerSessionId: string;
  ownerFloorId: string;
  ownerPageId: string;
  ownerMessageId: string;
};

type MockedChatApp = {
  app: FastifyInstance;
  sessionId: string;
  respond: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
};

const fullAppFixtures: FullAppFixture[] = [];
const chatApps: FastifyInstance[] = [];

describe("project observer permissions on legacy routes", () => {
  afterEach(async () => {
    while (chatApps.length > 0) {
      const app = chatApps.pop();
      if (app) {
        await app.close();
      }
    }

    while (fullAppFixtures.length > 0) {
      const fixture = fullAppFixtures.pop();
      if (fixture) {
        await fixture.built.app.close();
      }
    }
  });

  it("allows owners to run chat writes and rejects observers before SSE starts", async () => {
    const chat = await buildChatPermissionApp();

    const ownerRespond = await chat.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(chat.sessionId)}/respond`,
      headers: authHeaders(OWNER_KEY),
      payload: { message: "继续。" },
    });
    expect(ownerRespond.statusCode, ownerRespond.body).toBe(200);
    expect(chat.respond).toHaveBeenCalledTimes(1);

    const ownerRegenerate = await chat.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(chat.sessionId)}/regenerate`,
      headers: authHeaders(OWNER_KEY),
      payload: {},
    });
    expect(ownerRegenerate.statusCode, ownerRegenerate.body).toBe(200);
    expect(chat.regenerate).toHaveBeenCalledTimes(1);

    const observerRespond = await chat.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(chat.sessionId)}/respond`,
      headers: authHeaders(OBSERVER_KEY),
      payload: { message: "旁观者不能写入。" },
    });
    expectProjectAccessDenied(observerRespond.statusCode, observerRespond.json<ErrorResponse>());
    expect(chat.respond).toHaveBeenCalledTimes(1);

    const observerRegenerate = await chat.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(chat.sessionId)}/regenerate`,
      headers: authHeaders(OBSERVER_KEY),
      payload: {},
    });
    expectProjectAccessDenied(observerRegenerate.statusCode, observerRegenerate.json<ErrorResponse>());
    expect(chat.regenerate).toHaveBeenCalledTimes(1);

    const observerStream = await chat.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(chat.sessionId)}/respond/stream`,
      headers: authHeaders(OBSERVER_KEY),
      payload: { message: "旁观者不能打开写入流。" },
    });
    expectProjectAccessDenied(observerStream.statusCode, observerStream.json<ErrorResponse>());
    expect(String(observerStream.headers["content-type"] ?? "")).not.toContain("text/event-stream");
    expect(observerStream.body).not.toContain("event:");
    expect(chat.respond).toHaveBeenCalledTimes(1);
  });

  it("lets observers read project resources and rejects owner-only write routes", async () => {
    const fixture = await buildFullAppFixture();

    const readCases = [
      `/sessions/${encodeURIComponent(fixture.ownerSessionId)}`,
      `/floors/${encodeURIComponent(fixture.ownerFloorId)}`,
      `/pages/${encodeURIComponent(fixture.ownerPageId)}`,
      `/messages/${encodeURIComponent(fixture.ownerMessageId)}`,
    ];

    for (const url of readCases) {
      const response = await fixture.built.app.inject({
        method: "GET",
        url,
        headers: authHeaders(OBSERVER_KEY),
      });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
    }

    const writeCases = [
      {
        method: "PUT" as const,
        url: "/variables",
        payload: {
          scope: "chat",
          scope_id: fixture.ownerSessionId,
          key: "observer_denied_variable",
          value: "denied",
        },
      },
      {
        method: "POST" as const,
        url: "/memories",
        payload: {
          scope: "chat",
          scope_id: fixture.ownerSessionId,
          type: "fact",
          content: { text: "observer denied memory" },
          fact_key: "observer_denied_memory",
        },
      },
      {
        method: "POST" as const,
        url: `/sessions/${encodeURIComponent(fixture.ownerSessionId)}/state/namespaces`,
        payload: {
          namespace: "observer_denied_state",
          logical_owner_type: "plugin",
          logical_owner_id: "observer-test",
        },
      },
      {
        method: "PATCH" as const,
        url: `/sessions/${encodeURIComponent(fixture.ownerSessionId)}/prompt-runtime/mode`,
        payload: { prompt_mode: "native" },
      },
      {
        method: "PUT" as const,
        url: `/sessions/${encodeURIComponent(fixture.ownerSessionId)}/tool-permissions`,
        payload: { enabled: true },
      },
    ];

    for (const writeCase of writeCases) {
      const response = await fixture.built.app.inject({
        method: writeCase.method,
        url: writeCase.url,
        headers: authHeaders(OBSERVER_KEY),
        payload: writeCase.payload,
      });
      expectProjectAccessDenied(response.statusCode, response.json<ErrorResponse>());
    }
  });

  it("keeps batch operations partial and reports access_denied for observer writes", async () => {
    const fixture = await buildFullAppFixture();

    const variableBatch = await fixture.built.app.inject({
      method: "PUT",
      url: "/variables/batch",
      headers: authHeaders(OBSERVER_KEY),
      payload: {
        items: [
          {
            scope: "chat",
            scope_id: fixture.ownerSessionId,
            key: "denied_batch_variable",
            value: "denied",
          },
          {
            scope: "chat",
            scope_id: fixture.observerSessionId,
            key: "allowed_batch_variable",
            value: "allowed",
          },
        ],
      },
    });
    expect(variableBatch.statusCode, variableBatch.body).toBe(200);
    const variableBatchBody = variableBatch.json<BatchResponse>();
    expect(variableBatchBody.data.results.map((result) => result.action)).toEqual([
      "project_access_denied",
      "created",
    ]);
    expect(variableBatchBody.data.meta).toMatchObject({
      total: 2,
      created: 1,
      updated: 0,
      access_denied: 1,
    });

    const ownerMemoryForStatus = await createMemoryItem(fixture, fixture.ownerSessionId, OWNER_KEY, "owner-status-memory");
    const observerMemoryForStatus = await createMemoryItem(
      fixture,
      fixture.observerSessionId,
      OBSERVER_KEY,
      "observer-status-memory",
    );

    const statusBatch = await fixture.built.app.inject({
      method: "PATCH",
      url: "/memories/batch/status",
      headers: authHeaders(OBSERVER_KEY),
      payload: {
        ids: [ownerMemoryForStatus, observerMemoryForStatus],
        status: "deprecated",
      },
    });
    expect(statusBatch.statusCode, statusBatch.body).toBe(200);
    const statusBatchBody = statusBatch.json<BatchResponse>();
    expect(statusBatchBody.data.results.map((result) => result.action)).toEqual([
      "project_access_denied",
      "updated",
    ]);
    expect(statusBatchBody.data.meta).toMatchObject({
      total: 2,
      updated: 1,
      not_found: 0,
      access_denied: 1,
      status: "deprecated",
    });

    const ownerMemoryForDelete = await createMemoryItem(fixture, fixture.ownerSessionId, OWNER_KEY, "owner-delete-memory");
    const observerMemoryForDelete = await createMemoryItem(
      fixture,
      fixture.observerSessionId,
      OBSERVER_KEY,
      "observer-delete-memory",
    );

    const deleteBatch = await fixture.built.app.inject({
      method: "POST",
      url: "/memories/batch/delete",
      headers: authHeaders(OBSERVER_KEY),
      payload: { ids: [ownerMemoryForDelete, observerMemoryForDelete] },
    });
    expect(deleteBatch.statusCode, deleteBatch.body).toBe(200);
    const deleteBatchBody = deleteBatch.json<BatchResponse>();
    expect(deleteBatchBody.data.results.map((result) => result.action)).toEqual([
      "project_access_denied",
      "deleted",
    ]);
    expect(deleteBatchBody.data.meta).toMatchObject({
      total: 2,
      deleted: 1,
      not_found: 0,
      access_denied: 1,
    });
  });

  it("hides a non-member project scope lookup behind not_found", async () => {
    const fixture = await buildFullAppFixture();

    const response = await fixture.built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(fixture.ownerSessionId)}/scope`,
      headers: authHeaders(OTHER_KEY),
    });

    expect(response.statusCode, response.body).toBe(404);
    expect(response.json<ErrorResponse>().error.code).toBe("not_found");
  });
});

async function buildFullAppFixture(): Promise<FullAppFixture> {
  const built = await buildApp({
    databasePath: ":memory:",
    logger: false,
    accountMode: "multi",
    enableClientData: true,
    clientData: clientDataConfig,
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
  fullAppFixtures.push({
    built,
    database: built.database,
    ownerSessionId: "",
    observerSessionId: "",
    ownerFloorId: "",
    ownerPageId: "",
    ownerMessageId: "",
  });

  ensureObserverPermissionAccounts(built.database);

  const ownerProject = createTestProject(built.database, {
    accountId: OWNER_ACCOUNT_ID,
    id: "observer_permissions_owner_project",
    now: NOW,
  });
  const ownerSession = createTestSessionWithScope(built.database, {
    accountId: OWNER_ACCOUNT_ID,
    id: "observer_permissions_owner_session",
    projectId: ownerProject.projectId,
    title: "Owner visible session",
    now: NOW + 10,
  });
  addObserver(built.database, ownerProject.projectId);

  const observerProject = createTestProject(built.database, {
    accountId: OBSERVER_ACCOUNT_ID,
    id: "observer_permissions_observer_project",
    now: NOW + 20,
  });
  const observerSession = createTestSessionWithScope(built.database, {
    accountId: OBSERVER_ACCOUNT_ID,
    id: "observer_permissions_observer_session",
    projectId: observerProject.projectId,
    title: "Observer owned session",
    now: NOW + 30,
  });

  const seeded = seedConversationTree(built.database, ownerSession.sessionId);
  const fixture = fullAppFixtures[fullAppFixtures.length - 1];
  if (!fixture) {
    throw new Error("Full app fixture stack was not initialized");
  }
  fixture.ownerSessionId = ownerSession.sessionId;
  fixture.observerSessionId = observerSession.sessionId;
  fixture.ownerFloorId = seeded.floorId;
  fixture.ownerPageId = seeded.pageId;
  fixture.ownerMessageId = seeded.messageId;

  await built.app.ready();
  return fixture;
}

async function buildChatPermissionApp(): Promise<MockedChatApp> {
  const connection = createDatabase(":memory:");
  const app = Fastify({ logger: false });
  app.addHook("onClose", async () => {
    connection.close();
  });
  chatApps.push(app);

  ensureObserverPermissionAccounts(connection.db);
  const project = createTestProject(connection.db, {
    accountId: OWNER_ACCOUNT_ID,
    id: "observer_permissions_chat_project",
    now: NOW,
  });
  const session = createTestSessionWithScope(connection.db, {
    accountId: OWNER_ACCOUNT_ID,
    id: "observer_permissions_chat_session",
    projectId: project.projectId,
    title: "Chat permission session",
    now: NOW + 10,
  });
  addObserver(connection.db, project.projectId);

  app.addHook("onRequest", async (request) => {
    const key = String(request.headers["x-api-key"] ?? "");
    request.authContext = {
      kind: "authenticated",
      accountId: accountIdForApiKey(key),
      role: "user",
      status: "active",
    };
  });

  const respond = vi.fn(async () => createRespondResult());
  const regenerate = vi.fn(async () => createRegenerateResult());

  await registerChatRoutes(app, {
    dryRun: vi.fn(),
    respond,
    regenerate,
    retryFloor: vi.fn(),
    editAndRegenerate: vi.fn(),
  } as unknown as ChatService, {
    enableSseChat: true,
    enablePromptDryRun: true,
    projectAccessService: new ProjectAccessService(connection.db),
  });

  await app.ready();
  return {
    app,
    sessionId: session.sessionId,
    respond,
    regenerate,
  };
}

function ensureObserverPermissionAccounts(database: DatabaseConnection["db"]): void {
  ensureTestAccount(database, OWNER_ACCOUNT_ID, NOW);
  ensureTestAccount(database, OBSERVER_ACCOUNT_ID, NOW);
  ensureTestAccount(database, OTHER_ACCOUNT_ID, NOW);
}

function seedConversationTree(database: DatabaseConnection["db"], sessionId: string): {
  floorId: string;
  pageId: string;
  messageId: string;
} {
  const floorId = "observer_permissions_owner_floor";
  const pageId = "observer_permissions_owner_page";
  const messageId = "observer_permissions_owner_message";

  database.insert(floors).values({
    id: floorId,
    sessionId,
    floorNo: 1,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 1,
    tokenOut: 1,
    createdAt: NOW + 100,
    updatedAt: NOW + 100,
  }).run();

  database.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: 0,
    pageKind: "input",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: NOW + 110,
    updatedAt: NOW + 110,
  }).run();

  database.insert(messages).values({
    id: messageId,
    pageId,
    seq: 0,
    role: "user",
    content: "Hello from the owner project.",
    contentFormat: "text",
    tokenCount: 6,
    isHidden: false,
    source: "test",
    createdAt: NOW + 120,
  }).run();

  return { floorId, pageId, messageId };
}

function addObserver(database: DatabaseConnection["db"], projectId: string): void {
  new ProjectMembershipService(database).addObserver({
    actorAccountId: OWNER_ACCOUNT_ID,
    projectId,
    accountId: OBSERVER_ACCOUNT_ID,
  });
}

async function createMemoryItem(
  fixture: FullAppFixture,
  sessionId: string,
  apiKey: string,
  factKey: string,
): Promise<string> {
  const response = await fixture.built.app.inject({
    method: "POST",
    url: "/memories",
    headers: authHeaders(apiKey),
    payload: {
      scope: "chat",
      scope_id: sessionId,
      type: "fact",
      content: { text: factKey },
      fact_key: factKey,
      importance: 0.5,
      confidence: 1,
      status: "active",
    },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data.id;
}

function authHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey };
}

function accountIdForApiKey(apiKey: string): string {
  if (apiKey === OWNER_KEY) {
    return OWNER_ACCOUNT_ID;
  }
  if (apiKey === OBSERVER_KEY) {
    return OBSERVER_ACCOUNT_ID;
  }
  return OTHER_ACCOUNT_ID;
}

function expectProjectAccessDenied(statusCode: number, body: ErrorResponse): void {
  expect(statusCode, JSON.stringify(body)).toBe(403);
  expect(body.error.code).toBe("project_access_denied");
}

function createRespondResult() {
  return {
    floorId: "observer_permissions_chat_floor",
    floorNo: 1,
    branchId: "main",
    generatedText: "生成内容",
    summaries: ["summary"],
    totalUsage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
    finalState: "committed" as const,
    memory: undefined,
  };
}

function createRegenerateResult() {
  return {
    ...createRespondResult(),
    previousFloorId: "observer_permissions_previous_floor",
  };
}
