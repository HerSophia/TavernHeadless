import { describe, expect, it, vi } from "vitest";

import { TurnRunTracker } from "../../chat/turn-run-tracker.js";

describe("TurnRunTracker", () => {
  it("createTurnRunObserver forwards phase, output and verifier updates", async () => {
    const advancePhase = vi.fn(async () => undefined);
    const updatePendingOutput = vi.fn(async () => undefined);
    const updateVerifier = vi.fn(async () => undefined);
    const tracker = new TurnRunTracker(
      {} as never,
      { fail: vi.fn(async () => undefined) } as never,
      {
        advancePhase,
        updatePendingOutput,
        updateVerifier,
      } as never,
    );

    const observer = tracker.createTurnRunObserver("floor-1");
    await observer.onPhaseChange?.({ phase: "semantic_resolved", attemptNo: 2 } as never);
    await observer.onPendingOutputUpdate?.({ text: "chunk", state: "generated", attemptNo: 1 });
    await observer.onVerifierResult?.({ status: "passed" });

    expect(advancePhase).toHaveBeenCalledWith("floor-1", "semantic_resolved", { attemptNo: 2 });
    expect(updatePendingOutput).toHaveBeenCalledWith("floor-1", { text: "chunk", state: "generated", attemptNo: 1 });
    expect(updateVerifier).toHaveBeenCalledWith("floor-1", { status: "passed" });
  });

  it("failRunAndFloorBestEffort marks both run and floor as failed", async () => {
    const markFailed = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const tracker = new TurnRunTracker(
      {} as never,
      { fail } as never,
      { markFailed } as never,
    );

    await tracker.failRunAndFloorBestEffort("floor-1", new Error("boom"), "failed");

    expect(markFailed).toHaveBeenCalledWith("floor-1", { code: "failed", message: "boom" });
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
