import { describe, expect, it } from "vitest";

import { buildAgentRuntimeTrace, buildPostResponseEnvelope } from "../agent-runtime-trace.js";

describe("agent-runtime-trace R2 source projection", () => {
  it("在 trace 中记录 turn source、runType、attemptNo 和 outputPageId", () => {
    const postEnvelope = buildPostResponseEnvelope([]);

    const trace = buildAgentRuntimeTrace({
      preRecords: [],
      postRecords: [],
      postEnvelope,
      source: {
        kind: "turn_post_response",
        mode: "retry_floor",
        runType: "retry_turn",
        sessionId: "session-1",
        floorId: "floor-1",
        attemptNo: 2,
        pageId: "page-2",
      },
      outputPageId: "page-2",
      gateDecision: {
        status: "warn",
        policy: "warn_only",
        reasons: [
          { code: "continuity_empty_output", severity: "warn", summary: "empty" },
        ],
      },
    });

    expect(trace.invocation).toEqual({
      kind: "turn_post_response",
      mode: "retry_floor",
      runType: "retry_turn",
      attemptNo: 2,
      pageId: "page-2",
    });
    expect(trace.response.outputPageId).toBe("page-2");
    expect(trace.postResponse.gate).toEqual({
      status: "warn",
      policy: "warn_only",
      reasonCount: 1,
    });
  });
});
