import { parseBranchMemoryScopeId } from "@tavern/shared";

export function resolveMemorySessionIdFromScopeCarrier(carrier: Record<string, unknown>): string | undefined {
  const scope = typeof carrier.scope === "string" ? carrier.scope : undefined;
  const scopeId = typeof carrier.scopeId === "string" ? carrier.scopeId : undefined;

  if (!scope || !scopeId) {
    return undefined;
  }

  if (scope === "chat") {
    return scopeId;
  }

  if (scope === "branch") {
    return parseBranchMemoryScopeId(scopeId)?.sessionId;
  }

  return undefined;
}
