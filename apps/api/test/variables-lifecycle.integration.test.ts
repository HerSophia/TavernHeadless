import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../src/db/client.js";
import { accounts, floors, sessions } from "../src/db/schema.js";
import { registerFloorRoutes } from "../src/routes/floors.js";
import { registerMessagePageRoutes } from "../src/routes/pages.js";
import { registerSessionRoutes } from "../src/routes/sessions.js";
import { registerVariableRoutes } from "../src/routes/variables.js";
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth.js";

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type ItemResponse<T> = { data: T };

type ListResponse<T> = {
  data: T[];
};

type VariableDto = {
  id: string;
  scope: "global" | "chat" | "floor" | "branch" | "page";
  scope_id: string;
  key: string;
  value: unknown;
  updated_at: number;
};

describe("variable lifecycle integrity", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    app = Fastify({ logger: false });
    await registerDevelopmentTestAuth(app, database.db);
    await registerSessionRoutes(app, database);
    await registerFloorRoutes(app, database);
    await registerMessagePageRoutes(app, database);
    await registerVariableRoutes(app, database);

    const now = 1_763_600_000_000;
    await database.db
      .insert(accounts)
      .values({
        id: DEFAULT_ADMIN_ACCOUNT_ID,
        name: "Default Admin",
        role: "admin",
        status: "active",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  async function createSession(title = "Variable Session"): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createFloor(args: {
    sessionId: string;
    floorNo: number;
    branchId: string;
    state?: "draft" | "generating" | "committed" | "failed";
  }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: args.sessionId,
        floor_no: args.floorNo,
        branch_id: args.branchId,
        ...(args.state ? { state: args.state } : {}),
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createPage(args: {
    floorId: string;
    pageNo: number;
    pageKind: "input" | "output" | "mixed";
  }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/pages",
      payload: {
        floor_id: args.floorId,
        page_no: args.pageNo,
        page_kind: args.pageKind,
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function upsertVariable(args: {
    scope: VariableDto["scope"];
    scopeId?: string;
    sessionId?: string;
    branchId?: string;
    key: string;
    value: unknown;
  }): Promise<VariableDto> {
    const response = await app.inject({
      method: "PUT",
      url: "/variables",
      payload: {
        scope: args.scope,
        ...(args.scopeId ? { scope_id: args.scopeId } : {}),
        ...(args.sessionId ? { session_id: args.sessionId } : {}),
        ...(args.branchId ? { branch_id: args.branchId } : {}),
        key: args.key,
        value: args.value,
      },
    });

    expect([200, 201], response.body).toContain(response.statusCode);
    return response.json<ItemResponse<VariableDto>>().data;
  }

  async function listVariables(): Promise<VariableDto[]> {
    const response = await app.inject({ method: "GET", url: "/variables?limit=100&offset=0&sort_by=updated_at&sort_order=asc" });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<ListResponse<VariableDto>>().data;
  }

  it("cleans scoped variables when page and floor hosts are deleted", async () => {
    const pageSessionId = await createSession("Page cleanup");
    const pageFloorId = await createFloor({ sessionId: pageSessionId, floorNo: 0, branchId: "main" });
    const pageAId = await createPage({ floorId: pageFloorId, pageNo: 0, pageKind: "input" });
    const pageBId = await createPage({ floorId: pageFloorId, pageNo: 1, pageKind: "output" });
    const pageVarA = await upsertVariable({ scope: "page", scopeId: pageAId, key: "page-a", value: "alpha" });
    const pageVarB = await upsertVariable({ scope: "page", scopeId: pageBId, key: "page-b", value: "beta" });

    const batchDeleteResponse = await app.inject({
      method: "POST",
      url: "/pages/batch/delete",
      payload: { ids: [pageAId] },
    });
    expect(batchDeleteResponse.statusCode, batchDeleteResponse.body).toBe(200);

    let variablesAfterBatchPageDelete = await listVariables();
    expect(variablesAfterBatchPageDelete.map((item) => item.id)).not.toContain(pageVarA.id);
    expect(variablesAfterBatchPageDelete.map((item) => item.id)).toContain(pageVarB.id);

    const deletePageResponse = await app.inject({
      method: "DELETE",
      url: `/pages/${pageBId}`,
    });
    expect(deletePageResponse.statusCode, deletePageResponse.body).toBe(200);

    variablesAfterBatchPageDelete = await listVariables();
    expect(variablesAfterBatchPageDelete.map((item) => item.id)).not.toContain(pageVarB.id);

    const branchSessionId = await createSession("Floor cleanup");
    const branchFloorId = await createFloor({ sessionId: branchSessionId, floorNo: 0, branchId: "alt" });
    const branchPageId = await createPage({ floorId: branchFloorId, pageNo: 0, pageKind: "input" });
    const chatVar = await upsertVariable({ scope: "chat", scopeId: branchSessionId, key: "chat-key", value: "chat" });
    const branchVar = await upsertVariable({ scope: "branch", sessionId: branchSessionId, branchId: "alt", key: "branch-key", value: "branch" });
    const floorVar = await upsertVariable({ scope: "floor", scopeId: branchFloorId, key: "floor-key", value: "floor" });
    const pageVar = await upsertVariable({ scope: "page", scopeId: branchPageId, key: "page-key", value: "page" });

    const deleteFloorResponse = await app.inject({
      method: "DELETE",
      url: `/floors/${branchFloorId}`,
    });
    expect(deleteFloorResponse.statusCode, deleteFloorResponse.body).toBe(200);

    const variablesAfterFloorDelete = await listVariables();
    const remainingIds = variablesAfterFloorDelete.map((item) => item.id);
    expect(remainingIds).toContain(chatVar.id);
    expect(remainingIds).not.toContain(branchVar.id);
    expect(remainingIds).not.toContain(floorVar.id);
    expect(remainingIds).not.toContain(pageVar.id);
  });

  it("cleans scoped variables when sessions are deleted through single and batch routes", async () => {
    const sessionId = await createSession("Single delete cleanup");
    const floorId = await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    const pageId = await createPage({ floorId, pageNo: 0, pageKind: "input" });
    const chatVar = await upsertVariable({ scope: "chat", scopeId: sessionId, key: "chat-key", value: "chat" });
    const branchVar = await upsertVariable({ scope: "branch", sessionId, branchId: "main", key: "branch-key", value: "branch" });
    const floorVar = await upsertVariable({ scope: "floor", scopeId: floorId, key: "floor-key", value: "floor" });
    const pageVar = await upsertVariable({ scope: "page", scopeId: pageId, key: "page-key", value: "page" });

    const deleteSessionResponse = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}`,
    });
    expect(deleteSessionResponse.statusCode, deleteSessionResponse.body).toBe(200);

    let variablesAfterSessionDelete = await listVariables();
    const deletedIds = variablesAfterSessionDelete.map((item) => item.id);
    expect(deletedIds).not.toContain(chatVar.id);
    expect(deletedIds).not.toContain(branchVar.id);
    expect(deletedIds).not.toContain(floorVar.id);
    expect(deletedIds).not.toContain(pageVar.id);

    const batchSessionId = await createSession("Batch delete cleanup");
    const batchChatVar = await upsertVariable({ scope: "chat", scopeId: batchSessionId, key: "batch-chat-key", value: "batch" });

    const batchDeleteResponse = await app.inject({
      method: "POST",
      url: "/sessions/batch/delete",
      payload: { ids: [batchSessionId] },
    });
    expect(batchDeleteResponse.statusCode, batchDeleteResponse.body).toBe(200);

    variablesAfterSessionDelete = await listVariables();
    expect(variablesAfterSessionDelete.map((item) => item.id)).not.toContain(batchChatVar.id);
  });

  it("hides historical orphan variables and still allows deleting them", async () => {
    const sessionId = await createSession("Orphan session");
    const orphanVar = await upsertVariable({ scope: "chat", scopeId: sessionId, key: "orphan-key", value: "stale" });

    await database.db.delete(sessions).where(eq(sessions.id, sessionId)).run();

    const listResponse = await app.inject({
      method: "GET",
      url: "/variables?limit=100&offset=0&sort_by=updated_at&sort_order=asc",
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    expect(listResponse.json<ListResponse<VariableDto>>().data.map((item) => item.id)).not.toContain(orphanVar.id);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/variables/${orphanVar.id}`,
    });
    expect(detailResponse.statusCode, detailResponse.body).toBe(404);
    expect(detailResponse.json<ErrorResponse>().error.code).toBe("variable_not_found");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/variables/${orphanVar.id}`,
    });
    expect(deleteResponse.statusCode, deleteResponse.body).toBe(200);

    const finalVariables = await listVariables();
    expect(finalVariables.map((item) => item.id)).not.toContain(orphanVar.id);
  });

  it("rejects floor and page variable writes while the host floor is generating", async () => {
    const sessionId = await createSession("Generating lock");
    const floorId = await createFloor({ sessionId, floorNo: 0, branchId: "main", state: "draft" });
    const pageId = await createPage({ floorId, pageNo: 0, pageKind: "input" });
    const floorVar = await upsertVariable({ scope: "floor", scopeId: floorId, key: "floor-key", value: "floor" });
    const pageVar = await upsertVariable({ scope: "page", scopeId: pageId, key: "page-key", value: "page" });

    // Phase 4.1 guardrails 后，PATCH /floors/:id 不再允许改 state；
    // 这里仅需要让 floor 处于 generating 态触发 variable_target_locked，
    // 直接 DB 层改状态即可。
    await database.db
      .update(floors)
      .set({ state: "generating", updatedAt: Date.now() })
      .where(eq(floors.id, floorId));

    const floorWriteResponse = await app.inject({
      method: "PUT",
      url: "/variables",
      payload: { scope: "floor", scope_id: floorId, key: "new-floor-key", value: "blocked" },
    });
    expect(floorWriteResponse.statusCode, floorWriteResponse.body).toBe(409);
    expect(floorWriteResponse.json<ErrorResponse>().error.code).toBe("variable_target_locked");

    const pageWriteResponse = await app.inject({
      method: "PUT",
      url: "/variables",
      payload: { scope: "page", scope_id: pageId, key: "new-page-key", value: "blocked" },
    });
    expect(pageWriteResponse.statusCode, pageWriteResponse.body).toBe(409);
    expect(pageWriteResponse.json<ErrorResponse>().error.code).toBe("variable_target_locked");

    const deleteFloorVariableResponse = await app.inject({
      method: "DELETE",
      url: `/variables/${floorVar.id}`,
    });
    expect(deleteFloorVariableResponse.statusCode, deleteFloorVariableResponse.body).toBe(409);
    expect(deleteFloorVariableResponse.json<ErrorResponse>().error.code).toBe("variable_target_locked");

    const deletePageVariableResponse = await app.inject({
      method: "DELETE",
      url: `/variables/${pageVar.id}`,
    });
    expect(deletePageVariableResponse.statusCode, deletePageVariableResponse.body).toBe(409);
    expect(deletePageVariableResponse.json<ErrorResponse>().error.code).toBe("variable_target_locked");
  });
});
