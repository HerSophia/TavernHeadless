import { describe, expect, it } from "vitest";
import Fastify from "fastify";

import { applyCorsHeaders, registerCors } from "../cors.js";
import { registerAuth } from "../auth.js";
import { createDatabase } from "../../db/client.js";

type TestHeaderStore = Record<string, string>;
type ResponseHeaderValue = string | string[] | number | undefined;

function createHeaderTarget(initial: TestHeaderStore = {}) {
  const store = new Map<string, string>(Object.entries(initial));

  return {
    getHeader(name: string): string | undefined {
      return store.get(name);
    },
    setHeader(name: string, value: string): void {
      store.set(name, value);
    },
    headers(): TestHeaderStore {
      return Object.fromEntries(store.entries());
    },
  };
}

function headerTokens(value: ResponseHeaderValue): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  }

  return value === undefined ? [] : String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

describe("applyCorsHeaders", () => {
  it("uses wildcard origin when CORS allows any origin without credentials", () => {
    const target = createHeaderTarget();

    applyCorsHeaders(target, "http://debian:5173", {
      origins: true,
      credentials: false,
    });

    expect(target.headers()).toEqual({
      "Access-Control-Allow-Origin": "*",
    });
  });

  it("reflects the request origin and credentials when wildcard CORS uses credentials", () => {
    const target = createHeaderTarget();

    applyCorsHeaders(target, "http://debian:5173", {
      origins: true,
      credentials: true,
    });

    expect(target.headers()).toEqual({
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Origin": "http://debian:5173",
      Vary: "Origin",
    });
  });

  it("reflects an allowlisted origin and preserves existing Vary values", () => {
    const target = createHeaderTarget({ Vary: "Accept-Encoding" });

    applyCorsHeaders(target, "http://debian:5173", {
      origins: ["http://debian:5173"],
      credentials: false,
    });

    expect(target.headers()).toEqual({
      "Access-Control-Allow-Origin": "http://debian:5173",
      Vary: "Accept-Encoding, Origin",
    });
  });

  it("does not add CORS headers for disallowed origins", () => {
    const target = createHeaderTarget();

    applyCorsHeaders(target, "http://debian:5173", {
      origins: ["http://localhost:5173"],
      credentials: false,
    });

    expect(target.headers()).toEqual({});
  });
});

describe("registerCors", () => {
  it("handles client owner preflight requests before authentication", async () => {
    const app = Fastify({ logger: false });
    const database = createDatabase(":memory:");

    try {
      await registerCors(app, {
        origins: ["http://localhost:5174", "http://127.0.0.1:5174"],
        credentials: false,
      });
      await registerAuth(app, { mode: "api_key", apiKeys: ["secret-key"] }, { db: database.db });
      await app.ready();

      const response = await app.inject({
        method: "OPTIONS",
        url: "/client-data/domains",
        headers: {
          Origin: "http://localhost:5174",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type, X-Client-Owner-Type, X-Client-Owner-Id",
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5174");

      const allowedMethods = headerTokens(response.headers["access-control-allow-methods"]);
      expect(allowedMethods).toEqual(expect.arrayContaining([
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ]));

      const allowedHeaders = headerTokens(response.headers["access-control-allow-headers"])
        .map((header) => header.toLowerCase());
      expect(allowedHeaders).toEqual(expect.arrayContaining([
        "content-type",
        "authorization",
        "x-client-owner-type",
        "x-client-owner-id",
      ]));
    } finally {
      await app.close();
      database.close();
    }
  });
});
