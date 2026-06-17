import { describe, expect, it } from "vitest";

import { PromptRuntimeInjectionContributorBuilder } from "../../chat/prompt-runtime-injection-contributor-builder.js";

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
      enabled: true,
      scope: "request",
      placementRequested: "before_history",
      orderRequested: 100,
      title: "Client guide",
      contentLength: "Keep the north pass in focus.".length,
      applied: true,
      placementResolved: "history.before",
      anchorResolved: { kind: "section", internalKey: "history.before" },
    }]);
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
      enabled: true,
      scope: "request",
      placementRequested: "after_assistant_prefill",
      orderRequested: 100,
      title: "Unsupported",
      contentLength: 4,
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
      enabled: true,
      scope: "request",
      placementRequested: "before_history",
      orderRequested: 100,
      title: "",
      contentLength: 4,
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
});
