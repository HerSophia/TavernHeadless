import { describe, expect, it } from "vitest";

import { buildAuthHeaders, maskCredential, normalizeBaseUrl, type BackendConnection } from "./connection";

function makeConnection(overrides: Partial<BackendConnection>): BackendConnection {
  return {
    id: "c1",
    name: "Test",
    baseUrl: "http://localhost:3000",
    authMode: "dev",
    credential: null,
    accountHint: null,
    persistCredential: false,
    ...overrides,
  };
}

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(normalizeBaseUrl("https://api.example.com///")).toBe("https://api.example.com");
  });

  it("leaves a clean url unchanged", () => {
    expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("buildAuthHeaders", () => {
  it("returns undefined for dev without account hint", () => {
    expect(buildAuthHeaders(makeConnection({ authMode: "dev" }))).toBeUndefined();
  });

  it("emits x-account-id for dev with account hint", () => {
    expect(buildAuthHeaders(makeConnection({ authMode: "dev", accountHint: "acc1" }))).toEqual({
      "x-account-id": "acc1",
    });
  });

  it("emits x-api-key for api_key mode", () => {
    expect(buildAuthHeaders(makeConnection({ authMode: "api_key", credential: "secret" }))).toEqual({
      "x-api-key": "secret",
    });
  });

  it("emits x-tavern-client-key for client_api_key mode", () => {
    expect(buildAuthHeaders(makeConnection({ authMode: "client_api_key", credential: "tvk_live_abc" }))).toEqual({
      "x-tavern-client-key": "tvk_live_abc",
    });
  });

  it("emits Authorization bearer for jwt mode", () => {
    expect(buildAuthHeaders(makeConnection({ authMode: "jwt", credential: "jwt.token" }))).toEqual({
      authorization: "Bearer jwt.token",
    });
  });

  it("omits the auth header when the credential is missing", () => {
    expect(buildAuthHeaders(makeConnection({ authMode: "api_key", credential: null }))).toBeUndefined();
    expect(buildAuthHeaders(makeConnection({ authMode: "jwt", credential: "   " }))).toBeUndefined();
  });

  it("combines credential header with account hint", () => {
    expect(
      buildAuthHeaders(makeConnection({ authMode: "api_key", credential: "secret", accountHint: "acc1" })),
    ).toEqual({ "x-api-key": "secret", "x-account-id": "acc1" });
  });
});

describe("maskCredential", () => {
  it("masks long credentials keeping the tail", () => {
    expect(maskCredential("tvk_live_1234abcd")).toBe("••••abcd");
  });

  it("fully masks short or empty credentials", () => {
    expect(maskCredential("ab")).toBe("••••");
    expect(maskCredential("")).toBe("");
    expect(maskCredential(null)).toBe("");
    expect(maskCredential(undefined)).toBe("");
  });
});
