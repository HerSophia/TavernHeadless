import fastifyJwt from "@fastify/jwt";
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from"fastify";

import { getAccountAuthState } from "../accounts/service.js";
import { DEFAULT_ADMIN_ACCOUNT_ID, type AccountMode } from "../accounts/constants.js";
import type { AppDb } from "../db/client.js";
import { sendError } from "../lib/http.js";
import {
  ClientApiKeyService,
  ClientApiKeyServiceError,
  type ClientApiKeyAuthResult,
} from "../services/client-api-key-service.js";

export type AuthMode = "off" | "api_key" | "jwt";

export type AuthConfig =
  | { mode: "off" }
  | { mode: "api_key"; apiKeys: string[]; apiKeyAccountMap?: Record<string, string> }
  | { mode: "jwt"; jwtSecret: string; jwtAccountClaim?: string };

export type AuthMethod = "dev" | "static_api_key" | "jwt" | "client_api_key";

export type AuthenticatedAuthContext = {
  kind: "authenticated";
  accountId: string;
  role: "admin"| "user";
  status: "active" | "disabled";
  subject?: string;
  actorType: "account" | "client";
  actorId: string;
  actorAccountId:string;
  actorClientId: string | null;
  authMethod: AuthMethod;
};

export type PublicAuthContext = {
  kind: "public";
};

export type AuthContext = AuthenticatedAuthContext | PublicAuthContext;

type RegisterAuthOptions = {
  db: AppDb;
  accountMode?: AccountMode;
  defaultAccountId?: string;
};

declare module "fastify" {
  interface FastifyRequest {
   authContext?: AuthContext;
  }
}

const PUBLIC_PATHS = new Set(["/health", "/version", "/openapi.json", "/docs-en", "/docs-zh"]);
const CLIENT_API_KEY_HEADER = "x-tavern-client-key";
const CLIENT_API_KEY_SECRET_PREFIX = "tvk_live_";

export async function registerAuth(
  app: FastifyInstance,
  auth: AuthConfig,
  options: RegisterAuthOptions
): Promise<void> {
  const db = options.db;
  const accountMode = options.accountMode ?? "single";
  const defaultAccountId = options.defaultAccountId?? DEFAULT_ADMIN_ACCOUNT_ID;
  const clientApiKeyService = new ClientApiKeyService(db);

  if (auth.mode === "jwt") {
    await app.register(fastifyJwt, {
      secret: auth.jwtSecret,
    });
  }

  const apiKeyEntries = auth.mode === "api_key"
    ? auth.apiKeys.map((k) => ({ key: k, buf: Buffer.from(k, "utf-8") }))
    : [];

  app.addHook("onRequest", async (request, reply) => {
    const pathname = getPathname(request);
    if (isPublicPath(pathname)) {
      request.authContext = { kind: "public" };
     return;
    }

    const clientSecret =extractClientApiKeySecret(request);
    if (clientSecret) {
      const clientContext = await resolveClientApiKeyContext(
        clientApiKeyService,
        db,
        reply,
        clientSecret,
      );
      if (!clientContext) {
        return;
      }
      request.authContext = clientContext;
      return;
    }

    if (auth.mode === "off") {
      request.authContext = createDevelopmentAuthContext(defaultAccountId);
      return;
    }

    if (auth.mode === "api_key") {
      const apiKey = extractStaticApiKey(request);
   if (!apiKey) {
        sendError(reply, 401, "auth_required", "Authentication required");
        return;
      }

      const matchedKey = timingSafeApiKeyMatch(apiKey, apiKeyEntries);
      if (!matchedKey) {
        sendError(reply, 403, "auth_invalid_credentials", "Invalid API key");
        return;
      }

      const accountId =
        accountMode === "single"
          ?defaultAccountId
          : auth.apiKeyAccountMap?.[matchedKey]?.trim();

      if (!accountId) {
        sendError(reply, 403,"auth_account_unresolved", "API key isnot boundtoan account");
        return;
      }

      const accountContext = await resolveAccountContext(db, reply, accountId, "static_api_key");
      if (!accountContext) {
        return;
      }

      request.authContext = accountContext;
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

    const accountContext = await resolveAccountContext(db, reply, accountId, "jwt");
    if (!accountContext) {
  return;
    }

    request.authContext = {
      ...accountContext,
      subject: typeof payload.sub === "string" ? payload.sub : undefined,
    };
  });
}

export function getOptionalRequestAuthContext(request: FastifyRequest): AuthContext | undefined {
  return request.authContext;
}

export function requireRequestAuthContext(request: FastifyRequest): AuthenticatedAuthContext {
  const authContext = request.authContext;
  if (!authContext || authContext.kind !== "authenticated") {
    throw new Error("Authenticated request context is not available");
  }

  return authContext;
}

export function getRequestAuthContext(request: FastifyRequest): AuthenticatedAuthContext {
  return requireRequestAuthContext(request);
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

async function resolveAccountContext(
 db: AppDb,
  reply: FastifyReply,
  accountId: string,
  authMethod: Exclude<AuthMethod, "client_api_key" | "dev">,
): Promise<AuthenticatedAuthContext | null> {
  const account = await getAccountAuthState(db, accountId);
  if (!account) {
    sendError(reply, 401, "auth_account_not_found", "Authenticated account does not exist");
    return null;
  }

  if (account.status !== "active") {
    sendError(reply, 403, "auth_account_disabled", "Authenticated account is disabled");
    return null;
  }

  return {
    kind: "authenticated",
    accountId: account.id,
    role: account.role,
    status: account.status,
    actorType: "account",
    actorId: account.id,
    actorAccountId: account.id,
    actorClientId: null,
    authMethod,
  };
}

async function resolveClientApiKeyContext(
  service: ClientApiKeyService,
  db: AppDb,
  reply: FastifyReply,
  secret: string,
): Promise<AuthenticatedAuthContext | null> {
  let auth: ClientApiKeyAuthResult;
  try {
auth = service.authenticate(secret);
  } catch (error) {
    if (error instanceof ClientApiKeyServiceError) {
      sendError(reply, 401, "client_api_key_invalid", "Client API key is invalid");
      return null;
    }
    throw error;
  }

  const account = await getAccountAuthState(db, auth.accountId);
  if (!account || account.status !== "active") {
    sendError(reply, 401, "client_api_key_invalid", "Client API key is invalid");
    return null;
  }

  return {
    kind: "authenticated",
    accountId: account.id,
    role: account.role,
    status: account.status,
    actorType: "client",
    actorId: auth.clientId,
    actorAccountId: account.id,
    actorClientId: auth.clientId,
    authMethod: "client_api_key",
  };
}

function createDevelopmentAuthContext(defaultAccountId: string): AuthenticatedAuthContext {
  return {
    kind: "authenticated",
    accountId: defaultAccountId,
    role: "admin",
    status: "active",
    actorType: "account",
    actorId: defaultAccountId,
    actorAccountId: defaultAccountId,
    actorClientId: null,
    authMethod: "dev",
  };
}

function resolveJwtAccountId(payload: Record<string, unknown>, claimKey: string): string| null {
  const claim = payload[claimKey];
  if (typeof claim !== "string") {
    return null;
  }

  const accountId = claim.trim();
  return accountId.length > 0 ? accountId : null;
}

function timingSafeApiKeyMatch(
  candidate: string,
  entries: ReadonlyArray<{ key: string; buf: Buffer }>
): string | undefined {
  const candidateBuf = Buffer.from(candidate, "utf-8");
  let matched: string | undefined;
  for (const entry of entries) {
    if (candidateBuf.length === entry.buf.length && timingSafeEqual(candidateBuf, entry.buf)) {
      matched = entry.key;
    }
  }
  return matched;
}

function extractClientApiKeySecret(request: FastifyRequest): string | undefined {
  const headerValue = request.headers[CLIENT_API_KEY_HEADER];
  const headerSecret = pickFirstString(headerValue);
  if (headerSecret) {
    return headerSecret;
  }

  const bearer = extractBearerToken(request);
  if (bearer && bearer.startsWith(CLIENT_API_KEY_SECRET_PREFIX)) {
    return bearer;
  }

  return undefined;
}

function extractStaticApiKey(request: FastifyRequest): string | undefined {
const headerValue = request.headers["x-api-key"];
  const fromHeader = pickFirstString(headerValue);
  if (fromHeader) {
    return fromHeader;
  }

  const bearer = extractBearerToken(request);
  if (bearer && !bearer.startsWith(CLIENT_API_KEY_SECRET_PREFIX)) {
    return bearer;
  }

  return undefined;
}

function extractBearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization || typeof authorization !== "string") {
    return undefined;
  }
  if (!authorization.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

function pickFirstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim().length > 0) {
        return entry.trim();
      }
    }
  }
  return undefined;
}
