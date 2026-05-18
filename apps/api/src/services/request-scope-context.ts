import type { FastifyRequest } from "fastify";

import { getOptionalRequestAuthContext, requireRequestAuthContext, type AuthenticatedAuthContext } from "../plugins/auth.js";

export type RequestActorType = "account" | "client" | "system";

export type RequestScopeContext = {
  accountId: string;
  actorType: RequestActorType;
  actorId: string;
  actorAccountId: string | null;
  actorClientId: string | null;
  workspaceId?: string;
  projectId?: string;
  sessionId?: string;
  source: "api" | "system";
};

/**
 * Build a {@link RequestScopeContext} from an authenticated auth context.
 *
 * Account actors get `actorType = account`, Client actors get `actorType = client`.
 * Both branches keep the underlying account id in `accountId` and `actorAccountId`
 * so that downstream services can still attribute logs and project events back
 * to the owning account.
 */
export function requestScopeFromAuth(auth: AuthenticatedAuthContext): RequestScopeContext {
  return {
  accountId: auth.accountId,
    actorType: auth.actorType,
    actorId: auth.actorId,
    actorAccountId: auth.actorAccountId,
    actorClientId: auth.actorClientId,
    source: "api",
  };
}

/**
 * Build a {@link RequestScopeContext} from a Fastify request.
 *
 * The request must have an authenticated auth context attached. Use
 * {@link tryRequestScopeFromRequest} when the request might be on a public
 * route.
 */
export function requestScopeFromRequest(request: FastifyRequest): RequestScopeContext {
  return requestScopeFromAuth(requireRequestAuthContext(request));
}

/**
 * Returns the request scope context when the request has been authenticated.
 */
export function tryRequestScopeFromRequest(request: FastifyRequest): RequestScopeContext | null {
  const auth = getOptionalRequestAuthContext(request);
  if (!auth || auth.kind !== "authenticated") {
    return null;
  }
  return requestScopeFromAuth(auth);
}
