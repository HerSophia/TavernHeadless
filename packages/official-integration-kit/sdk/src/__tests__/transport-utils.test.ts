import { describe, expect, it, vi } from "vitest";

import { createResponseError } from "../errors/normalize-error.js";
import { isTavernApiError, TavernApiError } from "../errors/tavern-api-error.js";
import {
  buildAccountHeaders,
  createTransportClient,
  resolvePath,
} from "../client/transport.js";
import {
  buildQueryString,
  compactObject,
  isRecord,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readRecord,
  readString,
} from "../resources/utils.js";

const baseUrl = "http://localhost:3000/";

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    status,
  });
}

function textResponse(body: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/plain",
      ...(headers ?? {}),
    },
    status,
  });
}

describe("transport helpers", () => {
  it("builds account headers only when account id exists", () => {
    expect(buildAccountHeaders()).toBeUndefined();
    expect(buildAccountHeaders("acc-1")).toEqual({
      "x-account-id": "acc-1",
    });
  });

  it("resolves paths against a normalized base URL", () => {
    expect(resolvePath("http://localhost:3000/", "/health")).toBe("http://localhost:3000/health");
    expect(resolvePath("http://localhost:3000", "/health")).toBe("http://localhost:3000/health");
  });
});

describe("createTransportClient", () => {
  it("fetchJson stringifies request bodies and defaults to POST", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createTransportClient({ baseUrl, fetchImpl });

    const result = await client.fetchJson<{ ok: boolean }>("/echo", {
      body: { hello: "world" },
    });

    expect(result.body).toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0]!;
    const headers = init?.headers as Headers;

    expect(String(url)).toBe("http://localhost:3000/echo");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ hello: "world" }));
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("merges default headers with request headers and filters non-string values", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ service: "ok" }));
    const client = createTransportClient({
      baseUrl,
      fetchImpl,
      getHeaders: () => ({
        authorization: "Bearer default",
        "x-default": "1",
      }),
    });

    await client.get("/health", {
      headers: {
        authorization: "Bearer override",
        bad: 123,
        "x-extra": "2",
      } as unknown as Record<string, string>,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = init?.headers as Headers;

    expect(init?.method).toBe("GET");
    expect(headers.get("authorization")).toBe("Bearer override");
    expect(headers.get("x-default")).toBe("1");
    expect(headers.get("x-extra")).toBe("2");
    expect(headers.get("bad")).toBeNull();
  });

  it("uses GET without a body and forwards abort signals", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(textResponse("pong"));
    const client = createTransportClient({ baseUrl, fetchImpl });
    const controller = new AbortController();

    const response = await client.fetchRaw("/ping", {
      signal: controller.signal,
    });

    expect(await response.text()).toBe("pong");

    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = init?.headers as Headers;

    expect(init?.method).toBe("GET");
    expect(init?.signal).toBe(controller.signal);
    expect(headers.get("accept")).toBeNull();
    expect(headers.get("content-type")).toBeNull();
  });

  it("preserves explicit accept and content-type headers when a body is present", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(textResponse("ok"));
    const client = createTransportClient({ baseUrl, fetchImpl });

    await client.fetchRaw("/echo", {
      accept: "application/json",
      body: { ok: true },
      headers: {
        accept: "text/custom",
        "content-type": "application/merge-patch+json",
      },
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = init?.headers as Headers;

    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ ok: true }));
    expect(headers.get("accept")).toBe("text/custom");
    expect(headers.get("content-type")).toBe("application/merge-patch+json");
  });

  it("returns null bodies for non-json empty-json and invalid-json responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse("ok"))
      .mockResolvedValueOnce(new Response("", {
        headers: { "content-type": "application/json" },
        status: 200,
      }))
      .mockResolvedValueOnce(new Response("{", {
        headers: { "content-type": "application/json" },
        status: 200,
      }));
    const client = createTransportClient({ baseUrl, fetchImpl });

    const result1 = await client.fetchJson("/plain", { method: "GET" });
    const result2 = await client.fetchJson("/empty", { method: "GET" });
    const result3 = await client.fetchJson("/broken", { method: "GET" });

    expect(result1.body).toBeNull();
    expect(result2.body).toBeNull();
    expect(result3.body).toBeNull();
  });

  it("throws a normalized TavernApiError for non-ok responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "boom",
            details: { reason: "bad" },
            message: "Broken",
          },
        },
        500,
        { "x-request-id": "req-1" },
      ),
    );
    const client = createTransportClient({ baseUrl, fetchImpl });

    await expect(client.fetchJson("/broken", { method: "GET" })).rejects.toMatchObject({
      code: "boom",
      details: { reason: "bad" },
      message: "Broken",
      requestId: "req-1",
      status: 500,
    });
    await expect(client.fetchJson("/broken", { method: "GET" })).rejects.toBeInstanceOf(TavernApiError);
  });
});

describe("createResponseError", () => {
  it("reads nested error metadata from JSON responses", async () => {
    const error = await createResponseError(
      jsonResponse(
        {
          error: {
            code: "E_FAIL",
            details: { field: "name" },
            message: "Invalid payload",
          },
        },
        422,
        { "x-request-id": "req-22" },
      ),
    );

    expect(error).toMatchObject({
      code: "E_FAIL",
      details: { field: "name" },
      message: "Invalid payload",
      requestId: "req-22",
      status: 422,
    });
    expect(isTavernApiError(error)).toBe(true);
  });

  it("falls back to top-level message when nested error message is missing", async () => {
    const error = await createResponseError(
      jsonResponse(
        {
          message: "Top level failure",
        },
        400,
      ),
    );

    expect(error).toMatchObject({
      message: "Top level failure",
      status: 400,
    });
  });

  it.each([
    textResponse("plain failure", 502),
    new Response("", {
      headers: { "content-type": "application/json" },
      status: 503,
    }),
    new Response("{", {
      headers: { "content-type": "application/json" },
      status: 504,
    }),
  ])("falls back to a status-based message when JSON cannot be parsed", async (response) => {
    const error = await createResponseError(response);

    expect(error).toBeInstanceOf(TavernApiError);
    expect(error.message).toBe(`Request failed with status ${response.status}`);
    expect(error.status).toBe(response.status);
  });
});

describe("tavern api error helpers", () => {
  it("identifies TavernApiError instances", () => {
    const error = new TavernApiError({
      code: "E_TEST",
      details: { ok: true },
      message: "Testing",
      requestId: "req-test",
      status: 409,
    });

    expect(isTavernApiError(error)).toBe(true);
    expect(isTavernApiError(new Error("plain"))).toBe(false);
    expect(error).toMatchObject({
      code: "E_TEST",
      details: { ok: true },
      message: "Testing",
      requestId: "req-test",
      status: 409,
    });
  });
});

describe("resource utils", () => {
  it("builds query strings while skipping nullish values and flattening arrays", () => {
    expect(
      buildQueryString({
        empty: undefined,
        list: ["one", null, "two"],
        page: 1,
        q: "search",
        skip: null,
      }),
    ).toBe("list=one&list=two&page=1&q=search");
  });

  it("compacts objects by removing undefined values and preserving null", () => {
    expect(
      compactObject({
        a: null,
        b: undefined,
        c: false,
      }),
    ).toEqual({
      a: null,
      c: false,
    });
  });

  it("reads records and primitive helpers with fallbacks", () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);

    expect(readRecord({ ok: true })).toEqual({ ok: true });
    expect(readRecord("nope")).toBeNull();

    expect(readBoolean(true)).toBe(true);
    expect(readBoolean("true", true)).toBe(true);

    expect(readNumber(5)).toBe(5);
    expect(readNumber("bad", 7)).toBe(7);
    expect(readString("value")).toBe("value");
    expect(readString(1, "fallback")).toBe("fallback");

    expect(readNullableString("x")).toBe("x");
    expect(readNullableString(1)).toBeNull();
    expect(readNullableNumber(2)).toBe(2);
    expect(readNullableNumber("2")).toBeNull();

    expect(readOptionalString("hello")).toBe("hello");
    expect(readOptionalString("")).toBeUndefined();
    expect(readOptionalNumber(3)).toBe(3);
    expect(readOptionalNumber("3")).toBeUndefined();
  });
});
