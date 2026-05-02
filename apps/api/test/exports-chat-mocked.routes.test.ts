import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exportServiceMock = vi.hoisted(() => ({
  serializeSessionToThChat: vi.fn(),
  serializeSessionToStJsonl: vi.fn(),
}));

vi.mock("../src/services/chat-export.js", () => ({
  serializeSessionToThChat: exportServiceMock.serializeSessionToThChat,
  serializeSessionToStJsonl: exportServiceMock.serializeSessionToStJsonl,
}));

import { buildApp } from "../src/app";

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: {
      request_id?: string;
      error_code?: string;
      native_pipeline_node?: string;
    };
  };
};

describe("Export chat route mocked branches", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    exportServiceMock.serializeSessionToThChat.mockReset();
    exportServiceMock.serializeSessionToStJsonl.mockReset();
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("falls back to top-level th_session_title and to export.jsonl for malformed headers", async () => {
    exportServiceMock.serializeSessionToStJsonl.mockReturnValueOnce(
      `${JSON.stringify({ th_session_title: "Title / Only" })}\n${JSON.stringify({ mes: "ok" })}`
    );

    const titleFallbackRes = await app.inject({
      method: "GET",
      url: "/export/chat/mock-session?format=st_jsonl",
    });
    expect(titleFallbackRes.statusCode).toBe(200);
    expect(titleFallbackRes.headers["content-disposition"]).toContain('filename="Title _ Only.jsonl"');

    exportServiceMock.serializeSessionToStJsonl.mockReturnValueOnce("{not-json}\n{}");

    const malformedRes = await app.inject({
      method: "GET",
      url: "/export/chat/mock-session?format=st_jsonl",
    });
    expect(malformedRes.statusCode).toBe(200);
    expect(malformedRes.headers["content-disposition"]).toContain('filename="export.jsonl"');
  });

  it("rethrows unexpected chat export errors as internal_error", async () => {
    exportServiceMock.serializeSessionToThChat.mockImplementation(() => {
      throw new Error("boom");
    });

    const res = await app.inject({
      method: "GET",
      url: "/export/chat/mock-session",
    });

    expect(res.statusCode).toBe(500);
    expect(res.json<ErrorResponse>().error.code).toBe("internal_error");
    expect(res.json<ErrorResponse>().error.message).toBe("boom");
    expect(typeof res.json<ErrorResponse>().error.details?.request_id).toBe("string");
  });
});
