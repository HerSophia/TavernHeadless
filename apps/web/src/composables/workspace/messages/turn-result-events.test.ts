import { describe, expect, it } from "vitest";

import { countTurnSummaries, resolveTurnCompletionEventKey } from "./turn-result-events";

type MinimalTurnCompletionResult = {
  finalState?: "draft" | "generating" | "committed" | "failed";
  summaries: string[];
};

describe("resolveTurnCompletionEventKey", () => {
  it("keeps the base key for committed turns without summaries", () => {
    const result: MinimalTurnCompletionResult = {
      finalState: "committed",
      summaries: []
    };

    expect(resolveTurnCompletionEventKey("events.respondDone", result)).toBe("events.respondDone");
  });

  it("adds the summaries suffix when summaries are present", () => {
    const result: MinimalTurnCompletionResult = {
      finalState: "committed",
      summaries: ["summary-1"]
    };

    expect(resolveTurnCompletionEventKey("events.messageRegenerated", result)).toBe(
      "events.messageRegeneratedWithSummaries"
    );
  });

  it("adds the pending commit suffix when the final state is not committed", () => {
    const result: MinimalTurnCompletionResult = {
      finalState: "generating",
      summaries: []
    };

    expect(resolveTurnCompletionEventKey("events.messageRetried", result)).toBe(
      "events.messageRetriedPendingCommit"
    );
  });

  it("adds both suffixes when summaries exist before commit completion", () => {
    const result: MinimalTurnCompletionResult = {
      finalState: "failed",
      summaries: ["summary-1", "summary-2"]
    };

    expect(resolveTurnCompletionEventKey("events.respondDone", result)).toBe(
      "events.respondDonePendingCommitWithSummaries"
    );
  });
});

describe("countTurnSummaries", () => {
  it("returns zero when no result is available", () => {
    expect(countTurnSummaries()).toBe(0);
  });

  it("returns the summary count from the result", () => {
    const result: MinimalTurnCompletionResult = {
      finalState: "committed",
      summaries: ["summary-1", "summary-2", "summary-3"]
    };

    expect(countTurnSummaries(result)).toBe(3);
  });
});
