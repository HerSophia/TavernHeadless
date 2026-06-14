import { describe, expect, it } from "vitest";

import {
  TurnAttemptCoordinator,
  modeFromRunType,
  resolveReplayModeForMode,
  resolveReplayModeForRunType,
} from "../turn-attempt-coordinator.js";

describe("TurnAttemptCoordinator", () => {
  it("为 retry_turn 生成 with_context_refresh 的 attempt identity", () => {
    const coordinator = new TurnAttemptCoordinator();

    const identity = coordinator.createIdentity({
      sessionId: "session-1",
      branchId: "main",
      floorId: "floor-1",
      runId: "run-1",
      runType: "retry_turn",
      attemptNo: 2,
      candidateOutputPageId: "page-candidate",
      candidateAssistantMessageId: "msg-candidate",
    });

    expect(identity).toMatchObject({
      sessionId: "session-1",
      branchId: "main",
      floorId: "floor-1",
      runId: "run-1",
      runType: "retry_turn",
      attemptNo: 2,
      replayMode: "with_context_refresh",
      candidateOutputPageId: "page-candidate",
      candidateAssistantMessageId: "msg-candidate",
    });
  });

  it("按入口模式解析默认 replay mode", () => {
    expect(resolveReplayModeForMode("respond")).toBe("full_floor_context");
    expect(resolveReplayModeForMode("regenerate")).toBe("full_floor_context");
    expect(resolveReplayModeForMode("retry_floor")).toBe("with_context_refresh");
    expect(resolveReplayModeForMode("edit_and_regenerate")).toBe("full_floor_context");
  });

  it("按 runType 解析默认 replay mode 与 mode", () => {
    expect(resolveReplayModeForRunType("retry_turn")).toBe("with_context_refresh");
    expect(modeFromRunType("regenerate_page")).toBe("regenerate");
    expect(modeFromRunType("edit_and_regenerate")).toBe("edit_and_regenerate");
  });
});
