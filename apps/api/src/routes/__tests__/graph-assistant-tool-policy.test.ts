import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach,describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ProjectMembershipService } from "../../services/project-membership-service.js";

const OWNER_ACCOUNT_ID = "gatp-route-owner";
const OBSERVER_ACCOUNT_ID = "gatp-route-observer";
const OWNER_KEY = "gatp-route-owner-key";
const OBSERVER_KEY = "gatp-route-observer-key";
const WORKSPACE_ID = "ws_gatp_route";
const PROJECT_ID = "proj_gatp_route";

type TestApp = {
  app: FastifyInstance;
  database: DatabaseConnection["db"];
};

function authHeaders(apiKey: string) {
  return { "x-api-key": apiKey };
}

async function buildPolicyApp(): Promise<TestApp> {
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

describe("Graph assistant tool policy routes", ()=> {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildPolicyApp();
  });

  afterEach(async () => {
    await testApp.app.close();
  });

  it("returns effective policy with defaults for a fresh project", async () => {
    const response = await testApp.app.inject({
      method: "GET",
   url: `/projects/${PROJECT_ID}/graph-assistant/tool-policy`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.items)).toBe(true);
   const create = body.items.find((item: { tool_name: string }) => item.tool_name === "nodegraph.graph.create");
    expect(create).toMatchObject({ decision: "confirm", default_decision: "confirm", source: "default" });
    const get = body.items.find((item: { tool_name: string }) => item.tool_name === "nodegraph.graph.get");
    expect(get).toMatchObject({ decision: "auto", source: "default" });
  });

  it("updates policy with write access and reflects override", async () => {
    const response = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/graph-assistant/tool-policy`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        policies: [{ tool_name: "nodegraph.node.add", decision: "confirm" }],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const nodeAdd = body.items.find((item: { tool_name: string }) => item.tool_name === "nodegraph.node.add");
    expect(nodeAdd).toMatchObject({ decision: "confirm", default_decision: "auto", source: "override" });
  });

  it("denies write access for observers", async () => {
    const response = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/graph-assistant/tool-policy`,
      headers: authHeaders(OBSERVER_KEY),
      payload: {
        policies: [{ tool_name: "nodegraph.node.add", decision: "confirm" }],
     },
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejects unknown tool names on update", async () => {
    const response = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/graph-assistant/tool-policy`,
      headers: authHeaders(OWNER_KEY),
      payload: {
policies: [{ tool_name: "nodegraph.bogus", decision: "auto" }],
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
