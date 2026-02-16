import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { DEFAULT_ADMIN_ACCOUNT_ID, type AccountMode } from "../accounts/constants.js";
import { sendError } from "../lib/http.js";

export type AuthMode = "off" | "api_key" | "jwt";

export type AuthConfig =
  | { mode: "off" }
  | { mode: "api_key"; apiKeys: string[]; apiKeyAccountMap?: Record<string, string> }
  | { mode: "jwt"; jwtSecret: string; jwtAccountClaim?: string };

export type AuthContext = {
  accountId: string;
  role: "admin" | "user";
  subject?: string;
};

type RegisterAuthOptions = {
  accountMode?: AccountMode;
  defaultAccountId?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext;
  }
}

const PUBLIC_PATHS = new Set(["/health", "/openapi.json", "/docs-en", "/docs-zh"]);

export async function registerAuth(
  app: FastifyInstance,
  auth: AuthConfig,
  options: RegisterAuthOptions = {}
): Promise<void> {
  const accountMode = options.accountMode ?? "single";
  const defaultAccountId = options.defaultAccountId ?? DEFAULT_ADMIN_ACCOUNT_ID;

  if (auth.mode === "jwt") {
    await app.register(fastifyJwt, {
      secret: auth.jwtSecret,
    });
  }

  const apiKeys = auth.mode === "api_key" ? new Set(auth.apiKeys) : new Set<string>();

  app.addHook("onRequest", async (request, reply) => {
    const pathname = getPathname(request);
    if (isPublicPath(pathname)) {
      request.authContext = {
        accountId: defaultAccountId,
        role: "admin",
      };
      return;
    }

    if (auth.mode === "off") {
      request.authContext = {
        accountId: defaultAccountId,
        role: "admin",
      };
      return;
    }

    if (auth.mode === "api_key") {
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        sendError(reply, 401, "auth_required", "Authentication required");
        return;
      }

      if (!apiKeys.has(apiKey)) {
        sendError(reply, 403, "auth_invalid_credentials", "Invalid API key");
        return;
      }

      const accountId =
        accountMode === "single"
          ? defaultAccountId
          : auth.apiKeyAccountMap?.[apiKey]?.trim();

      if (!accountId) {
        sendError(reply, 403, "auth_account_unresolved", "API key is not bound to an account");
        return;
      }

      request.authContext = {
        accountId,
        role: accountId === defaultAccountId ? "admin" : "user",
      };
      return;
    }

    const payload = await verifyJwt(request, reply);
    if (!payload) {
      return;
    }

    const accountId =
      accountMode === "single"
        ? defaultAccountId
        : resolveJwtAccountId(payload, auth.jwtAccountClaim ?? "account_id");

    if (!accountId) {
      sendError(reply, 403, "auth_account_unresolved", "JWT token does not contain a valid account id");
      return;
    }

    request.authContext = {
      accountId,
      role: resolveRole(payload, accountId, defaultAccountId),
      subject: typeof payload.sub === "string" ? payload.sub : undefined,
    };
  });
}

export function getRequestAuthContext(request: FastifyRequest): AuthContext {
  return request.authContext ?? {
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    role: "admin",
  };
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }

  return pathname === "/docs" || pathname.startsWith("/docs/");
}

function getPathname(request: FastifyRequest): string {
  return request.url.split("?")[0] ?? "/";
}

async function verifyJwt(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<Record<string, unknown> | null> {
  const authorization = request.headers.authorization;
  if (!authorization || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    sendError(reply, 401, "auth_required", "Authentication required");
    return null;
  }

  try {
    await request.jwtVerify();
    if (!request.user || typeof request.user !== "object") {
      return {};
    }

    return request.user as Record<string, unknown>;
  } catch {
    sendError(reply, 403, "auth_invalid_token", "Invalid JWT token");
    return null;
  }
}

function resolveJwtAccountId(payload: Record<string, unknown>, claimKey: string): string | null {
  const claim = payload[claimKey];
  if (typeof claim !== "string") {
    return null;
  }

  const accountId = claim.trim();
  return accountId.length > 0 ? accountId : null;
}

function resolveRole(
  payload: Record<string, unknown>,
  accountId: string,
  defaultAccountId: string
): "admin" | "user" {
  const rawRole = payload.role;
  if (rawRole === "admin" || rawRole === "user") {
    return rawRole;
  }

  return accountId === defaultAccountId ? "admin" : "user";
}

function extractApiKey(request: FastifyRequest): string | undefined {
  const headerValue = request.headers["x-api-key"];
  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  if (Array.isArray(headerValue)) {
    const value = headerValue.find((item) => typeof item === "string" && item.trim().length > 0);
    if (value) {
      return value.trim();
    }
  }

  const authorization = request.headers.authorization;
  if (!authorization || typeof authorization !== "string") {
    return undefined;
  }

  if (!authorization.startsWith("Bearer ")) {
    return undefined;
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (token.length === 0) {
    return undefined;
  }

  return token;
}
