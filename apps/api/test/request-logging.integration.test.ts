import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";
import { resolveRouteTag } from "../src/plugins/request-logging";

describe("request logging", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  it("logs request_id, latency_ms and route_tag for incoming requests", async () => {
    const infoSpy = vi.spyOn(app.log, "info");

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);

    const requestLogCall = infoSpy.mock.calls.find((call) => call[1] === "request completed");
    expect(requestLogCall).toBeDefined();

    const payload = requestLogCall?.[0] as Record<string, unknown>;
    expect(typeof payload.request_id).toBe("string");
    expect(payload.route_tag).toBe("system");
    expect(typeof payload.latency_ms).toBe("number");
  });

  it("logs sessions tag for sessions endpoints", async () => {
    const infoSpy = vi.spyOn(app.log, "info");

    const response = await app.inject({ method: "GET", url: "/sessions" });
    expect(response.statusCode).toBe(200);

    const requestLogCall = infoSpy.mock.calls.find((call) => {
      const payload = call[0] as Record<string, unknown>;
      return call[1] === "request completed" && payload.route_tag === "sessions";
    });

    expect(requestLogCall).toBeDefined();
  });
});

describe("resolveRouteTag", () => {
  it("maps docs and system routes", () => {
    expect(resolveRouteTag("/health")).toBe("system");
    expect(resolveRouteTag("/docs/")).toBe("docs");
    expect(resolveRouteTag("/openapi.json")).toBe("docs");
  });

  it("maps chat and imports routes", () => {
    expect(resolveRouteTag("/sessions/:id/respond")).toBe("chat");
    expect(resolveRouteTag("/sessions/:id/respond/stream")).toBe("chat");
    expect(resolveRouteTag("/sessions/:id/respond/dry-run")).toBe("chat");
    expect(resolveRouteTag("/sessions/:id/regenerate")).toBe("chat");
    expect(resolveRouteTag("/floors/:id/retry")).toBe("chat");
    expect(resolveRouteTag("/messages/:id/edit-and-regenerate")).toBe("chat");
    expect(resolveRouteTag("/import/preset")).toBe("imports");
    expect(resolveRouteTag("/presets")).toBe("imports");
  });
});
