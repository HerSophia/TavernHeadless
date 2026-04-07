import { rmSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { buildApp } from "../src/app";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import {
  accounts,
  floors,
  messagePages,
  sessions,
  toolCallRecords,
  toolExecutionRecords,
} from "../src/db/schema";

type ItemResponse<T> = { data: T };
type ListResponse<T> = {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    sort_by: string;
    sort_order: "asc" | "desc";
  };
};
type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

describe("Tool routes multi-account isolation", () => {
  let app: FastifyInstance;
  let seedConnection: DatabaseConnection;
  let databasePath: string;
  let tokenA: string;
  let tokenB: string;
  let rootToken: string;

  beforeEach(async () => {
    databasePath = `data/test-tools-isolation-${nanoid()}.db`;
    const buildResult = await buildApp({
      databasePath,
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
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
      enableWebSocket: false,
      enableUnsafeScriptHandler: true,
    });

    app = buildResult.app;
    seedConnection = createDatabase(databasePath);

    const now = Date.now();
    await seedConnection.db.insert(accounts).values([
      {
        id: "acc-a",
        name: "Account A",
        role: "user",
        status: "active",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "acc-b",
        name: "Account B",
        role: "user",
        status: "active",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    rootToken = app.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });
    tokenA = app.jwt.sign({ sub: "user-a", account_id: "acc-a", role: "admin" });
    tokenB = app.jwt.sign({ sub: "user-b", account_id: "acc-b", role: "admin" });
  });

  afterEach(async () => {
    if (seedConnection) {
      seedConnection.close();
    }
    if (app) {
      await app.close();
    }
    if (databasePath) {
      rmSync(databasePath, { force: true });
    }
  });

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function seedSessionTree(accountId: string, label: string) {
    const now = Date.now();
    const sessionId = `${label}-session-${nanoid()}`;
    const floorId = `${label}-floor-${nanoid()}`;
    const pageId = `${label}-page-${nanoid()}`;

    await seedConnection.db.insert(sessions).values({
      id: sessionId,
      title: `${label} Session`,
      accountId,
      characterSyncPolicy: "pin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await seedConnection.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    await seedConnection.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    return { sessionId, floorId, pageId };
  }

  it("allows different accounts to create the same custom tool name", async () => {
    const createA = await app.inject({
      method: "POST",
      url: "/tools/definitions",
      headers: authHeaders(tokenA),
      payload: {
        name: "shared_tool",
        description: "Account A shared tool",
        source: "custom",
        handler_type: "script",
        handler: { script: "return 'a'" },
      },
    });
    expect(createA.statusCode, createA.body).toBe(201);

    const createB = await app.inject({
      method: "POST",
      url: "/tools/definitions",
      headers: authHeaders(tokenB),
      payload: {
        name: "shared_tool",
        description: "Account B shared tool",
        source: "custom",
        handler_type: "script",
        handler: { script: "return 'b'" },
      },
    });
    expect(createB.statusCode, createB.body).toBe(201);
  });

  it("isolates tool definition CRUD by account", async () => {
    const createA = await app.inject({
      method: "POST",
      url: "/tools/definitions",
      headers: authHeaders(tokenA),
      payload: {
        name: "account_a_tool",
        description: "Account A tool",
        source: "custom",
        handler_type: "script",
        handler: { script: "return 'a'" },
      },
    });
    expect(createA.statusCode, createA.body).toBe(201);
    const definitionA = createA.json<ItemResponse<{ id: string }>>().data;

    const createB = await app.inject({
      method: "POST",
      url: "/tools/definitions",
      headers: authHeaders(tokenB),
      payload: {
        name: "account_b_tool",
        description: "Account B tool",
        source: "custom",
        handler_type: "script",
        handler: { script: "return 'b'" },
      },
    });
    expect(createB.statusCode, createB.body).toBe(201);
    const definitionB = createB.json<ItemResponse<{ id: string }>>().data;

    const listA = await app.inject({
      method: "GET",
      url: "/tools/definitions",
      headers: authHeaders(tokenA),
    });
    expect(listA.statusCode).toBe(200);
    const listABody = listA.json<ListResponse<{ id: string }>>();
    expect(listABody.data.map((item) => item.id)).toContain(definitionA.id);
    expect(listABody.data.map((item) => item.id)).not.toContain(definitionB.id);

    const listB = await app.inject({
      method: "GET",
      url: "/tools/definitions",
      headers: authHeaders(tokenB),
    });
    expect(listB.statusCode).toBe(200);
    const listBBody = listB.json<ListResponse<{ id: string }>>();
    expect(listBBody.data.map((item) => item.id)).toContain(definitionB.id);
    expect(listBBody.data.map((item) => item.id)).not.toContain(definitionA.id);

    const foreignGet = await app.inject({
      method: "GET",
      url: `/tools/definitions/${definitionA.id}`,
      headers: authHeaders(tokenB),
    });
    expect(foreignGet.statusCode).toBe(404);

    const foreignPatch = await app.inject({
      method: "PATCH",
      url: `/tools/definitions/${definitionA.id}`,
      headers: authHeaders(tokenB),
      payload: { description: "foreign update" },
    });
    expect(foreignPatch.statusCode).toBe(404);

    const foreignToggle = await app.inject({
      method: "PATCH",
      url: `/tools/definitions/${definitionA.id}/toggle`,
      headers: authHeaders(tokenB),
      payload: { enabled: false },
    });
    expect(foreignToggle.statusCode).toBe(404);

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/tools/definitions/${definitionA.id}`,
      headers: authHeaders(tokenB),
    });
    expect(foreignDelete.statusCode).toBe(404);

    const adminGet = await app.inject({
      method: "GET",
      url: `/tools/definitions/${definitionA.id}`,
      headers: authHeaders(rootToken),
    });
    expect(adminGet.statusCode).toBe(404);

    const ownerGet = await app.inject({
      method: "GET",
      url: `/tools/definitions/${definitionA.id}`,
      headers: authHeaders(tokenA),
    });
    expect(ownerGet.statusCode).toBe(200);
  });

  it("scopes tool call records and execution journals by account", async () => {
    const sessionA = await seedSessionTree("acc-a", "account-a");
    const sessionB = await seedSessionTree("acc-b", "account-b");
    const now = Date.now();

    const callRecordAId = `call-a-${nanoid()}`;
    const callRecordBId = `call-b-${nanoid()}`;
    await seedConnection.db.insert(toolCallRecords).values([
      {
        id: callRecordAId,
        pageId: sessionA.pageId,
        seq: 0,
        callerSlot: "narrator",
        toolName: "roll_dice",
        argsJson: JSON.stringify({ sides: 20 }),
        resultJson: JSON.stringify({ total: 8 }),
        status: "success",
        durationMs: 5,
        createdAt: now,
      },
      {
        id: callRecordBId,
        pageId: sessionB.pageId,
        seq: 0,
        callerSlot: "narrator",
        toolName: "roll_dice",
        argsJson: JSON.stringify({ sides: 20 }),
        resultJson: JSON.stringify({ total: 12 }),
        status: "success",
        durationMs: 6,
        createdAt: now + 1,
      },
    ]);

    const executionAId = `exec-a-${nanoid()}`;
    const executionBId = `exec-b-${nanoid()}`;
    await seedConnection.db.insert(toolExecutionRecords).values([
      {
        id: executionAId,
        runId: `run-a-${nanoid()}`,
        floorId: sessionA.floorId,
        pageId: sessionA.pageId,
        callerSlot: "narrator",
        providerId: "builtin",
        providerType: "builtin",
        toolName: "roll_dice",
        argsJson: JSON.stringify({ sides: 20 }),
        resultJson: JSON.stringify({ total: 8 }),
        status: "success",
        lifecycleState: "finished",
        commitOutcome: "committed",
        sideEffectLevel: "none",
        errorMessage: null,
        durationMs: 5,
        startedAt: now,
        finishedAt: now + 5,
        attemptNo: 1,
        replayParentExecutionId: null,
        createdAt: now,
      },
      {
        id: executionBId,
        runId: `run-b-${nanoid()}`,
        floorId: sessionB.floorId,
        pageId: sessionB.pageId,
        callerSlot: "narrator",
        providerId: "builtin",
        providerType: "builtin",
        toolName: "roll_dice",
        argsJson: JSON.stringify({ sides: 20 }),
        resultJson: JSON.stringify({ total: 12 }),
        status: "success",
        lifecycleState: "finished",
        commitOutcome: "committed",
        sideEffectLevel: "none",
        errorMessage: null,
        durationMs: 6,
        startedAt: now + 1,
        finishedAt: now + 6,
        attemptNo: 1,
        replayParentExecutionId: null,
        createdAt: now + 1,
      },
    ]);

    const ownCallRecords = await app.inject({
      method: "GET",
      url: `/tools/call-records?page_id=${sessionA.pageId}`,
      headers: authHeaders(tokenA),
    });
    expect(ownCallRecords.statusCode).toBe(200);
    expect(ownCallRecords.json<ListResponse<{ id: string }>>().data).toEqual([
      expect.objectContaining({ id: callRecordAId }),
    ]);

    const foreignCallRecords = await app.inject({
      method: "GET",
      url: `/tools/call-records?page_id=${sessionB.pageId}`,
      headers: authHeaders(tokenA),
    });
    expect(foreignCallRecords.statusCode).toBe(200);
    expect(foreignCallRecords.json<ListResponse<{ id: string }>>().data).toEqual([]);
    expect(foreignCallRecords.json<ListResponse<{ id: string }>>().meta.total).toBe(0);

    const foreignFloorCallRecords = await app.inject({
      method: "GET",
      url: `/tools/call-records?floor_id=${sessionB.floorId}`,
      headers: authHeaders(tokenA),
    });
    expect(foreignFloorCallRecords.statusCode).toBe(200);
    expect(foreignFloorCallRecords.json<ListResponse<{ id: string }>>().data).toEqual([]);

    const ownExecutionRecords = await app.inject({
      method: "GET",
      url: `/tool-executions?session_id=${sessionA.sessionId}`,
      headers: authHeaders(tokenA),
    });
    expect(ownExecutionRecords.statusCode).toBe(200);
    expect(ownExecutionRecords.json<ListResponse<{ id: string }>>().data).toEqual([
      expect.objectContaining({ id: executionAId }),
    ]);

    const foreignExecutionRecords = await app.inject({
      method: "GET",
      url: `/tool-executions?session_id=${sessionB.sessionId}`,
      headers: authHeaders(tokenA),
    });
    expect(foreignExecutionRecords.statusCode).toBe(200);
    expect(foreignExecutionRecords.json<ListResponse<{ id: string }>>().data).toEqual([]);
    expect(foreignExecutionRecords.json<ListResponse<{ id: string }>>().meta.total).toBe(0);

    const foreignFloorExecutionRecords = await app.inject({
      method: "GET",
      url: `/floors/${sessionB.floorId}/tool-executions`,
      headers: authHeaders(tokenA),
    });
    expect(foreignFloorExecutionRecords.statusCode).toBe(200);
    expect(foreignFloorExecutionRecords.json<ListResponse<{ id: string }>>().data).toEqual([]);
  });

  it("isolates the session runtime tool catalog by session ownership", async () => {
    const sessionA = await seedSessionTree("acc-a", "runtime-a");
    const sessionB = await seedSessionTree("acc-b", "runtime-b");

    const ownCatalog = await app.inject({
      method: "GET",
      url: `/sessions/${sessionA.sessionId}/tools/runtime`,
      headers: authHeaders(tokenA),
    });
    expect(ownCatalog.statusCode, ownCatalog.body).toBe(200);
    expect(ownCatalog.json<ItemResponse<{ session_id: string; tools: unknown[] }>>().data).toEqual(
      expect.objectContaining({
        session_id: sessionA.sessionId,
        tools: expect.any(Array),
      }),
    );

    const foreignCatalog = await app.inject({
      method: "GET",
      url: `/sessions/${sessionB.sessionId}/tools/runtime`,
      headers: authHeaders(tokenA),
    });
    expect(foreignCatalog.statusCode).toBe(404);
    expect(foreignCatalog.json<ErrorResponse>().error.code).toBe("not_found");

    const adminCatalog = await app.inject({
      method: "GET",
      url: `/sessions/${sessionA.sessionId}/tools/runtime`,
      headers: authHeaders(rootToken),
    });
    expect(adminCatalog.statusCode).toBe(404);
    expect(adminCatalog.json<ErrorResponse>().error.code).toBe("not_found");
  });
});
