import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { SimpleTokenCounter, type TurnExecutionResult } from "@tavern/core";
import { buildBranchVariableScopeId } from "@tavern/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

import { buildApp, type BuildAppResult } from "../src/app";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../src/db/client.js";
import { floors, messagePages, sessions, variables } from "../src/db/schema.js";
import { ChatMessagePersistence } from "../src/services/chat-message-persistence.js";
import { TurnCommitService } from "../src/services/turn-commit-service.js";
import type { WsMessage } from "../src/ws/index.js";
import { SessionBranchRegistryService } from "../src/services/variables/host/session-branch-registry-service.js";

function createMockSocket() {
  const emitter = new EventEmitter();
  const sent: string[] = [];

  const socket = {
    readyState: 1,
    send: vi.fn((data: string) => sent.push(data)),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler);
      return socket;
    },
    close: () => {
      socket.readyState = 3;
      emitter.emit("close");
    },
    _sent: sent,
  };

  return socket as {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    on: (event: string, handler: (...args: unknown[]) => void) => typeof socket;
    close: () => void;
    _sent: string[];
  } & WebSocket;
}

function parseSent(socket: ReturnType<typeof createMockSocket>): WsMessage[] {
  return socket._sent.map((entry) => JSON.parse(entry) as WsMessage);
}

async function createSession(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { title: "Phase 5 Session" },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

describe("variable events shared event bus and websocket integration", () => {
  let tempDir: string;
  let databasePath: string;
  let buildResult: BuildAppResult;
  let directDatabase: DatabaseConnection;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tavern-phase5-"));
    databasePath = join(tempDir, "phase5.sqlite");

    buildResult = await buildApp({
      databasePath,
      logger: false,
      enableWebSocket: true,
      orchestration: {
        providers: [
          {
            id: "test-provider",
            type: "openai-compatible",
            apiKey: "sk-test",
          },
        ],
        defaultModel: {
          providerId: "test-provider",
          modelId: "gpt-4o-mini",
        },
      },
    });

    directDatabase = createDatabase(databasePath);
  });

  afterEach(async () => {
    directDatabase.close();
    await buildResult.app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("forwards route-driven variable.set and variable.deleted through the shared runtime event bus", async () => {
    expect(buildResult.orchestrationContext).toBeDefined();
    expect(buildResult.wsBridge).toBeDefined();

    const sessionId = await createSession(buildResult.app);
    const sessionSocket = createMockSocket();
    const foreignSocket = createMockSocket();
    buildResult.wsBridge!.addClient(sessionSocket, sessionId);
    buildResult.wsBridge!.addClient(foreignSocket, "another-session");

    const setHandler = vi.fn();
    const deletedHandler = vi.fn();
    buildResult.orchestrationContext!.eventBus.on("variable.set", setHandler);
    buildResult.orchestrationContext!.eventBus.on("variable.deleted", deletedHandler);

    const createResponse = await buildResult.app.inject({
      method: "PUT",
      url: "/variables",
      payload: {
        scope: "chat",
        scope_id: sessionId,
        key: "mood",
        value: "steady",
      },
    });

    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const created = createResponse.json<{
      data: { id: string; scope: string; scope_id: string; key: string; value: unknown };
    }>().data;

    expect(setHandler).toHaveBeenCalledOnce();
    expect(setHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        entry: expect.objectContaining({
          id: created.id,
          scope: "chat",
          scopeId: sessionId,
          key: "mood",
          value: "steady",
        }),
        isNew: true,
      })
    );

    const deleteResponse = await buildResult.app.inject({
      method: "DELETE",
      url: `/variables/${created.id}`,
    });

    expect(deleteResponse.statusCode, deleteResponse.body).toBe(200);
    expect(deletedHandler).toHaveBeenCalledOnce();
    expect(deletedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        id: created.id,
        scope: "chat",
        key: "mood",
      })
    );

    const messages = parseSent(sessionSocket);
    const foreignMessages = parseSent(foreignSocket);
    expect(messages.map((message) => message.event)).toEqual(["variable.set", "variable.deleted"]);
    expect(foreignMessages).toHaveLength(0);
    expect(messages[0]!.data).toEqual({
      sessionId,
      entry: {
        id: created.id,
        scope: "chat",
        scopeId: sessionId,
        key: "mood",
        value: "steady",
        updatedAt: expect.any(Number),
      },
      isNew: true,
    });
    expect(messages[1]!.data).toEqual({
      sessionId,
      id: created.id,
      scope: "chat",
      key: "mood",
    });
  });

  it("includes branchId in route-driven branch variable events", async () => {
    expect(buildResult.orchestrationContext).toBeDefined();
    expect(buildResult.wsBridge).toBeDefined();

    const now = 1_735_689_890_000;
    const sessionId = await createSession(buildResult.app);
    const branchId = "alt-1";

    await directDatabase.db.insert(floors).values({
      id: nanoid(),
      sessionId,
      floorNo: 0,
      branchId,
      state: "draft",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
    new SessionBranchRegistryService(directDatabase.db).ensure({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });

    const sessionSocket = createMockSocket();
    const foreignSocket = createMockSocket();
    buildResult.wsBridge!.addClient(sessionSocket, sessionId);
    buildResult.wsBridge!.addClient(foreignSocket, "another-session");

    const setHandler = vi.fn();
    const deletedHandler = vi.fn();
    buildResult.orchestrationContext!.eventBus.on("variable.set", setHandler);
    buildResult.orchestrationContext!.eventBus.on("variable.deleted", deletedHandler);

    const createResponse = await buildResult.app.inject({
      method: "PUT",
      url: "/variables",
      payload: {
        scope: "branch",
        session_id: sessionId,
        branch_id: branchId,
        key: "route",
        value: "campfire",
      },
    });

    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const created = createResponse.json<{
      data: { id: string; scope: string; scope_id: string; key: string; value: unknown };
    }>().data;

    expect(setHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        branchId,
        entry: expect.objectContaining({
          id: created.id,
          scope: "branch",
          scopeId: buildBranchVariableScopeId(sessionId, branchId),
          key: "route",
          value: "campfire",
        }),
        isNew: true,
      }),
    );

    const deleteResponse = await buildResult.app.inject({
      method: "DELETE",
      url: `/variables/${created.id}`,
    });

    expect(deleteResponse.statusCode, deleteResponse.body).toBe(200);
    expect(deletedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        branchId,
        id: created.id,
        scope: "branch",
        key: "route",
      }),
    );

    const messages = parseSent(sessionSocket);
    const foreignMessages = parseSent(foreignSocket);
    expect(messages.map((message) => message.event)).toEqual(["variable.set", "variable.deleted"]);
    expect(foreignMessages).toHaveLength(0);
    expect(messages[0]!.data).toEqual(expect.objectContaining({ sessionId, branchId }));
    expect(messages[1]!.data).toEqual({
      sessionId,
      branchId,
      id: created.id,
      scope: "branch",
      key: "route",
    });
  });

  it("forwards commit-path variable.promoted through the shared runtime event bus", async () => {
    expect(buildResult.orchestrationContext).toBeDefined();
    expect(buildResult.wsBridge).toBeDefined();

    const sessionSocket = createMockSocket();
    const foreignSocket = createMockSocket();
    buildResult.wsBridge!.addClient(sessionSocket, "session-under-test");
    buildResult.wsBridge!.addClient(foreignSocket, "another-session");

    const promotedHandler = vi.fn();
    buildResult.orchestrationContext!.eventBus.on("variable.promoted", promotedHandler);

    const now = 1_735_689_900_000;
    const committedAt = now + 1_000;
    const sessionId = "session-under-test";
    const branchId = "alt-1";
    const floorId = nanoid();
    const pageId = nanoid();

    await directDatabase.db.insert(sessions).values({
      id: sessionId,
      title: "Phase 5 Commit Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    new SessionBranchRegistryService(directDatabase.db).ensure({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });

    await directDatabase.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 0,
      branchId,
      state: "generating",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    await directDatabase.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 0,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    const commitService = new TurnCommitService(
      directDatabase.db,
      new ChatMessagePersistence(directDatabase.db, new SimpleTokenCounter()),
      buildResult.orchestrationContext!.eventBus,
      { projectEventLiveHub: buildResult.projectEventLiveHub }
    );

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply for phase 5 verification.",
      rawText: "Assistant reply for phase 5 verification.",
      summaries: [],
      totalUsage: {
        promptTokens: 9,
        completionTokens: 6,
        totalTokens: 15,
      },
      bufferedVariableMutations: [
        {
          runId: "run-ws-promoted-variable",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "mood",
          value: "steady",
          intent: "promote_to_floor_on_accept",
          bufferedAt: now + 10,
        },
      ],
    };

    await commitService.commit({
      accountId: "default-admin",
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: {
        pageId,
      },
    });

    expect(promotedHandler).toHaveBeenCalledOnce();
    expect(promotedHandler).toHaveBeenCalledWith({
      sessionId,
      branchId,
      key: "mood",
      fromScope: "page",
      toScope: "floor",
      value: "steady",
    });

    const promotedRows = await directDatabase.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));

    expect(promotedRows).toHaveLength(1);
    expect(JSON.parse(promotedRows[0]!.valueJson)).toBe("steady");
    expect(promotedRows[0]!.updatedAt).toBe(committedAt);

    const floorRow = await directDatabase.db
      .select()
      .from(floors)
      .where(eq(floors.id, floorId));

    expect(floorRow[0]?.state).toBe("committed");

    const promotedMessages = parseSent(sessionSocket).filter((message) => message.event === "variable.promoted");
    const foreignMessages = parseSent(foreignSocket);
    expect(promotedMessages).toHaveLength(1);
    expect(foreignMessages).toHaveLength(0);
    expect(promotedMessages[0]!.data).toEqual({
      sessionId,
      branchId,
      key: "mood",
      fromScope: "page",
      toScope: "floor",
      value: "steady",
    });
  });
});
