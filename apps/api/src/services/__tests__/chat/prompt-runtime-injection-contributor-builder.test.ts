import { describe, expect, it } from "vitest";

import { PromptRuntimeInjectionContributorBuilder } from "../../chat/prompt-runtime-injection-contributor-builder.js";

describe("PromptRuntimeInjectionContributorBuilder", () => {
  it("trims inputs and applies default order and scope for valid injections", () => {
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
    }]);

    expect(result.items).toEqual([{
      requestIndex: 0,
      sourceKind: "client_injection",
      scope: "request",
      placementRequested: "before_history",
      orderRequested: 100,
      title: "Client guide",
      contentLength: "Keep the north pass in focus.".length,
      applied: true,
      placementResolved: "history.before",
    }]);
  });

  it("sorts renderables and trace items by placement priority, order, and submit order", () => {
    const result = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "native",
      injections: [
        {
          sourceKind: "client_injection",
          title: " Late history ",
          content: "History tail",
          placement: "after_history",
          order: 1,
        },
        {
          sourceKind: "client_injection",
          title: " Second system ",
          content: "Second system body",
          placement: "before_system_prompt",
          order: 200,
        },
        {
          sourceKind: "client_injection",
          title: " First system ",
          content: "First system body",
          placement: "before_system_prompt",
          order: 50,
        },
        {
          sourceKind: "client_injection",
          title: " Tied system ",
          content: "Tied system body",
          placement: "before_system_prompt",
          order: 50,
        },
      ],
    });

    expect(result.renderables.map((item) => item.title)).toEqual([
      "First system",
      "Tied system",
      "Second system",
      "Late history",
    ]);
    expect(result.renderables.map((item) => item.requestIndex)).toEqual([2, 3, 1, 0]);
    expect(result.items.map((item) => item.requestIndex)).toEqual([2, 3, 1, 0]);
    expect(result.items.map((item) => item.orderRequested)).toEqual([50, 50, 200, 1]);
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
      scope: "request",
      placementRequested: "before_history",
      orderRequested: 100,
      title: "",
      contentLength: 4,
      applied: false,
      placementResolved: "history.before",
      notAppliedReason: "empty_title_or_content",
    }]);
  });
});
