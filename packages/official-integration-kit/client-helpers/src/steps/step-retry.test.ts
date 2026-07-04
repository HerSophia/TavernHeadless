import { describe, expect, it } from "vitest";

import {
  canRetryFromStep,
  collectIrreversibleSideEffectsBefore,
  collectIrreversibleSideEffectsFrom,
} from "./step-retry.js";

import type { FloorAnswerStep, FloorNarrationStep, FloorStep, FloorToolStep } from "./types.js";

function tool(index: number, executionId: string, sideEffectLevel: string | null): FloorToolStep {
  return {
    kind: "tool",
index,
    executionId,
    toolName: "nodegraph.node.create",
    status: "success",
    args: null,
    result: null,
    sideEffectLevel,
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
  return { kind: "answer", index, id, role: "assistant", content: `c-${id}` };
}

function narration(index: number, stepIndex: number): FloorNarrationStep {
  return { kind: "narration", index, stepIndex,content: `n-${stepIndex}`, createdAt: index };
}

describe("canRetryFromStep", () => {
  it("无写副作用的工具步可作为重试起点", () => {
    expect(canRetryFromStep(tool(0, "e1", "none"))).toBe(true);
  });

  it("带 sandbox / irreversible 副作用的工具步不可作为重试起点", () => {
    expect(canRetryFromStep(tool(0, "e1", "sandbox"))).toBe(false);
    expect(canRetryFromStep(tool(1, "e2", "irreversible"))).toBe(false);
  });

  it("sideEffectLevel 为 null 的工具步不可作为重试起点", () => {
    expect(canRetryFromStep(tool(0, "e1", null))).toBe(false);
  });

  it("回答步与叙述步不可作为重试起点", () => {
   expect(canRetryFromStep(answer(0, "m1"))).toBe(false);
    expect(canRetryFromStep(narration(0, 1))).toBe(false);
  });
});

describe("collectIrreversibleSideEffectsBefore", () => {
  it("空序列返回空数组", () => {
    expect(collectIrreversibleSideEffectsBefore([], 0)).toEqual([]);
  });

  it("起点之前全为 none 时返回空数组", () => {
    const steps: FloorStep[] = [tool(0, "e1", "none"), tool(1, "e2", "none"), tool(2, "e3", "none")];
    expect(collectIrreversibleSideEffectsBefore(steps, 2)).toEqual([]);
  });

  it("只收集起点之前、副作用非 none 的工具步，按出现顺序", () => {
    const steps: FloorStep[] = [
      tool(0, "e1", "irreversible"),
      answer(1, "m1"),
      tool(2, "e2", "sandbox"),
      tool(3, "e3", "none"),
    ];
    const result = collectIrreversibleSideEffectsBefore(steps, 3);
    expect(result).toEqual([
  { index: 0, executionId: "e1", toolName: "nodegraph.node.create", sideEffectLevel: "irreversible", startedAt: 0 },
      { index: 2, executionId: "e2", toolName: "nodegraph.node.create", sideEffectLevel: "sandbox", startedAt: 2 },
    ]);
  });

  it("起点自身及其之后的写类副作用不计入", () => {
    const steps: FloorStep[] = [
      tool(0, "e1", "none"),
      tool(1, "e2", "irreversible"),
      tool(2, "e3", "sandbox"),
    ];
    // fromIndex = 1：起点自身（index 1）与其后（index 2）都不计入
    expect(collectIrreversibleSideEffectsBefore(steps, 1)).toEqual([]);
  });

  it("忽略回答步与叙述步，只看工具步", () => {
    const steps: FloorStep[] = [answer(0, "m1"), narration(1, 1), tool(2, "e1", "irreversible")];
    expect(collectIrreversibleSideEffectsBefore(steps, 3)).toEqual([
      { index: 2, executionId: "e1", toolName: "nodegraph.node.create", sideEffectLevel: "irreversible", startedAt: 2 },
    ]);
  });
});

describe("collectIrreversibleSideEffectsFrom", () => {
  it("空序列返回空数组", () => {
    expect(collectIrreversibleSideEffectsFrom([], 0)).toEqual([]);
  });

  it("起点及其之后全为 none 时返回空数组", () => {
    const steps: FloorStep[] = [tool(0, "e1", "none"), tool(1, "e2", "none"), tool(2, "e3", "none")];
    expect(collectIrreversibleSideEffectsFrom(steps, 0)).toEqual([]);
  });

  it("只收集起点及其之后、副作用非 none 的工具步，按出现顺序", () => {
    const steps: FloorStep[] = [
      tool(0, "e1", "irreversible"),
      tool(1, "e2", "none"),
      answer(2, "m1"),
      tool(3, "e3", "sandbox"),
      tool(4, "e4", "irreversible"),
    ];
    // fromIndex = 1：起点自身（none，不计）；其后 index 3 / 4 的写类副作用计入；index 0 在起点之前不计入。
    const result = collectIrreversibleSideEffectsFrom(steps, 1);
    expect(result).toEqual([
      { index: 3, executionId: "e3", toolName: "nodegraph.node.create", sideEffectLevel: "sandbox", startedAt: 3 },
      { index: 4, executionId: "e4", toolName: "nodegraph.node.create", sideEffectLevel: "irreversible", startedAt: 4 },
    ]);
  });

  it("起点自身带写类副作用时也计入（起点在丢弃范围内）", () => {
    const steps: FloorStep[] = [tool(0, "e1", "none"), tool(1, "e2", "irreversible")];
    expect(collectIrreversibleSideEffectsFrom(steps, 1)).toEqual([
      { index: 1, executionId: "e2", toolName: "nodegraph.node.create", sideEffectLevel: "irreversible", startedAt: 1 },
    ]);
  });

  it("忽略回答步与叙述步，只看工具步", () => {
    const steps: FloorStep[] = [answer(0, "m1"), narration(1, 1), tool(2, "e1", "irreversible")];
    expect(collectIrreversibleSideEffectsFrom(steps, 0)).toEqual([
      { index: 2, executionId: "e1", toolName: "nodegraph.node.create", sideEffectLevel: "irreversible", startedAt: 2 },
    ]);
  });
});

