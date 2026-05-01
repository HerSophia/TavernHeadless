import { parseBranchMemoryScopeId } from "@tavern/shared";
import type { MemoryInjectionOptions, MemoryInjectionResult, PromptRuntimeMemoryTrace } from "@tavern/core";

type PromptRuntimeMemoryScopeResolutionTrace = NonNullable<PromptRuntimeMemoryTrace["scopeResolution"]>;
type PromptRuntimeMemoryTokenStats = NonNullable<PromptRuntimeMemoryTrace["tokenStats"]>;

type MemoryScopeName = NonNullable<PromptRuntimeMemoryScopeResolutionTrace["requestedScopes"]>[number];
type TraceSelectedItem = {
  scope: MemoryScopeName;
  branchId?: string | null;
  kind: string;
  tokenCount?: number | null;
};

export function buildPromptRuntimeMemoryScopeResolutionTrace(args: {
  sessionId: string;
  branchId?: string;
  floorId?: string;
  options?: Pick<MemoryInjectionOptions, "scope">;
  diagnostics?: MemoryInjectionResult["scopeResolution"];
  selectedItems?: readonly TraceSelectedItem[];
}): PromptRuntimeMemoryScopeResolutionTrace | undefined {
  const requestedScopes = resolveRequestedScopes(args.branchId, args.floorId, args.options?.scope);
  const diagnostics = args.diagnostics;
  const resolvedScopes = dedupeScopes([
    ...resolveScopesFromDiagnostics(diagnostics, args.sessionId, args.floorId),
    ...(args.selectedItems ?? []).map((item) => item.scope),
  ]);
  const resolvedBranchId = resolveBranchIdFromDiagnostics(diagnostics)
    ?? (args.selectedItems ?? []).find((item) => typeof item.branchId === "string")?.branchId
    ?? null;

  if (!diagnostics && resolvedScopes.length === 0) {
    return undefined;
  }

  return {
    mode: resolvePublicScopeResolutionMode(diagnostics?.mode),
    ...(diagnostics?.strict !== undefined ? { strict: diagnostics.strict } : {}),
    requestedScopes,
    resolvedScopes,
    requestedBranchId: args.branchId ?? null,
    resolvedBranchId,
    fallbackReason: resolveFallbackReason(diagnostics),
  };
}

export function buildPromptRuntimeMemoryTokenStats(args: {
  budget?: number | null;
  used: number;
  selectedItems?: readonly TraceSelectedItem[];
}): PromptRuntimeMemoryTokenStats {
  const microSummary = sumTokenCounts(args.selectedItems, "micro_summary");
  const macroSummary = sumTokenCounts(args.selectedItems, "macro_summary");
  return {
    budget: args.budget ?? null,
    used: args.used,
    microSummary,
    macroSummary,
    directItems: Math.max(0, args.used - microSummary - macroSummary),
  };
}

function resolveRequestedScopes(
  branchId: string | undefined,
  floorId: string | undefined,
  explicitScope: MemoryInjectionOptions["scope"] | undefined,
): MemoryScopeName[] {
  if (explicitScope) {
    return [explicitScope];
  }

  return [
    "global",
    ...(branchId ? ["branch" as const] : ["chat" as const]),
    ...(floorId ? ["floor" as const] : []),
  ];
}

function resolveScopesFromDiagnostics(
  diagnostics: MemoryInjectionResult["scopeResolution"] | undefined,
  sessionId: string,
  floorId: string | undefined,
): MemoryScopeName[] {
  if (!diagnostics) {
    return [];
  }

  if (diagnostics.scopeRefs && diagnostics.scopeRefs.length > 0) {
    return diagnostics.scopeRefs.map((ref) => ref.scope as MemoryScopeName);
  }

  if (diagnostics.explicitScope) {
    return [diagnostics.explicitScope.scope as MemoryScopeName];
  }

  if (diagnostics.mode === "direct_scope_fallback") {
    if (diagnostics.fallbackScopeId === sessionId) {
      return ["chat"];
    }
    if (floorId && diagnostics.fallbackScopeId === floorId) {
      return ["floor"];
    }
  }

  return [];
}

function resolvePublicScopeResolutionMode(
  mode: NonNullable<MemoryInjectionResult["scopeResolution"]>["mode"] | undefined,
): PromptRuntimeMemoryScopeResolutionTrace["mode"] {
  switch (mode) {
    case "visible_refs":
      return "branch_aware";
    case "explicit_scope":
      return "explicit_scope";
    case "direct_scope_fallback":
      return "fallback";
    case "strict_empty":
      return "strict_empty";
    case "resolver_error":
      return "resolver_error";
    default:
      return "legacy_direct";
  }
}

function resolveFallbackReason(
  diagnostics: MemoryInjectionResult["scopeResolution"] | undefined,
): string | null {
  if (!diagnostics) {
    return null;
  }

  switch (diagnostics.mode) {
    case "direct_scope_fallback":
      return diagnostics.fallbackScopeId
        ? `direct_scope_fallback:${diagnostics.fallbackScopeId}`
        : "direct_scope_fallback";
    case "strict_empty":
      return "strict_empty";
    case "resolver_error":
      return diagnostics.error?.message ?? "resolver_error";
    default:
      return null;
  }
}

function resolveBranchIdFromDiagnostics(
  diagnostics: MemoryInjectionResult["scopeResolution"] | undefined,
): string | null {
  if (!diagnostics) {
    return null;
  }

  if (diagnostics.scopeRefs) {
    for (const ref of diagnostics.scopeRefs) {
      if (ref.scope !== "branch") {
        continue;
      }
      const branchRef = parseBranchMemoryScopeId(ref.scopeId);
      if (branchRef?.branchId) {
        return branchRef.branchId;
      }
    }
  }

  if (diagnostics.explicitScope?.scope === "branch") {
    return parseBranchMemoryScopeId(diagnostics.explicitScope.scopeId)?.branchId ?? null;
  }

  return null;
}

function dedupeScopes(scopes: readonly MemoryScopeName[]): MemoryScopeName[] {
  return [...new Set(scopes)];
}

function sumTokenCounts(items: readonly TraceSelectedItem[] | undefined, kind: string): number {
  if (!items || items.length === 0) {
    return 0;
  }

  return items.reduce((sum, item) => {
    if (item.kind !== kind) {
      return sum;
    }
    return sum + Math.max(0, item.tokenCount ?? 0);
  }, 0);
}
