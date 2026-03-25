import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

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
    details?: unknown;
  };
};

type MemoryScope = "global" | "chat" | "floor";
type MemoryType = "fact" | "summary" | "open_loop";
type MemoryStatus = "active" | "deprecated";
type MemoryRelation = "supports" | "contradicts" | "updates";
type PageKind = "input" | "output" | "mixed";
type MessageRole = "user" | "assistant" | "system" | "narrator";

type MemoryDto = {
  id: string;
  scope: MemoryScope;
  scope_id: string;
  type: MemoryType;
  content: unknown;
  importance: number;
  confidence: number;
  source_floor_id: string | null;
  source_message_id: string | null;
  status: MemoryStatus;
  created_at: number;
  updated_at: number;
};

type MemoryEdgeDto = {
  id: string;
  from_id: string;
  to_id: string;
  relation: MemoryRelation;
  created_at: number;
};

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createSession(
  app: FastifyInstance,
  title = "Memory Session",
  headers?: Record<string, string>
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/sessions",
    headers,
    payload: { title }
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data.id;
}

async function createFloor(
  app: FastifyInstance,
  args: { sessionId: string; floorNo: number; branchId: string },
  headers?: Record<string, string>
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/floors",
    headers,
    payload: {
      session_id: args.sessionId,
      floor_no: args.floorNo,
      branch_id: args.branchId
    }
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data.id;
}

async function createPage(
  app: FastifyInstance,
  args: { floorId: string; pageNo: number; pageKind: PageKind },
  headers?: Record<string, string>
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/pages",
    headers,
    payload: {
      floor_id: args.floorId,
      page_no: args.pageNo,
      page_kind: args.pageKind
    }
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data.id;
}

async function createMessage(
  app: FastifyInstance,
  args: {
    pageId: string;
    seq: number;
    role: MessageRole;
    content: string;
  },
  headers?: Record<string, string>
): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/messages",
    headers,
    payload: {
      page_id: args.pageId,
      seq: args.seq,
      role: args.role,
      content: args.content
    }
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}

async function createMemory(
  app: FastifyInstance,
  args: {
    scope: MemoryScope;
    scopeId: string;
    type: MemoryType;
    content: unknown;
    importance?: number;
    confidence?: number;
    sourceFloorId?: string;
    sourceMessageId?: string;
    status?: MemoryStatus;
  },
  headers?: Record<string, string>
): Promise<MemoryDto> {
  const response = await app.inject({
    method: "POST",
    url: "/memories",
    headers,
    payload: {
      scope: args.scope,
      scope_id: args.scopeId,
      type: args.type,
      content: args.content,
      ...(args.importance !== undefined ? { importance: args.importance } : {}),
      ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
      ...(args.sourceFloorId !== undefined ? { source_floor_id: args.sourceFloorId } : {}),
      ...(args.sourceMessageId !== undefined ? { source_message_id: args.sourceMessageId } : {}),
      ...(args.status !== undefined ? { status: args.status } : {})
    }
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<MemoryDto>>().data;
}

async function createMemoryEdge(
  app: FastifyInstance,
  args: { fromId: string; toId: string; relation: MemoryRelation },
  headers?: Record<string, string>
): Promise<MemoryEdgeDto> {
  const response = await app.inject({
    method: "POST",
    url: "/memory-edges",
    headers,
    payload: {
      from_id: args.fromId,
      to_id: args.toId,
      relation: args.relation
    }
  });

  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<MemoryEdgeDto>>().data;
}

describe("memory routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("lists memories with extended filters and computes stats", async () => {
    const sessionId = await createSession(app);
    const floorId = await createFloor(app, { sessionId, floorNo: 0, branchId: "main" });
    const pageId = await createPage(app, { floorId, pageNo: 1, pageKind: "mixed" });
    const message = await createMessage(app, {
      pageId,
      seq: 1,
      role: "user",
      content: "Silver inquiry"
    });
    const maxTimestamp = Date.now() + 10_000;

    const factMemory = await createMemory(app, {
      scope: "chat",
      scopeId: sessionId,
      type: "fact",
      content: { text: "silver fact" },
      importance: 0.2,
      confidence: 0.95,
      sourceFloorId: floorId,
      sourceMessageId: message.id,
      status: "active"
    });
    const summaryMemory = await createMemory(app, {
      scope: "chat",
      scopeId: sessionId,
      type: "summary",
      content: "silver summary",
      importance: 0.6,
      confidence: 0.8,
      sourceFloorId: floorId,
      sourceMessageId: message.id,
      status: "deprecated"
    });
    const openLoopMemory = await createMemory(app, {
      scope: "chat",
      scopeId: sessionId,
      type: "open_loop",
      content: { text: "silver open loop" },
      importance: 0.4,
      confidence: 0.7,
      sourceFloorId: floorId,
      sourceMessageId: message.id,
      status: "active"
    });

    const filteredListResponse = await app.inject({
      method: "GET",
      url: `/memories?scope=chat&scope_id=${sessionId}&type=fact&status=active&source_floor_id=${floorId}&source_message_id=${message.id}&created_from=0&created_to=${maxTimestamp}&updated_from=0&updated_to=${maxTimestamp}&importance_min=0.1&importance_max=0.3&confidence_min=0.9&confidence_max=1&q=silver&limit=10&offset=0&sort_by=updated_at&sort_order=desc`
    });

    expect(filteredListResponse.statusCode, filteredListResponse.body).toBe(200);
    const filteredListBody = filteredListResponse.json<ListResponse<MemoryDto>>();
    expect(filteredListBody.meta).toEqual({
      total: 1,
      limit: 10,
      offset: 0,
      has_more: false,
      sort_by: "updated_at",
      sort_order: "desc"
    });
    expect(filteredListBody.data).toEqual([
      expect.objectContaining({
        id: factMemory.id,
        scope: "chat",
        scope_id: sessionId,
        type: "fact",
        source_floor_id: floorId,
        source_message_id: message.id,
        status: "active"
      })
    ]);

    const confidenceListResponse = await app.inject({
      method: "GET",
      url: `/memories?scope=chat&scope_id=${sessionId}&source_floor_id=${floorId}&source_message_id=${message.id}&created_from=0&created_to=${maxTimestamp}&updated_from=0&updated_to=${maxTimestamp}&importance_min=0&importance_max=1&confidence_min=0&confidence_max=1&q=silver&limit=10&offset=0&sort_by=confidence&sort_order=asc`
    });

    expect(confidenceListResponse.statusCode, confidenceListResponse.body).toBe(200);
    const confidenceListBody = confidenceListResponse.json<ListResponse<MemoryDto>>();
    expect(confidenceListBody.meta).toEqual({
      total: 3,
      limit: 10,
      offset: 0,
      has_more: false,
      sort_by: "confidence",
      sort_order: "asc"
    });
    expect(confidenceListBody.data.map((item) => item.id)).toEqual([
      openLoopMemory.id,
      summaryMemory.id,
      factMemory.id
    ]);

    const statsResponse = await app.inject({
      method: "GET",
      url: `/memories/stats?scope=chat&scope_id=${sessionId}&source_floor_id=${floorId}&source_message_id=${message.id}&created_from=0&created_to=${maxTimestamp}&updated_from=0&updated_to=${maxTimestamp}&importance_min=0&importance_max=1&confidence_min=0&confidence_max=1&q=silver`
    });

    expect(statsResponse.statusCode, statsResponse.body).toBe(200);
    expect(
      statsResponse.json<{
        data: {
          total: number;
          active: number;
          deprecated: number;
          by_type: { fact: number; summary: number; open_loop: number };
          avg_importance: number;
          avg_confidence: number;
          estimated_tokens: number;
        };
      }>()
    ).toEqual({
      data: {
        total: 3,
        active: 2,
        deprecated: 1,
        by_type: {
          fact: 1,
          summary: 1,
          open_loop: 1
        },
        avg_importance: expect.any(Number),
        avg_confidence: expect.any(Number),
        estimated_tokens: expect.any(Number)
      }
    });
  });

  it("validates memory queries and create or batch delete requests", async () => {
    const invalidCreateResponse = await app.inject({
      method: "POST",
      url: "/memories",
      payload: {}
    });
    expect(invalidCreateResponse.statusCode).toBe(400);
    expect(invalidCreateResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const invalidListCreatedRangeResponse = await app.inject({
      method: "GET",
      url: "/memories?created_from=10&created_to=1"
    });
    expect(invalidListCreatedRangeResponse.statusCode).toBe(400);

    const invalidListUpdatedRangeResponse = await app.inject({
      method: "GET",
      url: "/memories?updated_from=10&updated_to=1"
    });
    expect(invalidListUpdatedRangeResponse.statusCode).toBe(400);

    const invalidListImportanceRangeResponse = await app.inject({
      method: "GET",
      url: "/memories?importance_min=0.9&importance_max=0.1"
    });
    expect(invalidListImportanceRangeResponse.statusCode).toBe(400);

    const invalidListConfidenceRangeResponse = await app.inject({
      method: "GET",
      url: "/memories?confidence_min=0.9&confidence_max=0.1"
    });
    expect(invalidListConfidenceRangeResponse.statusCode).toBe(400);

    const invalidStatsCreatedRangeResponse = await app.inject({
      method: "GET",
      url: "/memories/stats?created_from=10&created_to=1"
    });
    expect(invalidStatsCreatedRangeResponse.statusCode).toBe(400);

    const invalidStatsUpdatedRangeResponse = await app.inject({
      method: "GET",
      url: "/memories/stats?updated_from=10&updated_to=1"
    });
    expect(invalidStatsUpdatedRangeResponse.statusCode).toBe(400);

    const invalidStatsImportanceRangeResponse = await app.inject({
      method: "GET",
      url: "/memories/stats?importance_min=0.9&importance_max=0.1"
    });
    expect(invalidStatsImportanceRangeResponse.statusCode).toBe(400);

    const invalidStatsConfidenceRangeResponse = await app.inject({
      method: "GET",
      url: "/memories/stats?confidence_min=0.9&confidence_max=0.1"
    });
    expect(invalidStatsConfidenceRangeResponse.statusCode).toBe(400);

    const invalidBatchDeleteResponse = await app.inject({
      method: "POST",
      url: "/memories/batch/delete",
      payload: {
        ids: ["mem_1", "mem_1"]
      }
    });
    expect(invalidBatchDeleteResponse.statusCode).toBe(400);
    const invalidBatchDeleteBody = invalidBatchDeleteResponse.json<ErrorResponse>();
    expect(invalidBatchDeleteBody.error.code).toBe("validation_error");
    expect(invalidBatchDeleteBody.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "ids.1",
          message: expect.stringContaining("Duplicate memory id")
        })
      ])
    );
  });

  it("updates memory items and reports missing resources", async () => {
    const sessionId = await createSession(app, "Memory Update Session");
    const floorId = await createFloor(app, { sessionId, floorNo: 1, branchId: "main" });
    const pageId = await createPage(app, { floorId, pageNo: 1, pageKind: "input" });
    const message = await createMessage(app, {
      pageId,
      seq: 1,
      role: "assistant",
      content: "Update source message"
    });
    const memory = await createMemory(app, {
      scope: "chat",
      scopeId: sessionId,
      type: "fact",
      content: { text: "initial memory" },
      sourceFloorId: floorId,
      sourceMessageId: message.id
    });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/memories/${memory.id}`,
      payload: {
        scope: "floor",
        scope_id: floorId,
        type: "open_loop",
        content: { text: "updated silver memory" },
        importance: 0.9,
        confidence: 0.25,
        source_floor_id: floorId,
        source_message_id: message.id,
        status: "deprecated"
      }
    });

    expect(patchResponse.statusCode, patchResponse.body).toBe(200);
    expect(patchResponse.json<ItemResponse<MemoryDto>>().data).toEqual(
      expect.objectContaining({
        id: memory.id,
        scope: "floor",
        scope_id: floorId,
        type: "open_loop",
        content: { text: "updated silver memory" },
        importance: 0.9,
        confidence: 0.25,
        source_floor_id: floorId,
        source_message_id: message.id,
        status: "deprecated"
      })
    );

    const invalidPatchResponse = await app.inject({
      method: "PATCH",
      url: `/memories/${memory.id}`,
      payload: {}
    });
    expect(invalidPatchResponse.statusCode).toBe(400);
    expect(invalidPatchResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const missingGetResponse = await app.inject({
      method: "GET",
      url: "/memories/missing-memory"
    });
    expect(missingGetResponse.statusCode).toBe(404);
    expect(missingGetResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const missingPatchResponse = await app.inject({
      method: "PATCH",
      url: "/memories/missing-memory",
      payload: { status: "active" }
    });
    expect(missingPatchResponse.statusCode).toBe(404);
    expect(missingPatchResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const missingDeleteResponse = await app.inject({
      method: "DELETE",
      url: "/memories/missing-memory"
    });
    expect(missingDeleteResponse.statusCode).toBe(404);
    expect(missingDeleteResponse.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("covers memory edge validation, filtering, and missing branches", async () => {
    const memoryA = await createMemory(app, {
      scope: "chat",
      scopeId: "edge-scope",
      type: "fact",
      content: { text: "edge source" }
    });
    const memoryB = await createMemory(app, {
      scope: "chat",
      scopeId: "edge-scope",
      type: "summary",
      content: { text: "edge target" }
    });

    const invalidCreateEdgeResponse = await app.inject({
      method: "POST",
      url: "/memory-edges",
      payload: {}
    });
    expect(invalidCreateEdgeResponse.statusCode).toBe(400);
    expect(invalidCreateEdgeResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const edge = await createMemoryEdge(app, {
      fromId: memoryA.id,
      toId: memoryB.id,
      relation: "supports"
    });

    const listEdgesResponse = await app.inject({
      method: "GET",
      url: `/memory-edges?to_id=${memoryB.id}&relation=supports&limit=10&offset=0&sort_by=created_at&sort_order=asc`
    });
    expect(listEdgesResponse.statusCode, listEdgesResponse.body).toBe(200);
    const listEdgesBody = listEdgesResponse.json<ListResponse<MemoryEdgeDto>>();
    expect(listEdgesBody.meta.total).toBe(1);
    expect(listEdgesBody.data).toEqual([
      expect.objectContaining({
        id: edge.id,
        from_id: memoryA.id,
        to_id: memoryB.id,
        relation: "supports"
      })
    ]);

    const invalidListEdgesResponse = await app.inject({
      method: "GET",
      url: "/memory-edges?limit=0"
    });
    expect(invalidListEdgesResponse.statusCode).toBe(400);
    expect(invalidListEdgesResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const missingGetEdgeResponse = await app.inject({
      method: "GET",
      url: "/memory-edges/missing-edge"
    });
    expect(missingGetEdgeResponse.statusCode).toBe(404);
    expect(missingGetEdgeResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const patchEdgeResponse = await app.inject({
      method: "PATCH",
      url: `/memory-edges/${edge.id}`,
      payload: { relation: "updates" }
    });
    expect(patchEdgeResponse.statusCode, patchEdgeResponse.body).toBe(200);
    expect(patchEdgeResponse.json<ItemResponse<MemoryEdgeDto>>().data).toEqual(
      expect.objectContaining({
        id: edge.id,
        relation: "updates"
      })
    );

    const invalidPatchEdgeResponse = await app.inject({
      method: "PATCH",
      url: `/memory-edges/${edge.id}`,
      payload: {}
    });
    expect(invalidPatchEdgeResponse.statusCode).toBe(400);
    expect(invalidPatchEdgeResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const missingPatchEdgeResponse = await app.inject({
      method: "PATCH",
      url: "/memory-edges/missing-edge",
      payload: { relation: "contradicts" }
    });
    expect(missingPatchEdgeResponse.statusCode).toBe(404);
    expect(missingPatchEdgeResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const missingDeleteEdgeResponse = await app.inject({
      method: "DELETE",
      url: "/memory-edges/missing-edge"
    });
    expect(missingDeleteEdgeResponse.statusCode).toBe(404);
    expect(missingDeleteEdgeResponse.json<ErrorResponse>().error.code).toBe("not_found");
  });
});

describe("memory routes with multi-account auth", () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" }
    }));

    tokenA = app.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
    tokenB = app.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });

    const createAccountAResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeader(tokenA),
      payload: { id: "acc-a", name: "Account A" }
    });
    expect(createAccountAResponse.statusCode).toBe(201);

    const createAccountBResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeader(tokenB),
      payload: { id: "acc-b", name: "Account B" }
    });
    expect(createAccountBResponse.statusCode).toBe(201);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("isolates memories and memory edges by account", async () => {
    const memoryA1 = await createMemory(
      app,
      {
        scope: "chat",
        scopeId: "session-a",
        type: "fact",
        content: { text: "account a memory" }
      },
      authHeader(tokenA)
    );
    const memoryA2 = await createMemory(
      app,
      {
        scope: "chat",
        scopeId: "session-a",
        type: "summary",
        content: { text: "account a summary" }
      },
      authHeader(tokenA)
    );
    const edgeA = await createMemoryEdge(
      app,
      {
        fromId: memoryA1.id,
        toId: memoryA2.id,
        relation: "supports"
      },
      authHeader(tokenA)
    );

    const listBResponse = await app.inject({
      method: "GET",
      url: "/memories?scope=chat&scope_id=session-a&limit=10&offset=0&sort_by=created_at&sort_order=asc",
      headers: authHeader(tokenB)
    });
    expect(listBResponse.statusCode).toBe(200);
    expect(listBResponse.json<ListResponse<MemoryDto>>().data).toEqual([]);
    expect(listBResponse.json<ListResponse<MemoryDto>>().meta.total).toBe(0);

    const statsBResponse = await app.inject({
      method: "GET",
      url: "/memories/stats?scope=chat&scope_id=session-a",
      headers: authHeader(tokenB)
    });
    expect(statsBResponse.statusCode).toBe(200);
    expect(
      statsBResponse.json<{
        data: { total: number; active: number; deprecated: number; by_type: { fact: number; summary: number; open_loop: number } };
      }>()
    ).toEqual({
      data: {
        total: 0,
        active: 0,
        deprecated: 0,
        by_type: {
          fact: 0,
          summary: 0,
          open_loop: 0
        },
        avg_importance: 0,
        avg_confidence: 0,
        estimated_tokens: 0
      }
    });

    const getMemoryBResponse = await app.inject({
      method: "GET",
      url: `/memories/${memoryA1.id}`,
      headers: authHeader(tokenB)
    });
    expect(getMemoryBResponse.statusCode).toBe(404);

    const patchMemoryBResponse = await app.inject({
      method: "PATCH",
      url: `/memories/${memoryA1.id}`,
      headers: authHeader(tokenB),
      payload: { status: "deprecated" }
    });
    expect(patchMemoryBResponse.statusCode).toBe(404);

    const batchStatusBResponse = await app.inject({
      method: "PATCH",
      url: "/memories/batch/status",
      headers: authHeader(tokenB),
      payload: { ids: [memoryA1.id], status: "deprecated" }
    });
    expect(batchStatusBResponse.statusCode).toBe(200);
    expect(batchStatusBResponse.json()).toEqual({
      data: {
        results: [{ index: 0, id: memoryA1.id, action: "not_found" }],
        meta: {
          total: 1,
          updated: 0,
          not_found: 1,
          status: "deprecated"
        }
      }
    });

    const batchDeleteBResponse = await app.inject({
      method: "POST",
      url: "/memories/batch/delete",
      headers: authHeader(tokenB),
      payload: { ids: [memoryA1.id] }
    });
    expect(batchDeleteBResponse.statusCode).toBe(200);
    expect(batchDeleteBResponse.json()).toEqual({
      data: {
        results: [{ index: 0, id: memoryA1.id, action: "not_found" }],
        meta: {
          total: 1,
          deleted: 0,
          not_found: 1
        }
      }
    });

    const getMemoryAResponse = await app.inject({
      method: "GET",
      url: `/memories/${memoryA1.id}`,
      headers: authHeader(tokenA)
    });
    expect(getMemoryAResponse.statusCode).toBe(200);

    const listEdgesBResponse = await app.inject({
      method: "GET",
      url: "/memory-edges?relation=supports&limit=10&offset=0&sort_by=created_at&sort_order=asc",
      headers: authHeader(tokenB)
    });
    expect(listEdgesBResponse.statusCode).toBe(200);
    expect(listEdgesBResponse.json<ListResponse<MemoryEdgeDto>>().data).toEqual([]);
    expect(listEdgesBResponse.json<ListResponse<MemoryEdgeDto>>().meta.total).toBe(0);

    const getEdgeBResponse = await app.inject({
      method: "GET",
      url: `/memory-edges/${edgeA.id}`,
      headers: authHeader(tokenB)
    });
    expect(getEdgeBResponse.statusCode).toBe(404);

    const patchEdgeBResponse = await app.inject({
      method: "PATCH",
      url: `/memory-edges/${edgeA.id}`,
      headers: authHeader(tokenB),
      payload: { relation: "updates" }
    });
    expect(patchEdgeBResponse.statusCode).toBe(404);

    const deleteEdgeBResponse = await app.inject({
      method: "DELETE",
      url: `/memory-edges/${edgeA.id}`,
      headers: authHeader(tokenB)
    });
    expect(deleteEdgeBResponse.statusCode).toBe(404);
  });
});
