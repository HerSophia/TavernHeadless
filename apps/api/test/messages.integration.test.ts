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

type MessageRole = "user" | "assistant" | "system" | "narrator";
type MessageFormat = "text" | "markdown" | "json";
type PageKind = "input" | "output" | "mixed";

type MessageDto = {
  id: string;
  page_id: string;
  seq: number;
  role: MessageRole;
  content: string;
  content_format: MessageFormat;
  token_count: number;
  is_hidden: boolean;
  source: string | null;
  created_at: number;
};

describe("message routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function createSession(title = "Message Session"): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title }
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createFloor(args: { sessionId: string; floorNo: number; branchId: string }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: args.sessionId,
        floor_no: args.floorNo,
        branch_id: args.branchId
      }
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createPage(args: { floorId: string; pageNo: number; pageKind: PageKind }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/pages",
      payload: {
        floor_id: args.floorId,
        page_no: args.pageNo,
        page_kind: args.pageKind
      }
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createMessage(args: {
    pageId: string;
    seq: number;
    role: MessageRole;
    content: string;
    contentFormat?: MessageFormat;
    tokenCount?: number;
    isHidden?: boolean;
    source?: string;
  }): Promise<MessageDto> {
    const response = await app.inject({
      method: "POST",
      url: "/messages",
      payload: {
        page_id: args.pageId,
        seq: args.seq,
        role: args.role,
        content: args.content,
        ...(args.contentFormat !== undefined ? { content_format: args.contentFormat } : {}),
        ...(args.tokenCount !== undefined ? { token_count: args.tokenCount } : {}),
        ...(args.isHidden !== undefined ? { is_hidden: args.isHidden } : {}),
        ...(args.source !== undefined ? { source: args.source } : {})
      }
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<MessageDto>>().data;
  }

  it("lists messages with and without filters", async () => {
    const sessionId = await createSession();
    const floorId = await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    const pageA = await createPage({ floorId, pageNo: 1, pageKind: "mixed" });
    const pageB = await createPage({ floorId, pageNo: 2, pageKind: "output" });

    const userMessage = await createMessage({
      pageId: pageA,
      seq: 1,
      role: "user",
      content: "User greeting"
    });
    const narratorMessage = await createMessage({
      pageId: pageA,
      seq: 2,
      role: "narrator",
      content: "Narrator note",
      contentFormat: "markdown",
      tokenCount: 42,
      isHidden: true,
      source: "model"
    });
    const systemMessage = await createMessage({
      pageId: pageB,
      seq: 1,
      role: "system",
      content: "System note",
      contentFormat: "json"
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/messages?limit=10&offset=0&sort_order=asc"
    });

    expect(listResponse.statusCode, listResponse.body).toBe(200);
    const listBody = listResponse.json<ListResponse<MessageDto>>();
    expect(listBody.meta).toEqual({
      total: 3,
      limit: 10,
      offset: 0,
      has_more: false,
      sort_by: "created_at",
      sort_order: "asc"
    });
    expect(listBody.data).toHaveLength(3);
    expect(new Set(listBody.data.map((item) => item.id))).toEqual(
      new Set([userMessage.id, narratorMessage.id, systemMessage.id])
    );

    const filteredResponse = await app.inject({
      method: "GET",
      url: `/messages?page_id=${pageA}&role=narrator&is_hidden=true&limit=10&offset=0&sort_by=seq&sort_order=desc`
    });

    expect(filteredResponse.statusCode, filteredResponse.body).toBe(200);
    const filteredBody = filteredResponse.json<ListResponse<MessageDto>>();
    expect(filteredBody.meta).toEqual({
      total: 1,
      limit: 10,
      offset: 0,
      has_more: false,
      sort_by: "seq",
      sort_order: "desc"
    });
    expect(filteredBody.data).toEqual([
      expect.objectContaining({
        id: narratorMessage.id,
        page_id: pageA,
        role: "narrator",
        content_format: "markdown",
        token_count: 42,
        is_hidden: true,
        source: "model"
      })
    ]);
  });

  it("updates message fields and reports invalid or missing messages", async () => {
    const sessionId = await createSession();
    const floorId = await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    const pageId = await createPage({ floorId, pageNo: 1, pageKind: "mixed" });
    const message = await createMessage({
      pageId,
      seq: 1,
      role: "assistant",
      content: "Initial content"
    });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/messages/${message.id}`,
      payload: {
        seq: 5,
        role: "narrator",
        content: "Edited content",
        content_format: "json",
        token_count: 123,
        is_hidden: true,
        source: "manual"
      }
    });

    expect(patchResponse.statusCode, patchResponse.body).toBe(200);
    expect(patchResponse.json<ItemResponse<MessageDto>>().data).toEqual(
      expect.objectContaining({
        id: message.id,
        page_id: pageId,
        seq: 5,
        role: "narrator",
        content: "Edited content",
        content_format: "json",
        token_count: 123,
        is_hidden: true,
        source: "manual"
      })
    );

    const invalidPatchResponse = await app.inject({
      method: "PATCH",
      url: `/messages/${message.id}`,
      payload: {}
    });

    expect(invalidPatchResponse.statusCode).toBe(400);
    expect(invalidPatchResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const missingPatchResponse = await app.inject({
      method: "PATCH",
      url: "/messages/missing-message",
      payload: { content: "Ghost edit" }
    });

    expect(missingPatchResponse.statusCode).toBe(404);
    expect(missingPatchResponse.json<ErrorResponse>().error.code).toBe("not_found");

    const missingDeleteResponse = await app.inject({
      method: "DELETE",
      url: "/messages/missing-message"
    });

    expect(missingDeleteResponse.statusCode).toBe(404);
    expect(missingDeleteResponse.json<ErrorResponse>().error.code).toBe("not_found");
  });

  it("validates message creation and batch delete requests", async () => {
    const sessionId = await createSession();
    const floorId = await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    const pageId = await createPage({ floorId, pageNo: 1, pageKind: "input" });

    const invalidCreateResponse = await app.inject({
      method: "POST",
      url: "/messages",
      payload: {
        page_id: pageId,
        seq: -1,
        role: "user",
        content: ""
      }
    });

    expect(invalidCreateResponse.statusCode).toBe(400);
    expect(invalidCreateResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const invalidBatchDeleteResponse = await app.inject({
      method: "POST",
      url: "/messages/batch/delete",
      payload: {
        ids: ["msg_1", "msg_1"]
      }
    });

    expect(invalidBatchDeleteResponse.statusCode).toBe(400);
    const invalidBatchDeleteBody = invalidBatchDeleteResponse.json<ErrorResponse>();
    expect(invalidBatchDeleteBody.error.code).toBe("validation_error");
    expect(invalidBatchDeleteBody.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "ids.1",
          message: expect.stringContaining("Duplicate message id")
        })
      ])
    );
  });
});
