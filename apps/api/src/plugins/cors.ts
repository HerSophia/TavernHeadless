import cors, { type FastifyCorsOptions } from "@fastify/cors";
import type { FastifyInstance } from "fastify";

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
] as const;

export type CorsConfig = {
  credentials?: boolean;
  origins: string[] | true;
};

type HeaderTarget = {
  getHeader(name: string): string | number | readonly string[] | undefined;
  setHeader(name: string, value: string): void;
};

export function parseCorsOrigins(raw: string | undefined): string[] | true {
  if (!raw || raw.trim().length === 0) {
    return [...DEFAULT_DEV_ORIGINS];
  }

  const normalized = raw.trim();
  if (normalized === "*") {
    return true;
  }

  const origins = normalized
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return origins.length > 0 ? Array.from(new Set(origins)) : [...DEFAULT_DEV_ORIGINS];
}

export function applyCorsHeaders(target: HeaderTarget, requestOrigin: string | undefined, config: CorsConfig): void {
  const allowedOrigin = resolveAllowedOrigin(requestOrigin, config);
  if (!allowedOrigin) {
    return;
  }

  target.setHeader("Access-Control-Allow-Origin", allowedOrigin);

  if (config.credentials === true) {
    target.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (allowedOrigin !== "*") {
    appendVaryHeader(target, "Origin");
  }
}

function resolveAllowedOrigin(requestOrigin: string | undefined, config: CorsConfig): string | undefined {
  if (config.origins === true) {
    if (config.credentials === true) {
      return requestOrigin;
    }

    return "*";
  }

  if (!requestOrigin) {
    return undefined;
  }

  return config.origins.includes(requestOrigin) ? requestOrigin : undefined;
}

function appendVaryHeader(target: HeaderTarget, value: string): void {
  const existing = toHeaderValues(target.getHeader("Vary"));
  if (existing.some((item) => item.toLowerCase() === value.toLowerCase())) {
    return;
  }

  existing.push(value);
  target.setHeader("Vary", existing.join(", "));
}

function toHeaderValues(header: string | number | readonly string[] | undefined): string[] {
  if (header === undefined) {
    return [];
  }

  if (Array.isArray(header)) {
    return header.flatMap((item) => item.split(",")).map((item) => item.trim()).filter((item) => item.length > 0);
  }

  return String(header).split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

export async function registerCors(app: FastifyInstance, config: CorsConfig): Promise<void> {
  const options: FastifyCorsOptions = {
    origin: config.origins,
    credentials: config.credentials ?? false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Account-Id",
      "X-Client-Owner-Type",
      "X-Client-Owner-Id",
    ],
    maxAge: 86400,
    strictPreflight: false,
  };

  await app.register(cors, options);
}
