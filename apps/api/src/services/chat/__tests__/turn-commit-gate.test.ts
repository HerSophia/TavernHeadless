import { describe, expect, it } from "vitest";

import { buildCommitGateDecision } from "../turn-commit-gate.js";

describe("buildCommitGateDecision", () => {
  it("没有 finding 时允许提交", () => {
    expect(buildCommitGateDecision()).toEqual({
      status: "allow",
      policy: "warn_only",
      reasons: [],
    });
  });

  it("warn_only 下 error finding 只产生 warn", () => {
    const decision = buildCommitGateDecision({
      findings: {
        continuity: [{ code: "continuity_error", severity: "error", summary: "冲突" }],
      },
    });

    expect(decision.status).toBe("warn");
    expect(decision.reasons[0]).toMatchObject({
      code: "continuity_error",
      severity: "error",
      sourceAgentId: "continuity",
    });
  });

  it("block_on_error 下 error finding 会阻断提交", () => {
    const decision = buildCommitGateDecision({
      policy: "block_on_error",
      findings: {
        agency: [{ code: "agency_error", severity: "error", summary: "越权" }],
      },
    });

    expect(decision.status).toBe("block");
  });
});
