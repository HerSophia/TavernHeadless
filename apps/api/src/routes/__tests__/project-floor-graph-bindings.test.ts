import { buildCompatPromptFloorTemplate, buildNativePromptFloorTemplate, type NodeGraphDocument } from "@tavern/core";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { NodeGraphDefinitionService } from "../../services/node-graph-definition-service.js";
import { ProjectMembershipService } from "../../services/project-membership-service.js";

const OWNER_ACCOUNT_ID = "floor-binding-route-owner";
const OBSERVER_ACCOUNT_ID = "floor-binding-route-observer";
const OTHER_ACCOUNT_ID = "floor-binding-route-other";
const OWNER_KEY = "floor-binding-route-owner-key";
const OBSERVER_KEY = "floor-binding-route-observer-key";
const OTHER_KEY = "floor-binding-route-other-key";
const WORKSPACE_ID = "ws_floor_binding_route";
const PROJECT_ID = "proj_floor_binding_route";

const ACTOR = {
  actorType: "account" as const,
  actorAccountId: OWNER_ACCOUNT_ID,
  actorClientId: null,
};

type TestApp = {
  app: FastifyInstance;
  database: DatabaseConnection["db"];
};

function authHeaders(apiKey: string) {
  return { "x-api-key": apiKey };
}

function withGraphId(document: NodeGraphDocument, graphId: string, name: string): NodeGraphDocument {
  return { ...document, graphId, name };
}

async function buildBindingApp(): Promise<TestApp> {
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

describe("Project floor graph binding routes", () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildBindingApp();
  });

  afterEach(async () => {
    await testApp.app.close();
  });

  it("sets, lists and clears a native floor graph binding", async () => {
    const service = new NodeGraphDefinitionService(testApp.database);
    const graph = service.create({
      actor: ACTOR,
      projectId: PROJECT_ID,
      document: withGraphId(buildNativePromptFloorTemplate(), "ngraph_route_floor_binding_native", "Native Route Floor"),
    });

    const putResponse = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings/native`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        graph_id: graph.definition.id,
        graph_version_id: graph.version.id,
      },
    });
    expect(putResponse.statusCode, putResponse.body).toBe(200);
    expect(putResponse.json().item).toMatchObject({
      kind: "native",
      graph_id: graph.definition.id,
      graph_version_id: graph.version.id,
      graph_name: "Native Route Floor",
      graph_version_no: 1,
    });

    const listResponse = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    expect(listResponse.json().items).toHaveLength(1);
    expect(listResponse.json().items[0]).toMatchObject({ kind: "native", graph_id: graph.definition.id });

    const deleteResponse = await testApp.app.inject({
      method: "DELETE",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings/native`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(deleteResponse.statusCode, deleteResponse.body).toBe(200);
    expect(deleteResponse.json()).toMatchObject({ cleared: true });

    const afterClear = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings`,
      headers: authHeaders(OWNER_KEY),
    });
    expect(afterClear.json().items).toHaveLength(0);
  });

  it("sets a compat floor graph binding", async () => {
    const service = new NodeGraphDefinitionService(testApp.database);
    const graph = service.create({
      actor: ACTOR,
      projectId: PROJECT_ID,
      document: withGraphId(buildCompatPromptFloorTemplate(), "ngraph_route_floor_binding_compat", "Compat Route Floor"),
    });

    const response = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings/compat`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        graph_id: graph.definition.id,
        graph_version_id: graph.version.id,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().item).toMatchObject({
      kind: "compat",
      graph_id: graph.definition.id,
      graph_version_id: graph.version.id,
    });
  });

  it("denies observer writes but allows observer reads", async () => {
    const getResponse = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(getResponse.statusCode).toBe(200);

    const putResponse = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings/native`,
      headers: authHeaders(OBSERVER_KEY),
      payload: { graph_id: "ngraph_missing", graph_version_id: "ngver_missing" },
    });
    expect(putResponse.statusCode).toBe(403);

    const deleteResponse = await testApp.app.inject({
      method: "DELETE",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings/native`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(deleteResponse.statusCode).toBe(403);
  });

  it("rejects invalid kind, missing graph and invalid compat graph", async () => {
    const invalidKind = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings/story`,
      headers: authHeaders(OWNER_KEY),
      payload: { graph_id: "ngraph_missing", graph_version_id: "ngver_missing" },
    });
    expect(invalidKind.statusCode).toBe(400);
    expect(invalidKind.json().error.code).toBe("floor_graph_binding_invalid_kind");

    const missingGraph = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings/native`,
      headers: authHeaders(OWNER_KEY),
      payload: { graph_id: "ngraph_missing", graph_version_id: "ngver_missing" },
    });
    expect(missingGraph.statusCode).toBe(404);
    expect(missingGraph.json().error.code).toBe("floor_graph_binding_graph_not_found");

    const service = new NodeGraphDefinitionService(testApp.database);
    const invalidCompat = service.create({
      actor: ACTOR,
      projectId: PROJECT_ID,
      document: withGraphId(buildNativePromptFloorTemplate(), "ngraph_route_invalid_compat", "Invalid Compat"),
    });
    const invalidCompatResponse = await testApp.app.inject({
      method: "PUT",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings/compat`,
      headers: authHeaders(OWNER_KEY),
      payload: {
        graph_id: invalidCompat.definition.id,
        graph_version_id: invalidCompat.version.id,
      },
    });
    expect(invalidCompatResponse.statusCode).toBe(400);
    expect(invalidCompatResponse.json().error.code).toBe("floor_graph_binding_invalid_document");
  });

  it("hides the route from non-members through project access control", async () => {
    const response = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/settings/floor-graph-bindings`,
      headers: authHeaders(OTHER_KEY),
    });
    expect(response.statusCode).toBe(403);
  });
});
