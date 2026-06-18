import { describe, expect, it } from "vitest";

import { PromptRuntimeInjectionContributorBuilder } from "../../chat/prompt-runtime-injection-contributor-builder.js";
import { PROMPT_RUNTIME_INJECTION_BUDGET_GROUP } from "../../prompt-runtime/injection-governance.js";

describe("PromptRuntimeInjectionContributorBuilder", () => {
  it("trims inputs and applies default order scope and enabled state for valid injections", () => {
    const result = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "compat_plus",
      injections: [{
        sourceKind: "client_injection",
        title: "  Client guide  ",
        content: "  Keep the north pass in focus.  ",
        placement: "before_history",
      }],
    });

    expect(result.renderables).toEqual([{
      sourceKind: "client_injection",
      title: "Client guide",
      content: "Keep the north pass in focus.",
      tokenCount: "Keep the north pass in focus.".length,
      budgetGroup: PROMPT_RUNTIME_INJECTION_BUDGET_GROUP,
      internalPlacementKey: "history.before",
      requestIndex: 0,
      requestedPlacement: "before_history",
      requestedOrder: 100,
      scope: "request",
      anchor: { kind: "section", internalKey: "history.before" },
    }]);

    expect(result.items).toEqual([{
      requestIndex: 0,
      sourceKind: "client_injection",
      visibility: "client",
      enabled: true,
      scope: "request",
      placementRequested: "before_history",
      orderRequested: 100,
      title: "Client guide",
      contentLength: "Keep the north pass in focus.".length,
      tokenCount: "Keep the north pass in focus.".length,
      budgetGroup: PROMPT_RUNTIME_INJECTION_BUDGET_GROUP,
      budgetStatus: "within_budget",
      applied: true,
      placementResolved: "history.before",
      anchorResolved: { kind: "section", internalKey: "history.before" },
    }]);
  });

  it("derives visibility from source kind for non-client injections", () => {
    const result = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "native",
      injections: [
        { sourceKind: "agent_injection", title: "Agent", content: "Body", placement: "after_history" },
        { sourceKind: "debug_injection", title: "Debug", content: "Body", placement: "after_history" },
        { sourceKind: "system_override", title: "System", content: "Body", placement: "after_history" },
      ],
    });

    const byTitle = new Map(result.items.map((item) => [item.title, item.visibility]));
    expect(byTitle.get("Agent")).toBe("agent_private");
    expect(byTitle.get("Debug")).toBe("debug");
    expect(byTitle.get("System")).toBe("system");
  });

  it("sorts by placement then order then scope then createdAt then request order", () => {
    const result = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "native",
      injections: [
        {
          sourceKind: "client_injection",
          title: "Request tie",
          content: "request",
          placement: "before_history",
          order: 50,
          scope: "request",
        },
        {
          sourceKind: "client_injection",
          title: "Branch tie later",
          content: "branch-late",
          placement: "before_history",
          order: 50,
          scope: "branch",
          injectionId: "branch-2",
          createdAt: 20,
        },
        {
          sourceKind: "client_injection",
          title: "Session tie",
          content: "session",
          placement: "before_history",
          order: 50,
          scope: "session",
          injectionId: "session-1",
          createdAt: 10,
        },
        {
          sourceKind: "client_injection",
          title: "Branch tie early",
          content: "branch-early",
          placement: "before_history",
          order: 50,
          scope: "branch",
          injectionId: "branch-1",
          createdAt: 10,
        },
        {
          sourceKind: "client_injection",
          title: "After history",
          content: "after-history",
          placement: "after_history",
          order: 1,
          scope: "request",
        },
      ],
    });

    expect(result.renderables.map((item) => item.title)).toEqual([
      "Session tie",
      "Branch tie early",
      "Branch tie later",
      "Request tie",
      "After history",
    ]);
    expect(result.items.map((item) => item.requestIndex)).toEqual([2, 3, 1, 0, 4]);
  });

  it("reports unknown placements without producing renderables", () => {
    const result = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "compat_strict",
      injections: [{
        sourceKind: "client_injection",
        title: "Unsupported",
        content: "Body",
        placement: "after_assistant_prefill",
      }],
    });

    expect(result.renderables).toEqual([]);
    expect(result.items).toEqual([{
      requestIndex: 0,
      sourceKind: "client_injection",
      visibility: "client",
      enabled: true,
      scope: "request",
      placementRequested: "after_assistant_prefill",
      orderRequested: 100,
      title: "Unsupported",
      contentLength: 4,
      tokenCount: 4,
      budgetGroup: PROMPT_RUNTIME_INJECTION_BUDGET_GROUP,
      applied: false,
      notAppliedReason: "unknown_placement",
    }]);
  });

  it("reports empty titles or content after trimming while retaining placement resolution", () => {
    const result = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "compat_plus",
      injections: [{
        sourceKind: "client_injection",
        title: "   ",
        content: "Body",
        placement: "before_history",
      }],
    });

    expect(result.renderables).toEqual([]);
    expect(result.items).toEqual([{
      requestIndex: 0,
      sourceKind: "client_injection",
      visibility: "client",
      enabled: true,
      scope: "request",
      placementRequested: "before_history",
      orderRequested: 100,
      title: "",
      contentLength: 4,
      tokenCount: 4,
      budgetGroup: PROMPT_RUNTIME_INJECTION_BUDGET_GROUP,
      applied: false,
      placementResolved: "history.before",
      anchorResolved: { kind: "section", internalKey: "history.before" },
      notAppliedReason: "empty_title_or_content",
    }]);
  });

  it("reports disabled expired and mode scope mismatches before renderable creation", () => {
    const now = 1000;
    const result = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "compat_plus",
      now,
      injections: [
        {
          sourceKind: "client_injection",
          title: "Disabled",
          content: "Body",
          placement: "before_history",
          scope: "session",
          injectionId: "inj-disabled",
          enabled: false,
        },
        {
          sourceKind: "client_injection",
          title: "Expired",
          content: "Body",
          placement: "before_history",
          scope: "branch",
          injectionId: "inj-expired",
          ttlMs: 10,
          createdAt: 900,
        },
        {
          sourceKind: "client_injection",
          title: "Mode mismatch",
          content: "Body",
          placement: "before_history",
          scope: "session",
          injectionId: "inj-mode",
          modeScope: "native",
        },
      ],
    });

    expect(result.renderables).toEqual([]);
    expect(result.items).toEqual([
      expect.objectContaining({
        injectionId: "inj-disabled",
        enabled: false,
        scope: "session",
        applied: false,
        notAppliedReason: "disabled",
      }),
      expect.objectContaining({
        injectionId: "inj-mode",
        enabled: true,
        scope: "session",
        applied: false,
        notAppliedReason: "mode_scope_mismatch",
      }),
      expect.objectContaining({
        injectionId: "inj-expired",
        enabled: true,
        scope: "branch",
        applied: false,
        notAppliedReason: "expired",
      }),
    ]);
  });

  it("records token counts and rejects entries above token and total limits", () => {
    const tokenCounter = { name: "test", count: (text: string) => text.length };
    const result = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "compat_plus",
      tokenCounter,
      limits: {
        requestMaxCount: 10,
        sessionMaxCount: 10,
        branchMaxCount: 10,
        titleMaxLength: 100,
        contentMaxLength: 100,
        contentMaxTokens: 5,
        totalMaxTokens: 8,
      },
      injections: [
        {
          sourceKind: "client_injection",
          title: "One",
          content: "1234",
          placement: "before_history",
        },
        {
          sourceKind: "client_injection",
          title: "Too many tokens",
          content: "123456",
          placement: "before_history",
        },
        {
          sourceKind: "client_injection",
          title: "Total overflow",
          content: "12345",
          placement: "before_history",
        },
      ],
    });

    expect(result.tokenCount).toBe(4);
    expect(result.items).toEqual([
      expect.objectContaining({ title: "One", applied: true, tokenCount: 4 }),
      expect.objectContaining({ title: "Too many tokens", applied: false, notAppliedReason: "content_token_limit_exceeded" }),
      expect.objectContaining({ title: "Total overflow", applied: false, notAppliedReason: "total_token_limit_exceeded" }),
    ]);
  });

  it("rejects request injections over the configured scope quota", () => {
    const result = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "compat_plus",
      limits: {
        requestMaxCount: 1,
        sessionMaxCount: 10,
        branchMaxCount: 10,
        titleMaxLength: 100,
        contentMaxLength: 100,
        contentMaxTokens: 100,
        totalMaxTokens: 100,
      },
      injections: [
        {
          sourceKind: "client_injection",
          title: "First",
          content: "Body",
          placement: "before_history",
        },
        {
          sourceKind: "client_injection",
          title: "Second",
          content: "Body",
          placement: "before_history",
        },
      ],
    });

    expect(result.items).toEqual([
      expect.objectContaining({ title: "First", applied: true }),
      expect.objectContaining({ title: "Second", applied: false, notAppliedReason: "scope_quota_exceeded" }),
    ]);
  });
});
