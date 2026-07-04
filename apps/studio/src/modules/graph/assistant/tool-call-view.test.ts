import { describe, expect, it } from "vitest";

import type { TempStreamToolEvent } from "../../../lib/temp-conversation";
import { aggregateToolCallStatus, buildToolCallView, phaseToStatusKind } from "./tool-call-view";

function event(overrides: Partial<TempStreamToolEvent> = {}): TempStreamToolEvent {
  return {
    executionId: "exec_1",
    toolName: "nodegraph.graph.get_graph",
    phase: "success",
    providerId: "nodegraph",
    ...overrides,
  };
}

describe("phaseToStatusKind", () => {
  it("maps start to running", () => {
    expect(phaseToStatusKind("start")).toBe("running");
  });

  it("maps success to success", () => {
    expect(phaseToStatusKind("success")).toBe("success");
  });

  it("maps error / timeout / uncertain to error", () => {
    expect(phaseToStatusKind("error")).toBe("error");
    expect(phaseToStatusKind("timeout")).toBe("error");
    expect(phaseToStatusKind("uncertain")).toBe("error");
  });

  it("maps denied / blocked to blocked", () => {
    expect(phaseToStatusKind("denied")).toBe("blocked");
    expect(phaseToStatusKind("blocked")).toBe("blocked");
  });

  it("maps awaiting_confirmation to pending", () => {
    expect(phaseToStatusKind("awaiting_confirmation")).toBe("pending");
  });

  it("falls back to pending for unknown phase", () => {
    expect(phaseToStatusKind("something_new")).toBe("pending");
  });
});

describe("buildToolCallView", () => {
  it("derives status kind and short name", () => {
    const view = buildToolCallView(event({phase: "success", toolName: "nodegraph.graph.get_graph" }));
    expect(view.statusKind).toBe("success");
    expect(view.shortName).toBe("graph.get_graph");
    expect(view.category).toBe("read");
    expect(view.running).toBe(false);
  });

  it("marks danger by tool name", () => {
    const view = buildToolCallView(event({ toolName: "nodegraph.graph.create" }));
    expect(view.danger).toBe(true);
  });

  it("marks danger by irreversible side effect level", () => {
    const view = buildToolCallView(event({ toolName: "nodegraph.graph.get_graph", sideEffectLevel: "irreversible" }));
    expect(view.danger).toBe(true);
  });

  it("does not mark danger for plain read tools", () => {
    const view = buildToolCallView(event({ toolName: "nodegraph.graph.get_graph" }));
expect(view.danger).toBe(false);
  });

  it("nulls duration while running", () => {
    const view = buildToolCallView(event({ phase: "start", durationMs: 1200 }));
   expect(view.running).toBe(true);
    expect(view.durationMs).toBeNull();
  });

  it("keeps duration when finished", () => {
    const view = buildToolCallView(event({ phase: "success", durationMs: 1200 }));
    expect(view.durationMs).toBe(1200);
  });

  it("defaults duration to null when finished without value", () => {
    const view = buildToolCallView(event({ phase: "success" }));
    expect(view.durationMs).toBeNull();
  });

  it("flags hasArgs only when argshas keys", () => {
    expect(buildToolCallView(event({ args: { graphId: "g1" } })).hasArgs).toBe(true);
    expect(buildToolCallView(event({ args: {} })).hasArgs).toBe(false);
    expect(buildToolCallView(event({ args: undefined })).hasArgs).toBe(false);
  });

  it("trims message and nulls empty", () => {
    expect(buildToolCallView(event({ message: "  failed  " })).message).toBe("failed");
    expect(buildToolCallView(event({ message: "   " })).message).toBeNull();
    expect(buildToolCallView(event({ message: undefined })).message).toBeNull();
  });

  it("delegates args summary", () => {
    const view = buildToolCallView(event({ args: { graphId: "g1", patch: { ops: [] } } }));
    expect(view.argsSummary.entries.length).toBeGreaterThan(0);
  });
});

describe("aggregateToolCallStatus", () => {
  it("returns success for empty list",() => {
    expect(aggregateToolCallStatus([])).toBe("success");
  });

  it("prioritizes error over everything", () => {
    const views = [
    buildToolCallView(event({ executionId: "a", phase: "start" })),
      buildToolCallView(event({ executionId: "b", phase: "error" })),
      buildToolCallView(event({ executionId: "c", phase: "success" })),
    ];
    expect(aggregateToolCallStatus(views)).toBe("error");
  });

  it("returns running when no error but has running", () => {
    const views = [
      buildToolCallView(event({ executionId: "a", phase: "start" })),
      buildToolCallView(event({ executionId: "b", phase: "success"})),
    ];
    expect(aggregateToolCallStatus(views)).toBe("running");
  });

  it("returns success when all succeed", () => {
    const views = [
      buildToolCallView(event({ executionId: "a", phase: "success" })),
      buildToolCallView(event({ executionId: "b", phase: "success" })),
    ];
  expect(aggregateToolCallStatus(views)).toBe("success");
  });

  it("returns blocked over pending and success", () => {
    const views = [
      buildToolCallView(event({ executionId: "a", phase: "blocked" })),
      buildToolCallView(event({ executionId: "b", phase: "awaiting_confirmation" })),
      buildToolCallView(event({ executionId: "c",phase: "success" })),
    ];
    expect(aggregateToolCallStatus(views)).toBe("blocked");
});
});
