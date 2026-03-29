import { rmSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { buildApp } from "../src/app";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { accounts, sessions } from "../src/db/schema";

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type InjectedWebSocket = {
  readyState: number;
  once(event: "close", listener: () => void): unknown;
  terminate(): void;
};

describe("WebSocket handshake account isolation", () => {
  let app: FastifyInstance;
  let seedConnection: DatabaseConnection;
  let databasePath: string;
  let tokenA: string;
  let rootToken: string;
  let sessionAId: string;
  let sessionBId: string;
  let trackedSockets: InjectedWebSocket[];

  beforeEach(async () => {
    databasePath = `data/test-ws-auth-${nanoid()}.db`;
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
      enableWebSocket: true,
    });

    app = buildResult.app;
    await app.ready();

    seedConnection = createDatabase(databasePath);
    trackedSockets = [];

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

    sessionAId = `ws-session-a-${nanoid()}`;
    sessionBId = `ws-session-b-${nanoid()}`;
    await seedConnection.db.insert(sessions).values([
      {
        id: sessionAId,
        title: "WS Session A",
        accountId: "acc-a",
        characterSyncPolicy: "pin",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: sessionBId,
        title: "WS Session B",
        accountId: "acc-b",
        characterSyncPolicy: "pin",
        status: "active",
        createdAt: now + 1,
        updatedAt: now + 1,
      },
    ]);

    tokenA = app.jwt.sign({ sub: "user-a", account_id: "acc-a", role: "admin" });
    rootToken = app.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });
  });

  afterEach(async () => {
    await Promise.all(trackedSockets.map((socket) => closeSocket(socket)));
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

  function parseErrorBody(body: string): ErrorResponse | null {
    try {
      return JSON.parse(body) as ErrorResponse;
    } catch {
      return null;
    }
  }

  async function closeSocket(socket: InjectedWebSocket): Promise<void> {
    if (socket.readyState === 3) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 500);

      socket.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });

      socket.terminate();
    });
  }

  function authHeaders(token?: string): Record<string, string> | undefined {
    if (!token) {
      return undefined;
    }

    return {
      authorization: `Bearer ${token}`,
    };
  }

  async function openWebSocket(path: string, token?: string): Promise<InjectedWebSocket> {
    return app.injectWS(path, { headers: authHeaders(token) }) as Promise<InjectedWebSocket>;
  }

  async function requestWsRoute(path: string, token?: string) {
    return app.inject({
      method: "GET",
      url: path,
      headers: authHeaders(token),
    });
  }

  async function expectRejectedHandshake(
    path: string,
    expectedStatus: number,
    expectedCode: string,
    token?: string
  ): Promise<void> {
    await expect(openWebSocket(path, token)).rejects.toThrow(
      `Unexpected server response: ${expectedStatus}`
    );

    const response = await requestWsRoute(path, token);
    expect(response.statusCode).toBe(expectedStatus);
    expect(parseErrorBody(response.body)?.error.code).toBe(expectedCode);
  }

  it("requires authentication during the WebSocket handshake", async () => {
    await expectRejectedHandshake(`/ws?session_id=${sessionAId}`, 401, "auth_required");
  });

  it("rejects global subscriptions for non-admin account rows even when the JWT claim says admin", async () => {
    await expectRejectedHandshake("/ws", 403, "ws_forbidden", tokenA);
  });

  it("enforces session ownership during the WebSocket handshake", async () => {
    const ownSocket = await openWebSocket(`/ws?session_id=${sessionAId}`, tokenA);
    trackedSockets.push(ownSocket);

    await expectRejectedHandshake(`/ws?session_id=${sessionBId}`, 404, "not_found", tokenA);
    await expectRejectedHandshake(`/ws?session_id=${sessionAId}`, 404, "not_found", rootToken);
  });

  it("allows global subscriptions for admin account rows", async () => {
    const socket = await openWebSocket("/ws", rootToken);
    trackedSockets.push(socket);
  });
});
