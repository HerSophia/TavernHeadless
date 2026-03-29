import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { FastifyInstance } from "fastify";

const runtimeMockState = vi.hoisted(() => {
  const instances = new Map<string, any>();

  class MockMcpConnection {
    config: any;
    state = "disconnected";
    error: string | undefined;
    connectedAt: number | undefined;
    toolsRefreshedAt: number | undefined;
    reconnectRequired = false;
    lastTimeoutAt: number | undefined;
    connectCalls = 0;
    disconnectCalls = 0;
    private tools: Array<Record<string, unknown>> = [];

    constructor(config: any) {
      this.config = config;
      instances.set(config.id, this);
    }

    get toolCount(): number {
      return this.tools.length;
    }

    async connect(): Promise<void> {
      this.connectCalls += 1;
      this.state = "connected";
      this.error = undefined;
      this.connectedAt = Date.now();
      this.toolsRefreshedAt = Date.now();
      this.reconnectRequired = false;
      this.lastTimeoutAt = undefined;
      this.tools = [
        {
          name: `${this.config.toolPrefix ?? ""}${this.config.id}_echo`,
          description: `Mock MCP tool for ${this.config.name}`,
          parameters: { type: "object", properties: {} },
          sideEffectLevel: this.config.defaultSideEffectLevel,
          allowedSlots: [],
          source: "mcp",
        },
      ];
    }

    async disconnect(): Promise<void> {
      this.disconnectCalls += 1;
      this.state = "disconnected";
      this.connectedAt = undefined;
      this.toolsRefreshedAt = undefined;
      this.reconnectRequired = false;
      this.lastTimeoutAt = undefined;
      this.tools = [];
    }

    getTools(): Array<Record<string, unknown>> {
      return this.tools;
    }
  }

  return {
    instances,
    MockMcpConnection,
  };
});

vi.mock("../src/mcp/mcp-connection.js", () => ({
  McpConnection: runtimeMockState.MockMcpConnection,
}));

import * as schema from "../src/db/schema.js";
import { buildApp } from "../src/app";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { accounts, sessions } from "../src/db/schema";

const MIGRATIONS_PATH = fileURLToPath(new URL("../drizzle", import.meta.url));

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

type McpServerResponse = {
  id: string;
  name: string;
  tool_prefix: string | null;
  enabled: boolean;
};

type McpStatusResponse = {
  server_id: string;
  state: string;
  tool_count: number;
};

type RuntimeCatalogResponse = {
  data: {
    session_id: string;
    tools: Array<{
      name: string;
      provider_id: string;
      provider_type: string;
      source: string;
    }>;
  };
};

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

function createPreMcpAccountScopeMigrationsDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "tavern-mcp-account-scope-"));
  const metaDir = join(tempDir, "meta");

  cpSync(MIGRATIONS_PATH, tempDir, {
    recursive: true,
    filter: (source) => {
      return !source.endsWith("0021_mcp_account_scope.sql")
        && !source.endsWith("meta\\_journal.json")
        && !source.endsWith("meta/_journal.json");
    },
  });

  const journal = JSON.parse(readFileSync(join(MIGRATIONS_PATH, "meta", "_journal.json"), "utf-8")) as {
    entries: Array<{ idx: number }>;
  };
  const trimmedJournal = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx < 21),
  };
  writeFileSync(join(metaDir, "_journal.json"), JSON.stringify(trimmedJournal, null, 2));

  return tempDir;
}

describe("MCP account scope isolation", () => {
  let app: FastifyInstance;
  let seedConnection: DatabaseConnection;
  let databasePath: string;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    runtimeMockState.instances.clear();
    databasePath = `data/test-mcp-account-scope-${nanoid()}.db`;

    ({ app } = await buildApp({
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
      enableMcp: true,
      enableWebSocket: false,
    }));

    await app.ready();
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
        createdAt: now + 1,
        updatedAt: now + 1,
      },
    ]);

    tokenA = app.jwt.sign({ sub: "user-a", account_id: "acc-a", role: "admin" });
    tokenB = app.jwt.sign({ sub: "user-b", account_id: "acc-b", role: "admin" });
  });

  afterEach(async () => {
    runtimeMockState.instances.clear();
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

  async function createSession(accountId: string, title: string): Promise<string> {
    const now = Date.now();
    const sessionId = `mcp-session-${nanoid()}`;
    await seedConnection.db.insert(sessions).values({
      id: sessionId,
      title,
      accountId,
      characterSyncPolicy: "pin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return sessionId;
  }

  async function createServer(
    token: string,
    name: string,
    toolPrefix: string,
    enabled = true
  ): Promise<McpServerResponse> {
    const response = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      headers: authHeaders(token),
      payload: {
        name,
        transport: "stdio",
        stdio: {
          command: "node",
          args: ["server.js"],
        },
        tool_prefix: toolPrefix,
        enabled,
      },
    });

    expect(response.statusCode).toBe(201);
    return response.json<ItemResponse<McpServerResponse>>().data;
  }

  it("isolates MCP config CRUD by account and allows same names across accounts", async () => {
    const configA = await createServer(tokenA, "shared-mcp", "a_");
    const configB = await createServer(tokenB, "shared-mcp", "b_");

    const listA = await app.inject({
      method: "GET",
      url: "/mcp/servers",
      headers: authHeaders(tokenA),
    });
    expect(listA.statusCode).toBe(200);
    expect(listA.json<ListResponse<McpServerResponse>>().data.map((item) => item.id)).toEqual([configA.id]);

    const listB = await app.inject({
      method: "GET",
      url: "/mcp/servers",
      headers: authHeaders(tokenB),
    });
    expect(listB.statusCode).toBe(200);
    expect(listB.json<ListResponse<McpServerResponse>>().data.map((item) => item.id)).toEqual([configB.id]);

    const foreignGet = await app.inject({
      method: "GET",
      url: `/mcp/servers/${configB.id}`,
      headers: authHeaders(tokenA),
    });
    expect(foreignGet.statusCode).toBe(404);
    expect(foreignGet.json<ErrorResponse>().error.code).toBe("not_found");

    const foreignPatch = await app.inject({
      method: "PATCH",
      url: `/mcp/servers/${configB.id}`,
      headers: authHeaders(tokenA),
      payload: {
        tool_prefix: "hijack_",
      },
    });
    expect(foreignPatch.statusCode).toBe(404);
    expect(foreignPatch.json<ErrorResponse>().error.code).toBe("not_found");

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/mcp/servers/${configB.id}`,
      headers: authHeaders(tokenA),
    });
    expect(foreignDelete.statusCode).toBe(404);
    expect(foreignDelete.json<ErrorResponse>().error.code).toBe("not_found");

    const ownGetB = await app.inject({
      method: "GET",
      url: `/mcp/servers/${configB.id}`,
      headers: authHeaders(tokenB),
    });
    expect(ownGetB.statusCode).toBe(200);
    expect(ownGetB.json<ItemResponse<McpServerResponse>>().data.tool_prefix).toBe("b_");
  });

  it("isolates MCP runtime operations and status listing by account", async () => {
    const configA = await createServer(tokenA, "runtime-shared", "a_");
    const configB = await createServer(tokenB, "runtime-shared", "b_");

    const connectA = await app.inject({
      method: "POST",
      url: `/mcp/servers/${configA.id}/connect`,
      headers: authHeaders(tokenA),
    });
    expect(connectA.statusCode).toBe(200);

    const connectB = await app.inject({
      method: "POST",
      url: `/mcp/servers/${configB.id}/connect`,
      headers: authHeaders(tokenB),
    });
    expect(connectB.statusCode).toBe(200);

    expect(runtimeMockState.instances.get(configA.id)?.connectCalls).toBe(1);
    expect(runtimeMockState.instances.get(configB.id)?.connectCalls).toBe(1);

    const statusesA = await app.inject({
      method: "GET",
      url: "/mcp/statuses",
      headers: authHeaders(tokenA),
    });
    expect(statusesA.statusCode).toBe(200);
    expect(statusesA.json<ItemResponse<McpStatusResponse[]>>().data.map((item) => item.server_id)).toEqual([configA.id]);

    const statusesB = await app.inject({
      method: "GET",
      url: "/mcp/statuses",
      headers: authHeaders(tokenB),
    });
    expect(statusesB.statusCode).toBe(200);
    expect(statusesB.json<ItemResponse<McpStatusResponse[]>>().data.map((item) => item.server_id)).toEqual([configB.id]);

    const ownToolsA = await app.inject({
      method: "GET",
      url: `/mcp/servers/${configA.id}/tools`,
      headers: authHeaders(tokenA),
    });
    expect(ownToolsA.statusCode).toBe(200);
    expect((ownToolsA.json() as ItemResponse<Array<{ name: string }>>).data[0]?.name).toMatch(/^a_/);

    const foreignStatus = await app.inject({
      method: "GET",
      url: `/mcp/servers/${configB.id}/status`,
      headers: authHeaders(tokenA),
    });
    expect(foreignStatus.statusCode).toBe(404);
    expect(foreignStatus.json<ErrorResponse>().error.code).toBe("not_found");

    const foreignTools = await app.inject({
      method: "GET",
      url: `/mcp/servers/${configB.id}/tools`,
      headers: authHeaders(tokenA),
    });
    expect(foreignTools.statusCode).toBe(404);
    expect(foreignTools.json<ErrorResponse>().error.code).toBe("not_found");

    const foreignDisconnect = await app.inject({
      method: "POST",
      url: `/mcp/servers/${configB.id}/disconnect`,
      headers: authHeaders(tokenA),
    });
    expect(foreignDisconnect.statusCode).toBe(404);
    expect(foreignDisconnect.json<ErrorResponse>().error.code).toBe("not_found");

    const foreignTest = await app.inject({
      method: "POST",
      url: `/mcp/servers/${configB.id}/test`,
      headers: authHeaders(tokenA),
    });
    expect(foreignTest.statusCode).toBe(404);
    expect(foreignTest.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("scopes session runtime MCP tools by session account", async () => {
    const sessionAId = await createSession("acc-a", "Session A");
    const sessionBId = await createSession("acc-b", "Session B");

    const configA = await createServer(tokenA, "runtime-catalog-shared", "acca_");
    const configB = await createServer(tokenB, "runtime-catalog-shared", "accb_");

    const connectA = await app.inject({
      method: "POST",
      url: `/mcp/servers/${configA.id}/connect`,
      headers: authHeaders(tokenA),
    });
    expect(connectA.statusCode).toBe(200);

    const connectB = await app.inject({
      method: "POST",
      url: `/mcp/servers/${configB.id}/connect`,
      headers: authHeaders(tokenB),
    });
    expect(connectB.statusCode).toBe(200);

    const catalogA = await app.inject({
      method: "GET",
      url: `/sessions/${sessionAId}/tools/runtime`,
      headers: authHeaders(tokenA),
    });
    expect(catalogA.statusCode).toBe(200);
    const mcpToolsA = catalogA
      .json<RuntimeCatalogResponse>()
      .data.tools
      .filter((tool) => tool.source === "mcp");
    expect(mcpToolsA.map((tool) => tool.provider_id)).toEqual([`mcp:${configA.id}`]);
    expect(mcpToolsA.map((tool) => tool.name).every((name) => name.startsWith("acca_"))).toBe(true);
    expect(mcpToolsA.map((tool) => tool.name).some((name) => name.startsWith("accb_"))).toBe(false);

    const catalogB = await app.inject({
      method: "GET",
      url: `/sessions/${sessionBId}/tools/runtime`,
      headers: authHeaders(tokenB),
    });
    expect(catalogB.statusCode).toBe(200);
    const mcpToolsB = catalogB
      .json<RuntimeCatalogResponse>()
      .data.tools
      .filter((tool) => tool.source === "mcp");
    expect(mcpToolsB.map((tool) => tool.provider_id)).toEqual([`mcp:${configB.id}`]);
    expect(mcpToolsB.map((tool) => tool.name).every((name) => name.startsWith("accb_"))).toBe(true);
    expect(mcpToolsB.map((tool) => tool.name).some((name) => name.startsWith("acca_"))).toBe(false);
  });
});

describe("MCP account scope migration backfill", () => {
  let app: FastifyInstance | undefined;
  let seedConnection: DatabaseConnection | undefined;
  let databasePath = "";
  let tempMigrationsDir = "";

  afterEach(async () => {
    if (seedConnection) {
      seedConnection.close();
      seedConnection = undefined;
    }
    if (app) {
      await app.close();
      app = undefined;
    }
    if (databasePath) {
      try {
        rmSync(databasePath, { force: true });
      } catch {
        // 忽略清理失败，避免掩盖真实断言错误。
      }
      databasePath = "";
    }
    if (tempMigrationsDir) {
      try {
        rmSync(tempMigrationsDir, { recursive: true, force: true });
      } catch {
        // 忽略清理失败，避免掩盖真实断言错误。
      }
      tempMigrationsDir = "";
    }
  });

  it("backfills legacy global MCP configs to the default admin account", async () => {
    databasePath = join(tmpdir(), `tavern-mcp-backfill-${nanoid()}.db`);
    tempMigrationsDir = createPreMcpAccountScopeMigrationsDir();

    const sqlite = new Database(databasePath);
    sqlite.pragma("foreign_keys = ON");
    try {
      const db = drizzle(sqlite, { schema });
      migrate(db, { migrationsFolder: tempMigrationsDir });

      const now = Date.now();
      sqlite.prepare(
        `INSERT INTO mcp_server_config (
          id,
          name,
          transport,
          config_json,
          tool_prefix,
          enabled,
          connect_timeout_ms,
          call_timeout_ms,
          tool_refresh_interval_ms,
          default_side_effect_level,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "legacy-mcp",
        "Legacy Global MCP",
        "stdio",
        JSON.stringify({ stdio: { command: "node", args: ["legacy.js"] } }),
        "legacy_",
        1,
        30000,
        60000,
        300000,
        "irreversible",
        now,
        now,
      );
    } finally {
      sqlite.close();
    }

    ({ app } = await buildApp({
      databasePath,
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
      enableMcp: false,
    }));
    await app.ready();

    seedConnection = createDatabase(databasePath);
    const now = Date.now();
    await seedConnection.db.insert(accounts).values({
      id: "acc-a",
      name: "Account A",
      role: "user",
      status: "active",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    const rootToken = app.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });
    const tokenA = app.jwt.sign({ sub: "user-a", account_id: "acc-a", role: "admin" });

    const adminList = await app.inject({
      method: "GET",
      url: "/mcp/servers",
      headers: authHeaders(rootToken),
    });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json<ListResponse<McpServerResponse>>().data.map((item) => item.id)).toEqual(["legacy-mcp"]);

    const userList = await app.inject({
      method: "GET",
      url: "/mcp/servers",
      headers: authHeaders(tokenA),
    });
    expect(userList.statusCode).toBe(200);
    expect(userList.json<ListResponse<McpServerResponse>>().data).toEqual([]);

    const foreignGet = await app.inject({
      method: "GET",
      url: "/mcp/servers/legacy-mcp",
      headers: authHeaders(tokenA),
    });
    expect(foreignGet.statusCode).toBe(404);
    expect(foreignGet.json<ErrorResponse>().error.code).toBe("not_found");
  });
});
