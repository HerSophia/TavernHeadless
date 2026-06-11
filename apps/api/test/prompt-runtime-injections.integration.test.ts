import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { ZodError } from "zod";

import { buildApp } from "../src/app";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { createDatabase, type AppDb, type DatabaseConnection } from "../src/db/client.js";
import { floors, sessions } from "../src/db/schema.js";
import { sendError } from "../src/lib/http.js";
import { registerPromptRuntimeRoutes } from "../src/routes/prompt-runtime";
import { PromptRuntimeControlService } from "../src/services/prompt-runtime-control-service.js";
import { PromptRuntimeInjectionService } from "../src/services/prompt-runtime/injection-service.js";
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth";

describe("prompt runtime injection integration", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    app = Fastify({ logger: false });
    await registerDevelopmentTestAuth(app, database.db);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) {
        return sendError(reply, 400, "validation_error", "Request validation failed");
      }
      return sendError(reply, 500, "internal_error", error instanceof Error ? error.message : "Unknown error");
    });

    await registerPromptRuntimeRoutes(
      app,
      new PromptRuntimeControlService(database.db),
      { injectionService: new PromptRuntimeInjectionService(database.db) },
    );
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("supports session and branch injection CRUD end to end", async () => {
    const sessionId = await insertSession(database.db, { branchId: "alt-branch" });

    const createSessionResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/injections`,
      payload: {
        source_kind: "client_injection",
        title: "Session guard",
        content: "Keep the session in focus.",
        placement: "before_history",
      },
    });
    expect(createSessionResponse.statusCode, createSessionResponse.body).toBe(201);
    const sessionInjectionId = createSessionResponse.json<{ data: { id: string } }>().data.id;

    const listSessionResponse = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/prompt-runtime/injections`,
    });
    expect(listSessionResponse.statusCode, listSessionResponse.body).toBe(200);
    expect(listSessionResponse.json()).toMatchObject({
      data: [
        {
          id: sessionInjectionId,
          scope: "session",
          source_kind: "client_injection",
          title: "Session guard",
        },
      ],
    });

    const patchSessionResponse = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}/prompt-runtime/injections/${sessionInjectionId}`,
      payload: {
        enabled: false,
        mode_scope: "native",
        ttl_ms: 120000,
      },
    });
    expect(patchSessionResponse.statusCode, patchSessionResponse.body).toBe(200);
    expect(patchSessionResponse.json()).toMatchObject({
      data: {
        id: sessionInjectionId,
        enabled: false,
        mode_scope: "native",
        ttl_ms: 120000,
      },
    });

    const createBranchResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt-branch/injections`,
      payload: {
        source_kind: "client_injection",
        title: "Branch guard",
        content: "Keep the branch in focus.",
        placement: "before_history",
      },
    });
    expect(createBranchResponse.statusCode, createBranchResponse.body).toBe(201);
    const branchInjectionId = createBranchResponse.json<{ data: { id: string } }>().data.id;

    const listBranchResponse = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt-branch/injections`,
    });
    expect(listBranchResponse.statusCode, listBranchResponse.body).toBe(200);
    expect(listBranchResponse.json()).toMatchObject({
      data: [
        {
          id: branchInjectionId,
          scope: "branch",
          source_kind: "client_injection",
          title: "Branch guard",
        },
      ],
    });

    const deleteSessionResponse = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}/prompt-runtime/injections/${sessionInjectionId}`,
    });
    expect(deleteSessionResponse.statusCode, deleteSessionResponse.body).toBe(200);

    const deleteBranchResponse = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt-branch/injections/${branchInjectionId}`,
    });
    expect(deleteBranchResponse.statusCode, deleteBranchResponse.body).toBe(200);
  });

  it("rejects invalid payloads and exposes injection summary on resolved state", async () => {
    const sessionId = await insertSession(database.db, { branchId: "alt-branch" });

    const invalidResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/injections`,
      payload: {
        source_kind: "client_injection",
        title: "   ",
        content: "Body",
        placement: "before_history",
      },
    });
    expect(invalidResponse.statusCode, invalidResponse.body).toBe(400);

    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/injections`,
      payload: {
        source_kind: "client_injection",
        title: "Session guard",
        content: "Keep the session in focus.",
        placement: "before_history",
      },
    });
    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt-branch/injections`,
      payload: {
        source_kind: "client_injection",
        title: "Branch guard",
        content: "Keep the branch in focus.",
        placement: "before_history",
        enabled: false,
      },
    });

    const resolvedStateResponse = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/prompt-runtime?branch_id=alt-branch`,
    });
    expect(resolvedStateResponse.statusCode, resolvedStateResponse.body).toBe(200);
    expect(resolvedStateResponse.json()).toMatchObject({
      data: {
        injections: {
          session: { total: 1, enabled: 1 },
          branch: { total: 1, enabled: 0 },
        },
      },
    });
  });
});

describe("prompt runtime injection auth integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: {
        mode: "jwt",
        jwtSecret: "prompt-runtime-injection-test-secret",
      },
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("enforces account ownership across session and branch injection CRUD routes", async () => {
    const rootToken = app.jwt.sign({
      sub: DEFAULT_ADMIN_ACCOUNT_ID,
      account_id: DEFAULT_ADMIN_ACCOUNT_ID,
      role: "user",
    });

    await createAccount(app, rootToken, "acc-a", "Account A");
    await createAccount(app, rootToken, "acc-b", "Account B");

    const tokenA = app.jwt.sign({ sub: "acc-a", account_id: "acc-a", role: "admin" });
    const tokenB = app.jwt.sign({ sub: "acc-b", account_id: "acc-b", role: "admin" });

    const createSessionResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: bearer(tokenA),
      payload: { title: "Owned prompt runtime session" },
    });
    expect(createSessionResponse.statusCode, createSessionResponse.body).toBe(201);
    const sessionId = createSessionResponse.json<{ data: { id: string } }>().data.id;

    const createBranchFloorResponse = await app.inject({
      method: "POST",
      url: "/floors",
      headers: bearer(tokenA),
      payload: {
        session_id: sessionId,
        floor_no: 0,
        branch_id: "alt",
      },
    });
    expect(createBranchFloorResponse.statusCode, createBranchFloorResponse.body).toBe(201);

    const createSessionInjectionResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/injections`,
      headers: bearer(tokenA),
      payload: {
        source_kind: "client_injection",
        title: "Owner session",
        content: "Only the owner may edit this session injection.",
        placement: "before_current_user_input",
      },
    });
    expect(createSessionInjectionResponse.statusCode, createSessionInjectionResponse.body).toBe(201);
    const sessionInjectionId = createSessionInjectionResponse.json<{ data: { id: string } }>().data.id;

    const createBranchInjectionResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt/injections`,
      headers: bearer(tokenA),
      payload: {
        source_kind: "client_injection",
        title: "Owner branch",
        content: "Only the owner may edit this branch injection.",
        placement: "before_current_user_input",
      },
    });
    expect(createBranchInjectionResponse.statusCode, createBranchInjectionResponse.body).toBe(201);
    const branchInjectionId = createBranchInjectionResponse.json<{ data: { id: string } }>().data.id;

    const foreignSessionListResponse = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/prompt-runtime/injections`,
      headers: bearer(tokenB),
    });
    expect(foreignSessionListResponse.statusCode, foreignSessionListResponse.body).toBe(404);
    expect(foreignSessionListResponse.json<{ error: { code: string } }>().error.code).toBe("session_not_found");

    const foreignSessionCreateResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/injections`,
      headers: bearer(tokenB),
      payload: {
        source_kind: "client_injection",
        title: "Foreign session",
        content: "Forbidden session write.",
        placement: "before_current_user_input",
      },
    });
    expect(foreignSessionCreateResponse.statusCode, foreignSessionCreateResponse.body).toBe(403);
    expect(foreignSessionCreateResponse.json<{ error: { code: string } }>().error.code).toBe("project_access_denied");

    const foreignSessionPatchResponse = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}/prompt-runtime/injections/${sessionInjectionId}`,
      headers: bearer(tokenB),
      payload: { enabled: false },
    });
    expect(foreignSessionPatchResponse.statusCode, foreignSessionPatchResponse.body).toBe(403);
    expect(foreignSessionPatchResponse.json<{ error: { code: string } }>().error.code).toBe("project_access_denied");

    const foreignSessionDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}/prompt-runtime/injections/${sessionInjectionId}`,
      headers: bearer(tokenB),
    });
    expect(foreignSessionDeleteResponse.statusCode, foreignSessionDeleteResponse.body).toBe(403);
    expect(foreignSessionDeleteResponse.json<{ error: { code: string } }>().error.code).toBe("project_access_denied");

    const foreignBranchListResponse = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt/injections`,
      headers: bearer(tokenB),
    });
    expect(foreignBranchListResponse.statusCode, foreignBranchListResponse.body).toBe(404);
    expect(foreignBranchListResponse.json<{ error: { code: string } }>().error.code).toBe("session_not_found");

    const foreignBranchCreateResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt/injections`,
      headers: bearer(tokenB),
      payload: {
        source_kind: "client_injection",
        title: "Foreign branch",
        content: "Forbidden branch write.",
        placement: "before_current_user_input",
      },
    });
    expect(foreignBranchCreateResponse.statusCode, foreignBranchCreateResponse.body).toBe(403);
    expect(foreignBranchCreateResponse.json<{ error: { code: string } }>().error.code).toBe("project_access_denied");

    const foreignBranchPatchResponse = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt/injections/${branchInjectionId}`,
      headers: bearer(tokenB),
      payload: { enabled: false },
    });
    expect(foreignBranchPatchResponse.statusCode, foreignBranchPatchResponse.body).toBe(403);
    expect(foreignBranchPatchResponse.json<{ error: { code: string } }>().error.code).toBe("project_access_denied");

    const foreignBranchDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt/injections/${branchInjectionId}`,
      headers: bearer(tokenB),
    });
    expect(foreignBranchDeleteResponse.statusCode, foreignBranchDeleteResponse.body).toBe(403);
    expect(foreignBranchDeleteResponse.json<{ error: { code: string } }>().error.code).toBe("project_access_denied");

    const ownerPatchResponse = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}/prompt-runtime/injections/${sessionInjectionId}`,
      headers: bearer(tokenA),
      payload: { enabled: false },
    });
    expect(ownerPatchResponse.statusCode, ownerPatchResponse.body).toBe(200);
    expect(ownerPatchResponse.json()).toMatchObject({
      data: {
        id: sessionInjectionId,
        enabled: false,
      },
    });

    const ownerDeleteSessionResponse = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}/prompt-runtime/injections/${sessionInjectionId}`,
      headers: bearer(tokenA),
    });
    expect(ownerDeleteSessionResponse.statusCode, ownerDeleteSessionResponse.body).toBe(200);

    const ownerDeleteBranchResponse = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt/injections/${branchInjectionId}`,
      headers: bearer(tokenA),
    });
    expect(ownerDeleteBranchResponse.statusCode, ownerDeleteBranchResponse.body).toBe(200);
  });
});

describe("prompt runtime injection inspect integration", () => {
  let app: FastifyInstance;
  let database: AppDb;

  beforeEach(async () => {
    const built = await buildApp({
      databasePath: ":memory:",
      logger: false,
      enableWebSocket: false,
      orchestration: {
        providers: [
          {
            id: "default-openai",
            type: "openai-compatible",
            apiKey: "sk-default",
          },
        ],
        defaultModel: {
          providerId: "default-openai",
          modelId: "gpt-4o-mini",
        },
      },
    });
    app = built.app;
    database = built.database;
  });

  afterEach(async () => {
    await app.close();
  });

  it("merges session branch and request injections in inspect output with stable scope ordering", async () => {
    const createSessionRootResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Inspect prompt runtime session" },
    });
    expect(createSessionRootResponse.statusCode, createSessionRootResponse.body).toBe(201);
    const sessionId = createSessionRootResponse.json<{ data: { id: string } }>().data.id;

    const createAltFloorResponse = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: sessionId,
        floor_no: 0,
        branch_id: "alt",
        state: "committed",
      },
    });
    expect(createAltFloorResponse.statusCode, createAltFloorResponse.body).toBe(201);

    const createSessionResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/injections`,
      payload: {
        source_kind: "client_injection",
        title: "Session guide",
        content: "Session layer.",
        placement: "before_current_user_input",
        order: 50,
      },
    });
    expect(createSessionResponse.statusCode, createSessionResponse.body).toBe(201);
    const sessionInjectionId = createSessionResponse.json<{ data: { id: string } }>().data.id;

    const createBranchResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/branches/alt/injections`,
      payload: {
        source_kind: "client_injection",
        title: "Branch guide",
        content: "Branch layer.",
        placement: "before_current_user_input",
        order: 50,
      },
    });
    expect(createBranchResponse.statusCode, createBranchResponse.body).toBe(201);
    const branchInjectionId = createBranchResponse.json<{ data: { id: string } }>().data.id;

    const inspectResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/inspect`,
      payload: {
        message: "Continue the march.",
        branch_id: "alt",
        prompt_runtime_injections: [
          {
            source_kind: "client_injection",
            title: "Request guide",
            content: "Request layer.",
            placement: "before_current_user_input",
            order: 50,
          },
        ],
      },
    });
    expect(inspectResponse.statusCode, inspectResponse.body).toBe(200);

    const body = inspectResponse.json<{
      data: {
        injections: Array<{
          request_index: number;
          injection_id: string | null;
          scope: "session" | "branch" | "request";
          title: string;
          order_requested: number;
          applied: boolean;
        }>;
        prepared_turn: {
          messages: Array<{ content: string }>;
        };
      };
    }>();

    expect(body.data.injections).toMatchObject([
      {
        request_index: 0,
        injection_id: sessionInjectionId,
        scope: "session",
        title: "Session guide",
        order_requested: 50,
        applied: true,
      },
      {
        request_index: 1,
        injection_id: branchInjectionId,
        scope: "branch",
        title: "Branch guide",
        order_requested: 50,
        applied: true,
      },
      {
        request_index: 2,
        injection_id: null,
        scope: "request",
        title: "Request guide",
        order_requested: 50,
        applied: true,
      },
    ]);

    expect(body.data.injections.map((item) => item.scope)).toEqual([
      "session",
      "branch",
      "request",
    ]);
  });
});

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createAccount(
  app: FastifyInstance,
  rootToken: string,
  id: string,
  name: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    headers: bearer(rootToken),
    payload: { id, name, role: "user" },
  });
  expect(response.statusCode, response.body).toBe(201);
}

async function insertSession(
  database: AppDb,
  args: { branchId?: string; accountId?: string } = {},
) {
  const now = Date.now();
  const sessionId = nanoid();

  await database.insert(sessions).values({
    id: sessionId,
    title: "Prompt runtime session",
    accountId: args.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    characterId: null,
    characterSnapshotJson: null,
    characterSyncPolicy: "manual",
    characterVersionId: null,
    projectId: null,
    workspaceId: null,
    presetId: null,
    worldbookProfileId: null,
    regexProfileId: null,
    deepBinding: false,
    presetVersionId: null,
    worldbookVersionId: null,
    regexProfileVersionId: null,
    userId: null,
    userSnapshotJson: null,
    modelProvider: null,
    modelName: null,
    modelParamsJson: null,
    promptMode: null,
    metadataJson: null,
    createdAt: now,
    updatedAt: now,
  });

  await database.insert(floors).values({
    id: nanoid(),
    sessionId,
    floorNo: 0,
    branchId: "main",
    parentFloorId: null,
    supersededAt: null,
    supersededByFloorId: null,
    state: "committed",
    metadataJson: null,
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });

  if (args.branchId) {
    await database.insert(floors).values({
      id: nanoid(),
      sessionId,
      floorNo: 1,
      branchId: args.branchId,
      parentFloorId: null,
      supersededAt: null,
      supersededByFloorId: null,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });
  }

  return sessionId;
}
