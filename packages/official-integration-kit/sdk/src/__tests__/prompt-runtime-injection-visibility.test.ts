import { describe, expect, it } from "vitest";

import { mapPromptRuntimeInjectionResultsPayload } from "../prompt-runtime.js";

describe("sdk prompt runtime injection visibility mapping", () => {
  it("maps a redacted restricted injection with null title and restricted flag", () => {
    const mapped = mapPromptRuntimeInjectionResultsPayload({
      items: [
        {
          request_index: 0,
          source_kind: "agent_injection",
          visibility: "agent_private",
          scope: "request",
          placement_requested: "after_history",
          order_requested: 100,
          title: null,
          content_length: 18,
          token_count: 6,
          budget_group: "injection",
          budget_status: "within_budget",
          applied: true,
          placement_resolved: "history.after",
          anchor_resolved: null,
          source_chain: null,
          not_applied_reason: null,
          restricted: true,
        },
      ],
    });

    expect(mapped).toBeDefined();
    const item = mapped![0]!;
    expect(item.visibility).toBe("agent_private");
    expect(item.title).toBeNull();
    expect(item.restricted).toBe(true);
    expect(item.budgetStatus).toBe("within_budget");
    expect(item.placementResolved).toBe("history.after");
  });

  it("keeps client injections fully visible without a restricted flag", () => {
    const mapped = mapPromptRuntimeInjectionResultsPayload({
      items: [
        {
          request_index: 0,
          source_kind: "client_injection",
          visibility: "client",
          scope: "request",
          placement_requested: "before_history",
          order_requested: 30,
          title: "Client guide",
          content_length: 29,
          budget_status: "within_budget",
          applied: true,
          placement_resolved: "history.before",
          restricted: false,
        },
      ],
    });

    const item = mapped![0]!;
    expect(item.title).toBe("Client guide");
    expect(item.restricted).toBeUndefined();
  });
});
