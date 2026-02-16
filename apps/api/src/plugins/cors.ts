import cors, { type FastifyCorsOptions } from "@fastify/cors";
import type { FastifyInstance } from "fastify";

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
] as const;

export type CorsConfig = {
  credentials?: boolean;
  origins: string[] | true;
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

export async function registerCors(app: FastifyInstance, config: CorsConfig): Promise<void> {
  const options: FastifyCorsOptions = {
    origin: config.origins,
    credentials: config.credentials ?? false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Account-Id"],
    maxAge: 86400,
    strictPreflight: false,
  };

  await app.register(cors, options);
}
