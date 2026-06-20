import { describe, expect, it } from "vitest";

import { mapTurnTrace, PUBLIC_PHASES, type RawTurnTrace } from "./map-trace";

function raw(over: Partial<RawTurnTrace> = {}): RawTurnTrace {
  return { floorId: "f1", ...over };
}

describe("mapTurnTrace · carrier", () => {
  it("infers system_graph from native prompt mode", () => {
    expect(mapTurnTrace(raw({ promptMode: "native" })).carrier).toEqual({
      kind: "system_graph",
      source: "detected",
    });
  });

  it("infers composite from compat prompt modes", () => {
    expect(mapTurnTrace(raw({ promptMode: "compat_strict" })).carrier.kind).toBe("composite");
    expect(mapTurnTrace(raw({ promptMode: "compat_plus" })).carrier.kind).toBe("composite");
  });

  it("falls back to unknown when prompt mode is absent", () => {
    expect(mapTurnTrace(raw()).carrier).toEqual({ kind: "unknown", source: "unknown" });
  });
});

describe("mapTurnTrace · phases", () => {
  it("marks reached phases done, current active, rest pending", () => {
    const view = mapTurnTrace(raw({ publicPhase: "verifying", runStatus: "running" }));
    expect(view.phases.map((p) => p.state)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(view.phases.map((p) => p.phase)).toEqual([...PUBLIC_PHASES]);
  });

  it("marks all phases done when the run completed", () => {
    const view = mapTurnTrace(raw({ publicPhase: "generating", runStatus: "completed" }));
    expect(view.phases.every((p) => p.state === "done")).toBe(true);
  });

  it("marks all pending when there is no run", () => {
    const view = mapTurnTrace(raw());
    expect(view.phases.every((p) => p.state === "pending")).toBe(true);
  });
});

describe("mapTurnTrace · CommitGate", () => {
  it("maps verifier status to a commit decision", () => {
    expect(mapTurnTrace(raw({ verifier: { status: "passed" } })).commitGate.decision).toBe("allow");
    expect(mapTurnTrace(raw({ verifier: { status: "warned" } })).commitGate.decision).toBe("warn");
    expect(mapTurnTrace(raw({ verifier: { status: "blocked" } })).commitGate.decision).toBe("block");
    expect(mapTurnTrace(raw({ verifier: { status: "skipped" } })).commitGate.decision).toBe("skipped");
  });

  it("carries verifier issues and suggestion", () => {
    const view = mapTurnTrace(
      raw({
        verifier: {
          status: "blocked",
          issues: [{ description: "continuity break", severity: "error" }],
          suggestion: "retry with context",
        },
      }),
    );
    expect(view.commitGate.issues).toHaveLength(1);
    expect(view.commitGate.suggestion).toBe("retry with context");
  });

  it("defaults to unknown without a verifier", () => {
    expect(mapTurnTrace(raw()).commitGate.decision).toBe("unknown");
  });
});

describe("mapTurnTrace · agentic", () => {
  it("normalizes governance contributors with retained/pruned tokens", () => {
    const view = mapTurnTrace(
      raw({
        governance: [
          { sourceKind: "worldbook", sections: ["lore"], tokenCount: 100, retainedTokenCount: 80, prunedTokenCount: 20, pinned: true },
        ],
        summaries: ["did a thing"],
        tokenUsage: { input: 12, output: 34, total: 46 },
      }),
    );
    expect(view.agentic.governance[0]).toMatchObject({
      sourceKind: "worldbook",
      retainedTokenCount: 80,
      prunedTokenCount: 20,
      pinned: true,
    });
    expect(view.agentic.summaries).toEqual(["did a thing"]);
    expect(view.agentic.tokenUsage).toEqual({ input: 12, output: 34, total: 46 });
  });

  it("flags restricted and surfaces limitations", () => {
    const view = mapTurnTrace(raw({ restricted: true, limitations: ["snapshot unavailable"] }));
    expect(view.restricted).toBe(true);
    expect(view.agentic.limitations).toEqual(["snapshot unavailable"]);
  });

  it("degrades gracefully with empty inputs", () => {
    const view = mapTurnTrace(raw());
    expect(view.agentic.governance).toEqual([]);
    expect(view.agentic.summaries).toEqual([]);
    expect(view.agentic.tokenUsage).toBeNull();
    expect(view.agentic.error).toBeNull();
  });
});
