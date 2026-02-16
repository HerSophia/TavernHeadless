import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

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

type ItemResponse<T> = {
  data: T;
};

describe("apps/api integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("covers sessions CRUD with paginated listing", async () => {
    const created = await createSession(app, { title: "Session A", prompt_mode: "compat_strict" });

    const listResponse = await app.inject({
      method: "GET",
      url: "/sessions?status=active&limit=10&offset=0&sort_by=created_at&sort_order=desc"
    });

    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json<ListResponse<{ id: string; title: string | null }>>();
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0]?.id).toBe(created.id);
    expect(listBody.meta.total).toBe(1);
    expect(created.prompt_mode).toBe("compat_strict");
    expect(listBody.meta.limit).toBe(10);
    expect(listBody.meta.sort_by).toBe("created_at");

    const getResponse = await app.inject({ method: "GET", url: `/sessions/${created.id}` });
    expect(getResponse.statusCode).toBe(200);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/sessions/${created.id}`,
      payload: { status: "archived", prompt_mode: "native" }
    });

    expect(patchResponse.statusCode).toBe(200);
    const patched = patchResponse.json<ItemResponse<{ status: string; prompt_mode: string | null }>>();
    expect(patched.data.status).toBe("archived");
    expect(patched.data.prompt_mode).toBe("native");

    const deleteResponse = await app.inject({ method: "DELETE", url: `/sessions/${created.id}` });
    expect(deleteResponse.statusCode).toBe(200);

    const notFoundResponse = await app.inject({ method: "GET", url: `/sessions/${created.id}` });
    expect(notFoundResponse.statusCode).toBe(404);
  });

  it("covers floors CRUD and constraint errors", async () => {
    const session = await createSession(app, { title: "Session for floor" });

    const fkErrorResponse = await app.inject({
      method: "POST",
      url: "/floors",
      payload: { session_id: "missing", floor_no: 1, branch_id: "main" }
    });

    expect(fkErrorResponse.statusCode).toBe(409);

    const createdFloor = await createFloor(app, {
      session_id: session.id,
      floor_no: 1,
      branch_id: "main"
    });

    const conflictResponse = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: session.id,
        floor_no: 1,
        branch_id: "main"
      }
    });

    expect(conflictResponse.statusCode).toBe(409);

    const listResponse = await app.inject({
      method: "GET",
      url: `/floors?session_id=${session.id}&limit=5&offset=0&sort_by=floor_no&sort_order=asc`
    });

    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json<ListResponse<{ id: string; floor_no: number }>>();
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0]?.id).toBe(createdFloor.id);
    expect(listBody.meta.total).toBe(1);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/floors/${createdFloor.id}`,
      payload: { state: "committed" }
    });

    expect(patchResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({ method: "DELETE", url: `/floors/${createdFloor.id}` });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it("covers pages CRUD", async () => {
    const session = await createSession(app, { title: "Session for page" });
    const floor = await createFloor(app, { session_id: session.id, floor_no: 1, branch_id: "main" });

    const createdPage = await createPage(app, {
      floor_id: floor.id,
      page_no: 1,
      page_kind: "mixed"
    });

    const listResponse = await app.inject({
      method: "GET",
      url: `/pages?floor_id=${floor.id}&limit=10&offset=0&sort_by=page_no&sort_order=asc`
    });

    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json<ListResponse<{ id: string }>>();
    expect(listBody.data[0]?.id).toBe(createdPage.id);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${createdPage.id}`,
      payload: { is_active: false }
    });

    expect(patchResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({ method: "DELETE", url: `/pages/${createdPage.id}` });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it("covers messages CRUD and unique conflict", async () => {
    const session = await createSession(app, { title: "Session for message" });
    const floor = await createFloor(app, { session_id: session.id, floor_no: 1, branch_id: "main" });
    const page = await createPage(app, { floor_id: floor.id, page_no: 1, page_kind: "input" });

    const message = await createMessage(app, {
      page_id: page.id,
      seq: 1,
      role: "user",
      content: "hello"
    });

    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/messages",
      payload: {
        page_id: page.id,
        seq: 1,
        role: "assistant",
        content: "duplicate"
      }
    });

    expect(duplicateResponse.statusCode).toBe(409);

    const listResponse = await app.inject({
      method: "GET",
      url: `/messages?page_id=${page.id}&limit=5&offset=0&sort_by=seq&sort_order=asc`
    });

    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json<ListResponse<{ id: string }>>();
    expect(listBody.data[0]?.id).toBe(message.id);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/messages/${message.id}`,
      payload: { content: "updated" }
    });

    expect(patchResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({ method: "DELETE", url: `/messages/${message.id}` });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it("covers variables upsert/list/get/delete", async () => {
    const createResponse = await app.inject({
      method: "PUT",
      url: "/variables",
      payload: {
        scope: "chat",
        scope_id: "session-a",
        key: "mood",
        value: { score: 10 }
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const createdBody = createResponse.json<ItemResponse<{ id: string }>>();

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/variables",
      payload: {
        scope: "chat",
        scope_id: "session-a",
        key: "mood",
        value: { score: 20 }
      }
    });

    expect(updateResponse.statusCode).toBe(200);

    const listResponse = await app.inject({
      method: "GET",
      url: "/variables?scope=chat&scope_id=session-a&limit=10&offset=0&sort_by=updated_at&sort_order=desc"
    });

    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json<ListResponse<{ id: string }>>();
    expect(listBody.data.length).toBe(1);

    const getResponse = await app.inject({ method: "GET", url: `/variables/${createdBody.data.id}` });
    expect(getResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({ method: "DELETE", url: `/variables/${createdBody.data.id}` });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it("covers memories and memory-edges CRUD", async () => {
    const memoryA = await createMemory(app, {
      scope: "chat",
      scope_id: "session-1",
      type: "fact",
      content: { text: "A" }
    });

    const memoryB = await createMemory(app, {
      scope: "chat",
      scope_id: "session-1",
      type: "summary",
      content: { text: "B" }
    });

    const fkErrorResponse = await app.inject({
      method: "POST",
      url: "/memory-edges",
      payload: {
        from_id: "missing",
        to_id: memoryB.id,
        relation: "supports"
      }
    });

    expect(fkErrorResponse.statusCode).toBe(409);

    const edge = await createMemoryEdge(app, {
      from_id: memoryA.id,
      to_id: memoryB.id,
      relation: "supports"
    });

    const listMemoriesResponse = await app.inject({
      method: "GET",
      url: "/memories?scope=chat&limit=10&offset=0&sort_by=importance&sort_order=desc"
    });

    expect(listMemoriesResponse.statusCode).toBe(200);

    const patchMemoryResponse = await app.inject({
      method: "PATCH",
      url: `/memories/${memoryA.id}`,
      payload: { status: "deprecated" }
    });

    expect(patchMemoryResponse.statusCode).toBe(200);

    const listEdgesResponse = await app.inject({
      method: "GET",
      url: `/memory-edges?from_id=${memoryA.id}&limit=10&offset=0&sort_by=created_at&sort_order=desc`
    });

    expect(listEdgesResponse.statusCode).toBe(200);
    const listEdgesBody = listEdgesResponse.json<ListResponse<{ id: string }>>();
    expect(listEdgesBody.data[0]?.id).toBe(edge.id);

    const deleteEdgeResponse = await app.inject({ method: "DELETE", url: `/memory-edges/${edge.id}` });
    expect(deleteEdgeResponse.statusCode).toBe(200);

    const deleteMemoryResponse = await app.inject({ method: "DELETE", url: `/memories/${memoryA.id}` });
    expect(deleteMemoryResponse.statusCode).toBe(200);
  });

  it("supports memory query filters and stats endpoint", async () => {
    const now = Date.now();

    const memoryAResponse = await app.inject({
      method: "POST",
      url: "/memories",
      payload: {
        scope: "chat",
        scope_id: "session-stats",
        type: "fact",
        content: "Alice has a silver sword",
        source_floor_id: "floor-1",
        status: "active",
      },
    });
    expect(memoryAResponse.statusCode).toBe(201);

    const memoryBResponse = await app.inject({
      method: "POST",
      url: "/memories",
      payload: {
        scope: "chat",
        scope_id: "session-stats",
        type: "summary",
        content: "The party reached the capital",
        status: "deprecated",
      },
    });
    expect(memoryBResponse.statusCode).toBe(201);

    const filteredListResponse = await app.inject({
      method: "GET",
      url: `/memories?scope=chat&scope_id=session-stats&type=fact&status=active&source_floor_id=floor-1&created_from=${now - 10_000}&q=silver&limit=10&offset=0&sort_by=created_at&sort_order=desc`
    });
    expect(filteredListResponse.statusCode).toBe(200);
    const filteredListBody = filteredListResponse.json<ListResponse<{ id: string }>>();
    expect(filteredListBody.data).toHaveLength(1);

    const statsResponse = await app.inject({
      method: "GET",
      url: "/memories/stats?scope=chat&scope_id=session-stats"
    });
    expect(statsResponse.statusCode).toBe(200);
    const statsBody = statsResponse.json<{ data: { total: number; active: number; deprecated: number; by_type: { fact: number; summary: number } } }>();
    expect(statsBody.data.total).toBe(2);
    expect(statsBody.data.active).toBe(1);
    expect(statsBody.data.deprecated).toBe(1);
    expect(statsBody.data.by_type.fact).toBe(1);
    expect(statsBody.data.by_type.summary).toBe(1);
  });

  it("returns validation_error for invalid query params", async () => {
    const response = await app.inject({ method: "GET", url: "/messages?limit=0" });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("validation_error");
  });
});

async function createSession(
  app: FastifyInstance,
  payload: { title: string; prompt_mode?: "compat_strict" | "compat_plus" | "native" }
): Promise<{ id: string; title: string | null; prompt_mode: "compat_strict" | "compat_plus" | "native" | null }> {
  const response = await app.inject({ method: "POST", url: "/sessions", payload });
  expect(response.statusCode).toBe(201);
  return response.json<ItemResponse<{
    id: string;
    title: string | null;
    prompt_mode: "compat_strict" | "compat_plus" | "native" | null;
  }>>().data;
}

async function createFloor(
  app: FastifyInstance,
  payload: { session_id: string; floor_no: number; branch_id: string }
): Promise<{ id: string }> {
  const response = await app.inject({ method: "POST", url: "/floors", payload });
  expect(response.statusCode).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}

async function createPage(
  app: FastifyInstance,
  payload: { floor_id: string; page_no: number; page_kind: "input" | "output" | "mixed" }
): Promise<{ id: string }> {
  const response = await app.inject({ method: "POST", url: "/pages", payload });
  expect(response.statusCode).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}

async function createMessage(
  app: FastifyInstance,
  payload: {
    page_id: string;
    seq: number;
    role: "user" | "assistant" | "system" | "narrator";
    content: string;
  }
): Promise<{ id: string }> {
  const response = await app.inject({ method: "POST", url: "/messages", payload });
  expect(response.statusCode).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}

async function createMemory(
  app: FastifyInstance,
  payload: {
    scope: "global" | "chat" | "floor";
    scope_id: string;
    type: "fact" | "summary" | "open_loop";
    content: unknown;
  }
): Promise<{ id: string }> {
  const response = await app.inject({ method: "POST", url: "/memories", payload });
  expect(response.statusCode).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}

async function createMemoryEdge(
  app: FastifyInstance,
  payload: {
    from_id: string;
    to_id: string;
    relation: "supports" | "contradicts" | "updates";
  }
): Promise<{ id: string }> {
  const response = await app.inject({ method: "POST", url: "/memory-edges", payload });
  expect(response.statusCode).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}
