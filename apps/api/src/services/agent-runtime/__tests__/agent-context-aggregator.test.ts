import { describe, expect, it } from "vitest";

import { AgentContextAggregator } from "../agent-context-aggregator.js";
import type { AgentRunRecord } from "../inline-agent-types.js";
import type { PromptRuntimeContributorOutput } from "../../chat/types.js";

function contributor(id: string, kind: PromptRuntimeContributorOutput["kind"]): PromptRuntimeContributorOutput {
  return {
    id,
    kind,
    sourceKind: kind,
    modeScope: "native",
    payload: {},
    promptRenderable: { title: id, content: "x" },
    trace: { deterministic: true, cacheScope: "floor" },
  };
}

function preRecord(overrides: Partial<AgentRunRecord> & Pick<AgentRunRecord, "agentId" | "roleKind">): AgentRunRecord {
  return {
    phase: "pre_response",
    status: "ok",
    durationMs: 1,
    stabilityHint: "floor",
    ...overrides,
  };
}

describe("AgentContextAggregator", () => {
  const aggregator = new AgentContextAggregator();

  it("合并 ok 状态的 pre Agent contributor 与约束", () => {
    const result = aggregator.aggregate([
      preRecord({
        agentId: "a",
        roleKind: "scene_state",
        output: { contributor: contributor("agent:scene_state", "scene_state") },
      }),
      preRecord({
        agentId: "b",
        roleKind: "agency_guard",
        output: { narratorConstraints: ["no agency override"] },
      }),
    ]);

    expect(result.contributors).toHaveLength(1);
    expect(result.narratorConstraints).toContain("no agency override");
  });

  it("忽略非 ok 状态或非 pre_response 的记录", () => {
    const result = aggregator.aggregate([
      preRecord({
        agentId: "failed",
        roleKind: "scene_state",
        status: "failed",
        output: { contributor: contributor("x", "scene_state") },
      }),
      {
        agentId: "post",
        roleKind: "continuity_verifier",
        phase: "post_response",
        status: "ok",
        durationMs: 1,
        stabilityHint: "page",
        output: { findings: [] },
      },
    ]);

    expect(result.contributors).toHaveLength(0);
  });

  it("agency_guard 与 director 同时存在时记录冲突解决（规则 1）", () => {
    const result = aggregator.aggregate([
      preRecord({
        agentId: "guard",
        roleKind: "agency_guard",
        output: { narratorConstraints: ["constraint"] },
      }),
      preRecord({
        agentId: "director",
        roleKind: "director",
        output: { contributor: contributor("agent:director", "director_hint") },
      }),
    ]);

    expect(result.conflicts.some((conflict) => conflict.code === "agency_over_director")).toBe(true);
    expect(result.conflicts.find((conflict) => conflict.code === "agency_over_director")?.resolvedBy).toBe(
      "agency_guard",
    );
  });

  it("透传 worldbook 与 memory 选择覆盖", () => {
    const result = aggregator.aggregate([
      preRecord({
        agentId: "wb",
        roleKind: "worldbook_focus",
        output: { worldbookSelectionOverride: { required: ["w1"], optional: [], suppressed: [] } },
      }),
      preRecord({
        agentId: "mem",
        roleKind: "memory_selection",
        output: { memorySelectionOverride: { required: ["m1"], optional: [] } },
      }),
    ]);

    expect(result.worldbookSelectionOverride?.required).toEqual(["w1"]);
    expect(result.memorySelectionOverride?.required).toEqual(["m1"]);
  });
});
