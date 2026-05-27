import { describe, expect, it } from "vitest";
import type { MemoryInjectionResult } from "@tavern/core";

import { mapMemoryInjectionResultToSnakeCase } from "../../chat/presenters.js";

describe("mapMemoryInjectionResultToSnakeCase", () => {
  it("maps visible_refs scope resolution into the public route shape", () => {
    const result = mapMemoryInjectionResultToSnakeCase(createMemoryInjectionResult({
      mode: "visible_refs",
      strict: false,
      scopeRefs: [
        { scope: "global", scopeId: "default-admin" },
        { scope: "branch", scopeId: "memscope:session-1:main" },
      ],
    }));

    expect(result).toMatchObject({
      items: [
        {
          id: "memory-branch-fact-1",
          scope: "branch",
          scope_id: "memscope:session-1:main",
          type: "fact",
          summary_tier: null,
          fact_key: "vault_key_owner",
          token_count_estimate: 18,
        },
      ],
      formatted_text: "[Memory]\n- Bob still holds the vault key.",
      token_count: 64,
      scope_resolution: {
        mode: "visible_refs",
        strict: false,
        scope_refs: [
          { scope: "global", scopeId: "default-admin" },
          { scope: "branch", scopeId: "memscope:session-1:main" },
        ],
      },
    });
  });

  it("maps explicit_scope, direct_scope_fallback, and resolver_error diagnostics additively", () => {
    expect(mapMemoryInjectionResultToSnakeCase(createMemoryInjectionResult({
      mode: "explicit_scope",
      strict: true,
      explicitScope: { scope: "chat", scopeId: "memscope:session-1" },
    }))).toMatchObject({
      scope_resolution: {
        mode: "explicit_scope",
        strict: true,
        explicit_scope: { scope: "chat", scopeId: "memscope:session-1" },
      },
    });

    expect(mapMemoryInjectionResultToSnakeCase(createMemoryInjectionResult({
      mode: "direct_scope_fallback",
      strict: false,
      fallbackScopeId: "memscope:session-1:main",
    }))).toMatchObject({
      scope_resolution: {
        mode: "direct_scope_fallback",
        strict: false,
        fallback_scope_id: "memscope:session-1:main",
      },
    });

    expect(mapMemoryInjectionResultToSnakeCase(createMemoryInjectionResult({
      mode: "resolver_error",
      strict: true,
      error: {
        name: "MemoryScopeResolutionError",
        message: "scope resolver failed",
      },
    }))).toMatchObject({
      scope_resolution: {
        mode: "resolver_error",
        strict: true,
        error: {
          name: "MemoryScopeResolutionError",
          message: "scope resolver failed",
        },
      },
    });
  });
});

function createMemoryInjectionResult(
  scopeResolution: NonNullable<MemoryInjectionResult["scopeResolution"]>,
): MemoryInjectionResult {
  return {
    items: [
      {
        id: "memory-branch-fact-1",
        scope: "branch",
        scopeId: "memscope:session-1:main",
        type: "fact",
        content: "Bob still holds the vault key.",
        factKey: "vault_key_owner",
        importance: 0.82,
        confidence: 1,
        status: "active",
        tokenCountEstimate: 18,
        createdAt: 1710000000100,
        updatedAt: 1710000000200,
      },
    ],
    formattedText: "[Memory]\n- Bob still holds the vault key.",
    tokenCount: 64,
    scopeResolution: scopeResolution,
  };
}
