import { describe, expect, it } from "vitest";

import { applyCorsHeaders } from "../cors.js";

type TestHeaderStore = Record<string, string>;

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
