import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { buildApp } from "../src/app";
import type { DatabaseConnection } from "../src/db/client.js";
import {
  pageStagedVariableWrites,
  variablePromotionTraces,
  variables,
} from "../src/db/schema.js";

async function createSession(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { title: "Inspect Session" },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

async function createFloor(app: FastifyInstance, sessionId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/floors",
    payload: {
      session_id: sessionId,
      floor_no: 0,
      branch_id: "main",
    },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

async function createPage(app: FastifyInstance, floorId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/pages",
    payload: {
      floor_id: floorId,
      page_no: 0,
      page_kind: "input",
    },
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

describe("page variable inspection routes", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];

  beforeEach(async () => {
    ({ app, database } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("exposes staged writes and promotion traces while keeping /variables/resolve durable-only", async () => {
    const sessionId = await createSession(app);
    const floorId = await createFloor(app, sessionId);
    const pageId = await createPage(app, floorId);
    const now = 1_735_700_400_000;

    await database.insert(pageStagedVariableWrites).values({
      id: nanoid(),
      accountId: "default-admin",
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      key: "pending_topic",
      op: "set",
      valueJson: JSON.stringify("campfire"),
      intent: "page_only",
      conflictPolicy: "replace",
      sourceJson: JSON.stringify({ toolName: "set_variable", providerId: "builtin" }),
      evidenceJson: JSON.stringify({ runId: "run-1", generationAttemptNo: 1, bufferedAt: now + 10, scope: "page", scopeId: pageId }),
      reason: "builtin:set_variable",
      status: "staged",
      decisionReason: null,
      createdAt: now + 10,
      resolvedAt: null,
    }).run();

    await database.insert(variables).values([
      {
        id: nanoid(),
        accountId: "default-admin",
        scope: "page",
        scopeId: pageId,
        key: "mood",
        valueJson: JSON.stringify("steady"),
        updatedAt: now + 20,
      },
      {
        id: nanoid(),
        accountId: "default-admin",
        scope: "floor",
        scopeId: floorId,
        key: "mood",
        valueJson: JSON.stringify("steady"),
        updatedAt: now + 20,
      },
    ]).run();

    await database.insert(variablePromotionTraces).values({
      id: nanoid(),
      accountId: "default-admin",
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      stagedWriteId: null,
      key: "mood",
      fromScope: "page",
      fromScopeId: pageId,
      toScope: "floor",
      toScopeId: floorId,
      conflictPolicy: "replace",
      sourceVariableId: null,
      targetVariableId: null,
      valueJson: JSON.stringify("steady"),
      createdAt: now + 30,
    }).run();

    const stagedResponse = await app.inject({
      method: "GET",
      url: `/pages/${pageId}/variables/staged`,
    });
    expect(stagedResponse.statusCode, stagedResponse.body).toBe(200);
    expect(stagedResponse.json()).toEqual({
      data: {
        page_id: pageId,
        floor_id: floorId,
        session_id: sessionId,
        branch_id: "main",
        items: [
          {
            id: expect.any(String),
            key: "pending_topic",
            op: "set",
            value: "campfire",
            intent: "page_only",
            conflict_policy: "replace",
            reason: "builtin:set_variable",
            source: { toolName: "set_variable", providerId: "builtin" },
            evidence: {
              runId: "run-1",
              generationAttemptNo: 1,
              bufferedAt: now + 10,
              scope: "page",
              scopeId: pageId,
            },
            status: "staged",
            decision_reason: null,
            created_at: now + 10,
            resolved_at: null,
          },
        ],
      },
    });

    const promotionsResponse = await app.inject({
      method: "GET",
      url: `/pages/${pageId}/variables/promotions`,
    });
    expect(promotionsResponse.statusCode, promotionsResponse.body).toBe(200);
    expect(promotionsResponse.json()).toEqual({
      data: {
        page_id: pageId,
        floor_id: floorId,
        session_id: sessionId,
        branch_id: "main",
        items: [
          {
            id: expect.any(String),
            staged_write_id: null,
            key: "mood",
            from_scope: "page",
            from_scope_id: pageId,
            to_scope: "floor",
            to_scope_id: floorId,
            conflict_policy: "replace",
            source_variable_id: null,
            target_variable_id: null,
            value: "steady",
            created_at: now + 30,
          },
        ],
      },
    });

    const resolveResponse = await app.inject({
      method: "GET",
      url: `/variables/resolve?session_id=${sessionId}&branch_id=main&floor_id=${floorId}&page_id=${pageId}&include_layers=true`,
    });
    expect(resolveResponse.statusCode, resolveResponse.body).toBe(200);
    expect(resolveResponse.json<{ data: { resolved: Array<{ key: string }> } }>().data.resolved.map((item) => item.key)).toEqual(["mood"]);
  });
});
