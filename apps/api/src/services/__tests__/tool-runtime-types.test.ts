import { describe, expect, it } from "vitest";
import type { RuntimeToolEnvelope } from "@tavern/core";

import { finalizeToolCallResult } from "../tool-runtime-types.js";

function makeEnvelope(acceptedAt: number = 0): RuntimeToolEnvelope {
  return {
    executionId: "exec-1",
    runId: "run-1",
    sessionId: "sess-1",
    floorId: "floor-1",
    callerSlot: "narrator",
    providerId: "mcp:server-1",
    providerType: "mcp",
    toolName: "any_tool",
    args: {},
    sideEffectLevel: "irreversible",
    deliveryMode: "async_job",
    asyncCapability: "deferred_ok",
    resultVisibility: "deferred_receipt",
    acceptedAt,
  };
}

describe("finalizeToolCallResult", () => {
  it("prioritizes explicit executionStatus over error message inference", () => {
    const envelope = makeEnvelope();

    const finalized = finalizeToolCallResult(
      envelope,
      {
        error: "some generic failure text without timeout keyword",
        executionStatus: "uncertain",
        executionReasonCode: "mcp_call_timeout_uncertain",
      },
      100,
    );

    expect(finalized.status).toBe("uncertain");
    expect(finalized.reasonCode).toBe("mcp_call_timeout_uncertain");
    expect(finalized.errorMessage).toBe(
      "some generic failure text without timeout keyword",
    );
  });

  it("falls back to message-based inference when no structured status is provided", () => {
    const envelope = makeEnvelope();

    const finalized = finalizeToolCallResult(
      envelope,
      { error: "Tool call timeout after 10000ms" },
      100,
    );

    expect(finalized.status).toBe("timeout");
    expect(finalized.reasonCode).toBeUndefined();
  });

  it("marks successful results without error as success", () => {
    const envelope = makeEnvelope();

    const finalized = finalizeToolCallResult(
      envelope,
      { data: { ok: true } },
      100,
    );

    expect(finalized.status).toBe("success");
    expect(finalized.errorMessage).toBeUndefined();
  });
});
