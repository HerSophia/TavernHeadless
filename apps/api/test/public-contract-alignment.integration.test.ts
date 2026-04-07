import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type ItemResponse<T> = { data: T };

async function createSession(app: FastifyInstance, title = "Contract Session"): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { title },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}

async function createFloor(app: FastifyInstance, sessionId: string): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/floors",
    payload: {
      session_id: sessionId,
      floor_no: 1,
      branch_id: "main",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}

async function createPage(app: FastifyInstance, floorId: string): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/pages",
    payload: {
      floor_id: floorId,
      page_no: 1,
      page_kind: "output",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}

async function createMemory(app: FastifyInstance, content: string | { text: string }): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/memories",
    payload: {
      scope: "chat",
      scope_id: "session-contract",
      type: "summary",
      content,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<ItemResponse<{ id: string }>>().data;
}

describe("public contract alignment", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects public is_active writes on page create and update", async () => {
    const session = await createSession(app);
    const floor = await createFloor(app, session.id);
    const page = await createPage(app, floor.id);

    const createResponse = await app.inject({
      method: "POST",
      url: "/pages",
      payload: {
        floor_id: floor.id,
        is_active: true,
        page_kind: "output",
        page_no: 2,
      },
    });

    expect(createResponse.statusCode, createResponse.body).toBe(400);
    expect(createResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/pages/${page.id}`,
      payload: {
        is_active: false,
      },
    });

    expect(updateResponse.statusCode, updateResponse.body).toBe(400);
    expect(updateResponse.json<ErrorResponse>().error.code).toBe("validation_error");
  });

  it("accepts text memory content and rejects arbitrary JSON payloads", async () => {
    const wrapperResponse = await app.inject({
      method: "POST",
      url: "/memories",
      payload: {
        scope: "chat",
        scope_id: "session-contract",
        type: "summary",
        content: { text: "Session summary" },
      },
    });

    expect(wrapperResponse.statusCode, wrapperResponse.body).toBe(201);
    expect(wrapperResponse.json<ItemResponse<{ content: { text: string } }>>().data.content).toEqual({ text: "Session summary" });

    const plainTextResponse = await app.inject({
      method: "POST",
      url: "/memories",
      payload: {
        scope: "chat",
        scope_id: "session-contract",
        type: "fact",
        content: "Plain text fact",
      },
    });

    expect(plainTextResponse.statusCode, plainTextResponse.body).toBe(201);
    expect(plainTextResponse.json<ItemResponse<{ content: string }>>().data.content).toBe("Plain text fact");

    const invalidCreateResponse = await app.inject({
      method: "POST",
      url: "/memories",
      payload: {
        scope: "chat",
        scope_id: "session-contract",
        type: "summary",
        content: { nested: true },
      },
    });

    expect(invalidCreateResponse.statusCode, invalidCreateResponse.body).toBe(400);
    expect(invalidCreateResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const memory = await createMemory(app, { text: "Patch target" });
    const invalidPatchResponse = await app.inject({
      method: "PATCH",
      url: `/memories/${memory.id}`,
      payload: {
        content: { nested: true },
      },
    });

    expect(invalidPatchResponse.statusCode, invalidPatchResponse.body).toBe(400);
    expect(invalidPatchResponse.json<ErrorResponse>().error.code).toBe("validation_error");
  });

  it("rejects unsupported tool handler types on create and update", async () => {
    const invalidCreateResponse = await app.inject({
      method: "POST",
      url: "/tools/definitions",
      payload: {
        name: "legacy_prompt_tool",
        handler_type: "prompt",
        handler: { prompt: "do something" },
      },
    });

    expect(invalidCreateResponse.statusCode, invalidCreateResponse.body).toBe(400);
    expect(invalidCreateResponse.json<ErrorResponse>().error.code).toBe("validation_error");

    const createResponse = await app.inject({
      method: "POST",
      url: "/tools/definitions",
      payload: {
        name: "script_tool",
        handler_type: "script",
        handler: { script: "return args;" },
      },
    });

    expect(createResponse.statusCode, createResponse.body).toBe(403);
    expect(createResponse.json<ErrorResponse>().error.code).toBe("tool_script_handler_disabled");

    const invalidUpdateResponse = await app.inject({
      method: "PATCH",
      url: "/tools/definitions/nonexistent",
      payload: {
        handler_type: "delegate",
      },
    });

    expect(invalidUpdateResponse.statusCode, invalidUpdateResponse.body).toBe(400);
    expect(invalidUpdateResponse.json<ErrorResponse>().error.code).toBe("validation_error");
  });
});
