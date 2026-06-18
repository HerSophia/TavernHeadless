import { describe, expect, it } from "vitest";

import { mapPromptRuntimeInjectionTraceToSnakeCase } from "../chat/presenters.js";
import {
  isRestrictedInjectionVisibility,
  resolveInjectionVisibility,
  shouldRedactInjectionContent,
} from "../../services/prompt-runtime/injection-governance.js";
import type {
  PromptRuntimeInjectionTraceItem,
} from "../../services/prompt-runtime-injection-types.js";

function makeItem(
  overrides: Partial<PromptRuntimeInjectionTraceItem> & Pick<PromptRuntimeInjectionTraceItem, "sourceKind" | "visibility">,
): PromptRuntimeInjectionTraceItem {
  return {
    requestIndex: 0,
    scope: "request",
    placementRequested: "after_history",
    orderRequested: 100,
    title: "Secret guidance",
    contentLength: 12,
    tokenCount: 4,
    budgetGroup: "injection",
    budgetStatus: "within_budget",
    applied: true,
    placementResolved: "history.after",
    anchorResolved: { kind: "section", internalKey: "history.after" },
    ...overrides,
  };
}

describe("prompt runtime injection visibility governance", () => {
  it("maps each source kind to its visibility level", () => {
    expect(resolveInjectionVisibility("client_injection")).toBe("client");
    expect(resolveInjectionVisibility("agent_injection")).toBe("agent_private");
    expect(resolveInjectionVisibility("debug_injection")).toBe("debug");
    expect(resolveInjectionVisibility("system_override")).toBe("system");
    expect(resolveInjectionVisibility("unknown_kind")).toBe("client");
  });

  it("treats agent_private, debug and system as restricted but not client", () => {
    expect(isRestrictedInjectionVisibility("client")).toBe(false);
    expect(isRestrictedInjectionVisibility("agent_private")).toBe(true);
    expect(isRestrictedInjectionVisibility("debug")).toBe(true);
    expect(isRestrictedInjectionVisibility("system")).toBe(true);
  });

  it("only redacts restricted visibilities and respects the explicit override", () => {
    expect(shouldRedactInjectionContent("client")).toBe(false);
    expect(shouldRedactInjectionContent("agent_private")).toBe(true);
    expect(shouldRedactInjectionContent("agent_private", { includeRestrictedContent: true })).toBe(false);
    expect(shouldRedactInjectionContent("debug", { includeRestrictedContent: true })).toBe(false);
  });
});

describe("mapPromptRuntimeInjectionTraceToSnakeCase visibility redaction", () => {
  it("keeps client injections fully visible and marks them not restricted", () => {
    const mapped = mapPromptRuntimeInjectionTraceToSnakeCase({
      items: [makeItem({ sourceKind: "client_injection", visibility: "client", title: "Client guide" })],
    });

    const item = (mapped.items as Record<string, unknown>[])[0]!;
    expect(item.title).toBe("Client guide");
    expect(item.restricted).toBe(false);
    expect(item.visibility).toBe("client");
  });

  it("redacts restricted injection title and source chain by default while keeping structural fields", () => {
    const mapped = mapPromptRuntimeInjectionTraceToSnakeCase({
      items: [
        makeItem({
          sourceKind: "agent_injection",
          visibility: "agent_private",
          title: "Internal agent plan",
          sourceChain: { agentTypeId: "draft_assistant", agentRunId: "run-1" },
        }),
      ],
    });

    const item = (mapped.items as Record<string, unknown>[])[0]!;
    expect(item.title).toBeNull();
    expect(item.source_chain).toBeNull();
    expect(item.restricted).toBe(true);
    // Structural observability is preserved.
    expect(item.visibility).toBe("agent_private");
    expect(item.applied).toBe(true);
    expect(item.placement_resolved).toBe("history.after");
    expect(item.budget_status).toBe("within_budget");
    expect(item.content_length).toBe(12);
  });

  it("returns restricted injection content fully when explicitly authorized", () => {
    const mapped = mapPromptRuntimeInjectionTraceToSnakeCase(
      {
        items: [
          makeItem({
            sourceKind: "debug_injection",
            visibility: "debug",
            title: "Debug only note",
            sourceChain: { debugSessionTag: "tag-9" },
          }),
        ],
      },
      { includeRestrictedInjectionContent: true },
    );

    const item = (mapped.items as Record<string, unknown>[])[0]!;
    expect(item.title).toBe("Debug only note");
    expect(item.source_chain).toEqual({ debug_session_tag: "tag-9" });
    expect(item.restricted).toBe(false);
  });
});
