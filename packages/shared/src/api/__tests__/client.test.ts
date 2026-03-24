import { describe, it, expect, vi } from "vitest";

import { createApiClient } from "../client.js";

// ── helpers ──────────────────────────────────────────────

/**
 * 创建一个 mock fetchImpl，返回指定的 Response。
 * 同时暴露 spy 供断言调用参数。
 */
function mockFetch(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(text: string, status = 200, contentType = "text/html"): Response {
  return new Response(text, {
    status,
    headers: { "content-type": contentType },
  });
}

function emptyResponse(status = 200): Response {
  return new Response("", {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── createApiClient ─────────────────────────────────────

describe("createApiClient", () => {
  const baseUrl = "http://localhost:3000";

  it("sends GET request with correct URL and method", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).get("/health" as any);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect((url as URL).toString()).toBe("http://localhost:3000/health");
    expect(init!.method).toBe("GET");
  });

  it("sends POST with JSON content-type when body is provided", async () => {
    const fetch = mockFetch(jsonResponse({ id: "1" }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).post("/items" as any, { body: { name: "test" } } as any);

    const [, init] = fetch.mock.calls[0]!;
    const headers = init!.headers as Headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(init!.body).toBe(JSON.stringify({ name: "test" }));
  });

  it("does not override existing content-type header", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).post("/items" as any, {
      body: { name: "test" },
      headers: { "content-type": "text/plain" },
    } as any);

    const [, init] = fetch.mock.calls[0]!;
    const headers = init!.headers as Headers;
    expect(headers.get("content-type")).toBe("text/plain");
  });

  it("does not send body when body is undefined", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).get("/health" as any);

    const [, init] = fetch.mock.calls[0]!;
    expect(init!.body).toBeUndefined();
  });

  it("strips trailing slash from baseUrl", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: "http://example.com/", fetchImpl: fetch });

    await (client as any).get("/health" as any);

    const [url] = fetch.mock.calls[0]!;
    expect((url as URL).toString()).toBe("http://example.com/health");
  });

  it("shortcut methods map to correct HTTP methods", async () => {
    const methods = ["get", "post", "put", "patch", "delete"] as const;

    for (const method of methods) {
      const fetch = mockFetch(jsonResponse({ ok: true }));
      const client = createApiClient({ baseUrl, fetchImpl: fetch });

      await (client as any)[method]("/test" as any);

      const [, init] = fetch.mock.calls[0]!;
      expect(init!.method).toBe(method.toUpperCase());
    }
  });

  it("returns parsed response with status, headers, body, raw", async () => {
    const fetch = mockFetch(jsonResponse({ data: "hello" }, 200));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    const result = await (client as any).get("/health" as any);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: "hello" });
    expect(result.headers).toBeInstanceOf(Headers);
    expect(result.raw).toBeInstanceOf(Response);
  });
});

// ── applyPathParams (indirect) ──────────────────────────

describe("path parameters", () => {
  const baseUrl = "http://localhost:3000";

  it("replaces path parameters correctly", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).get("/items/{id}" as any, { path: { id: "abc-123" } } as any);

    const [url] = fetch.mock.calls[0]!;
    expect((url as URL).pathname).toBe("/items/abc-123");
  });

  it("throws when required path parameter is missing", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await expect(
      (client as any).get("/items/{id}" as any, {} as any),
    ).rejects.toThrow("Missing path parameter: id");
  });

  it("encodes path parameter values", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).get("/items/{id}" as any, { path: { id: "a b/c" } } as any);

    const [url] = fetch.mock.calls[0]!;
    expect((url as URL).pathname).toBe("/items/a%20b%2Fc");
  });
});

// ── appendQuery (indirect) ──────────────────────────────

describe("query parameters", () => {
  const baseUrl = "http://localhost:3000";

  it("appends query parameters to URL", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).get("/items" as any, { query: { limit: 10, offset: 5 } } as any);

    const [url] = fetch.mock.calls[0]!;
    const searchParams = (url as URL).searchParams;
    expect(searchParams.get("limit")).toBe("10");
    expect(searchParams.get("offset")).toBe("5");
  });

  it("skips null and undefined query values", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).get("/items" as any, {
      query: { a: 1, b: null, c: undefined },
    } as any);

    const [url] = fetch.mock.calls[0]!;
    const searchParams = (url as URL).searchParams;
    expect(searchParams.get("a")).toBe("1");
    expect(searchParams.has("b")).toBe(false);
    expect(searchParams.has("c")).toBe(false);
  });

  it("expands array query values into multiple params", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).get("/items" as any, {
      query: { tags: ["a", "b"] },
    } as any);

    const [url] = fetch.mock.calls[0]!;
    const searchParams = (url as URL).searchParams;
    expect(searchParams.getAll("tags")).toEqual(["a", "b"]);
  });

  it("skips null/undefined items inside array query values", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    await (client as any).get("/items" as any, {
      query: { tags: ["a", null, undefined, "b"] },
    } as any);

    const [url] = fetch.mock.calls[0]!;
    expect((url as URL).searchParams.getAll("tags")).toEqual(["a", "b"]);
  });
});

// ── readJsonBody (indirect) ─────────────────────────────

describe("response body parsing", () => {
  const baseUrl = "http://localhost:3000";

  it("parses JSON response body", async () => {
    const fetch = mockFetch(jsonResponse({ data: [1, 2, 3] }));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    const result = await (client as any).get("/items" as any);
    expect(result.body).toEqual({ data: [1, 2, 3] });
  });

  it("returns null body for non-JSON content-type", async () => {
    const fetch = mockFetch(textResponse("<html></html>"));
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    const result = await (client as any).get("/page" as any);
    expect(result.body).toBeNull();
  });

  it("returns null body for empty JSON response", async () => {
    const fetch = mockFetch(emptyResponse());
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    const result = await (client as any).get("/empty" as any);
    expect(result.body).toBeNull();
  });

  it("returns null body for malformed JSON", async () => {
    const fetch = mockFetch(
      new Response("{broken", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createApiClient({ baseUrl, fetchImpl: fetch });

    const result = await (client as any).get("/broken" as any);
    expect(result.body).toBeNull();
  });
});
