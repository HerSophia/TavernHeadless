import { describe, expect, it } from "vitest";

import { groupFloorStepsIntoSegments } from "./group-floor-step-segments.js";

import type { FloorAnswerStep, FloorNarrationStep, FloorStep, FloorToolStep } from "./types.js";

function tool(index: number, executionId: string): FloorToolStep {
  return {
    kind: "tool",
    index,
    executionId,
    toolName: "nodegraph.node_type.list",
    status: "success",
    args: null,
    result: null,
    sideEffectLevel: null,
    commitOutcome: null,
    errorMessage: null,
    durationMs: null,
    startedAt: index,
    finishedAt: null,
    generationStepNo: index,
    attemptNo: null,
  };
}

function answer(index: number, id: string): FloorAnswerStep {
  return { kind: "answer", index, id, role:"assistant", content: `c-${id}` };
}

function narration(index: number, stepIndex: number): FloorNarrationStep {
  return { kind: "narration", index, stepIndex, content: `n-${stepIndex}`, createdAt: index };
}

describe("groupFloorStepsIntoSegments", () => {
  it("空序列产出空段", () => {
    expect(groupFloorStepsIntoSegments([])).toEqual([]);
  });

  it("仅工具：连续工具步合并为一个工具段", () => {
    const steps: FloorStep[] = [tool(0, "e1"), tool(1, "e2")];
    const segments = groupFloorStepsIntoSegments(steps);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe("tools");
    expect(segments[0]?.kind === "tools" && segments[0].steps.map((s) => s.executionId)).toEqual([
    "e1",
      "e2",
    ]);
  });

  it("工具在前：[工具段, 回答段]", () => {
    const segments = groupFloorStepsIntoSegments([tool(0, "e1"), answer(1, "a1")]);
    expect(segments.map((s) => s.kind)).toEqual(["tools", "answer"]);
  });

  it("工具在后：[回答段, 工具段]", () => {
    const segments = groupFloorStepsIntoSegments([answer(0, "a1"), tool(1, "e1")]);
    expect(segments.map((s) => s.kind)).toEqual(["answer", "tools"]);
  });

  it("工具在中间：[回答段, 工具段, 回答段]", () => {
    const segments = groupFloorStepsIntoSegments([
      answer(0, "a1"),
      tool(1, "e1"),
      tool(2, "e2"),
      answer(3, "a2"),
    ]);
    expect(segments.map((s) => s.kind)).toEqual(["answer", "tools", "answer"]);
    const middle = segments[1];
    expect(middle?.kind === "tools" && middle.steps).toHaveLength(2);
  });

  it("每个回答步单独成段，段key 稳定", () => {
    const segments = groupFloorStepsIntoSegments([answer(0, "a1"), answer(1, "a2")]);
    expect(segments.map((s) => s.key)).toEqual(["answer-a1", "answer-a2"]);
  });

  it("叙述步单独成叙述段，不并入工具段", () => {
    const segments = groupFloorStepsIntoSegments([narration(0, 1), tool(1, "e1"), answer(2, "a1")]);
    expect(segments.map((s) => s.kind)).toEqual(["narration", "tools", "answer"]);
    expect(segments[0]?.key).toBe("narration-0");
  });

  it("叙述与工具组交叉：叙述1→工具组1→叙述2→工具组2→结论", () => {
    const segments = groupFloorStepsIntoSegments([
      narration(0, 1),
      tool(1, "e1"),
      narration(2, 3),
      tool(3, "e2"),
      answer(4, "a1"),
    ]);
    expect(segments.map((s) => s.kind)).toEqual(["narration", "tools", "narration", "tools", "answer"]);
  });
});
