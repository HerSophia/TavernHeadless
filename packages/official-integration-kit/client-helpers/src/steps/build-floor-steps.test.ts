import { describe, expect, it } from "vitest";

import {
  buildFloorSteps,
  buildFloorStepsFromTranscriptFloor,
} from "./build-floor-steps.js";

import type { TemporaryConversationTranscriptFloor } from "@tavern/sdk";

describe("buildFloorSteps", () => {
  it("工具步按 startedAt 升序，回答步因 createdAt 更晚排在其后，并赋递增 index", () => {
    const steps = buildFloorSteps({
      toolExecutions: [
        { executionId: "e2", toolName: "b", status: "success", args: {}, result: {}, startedAt: 200 },
        { executionId: "e1", toolName: "a", status: "success", args: {}, result: {}, startedAt: 100 },
      ],
      answers: [{ id: "m1", role: "assistant", content: "最终回答", createdAt: 300, seq: 5 }],
    });

    expect(steps.map((s) => s.kind)).toEqual(["tool", "tool", "answer"]);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(steps[0]).toMatchObject({ kind: "tool", executionId: "e1", toolName: "a" });
    expect(steps[1]).toMatchObject({ kind: "tool", executionId: "e2", toolName: "b" });
   expect(steps[2]).toMatchObject({ kind: "answer", id: "m1", content: "最终回答" });
  });

it("纯回答（无工具）只产出一个回答步", () => {
    const steps = buildFloorSteps({
      toolExecutions: [],
      answers: [{ id: "m1", role: "assistant", content:"直接回答", createdAt: 100, seq: 1 }],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "answer", index: 0 });
  });

  it("纯工具（无回答）只产出工具步", () => {
    const steps = buildFloorSteps({
      toolExecutions: [
        { executionId: "e1", toolName: "a", status: "success", args: {}, result: {}, startedAt: 100 },
      ],
      answers: [],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "tool", index: 0 });
  });

  it("空输入产出空数组", () => {
 expect(buildFloorSteps({ toolExecutions: [], answers: [] })).toEqual([]);
  });

  it("多条回答步按 createdAt 升序排列", () => {
    const steps = buildFloorSteps({
      toolExecutions: [],
      answers: [
        { id: "m2", role: "assistant", content: "后", createdAt: 200, seq: 9 },
        { id: "m1", role: "narrator", content: "前", createdAt: 100, seq:2 },
      ],
 });
    expect(steps.map((s) => (s.kind === "answer" ? s.id : null))).toEqual(["m1", "m2"]);
  });

  it("工具在两条回答中间时，按时序交叉归并", () => {
    const steps = buildFloorSteps({
      toolExecutions: [
        { executionId: "e1", toolName: "a",status: "success", args: {}, result: {}, startedAt: 150 },
 ],
      answers: [
        { id: "m1", role: "assistant", content: "前文", createdAt: 100, seq: 1 },
        { id: "m2", role: "assistant", content: "后文", createdAt: 200, seq: 2 },
      ],
    });
    expect(
      steps.map((s) =>
        s.kind === "tool" ? `tool:${s.executionId}` : s.kind === "answer" ? `answer:${s.id}` : `narr:${s.stepIndex}`,
      ),
    ).toEqual(["answer:m1", "tool:e1", "answer:m2"]);
  });

it("工具在正文之后（回答更早）时，回答步排在工具步之前", () => {
    const steps = buildFloorSteps({
      toolExecutions: [
        { executionId: "e1", toolName: "a", status: "success", args: {}, result: {}, startedAt: 500 },
      ],
      answers: [{ id: "m1", role: "assistant", content: "先回答", createdAt: 100, seq: 1 }],
    });
    expect(steps.map((s) => s.kind)).toEqual(["answer", "tool"]);
  });

  it("叙述步与工具组、结论按时序交叉归并，叙述排在其工具组之前", () => {
    const steps = buildFloorSteps({
      toolExecutions: [
        { executionId: "e1", toolName: "a", status: "success", args: {}, result: {}, startedAt: 110 },
        { executionId: "e2", toolName: "b", status: "success", args: {}, result: {}, startedAt: 310 },
      ],
      answers: [{ id: "m1", role: "assistant", content: "结论", createdAt: 400, seq: 1 }],
      narrations: [
        { stepIndex: 1, content: "先叙述", createdAt: 100 },
        { stepIndex: 3, content: "再叙述", createdAt: 300 },
      ],
    });
    expect(
      steps.map((s) =>
        s.kind === "tool"
          ? `tool:${s.executionId}`
          : s.kind === "narration"
            ? `narr:${s.stepIndex}`
        : `ans:${s.id}`,
      ),
    ).toEqual(["narr:1", "tool:e1", "narr:3", "tool:e2", "ans:m1"]);
  });

  it("工具步缺省字段回退为 null", () => {
    const steps = buildFloorSteps({
      toolExecutions: [
        { executionId: "e1", toolName: "a", status: "running", args: null, result: null, startedAt: 100 },
      ],
      answers: [],
    });
    expect(steps[0]).toMatchObject({
      kind: "tool",
      sideEffectLevel: null,
      commitOutcome: null,
      errorMessage: null,
      durationMs: null,
      finishedAt: null,
      attemptNo: null,
    });
  });
});

describe("buildFloorStepsFromTranscriptFloor", () => {
  function makeFloor(
    overrides: Partial<TemporaryConversationTranscriptFloor> = {},
  ): TemporaryConversationTranscriptFloor {
    return {
      id: "f1",
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
   tokenOut: 0,
      createdAt: 0,
      updatedAt: 0,
      reasoningText: null,
      stepNarrations: [],
      toolExecutions: [],
      pages: [],
      ...overrides,
    };
  }

  it("从 active page 的助手消息与 toolExecutions归并 step（工具早于回答）",() => {
    const floor = makeFloor({
      toolExecutions: [
    {
          id: "exec1",
          toolName: "nodegraph.node_type.list",
        status: "success",
          args: { scope: "all" },
          result: { count: 3 },
  sideEffectLevel: "none",
          commitOutcome: "committed",
          errorMessage: null,
          durationMs: 120,
          startedAt: 1000,
          finishedAt: 1120,
          attemptNo: 1,
          generationStepNo: 1,
          replayParentExecutionId: null,
        },
      ],
      pages: [
        {
          id: "p1",
          pageNo: 1,
          pageKind: "mixed",
          isActive: true,
          version: 1,
          checksum: null,
          createdAt: 0,
          updatedAt: 0,
          messages: [
            { id: "u1", seq: 1, role: "user", content: "问题", contentFormat: "text", isHidden: false, source: null, createdAt: 900 },
            { id: "a1", seq: 2, role: "assistant", content: "回答", contentFormat: "markdown", isHidden: false, source: null, createdAt: 2000 },
          ],
        },
      ],
    });

    const steps = buildFloorStepsFromTranscriptFloor(floor);
    expect(steps.map((s) => s.kind)).toEqual(["tool", "answer"]);
    expect(steps[0]).toMatchObject({ kind: "tool", executionId: "exec1", durationMs: 120 });
    expect(steps[1]).toMatchObject({ kind: "answer", id: "a1", content: "回答"});
  });

  it("跳过 user 与隐藏消息，也跳过非 active page", () => {
    const floor = makeFloor({
      pages: [
        {
          id: "p1",
          pageNo: 1,
          pageKind: "mixed",
          isActive: false,
          version: 1,
          checksum: null,
          createdAt: 0,
          updatedAt: 0,
          messages: [
            { id: "old", seq: 1, role: "assistant", content: "旧版本", contentFormat: "text", isHidden: false, source: null, createdAt: 0 },
          ],
        },
        {
          id: "p2",
          pageNo: 1,
          pageKind: "mixed",
          isActive: true,
          version: 2,
          checksum: null,
          createdAt: 0,
          updatedAt: 0,
          messages: [
            { id: "u1", seq: 1, role: "user", content: "问题", contentFormat: "text", isHidden: false, source: null, createdAt: 0 },
            { id: "hidden", seq: 2, role: "assistant", content: "隐藏", contentFormat: "text", isHidden: true, source: null, createdAt: 0 },
            { id: "a1", seq: 3, role: "assistant", content: "可见回答", contentFormat: "text", isHidden: false, source: null, createdAt: 0 },
          ],
        },
      ],
    });

    const steps = buildFloorStepsFromTranscriptFloor(floor);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "answer", id: "a1", content: "可见回答" });
  });

  it("脱敏后 result 为 null 时工具步仍可归并", () => {
    const floor = makeFloor({
      toolExecutions: [
        {
          id: "exec1",
          toolName: "a",
          status: "success",
          args: null,
          result: null,
          sideEffectLevel: null,
          commitOutcome: "committed",
          errorMessage: null,
          durationMs: 0,
          startedAt: 1000,
          finishedAt: 1000,
          attemptNo: 1,
          generationStepNo:1,
          replayParentExecutionId: null,
        },
      ],
    });
    const steps = buildFloorStepsFromTranscriptFloor(floor);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "tool", result: null });
  });

  it("从 floor.stepNarrations 构造叙述步，按时序排在工具与回答之间", () => {
    const floor = makeFloor({
      stepNarrations: [{ stepIndex: 1, text: "中间叙述", createdAt: 950 }],
      toolExecutions: [
        {
          id: "exec1",
          toolName: "a",
          status: "success",
          args: null,
          result: null,
          sideEffectLevel: null,
          commitOutcome: "committed",
          errorMessage: null,
          durationMs: 0,
          startedAt: 1000,
          finishedAt: 1000,
          attemptNo: 1,
          generationStepNo: 1,
          replayParentExecutionId: null,
        },
      ],
      pages: [
        {
          id: "p1",
          pageNo: 1,
          pageKind: "mixed",
          isActive: true,
          version: 1,
          checksum: null,
          createdAt: 0,
          updatedAt: 0,
          messages: [
            { id: "a1", seq: 1, role: "assistant", content: "结论", contentFormat: "markdown", isHidden: false, source: null, createdAt: 2000 },
          ],
        },
      ],
    });

    const steps = buildFloorStepsFromTranscriptFloor(floor);
    expect(steps.map((s) => s.kind)).toEqual(["narration", "tool", "answer"]);
    expect(steps[0]).toMatchObject({ kind: "narration", stepIndex: 1, content: "中间叙述" });
  });
});
