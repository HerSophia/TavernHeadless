import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { API_BASE } from "../../../test/msw/handlers";
import type { BackendConnection } from "../../../lib/backend/connection";
import { testBackendConnection, useConnectionTest } from "./use-connection-test";

function connection(overrides: Partial<BackendConnection>): BackendConnection {
  return {
    id: "t1",
    name: "Test",
    baseUrl: API_BASE,
    authMode: "dev",
    credential: null,
    accountHint: null,
    persistCredential: false,
    ...overrides,
  };
}

const healthOk = http.get(`${API_BASE}/health`, () => HttpResponse.json({ status: "ok" }));

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("testBackendConnection (msw)", () => {
  it("returns ok when reachable and authorized", async () => {
    server.use(healthOk, http.get(`${API_BASE}/llm-profiles`, () => HttpResponse.json({ data: [] })));
    const result = await testBackendConnection(connection({ authMode: "api_key", credential: "secret" }));
    expect(result.status).toBe("ok");
    expect(result.reachable).toBe(true);
    expect(result.authed).toBe(true);
  });

  it("returns auth_failed on 401 from the auth probe", async () => {
    server.use(
      healthOk,
      http.get(`${API_BASE}/llm-profiles`, () => HttpResponse.json({ error: "auth_required" }, { status: 401 })),
    );
    const result = await testBackendConnection(connection({ authMode: "api_key", credential: "wrong" }));
    expect(result.status).toBe("auth_failed");
    expect(result.reachable).toBe(true);
    expect(result.authed).toBe(false);
  });

  it("returns unreachable when health is not ok", async () => {
    server.use(http.get(`${API_BASE}/health`, () => HttpResponse.json({}, { status: 503 })));
    const result = await testBackendConnection(connection({}));
    expect(result.status).toBe("unreachable");
    expect(result.reachable).toBe(false);
  });

  it("returns unreachable when health throws", async () => {
    server.use(http.get(`${API_BASE}/health`, () => HttpResponse.error()));
    const result = await testBackendConnection(connection({}));
    expect(result.status).toBe("unreachable");
    expect(result.reachable).toBe(false);
  });

  it("returns error on unexpected auth-probe status", async () => {
    server.use(
      healthOk,
      http.get(`${API_BASE}/llm-profiles`, () => HttpResponse.json({}, { status: 500 })),
    );
    const result = await testBackendConnection(connection({ authMode: "api_key", credential: "x" }));
    expect(result.status).toBe("error");
  });

  it("returns error when the auth probe throws", async () => {
    server.use(healthOk, http.get(`${API_BASE}/llm-profiles`, () => HttpResponse.error()));
    const result = await testBackendConnection(connection({ authMode: "api_key", credential: "x" }));
    expect(result.status).toBe("error");
  });

  it("tracks status through the composable", async () => {
    server.use(healthOk, http.get(`${API_BASE}/llm-profiles`, () => HttpResponse.json({ data: [] })));
    const { status, result, run, reset } = useConnectionTest();
    expect(status.value).toBe("idle");
    await run(connection({ authMode: "dev", accountHint: "a1" }));
    expect(status.value).toBe("ok");
    expect(result.value?.status).toBe("ok");
    reset();
    expect(status.value).toBe("idle");
    expect(result.value).toBeNull();
  });
});
