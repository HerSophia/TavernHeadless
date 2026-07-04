import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectMembershipService } from"../../services/project-membership-service.js";

const OWNER_ACCOUNT_ID = "gapc-route-owner";
const OBSERVER_ACCOUNT_ID = "gapc-route-observer";
const OWNER_KEY = "gapc-route-owner-key";
const OBSERVER_KEY = "gapc-route-observer-key";
const WORKSPACE_ID = "ws_gapc_route";
const PROJECT_ID = "proj_gapc_route";

type TestApp = {
  app: FastifyInstance;
  database: DatabaseConnection["db"];
};

function authHeaders(apiKey: string) {
  return { "x-api-key": apiKey };
}

async function buildConfigApp(): Promise<TestApp> {
  const built = await buildApp({
    databasePath: ":memory:",
    logger: false,
    accountMode: "multi",
    auth: {
      mode: "api_key",
      apiKeys: [OWNER_KEY, OBSERVER_KEY],
      apiKeyAccountMap: {
        [OWNER_KEY]: OWNER_ACCOUNT_ID,
        [OBSERVER_KEY]: OBSERVER_ACCOUNT_ID,
      },
    },
  });

  ensureTestAccount(built.database, OWNER_ACCOUNT_ID);
  ensureTestAccount(built.database, OBSERVER_ACCOUNT_ID);
  createTestProject(built.database, {
    accountId: OWNER_ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    id: PROJECT_ID,
  });
  new ProjectMembershipService(built.database).addObserver({
    actorAccountId: OWNER_ACCOUNT_ID,
    projectId: PROJECT_ID,
    accountId: OBSERVER_ACCOUNT_ID,
  });

  return { app: built.app, database: built.database };
}

describe("Graphassistant prompt config routes", () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildConfigApp();
  });

  afterEach(async () => {
    await testApp.app.close();
  });

  it("returns built-in defaults for a fresh project", async () => {
    const response = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/graph-assistant/prompt-config`,
      headers:authHeaders(OBSERVER_KEY),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      static_mode: "append",
      static_text: "",
      dynamic_template: "",
      context_config: null,
    });
    expect(typeof body.builtin_default).toBe("string");
    expect(body.builtin_default.length).toBeGreaterThan(0);
  });

  it("updates config with write access and reflects it", async () => {
    const response = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/graph-assistant/prompt-config`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        static_mode: "override",
        static_text: "只读图查看助手。",
      },
    });
    expect(response.statusCode).toBe(200);
   const body = response.json();
    expect(body).toMatchObject({
      static_mode: "override",
      static_text: "只读图查看助手。",
    });

    const reread = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/graph-assistant/prompt-config`,
 headers: authHeaders(OWNER_KEY),
    });
    expect(reread.json()).toMatchObject({
      static_mode: "override",
      static_text: "只读图查看助手。",
    });
  });

  it("denies write access for observers", async () => {
    const response = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/graph-assistant/prompt-config`,
      headers: authHeaders(OBSERVER_KEY),
      payload: {
        static_mode: "append",
   static_text: "x",
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejects invalid static mode", async ()=> {
    const response = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/graph-assistant/prompt-config`,
      headers: authHeaders(OWNER_KEY),
      payload: {
   static_mode: "merge",
        static_text: "x",
      },
    });
    expect(response.statusCode).toBe(400);
 });
});
