import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { buildApp } from "../src/app";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants";
import type { AppDb } from "../src/db/client";
import { mcpServerConfigs } from "../src/db/schema";

const originalMasterKey = process.env.APP_SECRETS_MASTER_KEY;

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
  transport: "stdio" | "http";
  stdio?: {
    command: string;
    args?: string[];
    cwd?: string;
    env_masked?: Record<string, string>;
  };
  http?: {
    url: string;
    headers_masked?: Record<string, string>;
  };
  tool_prefix: string | null;
  enabled: boolean;
  connect_timeout_ms: number;
  call_timeout_ms: number;
  tool_refresh_interval_ms: number;
  default_side_effect_level: string;
  created_at: number;
  updated_at: number;
  live_status: {
    attached: boolean;
    connected_at: number | null;
    error: string | null;
    last_timeout_at: number | null;
    reason: "disabled" | "manager_unavailable" | "not_attached" | null;
    reconnect_required: boolean;
    state: string;
    tool_count: number;
    tools_refreshed_at: number | null;
  };
};

describe("MCP config routes", () => {
  let app: FastifyInstance;
  let database: AppDb;

  beforeEach(async () => {
    delete process.env.APP_SECRETS_MASTER_KEY;
    ({ app, database } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (originalMasterKey === undefined) {
      delete process.env.APP_SECRETS_MASTER_KEY;
    } else {
      process.env.APP_SECRETS_MASTER_KEY = originalMasterKey;
    }

    if (app) {
      await app.close();
    }
  });

  it("masks stdio env and http headers in create, detail, and list responses", async () => {
    await app.close();
    process.env.APP_SECRETS_MASTER_KEY = "mcp-test-master-key";
    ({ app, database } = await buildApp({ databasePath: ":memory:", logger: false }));

    const stdioRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Stdio Server",
        transport: "stdio",
        stdio: {
          env: {
            API_TOKEN: "token12345678",
          },
          command: "node",
          args: ["server.js"],
          cwd: "/srv/mcp",
        },
        tool_prefix: "stdio_",
      },
    });

    expect(stdioRes.statusCode).toBe(201);
    const stdioServer = stdioRes.json<ItemResponse<McpServerResponse>>().data;
    expect(stdioServer.transport).toBe("stdio");
    expect(stdioServer.tool_prefix).toBe("stdio_");
    expect(stdioServer.enabled).toBe(true);
    expect(stdioServer.stdio?.env_masked).toEqual({ API_TOKEN: "toke****5678" });
    expect(stdioServer.stdio).not.toHaveProperty("env");

    const httpRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "HTTP Server",
        transport: "http",
        http: {
          url: "https://mcp.example.com/runtime",
          headers: {
            authorization: "secret12345678",
          },
        },
        enabled: false,
      },
    });

    expect(httpRes.statusCode).toBe(201);
    const httpServer = httpRes.json<ItemResponse<McpServerResponse>>().data;
    expect(httpServer.transport).toBe("http");
    expect(httpServer.enabled).toBe(false);
    expect(httpServer.http?.headers_masked).toEqual({ authorization: "secr****5678" });
    expect(httpServer.http).not.toHaveProperty("headers");

    const [stdioRow] = await database
      .select({ accountId: mcpServerConfigs.accountId, workspaceId: mcpServerConfigs.workspaceId })
      .from(mcpServerConfigs)
      .where(eq(mcpServerConfigs.id, stdioServer.id));
    expect(stdioRow).toEqual({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: `ws_default_${DEFAULT_ADMIN_ACCOUNT_ID}`,
    });

    const allRes = await app.inject({ method: "GET", url: "/mcp/servers" });
    expect(allRes.statusCode).toBe(200);
    const allBody = allRes.json<ListResponse<McpServerResponse>>();
    expect(allBody.meta.total).toBe(2);
    expect(allBody.data.map((item) => item.name)).toEqual(["Stdio Server", "HTTP Server"]);

    const enabledRes = await app.inject({ method: "GET", url: "/mcp/servers?enabled=true" });
    const detailRes = await app.inject({ method: "GET", url: `/mcp/servers/${httpServer.id}` });
    expect(enabledRes.statusCode).toBe(200);
    expect(detailRes.statusCode).toBe(200);
    const enabledBody = enabledRes.json<ListResponse<McpServerResponse>>();
    const detailBody = detailRes.json<ItemResponse<McpServerResponse>>();
    expect(enabledBody.meta.total).toBe(1);
    expect(enabledBody.data[0]?.id).toBe(stdioServer.id);

    const disabledRes = await app.inject({ method: "GET", url: "/mcp/servers?enabled=false" });
    expect(disabledRes.statusCode).toBe(200);
    const disabledBody = disabledRes.json<ListResponse<McpServerResponse>>();
    expect(disabledBody.meta.total).toBe(1);
    expect(disabledBody.data[0]?.id).toBe(httpServer.id);

    expect(disabledBody.data[0]?.http?.headers_masked).toEqual({ authorization: "secr****5678" });
    expect(detailBody.data.http?.headers_masked).toEqual({ authorization: "secr****5678" });
    expect(detailBody.data.http).not.toHaveProperty("headers");
  });

  it("marks live_status as manager_unavailable when ENABLE_MCP is disabled", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Detached Server",
        transport: "stdio",
        stdio: { command: "node" },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<ItemResponse<McpServerResponse>>().data;
    expect(created.live_status).toMatchObject({
      attached: false,
      reason: "manager_unavailable",
      state: "disconnected",
    });

    const detailRes = await app.inject({ method: "GET", url: `/mcp/servers/${created.id}` });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json<ItemResponse<McpServerResponse>>().data.live_status).toMatchObject({
      attached: false,
      reason: "manager_unavailable",
    });
  });

  it("gets a single config and returns 404 when the config does not exist", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Lookup Server",
        transport: "stdio",
        stdio: {
          command: "node",
        },
      },
    });

    const created = createRes.json<ItemResponse<McpServerResponse>>().data;

    const getRes = await app.inject({
      method: "GET",
      url: `/mcp/servers/${created.id}`,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json<ItemResponse<McpServerResponse>>().data.name).toBe("Lookup Server");

    const missingRes = await app.inject({
      method: "GET",
      url: "/mcp/servers/missing-server",
    });

    expect(missingRes.statusCode).toBe(404);
    expect(missingRes.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("returns 409 for duplicate names and 400 for missing transport config", async () => {
    const missingSecretKeyRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Secret Server",
        transport: "stdio",
        stdio: {
          command: "node",
          env: {
            API_TOKEN: "token12345678",
          },
        },
      },
    });

    expect(missingSecretKeyRes.statusCode).toBe(503);
    expect(missingSecretKeyRes.json<ErrorResponse>().error.code).toBe("secret_unavailable");

    const firstCreate = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Duplicate Server",
        transport: "stdio",
        stdio: {
          command: "node",
        },
      },
    });

    expect(firstCreate.statusCode).toBe(201);

    const duplicateRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Duplicate Server",
        transport: "http",
        http: {
          url: "https://mcp.example.com/runtime",
        },
      },
    });

    expect(duplicateRes.statusCode).toBe(409);
    expect(duplicateRes.json<ErrorResponse>().error.code).toBe("name_conflict");

    const invalidConfigRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Broken Server",
        transport: "stdio",
      },
    });

    expect(invalidConfigRes.statusCode).toBe(400);
    expect(invalidConfigRes.json<ErrorResponse>().error.code).toBe("invalid_config");
  });

  it("returns 503 when updating a config to include secrets without a master key", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Update Secret Server",
        transport: "stdio",
        stdio: {
          command: "node",
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<ItemResponse<McpServerResponse>>().data;

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/mcp/servers/${created.id}`,
      payload: {
        stdio: {
          command: "node",
          env: { API_TOKEN: "token12345678" },
        },
      },
    });

    expect(patchRes.statusCode).toBe(503);
    expect(patchRes.json<ErrorResponse>().error.code).toBe("secret_unavailable");
  });

  it("updates configs, clears tool_prefix, and covers validation, not-found, and conflict branches", async () => {
    const firstRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Patch Source",
        transport: "stdio",
        stdio: {
          command: "node",
          args: ["server.js"],
        },
        tool_prefix: "demo_",
      },
    });
    const first = firstRes.json<ItemResponse<McpServerResponse>>().data;

    const secondRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Conflict Target",
        transport: "http",
        http: {
          url: "https://mcp.example.com/runtime",
        },
      },
    });
    const second = secondRes.json<ItemResponse<McpServerResponse>>().data;
    expect(second.id).toBeDefined();

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/mcp/servers/${first.id}`,
      payload: {
        name: "Patch Source Updated",
        tool_prefix: null,
        call_timeout_ms: 65_000,
      },
    });

    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json<ItemResponse<McpServerResponse>>().data;
    expect(patched.name).toBe("Patch Source Updated");
    expect(patched.tool_prefix).toBeNull();
    expect(patched.call_timeout_ms).toBe(65_000);

    const emptyPatchRes = await app.inject({
      method: "PATCH",
      url: `/mcp/servers/${first.id}`,
      payload: {},
    });

    expect(emptyPatchRes.statusCode).toBe(400);
    expect(emptyPatchRes.json<ErrorResponse>().error.code).toBe("validation_error");

    const missingPatchRes = await app.inject({
      method: "PATCH",
      url: "/mcp/servers/missing-server",
      payload: {
        name: "Missing",
      },
    });

    expect(missingPatchRes.statusCode).toBe(404);
    expect(missingPatchRes.json<ErrorResponse>().error.code).toBe("not_found");

    const conflictPatchRes = await app.inject({
      method: "PATCH",
      url: `/mcp/servers/${first.id}`,
      payload: {
        name: "Conflict Target",
      },
    });

    expect(conflictPatchRes.statusCode).toBe(409);
    expect(conflictPatchRes.json<ErrorResponse>().error.code).toBe("name_conflict");
  });

  it("toggles and deletes configs and covers their 404 branches", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/mcp/servers",
      payload: {
        name: "Toggle Server",
        transport: "stdio",
        stdio: {
          command: "node",
        },
      },
    });

    const created = createRes.json<ItemResponse<McpServerResponse>>().data;

    const toggleRes = await app.inject({
      method: "PATCH",
      url: `/mcp/servers/${created.id}/toggle`,
      payload: {
        enabled: false,
      },
    });

    expect(toggleRes.statusCode).toBe(200);
    expect(toggleRes.json<ItemResponse<McpServerResponse>>().data.enabled).toBe(false);

    const missingToggleRes = await app.inject({
      method: "PATCH",
      url: "/mcp/servers/missing-server/toggle",
      payload: {
        enabled: true,
      },
    });

    expect(missingToggleRes.statusCode).toBe(404);
    expect(missingToggleRes.json<ErrorResponse>().error.code).toBe("not_found");

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/mcp/servers/${created.id}`,
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json<ItemResponse<{ deleted: boolean }>>().data.deleted).toBe(true);

    const missingDeleteRes = await app.inject({
      method: "DELETE",
      url: "/mcp/servers/missing-server",
    });

    expect(missingDeleteRes.statusCode).toBe(404);
    expect(missingDeleteRes.json<ErrorResponse>().error.code).toBe("not_found");
  });
});
