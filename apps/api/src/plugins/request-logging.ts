import type { FastifyInstance, FastifyRequest } from "fastify";

const importsRoutePrefixes = ["import", "presets", "worldbooks", "regex-profiles"];

export function resolveRouteTag(route: string): string {
  if (route === "/" || route.length === 0) {
    return "system";
  }

  if (route === "/health") {
    return "system";
  }

  if (route.startsWith("/docs") || route === "/openapi.json") {
    return "docs";
  }

  if (route.startsWith("/ws")) {
    return "ws";
  }

  if (
    route.startsWith("/sessions/") && (
      route.endsWith("/respond") ||
      route.endsWith("/respond/stream") ||
      route.endsWith("/respond/dry-run") ||
      route.endsWith("/regenerate")
    )) {
    return "chat";
  }

  if (route.startsWith("/floors/") && route.endsWith("/retry")) {
    return "chat";
  }

  if (route.startsWith("/messages/") && route.endsWith("/edit-and-regenerate")) {
    return "chat";
  }

  const firstSegment = route.replace(/^\//, "").split("/")[0] ?? "";

  if (importsRoutePrefixes.includes(firstSegment)) {
    return "imports";
  }

  if (firstSegment.length === 0) {
    return "system";
  }

  return firstSegment;
}

function toLatencyMs(startedAt: bigint): number {
  const durationNs = process.hrtime.bigint() - startedAt;
  return Number(durationNs) / 1_000_000;
}

export async function registerRequestLogging(app: FastifyInstance): Promise<void> {
  const startedAtMap = new WeakMap<FastifyRequest, bigint>();

  app.addHook("onRequest", async (request) => {
    startedAtMap.set(request, process.hrtime.bigint());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = startedAtMap.get(request) ?? process.hrtime.bigint();
    const route = request.routeOptions.url ?? request.url.split("?")[0] ?? "/";

    app.log.info(
      {
        request_id: request.id,
        method: request.method,
        route,
        route_tag: resolveRouteTag(route),
        status_code: reply.statusCode,
        latency_ms: Number(toLatencyMs(startedAt).toFixed(2)),
      },
      "request completed"
    );
  });
}
